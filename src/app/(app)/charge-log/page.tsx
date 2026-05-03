// Top-level Charge Log page — Sprint 8.4 read surface.
// Reads from /api/admin/billing/sessions (admin scope). Per-entity
// scoped views (per-org / per-installation / per-charger / per-
// driver-group / per-driver) ship in 8.4.x by passing the right
// query parameter.

import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Charge log" };

interface SessionRow {
  sessionId: string;
  orgId: string;
  siteId: string | null;
  chargingStationId: string | null;
  driverUserId: string | null;
  driverIdTag: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number | null;
  energyKwh: string;
  costIskMinor: string | null;
  costFormatted: string | null;
  tariffDefinitionId: string | null;
}

interface BillingSessionsResponse {
  scope: { kind: string; orgId?: string; siteId?: string };
  filters: {
    startedAfter: string | null;
    startedBefore: string | null;
    limit: number;
    offset: number;
  };
  totals: {
    sessionCount: number;
    totalEnergyKwh: string;
    totalCostIskMinor: string;
    totalCostFormatted: string;
  };
  sessions: SessionRow[];
}

function formatDurationSec(sec: number | null): string {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default async function ChargeLogPage() {
  const data = await apiFetchServerJson<BillingSessionsResponse>(
    "/api/admin/billing/sessions",
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <ActionBar
        title="Charge log"
        description="Per-session ledger across every connected charger. Each row is one closed charging session with its computed cost. Per-org / per-installation / per-charger / per-driver-group / per-driver scoped views appear on the corresponding profile pages."
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Tile
          label="Sessions"
          value={data.totals.sessionCount.toLocaleString()}
        />
        <Tile
          label="Energy delivered"
          value={`${Number(data.totals.totalEnergyKwh).toFixed(3)} kWh`}
        />
        <Tile
          label="Total revenue"
          value={data.totals.totalCostFormatted}
        />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
        Sessions ({data.sessions.length})
      </h2>
      {data.sessions.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No charging sessions in the ledger yet. Sessions appear here once
          their session.stopped event has been processed and the tariff
          chain (Site DSO + Installation retailer) has been resolved.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-xs">
            <thead className="bg-bg-base/50 text-ink-400">
              <tr>
                <th className="px-3 py-2 text-left">Started</th>
                <th className="px-3 py-2 text-left">Duration</th>
                <th className="px-3 py-2 text-right">Energy</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-left">Driver</th>
                <th className="px-3 py-2 text-left">Charger</th>
                <th className="px-3 py-2 text-left font-mono">Session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {data.sessions.map((s) => (
                <tr key={s.sessionId} className="hover:bg-bg-base/20">
                  <td className="px-3 py-1.5 text-ink-200">
                    {formatTimestamp(s.startedAt)}
                  </td>
                  <td className="px-3 py-1.5 text-ink-300">
                    {formatDurationSec(s.durationSec)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink-100">
                    {Number(s.energyKwh).toFixed(3)} kWh
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-50">
                    {s.costFormatted ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-ink-300">
                    {s.driverIdTag ?? <span className="text-ink-500">—</span>}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-ink-500">
                    {s.chargingStationId
                      ? s.chargingStationId.slice(0, 8)
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-ink-500">
                    {s.sessionId.slice(0, 8)}
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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
      <p className="text-[10px] uppercase tracking-brand text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-ink-50">{value}</p>
    </div>
  );
}
