/**
 * Typed environment config. Fails loudly at first access if a required
 * variable is missing, so we never silently run with a half-configured
 * Supabase, API-Football, or Anthropic connection.
 *
 * Split into public (browser-safe) and server-only groups. Importing
 * `serverEnv` from a client component will surface the missing service-role
 * key immediately rather than at request time.
 */

type EnvRecord = Record<string, string | undefined>;

function read(source: EnvRecord, key: string): string {
  const value = source[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Add it to .env.local (see .env.local.example).`
    );
  }
  return value;
}

/**
 * Public env. Safe to reference in the browser. Next.js inlines
 * NEXT_PUBLIC_* at build time, so these must be referenced by their
 * full literal name for the replacement to work.
 */
export const publicEnv = {
  get supabaseUrl(): string {
    return read(
      { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL },
      "NEXT_PUBLIC_SUPABASE_URL"
    );
  },
  get supabaseAnonKey(): string {
    return read(
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
};

/**
 * Server-only env. Never import this into a client component. Reading any
 * of these in the browser bundle is a configuration error.
 */
export const serverEnv = {
  get supabaseUrl(): string {
    return publicEnv.supabaseUrl;
  },
  get supabaseServiceRoleKey(): string {
    return read(
      { SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY },
      "SUPABASE_SERVICE_ROLE_KEY"
    );
  },
  get apiFootballKey(): string {
    return read({ API_FOOTBALL_KEY: process.env.API_FOOTBALL_KEY }, "API_FOOTBALL_KEY");
  },
  get anthropicApiKey(): string {
    return read({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }, "ANTHROPIC_API_KEY");
  },
  get geminiApiKey(): string {
    return read({ GEMINI_API_KEY: process.env.GEMINI_API_KEY }, "GEMINI_API_KEY");
  },
  get openaiApiKey(): string {
    return read({ OPENAI_API_KEY: process.env.OPENAI_API_KEY }, "OPENAI_API_KEY");
  },
  get tavilyApiKey(): string {
    return read({ TAVILY_API_KEY: process.env.TAVILY_API_KEY }, "TAVILY_API_KEY");
  },
  get cronSecret(): string {
    return read({ CRON_SECRET: process.env.CRON_SECRET }, "CRON_SECRET");
  }
};
