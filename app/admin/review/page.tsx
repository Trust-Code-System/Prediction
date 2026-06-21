import { notFound } from "next/navigation";
import { matchesCronSecret } from "@/lib/auth/cron";
import { getServiceClient } from "@/lib/supabase/server";
import { formatKickoff } from "@/lib/format";
import { RegenerateButton } from "@/components/RegenerateButton";

/**
 * Internal review queue. Lists predictions stored with status='review' (failed
 * validation across all providers), which RLS hides from the public site, so
 * they are otherwise invisible. Reads use the service-role client to bypass RLS.
 *
 * Not in the public nav, not indexed, and gated by a ?key=<CRON_SECRET> query
 * param (a bearer header is not natural for a browser GET). A wrong or missing
 * key renders a 404 so the page's existence is not revealed.
 *
 *   /admin/review?key=<CRON_SECRET>
 */

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

interface ReviewItem {
  fixtureId: number;
  home: string;
  away: string;
  league: string;
  kickoffAt: string | null;
  reasons: string[];
  generatedAt: string;
}

async function loadReviewQueue(): Promise<ReviewItem[]> {
  const db = getServiceClient();

  const { data: reviews } = await db
    .from("predictions")
    .select("fixture_id, key_factors, generated_at")
    .eq("status", "review")
    .order("generated_at", { ascending: false });
  if (!reviews || reviews.length === 0) return [];

  const ids = reviews.map((r) => r.fixture_id);
  const { data: fixtures } = await db
    .from("fixtures")
    .select("id, home_team_id, away_team_id, league_id, kickoff_at")
    .in("id", ids);
  const fixtureById = new Map((fixtures ?? []).map((f) => [f.id, f]));

  const teamIds = [
    ...new Set(
      (fixtures ?? [])
        .flatMap((f) => [f.home_team_id, f.away_team_id])
        .filter((v): v is number => v !== null)
    )
  ];
  const leagueIds = [
    ...new Set((fixtures ?? []).map((f) => f.league_id).filter((v): v is number => v !== null))
  ];
  const [teams, leagues] = await Promise.all([
    teamIds.length ? db.from("teams").select("id, name").in("id", teamIds) : Promise.resolve({ data: [] }),
    leagueIds.length ? db.from("leagues").select("id, name").in("id", leagueIds) : Promise.resolve({ data: [] })
  ]);
  const teamName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
  const leagueName = new Map((leagues.data ?? []).map((l) => [l.id, l.name]));

  return reviews.map((r) => {
    const f = fixtureById.get(r.fixture_id);
    return {
      fixtureId: r.fixture_id,
      home: f?.home_team_id != null ? teamName.get(f.home_team_id) ?? `Team ${f.home_team_id}` : "Home",
      away: f?.away_team_id != null ? teamName.get(f.away_team_id) ?? `Team ${f.away_team_id}` : "Away",
      league: f?.league_id != null ? leagueName.get(f.league_id) ?? "Unknown league" : "Unknown league",
      kickoffAt: f?.kickoff_at ?? null,
      // Review rows store the recorded validation errors in key_factors.
      reasons: Array.isArray(r.key_factors) ? r.key_factors : [],
      generatedAt: r.generated_at
    };
  });
}

export default async function ReviewPage({
  searchParams
}: {
  searchParams: { key?: string };
}) {
  if (!matchesCronSecret(searchParams.key)) notFound();
  const secret = searchParams.key as string;

  const items = await loadReviewQueue();

  return (
    <article className="space-y-5 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Predictions that failed validation across all providers. Internal tool. Regenerate
          re-runs the prediction from cached data.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No fixtures awaiting review.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li
              key={it.fixtureId}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {it.home} <span className="text-slate-400">vs</span> {it.away}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {it.league}
                    {it.kickoffAt ? ` | ${formatKickoff(it.kickoffAt)}` : ""} | fixture {it.fixtureId}
                  </div>
                </div>
                <RegenerateButton fixtureId={it.fixtureId} secret={secret} />
              </div>

              {it.reasons.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-slate-600">
                  {it.reasons.map((reason, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-rose-500">-</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
