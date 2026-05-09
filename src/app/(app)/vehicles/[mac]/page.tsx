// Sprint 9 / 2026-05-09 — ADR 0021 Autocharge Step G
// Vehicle-recurrence page. Operator opens this from the session
// detail page's Vehicle identity section by clicking the EV PLC MAC.
// Shows every other session this same vehicle has touched.

import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer } from "@/lib/api-client-server";

export const metadata = { title: "Vehicle recurrence" };
export const dynamic = "force-dynamic";

interface VehicleRecurrenceSession {
  sessionId: string;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  chargerSerial: string | null;
  installationDisplayName: string | null;
  siteDisplayName: string | null;
  orgDisplayName: string | null;
  startedAt: string;
  endedAt: string | null;
  energyKwh: string;
  driverUserId: string | null;
  driverDisplayName: string | null;
  driverEmail: string | null;
  driverIdTag: string | null;
}

interface VehicleRecurrence {
  mac: string;
  ouiPrefix: string | null;
  vendor: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  totalSessions: number;
  distinctChargers: number;
  distinctSites: number;
  sessions: VehicleRecurrenceSession[];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("is-IS", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("is-IS");
}

export default async function VehicleRecurrencePage({
  params,
}: {
  params: Promise<{ mac: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const { mac } = await params;
  const decoded = decodeURIComponent(mac);

  const res = await apiFetchServer(`/api/admin/vehicles/${encodeURIComponent(decoded)}`);
  if (res.status === 400) notFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { vehicle } = (await res.json()) as { vehicle: VehicleRecurrence };

  return (
    <>
      <Topbar
        title={`Vehicle · ${vehicle.mac}`}
        email={session?.email}
      />
      <PageShell title={`Vehicle ${vehicle.mac}`}>
        <div className="mb-3 text-xs text-ink-400">
          <Link href="/charge-log" className="hover:text-ink-50">
            ← Back to charge log
          </Link>
        </div>

        {/* Header — vendor + summary */}
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {vehicle.vendor ? (
              <span className="rounded-full bg-purple-400/15 px-3 py-1 text-sm font-semibold text-purple-300 ring-1 ring-inset ring-purple-400/30">
                {vehicle.vendor}
              </span>
            ) : (
              <span className="rounded-full bg-bg-raised/60 px-3 py-1 text-sm font-medium text-ink-400 ring-1 ring-inset ring-bg-border">
                Unknown vendor
              </span>
            )}
            <code className="select-all rounded bg-bg-base/60 px-2 py-1 font-mono text-sm text-ink-100 ring-1 ring-bg-border">
              {vehicle.mac}
            </code>
            {vehicle.ouiPrefix && (
              <span className="text-xs text-ink-500">
                OUI <span className="font-mono">{vehicle.ouiPrefix}</span>
              </span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <Stat label="Total sessions" value={String(vehicle.totalSessions)} />
            <Stat label="Distinct chargers" value={String(vehicle.distinctChargers)} />
            <Stat label="Distinct sites" value={String(vehicle.distinctSites)} />
            <Stat label="First seen" value={formatDate(vehicle.firstSeenAt)} />
          </dl>
          {vehicle.lastSeenAt && (
            <p className="mt-3 text-xs text-ink-500">
              Most recent session: {formatDateTime(vehicle.lastSeenAt)}
            </p>
          )}
        </section>

        {/* Sessions list */}
        <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
            Sessions{" "}
            <span className="text-ink-500">
              · {vehicle.sessions.length} {vehicle.sessions.length === 1 ? "row" : "rows"}
              {vehicle.totalSessions > vehicle.sessions.length &&
                ` (capped at ${vehicle.sessions.length} of ${vehicle.totalSessions})`}
            </span>
          </h2>
          {vehicle.sessions.length === 0 ? (
            <p className="px-5 py-6 text-sm italic text-ink-500">
              No sessions recorded for this vehicle yet. Either this MAC has not appeared in
              any session, or the AMQP path / OCMF EVCCID capture has not yet populated
              charging.sessions.ev_plc_mac for the relevant rows.
            </p>
          ) : (
            <ul className="divide-y divide-bg-border/40">
              {vehicle.sessions.map((s) => (
                <li
                  key={s.sessionId}
                  className="px-5 py-3 text-sm hover:bg-bg-raised/30"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/charge-log/${s.sessionId}` as Parameters<typeof Link>[0]["href"]}
                        className="font-medium text-ink-100 hover:text-sv-sky"
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
                      </p>
                      <p className="text-[11px] text-ink-500">
                        {s.installationDisplayName && <>{s.installationDisplayName}</>}
                        {s.siteDisplayName && (
                          <>
                            {s.installationDisplayName ? " · " : ""}
                            {s.siteDisplayName}
                          </>
                        )}
                        {s.orgDisplayName && (
                          <>
                            {s.installationDisplayName || s.siteDisplayName ? " · " : ""}
                            {s.orgDisplayName}
                          </>
                        )}
                      </p>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-base font-semibold text-ink-100">{value}</dd>
    </div>
  );
}
