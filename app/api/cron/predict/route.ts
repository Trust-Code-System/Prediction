import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { UPCOMING_WINDOW_HOURS } from "@/lib/config/leagues";
import { refreshUpcomingWindow } from "@/lib/ingest/run";
import { fixturesNeedingPrediction } from "@/lib/prediction/select";
import { predictFixture } from "@/lib/prediction/generate";
import { gradeFinishedFixtures } from "@/lib/accuracy/run";

/**
 * Daily cron job. Vercel Cron hits this with the CRON_SECRET bearer token.
 *
 *  Step 1: refresh fixtures + supporting data for the next 48h.
 *  Step 2: for each fixture without a fresh prediction, assemble payload,
 *          call Claude, validate, and store (published or review).
 *  Step 3: grade any matches that have finished since the last run.
 *  Step 4: return a summary; review/failures are logged server-side.
 *
 * Predictions run sequentially to stay within Anthropic and API quotas.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds (requires Vercel Pro; lower on hobby)

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();

  // Step 1: ingest.
  const ingest = await refreshUpcomingWindow();

  // Step 2: predictions for fixtures lacking a fresh one.
  const fixtureIds = await fixturesNeedingPrediction(UPCOMING_WINDOW_HOURS);
  const predictions = { published: 0, review: 0, total: fixtureIds.length };
  const failures: Array<{ fixtureId: number; errors: string[] }> = [];

  for (const fixtureId of fixtureIds) {
    try {
      const outcome = await predictFixture(fixtureId);
      if (outcome.status === "published") predictions.published++;
      else {
        predictions.review++;
        failures.push({ fixtureId, errors: outcome.errors });
      }
    } catch (err) {
      predictions.review++;
      failures.push({ fixtureId, errors: [(err as Error).message] });
    }
  }

  // Step 3: grade matches that have finished since the last run.
  let grading;
  try {
    grading = await gradeFinishedFixtures();
  } catch (err) {
    grading = { error: (err as Error).message };
  }

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    ingest,
    predictions,
    grading,
    failures
  });
}
