import "server-only";
import type { MatchView } from "@/lib/data/match";
import type {
  GoalsMarket,
  H2HMeeting,
  NewsItem,
  PredictionRow,
  StandingRow,
  VenueRecord
} from "@/lib/types";
import { formatKickoff, leadingOutcome, leanLabel } from "@/lib/format";
import { formatKeyPlayers, formText, rankKeyPlayers } from "@/lib/prediction/payload";
import { formatRefereeContext } from "@/lib/ingest/referee";

/**
 * Builds the grounded MATCH CONTEXT block for the AI analyst chat from the cached
 * read-layer MatchView. This is the chat's safety boundary: the model is told to
 * answer ONLY from this text, so every fact it can use must appear here, and
 * missing data must be visibly absent (so it says "not available" rather than
 * guessing). No API-Football calls, no service-role data; the view already comes
 * from the anon, RLS-bound read client, so it carries only published predictions
 * and public supporting data.
 *
 * The form and key-player formatters are reused from the prediction payload so the
 * chat and the prediction reason over identically shaped data.
 */

function formatVerdict(
  p: PredictionRow,
  homeName: string,
  awayName: string
): string {
  const probs = p.outcome_probs;
  const lean = leanLabel(leadingOutcome(probs), homeName, awayName);
  const lines: string[] = [
    `Lean: ${lean}`,
    `Win probabilities: ${homeName} ${probs.home_win}%, draw ${probs.draw}%, ${awayName} ${probs.away_win}%`
  ];
  if (p.scoreline_lean) lines.push(`Scoreline lean: ${p.scoreline_lean}`);
  if (p.confidence) lines.push(`Confidence: ${p.confidence}`);
  if (p.risk_level) lines.push(`Risk level: ${p.risk_level}`);
  if (p.goals_market) lines.push(formatGoalsMarket(p.goals_market));
  if (p.best_angle) {
    lines.push(`Best angle: ${p.best_angle.label} (${p.best_angle.reason})`);
  }
  if (p.player_to_watch) {
    const ptw = p.player_to_watch;
    lines.push(`Player to watch: ${ptw.name} (${ptw.reason})`);
  }
  if (p.key_factors && p.key_factors.length > 0) {
    lines.push(`Key factors: ${p.key_factors.join("; ")}`);
  }
  if (p.what_could_change && p.what_could_change.length > 0) {
    lines.push(`What could change this: ${p.what_could_change.join("; ")}`);
  }
  if (p.rationale) lines.push(`Rationale: ${p.rationale}`);
  return lines.join("\n");
}

function formatGoalsMarket(gm: GoalsMarket): string {
  const btts = gm.both_teams_to_score;
  const ou = gm.over_under_2_5;
  return (
    `Goals markets: both teams to score ${btts.pick} (${btts.probability}%), ` +
    `over/under 2.5 ${ou.pick} (${ou.probability}%)`
  );
}

function formatH2H(history: H2HMeeting[] | null): string {
  if (!history || history.length === 0) return "No head-to-head history available.";
  return history
    .map((m) => {
      const date = m.date.slice(0, 10);
      const venue = m.venue ? ` @ ${m.venue}` : "";
      return `${date}: ${m.home_team} ${m.home_goals}-${m.away_goals} ${m.away_team}${venue}`;
    })
    .join("\n");
}

function formatVenueRecord(record: VenueRecord | null): string {
  if (!record) return "No venue record available.";
  return (
    `played ${record.played}, W ${record.wins} D ${record.draws} L ${record.losses}, ` +
    `goals for ${record.goals_for} against ${record.goals_against}`
  );
}

function formatStanding(s: StandingRow | null): string {
  if (!s) return "No standings data available.";
  return (
    `position ${s.rank ?? "n/a"}, ${s.points ?? "n/a"} pts, played ${s.played ?? "n/a"}, ` +
    `W ${s.win ?? "n/a"} D ${s.draw ?? "n/a"} L ${s.lose ?? "n/a"}, ` +
    `GF ${s.goals_for ?? "n/a"} GA ${s.goals_against ?? "n/a"}, GD ${s.goals_diff ?? "n/a"}` +
    (s.form ? `, recent form ${s.form}` : "")
  );
}

function formatNews(items: NewsItem[] | null): string {
  if (!items || items.length === 0) return "No recent news available.";
  return items
    .map((n) => {
      const date = n.published_date ? `${n.published_date.slice(0, 10)} ` : "";
      const src = n.source ? ` (${n.source})` : "";
      const snippet = n.content ? `: ${n.content.slice(0, 200)}` : "";
      return `- ${date}${n.title}${src}${snippet}`;
    })
    .join("\n");
}

export function buildMatchContext(view: MatchView): string {
  const homeName = view.homeTeam?.name ?? "Home";
  const awayName = view.awayTeam?.name ?? "Away";
  const leagueName = view.league?.name ?? "Unknown league";
  const venueName = view.venue?.name ?? "Unknown venue";

  const homeKey = rankKeyPlayers(view.homePlayers);
  const awayKey = rankKeyPlayers(view.awayPlayers);

  const injuryLines =
    view.injuries.length > 0
      ? view.injuries
          .map((i) => {
            const team = i.team_id === view.fixture.home_team_id ? homeName : awayName;
            return `${team}: ${i.player_name ?? `player ${i.player_id}`} (${i.reason ?? "unspecified"})`;
          })
          .join("\n")
      : "None reported.";

  const verdict =
    view.prediction && view.prediction.status === "published"
      ? formatVerdict(view.prediction, homeName, awayName)
      : "No published prediction is available for this match.";

  return `MATCH CONTEXT

FIXTURE:
${homeName} (home) vs ${awayName} (away)
Competition: ${leagueName}
Kickoff: ${formatKickoff(view.fixture.kickoff_at)}
Venue: ${venueName}

PUBLISHED PREDICTION:
${verdict}

STANDINGS:
${homeName}: ${formatStanding(view.homeStanding)}
${awayName}: ${formatStanding(view.awayStanding)}

LAST 5 FORM - ${homeName}:
${formText(view.homeForm?.last5 ?? null, view.news?.signals?.home_form_summary ?? null)}

LAST 5 FORM - ${awayName}:
${formText(view.awayForm?.last5 ?? null, view.news?.signals?.away_form_summary ?? null)}

HEAD TO HEAD (most recent first):
${formatH2H(view.h2h?.history ?? null)}

VENUE RECORD:
${homeName} at ${venueName}: ${formatVenueRecord(view.homeVenueRecord?.record ?? null)}
${awayName} away record: ${formatVenueRecord(view.awayVenueRecord?.record ?? null)}

KEY PLAYERS - ${homeName}:
${formatKeyPlayers(homeKey)}

KEY PLAYERS - ${awayName}:
${formatKeyPlayers(awayKey)}

INJURIES / UNAVAILABLE:
${injuryLines}

MATCH OFFICIAL (assignment from data; tendencies web-derived, soft context):
${formatRefereeContext(view.refereeName, view.referee)}

RECENT NEWS (external web reports, soft supporting context only):
${formatNews(view.news?.items ?? null)}`;
}
