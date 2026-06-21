import "server-only";
import { serverEnv } from "@/lib/env";
import type { NewsItem } from "@/lib/types";

/**
 * Thin Tavily web-search client (REST, no SDK). Used to pull recent match news
 * (team news, injuries, probable lineups) that feeds the prediction as labelled
 * external context and is shown to users.
 */

const TAVILY_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function tavilySearch(query: string, maxResults = 5): Promise<NewsItem[]> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      api_key: serverEnv.tavilyApiKey,
      query,
      search_depth: "basic",
      topic: "news",
      days: 14,
      max_results: maxResults,
      include_answer: false
    })
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as TavilyResponse;
  const results = body.results ?? [];

  return results
    .filter((r): r is TavilyResult & { url: string } => typeof r.url === "string")
    .map((r) => ({
      title: r.title?.trim() || "Untitled",
      url: r.url,
      content: (r.content ?? "").trim().slice(0, 600),
      published_date: r.published_date ?? null,
      source: hostname(r.url)
    }));
}
