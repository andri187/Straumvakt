import type { ComponentType } from "react";
import {
  Building2,
  Briefcase,
  Home,
  MapPin,
  Package,
  Cable,
  Plug,
  Radio,
  Zap,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type TierRow = {
  tier: string;
  v3Entity: string;
  icon: ComponentType<{ className?: string }>;
  source: "live" | "derived" | "pending";
  primary: string;
  secondary?: string;
  details?: { label: string; value: string }[];
  badge?: string; // e.g. "credential boundary"
};

export function SvHierarchy({ rows }: { rows: TierRow[] }) {
  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-4 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Straumvakt asset hierarchy
        </h3>
        <span className="ml-auto flex items-center gap-3 text-[10px] uppercase tracking-brand">
          <Legend dot="bg-sv-green" label="Zaptec live" />
          <Legend dot="bg-sv-sky" label="Derived" />
          <Legend dot="bg-ink-500" label="Pending" />
        </span>
      </header>

      <ol className="relative space-y-0 before:absolute before:left-[19px] before:top-3 before:h-[calc(100%-24px)] before:w-px before:bg-bg-border">
        {rows.map((r, i) => (
          <TierItem key={r.tier} row={r} isLast={i === rows.length - 1} />
        ))}
      </ol>
    </section>
  );
}

function TierItem({ row, isLast }: { row: TierRow; isLast: boolean }) {
  const Icon = row.icon;
  const dotCls =
    row.source === "live"
      ? "bg-sv-green/15 text-sv-green ring-sv-green/30"
      : row.source === "derived"
        ? "bg-brand-500/15 text-sv-sky ring-brand-500/30"
        : "bg-ink-600/20 text-ink-400 ring-ink-500/30";

  return (
    <li className={cn("relative flex items-start gap-4", !isLast && "pb-4")}>
      <span
        className={cn(
          "z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
          dotCls,
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 rounded-md border border-bg-border bg-bg-inset/50 p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
            {row.tier}
          </span>
          <span className="text-[10px] text-ink-500">
            <span className="font-mono">{row.v3Entity}</span>
          </span>
          {row.badge ? (
            <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-yellow-300 ring-1 ring-inset ring-yellow-500/30">
              <KeyRound className="mr-1 inline h-2.5 w-2.5" />
              {row.badge}
            </span>
          ) : null}
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand ring-1 ring-inset",
              row.source === "live"
                ? "bg-sv-green/10 text-sv-green ring-sv-green/30"
                : row.source === "derived"
                  ? "bg-brand-500/10 text-sv-sky ring-brand-500/30"
                  : "bg-ink-600/20 text-ink-400 ring-ink-500/30",
            )}
          >
            {row.source === "live"
              ? "Zaptec"
              : row.source === "derived"
                ? "Derived"
                : "Pending"}
          </span>
        </div>
        <div className="mt-1.5">
          <span
            className={cn(
              "text-sm font-semibold",
              row.source === "pending" ? "italic text-ink-400" : "text-ink-50",
            )}
          >
            {row.primary}
          </span>
          {row.secondary ? (
            <span className="ml-2 text-xs text-ink-400">{row.secondary}</span>
          ) : null}
        </div>
        {row.details?.length ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            {row.details.map((d) => (
              <div key={d.label} className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-500">{d.label}</dt>
                <dd className="truncate text-right font-mono text-ink-300">
                  {d.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </li>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-400">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

// ── Iconography map for callers ────────────────────────────────────────────
export const TierIcons = {
  Org: Building2,
  ChargerHost: Briefcase,
  Property: Home,
  Site: MapPin,
  Installation: Package,
  Circuit: Cable,
  Charger: Plug,
  OCPPIdentity: Radio,
  Connector: Zap,
} as const;
