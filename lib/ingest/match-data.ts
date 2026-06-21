import "server-only";
import { apiFootballList } from "@/lib/apiFootball/client";
import type {
  AFFixture,
  AFH2HFixture,
  AFInjury,
  AFStandingsEntry,
  AFTeamStatistics
} from "@/lib/apiFootball/types";
import { getServiceClient } from "@/lib/supabase/server";
import type { FormResult, H2HMeeting, VenueRecord } from "@/lib/types";

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const NOT_STARTED_STATUSES = new Set(["NS", "TBD"]);

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function ensureVenue(v: {
  id: number | null;
  name: string | null;
  city: string | null;
}): Promise<number | null> {
  if (v.id === null || v.name === null) return null;
  const db = getServiceClient();
  const { error } = await db
    .from("venues")
    .upsert({ id: v.id, name: v.name, city: v.city, capacity: null });
  if (error) throw new Error(`venues upsert failed: ${error.message}`);
  return v.id;
}

/**
 * Fetch fixtures for a league/season inside the next `hours` window and upsert
 * the not-yet-started ones. Returns the upserted fixture rows (id + team ids)
 * so the orchestrator can drive per-fixture supporting data.
 */
export async function ingestUpcomingFixtures(
  leagueId: number,
  season: number,
  hours = 48
): Promise<Array<{ id: number; homeTeamId: number; awayTeamId: number; venueId: number | null }>> {
  const now = new Date();
  const to = new Date(now.getTime() + hours * 60 * 60 * 1000);

  const fixtures = await apiFootballList<AFFixture>("fixtures", {
    league: leagueId,
    season,
    from: yyyymmdd(now),
    to: yyyymmdd(to)
  });

  const db = getServiceClient();
  const upserted: Array<{
    id: number;
    homeTeamId: number;
    awayTeamId: number;
    venueId: number | null;
  }> = [];

  for (const f of fixtures) {
    const kickoff = new Date(f.fixture.date);
    const withinWindow = kickoff.getTime() >= now.getTime() && kickoff.getTime() <= to.getTime();
    if (!withinWindow) continue;
    if (!NOT_STARTED_STATUSES.has(f.fixture.status.short)) continue;

    const venueId = await ensureVenue(f.fixture.venue);
    const { error } = await db.from("fixtures").upsert({
      id: f.fixture.id,
      league_id: leagueId,
      home_team_id: f.teams.home.id,
      away_team_id: f.teams.away.id,
      venue_id: venueId,
      kickoff_at: f.fixture.date,
      status: "scheduled"
    });
    if (error) throw new Error(`fixtures upsert failed: ${error.message}`);

    upserted.push({
      id: f.fixture.id,
      homeTeamId: f.teams.home.id,
      awayTeamId: f.teams.away.id,
      venueId
    });
  }

  return upserted;
}

/** Build last-5 form for a team and attach it to a specific upcoming fixture. */
export async function ingestTeamForm(teamId: number, fixtureId: number): Promise<void> {
  const fixtures = await apiFootballList<AFFixture>("fixtures", {
    team: teamId,
    last: 5
  });

  const last5: FormResult[] = fixtures
    .filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
    .map((f) => {
      const isHome = f.teams.home.id === teamId;
      const gf = (isHome ? f.goals.home : f.goals.away) ?? 0;
      const ga = (isHome ? f.goals.away : f.goals.home) ?? 0;
      const result: FormResult["result"] = gf > ga ? "W" : gf < ga ? "L" : "D";
      return {
        fixture_id: f.fixture.id,
        opponent: isHome ? f.teams.away.name : f.teams.home.name,
        home_away: isHome ? "home" : "away",
        goals_for: gf,
        goals_against: ga,
        result,
        date: f.fixture.date
      };
    });

  const db = getServiceClient();
  const { error } = await db
    .from("team_form")
    .upsert(
      { team_id: teamId, fixture_id: fixtureId, last5: last5 as never, fetched_at: new Date().toISOString() },
      { onConflict: "team_id,fixture_id" }
    );
  if (error) throw new Error(`team_form upsert failed: ${error.message}`);
}

/** Fetch and upsert head-to-head history between two teams. */
export async function ingestHeadToHead(homeTeamId: number, awayTeamId: number): Promise<void> {
  const fixtures = await apiFootballList<AFH2HFixture>("fixtures/headtohead", {
    h2h: `${homeTeamId}-${awayTeamId}`,
    last: 10
  });

  const history: H2HMeeting[] = fixtures
    .filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
    .map((f) => ({
      fixture_id: f.fixture.id,
      date: f.fixture.date,
      venue: f.fixture.venue.name,
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      home_goals: f.goals.home ?? 0,
      away_goals: f.goals.away ?? 0
    }));

  const db = getServiceClient();
  const { error } = await db
    .from("head_to_head")
    .upsert(
      {
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        history: history as never,
        fetched_at: new Date().toISOString()
      },
      { onConflict: "home_team_id,away_team_id" }
    );
  if (error) throw new Error(`head_to_head upsert failed: ${error.message}`);
}

/**
 * Derive venue/away records from /teams/statistics. The home team's home split
 * is stored against the match venue; the away team's away split is stored
 * against the same venue id (representing how they travel into this fixture).
 */
export async function ingestVenueRecord(
  teamId: number,
  leagueId: number,
  season: number,
  venueId: number | null,
  side: "home" | "away"
): Promise<void> {
  if (venueId === null) return;

  const stats = await apiFootballList<AFTeamStatistics>("teams/statistics", {
    team: teamId,
    league: leagueId,
    season
  });
  const s = stats[0];
  if (!s) return;

  const record: VenueRecord = {
    played: s.fixtures.played[side] ?? 0,
    wins: s.fixtures.wins[side] ?? 0,
    draws: s.fixtures.draws[side] ?? 0,
    losses: s.fixtures.loses[side] ?? 0,
    goals_for: s.goals.for.total[side] ?? 0,
    goals_against: s.goals.against.total[side] ?? 0
  };

  const db = getServiceClient();
  const { error } = await db
    .from("venue_records")
    .upsert(
      { team_id: teamId, venue_id: venueId, record: record as never, fetched_at: new Date().toISOString() },
      { onConflict: "team_id,venue_id" }
    );
  if (error) throw new Error(`venue_records upsert failed: ${error.message}`);
}

/** Refresh injuries for a fixture: clear the old list, insert the current one. */
export async function ingestInjuries(fixtureId: number): Promise<void> {
  const injuries = await apiFootballList<AFInjury>("injuries", { fixture: fixtureId });
  const db = getServiceClient();

  const { error: delErr } = await db.from("injuries").delete().eq("fixture_id", fixtureId);
  if (delErr) throw new Error(`injuries clear failed: ${delErr.message}`);

  if (injuries.length === 0) return;

  const rows = injuries.map((i) => ({
    fixture_id: fixtureId,
    team_id: i.team.id,
    player_id: i.player.id,
    player_name: i.player.name,
    reason: i.reason ?? i.type ?? null,
    fetched_at: new Date().toISOString()
  }));
  const { error } = await db.from("injuries").insert(rows);
  if (error) throw new Error(`injuries insert failed: ${error.message}`);
}

/** Fetch and upsert the full standings table for a league/season. */
export async function ingestStandings(leagueId: number, season: number): Promise<void> {
  const entries = await apiFootballList<AFStandingsEntry>("standings", {
    league: leagueId,
    season
  });
  const groups = entries[0]?.league.standings ?? [];
  const db = getServiceClient();

  for (const group of groups) {
    for (const row of group) {
      const { error } = await db.from("standings").upsert(
        {
          league_id: leagueId,
          season,
          team_id: row.team.id,
          rank: row.rank,
          points: row.points,
          goals_diff: row.goalsDiff,
          played: row.all.played,
          win: row.all.win,
          draw: row.all.draw,
          lose: row.all.lose,
          goals_for: row.all.goals.for,
          goals_against: row.all.goals.against,
          form: row.form,
          fetched_at: new Date().toISOString()
        },
        { onConflict: "league_id,season,team_id" }
      );
      if (error) throw new Error(`standings upsert failed: ${error.message}`);
    }
  }
}
