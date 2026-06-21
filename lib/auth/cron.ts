import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Guards the cron + manual refresh routes. Accepts the secret either as a
 * Bearer token (this is how Vercel Cron sends CRON_SECRET when the env var is
 * set) or via an x-cron-secret header for manual curl calls.
 *
 * Returns true when authorised. Uses a length-safe constant-time-ish compare.
 */
export function isAuthorizedCron(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const headerSecret = req.headers.get("x-cron-secret");
  return matchesCronSecret(bearer ?? headerSecret);
}

/**
 * True when `provided` equals CRON_SECRET. Used to gate the internal admin page
 * via a ?key= query param, where a bearer header is not natural in a browser.
 */
export function matchesCronSecret(provided: string | null | undefined): boolean {
  if (!provided) return false;
  return safeEqual(provided, serverEnv.cronSecret);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
