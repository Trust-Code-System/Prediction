# CLAUDE.md — Football Prediction Platform

## Project role
You are my senior full-stack engineer, sports-data architect, and AI reasoning-system designer. You build a football PREDICTION platform (analysis only, never a betting product). Every prediction must be explainable: the user sees the verdict AND the data that justifies it.

## Non-negotiable rules
1. This is NOT a betting site. No stakes, no wagers, no "place a bet" language, no affiliate odds links on public pages. Predictions are framed as data-driven analysis, never guarantees.
2. The AI proposes predictions. It never presents them as certainty. Every match verdict carries a confidence level and a visible "analysis, not advice" label.
3. AI never writes prediction results straight to the DB unverified. The cron pipeline generates, validates the JSON shape, then commits. Malformed AI output is rejected and retried, never stored half-formed.
4. No betting odds shown to end users even though the data API exposes them. Odds may be used internally as a model signal only.
5. No em dashes anywhere in generated copy or UI text.
6. Cache aggressively. Never call the data API on a public page render. Pages read from Supabase only.

## Stack
- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Supabase (Postgres + RLS) for data + generated predictions
- Node.js cron (Vercel Cron or Supabase Edge scheduled function)
- Data source: API-Football (api-sports.io) as the live data spine
- Reasoning: Anthropic API (Claude) to produce the explained verdict
- Deploy: Vercel

## Data source: API-Football
Covers as many competitions as the plan allows. Key endpoints used:
- /fixtures (by date, by league, by team) -> upcoming matches
- /fixtures/headtohead -> H2H history
- /teams/statistics -> team season form
- /players (by team, by season) -> per-player season stats
- /injuries -> availability
- /standings -> table position context
- /fixtures/lineups -> probable XI when available
Verify the coverage object per league/season before trusting a field. A true flag means supported, but early-tournament data can be sparse.

## Three-layer architecture

### 1. Data layer (ingest + cache)
- Cron pulls fixtures for the next 48h across covered leagues.
- For each fixture, fetch both teams' season stats, last-5 form, H2H, venue record, injuries, standings.
- Store raw payloads in Supabase tables (see schema). TTL/refresh logic so stale data is re-pulled.
- Rate-limit aware: batch calls, respect daily quota, exponential backoff on 429.

### 2. Reasoning layer (Claude)
- Runs once per fixture, day before kickoff, via cron. NEVER per page view.
- Assembles one structured payload per match from cached data.
- Calls Anthropic API with the prediction prompt (see /prompts/prediction.md).
- Claude returns STRICT JSON: outcome probabilities, scoreline lean, player-to-watch, key factors, and a written rationale.
- Pipeline validates JSON shape against a schema. Invalid -> retry up to 3x -> flag for manual review, do not store.
- Stored in `predictions` table keyed to fixture_id.

### 3. Presentation layer (Next.js)
- Match page reads prediction + supporting data from Supabase only.
- Top: the verdict (outcome lean, confidence, one-line summary).
- Below, expandable verifiable sections so users check the AI's claims:
  - Both squads with per-player season stats (goals, assists, mins, shots, xG if available, cards, rating)
  - Last 5 matches form for each team
  - Head-to-head history
  - Venue record (how each team performs at this stadium)
  - Injuries / unavailable players
  - Standings context
- Player-to-watch card with the stat reason.
- Visible disclaimer: data-driven analysis, not betting advice.

## Supabase schema (core tables)
- `leagues` (id, name, country, season, coverage jsonb)
- `teams` (id, name, league_id, logo, venue_id)
- `players` (id, team_id, name, position, season_stats jsonb)
- `fixtures` (id, league_id, home_team_id, away_team_id, kickoff_at, venue_id, status)
- `team_form` (team_id, fixture_id, last5 jsonb, fetched_at)
- `head_to_head` (home_team_id, away_team_id, history jsonb, fetched_at)
- `venue_records` (team_id, venue_id, record jsonb)
- `injuries` (fixture_id, team_id, player_id, reason)
- `predictions` (fixture_id PK, outcome_probs jsonb, scoreline_lean, confidence, player_to_watch jsonb, key_factors jsonb, rationale text, model, generated_at, status)
- RLS: public read on published predictions + supporting data; writes restricted to service role (cron).

## Prediction output contract (Claude must return exactly this JSON)
```json
{
  "outcome_probs": { "home_win": 0, "draw": 0, "away_win": 0 },
  "scoreline_lean": "2-1",
  "confidence": "low | medium | high",
  "player_to_watch": { "player_id": 0, "name": "", "reason": "" },
  "key_factors": ["", "", ""],
  "rationale": "Plain-language explanation referencing the actual stats provided."
}
```
Probabilities sum to 100. Rationale must cite specific numbers from the payload, not generic claims. No betting language.

## Cron schedule
- Daily job, runs ~24h before kickoff window.
- Step 1: refresh fixtures + supporting data for matches in next 48h.
- Step 2: for each fixture without a fresh prediction, assemble payload, call Claude, validate, store.
- Step 3: log failures for manual review.
- Manual re-run endpoint (service-role protected) to regenerate a single fixture.

## Guardrails in code, not prompts
- JSON schema validation on every Claude response before insert.
- Probability-sum check (must equal 100, else reject).
- API quota guard: stop and alert before exceeding daily limit.
- No write path from public routes to prediction tables.
- Disclaimer component is mandatory on every prediction view.

## Phase 1 scope (ship this first)
1. Ingest fixtures + team/player stats for covered leagues.
2. Cron prediction pipeline with Claude + JSON validation.
3. Match prediction page with verdict + all verifiable sections.
4. Fixture list / upcoming matches index.
Defer: user accounts, the "histories" feature, search, multi-language. Build the prediction engine solid first.
