// API-only charger-status poller — Sprint 8.8.
//
// Companion to zaptec-session-sync.ts. While the session writer
// catches CDRs, this module catches the operational state of the
// chargers themselves (online / offline / charging) for installations
// where OCPP is disabled and Heartbeat / StatusNotification frames
// don't reach us.
//
// Sprint 8.13.2 — bulk /api/chargers `IsOnline` was caught lying
// (cached "online" stayed sticky for hours after a charger really went
// offline; portal disagreed). The bulk listing is now used purely to
// enumerate the chargers visible to a credential. Per-charger
// /api/chargers/{id}/state is the source of truth for IsOnline:
//   • /state succeeds + StateId -2 = "true"  → status mapped, lastSeenAt = now
//   • /state succeeds + StateId -2 = "false" → status = "offline", lastSeenAt untouched
//   • /state fails (Zaptec can't reach the charger or the call errors)
//     → no DB write at all; lastSeenAt naturally ages past the
//       site-tree 12-min window and the UI flips offline within
//       1–2 ticks. This is the right semantic — if we can't talk to
//       the charger, claiming "still online" would be a lie.
//
// Cost: one /state call per charger per credential per */5 tick (was
// 1 bulk call total). Run sequentially — Zaptec rate-limits bursts on
// the same OAuth token (caught during session backfill, Sprint 8.14.1).

import type { PrismaClient } from "../generated/prisma/client";
import {
  getChargerState,
  listChargers,
  type ZaptecChargerLite,
  type ZaptecStateEntry,
} from "../lib/zaptec";

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
    | "no_identity_mapped"
    | "state_unreachable";
}

export interface ChargerStatusReport {
  zaptecCount: number;
  updated: ChargerStatusUpdate[];
  skipped: ChargerStatusSkip[];
}

/**
 * OperatingMode → our status string. Values per Zaptec docs §13.5:
 *   0 = Unknown
 *   1 = Disconnected   → "available"
 *   2 = Requesting     → "preparing"
 *   3 = Charging       → "charging"
 *   5 = Finished       → "finishing"
 *   6 = Limited        → "suspended"
 * Caller has already established isOnline=true via per-charger /state;
 * if mode is missing/unknown we report a generic "online".
 */
function mapModeToStatus(operatingMode: number | undefined): string {
  switch (operatingMode) {
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
      return "online";
  }
}

/**
 * Parse StateId -2 (synthetic IsOnline observation) out of a /state
 * response. Returns null when the entry is absent or its value isn't
 * recognisable as a boolean — caller treats that as "unknown" and
 * skips the write rather than guessing.
 */
function parseIsOnlineFromState(
  observations: ZaptecStateEntry[],
): boolean | null {
  const entry = observations.find((e) => e.StateId === -2);
  if (!entry) return null;
  const v = entry.ValueAsString;
  if (v === "true" || v === "True" || v === "1") return true;
  if (v === "false" || v === "False" || v === "0") return false;
  return null;
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

    // Sprint 8.13.2 — bulk listing's IsOnline is stale (caught at K3 /
    // ZPR042320: bulk said online while /state was unreachable). Use
    // per-charger /state's StateId -2 as the source of truth. If
    // /state itself fails, leave the row alone — the 12-min lastSeenAt
    // window in site-tree will age this charger out naturally.
    const stateRes = await getChargerState(options.accessToken, zaptecChargerId);
    if (!stateRes.ok) {
      report.skipped.push({ zaptecChargerId, reason: "state_unreachable" });
      continue;
    }
    const isOnline = parseIsOnlineFromState(stateRes.value);
    if (isOnline == null) {
      // /state succeeded but no usable IsOnline observation — same
      // semantic as a /state failure: don't write, let the row age.
      report.skipped.push({ zaptecChargerId, reason: "state_unreachable" });
      continue;
    }

    const status = isOnline ? mapModeToStatus(charger.OperatingMode) : "offline";
    await db.ocppIdentity.update({
      where: { id: identity.id },
      data: isOnline ? { status, lastSeenAt: now } : { status },
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
      isOnline,
    });
  }

  return report;
}
