// OCPP silence watch.
//
// Between 13 May and 4 Aug 2026 the entire Dalvegur fleet — twenty
// chargers — was disconnected from the OCPP gateway. It lasted a quarter
// of a year and nothing anywhere reported it. It was found by an operator
// reading a warning message in Zaptec's own portal.
//
// The reason it stayed invisible: `OcppIdentity.lastSeenAt` is written by
// the Zaptec status poll, not by OCPP. The vendor API kept answering
// throughout, so every charger rendered "online for 6d 15h", every day,
// while the protocol path was dead. One field answered two questions and
// only ever reported the one that was working.
//
// The root cause was never in this repository — no gateway commit sits
// near the window, and re-pointing the URL in the vendor portal brought
// the fleet straight back. It was configuration, outside our control.
//
// Which is exactly why this exists. We cannot prevent someone changing an
// endpoint. We can refuse to be quiet about it for three months.
//
// This watch reads ONLY the protocol tables. It never consults lastSeenAt,
// vendor status, or anything the API path can keep alive — otherwise it
// would have reported healthy throughout the outage it exists to catch.

import type { PrismaClient } from "../generated/prisma/client";

/** A charger is "silent" after this long without any OCPP frame. Chosen
 *  well above the 60-second heartbeat interval so a single missed beat or
 *  a reconnect cycle does not trip it — the fleet reboots roughly hourly
 *  on the weaker PLC links. */
const SILENCE_THRESHOLD_MS = 45 * 60 * 1000;

/** How far back to look for a last frame. A charger with nothing in this
 *  window is reported as silent with `lastFrameAt: null` rather than
 *  scanned across every partition we hold. */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface SilentCharger {
  identityId: string;
  identityString: string;
  /** Newest OCPP frame, or null when nothing in the lookback window. */
  lastFrameAt: string | null;
  silentForMinutes: number | null;
}

export interface OcppSilenceReport {
  /** Identities considered — provisioned rows that have never connected
   *  are excluded, since "never seen" is not a regression. */
  watched: number;
  speaking: number;
  silent: SilentCharger[];
  /** True when EVERY watched charger is silent. This is the shape the
   *  May outage took — not a charger failing, but a path failing — and it
   *  warrants a louder signal than the sum of its parts. */
  fleetWide: boolean;
}

/**
 * Report chargers that have stopped speaking OCPP.
 *
 * Only identities that have spoken at least once are watched: a
 * `provisioned` row that has never connected is an import artefact, not
 * an outage, and including them would bury the signal under permanent
 * noise. That distinction is the difference between an alarm someone
 * acts on and one they learn to ignore.
 */
export async function checkOcppSilence(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<OcppSilenceReport> {
  // Identities that have ever spoken. `lastSeenAt` is the vendor poll and
  // deliberately not used here, so this asks the protocol tables directly.
  const since = new Date(now.getTime() - LOOKBACK_MS);

  const identities = await db.ocppIdentity.findMany({
    where: { status: { not: "provisioned" } },
    select: { id: true, identityString: true },
  });
  if (identities.length === 0) {
    return { watched: 0, speaking: 0, silent: [], fleetWide: false };
  }
  const ids = identities.map((i) => i.id);

  const newest = new Map<string, Date>();
  const note = (rows: { aggregateId: string; _max: { occurredAt: Date | null } }[]) => {
    for (const r of rows) {
      const at = r._max.occurredAt;
      if (!at) continue;
      const prev = newest.get(r.aggregateId);
      if (!prev || at > prev) newest.set(r.aggregateId, at);
    }
  };

  // Frames are split by retention class (ADR 0039): heartbeats land in
  // events.protocol_log, everything else in events.event_log. A charger
  // that is merely idle still heartbeats, so protocol_log alone would
  // usually suffice — but a charger mid-session may go a while emitting
  // only MeterValues, so both are consulted and the newest wins.
  const [fromEvents, fromProtocol] = await Promise.all([
    db.eventLogEntry.groupBy({
      by: ["aggregateId"],
      where: { aggregateId: { in: ids }, occurredAt: { gte: since } },
      _max: { occurredAt: true },
    }),
    db.protocolLogEntry.groupBy({
      by: ["aggregateId"],
      where: { aggregateId: { in: ids }, occurredAt: { gte: since } },
      _max: { occurredAt: true },
    }),
  ]);
  note(fromEvents);
  note(fromProtocol);

  const silent: SilentCharger[] = [];
  let speaking = 0;
  for (const identity of identities) {
    const at = newest.get(identity.id) ?? null;
    const silentFor = at ? now.getTime() - at.getTime() : null;
    if (at && silentFor !== null && silentFor < SILENCE_THRESHOLD_MS) {
      speaking += 1;
      continue;
    }
    silent.push({
      identityId: identity.id,
      identityString: identity.identityString,
      lastFrameAt: at ? at.toISOString() : null,
      silentForMinutes: silentFor === null ? null : Math.round(silentFor / 60000),
    });
  }

  return {
    watched: identities.length,
    speaking,
    silent,
    // Every watched charger silent at once is a path failure, not a
    // hardware one. That is the shape of the May outage.
    fleetWide: identities.length > 0 && speaking === 0,
  };
}
