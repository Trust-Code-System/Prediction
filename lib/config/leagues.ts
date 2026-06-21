/**
 * Covered competitions. Edit this list to control which leagues the ingest +
 * prediction pipeline pulls. league ids are API-Football league ids; season is
 * the API-Football season year (European seasons are labelled by start year).
 *
 * Keep the list small to stay within the API daily quota. Each league costs
 * roughly: 1 (league) + 1 (teams) + 1 (standings) + 1 per upcoming fixture for
 * each of form x2, h2h, venue x2, injuries, plus player pages per team.
 */
export interface CoveredLeague {
  leagueId: number;
  season: number;
  label: string;
}

export const COVERED_LEAGUES: CoveredLeague[] = [
  { leagueId: 39, season: 2025, label: "Premier League" },
  { leagueId: 140, season: 2025, label: "La Liga" },
  { leagueId: 135, season: 2025, label: "Serie A" },
  { leagueId: 78, season: 2025, label: "Bundesliga" },
  { leagueId: 61, season: 2025, label: "Ligue 1" }
];

/** How far ahead the ingest + prediction window looks, in hours. */
export const UPCOMING_WINDOW_HOURS = 48;
