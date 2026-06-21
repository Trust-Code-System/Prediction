import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/types";

/**
 * Browser / read-only Supabase client using the ANON key. Subject to RLS, so
 * it can only read published predictions and public supporting data. Never
 * has a write path to the prediction tables.
 */
let cached: SupabaseClient<Database> | null = null;

export function getBrowserClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false }
  });
  return cached;
}
