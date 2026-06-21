import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Typed API-Football client (api-sports.io v3).
 *
 * Responsibilities baked in here so callers never have to think about them:
 *  - Daily quota guard: reads the rate-limit headers the API returns and
 *    refuses to fire a request once we are within a safety margin of the
 *    daily cap. This stops us blowing the plan limit mid-run.
 *  - Per-minute pacing: spaces requests so we stay under the minute cap.
 *  - Exponential backoff on 429 (and 5xx), honouring Retry-After when given.
 *  - Surfaces API-level `errors` (api-sports returns 200 with an errors body
 *    for things like an invalid key or an out-of-plan endpoint).
 *
 * Never import this from client components. It is server-only and uses the
 * secret API key.
 */

const BASE_URL = "https://v3.football.api-sports.io";

// Conservative defaults. The real numbers come from response headers once the
// first request lands; until then we assume a small free-tier budget so we do
// not over-fire on a cold process.
const DEFAULT_DAILY_LIMIT = 100;
const DAILY_SAFETY_MARGIN = 5; // stop this many requests short of the cap
const MAX_RETRIES = 4;

// Minimum spacing between requests. The free plan allows only 10 requests per
// minute, so the default of 6500ms (~9/min) stays under it. Paid plans can set
// API_FOOTBALL_MIN_SPACING_MS lower (e.g. 250) for much faster ingest.
const MIN_REQUEST_SPACING_MS = (() => {
  const raw = process.env.API_FOOTBALL_MIN_SPACING_MS;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : 6500;
})();

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export class ApiFootballError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string
  ) {
    super(message);
    this.name = "ApiFootballError";
  }
}

export interface ApiFootballEnvelope<T> {
  get: string;
  parameters: Record<string, string> | unknown[];
  errors: unknown;
  results: number;
  paging: { current: number; total: number };
  response: T[];
}

// Module-level quota state. Lives for the lifetime of the serverless instance,
// which is fine: it is a guard, and the API headers are the source of truth.
const quota = {
  dailyLimit: DEFAULT_DAILY_LIMIT,
  dailyRemaining: DEFAULT_DAILY_LIMIT,
  lastRequestAt: 0
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readIntHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function updateQuotaFromHeaders(headers: Headers): void {
  const limit = readIntHeader(headers, "x-ratelimit-requests-limit");
  const remaining = readIntHeader(headers, "x-ratelimit-requests-remaining");
  if (limit !== null) quota.dailyLimit = limit;
  if (remaining !== null) quota.dailyRemaining = remaining;
}

/** Throws QuotaExceededError if firing another request would risk the daily cap. */
function assertWithinQuota(endpoint: string): void {
  if (quota.dailyRemaining <= DAILY_SAFETY_MARGIN) {
    throw new QuotaExceededError(
      `API-Football daily quota guard tripped before ${endpoint}: ` +
        `${quota.dailyRemaining} of ${quota.dailyLimit} remaining ` +
        `(safety margin ${DAILY_SAFETY_MARGIN}).`
    );
  }
}

async function pace(): Promise<void> {
  const since = Date.now() - quota.lastRequestAt;
  if (since < MIN_REQUEST_SPACING_MS) {
    await sleep(MIN_REQUEST_SPACING_MS - since);
  }
  quota.lastRequestAt = Date.now();
}

function buildUrl(endpoint: string, params: Record<string, string | number>): string {
  const url = new URL(`${BASE_URL}/${endpoint.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Core request. Handles quota guard, pacing, backoff, and error surfacing.
 * Returns the full envelope so callers can inspect paging if needed.
 */
export async function apiFootballGet<T>(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<ApiFootballEnvelope<T>> {
  const url = buildUrl(endpoint, params);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    assertWithinQuota(endpoint);
    await pace();

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "x-apisports-key": serverEnv.apiFootballKey },
        cache: "no-store"
      });
    } catch (networkErr) {
      // transient network issue: back off and retry
      if (attempt === MAX_RETRIES) {
        throw new ApiFootballError(
          `Network error after ${MAX_RETRIES} retries: ${String(networkErr)}`,
          0,
          endpoint
        );
      }
      await sleep(backoffMs(attempt));
      continue;
    }

    updateQuotaFromHeaders(res.headers);

    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_RETRIES) {
        throw new ApiFootballError(
          `${res.status} after ${MAX_RETRIES} retries`,
          res.status,
          endpoint
        );
      }
      const retryAfter = readIntHeader(res.headers, "retry-after");
      // A 429 here usually means the per-minute window is full, so wait long
      // enough for it to roll over rather than hammering with short backoff.
      const wait =
        retryAfter !== null
          ? retryAfter * 1000
          : res.status === 429
            ? Math.max(backoffMs(attempt), MIN_REQUEST_SPACING_MS, 7000)
            : backoffMs(attempt);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      throw new ApiFootballError(`HTTP ${res.status}`, res.status, endpoint);
    }

    const body = (await res.json()) as ApiFootballEnvelope<T>;

    // api-sports returns 200 with a populated `errors` object for things like
    // an invalid key, a missing parameter, or an endpoint outside the plan.
    if (hasApiErrors(body.errors)) {
      throw new ApiFootballError(
        `API error: ${JSON.stringify(body.errors)}`,
        res.status,
        endpoint
      );
    }

    return body;
  }

  // Unreachable, but satisfies the type checker.
  throw new ApiFootballError("exhausted retries", 0, endpoint);
}

/** Convenience wrapper returning just the response array. */
export async function apiFootballList<T>(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const env = await apiFootballGet<T>(endpoint, params);
  return env.response;
}

function hasApiErrors(errors: unknown): boolean {
  if (errors === null || errors === undefined) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors as object).length > 0;
  return Boolean(errors);
}

function backoffMs(attempt: number): number {
  // 0.5s, 1s, 2s, 4s ... with jitter
  const base = 500 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

/** Snapshot of the quota state, for logging or a health endpoint. */
export function getQuotaSnapshot(): { limit: number; remaining: number } {
  return { limit: quota.dailyLimit, remaining: quota.dailyRemaining };
}

/**
 * Run an async mapper over items with bounded concurrency. Used to batch
 * per-fixture or per-team fetches without firing the whole list at once.
 */
export async function mapWithConcurrency<I, O>(
  items: I[],
  concurrency: number,
  mapper: (item: I, index: number) => Promise<O>
): Promise<O[]> {
  const results: O[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
