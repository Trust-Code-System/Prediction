/**
 * Best-effort in-memory sliding-window rate limiter for the public chat endpoint.
 *
 * This stack has no shared KV store, so the window lives in module memory: it is
 * per-instance and resets on cold start, which is acceptable as a courtesy limit
 * to blunt obvious abuse. The hard guarantees against runaway cost are the input
 * caps in validate.ts and the bounded max_tokens, not this limiter. If abuse
 * becomes real, swap this for a KV-backed limiter behind the same signature.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 15;

// key -> timestamps (ms) of requests still inside the window.
const hits = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds to wait before retrying, when not allowed. */
  retryAfter: number;
}

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= MAX_REQUESTS) {
    hits.set(key, recent);
    const oldest = recent[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfter };
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistically prune empty/stale keys so the map cannot grow unbounded.
  if (hits.size > 5000) {
    for (const [k, ts] of hits) {
      const live = ts.filter((t) => t > cutoff);
      if (live.length === 0) hits.delete(k);
      else hits.set(k, live);
    }
  }

  return { allowed: true, retryAfter: 0 };
}
