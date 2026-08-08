// Billing overview dashboard — Sprint 9 Track D.
// Replaces the BillingStub placeholder.
// All data comes from /api/admin/billing/summary (single round-trip).

import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Overview" };

// ── Types matching the API response ──────────────────────────────────────────

interface PeriodTotals {
  sessionCount: number;
  totalEnergyKwh: string;
  totalCostIskMinor: string;
}

interface TariffCoverage {
  totalCount: number;
  anchoredCount: number;
  orphanCount: number;
}

interface CostHealth {
  totalSessions: number;
  costedSessions: number;
  pctCosted: number | null;
}

interface ProjectedOrgRow {
  orgId: string;
  orgDisplayName: string;
  sessionCount: number;
  totalCostIskMinor: string;
}

interface RecentEntry {
  sessionId: string;
  orgDisplayName: string | null;
  siteDisplayName: string | null;
  startedAt: string;
  energyKwh: string;
  costIskMinor: string | null;
}

interface SummaryResponse {
  period: { year: number; month: number };
  currentPeriod: PeriodTotals;
  previousPeriod: PeriodTotals;
  tariffCoverage: TariffCoverage;
  costHealth: CostHealth;
  projectedClose: ProjectedOrgRow[];
  recentEntries: RecentEntry[];
}

// ── Formatters ────────────────────────────────────────────────────────────────

/** Format a BigInt-as-string minor ISK amount as "1.234,56 kr." */
function fmtKr(minorStr: string | null): string {
  if (!minorStr) return "—";
  try {
    const minor = BigInt(minorStr);
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    const whole = abs / 100n;
    const aurar = abs % 100n;
    const aurarStr = aurar < 10n ? `0${aurar}` : `${aurar}`;
    const wholeStr = whole
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${negative ? "-" : ""}${wholeStr},${aurarStr} kr.`;
  } catch {
    return "—";
  }
}

function fmtKwh(kwhStr: string): string {
  try {
    const val = parseFloat(kwhStr);
    if (!isFinite(val)) return "—";
    return val.toLocaleString("is-IS", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " kWh";
  } catch {
    return kwhStr + " kWh";
  }
}

/** Format ISO timestamp to "DD.MM.YYYY HH:MM" (Reykjavik local = UTC). */
function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    );
  } catch {
    return iso;
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Delta helpers ─────────────────────────────────────────────────────────────

function deltaArrow(current: number | bigint, previous: number | bigint): string {
  const c = typeof current === "bigint" ? Number(current) : current;
  const p = typeof previous === "bigint" ? Number(previous) : previous;
  if (p === 0) return "";
  return c >= p ? " ↑" : " ↓";
}

function deltaTone(current: number | bigint, previous: number | bigint): string {
  const c = typeof current === "bigint" ? Number(current) : current;
  const p = typeof previous === "bigint" ? Number(previous) : previous;
  if (p === 0) return "text-ink-400";
  return c >= p ? "text-emerald-400" : "text-amber-400";
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function BillingOverviewPage() {
  let data: SummaryResponse | null = null;
  let fetchError: string | null = null;

  try {
    data = await apiFetchServerJson<SummaryResponse>(
      "/api/admin/billing/summary",
    );
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  const { period, currentPeriod, previousPeriod, tariffCoverage, costHealth, projectedClose, recentEntries } =
    data ?? {
      period: { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1 },
      currentPeriod: { sessionCount: 0, totalEnergyKwh: "0", totalCostIskMinor: "0" },
      previousPeriod: { sessionCount: 0, totalEnergyKwh: "0", totalCostIskMinor: "0" },
      tariffCoverage: { totalCount: 0, anchoredCount: 0, orphanCount: 0 },
      costHealth: { totalSessions: 0, costedSessions: 0, pctCosted: null },
      projectedClose: [],
      recentEntries: [],
    };

  const monthLabel = MONTH_NAMES[(period.month - 1) % 12];
  const prevMonthLabel = MONTH_NAMES[((period.month - 2 + 12) % 12)];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Billing overview"
        description={`Current-period metrics and health indicators. Period: ${monthLabel} ${period.year}.`}
      />

      {fetchError && (
        <div className="mb-4 rounded border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          Could not load billing summary: {fetchError}
        </div>
      )}

      {/* ── Current period totals ── */}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-brand text-ink-500">
        {monthLabel} {period.year} — current period
      </h2>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Tile
          label="Sessions"
          value={currentPeriod.sessionCount.toLocaleString("is-IS")}
          sub={
            previousPeriod.sessionCount > 0
              ? `${deltaArrow(currentPeriod.sessionCount, previousPeriod.sessionCount)} vs ${prevMonthLabel} (${previousPeriod.sessionCount.toLocaleString("is-IS")})`
              : undefined
          }
          subTone={deltaTone(currentPeriod.sessionCount, previousPeriod.sessionCount)}
        />
        <Tile
          label="Energy delivered"
          value={fmtKwh(currentPeriod.totalEnergyKwh)}
          sub={
            previousPeriod.totalEnergyKwh !== "0"
              ? `vs ${prevMonthLabel}: ${fmtKwh(previousPeriod.totalEnergyKwh)}`
              : undefined
          }
        />
        <Tile
          label="Revenue (inc. VAT)"
          value={fmtKr(currentPeriod.totalCostIskMinor)}
          sub={
            previousPeriod.totalCostIskMinor !== "0"
              ? `vs ${prevMonthLabel}: ${fmtKr(previousPeriod.totalCostIskMinor)}`
              : undefined
          }
        />
      </div>

      {/* ── Health tiles ── */}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-brand text-ink-500">
        Health
      </h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Tariffs total"
          value={String(tariffCoverage.totalCount)}
        />
        <Tile
          label="Tariffs anchored"
          value={String(tariffCoverage.anchoredCount)}
        />
        <Tile
          label="Orphan tariffs"
          value={String(tariffCoverage.orphanCount)}
          tone={tariffCoverage.orphanCount > 0 ? "amber" : undefined}
        />
        <Tile
          label="Cost-computation (30d)"
          value={costHealth.pctCosted !== null ? `${costHealth.pctCosted}%` : "—"}
          sub={
            costHealth.totalSessions > 0
              ? `${costHealth.costedSessions} / ${costHealth.totalSessions} sessions`
              : "No sessions yet"
          }
          tone={
            costHealth.pctCosted !== null && costHealth.pctCosted < 80
              ? "amber"
              : undefined
          }
        />
      </div>

      {/* ── Projected close: top orgs by revenue ── */}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-brand text-ink-500">
        Projected close — top organisations by {monthLabel} revenue
      </h2>
      {projectedClose.length === 0 ? (
        <div className="mb-6 rounded border border-dashed border-bg-border p-4 text-center text-sm text-ink-500">
          No costed sessions yet for {monthLabel} {period.year}.
        </div>
      ) : (
        <div className="mb-6 overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-xs">
            <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
              <tr className="text-left">
                <th className="px-3 py-2">Organisation</th>
                <th className="px-3 py-2 text-right">Sessions</th>
                <th className="px-3 py-2 text-right">Revenue (inc. VAT)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {projectedClose.map((row) => (
                <tr key={row.orgId} className="hover:bg-bg-base/20">
                  <td className="px-3 py-1.5 text-ink-100">{row.orgDisplayName}</td>
                  <td className="px-3 py-1.5 text-right text-ink-300">
                    {row.sessionCount.toLocaleString("is-IS")}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-200">
                    {fmtKr(row.totalCostIskMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Recent ledger entries ── */}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-brand text-ink-500">
        Recent ledger entries
      </h2>
      {recentEntries.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-4 text-center text-sm text-ink-500">
          No sessions recorded yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-xs">
            <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
              <tr className="text-left">
                <th className="px-3 py-2">Organisation</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2 text-right">Energy</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {recentEntries.map((r) => (
                <tr key={r.sessionId} className="hover:bg-bg-base/20">
                  <td className="px-3 py-1.5 text-ink-300">
                    {r.orgDisplayName ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-ink-400">
                    {r.siteDisplayName ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                    {fmtDate(r.startedAt)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink-300">
                    {fmtKwh(r.energyKwh)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-200">
                    {fmtKr(r.costIskMinor)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link
                      href={`/charge-log/${r.sessionId}` as Parameters<typeof Link>[0]["href"]}
                      className="text-sv-sky text-[10px] hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Shared UI components ──────────────────────────────────────────────────────

function Tile({
  label,
  value,
  sub,
  subTone,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: string;
  tone?: "amber";
}) {
  const accent =
    tone === "amber"
      ? "border-amber-700/40 bg-amber-950/20"
      : "border-bg-border bg-bg-base/30";
  return (
    <div className={`rounded-lg border p-4 ${accent}`}>
      <p className="text-[10px] uppercase tracking-brand text-ink-500">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-semibold " +
          (tone === "amber" ? "text-amber-200" : "text-ink-50")
        }
      >
        {value}
      </p>
      {sub && (
        <p className={`mt-1 text-[10px] ${subTone ?? "text-ink-500"}`}>{sub}</p>
      )}
    </div>
  );
}
