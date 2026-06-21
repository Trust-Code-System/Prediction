-- schema.sql — Football Prediction Platform
-- Run in Supabase SQL editor. Postgres + RLS.
-- Public read on published data, writes restricted to service role (cron).

-- ============================================================
-- CORE REFERENCE TABLES
-- ============================================================

create table if not exists leagues (
  id           bigint primary key,            -- API-Football league id
  name         text not null,
  country      text,
  season       int not null,
  logo         text,
  coverage     jsonb,                          -- coverage object from API
  created_at   timestamptz default now()
);

create table if not exists venues (
  id           bigint primary key,
  name         text not null,
  city         text,
  capacity     int
);

create table if not exists teams (
  id           bigint primary key,             -- API-Football team id
  name         text not null,
  league_id    bigint references leagues(id),
  logo         text,
  venue_id     bigint references venues(id),
  created_at   timestamptz default now()
);

create table if not exists players (
  id            bigint primary key,            -- API-Football player id
  team_id       bigint references teams(id),
  name          text not null,
  position      text,
  photo         text,
  season        int not null,
  season_stats  jsonb,                          -- goals, assists, mins, shots, rating, cards, etc
  fetched_at    timestamptz default now()
);
create index if not exists idx_players_team on players(team_id);

-- ============================================================
-- FIXTURES + SUPPORTING DATA
-- ============================================================

create table if not exists fixtures (
  id            bigint primary key,            -- API-Football fixture id
  league_id     bigint references leagues(id),
  home_team_id  bigint references teams(id),
  away_team_id  bigint references teams(id),
  venue_id      bigint references venues(id),
  kickoff_at    timestamptz not null,
  status        text default 'scheduled',      -- scheduled | live | finished
  created_at    timestamptz default now()
);
create index if not exists idx_fixtures_kickoff on fixtures(kickoff_at);
create index if not exists idx_fixtures_status on fixtures(status);

create table if not exists team_form (
  id          bigserial primary key,
  team_id     bigint references teams(id),
  fixture_id  bigint references fixtures(id),
  last5       jsonb,                            -- array of recent results
  fetched_at  timestamptz default now(),
  unique (team_id, fixture_id)
);

create table if not exists head_to_head (
  id            bigserial primary key,
  home_team_id  bigint references teams(id),
  away_team_id  bigint references teams(id),
  history       jsonb,                          -- array of past meetings
  fetched_at    timestamptz default now(),
  unique (home_team_id, away_team_id)
);

create table if not exists venue_records (
  id          bigserial primary key,
  team_id     bigint references teams(id),
  venue_id    bigint references venues(id),
  record      jsonb,                            -- played, W/D/L, GF/GA
  fetched_at  timestamptz default now(),
  unique (team_id, venue_id)
);

create table if not exists injuries (
  id          bigserial primary key,
  fixture_id  bigint references fixtures(id),
  team_id     bigint references teams(id),
  player_id   bigint references players(id),
  player_name text,
  reason      text,
  fetched_at  timestamptz default now()
);
create index if not exists idx_injuries_fixture on injuries(fixture_id);

create table if not exists standings (
  id            bigserial primary key,
  league_id     bigint references leagues(id),
  season        int not null,
  team_id       bigint references teams(id),
  rank          int,
  points        int,
  goals_diff    int,
  played        int,
  win           int,
  draw          int,
  lose          int,
  goals_for     int,
  goals_against int,
  form          text,                             -- recent form string e.g. WWDLW
  fetched_at    timestamptz default now(),
  unique (league_id, season, team_id)
);
create index if not exists idx_standings_team on standings(team_id);

-- Recent match news from Tavily web search. Fed into the prediction payload as
-- labelled external context and shown to users on the match page.
create table if not exists match_news (
  fixture_id  bigint primary key references fixtures(id),
  items       jsonb,                            -- array of {title, url, content, published_date, source}
  query       text,
  signals     jsonb,                            -- { home_form_summary, away_form_summary, key_players[], injuries[] } extracted from news for stats-less fixtures
  fetched_at  timestamptz default now()
);
-- Safe to re-run on an existing DB that predates the signals column.
alter table match_news add column if not exists signals jsonb;

-- ============================================================
-- PREDICTIONS (Claude output, validated before insert)
-- ============================================================

create table if not exists predictions (
  fixture_id      bigint primary key references fixtures(id),
  outcome_probs   jsonb not null,               -- { home_win, draw, away_win }
  scoreline_lean  text,
  confidence      text check (confidence in ('low','medium','high')),
  player_to_watch jsonb,                         -- { player_id, name, reason }
  key_factors     jsonb,                         -- array of 3 strings
  rationale       text not null,
  model           text,
  status          text default 'published',      -- published | review | failed
  generated_at    timestamptz default now(),
  -- Richer markets layer (added later; nullable so pre-existing rows still read).
  goals_market     jsonb,                          -- { both_teams_to_score:{pick,probability}, over_under_2_5:{pick,probability} }
  best_angle       jsonb,                          -- { label, reason } - the single strongest call
  risk_level       text check (risk_level in ('safe','medium','high','avoid')),
  what_could_change jsonb                          -- array of 2-4 strings
);
create index if not exists idx_predictions_status on predictions(status);

-- Safe to re-run on a DB created before the markets layer existed.
alter table predictions add column if not exists goals_market jsonb;
alter table predictions add column if not exists best_angle jsonb;
alter table predictions add column if not exists risk_level text;
alter table predictions add column if not exists what_could_change jsonb;
-- The check constraint is added separately so the alter is idempotent-friendly.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'predictions_risk_level_check'
  ) then
    alter table predictions
      add constraint predictions_risk_level_check
      check (risk_level is null or risk_level in ('safe','medium','high','avoid'));
  end if;
end $$;

-- ============================================================
-- ACCURACY TRACKER
-- Final scores live on the fixture; graded outcomes are SNAPSHOTTED into
-- prediction_results so they survive a prediction row being overwritten.
-- ============================================================

-- Final score columns on fixtures (nullable; only set once a match finishes).
alter table fixtures add column if not exists home_goals int;
alter table fixtures add column if not exists away_goals int;
alter table fixtures add column if not exists finished_at timestamptz;

create table if not exists prediction_results (
  fixture_id        bigint primary key references fixtures(id),
  home_goals        int not null,
  away_goals        int not null,
  predicted_outcome text not null,                 -- home_win | draw | away_win (the lean)
  actual_outcome    text not null,                 -- home_win | draw | away_win
  winner_correct    boolean not null,
  btts_pick         text,                           -- yes | no | null (older predictions have none)
  btts_correct      boolean,                        -- null when no pick was made
  ou_pick           text,                           -- over | under | null
  ou_correct        boolean,
  scoreline_lean    text,
  scoreline_correct boolean not null,
  confidence        text,                           -- snapshot of the prediction confidence
  model             text,                           -- snapshot of the model that produced it
  graded_at         timestamptz default now()
);
create index if not exists idx_prediction_results_graded on prediction_results(graded_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- Public can read published content. Only service role writes.
-- ============================================================

alter table leagues        enable row level security;
alter table venues         enable row level security;
alter table teams          enable row level security;
alter table players        enable row level security;
alter table fixtures       enable row level security;
alter table team_form      enable row level security;
alter table head_to_head   enable row level security;
alter table venue_records  enable row level security;
alter table injuries       enable row level security;
alter table standings        enable row level security;
alter table match_news       enable row level security;
alter table predictions      enable row level security;
alter table prediction_results enable row level security;

-- Public read policies (anon + authenticated).
-- Each is dropped first so the whole file is safe to re-run (create policy is
-- not idempotent and errors if the policy already exists).
drop policy if exists "public read leagues"       on leagues;
create policy "public read leagues"       on leagues       for select using (true);
drop policy if exists "public read venues"        on venues;
create policy "public read venues"        on venues        for select using (true);
drop policy if exists "public read teams"         on teams;
create policy "public read teams"         on teams         for select using (true);
drop policy if exists "public read players"       on players;
create policy "public read players"       on players       for select using (true);
drop policy if exists "public read fixtures"      on fixtures;
create policy "public read fixtures"      on fixtures      for select using (true);
drop policy if exists "public read team_form"     on team_form;
create policy "public read team_form"     on team_form     for select using (true);
drop policy if exists "public read head_to_head"  on head_to_head;
create policy "public read head_to_head"  on head_to_head  for select using (true);
drop policy if exists "public read venue_records" on venue_records;
create policy "public read venue_records" on venue_records for select using (true);
drop policy if exists "public read injuries"      on injuries;
create policy "public read injuries"      on injuries      for select using (true);
drop policy if exists "public read standings"     on standings;
create policy "public read standings"     on standings     for select using (true);
drop policy if exists "public read match_news"    on match_news;
create policy "public read match_news"    on match_news    for select using (true);

-- Predictions: public only sees published ones
drop policy if exists "public read published predictions" on predictions;
create policy "public read published predictions"
  on predictions for select
  using (status = 'published');

-- Graded results are public (they are the trust/accuracy record).
drop policy if exists "public read prediction_results" on prediction_results;
create policy "public read prediction_results"
  on prediction_results for select
  using (true);

-- No insert/update/delete policies are defined for anon/authenticated,
-- so writes are blocked for everyone except the service role key,
-- which bypasses RLS. The cron pipeline must use the service role key.

-- ============================================================
-- HELPER VIEW: upcoming fixtures with prediction status
-- ============================================================

create or replace view upcoming_with_prediction as
select
  f.id          as fixture_id,
  f.kickoff_at,
  ht.name       as home_team,
  at.name       as away_team,
  l.name        as league,
  v.name        as venue,
  (p.fixture_id is not null) as has_prediction,
  p.confidence
from fixtures f
join teams ht on ht.id = f.home_team_id
join teams at on at.id = f.away_team_id
join leagues l on l.id = f.league_id
left join venues v on v.id = f.venue_id
left join predictions p on p.fixture_id = f.id and p.status = 'published'
where f.kickoff_at > now()
order by f.kickoff_at asc;

-- ============================================================
-- HELPER VIEW: graded results enriched with kickoff + league, so the
-- accuracy page can aggregate by league and by month without extra joins.
-- ============================================================

create or replace view prediction_results_enriched as
select
  pr.*,
  f.kickoff_at,
  f.league_id,
  l.name  as league,
  ht.name as home_team,
  at.name as away_team
from prediction_results pr
join fixtures f on f.id = pr.fixture_id
left join leagues l on l.id = f.league_id
left join teams ht on ht.id = f.home_team_id
left join teams at on at.id = f.away_team_id;
