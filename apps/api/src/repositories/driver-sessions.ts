// Sprint 9 / 2026-06-04 — Driver session-lifecycle repository.
//
// Powers the four driver-facing session endpoints in
// routes/public/driver.ts:
//
//   • getDriverActiveSessions   — the driver's in-progress sessions
//     (charging.sessions WHERE user_id = driver AND status='in_progress').
//
//   • resolveStoppableSession   — resolve one in-progress session the
//     driver owns + its OCPP identity + protocol transactionId, so the
//     route can enqueue a RemoteStopTransaction. Returns null when the
//     session doesn't exist / isn't the driver's / isn't in-progress;
//     returns a discriminated result when it exists but can't be stopped
//     (no OCPP identity / no protocol transaction id yet).
//
//   • listDriverSessionHistory  — past sessions for the driver from the
//     billed ledger (reports.session_ledger), newest-first, paginated.
//
//   • getDriverProfile / updateDriverProfile — the driver's own profile.
//
// Rule 7: every function is driver-scoped (userId is the first/primary
// argument after the client) and never reads another driver's rows.
// Routes consume the typed return values; no Prisma types leak past
// this module.

import type { PrismaClient, Prisma } from "../generated/prisma/client";

// ── Public types ─────────────────────────────────────────────────────

export interface DriverActiveSession {
  sessionId: string;
  connectorId: string | null;
  chargerName: string;
  status: string;
  startedAt: string;
  powerKw: number;
  energyKwh: number;
  costIsk: number;
}

export interface DriverHistorySession {
  sessionId: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number | null;
  energyKwh: number;
  costIsk: number | null;
  chargerName: string | null;
  siteName: string | null;
  /** The org the session was billed under — the driver's "billing home"
   *  for this session (the operator/host that owns the charger). */
  billingHomeName: string | null;
}

export interface DriverProfile {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  organizationName: string | null;
}

/** Discriminated result of resolveStoppableSession. */
export type StoppableSessionResult =
  | { kind: "ok"; session: ResolvedStoppableSession }
  | { kind: "not_found" }
  | { kind: "no_ocpp_identity" }
  | { kind: "no_transaction_id" };

export interface ResolvedStoppableSession {
  sessionId: string;
  orgId: string;
  identityId: string;
  /** OCPP transactionId (integer) from the ocpp ProtocolTransactionRef —
   *  the value RemoteStopTransaction (OCPP 1.6 §6.23) requires. */
  transactionId: number;
  connectorId: string | null;
  chargerName: string;
  startedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// charging.sessions.energy_wh is BigInt Wh → kWh number for the app.
function whToKwh(wh: bigint | null | undefined): number {
  if (wh == null) return 0;
  return Math.round((Number(wh) / 1000) * 1000) / 1000;
}

// costIncVatMinor is BigInt currency-minor (ISK has no minor unit, so
// minor === major). Render as a plain number for the app.
function minorToIsk(minor: bigint | null | undefined): number {
  if (minor == null) return 0;
  return Number(minor);
}

// ── getDriverActiveSessions ──────────────────────────────────────────
//
// In-progress sessions belonging to this driver. We read the canonical
// charging.sessions table (status='in_progress') rather than the billed
// ledger — the ledger only exists post-stop. powerKw isn't stored on the
// session row (it's a meter-value-derived instant), so it's reported as
// 0 here; the app polls /sessions/current and reads live power from the
// charger-status surface. energyKwh comes off the session's running
// energy_wh; costIsk is null-until-stop so reads 0 in-flight.
export async function getDriverActiveSessions(
  db: PrismaClient,
  userId: string,
): Promise<DriverActiveSession[]> {
  const rows = await db.chargeSession.findMany({
    where: { userId, status: "in_progress" },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      connectorId: true,
      status: true,
      startedAt: true,
      energyWh: true,
      costIncVatMinor: true,
      chargingStation: {
        select: { siteAsset: { select: { displayName: true } } },
      },
    },
  });

  return rows.map((r) => ({
    sessionId: r.id,
    connectorId: r.connectorId,
    chargerName: r.chargingStation?.siteAsset?.displayName ?? "Hleðslustöð",
    status: "Charging",
    startedAt: r.startedAt.toISOString(),
    powerKw: 0,
    energyKwh: whToKwh(r.energyWh),
    costIsk: minorToIsk(r.costIncVatMinor),
  }));
}

// ── resolveStoppableSession ──────────────────────────────────────────
//
// Resolve a single in-progress session the driver owns, plus the OCPP
// identity + protocol transactionId the gateway needs to issue a
// RemoteStopTransaction. We deliberately DON'T guess a connector-based
// stop — OCPP 1.6 §6.23 stops by transactionId, so without the protocol
// ref we surface no_transaction_id and the route returns 409 rather than
// enqueuing a command the charger can't act on.
export async function resolveStoppableSession(
  db: PrismaClient,
  userId: string,
  sessionId: string,
): Promise<StoppableSessionResult> {
  const session = await db.chargeSession.findFirst({
    where: { id: sessionId, userId, status: "in_progress" },
    select: {
      id: true,
      orgId: true,
      connectorId: true,
      ocppIdentityId: true,
      startedAt: true,
      chargingStation: {
        select: { siteAsset: { select: { displayName: true } } },
      },
      protocolTransactionRefs: {
        where: { sourceKind: "ocpp" },
        select: { sourceId: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!session) return { kind: "not_found" };
  if (!session.ocppIdentityId) return { kind: "no_ocpp_identity" };

  const ref = session.protocolTransactionRefs[0];
  const txn = ref ? Number(ref.sourceId) : NaN;
  if (!ref || !Number.isFinite(txn)) return { kind: "no_transaction_id" };

  return {
    kind: "ok",
    session: {
      sessionId: session.id,
      orgId: session.orgId,
      identityId: session.ocppIdentityId,
      transactionId: txn,
      connectorId: session.connectorId,
      chargerName: session.chargingStation?.siteAsset?.displayName ?? "Hleðslustöð",
      startedAt: session.startedAt.toISOString(),
    },
  };
}

// ── listDriverSessionHistory ─────────────────────────────────────────
//
// Past sessions from the billed ledger, driver-scoped. reports.session_-
// ledger only carries one row per billed session, so this is the
// authoritative "history" surface. Display names (charger / site / org)
// aren't on the ledger row (sessionId/siteId/chargingStationId are plain
// UUID columns, no Prisma relations), so we batch-resolve them — mirrors
// listSessionLedger's enrichment approach.
export async function listDriverSessionHistory(
  db: PrismaClient,
  userId: string,
  opts: { skip?: number; limit?: number } = {},
): Promise<DriverHistorySession[]> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
  const skip = Math.max(0, opts.skip ?? 0);

  const rows = await db.sessionLedger.findMany({
    where: { driverUserId: userId },
    orderBy: { startedAt: "desc" },
    take: limit,
    skip,
    select: {
      sessionId: true,
      orgId: true,
      siteId: true,
      chargingStationId: true,
      startedAt: true,
      stoppedAt: true,
      durationSec: true,
      energyKwh: true,
      costIskMinor: true,
    },
  });

  if (rows.length === 0) return [];

  const stationIds = Array.from(
    new Set(rows.map((r) => r.chargingStationId).filter((v): v is string => Boolean(v))),
  );
  const siteIds = Array.from(
    new Set(rows.map((r) => r.siteId).filter((v): v is string => Boolean(v))),
  );
  const orgIds = Array.from(new Set(rows.map((r) => r.orgId)));

  const [siteAssets, sites, orgs] = await Promise.all([
    stationIds.length > 0
      ? db.siteAsset.findMany({
          where: { id: { in: stationIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
    siteIds.length > 0
      ? db.site.findMany({
          where: { id: { in: siteIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
    orgIds.length > 0
      ? db.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
  ]);

  const chargerNameByStation = new Map(siteAssets.map((s) => [s.id, s.displayName]));
  const siteNameById = new Map(sites.map((s) => [s.id, s.displayName]));
  const orgNameById = new Map(orgs.map((o) => [o.id, o.displayName]));

  return rows.map((r) => ({
    sessionId: r.sessionId,
    startedAt: r.startedAt.toISOString(),
    stoppedAt: r.stoppedAt?.toISOString() ?? null,
    durationSec: r.durationSec,
    energyKwh: Number(r.energyKwh.toString()),
    costIsk: r.costIskMinor == null ? null : minorToIsk(r.costIskMinor),
    chargerName: r.chargingStationId
      ? chargerNameByStation.get(r.chargingStationId) ?? null
      : null,
    siteName: r.siteId ? siteNameById.get(r.siteId) ?? null : null,
    billingHomeName: orgNameById.get(r.orgId) ?? null,
  }));
}

// ── getDriverProfile / updateDriverProfile ───────────────────────────

export async function getDriverProfile(
  db: PrismaClient,
  userId: string,
): Promise<DriverProfile | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, locale: true },
  });
  if (!user) return null;
  const primaryOrg = await db.membership.findFirst({
    where: { userId },
    select: { organization: { select: { displayName: true } } },
  });
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email,
    locale: user.locale,
    organizationName: primaryOrg?.organization.displayName ?? null,
  };
}

export interface DriverProfilePatch {
  displayName?: string;
  locale?: string;
}

// Update only the fields the driver is allowed to change on their own
// profile. Empty patch is a no-op read. Returns null when the user no
// longer exists (token outlived the row).
export async function updateDriverProfile(
  db: PrismaClient,
  userId: string,
  patch: DriverProfilePatch,
): Promise<DriverProfile | null> {
  const data: Prisma.UserUpdateInput = {};
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.locale !== undefined) data.locale = patch.locale;

  if (Object.keys(data).length === 0) {
    return getDriverProfile(db, userId);
  }

  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existing) return null;

  await db.user.update({ where: { id: userId }, data });
  return getDriverProfile(db, userId);
}
