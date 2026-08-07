// Sprint 9 / 2026-05-09 — ADR 0036 Autocharge Step G
// Vehicle-recurrence query — answers "where else has this same vehicle
// (PLC MAC) been seen?"
//
// Operator support flow: a driver complains about repeated issues; we
// open the session detail page; the EV PLC MAC is shown; we click it
// → /vehicles/[mac] surfaces every other session this vehicle has
// touched across our network. Pattern recognition without requiring
// formal driver attribution.

import { desc, eq, inArray } from "drizzle-orm";
import { sessions as chargeSessions } from "@straumvakt/shared/db/charging";
import { chargingStations, installations, siteAssets, sites } from "@straumvakt/shared/db/assets";
import { organizations, users } from "@straumvakt/shared/db/identity";
import type { Db } from "../lib/drizzle";
import { formatMac, lookupOuiVendor } from "../lib/oui/lookup";

export interface VehicleRecurrenceSession {
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

export interface VehicleRecurrence {
  /** Canonical MAC form (colon-separated lowercase). */
  mac: string;
  /** OUI prefix (first 3 bytes, uppercase, no separators). */
  ouiPrefix: string | null;
  /** Vendor name from OUI lookup, e.g. "Tesla". null when OUI unknown. */
  vendor: string | null;
  /** First time we saw this MAC. */
  firstSeenAt: string | null;
  /** Most recent time we saw this MAC. */
  lastSeenAt: string | null;
  /** Total session count where this MAC appeared. */
  totalSessions: number;
  /** Distinct chargers this MAC has touched. */
  distinctChargers: number;
  /** Distinct sites this MAC has touched. */
  distinctSites: number;
  /** Per-session detail, ordered most-recent first. Capped at 200. */
  sessions: VehicleRecurrenceSession[];
}

/**
 * Look up every charging.sessions row where ev_plc_mac matches the
 * input MAC. Match is case-insensitive but the canonical stored form
 * is colon-separated lowercase (per the OUI lookup helper).
 */
export async function getVehicleRecurrence(
  db: Db,
  inputMac: string,
): Promise<VehicleRecurrence | null> {
  const canonical = formatMac(inputMac);
  if (!canonical) return null;

  const rows = await db
    .select({
      id: chargeSessions.id,
      chargingStationId: chargeSessions.chargingStationId,
      startedAt: chargeSessions.startedAt,
      endedAt: chargeSessions.endedAt,
      energyWh: chargeSessions.energyWh,
      idTag: chargeSessions.idTag,
      userId: chargeSessions.userId,
      siteId: chargeSessions.siteId,
      orgDisplayName: organizations.displayName,
      siteDisplayName: sites.displayName,
      userEmail: users.email,
      userDisplayName: users.displayName,
      userFirstName: users.firstName,
      userLastName: users.lastName,
    })
    .from(chargeSessions)
    .leftJoin(organizations, eq(organizations.id, chargeSessions.orgId))
    .leftJoin(sites, eq(sites.id, chargeSessions.siteId))
    .leftJoin(users, eq(users.id, chargeSessions.userId))
    .where(eq(chargeSessions.evPlcMac, canonical))
    .orderBy(desc(chargeSessions.startedAt))
    .limit(200);

  if (rows.length === 0) {
    const oui = lookupOuiVendor(canonical);
    return {
      mac: canonical,
      ouiPrefix: oui.oui,
      vendor: oui.vendor,
      firstSeenAt: null,
      lastSeenAt: null,
      totalSessions: 0,
      distinctChargers: 0,
      distinctSites: 0,
      sessions: [],
    };
  }

  // Resolve charger display names + serials in a single batch
  const stationIds = Array.from(
    new Set(rows.map((r) => r.chargingStationId).filter((x): x is string => !!x)),
  );
  const [assets, stations] = await Promise.all([
    db
      .select({ id: siteAssets.id, displayName: siteAssets.displayName })
      .from(siteAssets)
      .where(inArray(siteAssets.id, stationIds)),
    db
      .select({
        siteAssetId: chargingStations.siteAssetId,
        serialNumber: chargingStations.serialNumber,
        installationDisplayName: installations.displayName,
      })
      .from(chargingStations)
      .leftJoin(installations, eq(installations.id, chargingStations.installationId))
      .where(inArray(chargingStations.siteAssetId, stationIds)),
  ]);
  const assetMap = new Map(assets.map((a) => [a.id, a.displayName]));
  const stationMap = new Map(stations.map((s) => [s.siteAssetId, s]));

  const sessions: VehicleRecurrenceSession[] = rows.map((r) => {
    const station = r.chargingStationId ? stationMap.get(r.chargingStationId) : null;
    const driverDisplayName = r.userEmail
      ? [r.userFirstName, r.userLastName].filter(Boolean).join(" ").trim() ||
        r.userDisplayName ||
        null
      : null;
    return {
      sessionId: r.id,
      chargingStationId: r.chargingStationId,
      chargerDisplayName: r.chargingStationId
        ? assetMap.get(r.chargingStationId) ?? null
        : null,
      chargerSerial: station?.serialNumber ?? null,
      installationDisplayName: station?.installationDisplayName ?? null,
      siteDisplayName: r.siteDisplayName ?? null,
      orgDisplayName: r.orgDisplayName ?? null,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      energyKwh: r.energyWh ? (Number(r.energyWh) / 1000).toFixed(3) : "0",
      driverUserId: r.userId,
      driverDisplayName,
      driverEmail: r.userEmail ?? null,
      driverIdTag: r.idTag,
    };
  });

  const distinctChargers = new Set(
    rows.map((r) => r.chargingStationId).filter((x): x is string => !!x),
  ).size;
  const distinctSites = new Set(
    rows.map((r) => r.siteId).filter((x): x is string => !!x),
  ).size;

  // Sessions ordered most-recent first by query, so:
  //   first session row → most recent
  //   last session row  → oldest
  const lastSeenAt = sessions[0]?.startedAt ?? null;
  const firstSeenAt = sessions[sessions.length - 1]?.startedAt ?? null;

  const oui = lookupOuiVendor(canonical);

  return {
    mac: canonical,
    ouiPrefix: oui.oui,
    vendor: oui.vendor,
    firstSeenAt,
    lastSeenAt,
    totalSessions: rows.length,
    distinctChargers,
    distinctSites,
    sessions,
  };
}
