import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runDemoIngest } from "@/lib/ingest/demo";
import { predictFixture } from "@/lib/prediction/generate";

/**
 * Demo seed route, CRON_SECRET protected. Runs the full pipeline against a real
 * historical Premier League matchday so the system can be seen working on the
 * free API-Football plan (which has no current-season fixtures). Ingests the
 * data, shifts the fixtures' kickoff into the near future, then generates and
 * stores predictions.
 *
 *   POST /api/demo/seed   Authorization: Bearer <CRON_SECRET>
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ingest = await runDemoIngest();
  const predictions = { published: 0, review: 0, total: ingest.fixtures.length };
  const results: Array<{ fixtureId: number; status: string; errors: string[] }> = [];

  for (const f of ingest.fixtures) {
    try {
      const outcome = await predictFixture(f.id);
      if (outcome.status === "published") predictions.published++;
      else predictions.review++;
      results.push({ fixtureId: f.id, status: outcome.status, errors: outcome.errors });
    } catch (err) {
      predictions.review++;
      results.push({ fixtureId: f.id, status: "error", errors: [(err as Error).message] });
    }
  }

  return NextResponse.json({ ok: true, ingest, predictions, results });
}
