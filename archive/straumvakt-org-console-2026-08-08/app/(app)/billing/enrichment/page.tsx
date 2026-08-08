// Sprint 9 / ENRICH-4 — Session enrichment-status surface.
//
// Shows per-source energy provenance (OCPP vs CDR) and OCMF blob presence
// so operators can identify sessions where the two data sources disagree.
//
// ENRICH-1 must land before this page returns real data — the
// verifiedSource / enrichmentStatus columns on session_ledger and the
// ocmfBlobRef / ocppEnergyKwh / cdrEnergyKwh columns on charge_sessions
// are declared in the Prisma schema but the migration may not have run yet.

import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

// ── API shape ────────────────────────────────────────────────────────

interface EnrichmentSummary {
  pending: number;
  complete: number;
  mismatch: number;
  stale: number;
}

interface EnrichmentSessionRow {
  sessionId: string;
  startedAt: string;
  stoppedAt: string | null;
  chargerDisplayName: string | null;
  siteDisplayName: string | null;
  energyKwh: string;
  costIskMinor: string | null;
  verifiedSource: string | null;
  enrichmentStatus: string | null;
  ocppEnergyKwh: string | null;
  cdrEnergyKwh: string | null;
  energyDeltaKwh: string | null;
  hasOcmfBlob: boolean;
}

interface EnrichmentResponse {
  summary: EnrichmentSummary;
  sessions: EnrichmentSessionRow[];
}

// ── Query-param types ─────────────────────────────────────────────────

type StatusFilter = "pending" | "complete" | "mismatch" | "stale" | "all";

const VALID_STATUSES = new Set<StatusFilter>([
  "all",
  "pending",
  "complete",
  "mismatch",
  "stale",
]);

function isValidStatus(v: string | undefined): v is StatusFilter {
  return Boolean(v && VALID_STATUSES.has(v as StatusFilter));
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Enrichment" };

// ── Helpers ──────────────────────────────────────────────────────────

function fmtKwh(v: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(3)} kWh`;
}

function fmtIskMinor(minorStr: string | null): string {
  if (!minorStr) return "—";
  try {
    const minor = BigInt(minorStr);
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    const whole = abs / 100n;
    const aurar = abs % 100n;
    const aurarStr = aurar < 10n ? `0${aurar}` : `${aurar}`;
    const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${negative ? "-" : ""}${wholeStr},${aurarStr} kr.`;
  } catch {
    return "—";
  }
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ── Sub-components ───────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber" | "green" | "red" | "neutral";
}) {
  const border =
    tone === "amber"
      ? "border-amber-700/40 bg-amber-950/20"
      : tone === "green"
        ? "border-emerald-700/40 bg-emerald-950/20"
        : tone === "red"
          ? "border-red-700/40 bg-red-950/20"
          : "border-bg-border bg-bg-base/30";
  const textColor =
    tone === "amber"
      ? "text-amber-200"
      : tone === "green"
        ? "text-emerald-200"
        : tone === "red"
          ? "text-red-200"
          : "text-ink-50";
  return (
    <div className={`rounded-lg border p-4 ${border}`}>
      <p className="text-[10px] uppercase tracking-brand text-ink-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${textColor}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="text-ink-500">—</span>;
  }
  const tone =
    status === "complete"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
      : status === "mismatch"
        ? "border-amber-700/40 bg-amber-950/30 text-amber-300"
        : status === "stale"
          ? "border-red-700/40 bg-red-950/30 text-red-300"
          : status === "pending"
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

// ── Filter chip row ───────────────────────────────────────────────────

const FILTER_CHIPS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Complete", value: "complete" },
  { label: "Mismatch", value: "mismatch" },
  { label: "Stale", value: "stale" },
];

// ── Page ──────────────────────────────────────────────────────────────

export default async function EnrichmentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; days?: string }>;
}) {
  const params = await searchParams;
  const status: StatusFilter = isValidStatus(params.status)
    ? params.status
    : "all";
  const days = params.days ? Math.max(1, Math.min(365, Number(params.days) || 30)) : 30;

  const query = new URLSearchParams();
  if (status !== "all") query.set("status", status);
  query.set("days", String(days));
  query.set("limit", "100");

  const data = await apiFetchServerJson<EnrichmentResponse>(
    `/api/admin/billing/enrichment?${query.toString()}`,
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Enrichment status"
        description="Per-session OCPP vs CDR energy provenance. Sessions where the two sources disagree are flagged as mismatches. OCMF column indicates a signed receipt is stored."
      />

      {/* Summary tiles */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        <SummaryTile label="Pending" value={data.summary.pending} tone="neutral" />
        <SummaryTile label="Complete" value={data.summary.complete} tone="green" />
        <SummaryTile
          label="Mismatch"
          value={data.summary.mismatch}
          tone={data.summary.mismatch > 0 ? "amber" : "neutral"}
        />
        <SummaryTile
          label="Stale"
          value={data.summary.stale}
          tone={data.summary.stale > 0 ? "red" : "neutral"}
        />
      </div>

      {/* Filter chip row */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {FILTER_CHIPS.map(({ label, value }) => {
          const active = status === value;
          const params = new URLSearchParams();
          if (value !== "all") params.set("status", value);
          params.set("days", String(days));
          return (
            <Link
              key={value}
              href={`/billing/enrichment?${params.toString()}` as Parameters<typeof Link>[0]["href"]}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "border-sv-sky bg-sv-sky/15 text-sv-sky"
                  : "border-bg-border text-ink-400 hover:border-bg-raised hover:text-ink-100")
              }
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Session table */}
      {data.sessions.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-8 text-center text-sm text-ink-500">
          No sessions in the last {days} days
          {status !== "all" ? ` with status "${status}"` : ""}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-xs">
            <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
              <tr className="text-left">
                <th className="px-3 py-2">Session</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Charger</th>
                <th className="px-3 py-2 text-right">Energy</th>
                <th className="px-3 py-2 text-right">Delta</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">OCMF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {data.sessions.map((s) => {
                const isMismatch = s.enrichmentStatus === "mismatch";
                const hasDelta =
                  s.energyDeltaKwh !== null && parseFloat(s.energyDeltaKwh) > 0;
                return (
                  <tr
                    key={s.sessionId}
                    className={
                      "hover:bg-bg-base/20 " + (isMismatch ? "bg-amber-950/10" : "")
                    }
                  >
                    <td className="px-3 py-1.5 font-mono text-[10px]">
                      <Link
                        href={
                          `/charge-log/${s.sessionId}` as Parameters<
                            typeof Link
                          >[0]["href"]
                        }
                        className="text-ink-400 hover:text-sv-sky hover:underline"
                      >
                        {s.sessionId.slice(0, 8)}&hellip;
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink-200">
                      {fmtTimestamp(s.startedAt)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-col leading-tight">
                        <span className="text-ink-100">
                          {s.chargerDisplayName ?? (
                            <span className="text-ink-500">—</span>
                          )}
                        </span>
                        {s.siteDisplayName && (
                          <span className="text-[10px] text-ink-500">
                            {s.siteDisplayName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex flex-col items-end leading-tight">
                        <span className="font-mono text-ink-100">
                          {fmtKwh(s.energyKwh)}
                        </span>
                        {(s.ocppEnergyKwh || s.cdrEnergyKwh) && (
                          <span className="text-[10px] text-ink-500">
                            {s.ocppEnergyKwh
                              ? `OCPP ${fmtKwh(s.ocppEnergyKwh)}`
                              : ""}
                            {s.ocppEnergyKwh && s.cdrEnergyKwh ? " / " : ""}
                            {s.cdrEnergyKwh
                              ? `CDR ${fmtKwh(s.cdrEnergyKwh)}`
                              : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {hasDelta ? (
                        <span
                          className={
                            isMismatch
                              ? "text-amber-300"
                              : "text-ink-300"
                          }
                        >
                          {fmtKwh(s.energyDeltaKwh)}
                        </span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-ink-50">
                      {fmtIskMinor(s.costIskMinor)}
                    </td>
                    <td className="px-3 py-1.5">
                      {s.verifiedSource ? (
                        <span className="rounded border border-bg-border bg-bg-base/40 px-1.5 py-0.5 text-[10px] font-mono uppercase text-ink-300">
                          {s.verifiedSource}
                        </span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={s.enrichmentStatus} />
                    </td>
                    <td className="px-3 py-1.5">
                      {s.hasOcmfBlob ? (
                        <span className="rounded border border-emerald-700/40 bg-emerald-950/30 px-1.5 py-0.5 text-[10px] uppercase tracking-brand text-emerald-300">
                          OCMF
                        </span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
