export function Topbar({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-bg-border bg-bg-surface/60 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-ink-100">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {hint ? (
          <span className="hidden text-xs text-ink-400 md:inline">{hint}</span>
        ) : null}
        <span className="rounded-md border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
          Zaptec Live
        </span>
      </div>
    </header>
  );
}
