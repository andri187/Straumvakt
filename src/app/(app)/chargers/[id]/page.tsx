import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { apiFetchServer, apiFetchServerJson } from "@/lib/api-client-server";
import type { ChargerDetail } from "@straumvakt/shared/domain/chargers";
import type { ChargerTechnicalRead } from "@straumvakt/shared/domain/charger-technical-read";
import { DeleteButton } from "@/components/delete-button";
import { EditChargerPanel } from "./edit-panel";
import { ChargerCommandsPanel } from "./commands-panel";
import { TechnicalReadPills, TechnicalReadDetail } from "./technical-read-panel";

export const dynamic = "force-dynamic";

export default async function ChargerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailRes = await apiFetchServer(`/api/admin/chargers/${id}`);
  if (detailRes.status === 404) notFound();
  if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
  const { charger } = (await detailRes.json()) as { charger: ChargerDetail };

  // Fan out the slow Zaptec round-trip (auth + 2 API calls) in
  // parallel with the form-option fetches. If Zaptec is unreachable
  // the API Worker returns { fresh: false } and we render placeholders.
  const [{ installations }, { circuits }, technicalReadResult] = await Promise.all([
    apiFetchServerJson<{ installations: { id: string; displayName: string }[] }>(
      `/api/admin/sites/${charger.siteId}/installations`,
    ),
    apiFetchServerJson<{ circuits: { id: string; displayName: string }[] }>(
      `/api/admin/sites/${charger.siteId}/circuits`,
    ),
    apiFetchServer(`/api/admin/chargers/${id}/technical-read`)
      .then(async (r) =>
        r.ok ? ((await r.json()) as { technicalRead: ChargerTechnicalRead }).technicalRead : null,
      )
      .catch(() => null),
  ]);
  const technicalRead = technicalReadResult;

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
      <header className="mb-4 border-b border-bg-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink-50">{identity?.identityString ?? charger.serialNumber ?? charger.chargingStationId.slice(0, 8)}</h1>
          <WarrantyEmblem expires={charger.warrantyExpires} />
        </div>
        <p className="mt-0.5 text-xs text-ink-400">
          <Link href={`/tenants/organizations/${charger.orgId}`} className="text-sv-sky hover:underline">{charger.orgDisplayName}</Link>
          {" · "}<span className="text-ink-300">{charger.siteDisplayName}</span>
          {charger.installationDisplayName && <> · <span className="text-ink-300">{charger.installationDisplayName}</span></>}
          {charger.circuitDisplayName && <> · <span className="text-ink-300">{charger.circuitDisplayName}</span></>}
          {(charger.vendor || charger.model) && (
            <> · <span className="text-ink-300">{charger.vendor} {charger.model}</span></>
          )}
        </p>
        <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10px] text-ink-500">
          <span>stn {charger.chargingStationId.slice(0, 8)}</span>
          {evse && <span>evse {evse.id.slice(0, 8)}</span>}
          {connector && <span>conn {connector.id.slice(0, 8)}</span>}
          {identity && <span>ocpp {identity.id.slice(0, 8)}</span>}
        </div>
      </header>

      {/* Compact technical-read pills — Signal / Comm / OCPP / Firmware
          / Grid / Temp. Pulled live from Zaptec each page load; renders
          em-dash placeholders when the vendor side is unreachable. */}
      <TechnicalReadPills
        read={technicalRead}
        firmwareFromBoot={charger.firmwareVersion}
      />

      {/* Operator command surface — only mount when there's an OcppIdentity
          (without one, /api/admin/chargers/<id>/<command> would 404 since
          the route keys on ocppIdentityId). */}
      {identity && (
        <div className="mb-6">
          <ChargerCommandsPanel
            ocppIdentityId={identity.id}
            connectors={(evse?.connectors ?? []).map((c) => ({
              id: c.id,
              connectorIndex: c.connectorIndex,
              type: c.type,
            }))}
          />
        </div>
      )}

      {/* OCPP profile + connector status — combined compact card.
          OCPP fields auto-populate from BootNotification; connectors
          come from the connector.status_updated projection. */}
      {(hasOcppProfile(charger) || (evse && evse.connectors.length > 0)) && (
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-3">
          {hasOcppProfile(charger) && (
            <>
              <header className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-300">OCPP profile</h2>
                <span className="text-[10px] text-ink-500">BootNotification — read-only</span>
              </header>
              <div className="mb-3 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
                <ProfileRow label="charge_box_serial" value={charger.chargeBoxSerialNumber} />
                <ProfileRow label="meter_type" value={charger.meterType} />
                <ProfileRow label="meter_serial" value={charger.meterSerialNumber} />
                <ProfileRow label="iccid" value={charger.iccid} />
                <ProfileRow label="imsi" value={charger.imsi} />
              </div>
            </>
          )}

          {evse && evse.connectors.length > 0 && (
            <>
              <header className="mb-2 flex items-baseline justify-between border-t border-bg-border/40 pt-2">
                <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-300">Connectors</h2>
                <span className="text-[10px] text-ink-500">live · StatusNotification projection</span>
              </header>
              <ul className="grid gap-1 text-[11px] sm:grid-cols-2">
                {evse.connectors.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-bg-border/40 bg-bg-base/40 px-2 py-1"
                  >
                    <span className="font-mono text-[10px] text-ink-400">#{c.connectorIndex}</span>
                    <span className="text-ink-300">{c.type}</span>
                    <StatusPill status={c.status} />
                    {c.errorCode && (
                      <span className="rounded border border-rose-700/40 bg-rose-950/30 px-1 py-0 text-[10px] font-medium text-rose-200">
                        {c.errorCode}
                        {c.vendorErrorCode && <span className="ml-1 text-rose-300/70">[{c.vendorErrorCode}]</span>}
                      </span>
                    )}
                    {c.statusUpdatedAt && (
                      <span className="ml-auto text-[10px] text-ink-500">
                        {new Date(c.statusUpdatedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <details className="mb-6 rounded-lg border border-bg-border bg-bg-base/30">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-brand text-ink-300 hover:text-ink-100">
          Edit charger
        </summary>
        <div className="border-t border-bg-border/40 p-3">
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
        </div>
      </details>

      {/* Extended technical read — live dashboard, hardware identity,
          environment, etc. Below the edit panel per operator request. */}
      <TechnicalReadDetail read={technicalRead} />

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
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="shrink-0 font-mono text-[10px] text-ink-500">{label}</span>
      <span className="font-mono text-[11px] text-ink-100 break-all truncate">{value}</span>
    </div>
  );
}

function WarrantyEmblem({ expires }: { expires: string | null }) {
  // Parse the YYYY-MM-DD date in UTC so timezone drift around midnight
  // doesn't flip the badge a day early/late. Comparison happens at the
  // date granularity the column stores at.
  const inWarranty =
    expires != null &&
    Number.isFinite(new Date(expires + "T00:00:00Z").getTime()) &&
    new Date(expires + "T00:00:00Z").getTime() > Date.now();

  const label = expires
    ? `${inWarranty ? "Warranty" : "Out of warranty"} · ${expires}`
    : "No warranty info";
  const tone = inWarranty
    ? "border-sv-green/40 bg-sv-green/10 text-sv-green"
    : "border-bg-border bg-bg-base/40 text-ink-500";

  return (
    <span
      title={label}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-brand " +
        tone
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " + (inWarranty ? "bg-sv-green" : "bg-ink-500")
        }
      />
      {inWarranty ? "Warranty" : "Out of warranty"}
    </span>
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
