import Link from "next/link";
import { getAccuracySummary, marketLabel, pct, type MarketKey, type Tally } from "@/lib/accuracy/read";
import { formatMonth } from "@/lib/format";

export const dynamic = "force-dynamic";

const MARKET_ORDER: MarketKey[] = ["winner", "ou", "btts", "scoreline"];

function pctLabel(t: Tally): string {
  const p = pct(t);
  return p === null ? "-" : `${p}%`;
}

function AccuracyBar({ tally }: { tally: Tally }) {
  const p = pct(tally) ?? 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-pitch-500" style={{ width: `${p}%` }} />
    </div>
  );
}

export default async function AccuracyPage() {
  const { summary, recent } = await getAccuracySummary();

  if (summary.graded === 0) {
    return (
      <section className="py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Prediction accuracy</h1>
        <p className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          No graded matches yet. Accuracy appears here once predicted fixtures finish and are scored
          by the daily job.
        </p>
      </section>
    );
  }

  const winner = summary.byMarket.winner;

  return (
    <section className="space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prediction accuracy</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every prediction is graded against the real result after kickoff. Nothing here is
          hand-picked. {summary.graded} matches graded so far.
        </p>
      </div>

      {/* Headline */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs uppercase tracking-wide text-slate-400">Match-winner accuracy</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums">{pctLabel(winner)}</span>
          <span className="text-sm text-slate-500 tabular-nums">
            {winner.correct} of {winner.total} correct
          </span>
        </div>
      </div>

      {/* By market */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">By market</h2>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          {MARKET_ORDER.map((key) => {
            const t = summary.byMarket[key];
            return (
              <div key={key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{marketLabel(key)}</span>
                  <span className="font-semibold tabular-nums">
                    {pctLabel(t)}{" "}
                    <span className="font-normal text-slate-400">
                      ({t.correct}/{t.total})
                    </span>
                  </span>
                </div>
                <div className="mt-1">
                  <AccuracyBar tally={t} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* By league + by month */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            By league (winner)
          </h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {summary.byLeague.map((l) => (
              <li key={l.name} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="truncate text-slate-600">{l.name}</span>
                <span className="font-semibold tabular-nums">
                  {pctLabel(l.tally)}{" "}
                  <span className="font-normal text-slate-400">({l.tally.total})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            By month (winner)
          </h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {summary.byMonth.map((m) => (
              <li key={m.name} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-600">{formatMonth(m.name)}</span>
                <span className="font-semibold tabular-nums">
                  {pctLabel(m.tally)}{" "}
                  <span className="font-normal text-slate-400">({m.tally.total})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Recent graded */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Recently graded
        </h2>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {recent.map((r) => (
            <li key={r.fixture_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <Link href={`/match/${r.fixture_id}`} className="min-w-0 hover:underline">
                <div className="truncate text-sm font-medium">
                  {r.home_team ?? "Home"} <span className="tabular-nums">{r.home_goals}-{r.away_goals}</span>{" "}
                  {r.away_team ?? "Away"}
                </div>
                <div className="truncate text-xs text-slate-400">{r.league ?? ""}</div>
              </Link>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.winner_correct ? "bg-pitch-100 text-pitch-700" : "bg-rose-100 text-rose-700"
                }`}
              >
                {r.winner_correct ? "Hit" : "Miss"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-slate-400">
        Accuracy is a record of past performance and does not guarantee future results. Data-driven
        analysis, not betting advice.
      </p>
    </section>
  );
}
