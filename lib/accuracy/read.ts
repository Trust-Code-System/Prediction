import { getReadClient } from "@/lib/supabase/read";
import type { PredictionResultEnrichedRow } from "@/lib/types";

/**
 * Read + aggregate graded predictions for the accuracy page. The pure
 * `summarizeResults` is unit-testable; `getAccuracySummary` fetches the rows.
 */

export type MarketKey = "winner" | "btts" | "ou" | "scoreline";

export interface Tally {
  correct: number;
  total: number;
}

export interface NamedTally {
  name: string;
  tally: Tally;
}

export interface AccuracySummary {
  graded: number;
  byMarket: Record<MarketKey, Tally>;
  byLeague: NamedTally[]; // winner accuracy per league, most-graded first
  byMonth: NamedTally[]; // winner accuracy per month, newest first
}

/** Percentage 0-100, or null when nothing has been graded for that market. */
export function pct(t: Tally): number | null {
  return t.total > 0 ? Math.round((t.correct / t.total) * 100) : null;
}

const MARKET_LABELS: Record<MarketKey, string> = {
  winner: "Match winner",
  btts: "Both teams to score",
  ou: "Over/Under 2.5",
  scoreline: "Exact scoreline"
};

export function marketLabel(key: MarketKey): string {
  return MARKET_LABELS[key];
}

function emptyTally(): Tally {
  return { correct: 0, total: 0 };
}

function bump(t: Tally, correct: boolean): void {
  t.total += 1;
  if (correct) t.correct += 1;
}

/** Month key like "2026-06" -> sortable; rendered separately. */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function summarizeResults(rows: PredictionResultEnrichedRow[]): AccuracySummary {
  const byMarket: Record<MarketKey, Tally> = {
    winner: emptyTally(),
    btts: emptyTally(),
    ou: emptyTally(),
    scoreline: emptyTally()
  };
  const leagues = new Map<string, Tally>();
  const months = new Map<string, Tally>();

  for (const r of rows) {
    bump(byMarket.winner, r.winner_correct);
    bump(byMarket.scoreline, r.scoreline_correct);
    // Goals markets only count rows that actually carried a pick.
    if (r.btts_correct !== null) bump(byMarket.btts, r.btts_correct);
    if (r.ou_correct !== null) bump(byMarket.ou, r.ou_correct);

    const leagueName = r.league ?? "Other";
    const lt = leagues.get(leagueName) ?? emptyTally();
    bump(lt, r.winner_correct);
    leagues.set(leagueName, lt);

    const mk = monthKey(r.kickoff_at);
    const mt = months.get(mk) ?? emptyTally();
    bump(mt, r.winner_correct);
    months.set(mk, mt);
  }

  const byLeague: NamedTally[] = [...leagues.entries()]
    .map(([name, tally]) => ({ name, tally }))
    .sort((a, b) => b.tally.total - a.tally.total);

  const byMonth: NamedTally[] = [...months.entries()]
    .map(([name, tally]) => ({ name, tally }))
    .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first

  return { graded: rows.length, byMarket, byLeague, byMonth };
}

export async function getAccuracySummary(): Promise<{
  summary: AccuracySummary;
  recent: PredictionResultEnrichedRow[];
}> {
  const db = getReadClient();
  const { data } = await db
    .from("prediction_results_enriched")
    .select("*")
    .order("kickoff_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as PredictionResultEnrichedRow[];
  return { summary: summarizeResults(rows), recent: rows.slice(0, 20) };
}

/** Headline number for the homepage trust badge: overall match-winner accuracy. */
export async function getHeadlineAccuracy(): Promise<{ pct: number | null; graded: number }> {
  const db = getReadClient();
  const { data } = await db
    .from("prediction_results_enriched")
    .select("winner_correct")
    .limit(2000);
  const rows = (data ?? []) as Array<{ winner_correct: boolean }>;
  const tally = emptyTally();
  for (const r of rows) bump(tally, r.winner_correct);
  return { pct: pct(tally), graded: tally.total };
}
