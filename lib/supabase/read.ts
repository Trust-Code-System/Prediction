import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/types";

/**
 * Read-only Supabase client using the ANON key. Safe in server components and
 * the browser. Subject to RLS, so it only ever sees published predictions and
 * public supporting data. Pages use this; they never touch the service client
 * or API-Football.
 */
let cached: SupabaseClient<Database> | null = null;

export function getReadClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false },
    // Next.js patches global fetch and caches GET requests by default. Supabase
    // reads go through fetch, so without this the pages would serve stale rows
    // (for example an empty list cached before data was ingested). Force
    // no-store so pages always read live data.
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
    }
  });
  return cached;
}
