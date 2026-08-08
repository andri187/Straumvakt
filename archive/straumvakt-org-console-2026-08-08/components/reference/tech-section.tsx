import type { ReactNode } from "react";
import { Zap, Radio } from "lucide-react";

// Reference-page chrome that mirrors the Technical Read tab (the iframed
// zaptec-test tech view). Each reference card declares its source — Zaptec /
// Easee REST API, OCPP protocol, or both. Inside, rows are label + brief
// info (NOT live values) — these pages document what every field would
// carry, not actual telemetry.

export type SourceKind = "api" | "ocpp" | "both" | "none";

export function TechSection({
  title,
  source,
  hint,
  className,
  children,
}: {
  title: string;
  source: SourceKind;
  hint?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={
        "rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur " +
        (className ?? "")
      }
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink-50">{title}</h3>
        {source !== "none" ? <SourceBadge source={source} /> : null}
        {hint ? (
          <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
            {hint}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function SourceBadge({ source }: { source: SourceKind }) {
  if (source === "none") return null;
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
  const title =
    source === "api"
      ? "Source: vendor REST API"
      : "Source: OCPP gateway (CSMS path)";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-brand ring-1 ring-inset " +
        cls
      }
      title={title}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

// A row showing field-label + brief description (NOT a live value). The doc
// pages use these where the Technical Read tab would otherwise show actual
// telemetry — making this the field-by-field reference companion.
export function InfoRow({
  label,
  info,
  mono,
}: {
  label: string;
  info: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 py-1 last:border-0">
      <dt className={mono ? "shrink-0 font-mono text-[11px] text-ink-200" : "shrink-0 text-[11px] text-ink-500"}>
        {label}
      </dt>
      <dd className="text-right text-[11px] italic text-ink-300">{info}</dd>
    </div>
  );
}

// Grouped info card — used when a section has many label/info rows under a
// shared subhead. Internally same shape as InfoRow, just with a heading on
// top.
export function InfoGroup({
  title,
  rows,
}: {
  title?: string;
  rows: Array<{ label: string; info: string; mono?: boolean }>;
}) {
  return (
    <div>
      {title ? (
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
          {title}
        </p>
      ) : null}
      <dl className="space-y-0">
        {rows.map((r) => (
          <InfoRow key={r.label} label={r.label} info={r.info} mono={r.mono} />
        ))}
      </dl>
    </div>
  );
}

// Tiny placeholder row that mirrors the OCPP-disconnected style on the
// Technical Read — used inside reference cards where the section structure
// is documented but no live data exists. Italic + dim, with a tooltip on
// the trailing hint.
export function PlaceholderRow({
  label,
  hint,
  trailing = "would render here",
}: {
  label: string;
  hint?: string;
  trailing?: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 py-1.5 last:border-0"
      title={hint}
    >
      <span className="text-[11px] text-ink-500">{label}</span>
      <span className="font-mono text-[11px] italic text-ink-600">{trailing}</span>
    </div>
  );
}
