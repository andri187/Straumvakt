import type { ComponentType } from "react";
import { cn } from "@/lib/cn";

// ── Status pill ─────────────────────────────────────────────────────────────
export function StatusPill({
  tone,
  label,
}: {
  tone: "green" | "blue" | "grey" | "amber" | "red";
  label: string;
}) {
  const cls = {
    green: "bg-sv-green/10 text-sv-green ring-sv-green/25",
    blue: "bg-brand-500/10 text-sv-sky ring-brand-500/25",
    grey: "bg-ink-600/20 text-ink-300 ring-ink-600/40",
    amber: "bg-yellow-500/10 text-yellow-300 ring-yellow-500/25",
    red: "bg-red-500/10 text-red-300 ring-red-500/25",
  }[tone];
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-brand ring-1 ring-inset",
        cls,
      )}
    >
      {label}
    </span>
  );
}

// ── Stat card ───────────────────────────────────────────────────────────────
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "muted",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "blue" | "muted";
}) {
  const accent = {
    green: "text-sv-green",
    blue: "text-sv-sky",
    muted: "text-ink-300",
  }[tone];
  return (
    <div className="rounded-lg border border-bg-border bg-bg-surface/70 p-4 shadow-card backdrop-blur">
      <div className="flex items-center gap-2 text-xs uppercase tracking-brand text-sv-sky">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn("mt-2 text-lg font-semibold tabular-nums", accent)}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-ink-400">{sub}</div> : null}
    </div>
  );
}

// ── Info card ───────────────────────────────────────────────────────────────
export function InfoCard({
  icon: Icon,
  title,
  rows,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  rows: [string, string][];
}) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">{title}</h3>
      </header>
      <dl className="space-y-2 text-xs">
        {rows.map(([k, v]) => (
          <Row key={k} label={k} value={v} />
        ))}
      </dl>
    </div>
  );
}

export function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-bg-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-ink-400">{label}</dt>
      <dd
        className={cn(
          "truncate text-right text-ink-200",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ── Formatters ──────────────────────────────────────────────────────────────
export function fmtPower(watts: number): string {
  if (watts >= 1000) return `${(watts / 1000).toFixed(2)} kW`;
  return `${watts.toFixed(0)} W`;
}

export function fmtDeviceType(n: number | undefined): string {
  switch (n) {
    case 1:
      return "Smart";
    case 2:
      return "Portable";
    case 3:
      return "Home APM";
    case 4:
      return "Apollo";
    case 5:
      return "Other APM";
    case 6:
      return "Generic APM";
    default:
      return n != null ? `Type ${n}` : "—";
  }
}

export function fmtNetworkType(n: number | null | undefined): string {
  switch (n) {
    case 0:
      return "Unknown";
    case 1:
      return "IT-1ph";
    case 2:
      return "IT-3ph";
    case 3:
      return "TN-1ph";
    case 4:
      return "TN-3ph";
    default:
      return n != null ? `Type ${n}` : "—";
  }
}

export function fmtDate(s: string | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return s;
  }
}

export function fmtAgo(s: string | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const ms = Date.now() - d.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  return `${day} d ago`;
}
