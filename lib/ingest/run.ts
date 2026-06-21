import "server-only";
import { mapWithConcurrency, QuotaExceededError, getQuotaSnapshot } from "@/lib/apiFootball/client";
import { COVERED_LEAGUES, UPCOMING_WINDOW_HOURS, type CoveredLeague } from "@/lib/config/leagues";
import { getServiceClient } from "@/lib/supabase/server";
import { ingestLeague, ingestPlayers, ingestTeams } from "@/lib/ingest/reference";
import { ingestMatchNews } from "@/lib/ingest/news";
import {
  ingestHeadToHead,
  ingestInjuries,
  ingestStandings,
  ingestTeamForm,
  ingestUpcomingFixtures,
  ingestVenueRecord
} from "@/lib/ingest/match-data";

/**
 * Orchestrates a full ingest pass for the upcoming window. Designed to be
 * called by the cron route. It is quota-aware: if the API quota guard trips,
 * it stops cleanly and reports what it managed to refresh rather than throwing.
 *
 * Order matters for foreign keys: leagues and teams (and their venues) must
 * exist before fixtures, which must exist before per-fixture supporting data.
 */

export interface IngestSummary {
  leaguesProcessed: number;
  fixturesUpserted: number;
  fixturesEnriched: number;
  quota: { limit: number; remaining: number };
  stoppedEarly: boolean;
  errors: string[];
}

interface UpcomingFixture {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
  venueId: number | null;
  leagueId: number;
  season: number;
}

export async function refreshUpcomingWindow(
  leagues: CoveredLeague[] = COVERED_LEAGUES
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    leaguesProcessed: 0,
    fixturesUpserted: 0,
    fixturesEnriched: 0,
    quota: getQuotaSnapshot(),
    stoppedEarly: false,
    errors: []
  };

  const upcoming: UpcomingFixture[] = [];

  // Pass 1: reference data + fixtures per league.
  for (const league of leagues) {
    try {
      await ingestLeague(league.leagueId, league.season);
      await ingestTeams(league.leagueId, league.season);
      await ingestStandings(league.leagueId, league.season);
      const fixtures = await ingestUpcomingFixtures(
        league.leagueId,
        league.season,
        UPCOMING_WINDOW_HOURS
      );
      for (const f of fixtures) {
        upcoming.push({ ...f, leagueId: league.leagueId, season: league.season });
      }
      summary.fixturesUpserted += fixtures.length;
      summary.leaguesProcessed++;
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        summary.stoppedEarly = true;
        summary.errors.push(`[${league.label}] ${err.message}`);
        summary.quota = getQuotaSnapshot();
        return summary;
      }
      summary.errors.push(`[${league.label}] ${(err as Error).message}`);
    }
  }

  // Pass 2: per-fixture supporting data. Players are ingested once per team.
  const playersDone = new Set<number>();

  try {
    await mapWithConcurrency(upcoming, 2, async (f) => {
      for (const teamId of [f.homeTeamId, f.awayTeamId]) {
        if (!playersDone.has(teamId)) {
          await ingestPlayers(teamId, f.leagueId, f.season);
          playersDone.add(teamId);
        }
      }
      await ingestTeamForm(f.homeTeamId, f.id);
      await ingestTeamForm(f.awayTeamId, f.id);
      await ingestHeadToHead(f.homeTeamId, f.awayTeamId);
      await ingestVenueRecord(f.homeTeamId, f.leagueId, f.season, f.venueId, "home");
      await ingestVenueRecord(f.awayTeamId, f.leagueId, f.season, f.venueId, "away");
      await ingestInjuries(f.id);
      // News is best-effort: a Tavily failure should not abort fixture ingest.
      try {
        await ingestMatchNews(f.id);
      } catch (newsErr) {
        summary.errors.push(`news fixture ${f.id}: ${(newsErr as Error).message}`);
      }
      summary.fixturesEnriched++;
    });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      summary.stoppedEarly = true;
      summary.errors.push(err.message);
    } else {
      summary.errors.push((err as Error).message);
    }
  }

  summary.quota = getQuotaSnapshot();
  return summary;
}

/**
 * Re-ingest the supporting data for a single already-known fixture. Reads the
 * fixture's league/season/teams/venue from cache, then refreshes players, form,
 * H2H, venue records, and injuries for it. Used by the manual refresh route.
 */
export async function refreshSingleFixtureData(fixtureId: number): Promise<void> {
  const db = getServiceClient();
  const { data: fixture, error } = await db
    .from("fixtures")
    .select("*")
    .eq("id", fixtureId)
    .single();
  if (error || !fixture) throw new Error(`fixture ${fixtureId} not found: ${error?.message}`);

  const { home_team_id: homeId, away_team_id: awayId, league_id: leagueId, venue_id: venueId } =
    fixture;
  if (homeId === null || awayId === null || leagueId === null) {
    throw new Error(`fixture ${fixtureId} missing team or league ids`);
  }

  const { data: league } = await db
    .from("leagues")
    .select("season")
    .eq("id", leagueId)
    .single();
  const season = league?.season;
  if (season === undefined) throw new Error(`league ${leagueId} season unknown`);

  await ingestPlayers(homeId, leagueId, season);
  await ingestPlayers(awayId, leagueId, season);
  await ingestTeamForm(homeId, fixtureId);
  await ingestTeamForm(awayId, fixtureId);
  await ingestHeadToHead(homeId, awayId);
  await ingestVenueRecord(homeId, leagueId, season, venueId, "home");
  await ingestVenueRecord(awayId, leagueId, season, venueId, "away");
  await ingestInjuries(fixtureId);
  await ingestStandings(leagueId, season);
  try {
    await ingestMatchNews(fixtureId);
  } catch {
    // best-effort; news is supplementary
  }
}
