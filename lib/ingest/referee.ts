import "server-only";
import OpenAI from "openai";
import { serverEnv } from "@/lib/env";
import { getServiceClient } from "@/lib/supabase/server";
import { tavilySearch } from "@/lib/tavily/client";
import type { RefereeRow, RefereeStrictness } from "@/lib/types";

/**
 * Referee profile ingest. The ASSIGNMENT (referee name) comes from API-Football
 * and is stored on the fixture. API-Football has no referee-stats endpoint, so
 * TENDENCIES are web-derived: a Tavily search summarised by an extractor model
 * into structured, nullable fields, clearly labelled as web-derived downstream.
 * Mirrors lib/ingest/news-signals.ts. It never fabricates: anything the reports
 * do not support comes back null.
 */

const EXTRACTION_MODEL = "gpt-4o-mini";
const MAX_SOURCES = 6;
const STRICTNESS = new Set<RefereeStrictness>(["lenient", "average", "strict"]);

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: serverEnv.openaiApiKey });
  return openai;
}

/** Normalised key for a referee name: lowercase, strip accents/punctuation. */
export function refereeSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strip em dashes (rule 5) and trim. Returns null for empty strings. */
function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/—/g, "-").trim();
  return t === "" ? null : t;
}

function coerceCards(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 12) return null; // sane bounds for cards/game
  return Math.round(n * 100) / 100;
}

function coerceStrictness(v: unknown): RefereeStrictness | null {
  return typeof v === "string" && STRICTNESS.has(v as RefereeStrictness)
    ? (v as RefereeStrictness)
    : null;
}

export interface RefereeProfile {
  avg_cards: number | null;
  penalty_tendency: string | null;
  strictness: RefereeStrictness | null;
  summary: string | null;
}

/**
 * Validate and normalise a raw extractor response into a RefereeProfile. Drops
 * malformed fields rather than failing; returns null only when the response is
 * not a usable object.
 */
export function validateRefereeProfile(raw: string): RefereeProfile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  return {
    avg_cards: coerceCards(o.avg_cards),
    penalty_tendency: cleanText(o.penalty_tendency),
    strictness: coerceStrictness(o.strictness),
    summary: cleanText(o.summary)
  };
}

/** A short labelled context block for the AI payloads. Pure; safe to reuse. */
export function formatRefereeContext(
  name: string | null,
  profile: Pick<RefereeRow, "avg_cards" | "penalty_tendency" | "strictness" | "summary"> | null
): string {
  if (!name) return "No referee assigned yet.";
  const parts: string[] = [`Referee: ${name}`];
  if (profile) {
    if (profile.avg_cards != null) parts.push(`avg cards per game ${profile.avg_cards}`);
    if (profile.strictness) parts.push(`strictness ${profile.strictness}`);
    if (profile.penalty_tendency) parts.push(`penalties: ${profile.penalty_tendency}`);
    if (profile.summary) parts.push(profile.summary);
  }
  if (parts.length === 1) parts.push("limited official data available");
  return parts.join("; ");
}

function buildPrompt(name: string, sources: string): string {
  return `You extract a football referee's tendencies from recent web reports.

REFEREE: ${name}

WEB REPORTS:
${sources}

From ONLY the reports above, return a JSON object:
{
  "avg_cards": number or null,        // average cards shown per game, only if a report states it
  "penalty_tendency": string or null, // short phrase on how often penalties are given, if reported
  "strictness": "lenient" | "average" | "strict" | null,  // overall reputation, if the reports support it
  "summary": string or null           // one short neutral sentence on this referee's style
}

Rules:
- Use only what the reports state. Do not invent numbers or tendencies. If a field is not supported, use null.
- Keep it factual and neutral. No betting, odds, or wager language. No em dashes.
- Return only the JSON object, no commentary.`;
}

export interface RefereeIngestSummary {
  slug: string;
  name: string;
  stored: boolean;
  hasProfile: boolean;
  reason?: string;
}

/**
 * Fetch web reports for a referee and upsert a best-effort profile into the
 * referees table, keyed by slug. Best-effort: returns a summary, and only throws
 * if the database write itself fails (callers wrap it anyway).
 */
export async function ingestRefereeProfile(name: string): Promise<RefereeIngestSummary> {
  const slug = refereeSlug(name);
  const base: RefereeIngestSummary = { slug, name, stored: false, hasProfile: false };
  if (slug === "") return { ...base, reason: "empty referee name" };

  const items = await tavilySearch(
    `${name} football referee cards per game penalties statistics this season`,
    MAX_SOURCES
  );

  let profile: RefereeProfile | null = null;
  if (items.length > 0) {
    const sources = items
      .map((n, i) => `${i + 1}. ${n.title}${n.source ? ` (${n.source})` : ""}${n.content ? `\n  ${n.content.slice(0, 400)}` : ""}`)
      .join("\n");
    try {
      const resp = await getOpenAI().chat.completions.create({
        model: EXTRACTION_MODEL,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: buildPrompt(name, sources) }]
      });
      profile = validateRefereeProfile(resp.choices[0]?.message?.content ?? "");
    } catch {
      profile = null; // extractor failure: still store the name with no tendencies
    }
  }

  const db = getServiceClient();
  const { error } = await db.from("referees").upsert({
    slug,
    name,
    avg_cards: profile?.avg_cards ?? null,
    penalty_tendency: profile?.penalty_tendency ?? null,
    strictness: profile?.strictness ?? null,
    summary: profile?.summary ?? null,
    source_urls: items.map((i) => i.url) as never,
    model: profile ? EXTRACTION_MODEL : null,
    fetched_at: new Date().toISOString()
  });
  if (error) throw new Error(`referees upsert failed: ${error.message}`);

  const hasProfile = Boolean(
    profile && (profile.avg_cards != null || profile.strictness || profile.penalty_tendency || profile.summary)
  );
  return { ...base, stored: true, hasProfile };
}
