/**
 * Mandatory disclaimer. Per the project constitution this must appear on every
 * prediction view. Do not remove it from a prediction page.
 */
export function Disclaimer() {
  return (
    <div
      role="note"
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
    >
      Data-driven analysis, not betting advice.
    </div>
  );
}
