import "server-only";
import OpenAI from "openai";
import { serverEnv } from "@/lib/env";
import { getServiceClient } from "@/lib/supabase/server";
import { isSyntheticId } from "@/lib/ingest/gemini";
import type { NewsItem, NewsSignalPlayer, NewsSignals } from "@/lib/types";

/**
 * Extracts structured signals (recent form, key players, injuries) from the
 * Tavily news already stored for a fixture, using a model, and saves them onto
 * match_news.signals. This exists only for Gemini-sourced fixtures, which carry
 * NO API-Football season stats: without it those predictions are news-only with
 * a "No player data" placeholder. The signals are clearly labelled external
 * context downstream and never treated as hard stats, so confidence stays low.
 *
 * Runs as part of the seed pipeline, after ingestMatchNews and before predict.
 * Stats-rich (real API-Football) fixtures are skipped entirely.
 */

const EXTRACTION_MODEL = "gpt-4o-mini";
const MAX_KEY_PLAYERS = 6;
const MAX_INJURIES = 8;

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: serverEnv.openaiApiKey });
  return openai;
}

export interface NewsSignalsSummary {
  fixtureId: number;
  extracted: boolean;
  skipped: boolean;
  reason?: string;
  keyPlayers: number;
  injuries: number;
  hasForm: boolean;
}

/** Strip em dashes (rule 5) and trim. Returns null for empty strings. */
function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/—/g, "-").trim();
  return t === "" ? null : t;
}

function normalizePlayers(raw: unknown, cap: number): NewsSignalPlayer[] {
  if (!Array.isArray(raw)) return [];
  const out: NewsSignalPlayer[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const team = o.team === "home" || o.team === "away" ? o.team : null;
    const name = cleanText(o.name);
    if (!team || !name) continue;
    out.push({ team, name, note: cleanText(o.note) ?? "" });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Validates and normalizes a raw model response into NewsSignals. Drops any
 * malformed entries rather than failing the whole pipeline; returns null only
 * when the response is not a usable object.
 */
export function validateNewsSignals(raw: string): NewsSignals | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  return {
    home_form_summary: cleanText(o.home_form_summary),
    away_form_summary: cleanText(o.away_form_summary),
    key_players: normalizePlayers(o.key_players, MAX_KEY_PLAYERS),
    injuries: normalizePlayers(o.injuries, MAX_INJURIES)
  };
}

function buildPrompt(home: string, away: string, items: NewsItem[]): string {
  const newsBlock = items
    .map((n, i) => {
      const date = n.published_date ? `${n.published_date.slice(0, 10)} ` : "";
      const src = n.source ? ` (${n.source})` : "";
      const body = n.content ? `\n  ${n.content.slice(0, 400)}` : "";
      return `${i + 1}. ${date}${n.title}${src}${body}`;
    })
    .join("\n");

  return `You extract structured football context from recent news reports for an upcoming match.

MATCH: ${home} (home) vs ${away} (away)

NEWS REPORTS:
${newsBlock}

From ONLY the reports above, return a JSON object:
{
  "home_form_summary": string or null,   // ${home} recent form/momentum in one short sentence, only if the reports support it
  "away_form_summary": string or null,   // ${away} recent form/momentum in one short sentence
  "key_players": [ { "team": "home" | "away", "name": string, "note": string } ],   // players the reports highlight as influential, with a one-line reason
  "injuries": [ { "team": "home" | "away", "name": string, "note": string } ]       // players reported injured, suspended, or doubtful
}

Rules:
- Use only what the reports state. Do not invent players, form, or injuries. If nothing is reported for a field, use null or an empty array.
- "team" must be "home" for ${home} or "away" for ${away}.
- Keep notes factual and neutral. No betting, odds, or wager language. No em dashes.
- Return only the JSON object, no commentary.`;
}

export async function extractNewsSignals(fixtureId: number): Promise<NewsSignalsSummary> {
  const base: NewsSignalsSummary = {
    fixtureId,
    extracted: false,
    skipped: false,
    keyPlayers: 0,
    injuries: 0,
    hasForm: false
  };

  // Only stats-less (Gemini-sourced) fixtures need news-derived signals; real
  // API-Football fixtures already carry squads, form, and standings.
  if (!isSyntheticId(fixtureId)) {
    return { ...base, skipped: true, reason: "fixture has API-Football stats" };
  }

  const db = getServiceClient();

  const { data: fixture, error: fxErr } = await db
    .from("fixtures")
    .select("home_team_id, away_team_id")
    .eq("id", fixtureId)
    .single();
  if (fxErr || !fixture) throw new Error(`fixture ${fixtureId} not found: ${fxErr?.message}`);

  const [home, away] = await Promise.all([
    fixture.home_team_id
      ? db.from("teams").select("name").eq("id", fixture.home_team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    fixture.away_team_id
      ? db.from("teams").select("name").eq("id", fixture.away_team_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);
  const homeName = home.data?.name ?? "Home";
  const awayName = away.data?.name ?? "Away";

  const { data: newsRow } = await db
    .from("match_news")
    .select("items")
    .eq("fixture_id", fixtureId)
    .maybeSingle();
  const items = (newsRow?.items ?? []) as NewsItem[];

  if (items.length === 0) {
    return { ...base, skipped: true, reason: "no news to extract from" };
  }

  const resp = await getOpenAI().chat.completions.create({
    model: EXTRACTION_MODEL,
    max_tokens: 800,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: buildPrompt(homeName, awayName, items) }]
  });
  const raw = resp.choices[0]?.message?.content ?? "";

  const signals = validateNewsSignals(raw);
  if (!signals) {
    return { ...base, reason: "model returned unusable signals" };
  }

  const { error: upErr } = await db
    .from("match_news")
    .update({ signals: signals as never })
    .eq("fixture_id", fixtureId);
  if (upErr) throw new Error(`match_news signals update failed: ${upErr.message}`);

  return {
    ...base,
    extracted: true,
    keyPlayers: signals.key_players.length,
    injuries: signals.injuries.length,
    hasForm: Boolean(signals.home_form_summary || signals.away_form_summary)
  };
}
