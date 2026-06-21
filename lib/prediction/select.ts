import "server-only";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * Returns fixture ids in the next `hours` window that lack a FRESH published
 * prediction. Fresh = status 'published' and generated within `freshnessHours`.
 * Missing, 'review', 'failed', or stale predictions are all re-queued.
 */
export async function fixturesNeedingPrediction(
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

  const { data: preds, error: pErr } = await db
    .from("predictions")
    .select("fixture_id, status, generated_at")
    .in("fixture_id", ids);
  if (pErr) throw new Error(`prediction select failed: ${pErr.message}`);

  const freshCutoff = now.getTime() - freshnessHours * 60 * 60 * 1000;
  const fresh = new Set<number>();
  for (const p of preds ?? []) {
    const generatedAt = p.generated_at ? new Date(p.generated_at).getTime() : 0;
    if (p.status === "published" && generatedAt >= freshCutoff) {
      fresh.add(p.fixture_id);
    }
  }

  return ids.filter((id) => !fresh.has(id));
}
