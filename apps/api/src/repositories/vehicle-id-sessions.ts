// Sprint 9 / 2026-05-09 — ADR 0021 Autocharge — Vehicle IDs landing list.
// Returns every charging.sessions row that captured at least one
// vehicle-identity signal. Filter:
//   ev_plc_mac           IS NOT NULL  (link layer — StateId 953 / OCMF EVCCID)
//   OR auth_id_value     IS NOT NULL  (application layer — OCMF identity)
//   OR pnc_attempted     IS NOT NULL  (protocol layer — PnC attempt)
//
// Used by the /vehicle-ids landing page in the operator UI: a focused
// view to verify Autocharge captures without scanning every session.

import type { PrismaClient } from "../generated/prisma/client";

export interface VehicleIdSessionRow {
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

  // Vehicle identity values — at least one is non-null per the filter
  evPlcMac: string | null;
  evPlcMacOuiVendor: string | null;
  evPlcPibVersion: string | null;
  cableType: string | null;
  pncAttempted: boolean | null;
  pncSucceeded: boolean | null;
  pncRejectedUuid: string | null;
  authIdType: string | null;
  authIdValue: string | null;

  /** Convenience: which layers captured for this row. */
  layers: ("link" | "protocol" | "application")[];
}

export async function listVehicleIdSessions(
  db: PrismaClient,
  opts: { limit?: number } = {},
): Promise<VehicleIdSessionRow[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);

  const rows = await db.chargeSession.findMany({
    where: {
      OR: [
        { evPlcMac: { not: null } },
        { authIdValue: { not: null } },
        { pncAttempted: { not: null } },
      ],
    },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      chargingStationId: true,
      startedAt: true,
      endedAt: true,
      energyWh: true,
      idTag: true,
      evPlcMac: true,
      evPlcMacOuiVendor: true,
      evPlcPibVersion: true,
      cableType: true,
      pncAttempted: true,
      pncSucceeded: true,
      pncRejectedUuid: true,
      authIdType: true,
      authIdValue: true,
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      user: {
        select: {
          email: true,
          displayName: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  // Resolve charger display names + installations in batches
  const stationIds = Array.from(
    new Set(rows.map((r) => r.chargingStationId).filter((x): x is string => !!x)),
  );
  const [siteAssets, stations] = await Promise.all([
    stationIds.length > 0
      ? db.siteAsset.findMany({
          where: { id: { in: stationIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([]),
    stationIds.length > 0
      ? db.chargingStation.findMany({
          where: { siteAssetId: { in: stationIds } },
          select: {
            siteAssetId: true,
            serialNumber: true,
            installation: { select: { displayName: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const assetMap = new Map(siteAssets.map((a) => [a.id, a.displayName]));
  const stationMap = new Map(stations.map((s) => [s.siteAssetId, s]));

  return rows.map((r) => {
    const station = r.chargingStationId ? stationMap.get(r.chargingStationId) : null;
    const driverDisplayName = r.user
      ? [r.user.firstName, r.user.lastName].filter(Boolean).join(" ").trim() ||
        r.user.displayName ||
        null
      : null;
    const layers: VehicleIdSessionRow["layers"] = [];
    if (r.evPlcMac !== null) layers.push("link");
    if (r.pncAttempted !== null) layers.push("protocol");
    if (r.authIdValue !== null) layers.push("application");

    return {
      sessionId: r.id,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      energyKwh: r.energyWh ? (Number(r.energyWh) / 1000).toFixed(3) : "0",
      chargingStationId: r.chargingStationId,
      chargerDisplayName: r.chargingStationId
        ? assetMap.get(r.chargingStationId) ?? null
        : null,
      chargerSerial: station?.serialNumber ?? null,
      installationDisplayName: station?.installation?.displayName ?? null,
      siteDisplayName: r.site?.displayName ?? null,
      orgDisplayName: r.organization?.displayName ?? null,
      driverIdTag: r.idTag,
      driverDisplayName,
      driverEmail: r.user?.email ?? null,
      evPlcMac: r.evPlcMac,
      evPlcMacOuiVendor: r.evPlcMacOuiVendor,
      evPlcPibVersion: r.evPlcPibVersion,
      cableType: r.cableType,
      pncAttempted: r.pncAttempted,
      pncSucceeded: r.pncSucceeded,
      pncRejectedUuid: r.pncRejectedUuid,
      authIdType: r.authIdType,
      authIdValue: r.authIdValue,
      layers,
    };
  });
}
