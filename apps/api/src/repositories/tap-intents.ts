// Tap & Auth — tap-intent repository (ADR 0024 addendum 2, 2026-08-02).
//
// A tap intent is the driver-side half of tap-to-charge. It says:
//
//   "user U intends to start a session at charging station S, and their
//    phone can currently see S over BLE, as of time T."
//
// The charger-side half arrives independently: the driver holds their
// phone against the charger's RFID reader, the reader reads an anonymous
// random UID (see lib/tap-intent/random-uid.ts), and the charger sends
// it to us as an OCPP Authorize/StartTransaction idTag on its OWN
// connection. Neither half authorises anything alone:
//
//   • The intent carries identity but no proof of presence — a phone can
//     claim to be anywhere.
//   • The tap carries hardware proof of presence but no identity — the
//     UID is regenerated every activation and belongs to nobody.
//
// Joined on (charging station, time window) they authorise a session.
// The join is scoped by STATION, never by device: at 10k drivers the
// lookup still returns 0-1 rows, because it asks "who is standing at
// this one charger right now", not "which of 10k phones was this".
//
// Fail-closed rules, all enforced here rather than at the call site:
//   • zero live intents        → no match, charger gets the normal
//                                unknown-token verdict
//   • two or more live intents → AMBIGUOUS, no match. Two drivers at the
//                                same charger inside one window must use
//                                the in-app button; we will not guess.
//   • already consumed         → no match. Single-use, enforced by a
//                                conditional UPDATE, not a read-modify-write.
//
// Rule 7: routes and the resolver consume the typed records below; no
// Prisma types leak past this module.

import type { PrismaClient } from "../generated/prisma/client";
import { isRandomEmulatedUid, normaliseIdTag } from "../lib/tap-intent/random-uid";

// ── Tunables ─────────────────────────────────────────────────────────

/**
 * How long an intent stays live. The driver has to arrive, plug in, and
 * tap — measured at 20-40s on the bench with a Fluke FEV300 — so this
 * needs headroom. It is also the hijack window: the longer it is, the
 * longer an attacker who parked an intent at a charger they are not at
 * can wait for someone else's tap to land. 120s is the compromise; the
 * app refreshes while BLE still sees the charger, so a legitimate driver
 * standing around never expires.
 */
export const TAP_INTENT_TTL_SECONDS = 120;

/**
 * RSSI at or above which the app is considered "at" the charger.
 * Field-calibrated on ZPR074002 2026-06-07: contact ~-29, 10cm -29,
 * 30cm -40, 1m -49. -35 admits roughly 15-20cm and firmly excludes 0.5m+.
 * Enforced server-side too so a client that forgets the gate cannot
 * register intents from across the car park.
 */
export const TAP_INTENT_MIN_RSSI = -35;

// ── Public types ─────────────────────────────────────────────────────

export interface TapIntentRecord {
  id: string;
  userId: string;
  chargingStationId: string;
  evseId: string | null;
  deviceHandle: string | null;
  bleRssi: number | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface CreateTapIntentInput {
  orgId: string;
  chargingStationId: string;
  evseId?: string | null;
  /** Opaque per-device handle from the app's secure storage. Audit only. */
  deviceHandle?: string | null;
  /** Live RSSI the app measured for this charger's advertisement. */
  bleRssi?: number | null;
  ttlSeconds?: number;
}

export type TapIntentMatch =
  | { kind: "matched"; intentId: string; userId: string; orgId: string }
  /**
   * This exact idTag already consumed an intent moments ago — return the
   * same verdict rather than a denial. See REPRESENT_WINDOW_SECONDS.
   */
  | { kind: "replayed"; intentId: string; userId: string; orgId: string }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number }
  | { kind: "not_a_tap" };

/**
 * How long after consumption the same idTag still resolves to the same
 * driver.
 *
 * OCPP presents one physical tap TWICE: `Authorize` first, then
 * `StartTransaction` carrying the same idTag. A strictly single-use
 * intent would match the first and deny the second, blocking the very
 * session it just authorised.
 *
 * The gateway's P4.18 verdict cache (60 s, keyed by idTag) happens to
 * paper over this today, but correctness must not depend on a cache —
 * it is an optimisation, it can miss, and its TTL is tuned for a
 * different purpose. So the repository is idempotent in its own right.
 *
 * Deliberately short. This is NOT a second authorisation window: it only
 * re-affirms a verdict already granted, to an idTag that has already
 * been seen, at the same station.
 */
export const REPRESENT_WINDOW_SECONDS = 90;

// ── Mappers ──────────────────────────────────────────────────────────

interface TapIntentRow {
  id: string;
  userId: string;
  chargingStationId: string;
  evseId: string | null;
  deviceHandle: string | null;
  bleRssi: number | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

function toRecord(row: TapIntentRow): TapIntentRecord {
  return {
    id: row.id,
    userId: row.userId,
    chargingStationId: row.chargingStationId,
    evseId: row.evseId,
    deviceHandle: row.deviceHandle,
    bleRssi: row.bleRssi,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
  };
}

// ── Write path (driver app) ──────────────────────────────────────────

/**
 * Register (or refresh) this driver's intent at a station.
 *
 * Refresh rather than insert-always: a driver standing at a charger with
 * the app open would otherwise accumulate a row every polling cycle, and
 * every one of them would count toward the ambiguity check — a driver
 * would lock themselves out. One live intent per (user, station); a
 * repeat call extends the deadline.
 */
export async function upsertTapIntent(
  db: PrismaClient,
  userId: string,
  input: CreateTapIntentInput,
): Promise<TapIntentRecord> {
  const now = new Date();
  const ttl = input.ttlSeconds ?? TAP_INTENT_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  const existing = await db.tapIntent.findFirst({
    where: {
      userId,
      chargingStationId: input.chargingStationId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });

  const row = existing
    ? await db.tapIntent.update({
        where: { id: existing.id },
        data: {
          expiresAt,
          bleRssi: input.bleRssi ?? null,
          evseId: input.evseId ?? null,
        },
        select: SELECT_FIELDS,
      })
    : await db.tapIntent.create({
        data: {
          orgId: input.orgId,
          userId,
          chargingStationId: input.chargingStationId,
          evseId: input.evseId ?? null,
          deviceHandle: input.deviceHandle ?? null,
          bleRssi: input.bleRssi ?? null,
          expiresAt,
        },
        select: SELECT_FIELDS,
      });

  return toRecord(row);
}

/** Driver walked away / cancelled in the app. */
export async function cancelTapIntent(
  db: PrismaClient,
  userId: string,
  intentId: string,
): Promise<boolean> {
  const result = await db.tapIntent.updateMany({
    where: { id: intentId, userId, consumedAt: null },
    data: { expiresAt: new Date() },
  });
  return result.count === 1;
}

/** The driver's own live intents — powers the app's "armed" indicator. */
export async function listLiveTapIntentsForDriver(
  db: PrismaClient,
  userId: string,
): Promise<TapIntentRecord[]> {
  const rows = await db.tapIntent.findMany({
    where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: SELECT_FIELDS,
  });
  return rows.map(toRecord);
}

// ── Read path (authorize resolver) ───────────────────────────────────

/**
 * The join. Called from the OCPP authorize resolver when an idTag looks
 * like a phone tap.
 *
 * Atomicity matters: two chargers at the same station could in principle
 * ask concurrently, and a single intent must satisfy at most one. The
 * consume is a conditional UPDATE guarded on `consumedAt IS NULL`, so
 * the loser of a race sees count === 0 and reports no match rather than
 * both getting a session.
 */
/**
 * The narrow Prisma surface the resolver path needs. Deliberately
 * hand-rolled rather than `Pick<PrismaClient, "tapIntent">`: the OCPP
 * authorize resolver is unit-tested with plain object mocks, and
 * requiring a full Prisma delegate there would make every existing mock
 * unbuildable. Same reasoning as `PrismaLike` in ocpp-authorize.ts.
 */
export interface TapIntentReader {
  tapIntent: PrismaClient["tapIntent"];
}

export async function matchAndConsumeTapIntent(
  db: TapIntentReader,
  chargingStationId: string,
  idTag: string,
): Promise<TapIntentMatch> {
  if (!isRandomEmulatedUid(idTag)) {
    return { kind: "not_a_tap" };
  }

  const now = new Date();
  const normalised = normaliseIdTag(idTag);

  // Idempotent re-presentation. OCPP sends the same idTag twice for one
  // physical tap (Authorize, then StartTransaction). If this exact tag
  // already consumed an intent at this station moments ago, re-affirm
  // that verdict instead of denying the session we just authorised.
  const replayed = await db.tapIntent.findFirst({
    where: {
      chargingStationId,
      consumedIdTag: normalised,
      consumedAt: {
        gt: new Date(now.getTime() - REPRESENT_WINDOW_SECONDS * 1000),
      },
    },
    orderBy: { consumedAt: "desc" },
    select: { id: true, userId: true, orgId: true },
  });
  if (replayed) {
    return {
      kind: "replayed",
      intentId: replayed.id,
      userId: replayed.userId,
      orgId: replayed.orgId,
    };
  }

  const live = await db.tapIntent.findMany({
    where: {
      chargingStationId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true, userId: true, orgId: true },
    take: 3, // we only need to know "0, 1, or more than 1"
  });

  if (live.length === 0) return { kind: "none" };
  if (live.length > 1) return { kind: "ambiguous", count: live.length };

  const candidate = live[0]!;
  const claimed = await db.tapIntent.updateMany({
    where: { id: candidate.id, consumedAt: null },
    data: { consumedAt: now, consumedIdTag: normaliseIdTag(idTag) },
  });
  if (claimed.count !== 1) {
    // Lost the race to a concurrent authorize. Fail closed.
    return { kind: "none" };
  }

  return {
    kind: "matched",
    intentId: candidate.id,
    userId: candidate.userId,
    orgId: candidate.orgId,
  };
}

// ── Access resolution (arming) ───────────────────────────────────────

export type StationResolution =
  | {
      kind: "ok";
      chargingStationId: string;
      orgId: string;
      installationId: string;
      displayName: string | null;
    }
  | { kind: "unknown_serial" }
  | { kind: "no_installation" }
  | { kind: "no_access" };

/**
 * Resolve the serial the app read off a BLE advertisement to a station
 * the driver is actually entitled to use.
 *
 * The access rule is deliberately the SAME one the OCPP authorize path
 * applies (ADR 0019 A.11): an active DriverGroupMembership under an
 * active installation-type Agreement anchored at the station's
 * installation. Arming must never be able to create an intent that the
 * resolver would then honour for a charger the driver can't use — if the
 * two rules drifted, the intent would become a privilege-escalation path.
 *
 * Returning `no_access` rather than `unknown_serial` for a real charger
 * the driver can't use is intentional: the app shows "you don't have
 * access to this charger" instead of pretending it doesn't exist, which
 * is the difference between a useful error and a support ticket.
 */
export async function resolveDriverStationBySerial(
  db: PrismaClient,
  userId: string,
  serial: string,
): Promise<StationResolution> {
  const station = await db.chargingStation.findUnique({
    where: { serialNumber: serial.trim().toUpperCase() },
    select: {
      siteAssetId: true,
      orgId: true,
      installationId: true,
      siteAsset: { select: { displayName: true } },
    },
  });
  if (!station) return { kind: "unknown_serial" };
  if (!station.installationId) return { kind: "no_installation" };

  const now = new Date();
  const membership = await db.driverGroupMembership.findFirst({
    where: {
      userId,
      driverGroup: {
        agreement: {
          agreementType: "installation",
          installationId: station.installationId,
          status: "active",
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        },
      },
    },
    select: { id: true },
  });
  if (!membership) return { kind: "no_access" };

  return {
    kind: "ok",
    chargingStationId: station.siteAssetId,
    orgId: station.orgId,
    installationId: station.installationId,
    displayName: station.siteAsset?.displayName ?? null,
  };
}

// ── Housekeeping ─────────────────────────────────────────────────────

/**
 * Delete intents that expired more than `retentionHours` ago. Consumed
 * and expired rows are kept for a while deliberately — they are the
 * forensic record of who tapped what and when, and the first thing
 * you want when a driver disputes a session.
 */
export async function purgeStaleTapIntents(
  db: PrismaClient,
  retentionHours = 72,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionHours * 3600 * 1000);
  const result = await db.tapIntent.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}

const SELECT_FIELDS = {
  id: true,
  userId: true,
  chargingStationId: true,
  evseId: true,
  deviceHandle: true,
  bleRssi: true,
  createdAt: true,
  expiresAt: true,
  consumedAt: true,
} as const;
