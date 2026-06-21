import type { FormResult, PlayerRow, StandingRow, TeamFormRow } from "@/lib/types";
import { scale } from "@/lib/ratings/scale";

/**
 * Team strength ratings, computed at read time from cached data (no schema, no
 * pipeline). Pure and side-effect free so it is testable and reusable on the
 * standalone team pages in a later slice.
 *
 * Scale is ABSOLUTE: each axis maps real per-game metrics onto 0-100 via fixed
 * bounds, so a rating means the same thing across matches. The bounds are tuned
 * to typical top-league values and clamped, so an outlier cannot blow past 100.
 *
 * Midfield has no possession or passing data behind it, so it is an openly
 * declared CONTROL PROXY: midfielders' average rating + team assists per game +
 * points per game. It is labelled as such in the UI, never as a true midfield
 * metric.
 */

export interface TeamStrength {
  attack: number;
  defense: number;
  midfield: number;
  form: number;
  overall: number;
  /** False when there is essentially nothing to rate, so the UI can hide it. */
  hasData: boolean;
}

export interface TeamStrengthInput {
  standing: StandingRow | null;
  form: TeamFormRow | null;
  players: PlayerRow[];
}

const RESULT_POINTS: Record<FormResult["result"], number> = { W: 3, D: 1, L: 0 };

/** Average goals for / against across the last-5 results, or null if none. */
function last5PerGame(last5: FormResult[] | null): { gf: number; ga: number } | null {
  if (!last5 || last5.length === 0) return null;
  const gf = last5.reduce((sum, r) => sum + r.goals_for, 0) / last5.length;
  const ga = last5.reduce((sum, r) => sum + r.goals_against, 0) / last5.length;
  return { gf, ga };
}

/** played-game denominator from standings, guarded against null/zero. */
function played(standing: StandingRow | null): number {
  const p = standing?.played ?? 0;
  return p > 0 ? p : 0;
}

function attackScore(input: TeamStrengthInput): number {
  const p = played(input.standing);
  if (p > 0 && input.standing?.goals_for != null) {
    return scale(input.standing.goals_for / p, 0.3, 2.6);
  }
  const recent = last5PerGame(input.form?.last5 ?? null);
  if (recent) return scale(recent.gf, 0.3, 2.6);
  return 0;
}

function defenseScore(input: TeamStrengthInput): number {
  const p = played(input.standing);
  if (p > 0 && input.standing?.goals_against != null) {
    return 100 - scale(input.standing.goals_against / p, 0.3, 2.2);
  }
  const recent = last5PerGame(input.form?.last5 ?? null);
  if (recent) return 100 - scale(recent.ga, 0.3, 2.2);
  return 0;
}

/** Control proxy: midfielders' rating + assists per game + points per game. */
function midfieldScore(input: TeamStrengthInput): number {
  const p = played(input.standing);

  const midfielders = input.players.filter(
    (pl) => (pl.position ?? "").toLowerCase().includes("midfield") && pl.season_stats?.rating != null
  );
  const midRatingScore =
    midfielders.length > 0
      ? scale(
          midfielders.reduce((sum, pl) => sum + (pl.season_stats?.rating ?? 0), 0) /
            midfielders.length,
          6.0,
          7.5
        )
      : null;

  const totalAssists = input.players.reduce((sum, pl) => sum + (pl.season_stats?.assists ?? 0), 0);
  const assistsPerGame = p > 0 ? totalAssists / p : null;
  const assistsScore = assistsPerGame != null ? scale(assistsPerGame, 0.3, 1.8) : null;

  const ppg = p > 0 && input.standing?.points != null ? input.standing.points / p : null;
  const ppgScore = ppg != null ? scale(ppg, 0.5, 2.5) : null;

  const parts: Array<{ value: number; weight: number }> = [];
  if (midRatingScore != null) parts.push({ value: midRatingScore, weight: 0.4 });
  if (ppgScore != null) parts.push({ value: ppgScore, weight: 0.3 });
  if (assistsScore != null) parts.push({ value: assistsScore, weight: 0.3 });
  if (parts.length === 0) return 0;

  const totalWeight = parts.reduce((sum, x) => sum + x.weight, 0);
  return parts.reduce((sum, x) => sum + x.value * x.weight, 0) / totalWeight;
}

/** Recent results weighted toward the most recent; last-5 first, standings string fallback. */
function formScore(input: TeamStrengthInput): number {
  const last5 = input.form?.last5 ?? null;
  if (last5 && last5.length > 0) {
    // Assume index 0 is the most recent; weight it heaviest.
    let weightedSum = 0;
    let weightTotal = 0;
    last5.forEach((r, i) => {
      const weight = last5.length - i;
      weightedSum += RESULT_POINTS[r.result] * weight;
      weightTotal += weight;
    });
    return weightTotal > 0 ? (weightedSum / (3 * weightTotal)) * 100 : 0;
  }

  const formStr = input.standing?.form;
  if (formStr && formStr.length > 0) {
    const chars = formStr.toUpperCase().split("").filter((c) => c === "W" || c === "D" || c === "L");
    if (chars.length > 0) {
      const sum = chars.reduce((acc, c) => acc + RESULT_POINTS[c as FormResult["result"]], 0);
      return (sum / (3 * chars.length)) * 100;
    }
  }
  return 0;
}

export function computeTeamStrength(input: TeamStrengthInput): TeamStrength {
  const hasData =
    input.standing != null ||
    (input.form?.last5?.length ?? 0) > 0 ||
    input.players.length > 0;

  const attack = attackScore(input);
  const defense = defenseScore(input);
  const midfield = midfieldScore(input);
  const form = formScore(input);
  const overall = 0.3 * attack + 0.3 * defense + 0.25 * midfield + 0.15 * form;

  return {
    attack: Math.round(attack),
    defense: Math.round(defense),
    midfield: Math.round(midfield),
    form: Math.round(form),
    overall: Math.round(overall),
    hasData
  };
}
