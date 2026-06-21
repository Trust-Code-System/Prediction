import type { Confidence } from "@/lib/types";

const STYLES: Record<Confidence, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-sky-100 text-sky-700 border-sky-200",
  high: "bg-pitch-100 text-pitch-700 border-pitch-500/30"
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence | null }) {
  const c = confidence ?? "low";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[c]}`}
    >
      {c} confidence
    </span>
  );
}
