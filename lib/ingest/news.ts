import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { tavilySearch } from "@/lib/tavily/client";

/**
 * Fetches recent news for a fixture via Tavily and upserts it into match_news.
 * Reads team and league names from cache to build a focused query. Safe to call
 * for any fixture; stores an empty list rather than failing if nothing is found.
 */
export async function ingestMatchNews(fixtureId: number): Promise<number> {
  const db = getServiceClient();

  const { data: fixture, error } = await db
    .from("fixtures")
    .select("home_team_id, away_team_id, league_id")
    .eq("id", fixtureId)
    .single();
  if (error || !fixture) throw new Error(`fixture ${fixtureId} not found: ${error?.message}`);

  const [home, away, league] = await Promise.all([
    fixture.home_team_id
      ? db.from("teams").select("name").eq("id", fixture.home_team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    fixture.away_team_id
      ? db.from("teams").select("name").eq("id", fixture.away_team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    fixture.league_id
      ? db.from("leagues").select("name").eq("id", fixture.league_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  const homeName = home.data?.name ?? "";
  const awayName = away.data?.name ?? "";
  const leagueName = league.data?.name ?? "";
  const query =
    `${homeName} vs ${awayName} ${leagueName} team news injuries lineup preview`.trim();

  const items = await tavilySearch(query, 6);

  const { error: upErr } = await db.from("match_news").upsert({
    fixture_id: fixtureId,
    items: items as never,
    query,
    fetched_at: new Date().toISOString()
  });
  if (upErr) throw new Error(`match_news upsert failed: ${upErr.message}`);

  return items.length;
}
