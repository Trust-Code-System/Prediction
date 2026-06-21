import "server-only";
import { apiFootballGet, apiFootballList } from "@/lib/apiFootball/client";
import type {
  AFLeagueEntry,
  AFPlayerEntry,
  AFTeamEntry,
  AFVenue
} from "@/lib/apiFootball/types";
import { getServiceClient } from "@/lib/supabase/server";
import type { PlayerSeasonStats } from "@/lib/types";

// Free plan caps the players `page` parameter at 3.
const MAX_PLAYER_PAGES = 3;

/**
 * Reference-data ingest: leagues, venues, teams, players. All writes go through
 * the service-role client. These functions are idempotent upserts so the cron
 * can re-run them safely.
 */

/** Upsert a venue if it has a real id. Returns the venue id or null. */
async function upsertVenue(v: {
  id: number | null;
  name: string | null;
  city: string | null;
  capacity?: number | null;
}): Promise<number | null> {
  if (v.id === null || v.name === null) return null;
  const db = getServiceClient();
  const { error } = await db
    .from("venues")
    .upsert({ id: v.id, name: v.name, city: v.city, capacity: v.capacity ?? null });
  if (error) throw new Error(`venues upsert failed: ${error.message}`);
  return v.id;
}

/** Fetch and upsert a single league + its coverage object for a season. */
export async function ingestLeague(leagueId: number, season: number): Promise<void> {
  const entries = await apiFootballList<AFLeagueEntry>("leagues", {
    id: leagueId,
    season
  });
  const entry = entries[0];
  if (!entry) throw new Error(`league ${leagueId} not found for season ${season}`);

  const seasonObj = entry.seasons.find((s) => s.year === season) ?? entry.seasons[0];
  const db = getServiceClient();
  const { error } = await db.from("leagues").upsert({
    id: entry.league.id,
    name: entry.league.name,
    country: entry.country.name ?? null,
    season,
    logo: entry.league.logo ?? null,
    coverage: (seasonObj?.coverage ?? null) as never
  });
  if (error) throw new Error(`leagues upsert failed: ${error.message}`);
}

/**
 * Fetch and upsert all teams (and their venues) for a league + season.
 * Returns the team ids so the caller can drive player ingest.
 */
export async function ingestTeams(leagueId: number, season: number): Promise<number[]> {
  const entries = await apiFootballList<AFTeamEntry>("teams", {
    league: leagueId,
    season
  });

  const db = getServiceClient();
  const teamIds: number[] = [];

  for (const entry of entries) {
    const venueId = await upsertVenue(entry.venue);
    const { error } = await db.from("teams").upsert({
      id: entry.team.id,
      name: entry.team.name,
      league_id: leagueId,
      logo: entry.team.logo ?? null,
      venue_id: venueId
    });
    if (error) throw new Error(`teams upsert failed: ${error.message}`);
    teamIds.push(entry.team.id);
  }

  return teamIds;
}

/** Map the API player statistics block to our flat season_stats shape. */
function toSeasonStats(entry: AFPlayerEntry, leagueId: number, season: number): PlayerSeasonStats {
  const stat =
    entry.statistics.find((s) => s.league.id === leagueId && s.league.season === season) ??
    entry.statistics[0];
  const rating = stat?.games.rating ? Number.parseFloat(stat.games.rating) : null;
  return {
    appearances: stat?.games.appearences ?? null,
    goals: stat?.goals.total ?? null,
    assists: stat?.goals.assists ?? null,
    minutes: stat?.games.minutes ?? null,
    shots: stat?.shots.total ?? null,
    shots_on: stat?.shots.on ?? null,
    rating: rating !== null && Number.isFinite(rating) ? rating : null,
    yellow_cards: stat?.cards.yellow ?? null,
    red_cards: stat?.cards.red ?? null
  };
}

/**
 * Fetch and upsert players + season stats for one team. The /players endpoint
 * is paginated; we walk every page.
 */
export async function ingestPlayers(
  teamId: number,
  leagueId: number,
  season: number
): Promise<number> {
  const db = getServiceClient();
  let page = 1;
  let totalPages = 1;
  let count = 0;

  do {
    const env = await apiFootballGet<AFPlayerEntry>("players", {
      team: teamId,
      season,
      page
    });
    // Free plan caps `page` at 3. Three pages (~60 players) is plenty for the
    // key-player ranking, so we never request beyond it.
    totalPages = Math.min(env.paging.total || 1, MAX_PLAYER_PAGES);

    for (const entry of env.response) {
      const stat =
        entry.statistics.find((s) => s.league.id === leagueId) ?? entry.statistics[0];
      const { error } = await db.from("players").upsert({
        id: entry.player.id,
        team_id: teamId,
        name: entry.player.name,
        position: stat?.games.position ?? null,
        photo: entry.player.photo ?? null,
        season,
        season_stats: toSeasonStats(entry, leagueId, season) as never,
        fetched_at: new Date().toISOString()
      });
      if (error) throw new Error(`players upsert failed: ${error.message}`);
      count++;
    }
    page++;
  } while (page <= totalPages);

  return count;
}

export type { AFVenue };
