import { getReadClient } from "@/lib/supabase/read";
import type {
  FixtureRow,
  InjuryRow,
  LeagueRow,
  MatchNewsRow,
  PlayerRow,
  PredictionRow,
  StandingRow,
  TeamFormRow,
  HeadToHeadRow,
  VenueRecordRow,
  VenueRow,
  TeamRow
} from "@/lib/types";

/**
 * Read layer for the match page. Pulls the prediction and ALL supporting data
 * from Supabase (anon key, RLS-bound) so a user can verify every claim. No
 * API-Football calls. The prediction comes back only if it is published.
 */

export interface MatchView {
  fixture: FixtureRow;
  league: LeagueRow | null;
  venue: VenueRow | null;
  homeTeam: TeamRow | null;
  awayTeam: TeamRow | null;
  prediction: PredictionRow | null;
  homePlayers: PlayerRow[];
  awayPlayers: PlayerRow[];
  homeForm: TeamFormRow | null;
  awayForm: TeamFormRow | null;
  h2h: HeadToHeadRow | null;
  homeVenueRecord: VenueRecordRow | null;
  awayVenueRecord: VenueRecordRow | null;
  homeStanding: StandingRow | null;
  awayStanding: StandingRow | null;
  injuries: InjuryRow[];
  news: MatchNewsRow | null;
}

export async function getMatchView(fixtureId: number): Promise<MatchView | null> {
  const db = getReadClient();

  const { data: fixture } = await db
    .from("fixtures")
    .select("*")
    .eq("id", fixtureId)
    .maybeSingle();
  if (!fixture) return null;

  const homeId = fixture.home_team_id;
  const awayId = fixture.away_team_id;

  const [league, venue, homeTeam, awayTeam, prediction] = await Promise.all([
    fixture.league_id
      ? db.from("leagues").select("*").eq("id", fixture.league_id).maybeSingle()
      : Promise.resolve({ data: null }),
    fixture.venue_id
      ? db.from("venues").select("*").eq("id", fixture.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    homeId ? db.from("teams").select("*").eq("id", homeId).maybeSingle() : Promise.resolve({ data: null }),
    awayId ? db.from("teams").select("*").eq("id", awayId).maybeSingle() : Promise.resolve({ data: null }),
    db.from("predictions").select("*").eq("fixture_id", fixtureId).maybeSingle()
  ]);

  const [
    homePlayers,
    awayPlayers,
    homeForm,
    awayForm,
    h2h,
    homeVenueRecord,
    awayVenueRecord,
    homeStanding,
    awayStanding,
    injuries,
    news
  ] = await Promise.all([
    homeId ? db.from("players").select("*").eq("team_id", homeId) : Promise.resolve({ data: [] }),
    awayId ? db.from("players").select("*").eq("team_id", awayId) : Promise.resolve({ data: [] }),
    homeId
      ? db.from("team_form").select("*").eq("team_id", homeId).eq("fixture_id", fixtureId).maybeSingle()
      : Promise.resolve({ data: null }),
    awayId
      ? db.from("team_form").select("*").eq("team_id", awayId).eq("fixture_id", fixtureId).maybeSingle()
      : Promise.resolve({ data: null }),
    homeId && awayId
      ? db.from("head_to_head").select("*").eq("home_team_id", homeId).eq("away_team_id", awayId).maybeSingle()
      : Promise.resolve({ data: null }),
    homeId && fixture.venue_id
      ? db.from("venue_records").select("*").eq("team_id", homeId).eq("venue_id", fixture.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    awayId && fixture.venue_id
      ? db.from("venue_records").select("*").eq("team_id", awayId).eq("venue_id", fixture.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    homeId ? db.from("standings").select("*").eq("team_id", homeId).maybeSingle() : Promise.resolve({ data: null }),
    awayId ? db.from("standings").select("*").eq("team_id", awayId).maybeSingle() : Promise.resolve({ data: null }),
    db.from("injuries").select("*").eq("fixture_id", fixtureId),
    db.from("match_news").select("*").eq("fixture_id", fixtureId).maybeSingle()
  ]);

  return {
    fixture,
    league: league.data,
    venue: venue.data,
    homeTeam: homeTeam.data,
    awayTeam: awayTeam.data,
    prediction: prediction.data,
    homePlayers: homePlayers.data ?? [],
    awayPlayers: awayPlayers.data ?? [],
    homeForm: homeForm.data,
    awayForm: awayForm.data,
    h2h: h2h.data,
    homeVenueRecord: homeVenueRecord.data,
    awayVenueRecord: awayVenueRecord.data,
    homeStanding: homeStanding.data,
    awayStanding: awayStanding.data,
    injuries: injuries.data ?? [],
    news: news.data
  };
}
