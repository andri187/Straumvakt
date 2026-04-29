import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { apiFetchServer, apiFetchServerJson } from "@/lib/api-client-server";
import type { ChargerDetail } from "@straumvakt/shared/domain/chargers";
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
        }}
      />
    </div>
  );
}
