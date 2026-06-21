import type { OutcomeProbs } from "@/lib/types";

/** Human-readable kickoff, e.g. "Sat 21 Jun, 17:30". No locale surprises. */
export function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** Date-only grouping key, e.g. "Saturday 21 June". */
export function formatDayHeading(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

export type OutcomeKey = "home_win" | "draw" | "away_win";

/** Which outcome the model leans toward, by highest probability. */
export function leadingOutcome(probs: OutcomeProbs): OutcomeKey {
  const entries: Array<[OutcomeKey, number]> = [
    ["home_win", probs.home_win],
    ["draw", probs.draw],
    ["away_win", probs.away_win]
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function leanLabel(
  key: OutcomeKey,
  homeTeam: string,
  awayTeam: string
): string {
  if (key === "home_win") return `${homeTeam} to win`;
  if (key === "away_win") return `${awayTeam} to win`;
  return "Draw";
}
