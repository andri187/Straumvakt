// Sprint 9 / 2026-05-09 — ADR 0036 Autocharge — Vehicle IDs landing list.
// Returns every charging.sessions row that captured at least one
// vehicle-identity signal. Filter:
//   ev_plc_mac           IS NOT NULL  (link layer — StateId 953 / OCMF EVCCID)
//   OR auth_id_value     IS NOT NULL  (application layer — OCMF identity)
//   OR pnc_attempted     IS NOT NULL  (protocol layer — PnC attempt)
//
// Used by the /vehicle-ids landing page in the operator UI: a focused
// view to verify Autocharge captures without scanning every session.

import { desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { sessions } from "@straumvakt/shared/db/charging";
import { chargingStations, installations, siteAssets, sites } from "@straumvakt/shared/db/assets";
import { organizations, users } from "@straumvakt/shared/db/identity";
import type { Db } from "../lib/drizzle";

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
  db: Db,
  opts: { limit?: number } = {},
): Promise<VehicleIdSessionRow[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);

  // organization / site / user are all at most one row per session, so they
  // join without fanning out. LEFT on user — a session with no driver still
  // qualifies if it carries a vehicle-identity value.
  const rows = await db
    .select({
      id: sessions.id,
      chargingStationId: sessions.chargingStationId,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      energyWh: sessions.energyWh,
      idTag: sessions.idTag,
      evPlcMac: sessions.evPlcMac,
      evPlcMacOuiVendor: sessions.evPlcMacOuiVendor,
      evPlcPibVersion: sessions.evPlcPibVersion,
      cableType: sessions.cableType,
      pncAttempted: sessions.pncAttempted,
      pncSucceeded: sessions.pncSucceeded,
      pncRejectedUuid: sessions.pncRejectedUuid,
      authIdType: sessions.authIdType,
      authIdValue: sessions.authIdValue,
      orgDisplayName: organizations.displayName,
      siteDisplayName: sites.displayName,
      userEmail: users.email,
      userDisplayName: users.displayName,
      userFirstName: users.firstName,
      userLastName: users.lastName,
    })
    .from(sessions)
    .leftJoin(organizations, eq(organizations.id, sessions.orgId))
    .leftJoin(sites, eq(sites.id, sessions.siteId))
    .leftJoin(users, eq(users.id, sessions.userId))
    .where(
      or(
        isNotNull(sessions.evPlcMac),
        isNotNull(sessions.authIdValue),
        isNotNull(sessions.pncAttempted),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(limit);

  // Resolve charger display names + installations in batches
  const stationIds = Array.from(
    new Set(rows.map((r) => r.chargingStationId).filter((x): x is string => !!x)),
  );
  const [assets, stations] = await Promise.all([
    stationIds.length > 0
      ? db
          .select({ id: siteAssets.id, displayName: siteAssets.displayName })
          .from(siteAssets)
          .where(inArray(siteAssets.id, stationIds))
      : Promise.resolve([]),
    stationIds.length > 0
      ? db
          .select({
            siteAssetId: chargingStations.siteAssetId,
            serialNumber: chargingStations.serialNumber,
            installationDisplayName: installations.displayName,
          })
          .from(chargingStations)
          .leftJoin(installations, eq(installations.id, chargingStations.installationId))
          .where(inArray(chargingStations.siteAssetId, stationIds))
      : Promise.resolve([]),
  ]);
  const assetMap = new Map(assets.map((a) => [a.id, a.displayName]));
  const stationMap = new Map(stations.map((s) => [s.siteAssetId, s]));

  return rows.map((r) => {
    const station = r.chargingStationId ? stationMap.get(r.chargingStationId) : null;
    const driverDisplayName = r.userEmail
      ? [r.userFirstName, r.userLastName].filter(Boolean).join(" ").trim() ||
        r.userDisplayName ||
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
      installationDisplayName: station?.installationDisplayName ?? null,
      siteDisplayName: r.siteDisplayName ?? null,
      orgDisplayName: r.orgDisplayName ?? null,
      driverIdTag: r.idTag,
      driverDisplayName,
      driverEmail: r.userEmail ?? null,
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
