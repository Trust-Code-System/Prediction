import type { OutcomeKey, OutcomeProbs, RiskLevel } from "@/lib/types";

export type { OutcomeKey };

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

/** "2026-06" -> "June 2026" for the accuracy-by-month rows. */
export function formatMonth(key: string): string {
  const [year, month] = key.split("-").map((n) => Number.parseInt(n, 10));
  if (!year || !month) return key;
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
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

/** Display label and Tailwind classes for the risk meter, ordered safe -> avoid. */
export function riskMeta(level: RiskLevel): {
  label: string;
  badge: string;
  fill: string;
  steps: number;
} {
  switch (level) {
    case "safe":
      return { label: "Safe", badge: "bg-pitch-100 text-pitch-700", fill: "bg-pitch-500", steps: 1 };
    case "medium":
      return { label: "Medium", badge: "bg-amber-100 text-amber-700", fill: "bg-amber-500", steps: 2 };
    case "high":
      return { label: "High", badge: "bg-orange-100 text-orange-700", fill: "bg-orange-500", steps: 3 };
    case "avoid":
      return { label: "Avoid", badge: "bg-rose-100 text-rose-700", fill: "bg-rose-500", steps: 4 };
  }
}
