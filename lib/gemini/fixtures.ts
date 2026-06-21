import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { serverEnv } from "@/lib/env";

/**
 * Uses Gemini as an alternative source of UPCOMING fixtures. The free
 * API-Football plan only exposes historical seasons, so when there are no
 * current-season fixtures this fetches real upcoming matches via Gemini (with
 * Google Search grounding when the model supports it) and returns them in a
 * normalized shape for ingest.
 *
 * Output is treated as untrusted: it is parsed, validated, and date-filtered
 * before anything is written to the database.
 */

const GEMINI_MODEL = "gemini-2.5-flash";

export interface GeminiFixture {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string | null;
  kickoffAt: string; // ISO 8601 UTC
  venue: string | null;
}

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!client) client = new GoogleGenerativeAI(serverEnv.geminiApiKey);
  return client;
}

function stripFences(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```$/, "");
  return t.trim();
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function normalize(raw: unknown, from: number, to: number): GeminiFixture[] {
  if (!Array.isArray(raw)) return [];
  const out: GeminiFixture[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (!isNonEmptyString(o.homeTeam) || !isNonEmptyString(o.awayTeam)) continue;
    if (!isNonEmptyString(o.league) || !isNonEmptyString(o.kickoffAt)) continue;
    const ts = new Date(o.kickoffAt).getTime();
    if (!Number.isFinite(ts) || ts < from || ts > to) continue;
    out.push({
      homeTeam: o.homeTeam.trim(),
      awayTeam: o.awayTeam.trim(),
      league: o.league.trim(),
      country: isNonEmptyString(o.country) ? o.country.trim() : null,
      kickoffAt: new Date(ts).toISOString(),
      venue: isNonEmptyString(o.venue) ? o.venue.trim() : null
    });
  }
  return out;
}

export async function fetchUpcomingFixturesViaGemini(hours = 48): Promise<GeminiFixture[]> {
  const now = Date.now();
  const to = now + hours * 60 * 60 * 1000;
  const nowIso = new Date(now).toISOString();

  const modelParams = {
    model: GEMINI_MODEL,
    // Google Search grounding so the model returns real scheduled fixtures
    // rather than guessing from training data.
    tools: [{ googleSearch: {} }]
  };
  const model = getClient().getGenerativeModel(
    modelParams as Parameters<GoogleGenerativeAI["getGenerativeModel"]>[0]
  );

  const prompt = `List real association football (soccer) matches scheduled to kick off within the next ${hours} hours, starting from ${nowIso} (UTC).

Return ONLY a JSON array. Each element must be:
{"homeTeam": string, "awayTeam": string, "league": string, "country": string, "kickoffAt": ISO8601 UTC datetime, "venue": string}

Rules:
- Only include matches you are confident are really scheduled in that window.
- kickoffAt must be a precise ISO8601 UTC timestamp.
- If you are unsure, return fewer matches rather than inventing any.
- No commentary, no markdown fences, just the JSON array.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return [];
  }
  return normalize(parsed, now, to);
}
