// Driver billing source — the driver's ACTUAL charge sessions (charging.sessions
// where user_id = driver), which is the canonical set for invoices. Distinct
// from reports.session_ledger, which only holds the subset that went through the
// billing projection. The per-session amount uses the ledger cost when present
// (canonical, computed at stop), else the session's rolled-up cost; null when
// the session was never costed (the P1 engine fills those — see step 2).

import type { PrismaClient } from "../generated/prisma/client";

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
  db: PrismaClient,
  userId: string,
  limit = 500,
): Promise<DriverInvoiceSession[]> {
  const sessions = await db.chargeSession.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      energyWh: true,
      costIncVatMinor: true,
      site: { select: { displayName: true } },
      organization: { select: { displayName: true } },
      chargingStation: { select: { siteAsset: { select: { displayName: true } } } },
    },
  });
  if (sessions.length === 0) return [];

  // Canonical cost lives on the ledger when the session was projected.
  const ledger = await db.sessionLedger.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    select: { sessionId: true, costIskMinor: true },
  });
  const ledgerCost = new Map(ledger.map((l) => [l.sessionId, l.costIskMinor]));

  return sessions.map((s) => {
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
      chargerName: s.chargingStation?.siteAsset?.displayName ?? null,
      siteName: s.site?.displayName ?? null,
      billingHomeName: s.organization?.displayName ?? null,
    };
  });
}
