import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { applyCleanup, planCleanup, type CleanupScope } from "@/lib/maintenance/cleanup";

/**
 * Stale-data cleanup, CRON_SECRET protected. DRY RUN BY DEFAULT: it reports the
 * counts that would be removed and deletes nothing. Pass apply=1 to actually
 * delete. See lib/maintenance/cleanup.ts for the rules and FK-safe order.
 *
 *   GET /api/cron/cleanup                       dry run, synthetic scope, 3 days
 *   GET /api/cron/cleanup?days=7                older retention window
 *   GET /api/cron/cleanup?scope=all             include real past fixtures
 *   GET /api/cron/cleanup?apply=1               PERFORM the deletes
 *   Authorization: Bearer <CRON_SECRET>
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_DAYS = 3;

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const days = Number.parseInt(params.get("days") ?? "", 10);
  const retentionDays = Number.isFinite(days) && days >= 0 ? days : DEFAULT_DAYS;
  const scope: CleanupScope = params.get("scope") === "all" ? "all" : "synthetic";
  const apply = params.get("apply") === "1";

  try {
    const report = apply
      ? await applyCleanup(retentionDays, scope)
      : await planCleanup(retentionDays, scope);
    return NextResponse.json({ ok: true, applied: apply, report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
