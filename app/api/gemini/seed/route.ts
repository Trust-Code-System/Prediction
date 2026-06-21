import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { UPCOMING_WINDOW_HOURS } from "@/lib/config/leagues";
import { ingestGeminiFixtures } from "@/lib/ingest/gemini";
import { ingestMatchNews } from "@/lib/ingest/news";
import { extractNewsSignals } from "@/lib/ingest/news-signals";
import { predictFixture } from "@/lib/prediction/generate";

/**
 * Gemini + Tavily seed route, CRON_SECRET protected. Sources upcoming fixtures
 * from Gemini (useful when API-Football has no current-season data), pulls
 * recent news for each via Tavily, then generates predictions. Predictions for
 * these fixtures lean on the news plus whatever cached stats exist, at low
 * confidence, since Gemini-sourced fixtures carry no API-Football season stats.
 *
 * This is the live daily path on the free API-Football plan, so it answers both
 * verbs: POST for manual curl runs, GET for Vercel Cron (which only issues GET
 * and sends CRON_SECRET as the bearer token). Both share one handler.
 *
 *   POST /api/gemini/seed   Authorization: Bearer <CRON_SECRET>
 *   GET  /api/gemini/seed   Authorization: Bearer <CRON_SECRET>   (Vercel Cron)
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runSeed(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ingest = await ingestGeminiFixtures(UPCOMING_WINDOW_HOURS);
  const news = { fetched: 0, errors: [] as string[] };
  const signals = { extracted: 0, errors: [] as string[] };
  const predictions = { published: 0, review: 0, total: ingest.fixtures.length };
  const results: Array<{ fixtureId: number; status: string; errors: string[] }> = [];

  for (const f of ingest.fixtures) {
    try {
      await ingestMatchNews(f.id);
      news.fetched++;
    } catch (err) {
      news.errors.push(`fixture ${f.id}: ${(err as Error).message}`);
    }

    // Gemini fixtures carry no API-Football stats, so derive structured signals
    // (form, key players, injuries) from the news before predicting.
    try {
      const s = await extractNewsSignals(f.id);
      if (s.extracted) signals.extracted++;
    } catch (err) {
      signals.errors.push(`fixture ${f.id}: ${(err as Error).message}`);
    }

    try {
      const outcome = await predictFixture(f.id);
      if (outcome.status === "published") predictions.published++;
      else predictions.review++;
      results.push({ fixtureId: f.id, status: outcome.status, errors: outcome.errors });
    } catch (err) {
      predictions.review++;
      results.push({ fixtureId: f.id, status: "error", errors: [(err as Error).message] });
    }
  }

  return NextResponse.json({ ok: true, ingest, news, signals, predictions, results });
}

export async function POST(req: Request) {
  return runSeed(req);
}

export async function GET(req: Request) {
  return runSeed(req);
}
