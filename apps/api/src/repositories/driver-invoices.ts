// Driver billing source — the driver's ACTUAL charge sessions (charging.sessions
// where user_id = driver), which is the canonical set for invoices. Distinct
// from reports.session_ledger, which only holds the subset that went through the
// billing projection. The per-session amount uses the ledger cost when present
// (canonical, computed at stop), else the session's rolled-up cost; null when
// the session was never costed (the P1 engine fills those — see step 2).

import { desc, eq, inArray } from "drizzle-orm";
import { sessions } from "@straumvakt/shared/db/charging";
import { sessionLedger } from "@straumvakt/shared/db/commercial";
import { chargingStations, siteAssets, sites } from "@straumvakt/shared/db/assets";
import { organizations } from "@straumvakt/shared/db/identity";
import type { Db } from "../lib/drizzle";

export interface DriverInvoiceSession {
  sessionId: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number | null;
  energyKwh: number;
  /** VAT-inclusive amount in aurar (1/100 króna), or null if never costed. */
  costIsk: number | null;
  chargerName: string | null;
  siteName: string | null;
  billingHomeName: string | null;
}

const whToKwh = (wh: bigint | null): number => (wh == null ? 0 : Math.round(Number(wh) / 100) / 10);

export async function listDriverActualSessions(
  db: Db,
  userId: string,
  limit = 500,
): Promise<DriverInvoiceSession[]> {
  // The charger name is session → chargingStation → siteAsset.displayName.
  // chargingStation's PK *is* the siteAsset id, so that is one join, not two.
  const rows = await db
    .select({
      id: sessions.id,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      energyWh: sessions.energyWh,
      costIncVatMinor: sessions.costIncVatMinor,
      siteName: sites.displayName,
      orgName: organizations.displayName,
      chargerName: siteAssets.displayName,
    })
    .from(sessions)
    .leftJoin(sites, eq(sites.id, sessions.siteId))
    .leftJoin(organizations, eq(organizations.id, sessions.orgId))
    .leftJoin(chargingStations, eq(chargingStations.siteAssetId, sessions.chargingStationId))
    .leftJoin(siteAssets, eq(siteAssets.id, chargingStations.siteAssetId))
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.startedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // Canonical cost lives on the ledger when the session was projected.
  const ledger = await db
    .select({ sessionId: sessionLedger.sessionId, costIskMinor: sessionLedger.costIskMinor })
    .from(sessionLedger)
    .where(inArray(sessionLedger.sessionId, rows.map((s) => s.id)));
  const ledgerCost = new Map(ledger.map((l) => [l.sessionId, l.costIskMinor]));

  return rows.map((s) => {
    const lc = ledgerCost.get(s.id);
    const cost =
      lc != null ? Number(lc) : s.costIncVatMinor != null ? Number(s.costIncVatMinor) : null;
    const durationSec =
      s.endedAt != null
        ? Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000))
        : null;
    return {
      sessionId: s.id,
      startedAt: s.startedAt.toISOString(),
      stoppedAt: s.endedAt ? s.endedAt.toISOString() : null,
      durationSec,
      energyKwh: whToKwh(s.energyWh),
      costIsk: cost,
      chargerName: s.chargerName ?? null,
      siteName: s.siteName ?? null,
      billingHomeName: s.orgName ?? null,
    };
  });
}
