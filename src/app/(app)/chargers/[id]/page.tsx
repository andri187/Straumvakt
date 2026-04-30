import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { apiFetchServer, apiFetchServerJson } from "@/lib/api-client-server";
import type { ChargerDetail } from "@straumvakt/shared/domain/chargers";
import { DeleteButton } from "@/components/delete-button";
import { EditChargerPanel } from "./edit-panel";

export const dynamic = "force-dynamic";

export default async function ChargerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailRes = await apiFetchServer(`/api/admin/chargers/${id}`);
  if (detailRes.status === 404) notFound();
  if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
  const { charger } = (await detailRes.json()) as { charger: ChargerDetail };

  const [{ installations }, { circuits }] = await Promise.all([
    apiFetchServerJson<{ installations: { id: string; displayName: string }[] }>(
      `/api/admin/sites/${charger.siteId}/installations`,
    ),
    apiFetchServerJson<{ circuits: { id: string; displayName: string }[] }>(
      `/api/admin/sites/${charger.siteId}/circuits`,
    ),
  ]);

  const evse = charger.evses[0];
  const connector = evse?.connectors[0];
  const identity = charger.ocppIdentities[0];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={CHARGERS_TABS} />
      <Link href="/chargers" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to chargers
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">{identity?.identityString ?? charger.serialNumber ?? charger.chargingStationId.slice(0, 8)}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Org <Link href={`/tenants/organizations/${charger.orgId}`} className="text-sv-sky hover:underline">{charger.orgDisplayName}</Link>
          {" · "}Site <span className="text-ink-300">{charger.siteDisplayName}</span>
          {charger.installationDisplayName && <> · Installation <span className="text-ink-300">{charger.installationDisplayName}</span></>}
          {charger.circuitDisplayName && <> · Circuit <span className="text-ink-300">{charger.circuitDisplayName}</span></>}
        </p>
        <div className="mt-1 flex gap-3 font-mono text-[10px] text-ink-500">
          <span>Station {charger.chargingStationId.slice(0, 8)}</span>
          {evse && <span>EVSE {evse.id.slice(0, 8)}</span>}
          {connector && <span>Connector {connector.id.slice(0, 8)}</span>}
          {identity && <span>OcppIdentity {identity.id.slice(0, 8)}</span>}
        </div>
      </header>

      {/* OCPP profile — auto-populated from the BootNotification projection.
          All read-only on the operator side; the charger is the source of
          truth. Hides cleanly when the charger has never booted yet. */}
      {hasOcppProfile(charger) && (
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-4">
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink-50">OCPP profile</h2>
            <span className="text-[10px] text-ink-500">
              Auto-populated from BootNotification — read-only.
            </span>
          </header>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[160px_1fr]">
            <ProfileRow label="charge_box_serial_number" value={charger.chargeBoxSerialNumber} />
            <ProfileRow label="meter_type" value={charger.meterType} />
            <ProfileRow label="meter_serial_number" value={charger.meterSerialNumber} />
            <ProfileRow label="iccid" value={charger.iccid} />
            <ProfileRow label="imsi" value={charger.imsi} />
          </dl>
        </section>
      )}

      {/* Connector status with errorCode breakout. */}
      {evse && evse.connectors.length > 0 && (
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-4">
          <header className="mb-3">
            <h2 className="text-sm font-semibold text-ink-50">Connector status</h2>
            <p className="mt-0.5 text-[10px] text-ink-500">
              Live — updates from the connector.status_updated projection on each OCPP StatusNotification.
            </p>
          </header>
          <ul className="space-y-2 text-xs">
            {evse.connectors.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-2 rounded border border-bg-border/40 bg-bg-base/40 px-3 py-2">
                <span className="text-ink-200">
                  Connector <span className="font-mono text-[10px] text-ink-400">#{c.connectorIndex}</span>
                  <span className="ml-2 text-ink-500">{c.type}</span>
                </span>
                <span className="flex items-baseline gap-2">
                  <StatusPill status={c.status} />
                  {c.errorCode && (
                    <span className="rounded border border-rose-700/40 bg-rose-950/30 px-1.5 py-0.5 text-[10px] font-medium text-rose-200">
                      {c.errorCode}
                      {c.vendorErrorCode && <span className="ml-1 text-rose-300/70">[{c.vendorErrorCode}]</span>}
                    </span>
                  )}
                  {c.statusUpdatedAt && (
                    <span className="text-[10px] text-ink-500">
                      {new Date(c.statusUpdatedAt).toLocaleTimeString()}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EditChargerPanel
        chargingStationId={charger.chargingStationId}
        installationOptions={installations}
        circuitOptions={circuits}
        initial={{
          stationVendor: charger.vendor ?? "",
          stationModel: charger.model ?? "",
          stationSerialNumber: charger.serialNumber ?? "",
          stationFirmwareVersion: charger.firmwareVersion ?? "",
          installationId: charger.installationId ?? "",
          circuitId: charger.circuitId ?? "",
          evseId: evse?.id ?? "",
          evseMaxPowerKw: evse?.maxPowerKw ?? "",
          evsePhaseCount: evse?.phaseCount?.toString() ?? "",
          connectorId: connector?.id ?? "",
          connectorType: connector?.type ?? "Type2",
          connectorMaxPowerKw: connector?.maxPowerKw ?? "",
          locationNote: charger.locationNote ?? "",
          mountingType: charger.mountingType ?? "",
          photoUrl: charger.photoUrl ?? "",
          ipRating: charger.ipRating ?? "",
          breakerAmps: charger.breakerAmps?.toString() ?? "",
        }}
      />

      <section className="mt-8 rounded-lg border border-rose-700/30 bg-rose-950/10 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-rose-200">Danger zone</h2>
            <p className="mt-1 text-xs text-rose-300/80">
              Deletes the ChargingStation + EVSE + Connector + OcppIdentity rows. If
              the physical charger keeps connecting to our gateway with the same
              identity-string, it will reappear under{" "}
              <Link href="/chargers/pending" className="underline hover:text-rose-100">
                /chargers/pending
              </Link>{" "}
              within seconds.
            </p>
          </div>
          <DeleteButton
            endpoint={`/api/admin/chargers/${charger.chargingStationId}`}
            redirectTo="/chargers"
            confirmText={`Delete charger "${identity?.identityString ?? charger.chargingStationId.slice(0, 8)}"? This cannot be undone (the OCPP password is gone for good — re-provisioning generates a new one).`}
            label="Delete charger"
          />
        </div>
      </section>
    </div>
  );
}

function hasOcppProfile(c: ChargerDetail): boolean {
  return Boolean(
    c.chargeBoxSerialNumber || c.meterType || c.meterSerialNumber || c.iccid || c.imsi,
  );
}

function ProfileRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt className="font-mono text-[10px] text-ink-500">{label}</dt>
      <dd className="font-mono text-[11px] text-ink-100 break-all">{value}</dd>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Available" || status === "available"
      ? "bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
      : status === "Charging" || status === "charging"
        ? "bg-sv-sky/20 text-sv-sky border-sv-sky/40"
        : status === "Faulted" || status === "faulted"
          ? "bg-rose-950/40 text-rose-300 border-rose-700/40"
          : status === "Unavailable" || status === "unavailable"
            ? "bg-amber-950/40 text-amber-300 border-amber-700/40"
            : "bg-slate-800/60 text-slate-300 border-slate-700/40";
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
        tone
      }
    >
      {status}
    </span>
  );
}
