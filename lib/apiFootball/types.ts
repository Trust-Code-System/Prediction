/**
 * Minimal typings for the API-Football v3 response shapes we consume. Only the
 * fields the ingest layer actually reads are modelled; the API returns more.
 */

export interface AFLeagueEntry {
  league: { id: number; name: string; type: string; logo: string };
  country: { name: string; code: string | null; flag: string | null };
  seasons: Array<{
    year: number;
    start: string;
    end: string;
    current: boolean;
    coverage: Record<string, unknown>;
  }>;
}

export interface AFVenue {
  id: number | null;
  name: string | null;
  city: string | null;
  capacity?: number | null;
}

export interface AFTeamEntry {
  team: { id: number; name: string; logo: string };
  venue: AFVenue;
}

export interface AFFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    status: { short: string; long: string };
    venue: { id: number | null; name: string | null; city: string | null };
    referee: string | null;
  };
  league: { id: number; name: string; season: number; round: string };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
}

export interface AFPlayerEntry {
  player: {
    id: number;
    name: string;
    photo: string;
    age: number | null;
  };
  statistics: Array<{
    team: { id: number; name: string };
    league: { id: number; season: number };
    games: {
      appearences: number | null;
      minutes: number | null;
      position: string | null;
      rating: string | null;
    };
    shots: { total: number | null; on: number | null };
    goals: { total: number | null; assists: number | null };
    cards: { yellow: number | null; red: number | null };
  }>;
}

export interface AFInjury {
  player: { id: number; name: string };
  team: { id: number; name: string };
  fixture: { id: number };
  type: string | null;
  reason: string | null;
}

export interface AFStandingRow {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  form: string | null;
}

export interface AFStandingsEntry {
  league: {
    id: number;
    name: string;
    season: number;
    standings: AFStandingRow[][];
  };
}

export interface AFH2HFixture extends AFFixture {}

export interface AFTeamStatistics {
  team: { id: number; name: string };
  league: { id: number; season: number };
  fixtures: {
    played: { home: number; away: number; total: number };
    wins: { home: number; away: number; total: number };
    draws: { home: number; away: number; total: number };
    loses: { home: number; away: number; total: number };
  };
  goals: {
    for: { total: { home: number; away: number; total: number } };
    against: { total: { home: number; away: number; total: number } };
  };
}
