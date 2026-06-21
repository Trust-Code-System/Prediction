import type {
  FormResult,
  H2HMeeting,
  InjuryRow,
  NewsItem,
  NewsSignalPlayer,
  PlayerRow,
  PlayerToWatch,
  StandingRow,
  VenueRecord
} from "@/lib/types";

function attackingScore(p: PlayerRow): number {
  const s = p.season_stats;
  if (!s) return -1;
  return (s.goals ?? 0) * 3 + (s.assists ?? 0) * 2 + (s.minutes ?? 0) / 900;
}

/** Per-player season stats table, sorted by attacking output. */
export function SquadTable({ players }: { players: PlayerRow[] }) {
  if (players.length === 0) {
    return <p className="text-sm text-slate-500">No squad data available.</p>;
  }
  const sorted = [...players].sort((a, b) => attackingScore(b) - attackingScore(a));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-400">
            <th className="py-1 pr-2">Player</th>
            <th className="px-2 py-1 text-right">G</th>
            <th className="px-2 py-1 text-right">A</th>
            <th className="px-2 py-1 text-right">Min</th>
            <th className="px-2 py-1 text-right">Sh</th>
            <th className="px-2 py-1 text-right">Rt</th>
            <th className="px-2 py-1 text-right">Cards</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const s = p.season_stats;
            return (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-1 text-xs text-slate-400">{p.position ?? ""}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s?.goals ?? 0}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s?.assists ?? 0}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s?.minutes ?? 0}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s?.shots ?? 0}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s?.rating ?? "-"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {(s?.yellow_cards ?? 0)}y {(s?.red_cards ?? 0)}r
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const RESULT_COLOR: Record<FormResult["result"], string> = {
  W: "bg-pitch-500",
  D: "bg-slate-400",
  L: "bg-rose-500"
};

/**
 * Last-5 form as result chips. For fixtures with no season data (Gemini-sourced)
 * falls back to the news-derived form summary, clearly labelled external context.
 */
export function FormList({
  last5,
  newsSummary
}: {
  last5: FormResult[] | null;
  newsSummary?: string | null;
}) {
  if (!last5 || last5.length === 0) {
    if (newsSummary) {
      return (
        <p className="text-sm text-slate-600">
          <span className="text-xs uppercase tracking-wide text-slate-400">From recent news</span>
          <br />
          {newsSummary}
        </p>
      );
    }
    return <p className="text-sm text-slate-500">No recent form data available.</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {last5.map((r) => (
        <li key={r.fixture_id} className="flex items-center gap-2">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs font-semibold text-white ${RESULT_COLOR[r.result]}`}
          >
            {r.result}
          </span>
          <span className="tabular-nums">
            {r.goals_for}-{r.goals_against}
          </span>
          <span className="text-slate-500">
            vs {r.opponent} ({r.home_away})
          </span>
        </li>
      ))}
    </ul>
  );
}

export function H2HList({ history }: { history: H2HMeeting[] | null }) {
  if (!history || history.length === 0) {
    return <p className="text-sm text-slate-500">No head-to-head history available.</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {history.map((m) => (
        <li key={m.fixture_id} className="flex flex-wrap items-center gap-x-2">
          <span className="text-xs text-slate-400 tabular-nums">{m.date.slice(0, 10)}</span>
          <span>
            {m.home_team} <span className="font-semibold tabular-nums">{m.home_goals}-{m.away_goals}</span>{" "}
            {m.away_team}
          </span>
          {m.venue ? <span className="text-xs text-slate-400">at {m.venue}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function VenueRecordView({
  label,
  record
}: {
  label: string;
  record: VenueRecord | null;
}) {
  if (!record) {
    return <p className="text-sm text-slate-500">{label}: no record available.</p>;
  }
  return (
    <p className="text-sm">
      <span className="font-medium">{label}:</span> played {record.played}, {record.wins}W{" "}
      {record.draws}D {record.losses}L, goals {record.goals_for} for / {record.goals_against} against
    </p>
  );
}

export function InjuriesList({
  injuries,
  homeTeamId,
  homeName,
  awayName,
  newsInjuries
}: {
  injuries: InjuryRow[];
  homeTeamId: number | null;
  homeName: string;
  awayName: string;
  newsInjuries?: NewsSignalPlayer[];
}) {
  if (injuries.length === 0) {
    // No structured injury feed for Gemini fixtures; fall back to news reports.
    if (newsInjuries && newsInjuries.length > 0) {
      return (
        <ul className="space-y-1.5 text-sm">
          {newsInjuries.map((i, idx) => (
            <li key={idx}>
              <span className="text-xs text-slate-400">
                {i.team === "home" ? homeName : awayName}
              </span>{" "}
              <span className="font-medium">{i.name}</span>
              {i.note ? <span className="text-slate-500"> ({i.note})</span> : null}
              <span className="ml-1 text-xs text-slate-400">from recent news</span>
            </li>
          ))}
        </ul>
      );
    }
    return <p className="text-sm text-slate-500">None reported.</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {injuries.map((i) => (
        <li key={i.id}>
          <span className="text-xs text-slate-400">
            {i.team_id === homeTeamId ? homeName : awayName}
          </span>{" "}
          <span className="font-medium">{i.player_name ?? `Player ${i.player_id}`}</span>
          {i.reason ? <span className="text-slate-500"> ({i.reason})</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function StandingsContext({
  home,
  away,
  homeName,
  awayName
}: {
  home: StandingRow | null;
  away: StandingRow | null;
  homeName: string;
  awayName: string;
}) {
  const Row = ({ name, s }: { name: string; s: StandingRow | null }) => (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">{name}</span>
      {s ? (
        <span className="text-slate-500 tabular-nums">
          #{s.rank ?? "-"}, {s.points ?? "-"} pts, GD {s.goals_diff ?? "-"}
        </span>
      ) : (
        <span className="text-slate-400">no standings data</span>
      )}
    </div>
  );
  return (
    <div className="space-y-1.5">
      <Row name={homeName} s={home} />
      <Row name={awayName} s={away} />
    </div>
  );
}

export function NewsList({ items }: { items: NewsItem[] | null }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-slate-500">No recent news available.</p>;
  }
  return (
    <ul className="space-y-3 text-sm">
      {items.map((n, i) => (
        <li key={`${n.url}-${i}`}>
          <a
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-pitch-700 hover:underline"
          >
            {n.title}
          </a>
          <div className="mt-0.5 text-xs text-slate-400">
            {n.source ?? "source"}
            {n.published_date ? ` | ${n.published_date.slice(0, 10)}` : ""}
          </div>
          {n.content ? <p className="mt-1 text-slate-600">{n.content.slice(0, 220)}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function PlayerToWatchCard({
  ptw,
  player
}: {
  ptw: PlayerToWatch;
  player: PlayerRow | null;
}) {
  const s = player?.season_stats;
  return (
    <div className="rounded-lg border border-pitch-500/30 bg-pitch-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-pitch-700">
        Player to watch
      </div>
      <div className="mt-1 text-lg font-semibold">{ptw.name}</div>
      <p className="mt-1 text-sm text-slate-700">{ptw.reason}</p>
      {s ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 tabular-nums">
          <span>{s.goals ?? 0} goals</span>
          <span>{s.assists ?? 0} assists</span>
          <span>{s.minutes ?? 0} mins</span>
          <span>{s.shots ?? 0} shots</span>
          <span>rating {s.rating ?? "-"}</span>
        </div>
      ) : null}
    </div>
  );
}
