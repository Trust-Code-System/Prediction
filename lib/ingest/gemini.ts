import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { fetchUpcomingFixturesViaGemini, type GeminiFixture } from "@/lib/gemini/fixtures";

/**
 * Ingests upcoming fixtures sourced from Gemini. Gemini does not know
 * API-Football numeric ids, so we mint deterministic synthetic ids from names
 * in a high range (8e9+) that cannot collide with real API-Football ids
 * (which are small). The same match therefore upserts to the same rows on
 * repeat runs. These fixtures carry no API-Football stats; the prediction for
 * them leans on Tavily news and whatever cached data exists, at low confidence.
 */

export const SYNTHETIC_ID_BASE = 8_000_000_000;
const ID_BASE = SYNTHETIC_ID_BASE;
const ID_RANGE = 1_000_000_000;

/** Deterministic djb2-style hash mapped into [ID_BASE, ID_BASE + 1e9). */
export function stableId(...parts: string[]): number {
  const s = parts.join("|").toLowerCase().trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return ID_BASE + (h % ID_RANGE);
}

/** True for ids minted by stableId (Gemini-sourced rows with no API-Football stats). */
export function isSyntheticId(id: number): boolean {
  return id >= ID_BASE && id < ID_BASE + ID_RANGE;
}

export interface GeminiIngestSummary {
  fixtures: Array<{ id: number; home: string; away: string; kickoffAt: string; league: string }>;
  errors: string[];
}

export async function ingestGeminiFixtures(hours = 48): Promise<GeminiIngestSummary> {
  const summary: GeminiIngestSummary = { fixtures: [], errors: [] };
  let fetched: GeminiFixture[] = [];
  try {
    fetched = await fetchUpcomingFixturesViaGemini(hours);
  } catch (err) {
    summary.errors.push(`gemini fetch failed: ${(err as Error).message}`);
    return summary;
  }

  const db = getServiceClient();
  const season = new Date().getUTCFullYear();
  const seenLeagues = new Set<number>();
  const seenVenues = new Set<number>();
  const seenTeams = new Set<number>();

  for (const f of fetched) {
    try {
      const leagueId = stableId("league", f.league, f.country ?? "");
      if (!seenLeagues.has(leagueId)) {
        const { error } = await db.from("leagues").upsert({
          id: leagueId,
          name: f.league,
          country: f.country,
          season,
          logo: null,
          coverage: null
        });
        if (error) throw new Error(`leagues upsert: ${error.message}`);
        seenLeagues.add(leagueId);
      }

      let venueId: number | null = null;
      if (f.venue) {
        venueId = stableId("venue", f.venue);
        if (!seenVenues.has(venueId)) {
          const { error } = await db
            .from("venues")
            .upsert({ id: venueId, name: f.venue, city: null, capacity: null });
          if (error) throw new Error(`venues upsert: ${error.message}`);
          seenVenues.add(venueId);
        }
      }

      const homeId = stableId("team", f.homeTeam);
      const awayId = stableId("team", f.awayTeam);
      for (const [id, name] of [
        [homeId, f.homeTeam],
        [awayId, f.awayTeam]
      ] as const) {
        if (!seenTeams.has(id)) {
          const { error } = await db
            .from("teams")
            .upsert({ id, name, league_id: leagueId, logo: null, venue_id: venueId });
          if (error) throw new Error(`teams upsert: ${error.message}`);
          seenTeams.add(id);
        }
      }

      const fixtureId = stableId("fixture", f.homeTeam, f.awayTeam, f.kickoffAt.slice(0, 10));
      const { error } = await db.from("fixtures").upsert({
        id: fixtureId,
        league_id: leagueId,
        home_team_id: homeId,
        away_team_id: awayId,
        venue_id: venueId,
        kickoff_at: f.kickoffAt,
        status: "scheduled"
      });
      if (error) throw new Error(`fixtures upsert: ${error.message}`);

      summary.fixtures.push({
        id: fixtureId,
        home: f.homeTeam,
        away: f.awayTeam,
        kickoffAt: f.kickoffAt,
        league: f.league
      });
    } catch (err) {
      summary.errors.push(`${f.homeTeam} vs ${f.awayTeam}: ${(err as Error).message}`);
    }
  }

  return summary;
}
