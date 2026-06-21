import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { refreshSingleFixtureData } from "@/lib/ingest/run";
import { predictFixture } from "@/lib/prediction/generate";

/**
 * Manual single-fixture refresh, CRON_SECRET protected. Re-ingests this
 * fixture's supporting data (unless ?skipIngest=1) then regenerates and stores
 * its prediction. Use to fix up a fixture flagged for review.
 *
 *   POST /api/refresh/<fixtureId>
 *   Authorization: Bearer <CRON_SECRET>
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: { fixtureId: string } }
) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const fixtureId = Number.parseInt(params.fixtureId, 10);
  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "invalid fixtureId" }, { status: 400 });
  }

  const skipIngest = new URL(req.url).searchParams.get("skipIngest") === "1";

  try {
    if (!skipIngest) {
      await refreshSingleFixtureData(fixtureId);
    }
    const outcome = await predictFixture(fixtureId);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    return NextResponse.json(
      { ok: false, fixtureId, error: (err as Error).message },
      { status: 500 }
    );
  }
}
