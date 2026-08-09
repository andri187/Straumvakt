import type { ReactNode } from "react";

export function ProductError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="org-error" role="alert" aria-live="assertive">
      <strong>Could not load this view</strong>
      <span>{message}</span>
      {onRetry ? (
        <button className="org-button secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function ProductEmpty({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="org-empty" role="status">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function ProductLoading({ label }: { label: string }) {
  return (
    <div className="org-empty" role="status" aria-live="polite" aria-busy="true">
      <span className="org-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ContractGate({
  id,
  eyebrow,
  title,
  detail,
  action,
  tone = "blocked",
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  detail: string;
  action: string;
  tone?: "blocked" | "unsafe";
  children?: ReactNode;
}) {
  const descriptionId = `${id}-description`;
  return (
    <section className={`org-blocked-panel ${tone === "unsafe" ? "unsafe" : ""}`}>
      <div>
        <div className="org-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p id={descriptionId}>{detail}</p>
        {children}
      </div>
      <button type="button" disabled aria-describedby={descriptionId}>
        {action}
      </button>
    </section>
  );
}

export function StatusBadge({
  label,
  tone = "mut",
}: {
  label: string;
  tone?: "ok" | "warning" | "danger" | "mut";
}) {
  return (
    <span className={`org-badge ${tone}`} aria-label={`Status: ${label}`}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function MetricValue({
  label,
  value,
  loading = false,
  tone = "default",
}: {
  label: string;
  value: string | number;
  loading?: boolean;
  tone?: "default" | "accent" | "warning";
}) {
  return (
    <div className="org-card org-kpi" aria-busy={loading || undefined}>
      <div className="lbl">{label}</div>
      <div className={`val${tone === "default" ? "" : ` ${tone}`}`}>
        {loading ? <span aria-label={`${label} loading`}>-</span> : value}
      </div>
    </div>
  );
}

