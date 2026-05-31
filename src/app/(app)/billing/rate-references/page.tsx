// Rate book catalogue — Sprint 9 (Phase 1 Track B).
//
// Displays agreements.rate_references grouped by code into
// current / staged / expired buckets. "Stage new version" is the entry
// point for rate changes — in-place edits on active rows are blocked
// (ADR 0019 Rule 5).
//
// Phase 4 will add a pattern_json editor for ToD restrictions (OCPI 2.2.1
// TariffRestrictions shape). Until then, the rate window is a simple
// effective_from / effective_until date range.

import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

// ─────────────────────────────────────────────────────────────────────────────
// API response types
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

interface RateReferenceCodeGroup {
  code: string;
  costFactorCode: string;
  costFactorDisplayNameEn: string;
  current: RateReferenceRow | null;
  staged: RateReferenceRow[];
  expired: RateReferenceRow[];
}

interface CatalogueSummary {
  totalCodes: number;
  currentCount: number;
  stagedCount: number;
  expiredCount: number;
  groups: RateReferenceCodeGroup[];
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Rate book" };

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
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

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("is-IS", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtWindow(effectiveFrom: string, effectiveUntil: string | null): string {
  const from = fmtDate(effectiveFrom);
  if (!effectiveUntil) return `from ${from}`;
  return `${from} → ${fmtDate(effectiveUntil)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function RateReferencesPage() {
  const data = await apiFetchServerJson<CatalogueSummary>(
    "/api/admin/billing/rate-references",
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Rate book"
        description="Versioned rate entries (agreements.rate_references). Rules and Agreement defaults reference rates by code. The resolver picks the row active at session_time. Editing a price means staging a new version — active rows are immutable (ADR 0019)."
        primaryAction={{ href: "/billing/rate-references/new", label: "Stage new version" }}
      />

      <div className="mb-4 grid grid-cols-4 gap-3">
        <Tile label="Rate codes" value={String(data.totalCodes)} />
        <Tile
          label="Currently active"
          value={String(data.currentCount)}
          tone="green"
        />
        <Tile label="Staged (future)" value={String(data.stagedCount)} tone="sky" />
        <Tile label="Expired" value={String(data.expiredCount)} />
      </div>

      {data.groups.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No rate references yet. Use &ldquo;Stage new version&rdquo; to add the first entry.
        </div>
      ) : (
        data.groups.map((group) => (
          <CodeGroup key={group.code} group={group} />
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code group component
// ─────────────────────────────────────────────────────────────────────────────

function CodeGroup({ group }: { group: RateReferenceCodeGroup }) {
  const allRows: { row: RateReferenceRow; bucket: "current" | "staged" | "expired" }[] = [
    ...(group.current ? [{ row: group.current, bucket: "current" as const }] : []),
    ...group.staged.map((r) => ({ row: r, bucket: "staged" as const })),
    ...group.expired.map((r) => ({ row: r, bucket: "expired" as const })),
  ];

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-ink-100">
          <span className="font-mono text-ink-300">{group.code}</span>
        </h2>
        <span className="text-[10px] uppercase tracking-brand text-ink-500">
          {group.costFactorCode} · {group.costFactorDisplayNameEn}
        </span>
        <Link
          href={`/billing/rate-references/new?code=${encodeURIComponent(group.code)}&costFactorId=${group.current?.costFactorId ?? ""}` as Parameters<typeof Link>[0]["href"]}
          className="ml-auto text-[10px] text-sv-sky hover:underline"
        >
          + stage next version
        </Link>
      </div>

      <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
        <table className="w-full text-xs">
          <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
            <tr className="text-left">
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2">Basis</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Window</th>
              <th className="px-3 py-2">VAT</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border/40">
            {allRows.map(({ row, bucket }) => (
              <tr
                key={row.id}
                className={
                  "hover:bg-bg-base/20 " +
                  (bucket === "expired" ? "opacity-50" : "")
                }
              >
                <td className="px-3 py-1.5">
                  <StatusBadge status={bucket} />
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-ink-200">
                  {fmtPrice(row.priceMinor, row.basis, row.currency)}
                </td>
                <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                  {row.basis}
                </td>
                <td className="px-3 py-1.5 text-ink-300">
                  {row.supplierOrgDisplayName ?? <span className="text-ink-600">—</span>}
                </td>
                <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                  {fmtWindow(row.effectiveFrom, row.effectiveUntil)}
                </td>
                <td className="px-3 py-1.5 text-right text-ink-400">
                  {row.vatRatePct}%
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Link
                    href={`/billing/rate-references/${row.id}` as Parameters<typeof Link>[0]["href"]}
                    className="text-[10px] text-sv-sky hover:underline"
                  >
                    detail →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile
// ─────────────────────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "sky" | "amber";
}) {
  const accent =
    tone === "green"
      ? "border-emerald-700/40 bg-emerald-950/20"
      : tone === "sky"
        ? "border-sv-sky/30 bg-sv-sky/10"
        : tone === "amber"
          ? "border-amber-700/40 bg-amber-950/20"
          : "border-bg-border bg-bg-base/30";
  const text =
    tone === "green"
      ? "text-emerald-200"
      : tone === "sky"
        ? "text-sv-sky"
        : tone === "amber"
          ? "text-amber-200"
          : "text-ink-50";
  return (
    <div className={`rounded-lg border p-4 ${accent}`}>
      <p className="text-[10px] uppercase tracking-brand text-ink-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${text}`}>{value}</p>
    </div>
  );
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
        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-brand " + tone
      }
    >
      {status}
    </span>
  );
}
