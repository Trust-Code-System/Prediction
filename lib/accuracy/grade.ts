import { leadingOutcome } from "@/lib/format";
import type { OutcomeKey, PredictionRow, PredictionResultRow } from "@/lib/types";

/**
 * Pure grading logic for the accuracy tracker. No IO so it is unit-testable.
 *
 * Grades a finished match against the prediction that was published before it.
 * Markets that the prediction did not carry (older predictions have no
 * goals_market) are graded as null, not wrong, so they do not skew accuracy.
 */

/** The real result of a finished match from its final score. */
export function actualOutcome(homeGoals: number, awayGoals: number): OutcomeKey {
  if (homeGoals > awayGoals) return "home_win";
  if (homeGoals < awayGoals) return "away_win";
  return "draw";
}

/** The fields of a prediction the grader needs. */
export type GradablePrediction = Pick<
  PredictionRow,
  "outcome_probs" | "scoreline_lean" | "goals_market" | "confidence" | "model"
>;

/** The graded row, minus the server-set graded_at timestamp. */
export type GradedResult = Omit<PredictionResultRow, "graded_at">;

export function gradePrediction(
  fixtureId: number,
  prediction: GradablePrediction,
  homeGoals: number,
  awayGoals: number
): GradedResult {
  const predicted = leadingOutcome(prediction.outcome_probs);
  const actual = actualOutcome(homeGoals, awayGoals);

  // Goals markets: only graded when the prediction actually carried a pick.
  const gm = prediction.goals_market;
  const bothScored = homeGoals > 0 && awayGoals > 0;
  const totalGoals = homeGoals + awayGoals;
  const wasOver = totalGoals >= 3; // over/under 2.5

  const bttsPick = gm?.both_teams_to_score.pick ?? null;
  const bttsCorrect =
    bttsPick === null ? null : bttsPick === (bothScored ? "yes" : "no");

  const ouPick = gm?.over_under_2_5.pick ?? null;
  const ouCorrect =
    ouPick === null ? null : ouPick === (wasOver ? "over" : "under");

  const scorelineLean = prediction.scoreline_lean ?? null;
  const scorelineCorrect = scorelineLean === `${homeGoals}-${awayGoals}`;

  return {
    fixture_id: fixtureId,
    home_goals: homeGoals,
    away_goals: awayGoals,
    predicted_outcome: predicted,
    actual_outcome: actual,
    winner_correct: predicted === actual,
    btts_pick: bttsPick,
    btts_correct: bttsCorrect,
    ou_pick: ouPick,
    ou_correct: ouCorrect,
    scoreline_lean: scorelineLean,
    scoreline_correct: scorelineCorrect,
    confidence: prediction.confidence,
    model: prediction.model
  };
}
