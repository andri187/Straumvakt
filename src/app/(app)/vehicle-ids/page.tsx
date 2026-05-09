// Sprint 9 / 2026-05-09 — ADR 0021 Autocharge — Vehicle IDs landing page.
// Filtered view of /charge-log: only sessions that captured at least
// one vehicle-identity signal (link layer EV PLC MAC, protocol layer
// PnC attempt, or application layer OCMF identity). Lets the operator
// verify Autocharge captures without scanning every session.

import Link from "next/link";
import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer } from "@/lib/api-client-server";
import { WakeFlyButton } from "./wake-fly-button";

export const metadata = { title: "Vehicle IDs" };
export const dynamic = "force-dynamic";

interface VehicleIdSessionRow {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  energyKwh: string;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  chargerSerial: string | null;
  installationDisplayName: string | null;
  siteDisplayName: string | null;
  orgDisplayName: string | null;
  driverIdTag: string | null;
  driverDisplayName: string | null;
  driverEmail: string | null;
  evPlcMac: string | null;
  evPlcMacOuiVendor: string | null;
  evPlcPibVersion: string | null;
  cableType: string | null;
  pncAttempted: boolean | null;
  pncSucceeded: boolean | null;
  pncRejectedUuid: string | null;
  authIdType: string | null;
  authIdValue: string | null;
  layers: ("link" | "protocol" | "application")[];
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("is-IS", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function VehicleIdsPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const res = await apiFetchServer(`/api/admin/vehicles`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { sessions } = (await res.json()) as { sessions: VehicleIdSessionRow[] };

  const totalLinks = sessions.filter((s) => s.layers.includes("link")).length;
  const totalProtocols = sessions.filter((s) => s.layers.includes("protocol")).length;
  const totalApplications = sessions.filter((s) =>
    s.layers.includes("application"),
  ).length;

  return (
    <>
      <Topbar title="Vehicle IDs" email={session?.email} />
      <PageShell title="Vehicle IDs">
        {/* Header summary */}
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
          <p className="mb-3 text-xs text-ink-400">
            Sessions that captured at least one vehicle-identity signal — the link layer EV
            PLC MAC (StateId 953 / OCMF EVCCID), the protocol layer PnC attempt (StateId
            724/725), or the application layer OCMF identity (auth_id_*). Per{" "}
            <Link
              href="/reference"
              className="text-sv-sky hover:underline"
            >
              ADR 0021
            </Link>
            .
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <Stat label="Total" value={String(sessions.length)} />
            <Stat label="Link layer" value={String(totalLinks)} accent="purple" />
            <Stat label="Protocol layer" value={String(totalProtocols)} accent="amber" />
            <Stat
              label="Application layer"
              value={String(totalApplications)}
              accent="emerald"
            />
          </dl>
          <div className="mt-4 border-t border-bg-border/40 pt-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-500">
              AMQP consumer (Fly)
            </div>
            <WakeFlyButton />
            <p className="mt-2 text-[10px] text-ink-500">
              Fly free tier may auto-suspend the consumer after idle. Click before a
              plug-in test to wake it and confirm the AMQP path is alive.
            </p>
          </div>
        </section>

        {/* Sessions list */}
        <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
            Captures{" "}
            <span className="text-ink-500">· {sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
          </h2>
          {sessions.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm italic text-ink-500">
              No vehicle IDs captured yet. Plug in a car at a Dalvegur charger to see if any
              identity signals are surfaced — link-layer EV PLC MAC fires immediately on
              HomePlug pairing, application-layer OCMF identity arrives at session end.
            </p>
          ) : (
            <ul className="divide-y divide-bg-border/40">
              {sessions.map((s) => (
                <li key={s.sessionId} className="px-5 py-3 hover:bg-bg-raised/30">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/charge-log/${s.sessionId}` as Parameters<typeof Link>[0]["href"]}
                        className="text-sm font-medium text-ink-100 hover:text-sv-sky"
                      >
                        {formatDateTime(s.startedAt)}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {s.chargerDisplayName ?? "—"}
                        {s.chargerSerial && (
                          <span className="ml-2 font-mono text-[10px] text-ink-500">
                            {s.chargerSerial}
                          </span>
                        )}
                        {s.installationDisplayName && (
                          <span className="ml-2 text-ink-500">{s.installationDisplayName}</span>
                        )}
                        {s.siteDisplayName && (
                          <span className="ml-2 text-ink-500">· {s.siteDisplayName}</span>
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {s.evPlcMac && (
                          <Link
                            href={`/vehicles/${encodeURIComponent(s.evPlcMac)}` as Parameters<typeof Link>[0]["href"]}
                            className="inline-flex items-center gap-1 rounded bg-purple-400/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-300 ring-1 ring-inset ring-purple-400/30 hover:bg-purple-400/25"
                            title="Open vehicle-recurrence view"
                          >
                            <span className="font-mono">{s.evPlcMac}</span>
                            {s.evPlcMacOuiVendor && (
                              <span className="font-semibold">· {s.evPlcMacOuiVendor}</span>
                            )}
                          </Link>
                        )}
                        {s.authIdType && (
                          <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                            OCMF {s.authIdType}
                            {s.authIdValue && (
                              <span className="ml-1 font-mono">{s.authIdValue}</span>
                            )}
                          </span>
                        )}
                        {s.pncAttempted && (
                          <span
                            className={
                              "rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset " +
                              (s.pncSucceeded === true
                                ? "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30"
                                : s.pncSucceeded === false
                                  ? "bg-rose-400/15 text-rose-300 ring-rose-400/30"
                                  : "bg-amber-400/15 text-amber-300 ring-amber-400/30")
                            }
                          >
                            PnC{" "}
                            {s.pncSucceeded === true
                              ? "Accepted"
                              : s.pncSucceeded === false
                                ? "Rejected"
                                : "attempted"}
                          </span>
                        )}
                        {s.cableType && (
                          <span className="rounded bg-bg-raised/60 px-1.5 py-0.5 text-[10px] text-ink-300 ring-1 ring-inset ring-bg-border">
                            cable {s.cableType}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-ink-100">
                        {Number(s.energyKwh).toFixed(3)} kWh
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        {s.driverDisplayName ??
                          s.driverEmail ??
                          (s.driverIdTag ? (
                            <span className="font-mono">{s.driverIdTag}</span>
                          ) : (
                            <span className="italic text-ink-500">anonymous</span>
                          ))}
                      </p>
                      <div className="mt-1 flex flex-wrap justify-end gap-1">
                        {s.layers.map((l) => (
                          <span
                            key={l}
                            className={
                              "rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-brand ring-1 ring-inset " +
                              (l === "link"
                                ? "bg-purple-400/10 text-purple-300 ring-purple-400/20"
                                : l === "protocol"
                                  ? "bg-amber-400/10 text-amber-300 ring-amber-400/20"
                                  : "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20")
                            }
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageShell>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "purple" | "amber" | "emerald";
}) {
  const valueClass =
    accent === "purple"
      ? "text-purple-300"
      : accent === "amber"
        ? "text-amber-300"
        : accent === "emerald"
          ? "text-emerald-300"
          : "text-ink-100";
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={`mt-0.5 font-mono text-base font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}
