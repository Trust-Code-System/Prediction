import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { Database } from "@/lib/types";

/**
 * Server-side Supabase client using the SERVICE ROLE key. This bypasses RLS
 * and is the only client permitted to write to the prediction and ingest
 * tables. Use it exclusively in route handlers and cron jobs, never in a
 * component that ships to the browser.
 *
 * Lazily instantiated so the missing-env error surfaces on first real use
 * rather than at module import time during the build.
 */
let cached: SupabaseClient<Database> | null = null;

export function getServiceClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return cached;
}
