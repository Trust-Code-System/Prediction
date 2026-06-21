/**
 * Database and domain types.
 *
 * The `Database` type mirrors schema.sql closely enough for typed Supabase
 * queries. jsonb columns are typed with the domain shapes below so reads are
 * checked end to end. These are hand-maintained; keep them in sync with
 * prompts/schema.sql.
 *
 * NOTE: the table Row types MUST be `type` aliases, not `interface`s. The
 * Supabase/postgrest type parser requires each Row to satisfy
 * Record<string, unknown>, and an interface has no implicit index signature, so
 * using `interface` here silently collapses every query result to `never`.
 */

// ---- jsonb payload shapes -------------------------------------------------

export type CoverageObject = {
  fixtures?: Record<string, boolean>;
  standings?: boolean;
  players?: boolean;
  top_scorers?: boolean;
  injuries?: boolean;
  predictions?: boolean;
  odds?: boolean;
  [key: string]: unknown;
};

export type PlayerSeasonStats = {
  appearances: number | null;
  goals: number | null;
  assists: number | null;
  minutes: number | null;
  shots: number | null;
  shots_on: number | null;
  rating: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
};

export type FormResult = {
  fixture_id: number;
  opponent: string;
  home_away: "home" | "away";
  goals_for: number;
  goals_against: number;
  result: "W" | "D" | "L";
  date: string;
};

export type H2HMeeting = {
  fixture_id: number;
  date: string;
  venue: string | null;
  home_team: string;
  away_team: string;
  home_goals: number;
  away_goals: number;
};

export type VenueRecord = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
};

export type NewsItem = {
  title: string;
  url: string;
  content: string;
  published_date: string | null;
  source: string | null;
};

// Structured signals extracted from the news items by a model, for fixtures
// that carry no API-Football season stats (Gemini-sourced). These are clearly
// labelled external context, never treated as hard stats, and only used to give
// news-only fixtures a form summary and a real player_to_watch.
export type NewsSignalPlayer = {
  team: "home" | "away";
  name: string;
  note: string;
};

export type NewsSignals = {
  home_form_summary: string | null;
  away_form_summary: string | null;
  key_players: NewsSignalPlayer[];
  injuries: NewsSignalPlayer[];
};

export type OutcomeProbs = {
  home_win: number;
  draw: number;
  away_win: number;
};

export type PlayerToWatch = {
  player_id: number;
  name: string;
  reason: string;
};

export type PredictionStatus = "published" | "review" | "failed";
export type Confidence = "low" | "medium" | "high";

// ---- markets layer --------------------------------------------------------

// Risk reflects how volatile/unpredictable the match is, distinct from
// confidence (how sure the model is about its lean). "avoid" means too
// unpredictable to call.
export type RiskLevel = "safe" | "medium" | "high" | "avoid";

export type BttsMarket = {
  pick: "yes" | "no";
  probability: number; // integer 0-100
};

export type OverUnderMarket = {
  pick: "over" | "under";
  probability: number; // integer 0-100, probability of the chosen side
};

export type GoalsMarket = {
  both_teams_to_score: BttsMarket;
  over_under_2_5: OverUnderMarket;
};

// The single strongest statistical call for the match, which may differ from
// the match-winner lean (sometimes goals are more predictable than the result).
export type BestAngle = {
  label: string;
  reason: string;
};

// ---- table row types ------------------------------------------------------

export type LeagueRow = {
  id: number;
  name: string;
  country: string | null;
  season: number;
  logo: string | null;
  coverage: CoverageObject | null;
  created_at: string;
};

export type VenueRow = {
  id: number;
  name: string;
  city: string | null;
  capacity: number | null;
};

export type TeamRow = {
  id: number;
  name: string;
  league_id: number | null;
  logo: string | null;
  venue_id: number | null;
  created_at: string;
};

export type PlayerRow = {
  id: number;
  team_id: number | null;
  name: string;
  position: string | null;
  photo: string | null;
  season: number;
  season_stats: PlayerSeasonStats | null;
  fetched_at: string;
};

export type FixtureRow = {
  id: number;
  league_id: number | null;
  home_team_id: number | null;
  away_team_id: number | null;
  venue_id: number | null;
  kickoff_at: string;
  status: string;
  created_at: string;
};

export type TeamFormRow = {
  id: number;
  team_id: number | null;
  fixture_id: number | null;
  last5: FormResult[] | null;
  fetched_at: string;
};

export type HeadToHeadRow = {
  id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  history: H2HMeeting[] | null;
  fetched_at: string;
};

export type VenueRecordRow = {
  id: number;
  team_id: number | null;
  venue_id: number | null;
  record: VenueRecord | null;
  fetched_at: string;
};

export type InjuryRow = {
  id: number;
  fixture_id: number | null;
  team_id: number | null;
  player_id: number | null;
  player_name: string | null;
  reason: string | null;
  fetched_at: string;
};

export type StandingRow = {
  id: number;
  league_id: number | null;
  season: number;
  team_id: number | null;
  rank: number | null;
  points: number | null;
  goals_diff: number | null;
  played: number | null;
  win: number | null;
  draw: number | null;
  lose: number | null;
  goals_for: number | null;
  goals_against: number | null;
  form: string | null;
  fetched_at: string;
};

export type MatchNewsRow = {
  fixture_id: number;
  items: NewsItem[] | null;
  query: string | null;
  signals: NewsSignals | null;
  fetched_at: string;
};

export type PredictionRow = {
  fixture_id: number;
  outcome_probs: OutcomeProbs;
  scoreline_lean: string | null;
  confidence: Confidence | null;
  player_to_watch: PlayerToWatch | null;
  key_factors: string[] | null;
  rationale: string;
  model: string | null;
  status: PredictionStatus;
  generated_at: string;
  // Markets layer. Nullable: predictions generated before this layer existed,
  // and 'review' rows, have these unset.
  goals_market: GoalsMarket | null;
  best_angle: BestAngle | null;
  risk_level: RiskLevel | null;
  what_could_change: string[] | null;
};

export type UpcomingWithPredictionRow = {
  fixture_id: number;
  kickoff_at: string;
  home_team: string;
  away_team: string;
  league: string;
  venue: string | null;
  has_prediction: boolean;
  confidence: Confidence | null;
};

// ---- Supabase Database generic -------------------------------------------

// Columns the database fills in (serial ids, timestamp defaults). They are
// optional on insert/upsert so callers do not have to supply them.
type ServerDefault = "id" | "created_at" | "fetched_at" | "generated_at";

// Nullable columns default to null in Postgres, so they are optional on insert
// too; omitting one (for example match_news.signals) leaves the existing value
// untouched on upsert rather than forcing every writer to supply it.
type NullableKeys<Row> = {
  [K in keyof Row]-?: null extends Row[K] ? K : never;
}[keyof Row];

type OptionalKeys<Row> = Extract<keyof Row, ServerDefault> | NullableKeys<Row>;

type Insertable<Row> = Omit<Row, OptionalKeys<Row>> &
  Partial<Pick<Row, OptionalKeys<Row>>>;

type Table<Row> = {
  Row: Row;
  Insert: Insertable<Row>;
  Update: Partial<Insertable<Row>>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      leagues: Table<LeagueRow>;
      venues: Table<VenueRow>;
      teams: Table<TeamRow>;
      players: Table<PlayerRow>;
      fixtures: Table<FixtureRow>;
      team_form: Table<TeamFormRow>;
      head_to_head: Table<HeadToHeadRow>;
      venue_records: Table<VenueRecordRow>;
      injuries: Table<InjuryRow>;
      standings: Table<StandingRow>;
      match_news: Table<MatchNewsRow>;
      predictions: Table<PredictionRow>;
    };
    Views: {
      upcoming_with_prediction: { Row: UpcomingWithPredictionRow; Relationships: [] };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
