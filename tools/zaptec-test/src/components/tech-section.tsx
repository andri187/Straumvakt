import type { ReactNode } from "react";
import { Zap, Radio, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";

// Chrome wrapper for tech-view sections. Source label lives here, not on
// individual rows (research P3). When OCPP is disconnected, the section
// renders with a muted "disconnected" pill + dashed border so the page
// doesn't feel broken (P4).

export type SourceKind = "api" | "ocpp" | "both";
export type ConnectionState =
  | { kind: "connected" }
  | { kind: "stale"; lastSeen?: string }
  | { kind: "disconnected"; reason?: string };

export function TechSection({
  title,
  source,
  state = { kind: "connected" },
  hint,
  className,
  children,
}: {
  title: string;
  source: SourceKind;
  state?: ConnectionState;
  hint?: string;
  className?: string;
  children?: ReactNode;
}) {
  const disconnected = state.kind === "disconnected";

  return (
    <section
      className={cn(
        "rounded-lg p-5 shadow-card backdrop-blur",
        disconnected
          ? "border border-dashed border-bg-border/70 bg-bg-surface/40"
          : "border border-bg-border bg-bg-surface/70",
        className,
      )}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3
          className={cn(
            "text-sm font-semibold",
            disconnected ? "text-ink-300" : "text-ink-50",
          )}
        >
          {title}
        </h3>
        <SourceBadge source={source} />
        <StateBadge state={state} />
        {hint ? (
          <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
            {hint}
          </span>
        ) : null}
      </header>
      <div className={disconnected ? "opacity-70" : ""}>{children}</div>
    </section>
  );
}

export function SourceBadge({ source }: { source: SourceKind }) {
  if (source === "both") {
    return (
      <span className="inline-flex items-center gap-1">
        <SourceBadge source="api" />
        <SourceBadge source="ocpp" />
      </span>
    );
  }
  const cls =
    source === "api"
      ? "bg-sv-green/10 text-sv-green ring-sv-green/30"
      : "bg-brand-500/10 text-sv-sky ring-brand-500/30";
  const Icon = source === "api" ? Zap : Radio;
  const label = source === "api" ? "API" : "OCPP";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-brand ring-1 ring-inset",
        cls,
      )}
      title={
        source === "api"
          ? "Source: Zaptec REST API"
          : "Source: OCPP gateway (CSMS path)"
      }
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function StateBadge({ state }: { state: ConnectionState }) {
  if (state.kind === "connected") return null;
  if (state.kind === "stale") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-yellow-200 ring-1 ring-inset ring-yellow-500/30"
        title={state.lastSeen ? `Last seen ${state.lastSeen}` : "Stale data"}
      >
        <AlertCircle className="h-2.5 w-2.5" />
        stale
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-600/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-ink-400 ring-1 ring-inset ring-ink-500/40">
      <AlertCircle className="h-2.5 w-2.5" />
      disconnected
      {state.reason ? <span className="ml-1 normal-case text-ink-500">· {state.reason}</span> : null}
    </span>
  );
}

// Skeleton row for OCPP-disconnected sections (research P4 — keep structure
// visible so the section reads as "would-be-populated" not "broken").
export function OcppPlaceholderRow({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 py-1.5 last:border-0">
      <span className="text-[11px] text-ink-500">{label}</span>
      <span
        className="font-mono text-[11px] italic text-ink-600"
        title={hint}
      >
        — when connected
      </span>
    </div>
  );
}
