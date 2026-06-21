import "server-only";
import { QuotaExceededError } from "@/lib/apiFootball/client";
import { fetchFixtureResult } from "@/lib/ingest/match-data";
import { getServiceClient } from "@/lib/supabase/server";
import { gradePrediction } from "@/lib/accuracy/grade";
import type { PredictionRow } from "@/lib/types";

/**
 * Grades finished matches that have a published prediction but no result row yet.
 *
 * A fixture is a candidate when its kickoff is in the past and it is still
 * marked 'scheduled' (we flip it to 'finished' once graded, so each match is
 * fetched from the API at most once). One API call per fixture, so we cap the
 * batch and stop cleanly if the quota guard trips.
 */

export interface GradeSummary {
  candidates: number;
  graded: number;
  notFinished: number;
  skippedNoScore: number;
  stoppedEarly: boolean;
  errors: string[];
}

const MAX_PER_RUN = 50;

export async function gradeFinishedFixtures(): Promise<GradeSummary> {
  const db = getServiceClient();
  const summary: GradeSummary = {
    candidates: 0,
    graded: 0,
    notFinished: 0,
    skippedNoScore: 0,
    stoppedEarly: false,
    errors: []
  };

  const nowISO = new Date().toISOString();

  // Past, not-yet-graded fixtures (still 'scheduled' means we have not flipped
  // them to 'finished' yet).
  const { data: pastFixtures, error: fxErr } = await db
    .from("fixtures")
    .select("id")
    .eq("status", "scheduled")
    .lt("kickoff_at", nowISO)
    .order("kickoff_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (fxErr) throw new Error(`grade fixture select failed: ${fxErr.message}`);

  const ids = (pastFixtures ?? []).map((f) => f.id);
  if (ids.length === 0) return summary;

  // Only those with a published prediction are gradable.
  const { data: preds, error: pErr } = await db
    .from("predictions")
    .select("*")
    .in("fixture_id", ids)
    .eq("status", "published");
  if (pErr) throw new Error(`grade prediction select failed: ${pErr.message}`);

  const predById = new Map<number, PredictionRow>();
  for (const p of (preds ?? []) as PredictionRow[]) predById.set(p.fixture_id, p);

  const gradable = ids.filter((id) => predById.has(id));
  summary.candidates = gradable.length;

  for (const fixtureId of gradable) {
    let result;
    try {
      result = await fetchFixtureResult(fixtureId);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        summary.stoppedEarly = true;
        summary.errors.push(err.message);
        break;
      }
      summary.errors.push(`fixture ${fixtureId}: ${(err as Error).message}`);
      continue;
    }

    if (!result || !result.finished) {
      summary.notFinished++;
      continue;
    }
    if (result.homeGoals === null || result.awayGoals === null) {
      summary.skippedNoScore++;
      continue;
    }

    const prediction = predById.get(fixtureId)!;
    const graded = gradePrediction(fixtureId, prediction, result.homeGoals, result.awayGoals);

    try {
      const { error: resErr } = await db
        .from("prediction_results")
        .upsert({ ...graded, graded_at: new Date().toISOString() });
      if (resErr) throw new Error(resErr.message);

      const { error: updErr } = await db
        .from("fixtures")
        .update({
          status: "finished",
          home_goals: result.homeGoals,
          away_goals: result.awayGoals,
          finished_at: new Date().toISOString()
        })
        .eq("id", fixtureId);
      if (updErr) throw new Error(updErr.message);

      summary.graded++;
    } catch (err) {
      summary.errors.push(`fixture ${fixtureId} store: ${(err as Error).message}`);
    }
  }

  return summary;
}
