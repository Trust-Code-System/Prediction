/**
 * Collapsible verifiable section. Uses native <details> so it works without
 * client JS. Default open can be set per section.
 */
export function Expandable({
  title,
  subtitle,
  defaultOpen = false,
  children
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {subtitle}
          <span className="transition-transform group-open:rotate-180">v</span>
        </span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">{children}</div>
    </details>
  );
}
