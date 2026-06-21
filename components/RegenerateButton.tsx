"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Internal admin control: re-runs the prediction for a review fixture by calling
 * the CRON_SECRET-protected refresh route. Uses skipIngest=1 so it re-predicts
 * from the cached data already in Supabase (the right move for review rows, and
 * the only safe one for Gemini fixtures, whose synthetic ids have no
 * API-Football data to re-ingest). The secret comes from the page's ?key= gate.
 */
export function RegenerateButton({ fixtureId, secret }: { fixtureId: number; secret: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function regenerate() {
    setState("running");
    setMessage("");
    try {
      const res = await fetch(`/api/refresh/${fixtureId}?skipIngest=1`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` }
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setState("error");
        setMessage(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setState("done");
      setMessage(body.status === "published" ? "published" : `still ${body.status}`);
      // Refresh the list so a now-published fixture drops off the queue.
      router.refresh();
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={regenerate}
        disabled={state === "running"}
        className="rounded-md bg-pitch-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pitch-700 disabled:opacity-50"
      >
        {state === "running" ? "Regenerating..." : "Regenerate"}
      </button>
      {message ? (
        <span
          className={`text-xs ${state === "error" ? "text-rose-600" : "text-slate-500"}`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
