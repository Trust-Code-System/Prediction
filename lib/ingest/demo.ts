import "server-only";
import { apiFootballList } from "@/lib/apiFootball/client";
import type { AFFixture } from "@/lib/apiFootball/types";
import { getServiceClient } from "@/lib/supabase/server";
import { ingestLeague, ingestPlayers, ingestTeams } from "@/lib/ingest/reference";
import { ingestInjuries, ingestStandings, ingestVenueRecord } from "@/lib/ingest/match-data";
import type { FormResult, H2HMeeting } from "@/lib/types";

/**
 * Demo seeding for the free API-Football plan.
 *
 * The free plan exposes only historical seasons (2021-2023) and blocks the
 * `last` parameter, so the normal "upcoming fixtures" flow has no data to work
 * with. This module runs the SAME pipeline (ingest -> Claude -> UI) against a
 * real historical matchday, fetching form and H2H without the `last` parameter,
 * and shifts the selected fixtures' kickoff into the near future so they appear
 * as upcoming and get predicted. The supporting data is genuine; only the
 * kickoff timestamp is moved for demonstration.
 */

export interface DemoConfig {
  leagueId: number;
  season: number;
  seasonStart: string; // ISO date, lower bound for form lookups
  windowFrom: string; // ISO date
  windowTo: string; // ISO date
  maxFixtures: number;
}

// Premier League 2023-24, matchday of 3-4 Feb 2024: mid-season, rich form and
// standings context, real injuries on file.
export const DEMO_CONFIG: DemoConfig = {
  leagueId: 39,
  season: 2023,
  seasonStart: "2023-08-01",
  windowFrom: "2024-02-03",
  windowTo: "2024-02-05",
  maxFixtures: 2
};

const FINISHED = new Set(["FT", "AET", "PEN"]);

export interface DemoSummary {
  fixtures: Array<{ id: number; home: string; away: string; shiftedKickoff: string }>;
  errors: string[];
}

function toFormResults(fixtures: AFFixture[], teamId: number, beforeIso: string): FormResult[] {
  const before = new Date(beforeIso).getTime();
  return fixtures
    .filter((f) => FINISHED.has(f.fixture.status.short))
    .filter((f) => new Date(f.fixture.date).getTime() < before)
    .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
    .slice(0, 5)
    .map((f) => {
      const isHome = f.teams.home.id === teamId;
      const gf = (isHome ? f.goals.home : f.goals.away) ?? 0;
      const ga = (isHome ? f.goals.away : f.goals.home) ?? 0;
      return {
        fixture_id: f.fixture.id,
        opponent: isHome ? f.teams.away.name : f.teams.home.name,
        home_away: isHome ? "home" : "away",
        goals_for: gf,
        goals_against: ga,
        result: gf > ga ? "W" : gf < ga ? "L" : "D",
        date: f.fixture.date
      } satisfies FormResult;
    });
}

/** Form via a season date-range query (no `last` parameter). */
async function demoIngestForm(
  teamId: number,
  fixtureId: number,
  cfg: DemoConfig,
  beforeIso: string
): Promise<void> {
  const fixtures = await apiFootballList<AFFixture>("fixtures", {
    team: teamId,
    season: cfg.season,
    from: cfg.seasonStart,
    to: beforeIso.slice(0, 10)
  });
  const last5 = toFormResults(fixtures, teamId, beforeIso);
  const db = getServiceClient();
  const { error } = await db
    .from("team_form")
    .upsert(
      { team_id: teamId, fixture_id: fixtureId, last5: last5 as never, fetched_at: new Date().toISOString() },
      { onConflict: "team_id,fixture_id" }
    );
  if (error) throw new Error(`demo team_form upsert failed: ${error.message}`);
}

/** H2H without the `last` parameter; cap to the 10 most recent finished meetings. */
async function demoIngestH2H(homeTeamId: number, awayTeamId: number, beforeIso: string): Promise<void> {
  const fixtures = await apiFootballList<AFFixture>("fixtures/headtohead", {
    h2h: `${homeTeamId}-${awayTeamId}`
  });
  const before = new Date(beforeIso).getTime();
  const history: H2HMeeting[] = fixtures
    .filter((f) => FINISHED.has(f.fixture.status.short))
    .filter((f) => new Date(f.fixture.date).getTime() < before)
    .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
    .slice(0, 10)
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
      { home_team_id: homeTeamId, away_team_id: awayTeamId, history: history as never, fetched_at: new Date().toISOString() },
      { onConflict: "home_team_id,away_team_id" }
    );
  if (error) throw new Error(`demo head_to_head upsert failed: ${error.message}`);
}

async function ensureVenue(v: { id: number | null; name: string | null; city: string | null }): Promise<number | null> {
  if (v.id === null || v.name === null) return null;
  const db = getServiceClient();
  const { error } = await db.from("venues").upsert({ id: v.id, name: v.name, city: v.city, capacity: null });
  if (error) throw new Error(`demo venues upsert failed: ${error.message}`);
  return v.id;
}

export async function runDemoIngest(cfg: DemoConfig = DEMO_CONFIG): Promise<DemoSummary> {
  const summary: DemoSummary = { fixtures: [], errors: [] };
  const db = getServiceClient();

  await ingestLeague(cfg.leagueId, cfg.season);
  await ingestTeams(cfg.leagueId, cfg.season);
  await ingestStandings(cfg.leagueId, cfg.season);

  const all = await apiFootballList<AFFixture>("fixtures", {
    league: cfg.leagueId,
    season: cfg.season,
    from: cfg.windowFrom,
    to: cfg.windowTo
  });
  const chosen = all.filter((f) => FINISHED.has(f.fixture.status.short)).slice(0, cfg.maxFixtures);

  const playersDone = new Set<number>();
  const now = Date.now();

  for (let i = 0; i < chosen.length; i++) {
    const f = chosen[i];
    const homeId = f.teams.home.id;
    const awayId = f.teams.away.id;
    const originalDate = f.fixture.date;
    // Shift kickoff into the near future, staggered, so it shows as upcoming.
    const shifted = new Date(now + (i + 1) * 6 * 60 * 60 * 1000).toISOString();

    try {
      const venueId = await ensureVenue(f.fixture.venue);
      const { error } = await db.from("fixtures").upsert({
        id: f.fixture.id,
        league_id: cfg.leagueId,
        home_team_id: homeId,
        away_team_id: awayId,
        venue_id: venueId,
        kickoff_at: shifted,
        status: "scheduled"
      });
      if (error) throw new Error(`demo fixtures upsert failed: ${error.message}`);

      for (const teamId of [homeId, awayId]) {
        if (!playersDone.has(teamId)) {
          await ingestPlayers(teamId, cfg.leagueId, cfg.season);
          playersDone.add(teamId);
        }
      }
      await demoIngestForm(homeId, f.fixture.id, cfg, originalDate);
      await demoIngestForm(awayId, f.fixture.id, cfg, originalDate);
      await demoIngestH2H(homeId, awayId, originalDate);
      await ingestVenueRecord(homeId, cfg.leagueId, cfg.season, venueId, "home");
      await ingestVenueRecord(awayId, cfg.leagueId, cfg.season, venueId, "away");
      await ingestInjuries(f.fixture.id);

      summary.fixtures.push({
        id: f.fixture.id,
        home: f.teams.home.name,
        away: f.teams.away.name,
        shiftedKickoff: shifted
      });
    } catch (err) {
      summary.errors.push(`fixture ${f.fixture.id}: ${(err as Error).message}`);
    }
  }

  return summary;
}
