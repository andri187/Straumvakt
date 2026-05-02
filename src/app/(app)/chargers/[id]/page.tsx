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
          <Link href={`/accounts/organizations/${charger.orgId}` as Parameters<typeof Link>[0]["href"]} className="text-sv-sky hover:underline">{charger.orgDisplayName}</Link>
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
      {/* Connectors + commands — live status pill + per-connector
          Start/Stop inline. GetConfig / ChangeConfig collapsed in
          a <details> at the bottom. Pulls connector status straight
          from the connector.status_updated projection (live, updated
          on each StatusNotification). */}
      {identity && (
        <div className="mb-6">
          <ChargerCommandsPanel
            ocppIdentityId={identity.id}
            connectors={(evse?.connectors ?? []).map((c) => {
              // Source preference: real OCPP traffic (projection set
              // statusUpdatedAt) wins. When that's null — i.e. no
              // auth-passing OCPP traffic ever received for this
              // charger — fall back to Zaptec's OperatingMode label.
              // The status pill, errorCode pill, and timestamp all
              // get re-resolved here so the panel doesn't have to
              // know which source the data came from.
              const dbHasStatus = c.statusUpdatedAt != null;
              const vendorMode = technicalRead?.chargerOperationMode ?? null;
              return {
                id: c.id,
                connectorIndex: c.connectorIndex,
                type: c.type,
                status: dbHasStatus ? c.status : (mapVendorOperationMode(vendorMode) ?? "—"),
                errorCode: dbHasStatus ? c.errorCode : null,
                vendorErrorCode: dbHasStatus ? c.vendorErrorCode : null,
                statusUpdatedAt: c.statusUpdatedAt,
                source: dbHasStatus
                  ? "ocpp"
                  : vendorMode != null
                    ? "vendor"
                    : "none",
              };
            })}
          />
        </div>
      )}

      {/* Hardware identity / OCPP boot profile. Always shown when we
          have anything from either source — DB columns (populated by
          the BootNotification projection on auth-passing OCPP) or
          Zaptec live (chargers that haven't booted against us yet).
          Per-row source attribution via title hover so the operator
          can tell "real OCPP boot" from "vendor-side fallback". */}
      <ChargerHardwareSection charger={charger} read={technicalRead} />


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

      {/* Full Technical Read view — the long-form layout with every
          section grouped + sourced. Linked rather than inlined so this
          profile page stays scannable. */}
      <div className="mt-6 flex justify-center">
        <Link
          href={
            `/chargers/${charger.chargingStationId}/technical-read` as Parameters<typeof Link>[0]["href"]
          }
          className="inline-flex items-center gap-2 rounded-md border border-sv-sky/40 bg-sv-sky/10 px-4 py-2 text-sm font-medium text-sv-sky hover:bg-sv-sky/20"
        >
          Technical Read →
        </Link>
      </div>

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

/**
 * Map Zaptec's OperatingMode label (StateId 710) to OCPP-style
 * connector status taxonomy. Used as a fallback when our own
 * connector.status_updated projection has nothing to show — i.e.
 * before the first auth-passing StatusNotification arrives.
 */
function mapVendorOperationMode(mode: string | null): string | null {
  if (!mode) return null;
  if (/charging/i.test(mode)) return "Charging";
  if (/finish/i.test(mode)) return "Finishing";
  if (/disconnect/i.test(mode)) return "Available";
  if (/connected.*request/i.test(mode) && /limit/i.test(mode)) return "SuspendedEVSE";
  if (/connected.*request/i.test(mode)) return "Preparing";
  if (/limited/i.test(mode)) return "SuspendedEVSE";
  return mode;
}

/**
 * Render a row of operator-relevant identity facts pulled from
 * whichever source has data, with source attribution. Order of
 * preference per field:
 *   ocpp boot  — populated by our charger.booted projection on a
 *                real auth-passing BootNotification
 *   vendor api — populated by Zaptec's per-charger detail / state
 *                endpoints (live each request)
 *   missing    — render an em-dash, neither source has the value
 *
 * Never auto-hides — operator needs to see what's known and what
 * isn't, not have the section disappear when one source is empty.
 */
function ChargerHardwareSection({
  charger,
  read,
}: {
  charger: ChargerDetail;
  read: ChargerTechnicalRead | null;
}) {
  type Source = "ocpp" | "vendor" | null;
  function pick(
    fromBoot: string | null,
    fromVendor: string | null,
  ): { value: string | null; source: Source } {
    if (fromBoot) return { value: fromBoot, source: "ocpp" };
    if (fromVendor) return { value: fromVendor, source: "vendor" };
    return { value: null, source: null };
  }

  const rows = [
    {
      label: "DeviceId",
      ...pick(null, read?.deviceId ?? null),
    },
    {
      label: "Charge box serial",
      ...pick(charger.chargeBoxSerialNumber, read?.deviceId ?? null),
    },
    {
      label: "Meter ID (MID)",
      ...pick(null, read?.mid ?? null),
    },
    {
      label: "Meter type",
      ...pick(charger.meterType, null),
    },
    {
      label: "Meter serial",
      ...pick(charger.meterSerialNumber, null),
    },
    {
      label: "ICCID (SIM)",
      ...pick(charger.iccid, read?.lteIccid ?? null),
    },
    {
      label: "IMSI (SIM)",
      ...pick(charger.imsi, read?.lteImsi ?? null),
    },
    {
      label: "Firmware",
      ...pick(charger.firmwareVersion, read?.firmwareVersion ?? null),
    },
  ];

  // Don't render at all if EVERYTHING is missing — that's a worse
  // UX than a useful section. But render even one row of hits.
  if (rows.every((r) => r.value == null)) return null;

  return (
    <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-300">
          Hardware identity
        </h2>
        <SourceLegend />
      </header>
      <div className="grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <ProfileRow key={r.label} label={r.label} value={r.value} source={r.source} />
        ))}
      </div>
    </section>
  );
}

function SourceLegend() {
  return (
    <span className="flex items-center gap-2 text-[9px] text-ink-500">
      <span className="inline-flex items-center gap-1">
        <span className="h-1 w-1 rounded-full bg-sv-green" /> OCPP boot
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-1 w-1 rounded-full bg-sv-sky" /> Vendor API
      </span>
    </span>
  );
}

function ProfileRow({
  label,
  value,
  source,
}: {
  label: string;
  value: string | null;
  source: "ocpp" | "vendor" | null;
}) {
  const dot =
    source === "ocpp"
      ? "bg-sv-green"
      : source === "vendor"
        ? "bg-sv-sky"
        : "bg-ink-700";
  const title =
    source === "ocpp"
      ? "From an auth-passing OCPP BootNotification (cached in our DB)"
      : source === "vendor"
        ? "Live from Zaptec API"
        : "Not reported by either source";
  return (
    <div className="flex items-baseline gap-2 min-w-0" title={title}>
      <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${dot}`} />
      <span className="shrink-0 font-mono text-[10px] text-ink-500">{label}</span>
      <span className="font-mono text-[11px] text-ink-100 break-all truncate">
        {value ?? "—"}
      </span>
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
