import type { OutcomeProbs } from "@/lib/types";

/**
 * Shows the three outcome probabilities as a single stacked bar plus a legend.
 * These are model probabilities, not odds. No betting framing.
 */
export function ProbabilityBar({
  probs,
  homeTeam,
  awayTeam
}: {
  probs: OutcomeProbs;
  homeTeam: string;
  awayTeam: string;
}) {
  const segments = [
    { key: "home", label: homeTeam, value: probs.home_win, color: "bg-pitch-500" },
    { key: "draw", label: "Draw", value: probs.draw, color: "bg-slate-400" },
    { key: "away", label: awayTeam, value: probs.away_win, color: "bg-sky-500" }
  ];

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${s.value}%` }}
            aria-label={`${s.label} ${s.value} percent`}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {segments.map((s) => (
          <div key={s.key}>
            <div className="text-lg font-semibold tabular-nums">{s.value}%</div>
            <div className="truncate text-xs text-slate-500" title={s.label}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
