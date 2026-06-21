import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { stableId } from "@/lib/ingest/gemini";
import { formatRefereeContext, refereeSlug } from "@/lib/ingest/referee";
import type {
  FormResult,
  H2HMeeting,
  NewsItem,
  NewsSignals,
  PlayerRow,
  PlayerSeasonStats,
  VenueRecord
} from "@/lib/types";

/**
 * Assembles the per-fixture prediction payload from CACHED Supabase data only.
 * No API-Football calls happen here. Produces:
 *  - `userMessage`: the filled USER MESSAGE TEMPLATE from prompts/prediction.md,
 *    in the exact shape the prompt expects.
 *  - `validPlayerIds`: every player id that appears in the payload, used by the
 *    validator to confirm player_to_watch.player_id is real.
 *  - `meta`: a few fields the pipeline logs.
 */

export interface AssembledPayload {
  fixtureId: number;
  userMessage: string;
  validPlayerIds: Set<number>;
  meta: { homeTeam: string; awayTeam: string; league: string; kickoffAt: string };
}

const MAX_KEY_PLAYERS = 6;

function attackingScore(s: PlayerSeasonStats | null): number {
  if (!s) return -1;
  const goals = s.goals ?? 0;
  const assists = s.assists ?? 0;
  const minutes = s.minutes ?? 0;
  // Goal contributions dominate; minutes break ties so fringe players rank low.
  return goals * 3 + assists * 2 + minutes / 900;
}

export function rankKeyPlayers(players: PlayerRow[]): PlayerRow[] {
  return [...players]
    .sort((a, b) => attackingScore(b.season_stats) - attackingScore(a.season_stats))
    .slice(0, MAX_KEY_PLAYERS);
}

export function formatForm(last5: FormResult[] | null): string {
  if (!last5 || last5.length === 0) return "No recent form data available.";
  return last5
    .map(
      (r) =>
        `${r.result} ${r.goals_for}-${r.goals_against} vs ${r.opponent} (${r.home_away})`
    )
    .join(", ");
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

export function formatKeyPlayers(players: PlayerRow[]): string {
  if (players.length === 0) return "No player data available.";
  return players
    .map((p) => {
      const s = p.season_stats;
      const pos = p.position ?? "n/a";
      return (
        `${p.name} (player_id ${p.id}, ${pos}): ` +
        `apps ${s?.appearances ?? 0}, goals ${s?.goals ?? 0}, assists ${s?.assists ?? 0}, ` +
        `minutes ${s?.minutes ?? 0}, shots ${s?.shots ?? 0}, rating ${s?.rating ?? "n/a"}`
      );
    })
    .join("\n");
}

/**
 * News-derived key player: a player named in the recent news for a fixture that
 * carries no season stats. The id is a deterministic synthetic id so it is
 * stable across runs and passes the validator's player-id existence check.
 */
export interface NewsDerivedPlayer {
  id: number;
  name: string;
  note: string;
}

export function buildNewsPlayers(
  signals: NewsSignals | null,
  team: "home" | "away",
  teamId: number
): NewsDerivedPlayer[] {
  if (!signals) return [];
  return signals.key_players
    .filter((p) => p.team === team)
    .map((p) => ({
      id: stableId("news-player", String(teamId), p.name),
      name: p.name,
      note: p.note
    }));
}

export function formatNewsPlayers(players: NewsDerivedPlayer[]): string {
  if (players.length === 0) return "No player data available.";
  return players
    .map((p) => `${p.name} (player_id ${p.id}): ${p.note || "highlighted in recent news"}`)
    .join("\n");
}

/** Last-5 form when present, otherwise the news-derived form summary if any. */
export function formText(last5: FormResult[] | null, summary: string | null): string {
  if (last5 && last5.length > 0) return formatForm(last5);
  if (summary) return `From recent news (external context): ${summary}`;
  return "No recent form data available.";
}

export async function assemblePayload(fixtureId: number): Promise<AssembledPayload> {
  const db = getServiceClient();

  const { data: fixture, error: fxErr } = await db
    .from("fixtures")
    .select("*")
    .eq("id", fixtureId)
    .single();
  if (fxErr || !fixture) throw new Error(`fixture ${fixtureId} not found: ${fxErr?.message}`);

  const homeTeamId = fixture.home_team_id;
  const awayTeamId = fixture.away_team_id;
  if (homeTeamId === null || awayTeamId === null) {
    throw new Error(`fixture ${fixtureId} missing team ids`);
  }

  const [league, venue, homeTeam, awayTeam] = await Promise.all([
    fixture.league_id
      ? db.from("leagues").select("*").eq("id", fixture.league_id).single()
      : Promise.resolve({ data: null }),
    fixture.venue_id
      ? db.from("venues").select("*").eq("id", fixture.venue_id).single()
      : Promise.resolve({ data: null }),
    db.from("teams").select("*").eq("id", homeTeamId).single(),
    db.from("teams").select("*").eq("id", awayTeamId).single()
  ]);

  const homeName = homeTeam.data?.name ?? `Team ${homeTeamId}`;
  const awayName = awayTeam.data?.name ?? `Team ${awayTeamId}`;
  const leagueName = league.data?.name ?? "Unknown league";
  const season = league.data?.season ?? "";
  const venueName = venue.data?.name ?? "Unknown venue";

  const [
    homeStanding,
    awayStanding,
    homeForm,
    awayForm,
    h2h,
    homeVenueRec,
    awayVenueRec,
    homePlayers,
    awayPlayers,
    injuries
  ] = await Promise.all([
    db.from("standings").select("*").eq("team_id", homeTeamId).maybeSingle(),
    db.from("standings").select("*").eq("team_id", awayTeamId).maybeSingle(),
    db.from("team_form").select("*").eq("team_id", homeTeamId).eq("fixture_id", fixtureId).maybeSingle(),
    db.from("team_form").select("*").eq("team_id", awayTeamId).eq("fixture_id", fixtureId).maybeSingle(),
    db.from("head_to_head").select("*").eq("home_team_id", homeTeamId).eq("away_team_id", awayTeamId).maybeSingle(),
    fixture.venue_id
      ? db.from("venue_records").select("*").eq("team_id", homeTeamId).eq("venue_id", fixture.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    fixture.venue_id
      ? db.from("venue_records").select("*").eq("team_id", awayTeamId).eq("venue_id", fixture.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("players").select("*").eq("team_id", homeTeamId),
    db.from("players").select("*").eq("team_id", awayTeamId),
    db.from("injuries").select("*").eq("fixture_id", fixtureId)
  ]);

  const news = await db
    .from("match_news")
    .select("items, signals")
    .eq("fixture_id", fixtureId)
    .maybeSingle();
  const signals = news.data?.signals ?? null;

  // Match official: assignment from the fixture, tendencies (if any) from the
  // referees table. Soft context only; never a contract field.
  const refereeName = fixture.referee ?? null;
  const refereeProfile = refereeName
    ? (
        await db.from("referees").select("*").eq("slug", refereeSlug(refereeName)).maybeSingle()
      ).data
    : null;

  const homeKey = rankKeyPlayers(homePlayers.data ?? []);
  const awayKey = rankKeyPlayers(awayPlayers.data ?? []);

  const validPlayerIds = new Set<number>();
  for (const p of [...homeKey, ...awayKey]) validPlayerIds.add(p.id);
  const hasRealPlayers = validPlayerIds.size > 0;

  // For stats-less (Gemini) fixtures with no real squad, fall back to players
  // named in the recent news. Their synthetic ids join validPlayerIds so the
  // model can still return a real player_to_watch instead of a placeholder.
  const homeNewsPlayers = hasRealPlayers ? [] : buildNewsPlayers(signals, "home", homeTeamId);
  const awayNewsPlayers = hasRealPlayers ? [] : buildNewsPlayers(signals, "away", awayTeamId);
  for (const p of [...homeNewsPlayers, ...awayNewsPlayers]) validPlayerIds.add(p.id);

  const usingNewsPlayers = !hasRealPlayers && validPlayerIds.size > 0;
  const hasPlayerData = validPlayerIds.size > 0;

  const homeRank = homeStanding.data?.rank ?? "n/a";
  const homePts = homeStanding.data?.points ?? "n/a";
  const homeGd = homeStanding.data?.goals_diff ?? "n/a";
  const awayRank = awayStanding.data?.rank ?? "n/a";
  const awayPts = awayStanding.data?.points ?? "n/a";
  const awayGd = awayStanding.data?.goals_diff ?? "n/a";

  let injuryLines: string;
  if ((injuries.data ?? []).length > 0) {
    injuryLines = (injuries.data ?? [])
      .map((i) => {
        const team = i.team_id === homeTeamId ? homeName : awayName;
        return `${team}: ${i.player_name ?? `player ${i.player_id}`} (${i.reason ?? "unspecified"})`;
      })
      .join("\n");
  } else if (signals && signals.injuries.length > 0) {
    // No structured injury feed for Gemini fixtures; fall back to news reports.
    injuryLines = signals.injuries
      .map((i) => {
        const team = i.team === "home" ? homeName : awayName;
        const note = i.note ? ` (${i.note})` : "";
        return `${team}: ${i.name}${note} [from recent news]`;
      })
      .join("\n");
  } else {
    injuryLines = "None reported.";
  }

  // USER MESSAGE TEMPLATE, filled exactly as defined in prompts/prediction.md.
  const userMessage = `Analyze this fixture and return the prediction JSON.

FIXTURE:
${homeName} (home) vs ${awayName} (away)
Competition: ${leagueName}, ${season}
Kickoff: ${fixture.kickoff_at}
Venue: ${venueName}

STANDINGS:
${homeName}: position ${homeRank}, ${homePts} pts, GD ${homeGd}
${awayName}: position ${awayRank}, ${awayPts} pts, GD ${awayGd}

LAST 5 FORM — ${homeName}:
${formText(homeForm.data?.last5 ?? null, signals?.home_form_summary ?? null)}

LAST 5 FORM — ${awayName}:
${formText(awayForm.data?.last5 ?? null, signals?.away_form_summary ?? null)}

HEAD TO HEAD (most recent first):
${formatH2H(h2h.data?.history ?? null)}

VENUE RECORD:
${homeName} at ${venueName}: ${formatVenueRecord(homeVenueRec.data?.record ?? null)}
${awayName} away record: ${formatVenueRecord(awayVenueRec.data?.record ?? null)}

KEY PLAYERS — ${homeName}:
${usingNewsPlayers ? formatNewsPlayers(homeNewsPlayers) : formatKeyPlayers(homeKey)}

KEY PLAYERS — ${awayName}:
${usingNewsPlayers ? formatNewsPlayers(awayNewsPlayers) : formatKeyPlayers(awayKey)}

INJURIES / UNAVAILABLE:
${injuryLines}

MATCH OFFICIAL (assignment from data; tendencies web-derived, soft context):
${formatRefereeContext(refereeName, refereeProfile)}

RECENT NEWS (external web reports, treat as soft supporting context only):
${formatNews(news.data?.items ?? null)}
${
  !hasPlayerData
    ? `\nNOTE: No player-level data is available for this fixture. For player_to_watch return ` +
      `{"player_id": 0, "name": "No player data", "reason": "Player-level data was unavailable, ` +
      `so the verdict is based on team form, standings, and recent news."} and lower confidence accordingly.\n`
    : usingNewsPlayers
      ? `\nNOTE: This fixture has no season statistics. The KEY PLAYERS listed above are derived from ` +
        `recent news reports (external context), not season data, and their player_ids are valid for ` +
        `player_to_watch. Pick player_to_watch from these news-derived key players, base the verdict on ` +
        `the form summaries and news, and keep confidence low (medium at most), since the read rests on ` +
        `news rather than verified stats.\n`
      : ""
}
Return only the JSON object defined in the contract.`;

  return {
    fixtureId,
    userMessage,
    validPlayerIds,
    meta: { homeTeam: homeName, awayTeam: awayName, league: leagueName, kickoffAt: fixture.kickoff_at }
  };
}
