import { riskMeta } from "@/lib/format";
import { computePlayerImpact } from "@/lib/ratings/player";
import type { TeamStrength } from "@/lib/ratings/team";
import type {
  BestAngle,
  FormResult,
  GoalsMarket,
  H2HMeeting,
  InjuryRow,
  NewsItem,
  NewsSignalPlayer,
  PlayerRow,
  PlayerToWatch,
  RefereeRow,
  RiskLevel,
  StandingRow,
  TacticalRow,
  TacticalTeam,
  VenueRecord
} from "@/lib/types";

/** Per-player season stats table, sorted by impact rating (highest first). */
export function SquadTable({ players }: { players: PlayerRow[] }) {
  if (players.length === 0) {
    return <p className="text-sm text-slate-500">No squad data available.</p>;
  }
  const scored = players
    .map((p) => ({ player: p, impact: computePlayerImpact(p).score }))
    .sort((a, b) => b.impact - a.impact);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-400">
            <th className="py-1 pr-2">Player</th>
            <th className="px-2 py-1 text-right">Impact</th>
            <th className="px-2 py-1 text-right">G</th>
            <th className="px-2 py-1 text-right">A</th>
            <th className="px-2 py-1 text-right">Min</th>
            <th className="px-2 py-1 text-right">Sh</th>
            <th className="px-2 py-1 text-right">Rt</th>
            <th className="px-2 py-1 text-right">Cards</th>
          </tr>
        </thead>
        <tbody>
          {scored.map(({ player: p, impact }) => {
            const s = p.season_stats;
            return (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-1 text-xs text-slate-400">{p.position ?? ""}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="inline-block rounded bg-pitch-50 px-1.5 py-0.5 text-xs font-semibold text-pitch-700 tabular-nums">
                    {impact}
                  </span>
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

/**
 * Side-by-side team strength comparison across five axes (0-100). Midfield is a
 * declared control proxy, not a true midfield metric, since we have no possession
 * or passing data. Renders nothing when neither side has data to rate.
 */
export function TeamStrengthComparison({
  home,
  away,
  homeName,
  awayName
}: {
  home: TeamStrength;
  away: TeamStrength;
  homeName: string;
  awayName: string;
}) {
  if (!home.hasData && !away.hasData) return null;

  const axes: Array<{ label: string; key: keyof Omit<TeamStrength, "hasData"> }> = [
    { label: "Overall", key: "overall" },
    { label: "Attack", key: "attack" },
    { label: "Defense", key: "defense" },
    { label: "Midfield", key: "midfield" },
    { label: "Form", key: "form" }
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Team strength</h2>
        <span className="text-xs text-slate-400">Rated 0 to 100 from cached data</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm font-medium">
        <span className="text-pitch-700">{homeName}</span>
        <span className="text-slate-500">{awayName}</span>
      </div>

      <div className="mt-3 space-y-3">
        {axes.map(({ label, key }) => {
          const h = home[key];
          const a = away[key];
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold tabular-nums text-slate-700">{h}</span>
                <span className="uppercase tracking-wide">{label}</span>
                <span className="font-semibold tabular-nums text-slate-700">{a}</span>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <div className="flex h-2 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-pitch-500" style={{ width: `${h}%` }} />
                </div>
                <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-400" style={{ width: `${a}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Midfield is a control proxy from squad ratings, assists, and points per game, not a
        possession metric.
      </p>
    </section>
  );
}

/** One side's tactical column: formation badge, style, strengths, weaknesses. */
function TacticalColumn({ name, team }: { name: string; team: TacticalTeam }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{name}</span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-sm font-semibold tabular-nums">
          {team.formation}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-700">{team.style}</p>
      {team.strengths.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-pitch-700">Strengths</div>
          <ul className="mt-1 space-y-1 text-sm text-slate-600">
            {team.strengths.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-pitch-600">+</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {team.weaknesses.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-600">Weaknesses</div>
          <ul className="mt-1 space-y-1 text-sm text-slate-600">
            {team.weaknesses.map((w, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-rose-500">-</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TacticalPointList({ title, items }: { title: string; items: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <ul className="mt-1 space-y-1 text-sm text-slate-600">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-slate-400">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Tactical matchup: likely formation, style, strengths and weaknesses per side,
 * then the matchup-level dangerous areas, key battles, and a summary. Inferred
 * from the data, not a confirmed lineup, so it is captioned as a likely read.
 * Renders nothing when there is no stored tactical analysis.
 */
export function TacticalComparison({
  tactical,
  homeName,
  awayName
}: {
  tactical: TacticalRow | null;
  homeName: string;
  awayName: string;
}) {
  if (!tactical) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Tactical comparison</h2>
        <span className="text-xs text-slate-400">Likely setup, inferred from the data</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TacticalColumn name={homeName} team={tactical.home} />
        <TacticalColumn name={awayName} team={tactical.away} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TacticalPointList title="Dangerous areas" items={tactical.dangerous_areas} />
        <TacticalPointList title="Key battles" items={tactical.key_battles} />
      </div>

      {tactical.summary ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-700">{tactical.summary}</p>
      ) : null}
    </section>
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

/**
 * Match official: the referee assignment (from API-Football) plus any web-derived
 * tendencies, clearly labelled. Shows the name with "limited data" when there is
 * no profile, and renders nothing when no referee is assigned.
 */
export function MatchOfficial({
  name,
  profile
}: {
  name: string | null;
  profile: RefereeRow | null;
}) {
  if (!name) return null;
  const hasTendencies = Boolean(
    profile && (profile.avg_cards != null || profile.strictness || profile.penalty_tendency || profile.summary)
  );
  return (
    <div className="space-y-2 text-sm">
      <div>
        <span className="font-medium">{name}</span>
        {profile?.strictness ? (
          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">
            {profile.strictness}
          </span>
        ) : null}
      </div>

      {hasTendencies ? (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600 tabular-nums">
            {profile?.avg_cards != null ? <span>{profile.avg_cards} cards per game</span> : null}
            {profile?.penalty_tendency ? (
              <span className="tabular-nums">penalties: {profile.penalty_tendency}</span>
            ) : null}
          </div>
          {profile?.summary ? <p className="text-slate-600">{profile.summary}</p> : null}
          <p className="text-xs text-slate-400">
            Tendencies from web reports, treated as soft context.
          </p>
          {profile?.source_urls && profile.source_urls.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {profile.source_urls.slice(0, 4).map((url, i) => {
                let host = "source";
                try {
                  host = new URL(url).hostname.replace(/^www\./, "");
                } catch {
                  host = "source";
                }
                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-pitch-700 hover:underline"
                  >
                    {host}
                  </a>
                );
              })}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-slate-400">Limited official data available.</p>
      )}
    </div>
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

/**
 * The single strongest call for the match, highlighted above the supporting
 * detail. May differ from the match-winner lean when goals are more predictable.
 */
export function BestAngleBanner({ angle }: { angle: BestAngle }) {
  return (
    <div className="rounded-lg border border-pitch-500/30 bg-gradient-to-br from-pitch-50 to-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-pitch-700">Best angle</div>
      <div className="mt-1 text-lg font-semibold">{angle.label}</div>
      <p className="mt-1 text-sm text-slate-700">{angle.reason}</p>
    </div>
  );
}

function MarketRow({
  label,
  pick,
  probability
}: {
  label: string;
  pick: string;
  probability: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold capitalize">
          {pick} <span className="text-slate-400 tabular-nums">{probability}%</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-pitch-500" style={{ width: `${probability}%` }} />
      </div>
    </div>
  );
}

/** Goals markets: both teams to score and over/under 2.5. */
export function GoalsMarketCard({ market }: { market: GoalsMarket }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Goals outlook</div>
      <div className="mt-3 space-y-3">
        <MarketRow
          label="Both teams to score"
          pick={market.both_teams_to_score.pick}
          probability={market.both_teams_to_score.probability}
        />
        <MarketRow
          label="Total goals"
          pick={`${market.over_under_2_5.pick} 2.5`}
          probability={market.over_under_2_5.probability}
        />
      </div>
    </div>
  );
}

/** Four-step risk meter, distinct from confidence: how volatile the match is. */
export function RiskMeter({ level }: { level: RiskLevel }) {
  const meta = riskMeta(level);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-slate-400">Risk</span>
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1.5 w-5 rounded-full ${step <= meta.steps ? meta.fill : "bg-slate-200"}`}
          />
        ))}
      </div>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}>{meta.label}</span>
    </div>
  );
}

/** Concrete things that would shift the verdict, so the read stays honest. */
export function WhatCouldChangeList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        What could change this
      </div>
      <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-slate-400">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
