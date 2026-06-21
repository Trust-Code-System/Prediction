import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { isSyntheticId } from "@/lib/ingest/gemini";
import type { Database } from "@/lib/types";

/**
 * Stale-data cleanup and synthetic-row dedupe.
 *
 * Two jobs:
 *  1. Remove fixtures whose kickoff is well in the past, plus the rows that
 *     reference them (predictions, match_news, team_form, injuries).
 *  2. Remove orphaned SYNTHETIC (Gemini-sourced) reference rows that no
 *     remaining fixture or team still points at (teams, leagues, venues, and any
 *     of their children). Real API-Football reference data is never touched: it
 *     is shared, stable, and worth keeping.
 *
 * DRY RUN BY DEFAULT. `planCleanup` only reads and returns the counts that would
 * be deleted. `applyCleanup` performs the deletes in foreign-key-safe order
 * (children before parents); no FK has ON DELETE CASCADE, so order matters.
 *
 * Scope controls only whether REAL past fixtures are removed too:
 *  - "synthetic" (default): only Gemini fixtures (synthetic ids) are stale
 *    candidates. Real past fixtures and their predictions are kept (the future
 *    "histories" feature needs them).
 *  - "all": real past fixtures are removed as well.
 * Orphan reference cleanup is always synthetic-only regardless of scope.
 */

export type CleanupScope = "synthetic" | "all";

export interface CleanupReport {
  dryRun: boolean;
  scope: CleanupScope;
  retentionDays: number;
  cutoff: string;
  counts: {
    fixtures: number;
    predictions: number;
    match_news: number;
    team_form: number;
    injuries: number;
    head_to_head: number;
    venue_records: number;
    standings: number;
    players: number;
    teams: number;
    venues: number;
    leagues: number;
  };
}

// What needs deleting, resolved to concrete id sets so apply and dry-run agree.
interface CleanupPlan {
  report: CleanupReport;
  staleFixtureIds: number[];
  orphanTeamIds: number[];
  orphanLeagueIds: number[];
  orphanVenueIds: number[];
  orphanPlayerIds: number[];
}

interface FixtureLite {
  id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  league_id: number | null;
  venue_id: number | null;
  kickoff_at: string;
}

function uniq(values: Array<number | null | undefined>): Set<number> {
  const out = new Set<number>();
  for (const v of values) if (typeof v === "number") out.add(v);
  return out;
}

async function buildPlan(
  retentionDays: number,
  scope: CleanupScope,
  dryRun: boolean
): Promise<CleanupPlan> {
  const db = getServiceClient();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  // Pull the small reference + linkage tables and resolve everything in memory,
  // so dry-run counts and the actual deletes come from one consistent snapshot.
  const [fixtures, teams, leagues, venues, players] = await Promise.all([
    db.from("fixtures").select("id, home_team_id, away_team_id, league_id, venue_id, kickoff_at"),
    db.from("teams").select("id, league_id, venue_id"),
    db.from("leagues").select("id"),
    db.from("venues").select("id"),
    db.from("players").select("id, team_id")
  ]);

  const allFixtures = (fixtures.data ?? []) as FixtureLite[];

  const staleFixtures = allFixtures.filter(
    (f) => f.kickoff_at < cutoff && (scope === "all" || isSyntheticId(f.id))
  );
  const staleFixtureIds = staleFixtures.map((f) => f.id);
  const staleSet = new Set(staleFixtureIds);
  const remainingFixtures = allFixtures.filter((f) => !staleSet.has(f.id));

  // Teams still pointed at by a surviving fixture stay, even if synthetic.
  const teamsUsedByFixtures = uniq(
    remainingFixtures.flatMap((f) => [f.home_team_id, f.away_team_id])
  );
  const orphanTeamIds = (teams.data ?? [])
    .filter((t) => isSyntheticId(t.id) && !teamsUsedByFixtures.has(t.id))
    .map((t) => t.id);
  const orphanTeamSet = new Set(orphanTeamIds);

  const orphanPlayerIds = (players.data ?? [])
    .filter((p) => p.team_id !== null && orphanTeamSet.has(p.team_id))
    .map((p) => p.id);

  // Leagues/venues are orphaned only if neither a surviving fixture nor a
  // surviving team references them.
  const remainingTeams = (teams.data ?? []).filter((t) => !orphanTeamSet.has(t.id));
  const leaguesUsed = new Set<number>([
    ...uniq(remainingFixtures.map((f) => f.league_id)),
    ...uniq(remainingTeams.map((t) => t.league_id))
  ]);
  const venuesUsed = new Set<number>([
    ...uniq(remainingFixtures.map((f) => f.venue_id)),
    ...uniq(remainingTeams.map((t) => t.venue_id))
  ]);
  const orphanLeagueIds = (leagues.data ?? [])
    .filter((l) => isSyntheticId(l.id) && !leaguesUsed.has(l.id))
    .map((l) => l.id);
  const orphanVenueIds = (venues.data ?? [])
    .filter((v) => isSyntheticId(v.id) && !venuesUsed.has(v.id))
    .map((v) => v.id);

  // Count the fixture-scoped and team-scoped children that will go with them.
  const [predictions, matchNews, teamForm, injuries, h2h, venueRecords, standings] =
    await Promise.all([
      countIn(db, "predictions", "fixture_id", staleFixtureIds),
      countIn(db, "match_news", "fixture_id", staleFixtureIds),
      countChildren(db, "team_form", [
        ["fixture_id", staleFixtureIds],
        ["team_id", orphanTeamIds]
      ]),
      countChildren(db, "injuries", [
        ["fixture_id", staleFixtureIds],
        ["team_id", orphanTeamIds],
        ["player_id", orphanPlayerIds]
      ]),
      countChildren(db, "head_to_head", [
        ["home_team_id", orphanTeamIds],
        ["away_team_id", orphanTeamIds]
      ]),
      countChildren(db, "venue_records", [
        ["team_id", orphanTeamIds],
        ["venue_id", orphanVenueIds]
      ]),
      countChildren(db, "standings", [
        ["team_id", orphanTeamIds],
        ["league_id", orphanLeagueIds]
      ])
    ]);

  return {
    report: {
      dryRun,
      scope,
      retentionDays,
      cutoff,
      counts: {
        fixtures: staleFixtureIds.length,
        predictions,
        match_news: matchNews,
        team_form: teamForm,
        injuries,
        head_to_head: h2h,
        venue_records: venueRecords,
        standings,
        players: orphanPlayerIds.length,
        teams: orphanTeamIds.length,
        venues: orphanVenueIds.length,
        leagues: orphanLeagueIds.length
      }
    },
    staleFixtureIds,
    orphanTeamIds,
    orphanLeagueIds,
    orphanVenueIds,
    orphanPlayerIds
  };
}

type Db = ReturnType<typeof getServiceClient>;
type Tbl = keyof Database["public"]["Tables"];

const CHUNK = 200;

function chunk<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

/** Exact count of rows where `column` is in `ids` (chunked, head-only). */
async function countIn(db: Db, table: Tbl, column: string, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  let total = 0;
  for (const part of chunk(ids)) {
    const { count } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .in(column, part);
    total += count ?? 0;
  }
  return total;
}

/**
 * Count distinct rows matching ANY of several (column, ids) conditions. Done by
 * collecting matching primary-key-ish ids per condition and unioning, so a row
 * matching two conditions is not double counted.
 */
async function countChildren(
  db: Db,
  table: Tbl,
  conditions: Array<[string, number[]]>
): Promise<number> {
  const matched = new Set<number>();
  for (const [column, ids] of conditions) {
    for (const part of chunk(ids)) {
      if (part.length === 0) continue;
      const { data } = await db.from(table).select("id").in(column, part);
      for (const row of (data ?? []) as unknown as Array<{ id: number }>) matched.add(row.id);
    }
  }
  return matched.size;
}

async function deleteIn(db: Db, table: Tbl, column: string, ids: number[]): Promise<void> {
  for (const part of chunk(ids)) {
    if (part.length === 0) continue;
    const { error } = await db.from(table).delete().in(column, part);
    if (error) throw new Error(`delete ${table} by ${column} failed: ${error.message}`);
  }
}

export async function planCleanup(
  retentionDays: number,
  scope: CleanupScope
): Promise<CleanupReport> {
  const { report } = await buildPlan(retentionDays, scope, true);
  return report;
}

export async function applyCleanup(
  retentionDays: number,
  scope: CleanupScope
): Promise<CleanupReport> {
  const plan = await buildPlan(retentionDays, scope, false);
  const db = getServiceClient();
  const { staleFixtureIds, orphanTeamIds, orphanLeagueIds, orphanVenueIds, orphanPlayerIds } = plan;

  // Children before parents. No FK is ON DELETE CASCADE, so this order matters.
  await deleteIn(db, "predictions", "fixture_id", staleFixtureIds);
  await deleteIn(db, "match_news", "fixture_id", staleFixtureIds);

  await deleteIn(db, "team_form", "fixture_id", staleFixtureIds);
  await deleteIn(db, "team_form", "team_id", orphanTeamIds);

  await deleteIn(db, "injuries", "fixture_id", staleFixtureIds);
  await deleteIn(db, "injuries", "team_id", orphanTeamIds);
  await deleteIn(db, "injuries", "player_id", orphanPlayerIds);

  await deleteIn(db, "standings", "team_id", orphanTeamIds);
  await deleteIn(db, "standings", "league_id", orphanLeagueIds);

  await deleteIn(db, "venue_records", "team_id", orphanTeamIds);
  await deleteIn(db, "venue_records", "venue_id", orphanVenueIds);

  await deleteIn(db, "head_to_head", "home_team_id", orphanTeamIds);
  await deleteIn(db, "head_to_head", "away_team_id", orphanTeamIds);

  await deleteIn(db, "players", "id", orphanPlayerIds);

  // Fixtures reference teams/leagues/venues, so they go before those parents.
  await deleteIn(db, "fixtures", "id", staleFixtureIds);

  await deleteIn(db, "teams", "id", orphanTeamIds);
  await deleteIn(db, "venues", "id", orphanVenueIds);
  await deleteIn(db, "leagues", "id", orphanLeagueIds);

  return { ...plan.report, dryRun: false };
}
