// Reusable session-ledger table + summary tiles. Used by:
//   • /charge-log              (platform-wide, admin scope)
//   • /accounts/organizations/[id]/sessions   (per-org)
//   • /sites/[id]/sessions     (per-site, when added)
//   • /chargers/[id]/sessions  (per-charger, when added)
//
// Server component — pulls from /api/admin/billing/sessions with
// a scope-narrowing query string. Per-row session-id cell is the
// client SessionIdButton (modal-owner) — Next.js renders client
// components inside server components automatically.

import Link from "next/link";
import { apiFetchServerJson } from "@/lib/api-client-server";
import { SessionIdButton } from "./session-id-button";

interface SessionRow {
  sessionId: string;
  orgId: string;
  orgDisplayName: string | null;
  siteId: string | null;
  siteDisplayName: string | null;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  driverUserId: string | null;
  driverIdTag: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number | null;
  energyKwh: string;
  costIskMinor: string | null;
  costFormatted: string | null;
  tariffDefinitionId: string | null;
  stopReason: string | null;
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

export type ChargeLogScope =
  | { kind: "admin" }
  | { kind: "org"; orgId: string }
  | { kind: "site"; siteId: string }
  | { kind: "charger"; chargingStationId: string }
  | { kind: "driver"; driverUserId: string };

function buildQuery(scope: ChargeLogScope): string {
  switch (scope.kind) {
    case "admin":
      return "";
    case "org":
      return `?orgId=${encodeURIComponent(scope.orgId)}`;
    case "site":
      return `?siteId=${encodeURIComponent(scope.siteId)}`;
    case "charger":
      return `?chargingStationId=${encodeURIComponent(scope.chargingStationId)}`;
    case "driver":
      return `?driverUserId=${encodeURIComponent(scope.driverUserId)}`;
  }
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

export async function ChargeLogTable({
  scope,
  /** Hide column N (typically site/charger/driver when the scope
   *  itself implies the value). Currently unused; reserved for
   *  per-entity views that want to suppress redundancy. */
  hideColumns,
}: {
  scope: ChargeLogScope;
  hideColumns?: ("site" | "charger" | "driver")[];
}) {
  const data = await apiFetchServerJson<BillingSessionsResponse>(
    `/api/admin/billing/sessions${buildQuery(scope)}`,
  );
  const hide = new Set(hideColumns ?? []);

  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Tile
          label="Sessions"
          value={data.totals.sessionCount.toLocaleString()}
        />
        <Tile
          label="Energy delivered"
          value={`${Number(data.totals.totalEnergyKwh).toFixed(3)} kWh`}
        />
        <Tile label="Total revenue" value={data.totals.totalCostFormatted} />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
        Sessions ({data.sessions.length})
      </h2>
      {data.sessions.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No charging sessions in this scope yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-xs">
            <thead className="bg-bg-base/50 text-ink-400">
              <tr>
                <th className="px-3 py-2 text-left">Session</th>
                <th className="px-3 py-2 text-left">Started</th>
                <th className="px-3 py-2 text-left">Duration</th>
                <th className="px-3 py-2 text-right">Energy</th>
                <th className="px-3 py-2 text-right">Cost</th>
                {!hide.has("driver") && (
                  <th className="px-3 py-2 text-left">Driver</th>
                )}
                {!hide.has("charger") && (
                  <th className="px-3 py-2 text-left">Charger</th>
                )}
                {!hide.has("site") && (
                  <th className="px-3 py-2 text-left">Site / Org</th>
                )}
                <th className="px-3 py-2 text-left">Stop reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {data.sessions.map((s) => (
                <tr key={s.sessionId} className="hover:bg-bg-base/20">
                  <td className="px-3 py-1.5">
                    <SessionIdButton sessionId={s.sessionId} />
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-ink-200">
                    {formatTimestamp(s.startedAt)}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-ink-300">
                    {formatDurationSec(s.durationSec)}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-right text-ink-100">
                    {Number(s.energyKwh).toFixed(3)} kWh
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono text-ink-50">
                    {s.costFormatted ?? "—"}
                  </td>
                  {!hide.has("driver") && (
                    <td className="px-3 py-1.5 text-ink-300">
                      {s.driverIdTag ?? (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                  )}
                  {!hide.has("charger") && (
                    <td className="px-3 py-1.5">
                      {s.chargingStationId ? (
                        s.chargerDisplayName &&
                        !/^[0-9a-f-]{36}$/i.test(s.chargerDisplayName) ? (
                          <Link
                            href={
                              `/chargers/${s.chargingStationId}` as Parameters<typeof Link>[0]["href"]
                            }
                            className="text-ink-100 hover:text-sv-sky"
                          >
                            {s.chargerDisplayName}
                          </Link>
                        ) : (
                          <Link
                            href={
                              `/chargers/${s.chargingStationId}` as Parameters<typeof Link>[0]["href"]
                            }
                            className="font-mono text-[10px] text-ink-500 hover:text-sv-sky"
                          >
                            {s.chargingStationId.slice(0, 8)}…
                          </Link>
                        )
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                  )}
                  {!hide.has("site") && (
                    <td className="px-3 py-1.5">
                      <div className="flex flex-col leading-tight">
                        {s.siteId && s.siteDisplayName ? (
                          <Link
                            href={
                              `/sites/${s.siteId}` as Parameters<typeof Link>[0]["href"]
                            }
                            className="text-ink-200 hover:text-sv-sky"
                          >
                            {s.siteDisplayName}
                          </Link>
                        ) : (
                          <span className="text-ink-500">—</span>
                        )}
                        {s.orgDisplayName && (
                          <Link
                            href={
                              `/accounts/organizations/${s.orgId}` as Parameters<typeof Link>[0]["href"]
                            }
                            className="text-[10px] text-ink-500 hover:text-sv-sky"
                          >
                            {s.orgDisplayName}
                          </Link>
                        )}
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-1.5">
                    {s.stopReason ? (
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-[10px] " +
                          (s.stopReason === "ExternallyEnded"
                            ? "bg-amber-950/30 text-amber-300"
                            : s.stopReason === "Completed" ||
                                s.stopReason === "Local" ||
                                s.stopReason === "EVDisconnected"
                              ? "bg-emerald-950/30 text-emerald-300"
                              : "bg-bg-base/40 text-ink-300")
                        }
                      >
                        {s.stopReason}
                      </span>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
