import "server-only";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * Returns fixture ids in the next `hours` window that lack a FRESH tactical
 * analysis (generated within `freshnessHours`). The tactical twin of
 * fixturesNeedingPrediction. Missing or stale rows are re-queued.
 */
export async function fixturesNeedingTactical(
  hours: number,
  freshnessHours = 24
): Promise<number[]> {
  const db = getServiceClient();
  const now = new Date();
  const to = new Date(now.getTime() + hours * 60 * 60 * 1000);

  const { data: fixtures, error } = await db
    .from("fixtures")
    .select("id")
    .gte("kickoff_at", now.toISOString())
    .lte("kickoff_at", to.toISOString())
    .eq("status", "scheduled");
  if (error) throw new Error(`fixture select failed: ${error.message}`);

  const ids = (fixtures ?? []).map((f) => f.id);
  if (ids.length === 0) return [];

  const { data: rows, error: tErr } = await db
    .from("tactical_analysis")
    .select("fixture_id, generated_at")
    .in("fixture_id", ids);
  if (tErr) throw new Error(`tactical select failed: ${tErr.message}`);

  const freshCutoff = now.getTime() - freshnessHours * 60 * 60 * 1000;
  const fresh = new Set<number>();
  for (const r of rows ?? []) {
    const generatedAt = r.generated_at ? new Date(r.generated_at).getTime() : 0;
    if (generatedAt >= freshCutoff) fresh.add(r.fixture_id);
  }

  return ids.filter((id) => !fresh.has(id));
}
