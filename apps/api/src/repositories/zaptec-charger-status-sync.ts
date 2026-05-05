// API-only charger-status poller — Sprint 8.8.
//
// Companion to zaptec-session-sync.ts. While the session writer
// catches CDRs, this module catches the operational state of the
// chargers themselves (online / offline / charging) for installations
// where OCPP is disabled and Heartbeat / StatusNotification frames
// don't reach us.
//
// Walks every charger reachable through a Zaptec credential, maps
// `OperatingMode` (StateId 710 mirror in the bulk listing) to our
// OcppIdentity.status enum, and stamps lastSeenAt = now so the
// operator console's "last seen" indicator stays fresh.
//
// Per docs/reference/integrations/zaptec.md §13.5, OperatingMode in
// the bulk /api/chargers response carries the last-known value even
// for offline chargers, which makes this a single REST call per
// credential — no per-charger /state round trips.

import type { PrismaClient } from "../generated/prisma/client";
import { listChargers, type ZaptecChargerLite } from "../lib/zaptec";

export interface ChargerStatusSyncOptions {
  accessToken: string;
}

export interface ChargerStatusUpdate {
  zaptecChargerId: string;
  ocppIdentityId: string;
  status: string;
  isOnline: boolean;
}

export interface ChargerStatusSkip {
  zaptecChargerId: string;
  reason:
    | "no_device_id"
    | "no_identity_mapped";
}

export interface ChargerStatusReport {
  zaptecCount: number;
  updated: ChargerStatusUpdate[];
  skipped: ChargerStatusSkip[];
}

/**
 * OperatingMode → our status string. Values per Zaptec docs §13.5
 * (also mirrored on ZaptecChargerLite.OperatingMode):
 *   0 = Unknown
 *   1 = Disconnected   → "available"
 *   2 = Requesting     → "preparing"
 *   3 = Charging       → "charging"
 *   5 = Finished       → "finishing"
 *   6 = Limited        → "suspended"
 * IsOnline=false short-circuits to "offline" regardless of mode —
 * an offline charger's last reported mode is stale.
 */
function mapStatus(charger: ZaptecChargerLite): string {
  if (charger.IsOnline === false) return "offline";
  switch (charger.OperatingMode) {
    case 1:
      return "available";
    case 2:
      return "preparing";
    case 3:
      return "charging";
    case 5:
      return "finishing";
    case 6:
      return "suspended";
    default:
      return charger.IsOnline ? "online" : "unknown";
  }
}

export async function syncZaptecChargerStatus(
  db: PrismaClient,
  options: ChargerStatusSyncOptions,
): Promise<ChargerStatusReport> {
  const resp = await listChargers(options.accessToken);
  if (!resp.ok) {
    throw new Error(
      `zaptec_listchargers_fetch_failed: ${JSON.stringify(resp.error)}`,
    );
  }

  const report: ChargerStatusReport = {
    zaptecCount: resp.value.length,
    updated: [],
    skipped: [],
  };

  const now = new Date();

  for (const charger of resp.value) {
    // OcppIdentity.vendorResourceId stores Zaptec's INTERNAL UUID
    // (charger.Id), not the human-readable DeviceId / serial. The
    // manage-tree apply path provisions identities keyed on Id.
    // DeviceId is logged for the report but not used for the join.
    const zaptecChargerId = charger.Id ?? null;
    if (!zaptecChargerId) {
      report.skipped.push({
        zaptecChargerId: charger.DeviceId ?? "(no-id)",
        reason: "no_device_id",
      });
      continue;
    }

    const identity = await db.ocppIdentity.findFirst({
      where: { vendor: "Zaptec", vendorResourceId: zaptecChargerId },
      select: { id: true },
    });
    if (!identity) {
      report.skipped.push({
        zaptecChargerId,
        reason: "no_identity_mapped",
      });
      continue;
    }

    const status = mapStatus(charger);
    await db.ocppIdentity.update({
      where: { id: identity.id },
      data: { status, lastSeenAt: now },
    });

    // Sprint 8.14.6 — write-through Zaptec's display name to
    // SiteAsset.displayName so /charge-log shows "K1" / "Festi 8"
    // instead of UUID slices. Only updates when the asset's current
    // displayName is empty / a UUID / the bare ChargerId, so
    // operator-edited names are preserved.
    if (charger.Name) {
      const stationId = await db.ocppIdentity
        .findUnique({
          where: { id: identity.id },
          select: { chargingStationId: true },
        })
        .then((r) => r?.chargingStationId);
      if (stationId) {
        const asset = await db.siteAsset.findUnique({
          where: { id: stationId },
          select: { displayName: true },
        });
        const shouldUpdate =
          asset &&
          (!asset.displayName ||
            /^[0-9a-f-]{36}$/i.test(asset.displayName) ||
            asset.displayName === zaptecChargerId);
        if (shouldUpdate) {
          await db.siteAsset
            .update({
              where: { id: stationId },
              data: { displayName: charger.Name },
            })
            .catch(() => undefined);
        }
      }
    }

    report.updated.push({
      zaptecChargerId,
      ocppIdentityId: identity.id,
      status,
      isOnline: charger.IsOnline ?? false,
    });
  }

  return report;
}
