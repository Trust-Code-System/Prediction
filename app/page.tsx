import Link from "next/link";
import { getReadClient } from "@/lib/supabase/read";
import { formatDayHeading, formatKickoff } from "@/lib/format";
import type { UpcomingWithPredictionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

function groupByDay(rows: UpcomingWithPredictionRow[]): Map<string, UpcomingWithPredictionRow[]> {
  const groups = new Map<string, UpcomingWithPredictionRow[]>();
  for (const row of rows) {
    const key = formatDayHeading(row.kickoff_at);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

export default async function FixturesIndexPage() {
  const db = getReadClient();
  const { data, error } = await db
    .from("upcoming_with_prediction")
    .select("*")
    .limit(200);

  const rows = (data ?? []) as UpcomingWithPredictionRow[];
  const groups = groupByDay(rows);

  return (
    <section className="py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Upcoming matches</h1>
        <p className="mt-1 text-sm text-slate-600">
          Data-driven analysis for each fixture. Tap a match to see the verdict and the numbers
          behind it.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Could not load fixtures right now. Please try again shortly.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          No upcoming fixtures in the window yet. The daily job populates these ahead of kickoff.
        </p>
      ) : (
        <div className="space-y-6">
          {Array.from(groups.entries()).map(([day, dayRows]) => (
            <div key={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {day}
              </h2>
              <ul className="space-y-2">
                {dayRows.map((row) => (
                  <li key={row.fixture_id}>
                    <Link
                      href={`/match/${row.fixture_id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-pitch-500/40 hover:bg-pitch-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {row.home_team} <span className="text-slate-400">vs</span> {row.away_team}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {row.league} | {formatKickoff(row.kickoff_at)}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          row.has_prediction
                            ? "bg-pitch-100 text-pitch-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {row.has_prediction ? "Analysis ready" : "Pending"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
