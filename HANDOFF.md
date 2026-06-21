# Handoff Prompt — Football Prediction Platform

Paste this whole file into a new Claude Code session, run from the project root
(`c:\Users\Admin\Desktop\prediction`). It is the full context plus the prioritized
backlog (items 1 to 9). Do the work in order unless I say otherwise. Stop and show me a
plan before large or irreversible steps (deploys, key rotation, deleting data).

---

## 0. Read these first (binding)

- `prompts/CLAUDE.md` is the project constitution. Every rule in it is binding.
- `prompts/prediction.md` is the exact prompt sent to the prediction models.
- `README.md` documents setup and how the system works.
- This is a football PREDICTION platform (analysis only, never betting). No stakes, no odds
  shown to users, no wager language. Predictions are labelled analysis, never guarantees. A
  disclaimer ("Data-driven analysis, not betting advice.") must appear on every prediction
  view. No em dashes in any generated copy or UI text. Pages read from Supabase only and
  never call an external data API on render.

## 1. Current state (already built and verified live)

Stack: Next.js 14 App Router + TypeScript + Tailwind, Supabase (Postgres + RLS),
API-Football (api-sports.io), Anthropic Claude + OpenAI for reasoning, Google Gemini for
fixtures, Tavily for news. Deploy target Vercel. `npm run typecheck` and `npm run build`
are both green.

Pipeline that works end to end (proven against real data, e.g. Netherlands vs Sweden, World
Cup 2026):

- Ingest from API-Football (quota-aware client) OR from Gemini (alternative fixtures source).
- Tavily pulls recent match news, stored and fed into the prediction as labelled context.
- Prediction provider chain: Claude primary, OpenAI fallback. Output is validated in code
  (strip fences, JSON.parse, probs are integers summing to exactly 100, player_to_watch
  player id exists in payload unless there is no player data, key_factors is 3 strings,
  rationale non-empty). Valid -> published; all providers fail -> stored as `review`, never
  malformed-published.
- Next.js UI: fixtures index grouped by date (from the `upcoming_with_prediction` view), and
  a match page with the verdict, mandatory disclaimer, player-to-watch card, and expandable
  verifiable sections (squads, form, H2H, venue, injuries, standings, latest news).

### File map

- Config/env: `lib/env.ts` (throws loudly on any missing var), `lib/config/leagues.ts`.
- Supabase clients: `lib/supabase/server.ts` (service role, writes), `lib/supabase/browser.ts`
  (anon), `lib/supabase/read.ts` (anon, RLS, used by pages, forces fetch `no-store`).
- Types: `lib/types.ts` (hand-written `Database` type plus domain types).
- API-Football: `lib/apiFootball/client.ts` (backoff, daily quota guard, per-request spacing,
  concurrency), `lib/apiFootball/types.ts`.
- Ingest: `lib/ingest/reference.ts` (leagues/teams/players), `lib/ingest/match-data.ts`
  (fixtures/form/h2h/venue/injuries/standings), `lib/ingest/run.ts` (orchestrator +
  single-fixture refresh), `lib/ingest/demo.ts` (free-plan historical demo),
  `lib/ingest/gemini.ts` (Gemini fixtures with synthetic ids), `lib/ingest/news.ts` (Tavily).
- Gemini: `lib/gemini/fixtures.ts`. Tavily: `lib/tavily/client.ts`.
- Prediction: `lib/prediction/payload.ts` (assembles the user message from cached data),
  `lib/prediction/prompt.ts` (system prompt + model constants), `lib/prediction/validate.ts`,
  `lib/prediction/generate.ts` (Claude->OpenAI provider chain + store), `lib/prediction/select.ts`.
- Auth: `lib/auth/cron.ts` (CRON_SECRET bearer check). Format helpers: `lib/format.ts`.
- Page data: `lib/data/match.ts`.
- UI: `app/layout.tsx`, `app/page.tsx` (fixtures index), `app/match/[fixtureId]/page.tsx`,
  `components/Disclaimer.tsx`, `ConfidenceBadge.tsx`, `ProbabilityBar.tsx`, `Expandable.tsx`,
  `MatchSections.tsx`.
- Routes: `app/api/cron/predict/route.ts` (daily: API-Football ingest then predict),
  `app/api/refresh/[fixtureId]/route.ts` (manual single fixture, `?skipIngest=1` to only
  re-predict), `app/api/demo/seed/route.ts` (historical demo), `app/api/gemini/seed/route.ts`
  (Gemini fixtures + Tavily news + predict). All POST except cron predict is GET. All
  protected by CRON_SECRET (Bearer token or `x-cron-secret` header).
- Cron config: `vercel.json`. Schema: `prompts/schema.sql`.

### Supabase tables (run `prompts/schema.sql` in the SQL editor if a fresh DB)

`leagues, venues, teams, players, fixtures, team_form, head_to_head, venue_records, injuries,
standings, match_news, predictions` plus view `upcoming_with_prediction`. RLS: public read on
all supporting data and on `predictions` only where `status='published'`; writes are
service-role only. If the live DB predates a table (standings, match_news were added later),
re-running the relevant `create table if not exists` block is safe.

### Environment (`.env.local`, all present and working locally)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`API_FOOTBALL_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, `OPENAI_API_KEY`,
`CRON_SECRET`. Optional: `API_FOOTBALL_MIN_SPACING_MS` (default 6500), `OPENAI_PREDICTION_MODEL`
(default gpt-4o). The CRON_SECRET value is in `.env.local`; use it for the curl commands below.

### Critical gotchas (do not re-break these)

- Supabase Row types in `lib/types.ts` MUST be `type` aliases, not `interface` (an interface
  has no implicit index signature and collapses every query result to `never`). Insert types
  make `id, created_at, fetched_at, generated_at` optional via the `Insertable` helper.
- Pages read through `lib/supabase/read.ts` which sets fetch `cache: "no-store"`, because
  Next.js caches GET fetches by default and would serve stale (even empty) rows otherwise.
- Free API-Football plan: only seasons 2021-2023, the `last` parameter is blocked, the `page`
  parameter is capped at 3, and the rate limit is 10 requests/minute. The client default
  spacing of 6500ms respects this. `lib/config/leagues.ts` currently targets season 2025 which
  the free plan cannot read; the demo and Gemini paths exist because of this.
- Gemini-sourced fixtures use deterministic synthetic ids (>= 8e9) and carry NO API-Football
  stats, so their predictions are news-only, low confidence, with a placeholder
  player_to_watch. That is expected, not a bug.

### How to run and test locally

```bash
npm run dev            # serves on http://localhost:3000 (or next free port)
npm run typecheck
npm run build
npm test               # vitest run (41 guardrail tests, no live APIs)
```

Trigger jobs (replace TOKEN with the CRON_SECRET from .env.local; adjust the port):

```bash
# Gemini fixtures + Tavily news + signals + predictions (the live path on the free plan).
# Now also answers GET (Vercel Cron). The seed extracts news-derived signals per fixture.
curl -X POST -H "Authorization: Bearer TOKEN" http://localhost:3000/api/gemini/seed
# Historical demo on the free plan
curl -X POST -H "Authorization: Bearer TOKEN" http://localhost:3000/api/demo/seed
# Daily API-Football job (needs a plan/season with upcoming fixtures)
curl -H "Authorization: Bearer TOKEN" http://localhost:3000/api/cron/predict
# Regenerate one fixture (optionally skip re-ingest)
curl -X POST -H "Authorization: Bearer TOKEN" "http://localhost:3000/api/refresh/<id>?skipIngest=1"
# Stale-data cleanup: DRY RUN by default (counts only), apply=1 to delete. scope=synthetic default.
curl -H "Authorization: Bearer TOKEN" "http://localhost:3000/api/cron/cleanup?days=7"
curl -H "Authorization: Bearer TOKEN" "http://localhost:3000/api/cron/cleanup?days=7&apply=1"
```

Internal admin (no public nav, gated by the secret in the URL):

```
http://localhost:3000/admin/review?key=<CRON_SECRET>   # review queue + regenerate buttons
```

### Progress so far (paste-in continuation state)

Done this far: backlog items 1, 2, 4, 5, 6, 7 (details under each item below). `npm run typecheck`,
`npm run build`, and `npm test` are all green.

- Item 1: daily cron points at `/api/gemini/seed` (GET + POST) in `vercel.json`.
- Item 2: deployed to Vercel with Production and Preview env vars, live database compatibility
  verified, production seed verified, and all three crons registered from `vercel.json`.
- Item 4: news-derived signals for stats-less Gemini fixtures (`match_news.signals`,
  `lib/ingest/news-signals.ts`, payload + UI integration).
- Item 5: `/admin/review?key=<CRON_SECRET>` review queue with regenerate.
- Item 6: `/api/cron/cleanup` (dry-run-first), wired as a weekly synthetic-scope cron.
- Item 7: Vitest suite, `npm test`.

Remaining: items 3 (rotate keys), 8 (phase-1 features), 9 (logging/alerting).

NEW gotchas introduced this session (do not miss on deploy):
- The live Supabase DB needs the new column before the new code writes to it:
  `alter table match_news add column if not exists signals jsonb;` (already in `prompts/schema.sql`).
- `vercel.json` has 3 crons incl. `/api/cron/cleanup?apply=1&days=7` (Sunday 04:00). It is
  synthetic-scope by default, so it only ever removes throwaway Gemini rows, never real data.
- Production is live at `https://prediction-sage-seven.vercel.app`. Deployment
  `dpl_Cpz5tSNkc6QWTMffGYzSAjnJG3nK` was verified Ready on 2026-06-21.
- The Vercel account is on Hobby. Current Vercel limits allow 300-second functions with Fluid
  Compute. The old 60-second warning is no longer current; the verified seed took 143 seconds.
- `lib/types.ts` `Insertable` now makes nullable columns optional on insert (so a news re-ingest
  does not clobber `signals`). Row types are still `type` aliases (the never-collapse gotcha).
- Several `payload.ts` formatters are now exported for tests; keep them exported.

---

## The backlog (do in order)

### 1. Point the daily cron at the path that actually has data  [DONE]

Done: `app/api/gemini/seed/route.ts` now answers GET (Vercel Cron) as well as POST, sharing one
`runSeed` handler, still CRON_SECRET protected. `vercel.json` schedules `/api/gemini/seed` at
06:00 UTC and keeps `/api/cron/predict` at 07:00 for a future paid API-Football plan. Vercel
still needs the `CRON_SECRET` env var set so it is sent as the bearer token (part of item 2).

Problem: `vercel.json` schedules `/api/cron/predict`, which ingests from API-Football. On the
free plan that returns zero current-season fixtures, so the scheduled job produces nothing.
The working live path is Gemini + Tavily (`/api/gemini/seed`).

Do: decide and wire the daily schedule. Recommended: add a cron entry for `/api/gemini/seed`
(it is a POST; Vercel Cron sends GET, so either add a GET handler to that route or create a
thin GET wrapper, keeping CRON_SECRET protection). Keep `/api/cron/predict` too if a paid
API-Football plan is added later. Make sure both are CRON_SECRET protected and that Vercel
sends the secret (set the `CRON_SECRET` env var in Vercel so it is sent as the Bearer token).

Acceptance: the scheduled job, when it runs, ingests current fixtures and publishes
predictions. Confirm by reading the route response shape.

### 2. Deploy to Vercel  [DONE]

Done (2026-06-21):

- Created and linked the Vercel project `prediction`.
- Added all nine `.env.local` variables to Production and Preview. Secret values were not
  committed or printed. `CRON_SECRET` is configured for Vercel Cron bearer authentication.
- Verified the live database already exposes `match_news.signals`; no schema mutation was
  required during deployment.
- Deployed production at `https://prediction-sage-seven.vercel.app` and confirmed deployment
  `dpl_Cpz5tSNkc6QWTMffGYzSAjnJG3nK` is Ready.
- Verified the fixtures index and a match page return HTTP 200, the prediction disclaimer is
  visible, and an unauthenticated Gemini seed returns HTTP 401.
- Ran an authenticated production Gemini seed successfully in 143 seconds: 8 fixtures, 8 news
  fetches, 8 signal extractions, 8 published predictions, 0 review items, and 0 errors.
- `vercel.json` deployed with the Gemini daily cron, API-Football daily cron, and weekly
  synthetic-only cleanup cron.

Note: current Vercel documentation lists a 300-second maximum duration for Hobby with Fluid
Compute, so the previously documented 60-second cap did not apply to this deployment.

Do: deploy the app. Add every env var from `.env.local` into the Vercel project settings
(production + preview). Note `maxDuration = 300` on the seed/cron routes requires the Vercel
Pro plan; on Hobby the limit is 60s and the multi-fixture seed will time out, so either
upgrade, lower the per-run fixture count, or split the work. Verify the deployed URL renders
the fixtures index and a match page, and that a manual authenticated cron call works in prod.

Acceptance: public URL live, env complete, one successful authenticated job run in prod,
cron registered.

### 3. Rotate all API keys

Reason: Anthropic, OpenAI, Tavily, Gemini, and the Supabase secret key were pasted in chat
during development and should be considered exposed.

Do: rotate each key in its provider console, update `.env.local` and the Vercel env, and
confirm the app still runs. Regenerate `CRON_SECRET` too and update everywhere. Do not commit
secrets. Treat this as outward-facing; confirm before changing anything shared.

Acceptance: new keys in place locally and in Vercel, old keys revoked, app still works.

### 4. Resolve the stats gap for Gemini-sourced fixtures  [DONE via (b)]

Done (approach b, news-derived signals):

- `match_news` gained a `signals jsonb` column (schema.sql + `MatchNewsRow` in `lib/types.ts`).
- `lib/ingest/news-signals.ts` `extractNewsSignals(fixtureId)` runs only for synthetic
  (Gemini) fixtures, turns the stored Tavily news into validated structured signals
  (`home/away_form_summary`, `key_players[]`, `injuries[]`) via OpenAI gpt-4o-mini, and saves
  them. `validateNewsSignals` is the guardrail for the new fields (drops bad entries, strips
  em dashes, caps counts).
- `lib/ingest/gemini.ts` now exports `stableId`, `SYNTHETIC_ID_BASE`, and `isSyntheticId`.
- `lib/prediction/payload.ts`: when a fixture has no real squad but has signals, it renders
  news-derived key players with deterministic synthetic ids (added to `validPlayerIds` so the
  validator accepts a real player_to_watch), plus news form summaries and news injuries, all
  labelled external context, with a NOTE telling the model to keep confidence low/medium.
- `Insertable` in `lib/types.ts` now treats nullable columns as optional on insert, so a news
  re-ingest never clobbers `signals`.
- Wired into the Gemini seed loop (`app/api/gemini/seed/route.ts`), which now reports a
  `signals` summary.

Also done: the match page surfaces the signals so the verdict stays verifiable. `FormList`
falls back to the news-derived form summary (labelled "From recent news") when there is no
last-5 data, and `InjuriesList` falls back to the news-derived injuries (labelled "from recent
news"). Wired in `app/match/[fixtureId]/page.tsx` from `view.news.signals`.

Original problem: Gemini fixtures have no squad/form/standings, so predictions are news-only and
low confidence with a "No player data" placeholder.

Pick one (ask me if unsure):
- (a) Upgrade API-Football to a paid plan, set `lib/config/leagues.ts` to the current season,
  and rely on the existing stats-rich ingest. Best quality. The normal cron path then works.
- (b) Enrich from news: have a model (OpenAI or Gemini) extract structured signals (recent
  form, key players, injuries) from the Tavily results into the payload, so news-only
  fixtures still get a player_to_watch and richer reasoning. Keep the "external context"
  labelling and the no-betting / no-em-dash rules. Add validation for any new structured fields.

Acceptance: Gemini-path predictions either carry real stats (a) or a news-derived
player-to-watch and form summary (b), at justified confidence.

### 5. Review queue page  [DONE]

Done: `app/admin/review/page.tsx` is a server component gated by `?key=<CRON_SECRET>` (compared
with the new `matchesCronSecret` helper in `lib/auth/cron.ts`; a wrong/missing key renders 404).
It reads `status='review'` rows with the service-role client (bypassing RLS), batch-joins
fixture/team/league names, and shows each fixture with its recorded error reasons (from
`key_factors`). `components/RegenerateButton.tsx` (client) POSTs to
`/api/refresh/<id>?skipIngest=1` with the bearer secret and `router.refresh()`es on success, so
a now-published fixture drops off the queue. Not in public nav, `robots: noindex`. `skipIngest=1`
is deliberate: it re-predicts from cached data, the only safe path for synthetic Gemini fixtures.

Problem: predictions that fail all providers are stored as `status='review'` and are hidden
by RLS, with no way to see or re-run them except by guessing fixture ids.

Do: build an admin view (for example `/admin/review`) gated by CRON_SECRET (or a simple
server-side check; no public access) that lists `review` rows with their fixture, the recorded
error reasons (stored in `key_factors` for review rows), and a button that calls
`/api/refresh/<id>` to regenerate. Reads of `review` rows need the service-role client, not the
anon client. Keep it out of the public nav. No betting language, disclaimer not required on an
internal tool but keep copy neutral.

Acceptance: I can see every review fixture and regenerate it from the UI.

### 6. Stale-data cleanup and dedupe  [DONE]

Done (no deletes have been run): `lib/maintenance/cleanup.ts` + `app/api/cron/cleanup/route.ts`
(GET, CRON_SECRET protected). DRY RUN BY DEFAULT; deletes only with `apply=1`.
- Removes fixtures with kickoff older than `days` (default 3) and their fixture-scoped children
  (predictions, match_news, team_form, injuries).
- Removes orphaned SYNTHETIC (Gemini) teams/leagues/venues/players + their children that no
  surviving fixture or team references. Real API-Football reference data is never deleted.
- `scope=synthetic` (default) only treats Gemini fixtures as stale, keeping real past fixtures
  for the future "histories" feature; `scope=all` also removes real past fixtures.
- Deletes run children-before-parents (no FK is ON DELETE CASCADE). Counts come from one
  in-memory snapshot so the dry run matches the apply.
- Usage: `GET /api/cron/cleanup` (dry run) -> review counts -> `?apply=1` to delete. Optional
  `days=` and `scope=` params. Not yet wired into vercel.json crons (left manual until proven).

Verified (2026-06-20) against the live DB: both dry run and apply work, auth returns 401 without
the token, and the reads hit real data. All counts are currently 0 because every fixture is
upcoming (11 total: 8 synthetic, 3 real), so a 0-row apply was a clean no-op and the 11 fixtures
were untouched. The delete branch runs end to end; it simply has nothing to remove until data
goes stale.

Wired into `vercel.json`: weekly `GET /api/cron/cleanup?apply=1&days=7` at 04:00 Sunday, scope
defaults to synthetic so it can only ever remove throwaway Gemini rows (real data is never
deleted). To run a wider or one-off cleanup manually, hit the route with `scope=all` and/or a
different `days`, dry run first (omit `apply=1`). Not transactional (each delete is its own
statement) but FK-safe-ordered and idempotent, so a re-run finishes any partial cleanup.

Problem: past fixtures and old Gemini-created teams/leagues accumulate indefinitely. The
`upcoming_with_prediction` view already hides past fixtures, but the rows persist.

Do: add a maintenance step (a CRON_SECRET route or a SQL function) that removes or archives
fixtures whose kickoff is well in the past and their orphaned supporting rows, and dedupes
Gemini-synthesized teams/leagues where sensible. Be careful with foreign keys (delete children
before parents). Show me the plan before any destructive delete; prefer a dry-run count first.

Acceptance: a safe, repeatable cleanup that keeps the DB from growing without bound.

### 7. Automated tests for the guardrails  [DONE]

Done: Vitest added (`npm test` -> `vitest run`). Config in `vitest.config.ts` aliases `@/` to the
repo root and stubs `server-only` (`tests/stubs/empty.ts`) so server modules import under test.
41 tests across 4 files, no live API calls:
- `tests/validate.test.ts` - `validatePrediction` + `stripFences`: fence stripping, integer
  probs, sum-100, player-id existence incl. the no-player-data placeholder case, key_factors
  length, rationale required, scoreline and confidence shape.
- `tests/gemini-ids.test.ts` - `stableId` determinism, case-insensitivity, synthetic range; and
  `isSyntheticId` boundaries.
- `tests/news-signals.test.ts` - `validateNewsSignals`: null on non-object/array, field
  normalization, dropping bad players, em-dash stripping, count caps. (Hardened the validator to
  reject arrays while writing these.)
- `tests/payload-format.test.ts` - the payload formatters (now exported from `payload.ts`):
  `formatForm`, `formText` news fallback, `rankKeyPlayers`, `formatKeyPlayers`, `buildNewsPlayers`
  synthetic-id minting, `formatNewsPlayers` - empty vs populated data.
Not covered: `assemblePayload`'s DB orchestration (would need a Supabase mock) and the item-6
cleanup planner; the pure formatting and id logic they rely on is unit-tested.

Reason: the validator, payload assembly, and synthetic-id generator are the core IP.

Do: add a test runner (Vitest fits Next + TS) and cover at least: `validatePrediction`
(fence stripping, prob sum must equal 100, integer probs, player-id existence including the
no-player-data case, key_factors length, rationale required), the synthetic `stableId`
determinism and range in `lib/ingest/gemini.ts`, and `assemblePayload` formatting with empty
vs populated data. Add an `npm test` script. Do not call live APIs in tests; mock them.

Acceptance: `npm test` passes and meaningfully exercises the guardrails.

### 8. Deferred Phase-1 backlog (from CLAUDE.md)

Build only when asked, in this rough order: user accounts (Supabase Auth), the "histories"
feature (track prediction accuracy vs actual results over time), search, and multi-language.
Each is its own scoped task; confirm scope before starting. Keep all the non-negotiable rules.

Acceptance: per-feature, agreed before building.

### 9. Light ops: logging and alerting

Do: add structured logging around the cron/seed runs and surface two conditions: predictions
flagged for review, and API-Football quota exhaustion (the client throws `QuotaExceededError`
and exposes `getQuotaSnapshot()`). Wire a simple alert (email or webhook) on those. Keep it
cheap; no heavy observability stack required.

Acceptance: a run that produces review items or trips the quota guard generates a visible
alert, not just a server log line.

---

## Working agreement

- Match the existing code style, comment density, and naming.
- Keep guardrails in code, not prompts. Never add a public write path to the prediction tables.
- After changes, run `npm run typecheck` and `npm run build` before declaring done.
- Confirm before deploys, key rotation, or deleting data.
