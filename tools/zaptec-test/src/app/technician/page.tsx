import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { ChargerPicker, type PickerInstallation } from "@/components/charger-picker";
import { TechnicianView } from "@/components/technician-view";
import { TierIcons, type TierRow } from "@/components/sv-hierarchy";
import { fmtDeviceType } from "@/components/profile-bits";
import {
  getCharger,
  getChargerState,
  getInstallation,
  getInstallationFirmware,
  getInstallationHierarchy,
  getInstallationMessaging,
  listChargeHistory,
  listChargers,
  listInstallations,
} from "@/lib/zaptec";

export const dynamic = "force-dynamic";

// Defaults requested by the user
const DEFAULT_INSTALLATION_ID = "7d722149-3c5f-4488-8bf2-e660503e11e9"; // Dalvegur 10 - 14
const DEFAULT_CHARGER_ID = "03278fc6-ab76-47af-9ccc-b84e90e07284"; // Festi 5

export default async function ChargerInfoAllPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string; charger?: string }>;
}) {
  const sp = await searchParams;

  // Step 1 — fetch all installations + their chargers (lightweight) to build dropdowns
  const installations = await listInstallations();
  const groups = await Promise.all(
    installations.map(async (inst) => ({
      installation: inst,
      chargers: await listChargers(inst.Id).catch(() => []),
    })),
  );

  const pickerData: PickerInstallation[] = groups.map((g) => ({
    id: g.installation.Id,
    name: g.installation.Name ?? g.installation.Id,
    chargers: g.chargers.map((c) => ({
      id: c.Id,
      name: c.Name,
      online: c.IsOnline === true,
    })),
  }));

  // Step 2 — resolve selected installation, falling back through:
  //   1. searchParams
  //   2. user-requested default (Dalvegur 10-14)
  //   3. first installation we have
  let selectedInstallationId =
    sp.installation ??
    (pickerData.some((p) => p.id === DEFAULT_INSTALLATION_ID)
      ? DEFAULT_INSTALLATION_ID
      : pickerData[0]?.id ?? "");

  if (!pickerData.some((p) => p.id === selectedInstallationId)) {
    selectedInstallationId = pickerData[0]?.id ?? "";
  }

  const selectedInstallation = pickerData.find(
    (p) => p.id === selectedInstallationId,
  );

  // Step 3 — resolve selected charger within the chosen installation:
  //   1. searchParams (must be in the chosen installation)
  //   2. user-requested default (Festi 5) if it's in the chosen installation
  //   3. first charger of the chosen installation
  let selectedChargerId = sp.charger ?? "";
  const isValidCharger = selectedInstallation?.chargers.some(
    (c) => c.id === selectedChargerId,
  );
  if (!isValidCharger) {
    if (selectedInstallation?.chargers.some((c) => c.id === DEFAULT_CHARGER_ID)) {
      selectedChargerId = DEFAULT_CHARGER_ID;
    } else {
      selectedChargerId = selectedInstallation?.chargers[0]?.id ?? "";
    }
  }

  // Step 4 — fetch the technician-grade data for the selected charger
  const chargerLoad = selectedChargerId
    ? await loadChargerData(selectedInstallationId, selectedChargerId)
    : null;

  return (
    <>
      <Topbar
        title="Charger info"
        hint={
          chargerLoad
            ? `${chargerLoad.installation?.Name ?? ""} · ${chargerLoad.charger.Name}`
            : "Pick an installation"
        }
      />
      <PageShell
        title="Charger info"
        description="Pick an installation and a charger. The full technician view of the selected unit renders below."
      >
        <ChargerPicker
          installations={pickerData}
          selectedInstallationId={selectedInstallationId}
          selectedChargerId={selectedChargerId}
        />

        {chargerLoad ? (
          <TechnicianView
            charger={chargerLoad.charger}
            installation={chargerLoad.installation}
            hierarchy={chargerLoad.hierarchy}
            state={chargerLoad.state}
            history={chargerLoad.history}
            firmware={chargerLoad.firmware}
            messaging={chargerLoad.messaging}
            tierRows={buildTierRows(chargerLoad)}
          />
        ) : (
          <p className="text-sm text-ink-400">
            No charger selected. Pick one from the dropdown above.
          </p>
        )}
      </PageShell>
    </>
  );
}

async function loadChargerData(installationId: string, chargerId: string) {
  const [charger, state, installation, hierarchy, history, firmware, messaging] =
    await Promise.all([
      getCharger(chargerId),
      getChargerState(chargerId).catch(() => []),
      getInstallation(installationId).catch(() => null),
      getInstallationHierarchy(installationId).catch(() => null),
      listChargeHistory({ chargerId, pageSize: 10 }).catch(() => null),
      getInstallationFirmware(installationId).catch(() => null),
      getInstallationMessaging(installationId).catch(() => null),
    ]);
  return { charger, state, installation, hierarchy, history, firmware, messaging };
}

function buildTierRows({
  charger,
  installation,
  hierarchy,
}: Awaited<ReturnType<typeof loadChargerData>>): TierRow[] {
  const myCircuit = hierarchy?.Circuits?.find((c) =>
    (c.Chargers ?? []).some((ch) => ch.Id === charger.Id),
  );
  const ocppUrlTemplate = (charger as { PropertyOcppUrl?: string }).PropertyOcppUrl;
  const deviceId = (charger.DeviceId as string | undefined) ?? "";
  const ocppUrlResolved =
    ocppUrlTemplate && deviceId
      ? ocppUrlTemplate.replace("{deviceid}", deviceId)
      : ocppUrlTemplate ?? "";
  const ocppHost = ocppUrlResolved
    ? new URL(ocppUrlResolved.replace(/^wss:/, "https:")).host
    : "";

  return [
    {
      tier: "Org (CPO)",
      v3Entity: "core.organizations",
      icon: TierIcons.Org,
      source: "pending",
      primary: "Straumvakt (demo)",
      secondary: "tenant",
    },
    {
      tier: "Charger Host",
      v3Entity: "properties.charger_hosts",
      icon: TierIcons.ChargerHost,
      source: "pending",
      primary: "Pending Straumvakt onboarding",
      secondary: "workplace / MDU / hotel / fleet operator",
    },
    {
      tier: "Property",
      v3Entity: "properties.properties",
      icon: TierIcons.Property,
      source: "pending",
      primary: installation?.Address
        ? `${installation.Address}${installation.City ? `, ${installation.City}` : ""}`
        : "Pending",
      secondary: "physical building",
    },
    {
      tier: "Site",
      v3Entity: "properties.sites",
      icon: TierIcons.Site,
      source: "pending",
      primary: installation?.Name ?? "Pending",
      secondary: "sublocation within property",
    },
    {
      tier: "Installation",
      v3Entity: "properties.installations",
      icon: TierIcons.Installation,
      source: "live",
      primary: installation?.Name ?? "—",
      secondary: `Zaptec · ${installation?.Id ?? ""}`,
      badge: "credential boundary",
    },
    {
      tier: "Circuit",
      v3Entity: "(not yet a V3 entity)",
      icon: TierIcons.Circuit,
      source: "live",
      primary: myCircuit?.Name ?? "—",
      secondary: myCircuit
        ? `${myCircuit.Chargers?.length ?? 0} chargers · ${myCircuit.MaxCurrent ?? "—"} A fuse`
        : "circuit not resolved",
    },
    {
      tier: "SiteAsset (Charger)",
      v3Entity: "properties.site_assets",
      icon: TierIcons.Charger,
      source: "live",
      primary: charger.Name,
      secondary: `${fmtDeviceType(charger.DeviceType)} · ${charger.SerialNo ?? deviceId}`,
    },
    {
      tier: "OCPP Identity",
      v3Entity: "ocpp.ocpp_identities",
      icon: TierIcons.OCPPIdentity,
      source: "derived",
      primary: deviceId || "—",
      secondary: ocppHost ? `via ${ocppHost}` : "no OCPP URL",
    },
    {
      tier: "Connector",
      v3Entity: "ocpp.connectors",
      icon: TierIcons.Connector,
      source: "pending",
      primary: "1 connector (assumed)",
      secondary: "Zaptec API does not expose connector count on this endpoint",
    },
  ];
}
