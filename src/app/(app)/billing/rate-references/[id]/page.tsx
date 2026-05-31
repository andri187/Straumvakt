// Rate-reference detail page — Sprint 9 (Phase 1 Track B).
//
// Shows all fields for a single RateReference row. Gated actions depend on
// row status (ADR 0019 Rule 5):
//
//   "current"  → edit notes only; retire (close window now)
//   "staged"   → edit notes + effectiveUntil; retire is destructive (removes future rate)
//   "expired"  → read-only; no actions
//
// Editing price / basis / effectiveFrom is NEVER available on an existing
// row. The operator must stage a new version.

import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import { SectionTabs, OPERATIONS_TABS, BILLING_TABS } from "@/components/section-tabs";
import { RateReferenceActions } from "./actions";

// ─────────────────────────────────────────────────────────────────────────────
// API response type
// ─────────────────────────────────────────────────────────────────────────────

interface RateReferenceRow {
  id: string;
  code: string;
  costFactorId: string;
  costFactorCode: string;
  costFactorDisplayNameEn: string;
  supplierOrgId: string | null;
  supplierOrgDisplayName: string | null;
  basis: "per_kwh" | "per_minute" | "per_day" | "per_session";
  priceMinor: string;
  currency: string;
  vatRatePct: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  notes: string | null;
  createdAt: string;
  status: "current" | "staged" | "expired";
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Rate reference detail" };

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtPrice(minorStr: string, basis: string, currency: string): string {
  try {
    const minor = BigInt(minorStr);
    const whole = minor / 100n;
    const aurar = minor % 100n;
    const aurarStr = aurar < 10n ? `0${aurar}` : `${aurar}`;
    const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const unit =
      basis === "per_kwh"
        ? "kr/kWh"
        : basis === "per_minute"
          ? "kr/min"
          : basis === "per_day"
            ? "kr/day"
            : "kr/session";
    return `${wholeStr},${aurarStr} ${currency !== "ISK" ? currency : ""} ${unit}`.trim();
  } catch {
    return "—";
  }
}

function fmtDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("is-IS", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("is-IS", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "current" | "staged" | "expired" }) {
  const tone =
    status === "current"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
      : status === "staged"
        ? "border-sv-sky/30 bg-sv-sky/10 text-sv-sky"
        : "border-bg-border bg-bg-base/40 text-ink-400";
  return (
    <span
      className={
        "rounded border px-2 py-0.5 text-xs uppercase tracking-brand " + tone
      }
    >
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function RateReferenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetchServer(`/api/admin/billing/rate-references/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { rateReference: r } = (await res.json()) as { rateReference: RateReferenceRow };

  // Link for "stage next version" pre-fills the code + costFactorId.
  const stageNextHref = `/billing/rate-references/new?code=${encodeURIComponent(r.code)}&costFactorId=${encodeURIComponent(r.costFactorId)}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />

      <Link
        href={"/billing/rate-references" as Parameters<typeof Link>[0]["href"]}
        className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky"
      >
        ← Back to rate book
      </Link>

      {/* Header */}
      <header className="mb-6 border-b border-bg-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold text-ink-50">{r.code}</h1>
            <p className="mt-1 text-sm text-ink-400">
              {r.costFactorCode} · {r.costFactorDisplayNameEn}
              {r.supplierOrgDisplayName && (
                <> · Supplier: <span className="text-ink-200">{r.supplierOrgDisplayName}</span></>
              )}
            </p>
            <p className="mt-1 font-mono text-[10px] text-ink-600">{r.id}</p>
          </div>
          <StatusBadge status={r.status} />
        </div>
      </header>

      {/* Price panel */}
      <section className="mb-4 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-50">Rate</h2>
        <div className="text-3xl font-semibold tabular-nums text-ink-50">
          {fmtPrice(r.priceMinor, r.basis, r.currency)}
        </div>
        <p className="mt-1 text-xs text-ink-400">
          {r.currency} · VAT {r.vatRatePct}% · basis{" "}
          <span className="font-mono">{r.basis}</span>
        </p>

        {r.status !== "expired" && (
          <div className="mt-3 flex items-center gap-2">
            <Link
              href={stageNextHref as Parameters<typeof Link>[0]["href"]}
              className="inline-flex items-center gap-1.5 rounded-md bg-sv-green/20 px-3 py-1.5 text-xs font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30"
            >
              + Stage next version
            </Link>
            <span className="text-[10px] text-ink-600">
              (creates a new row — this one&apos;s price is immutable)
            </span>
          </div>
        )}
      </section>

      {/* Effective window */}
      <section className="mb-4 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-50">Effective window</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-ink-500">From</dt>
          <dd className="text-ink-200">{fmtDate(r.effectiveFrom)}</dd>
          <dt className="text-ink-500">Until</dt>
          <dd className="text-ink-200">
            {r.effectiveUntil ? fmtDate(r.effectiveUntil) : "Open-ended"}
          </dd>
        </dl>
        {r.status === "current" && !r.effectiveUntil && (
          <p className="mt-2 text-[11px] text-amber-300">
            This row has no end date — it will remain the active rate until a new version
            is staged (which auto-closes this window) or this row is retired.
          </p>
        )}
      </section>

      {/* Notes */}
      <section className="mb-4 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-50">Notes</h2>
        {r.notes ? (
          <p className="text-sm text-ink-300">{r.notes}</p>
        ) : (
          <p className="text-sm text-ink-600">No notes.</p>
        )}
      </section>

      {/* Metadata */}
      <section className="mb-4 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-50">Metadata</h2>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-ink-500">ID</dt>
          <dd className="font-mono text-[10px] text-ink-400">{r.id}</dd>
          <dt className="text-ink-500">Cost factor</dt>
          <dd className="text-ink-300">
            <span className="font-mono">{r.costFactorCode}</span> — {r.costFactorDisplayNameEn}
          </dd>
          {r.supplierOrgId && (
            <>
              <dt className="text-ink-500">Supplier org</dt>
              <dd className="font-mono text-[10px] text-ink-400">{r.supplierOrgId}</dd>
            </>
          )}
          <dt className="text-ink-500">Created</dt>
          <dd className="text-ink-300">{fmtDatetime(r.createdAt)}</dd>
        </dl>
      </section>

      {/* Actions (edit notes / retire) — gated by status */}
      {r.status !== "expired" && (
        <RateReferenceActions
          rateReferenceId={r.id}
          status={r.status}
          currentNotes={r.notes ?? ""}
          currentEffectiveUntil={r.effectiveUntil ?? ""}
        />
      )}
    </div>
  );
}
