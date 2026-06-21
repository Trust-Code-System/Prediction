# Football Prediction Platform

Data-driven football match analysis. Not a betting product: no stakes, no odds shown to
users, every verdict is explainable against the same numbers the model saw.

Stack: Next.js 14 (App Router) + TypeScript + Tailwind, Supabase (Postgres + RLS),
API-Football (api-sports.io) for data, Anthropic Claude for the reasoning layer, Vercel
for hosting + cron.

Production: [prediction-sage-seven.vercel.app](https://prediction-sage-seven.vercel.app)

> Continuing work? See [HANDOFF.md](HANDOFF.md) for the current state, gotchas, and the
> prioritized backlog (items 1 to 9). It is written to be pasted into a fresh session.

## Setup

1. **Install**: `npm install`
2. **Database**: run `prompts/schema.sql` in the Supabase SQL editor. It creates all tables,
   the RLS policies, the `standings` table, and the `upcoming_with_prediction` view.
3. **Env**: copy `.env.local.example` to `.env.local` and fill every value. The app throws a
   named error on first use if any is missing.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key)
   - `SUPABASE_SERVICE_ROLE_KEY` (secret key, server only, used by ingest + cron)
   - `API_FOOTBALL_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`
   - `OPENAI_API_KEY`, `CRON_SECRET`
4. **Leagues**: edit `lib/config/leagues.ts` to choose which competitions and seasons to
   cover. Keep the list small to respect the API daily quota.
5. **Run**: `npm run dev`

## How it works

- **Ingest (`lib/ingest`)**: a quota-aware API-Football client (backoff on 429, daily quota
  guard, bounded concurrency) fetches leagues, teams, players, fixtures for the next 48h,
  last-5 form, head-to-head, venue records, injuries, and standings, and upserts them into
  Supabase via the service-role client. Pages never call the API.
- **Prediction (`lib/prediction`)**: for each fixture without a fresh prediction, the payload
  is assembled from cached data in the exact shape `prompts/prediction.md` expects, sent to
  Claude (`claude-opus-4-8`, max_tokens 1500), then validated in code: strip fences, JSON
  parse, schema check, probabilities sum to exactly 100, and player_to_watch.player_id must
  exist in the payload. Failures retry up to 3 times, then store as `review` (never a
  malformed `published` row).
- **Presentation (`app`)**: the fixtures index reads `upcoming_with_prediction`; the match
  page shows the verdict (lean, three probabilities, confidence, scoreline), the mandatory
  disclaimer, a player-to-watch card, and expandable verifiable sections for squads, form,
  H2H, venue, injuries, and standings. All reads use the anon key under RLS.

## Endpoints

- `GET /api/gemini/seed` (Bearer `CRON_SECRET`): the live daily path. Ingests current
  fixtures from Gemini, fetches Tavily news, extracts structured signals, and generates
  validated predictions.
- `GET /api/cron/predict` (Bearer `CRON_SECRET`): API-Football daily job. Refreshes the 48h
  window then generates predictions for fixtures lacking a fresh one.
- `GET /api/cron/cleanup` (Bearer `CRON_SECRET`): stale-data cleanup. It is a dry run unless
  `apply=1` is present and defaults to synthetic Gemini fixtures only.
- `POST /api/refresh/<fixtureId>` (Bearer `CRON_SECRET`): re-ingest one fixture's data and
  regenerate its prediction. Add `?skipIngest=1` to only regenerate.
- `POST /api/demo/seed` (Bearer `CRON_SECRET`): historical API-Football demo seed.

Manual trigger example:

```
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/refresh/123456
```

## Demo mode (free API-Football plan)

The free api-sports.io plan exposes only historical seasons (2021-2023), blocks the `last`
parameter, caps `page` at 3, and allows 10 requests/minute. There are no current-season
upcoming fixtures to predict, so a demo path runs the same pipeline against a real historical
Premier League matchday (3 Feb 2024), fetching form and H2H without `last` and shifting the
selected fixtures' kickoff into the near future so they appear as upcoming.

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/demo/seed
```

Then open `/` to see the fixtures and `/match/<id>` for the verdict. The supporting data is
genuine; only the kickoff timestamp is moved. For real current-season predictions, upgrade
the API-Football plan and the normal `/api/cron/predict` flow works as-is. The default request
spacing (`API_FOOTBALL_MIN_SPACING_MS=6500`) keeps under the free plan's rate limit; lower it
on a paid plan.

## Guardrails (in code, not prompts)

- JSON schema validation + probability-sum check + player-id existence check before any
  insert.
- API daily quota guard stops before exceeding the plan limit.
- No write path from public routes to prediction tables (anon key is RLS read-only; only the
  service-role client writes).
- Mandatory disclaimer on every prediction view. No betting or odds language in the UI.

## Notes

- Vercel runs `/api/gemini/seed` daily at 06:00 UTC, `/api/cron/predict` daily at 07:00 UTC,
  and synthetic cleanup every Sunday at 04:00 UTC. Vercel injects `CRON_SECRET` as the
  bearer token for scheduled requests.
- Vercel currently permits a 300-second function duration on Hobby with Fluid Compute. The
  production Gemini seed completed an eight-fixture run in 143 seconds on 21 June 2026.
- Before deploying against an older Supabase database, run
  `alter table match_news add column if not exists signals jsonb;`.
- The `Database` type in `lib/types.ts` uses `type` aliases (not interfaces) for table rows
  on purpose: an interface lacks an implicit index signature and would collapse Supabase
  query results to `never`.
