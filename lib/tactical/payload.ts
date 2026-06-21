import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { formatKeyPlayers, formText, rankKeyPlayers } from "@/lib/prediction/payload";
import { formatRefereeContext, refereeSlug } from "@/lib/ingest/referee";
import type { PlayerRow } from "@/lib/types";

/**
 * Assembles the per-fixture tactical payload from CACHED Supabase data only (no
 * API-Football). Gives the model the squad broken down by position (so it can
 * infer shape), recent form, standings, and the key attacking players. Mirrors
 * the prediction payload but trimmed to what tactical reasoning needs.
 */

export interface AssembledTacticalPayload {
  fixtureId: number;
  userMessage: string;
  meta: { homeTeam: string; awayTeam: string; league: string };
}

const POSITION_ORDER = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];

/** Counts of players with real minutes by position, to hint at likely shape. */
export function squadByPosition(players: PlayerRow[]): string {
  if (players.length === 0) return "No squad data available.";
  const buckets = new Map<string, PlayerRow[]>();
  for (const p of players) {
    const pos = p.position ?? "Unknown";
    if (!buckets.has(pos)) buckets.set(pos, []);
    buckets.get(pos)!.push(p);
  }

  const order = (pos: string) => {
    const i = POSITION_ORDER.indexOf(pos);
    return i === -1 ? POSITION_ORDER.length : i;
  };

  return [...buckets.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([pos, list]) => {
      const withMinutes = list.filter((p) => (p.season_stats?.minutes ?? 0) >= 450).length;
      return `${pos}: ${list.length} in squad, ${withMinutes} with regular minutes`;
    })
    .join("\n");
}

export async function assembleTacticalPayload(
  fixtureId: number
): Promise<AssembledTacticalPayload> {
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

  const [league, homeTeam, awayTeam] = await Promise.all([
    fixture.league_id
      ? db.from("leagues").select("*").eq("id", fixture.league_id).single()
      : Promise.resolve({ data: null }),
    db.from("teams").select("*").eq("id", homeTeamId).single(),
    db.from("teams").select("*").eq("id", awayTeamId).single()
  ]);

  const homeName = homeTeam.data?.name ?? `Team ${homeTeamId}`;
  const awayName = awayTeam.data?.name ?? `Team ${awayTeamId}`;
  const leagueName = league.data?.name ?? "Unknown league";

  const [homeStanding, awayStanding, homeForm, awayForm, homePlayers, awayPlayers, news] =
    await Promise.all([
      db.from("standings").select("*").eq("team_id", homeTeamId).maybeSingle(),
      db.from("standings").select("*").eq("team_id", awayTeamId).maybeSingle(),
      db.from("team_form").select("*").eq("team_id", homeTeamId).eq("fixture_id", fixtureId).maybeSingle(),
      db.from("team_form").select("*").eq("team_id", awayTeamId).eq("fixture_id", fixtureId).maybeSingle(),
      db.from("players").select("*").eq("team_id", homeTeamId),
      db.from("players").select("*").eq("team_id", awayTeamId),
      db.from("match_news").select("signals").eq("fixture_id", fixtureId).maybeSingle()
    ]);

  const signals = news.data?.signals ?? null;

  const refereeName = fixture.referee ?? null;
  const refereeProfile = refereeName
    ? (
        await db.from("referees").select("*").eq("slug", refereeSlug(refereeName)).maybeSingle()
      ).data
    : null;

  const homeKey = rankKeyPlayers(homePlayers.data ?? []);
  const awayKey = rankKeyPlayers(awayPlayers.data ?? []);

  const standingLine = (name: string, s: typeof homeStanding.data) =>
    s
      ? `${name}: position ${s.rank ?? "n/a"}, GF ${s.goals_for ?? "n/a"} GA ${s.goals_against ?? "n/a"} in ${s.played ?? "n/a"} games`
      : `${name}: no standings data`;

  const userMessage = `Analyze the likely tactical setup for this fixture and return the tactical JSON.

FIXTURE:
${homeName} (home) vs ${awayName} (away)
Competition: ${leagueName}

STANDINGS (scoring context):
${standingLine(homeName, homeStanding.data)}
${standingLine(awayName, awayStanding.data)}

LAST 5 FORM - ${homeName}:
${formText(homeForm.data?.last5 ?? null, signals?.home_form_summary ?? null)}

LAST 5 FORM - ${awayName}:
${formText(awayForm.data?.last5 ?? null, signals?.away_form_summary ?? null)}

SQUAD BY POSITION - ${homeName}:
${squadByPosition(homePlayers.data ?? [])}

SQUAD BY POSITION - ${awayName}:
${squadByPosition(awayPlayers.data ?? [])}

KEY PLAYERS - ${homeName}:
${formatKeyPlayers(homeKey)}

KEY PLAYERS - ${awayName}:
${formatKeyPlayers(awayKey)}

MATCH OFFICIAL (assignment from data; tendencies web-derived, soft context):
${formatRefereeContext(refereeName, refereeProfile)}

Return only the JSON object defined in the contract.`;

  return {
    fixtureId,
    userMessage,
    meta: { homeTeam: homeName, awayTeam: awayName, league: leagueName }
  };
}
