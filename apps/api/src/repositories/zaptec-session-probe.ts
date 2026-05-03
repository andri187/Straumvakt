// API-fallback probe — Sprint 8.x.
//
// Read-only diff between Zaptec's ChargeHistory view and our own
// reports.session_ledger (with charging.sessions for context). Surfaces
// the gap so the operator can see whether the OCPP-first ingest path
// is producing the rows it should.
//
// Output buckets per Zaptec session:
//   • bothInOurs       — Zaptec session ID matches a row in our
//                        ledger (or our charge_sessions if not yet
//                        billed). Healthy.
//   • onlyInZaptec     — Zaptec saw it; we don't. Either OCPP didn't
//                        flow for that session, or we haven't ingested
//                        it yet. The whole reason this probe exists.
//   • onlyInOurs       — We have it; Zaptec doesn't list it. Could be
//                        a session not yet finalised on Zaptec's
//                        side, or a charger that bypassed Zaptec's
//                        cloud altogether.
//
// This module does NOT write anything. Sprint 8.x.next can add a
// "sync" entrypoint that walks `onlyInZaptec` and creates missing
// ChargeSession + session_ledger rows; deferred until the probe shows
// real-world gaps worth addressing.

import type { PrismaClient } from "../generated/prisma/client";
import { listZaptecChargeHistory, type ZaptecChargeHistoryEntry } from "../lib/zaptec";

export interface ZaptecProbeOptions {
  accessToken: string;
  installationId?: string;
  chargerId?: string;
  /** ISO-8601; default = 30 days ago */
  from?: string;
  /** ISO-8601; default = now */
  to?: string;
}

export interface ProbeMatch {
  /** Zaptec session UUID (their Id) */
  zaptecId: string;
  zaptecChargerId: string | null;
  zaptecStartedAt: string | null;
  zaptecEndedAt: string | null;
  zaptecEnergyKwh: number | null;
  /** Our ChargeSession.id if we found a match by start-time-and-charger heuristic. */
  ourSessionId: string | null;
  /** Whether our ledger has a row for this session. */
  inLedger: boolean;
  bucket: "bothInOurs" | "onlyInZaptec";
}

export interface ProbeResult {
  zaptecCount: number;
  ourCount: number;
  bothInOurs: ProbeMatch[];
  onlyInZaptec: ProbeMatch[];
  onlyInOurs: Array<{
    sessionId: string;
    chargingStationId: string | null;
    startedAt: Date;
    endedAt: Date | null;
    energyKwh: number | null;
    inLedger: boolean;
  }>;
}

/**
 * Runs the probe. Match heuristic Zaptec ↔ ours: same charger
 * (vendorResourceId on OcppIdentity == Zaptec ChargerId) AND
 * start-time within ±2 minutes. Zaptec doesn't expose our session
 * UUIDs, so we can't do an exact join — start-time is the operator's
 * eyeball heuristic too.
 */
export async function probeZaptecSessions(
  db: PrismaClient,
  options: ZaptecProbeOptions,
): Promise<ProbeResult> {
  const fromIso = options.from ?? new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  const toIso = options.to ?? new Date().toISOString();

  // 1. Fetch Zaptec's view.
  const zaptecResp = await listZaptecChargeHistory(options.accessToken, {
    installationId: options.installationId,
    chargerId: options.chargerId,
    from: fromIso,
    to: toIso,
    pageSize: 500,
  });
  if (!zaptecResp.ok) {
    throw new Error(`zaptec_chargehistory_fetch_failed: ${JSON.stringify(zaptecResp.error)}`);
  }
  const zaptecSessions = zaptecResp.value.filter(
    (s): s is ZaptecChargeHistoryEntry & { Id: string } => Boolean(s.Id),
  );

  // 2. Fetch our view of the matching window. Pull every session
  //    whose started_at is within the window AND whose charger
  //    matches one of the Zaptec ChargerIds we just got back.
  const zaptecChargerIds = Array.from(
    new Set(
      zaptecSessions
        .map((s) => s.ChargerId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  // Translate Zaptec ChargerIds → our chargingStationId via
  // OcppIdentity.vendorResourceId.
  const ourIdentities = await db.ocppIdentity.findMany({
    where: {
      vendor: "Zaptec",
      vendorResourceId: { in: zaptecChargerIds },
    },
    select: { vendorResourceId: true, chargingStationId: true },
  });
  const ourStationByZaptecCharger = new Map<string, string>();
  for (const id of ourIdentities) {
    if (id.vendorResourceId) {
      ourStationByZaptecCharger.set(id.vendorResourceId, id.chargingStationId);
    }
  }

  const ourStationIds = Array.from(ourStationByZaptecCharger.values());
  const ourSessions =
    ourStationIds.length === 0
      ? []
      : await db.chargeSession.findMany({
          where: {
            chargingStationId: { in: ourStationIds },
            startedAt: { gte: new Date(fromIso), lte: new Date(toIso) },
          },
          select: {
            id: true,
            chargingStationId: true,
            startedAt: true,
            endedAt: true,
            energyWh: true,
          },
        });

  // 3. Pull ledger rows for those sessions to see who's billed.
  const ourSessionIds = ourSessions.map((s) => s.id);
  const ledgerRows =
    ourSessionIds.length === 0
      ? []
      : await db.sessionLedger.findMany({
          where: { sessionId: { in: ourSessionIds } },
          select: { sessionId: true },
        });
  const inLedger = new Set(ledgerRows.map((l) => l.sessionId));

  // 4. Match heuristic: same charger + start-time within 2 min.
  const TWO_MIN_MS = 2 * 60 * 1000;
  const matched = new Set<string>();
  const bothInOurs: ProbeMatch[] = [];
  const onlyInZaptec: ProbeMatch[] = [];

  for (const z of zaptecSessions) {
    const zStartMs = z.StartDateTime ? Date.parse(z.StartDateTime) : NaN;
    const ourStation = z.ChargerId
      ? ourStationByZaptecCharger.get(z.ChargerId) ?? null
      : null;
    let ourMatch: typeof ourSessions[number] | null = null;
    if (ourStation && Number.isFinite(zStartMs)) {
      ourMatch =
        ourSessions.find(
          (s) =>
            s.chargingStationId === ourStation &&
            Math.abs(s.startedAt.getTime() - zStartMs) <= TWO_MIN_MS &&
            !matched.has(s.id),
        ) ?? null;
    }
    const baseShape = {
      zaptecId: z.Id!,
      zaptecChargerId: z.ChargerId ?? null,
      zaptecStartedAt: z.StartDateTime ?? null,
      zaptecEndedAt: z.EndDateTime ?? null,
      zaptecEnergyKwh: z.Energy ?? null,
    };
    if (ourMatch) {
      matched.add(ourMatch.id);
      bothInOurs.push({
        ...baseShape,
        ourSessionId: ourMatch.id,
        inLedger: inLedger.has(ourMatch.id),
        bucket: "bothInOurs",
      });
    } else {
      onlyInZaptec.push({
        ...baseShape,
        ourSessionId: null,
        inLedger: false,
        bucket: "onlyInZaptec",
      });
    }
  }

  const onlyInOurs = ourSessions
    .filter((s) => !matched.has(s.id))
    .map((s) => ({
      sessionId: s.id,
      chargingStationId: s.chargingStationId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      energyKwh: s.energyWh !== null ? Number(s.energyWh) / 1000 : null,
      inLedger: inLedger.has(s.id),
    }));

  return {
    zaptecCount: zaptecSessions.length,
    ourCount: ourSessions.length,
    bothInOurs,
    onlyInZaptec,
    onlyInOurs,
  };
}
