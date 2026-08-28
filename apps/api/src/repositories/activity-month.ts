// Writers for reports.connector_activity_month and driver_activity_month.
//
// These two tables were created by migration 0002 and had **zero writers**,
// which preflight §9.6 named as the single blocker between an applied
// migration and customer 1's first invoice. This is that writer.
//
// The decision — what "active" means, and what each `source` value asserts —
// lives in `@straumvakt/commercial`'s `activity-month.ts`, pure and testable.
// This file is the thin part: fetch evidence, hand it to the derivation, upsert
// the result. Repository before route, and nothing here decides anything.
//
// ── HOT PATH (FOCUS rule 7): the split, and the arithmetic behind it ─────
//
// Rule 7 puts Drizzle on the control plane and raw SQL on the hot path. This
// job straddles them, so it is split rather than assigned:
//
//   **Evidence aggregation → raw SQL.** It scans `events.event_log` filtered to
//   `ocpp.raw.StatusNotification`, which is the highest-volume table in the
//   system and is partitioned. The query reduces it to at most one row per
//   (connector, day) BEFORE anything reaches JS.
//
//   **The upsert → Drizzle.** At most one row per connector per month. This is
//   control-plane shaped: small, keyed, and worth the type safety.
//
// The volume that justifies the split:
//
//   TODAY, 21 chargers. ~2 connectors each ≈ 42 connectors. Sessions are
//   under ~1,000/month (the census measured 1,619 completed sessions in
//   total, across months). StatusNotification is the big one — 426 frames
//   from a single site in one day was measured on 2026-05-11, so call it
//   1e4–5e4 frames/month fleet-wide. Reduced output: **≤ 42 rows.**
//
//   AT 4,000 chargers. ~8,000 connectors; ~120,000 sessions/month; and
//   StatusNotification frames scaling with connectors and dwell — order 1e6–1e7
//   per month. Reduced output: **≤ 8,000 rows.**
//
// So the raw input grows by ~200× and the output by ~200 rows. Pulling frames
// into JS to group them would be a month-long table scan marshalled row by row;
// pushing the GROUP BY into Postgres keeps the JS side at connector scale
// forever. That is the whole reason for the split, and it is why the pure
// derivation is specified to take *already-reduced* observations.

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  connectorActivityMonth,
  connectorAssertions,
  driverActivityMonth,
} from "@straumvakt/shared/db/commercial";
import {
  countFromRows,
  deriveConnectorActivity,
  deriveDriverActivity,
  periodBounds,
  type ActivitySourcePort,
  type PeriodStateReader,
  type BillingPeriodRef,
  type ConnectorActivityRow,
  type ConnectorManualAssertion,
  type ConnectorSessionObservation,
  type ConnectorStatusObservation,
  type DriverActivityRow,
  type DriverSessionObservation,
} from "@straumvakt/commercial";
import type { Db } from "../lib/drizzle";

/**
 * Tenant confinement, required — the same shape established for the ledger in
 * the 2026-08-18 scoping round. `null` means platform-wide and has to be
 * written deliberately; there is no default, so a caller who has not thought
 * about tenancy does not compile.
 */
export interface ActivityAccess {
  restrictToOrgIds: string[] | null;
}

function orgFilter(
  access: ActivityAccess,
  column: typeof connectorActivityMonth.orgId | typeof driverActivityMonth.orgId | typeof connectorAssertions.orgId,
) {
  if (access.restrictToOrgIds === null) return undefined;
  // Empty allow-list means "may see nothing". `inArray(col, [])` is the
  // explicit form; omitting the term would mean "everything".
  return inArray(column, access.restrictToOrgIds);
}

// ── Evidence gathering ───────────────────────────────────────────────────

/**
 * The evidence a period's connector activity is derived from.
 *
 * Split out as its own type so the derivation can be exercised in a dry run
 * with fixtures and in production with SQL, through the same door.
 */
export interface ConnectorEvidence {
  sessions: ConnectorSessionObservation[];
  statuses: ConnectorStatusObservation[];
  assertions: ConnectorManualAssertion[];
}

/**
 * Aggregate one period's connector evidence.
 *
 * Raw SQL, per the hot-path note above. Both halves reduce to one row per
 * (connector, day) in Postgres; the JS side never sees a frame.
 *
 * `charging.sessions.connector_id IS NOT NULL` is not a tidiness filter — the
 * column is nullable and the Zaptec importer writes NULL on every synthetic
 * session (zaptec-session-sync.ts:394), so session evidence is structurally
 * blind to Zaptec-native installations. That is exactly why the status tier
 * exists, and why a session-only derivation would have under-counted a whole
 * installation type without erroring.
 */
export async function gatherConnectorEvidence(
  db: Db,
  period: BillingPeriodRef,
  access: ActivityAccess,
): Promise<ConnectorEvidence> {
  const { start, end } = periodBounds(period);
  const orgIds = access.restrictToOrgIds;

  const sessionRows = await db.execute<{
    org_id: string;
    connector_id: string;
    charging_station_id: string | null;
    day: Date;
    n: string;
  }>(sql`
    SELECT s.org_id,
           s.connector_id,
           MIN(s.charging_station_id::text)::uuid AS charging_station_id,
           date_trunc('day', s.started_at) AS day,
           COUNT(*) AS n
    FROM charging.sessions s
    WHERE s.started_at >= ${start}
      AND s.started_at <  ${end}
      AND s.connector_id IS NOT NULL
      AND s.org_id = ${period.orgId}
      ${orgIds === null ? sql`` : sql`AND s.org_id = ANY(${orgIds})`}
    GROUP BY s.org_id, s.connector_id, date_trunc('day', s.started_at)
  `);

  const statusRows = await db.execute<{
    org_id: string;
    connector_id: string;
    day: Date;
  }>(sql`
    SELECT e.org_id,
           e.aggregate_id AS connector_id,
           date_trunc('day', e.occurred_at) AS day
    FROM events.event_log e
    WHERE e.event_type = 'ocpp.raw.StatusNotification'
      AND e.aggregate_type = 'connector'
      AND e.occurred_at >= ${start}
      AND e.occurred_at <  ${end}
      AND e.org_id = ${period.orgId}
      ${orgIds === null ? sql`` : sql`AND e.org_id = ANY(${orgIds})`}
    GROUP BY e.org_id, e.aggregate_id, date_trunc('day', e.occurred_at)
  `);

  const sessions: ConnectorSessionObservation[] = [];
  for (const r of sessionRows.rows ?? []) {
    // One observation per session, so sessionCount survives the GROUP BY.
    const n = Number(r.n);
    for (let i = 0; i < n; i++) {
      sessions.push({
        orgId: r.org_id,
        connectorId: r.connector_id,
        chargingStationId: r.charging_station_id,
        startedAt: new Date(r.day),
      });
    }
  }

  const statuses: ConnectorStatusObservation[] = (statusRows.rows ?? []).map((r) => ({
    orgId: r.org_id,
    connectorId: r.connector_id,
    chargingStationId: null,
    observedAt: new Date(r.day),
  }));

  // Operator assertions — preflight delta 9.7, now closed by migration 0003.
  //
  // These are the connectors a human vouched for because no machine evidence
  // exists. Every connector on a vendor-native (Zaptec-authentication)
  // installation is permanently in that position: the Zaptec importer writes
  // `connector_id: null` on its sessions, and StatusNotification only reaches
  // events.event_log from our own OCPP gateway, which such a charger does not
  // talk to. Without this read those connectors produce no row and the period
  // holds — a host not billed for hardware that is installed and theirs.
  const assertionRows = await db
    .select({
      orgId: connectorAssertions.orgId,
      connectorId: connectorAssertions.connectorId,
      assertedAt: connectorAssertions.assertedAt,
    })
    .from(connectorAssertions)
    .where(
      and(
        eq(connectorAssertions.orgId, period.orgId),
        eq(connectorAssertions.periodYear, period.year),
        eq(connectorAssertions.periodMonth, period.month),
        orgFilter(access, connectorAssertions.orgId),
      ),
    );

  const assertions: ConnectorManualAssertion[] = assertionRows.map((r) => ({
    orgId: r.orgId,
    connectorId: r.connectorId,
    chargingStationId: null,
    assertedAt: r.assertedAt,
  }));

  return { sessions, statuses, assertions };
}

/** The evidence a period's driver activity is derived from. */
export async function gatherDriverEvidence(
  db: Db,
  period: BillingPeriodRef,
  access: ActivityAccess,
): Promise<DriverSessionObservation[]> {
  const { start, end } = periodBounds(period);
  const orgIds = access.restrictToOrgIds;

  const rows = await db.execute<{ org_id: string; driver_user_id: string; day: Date; n: string }>(sql`
    SELECT l.org_id,
           l.driver_user_id,
           date_trunc('day', l.started_at) AS day,
           COUNT(*) AS n
    FROM reports.session_ledger l
    WHERE l.started_at >= ${start}
      AND l.started_at <  ${end}
      AND l.driver_user_id IS NOT NULL
      AND l.org_id = ${period.orgId}
      ${orgIds === null ? sql`` : sql`AND l.org_id = ANY(${orgIds})`}
    GROUP BY l.org_id, l.driver_user_id, date_trunc('day', l.started_at)
  `);

  const out: DriverSessionObservation[] = [];
  for (const r of rows.rows ?? []) {
    const n = Number(r.n);
    for (let i = 0; i < n; i++) {
      out.push({
        orgId: r.org_id,
        driverUserId: r.driver_user_id,
        startedAt: new Date(r.day),
      });
    }
  }
  return out;
}

// ── Writers ──────────────────────────────────────────────────────────────

export interface ActivityWriteResult {
  rowsWritten: number;
  outOfPeriodObservations: number;
}

/**
 * Upsert one period's connector activity.
 *
 * ── UPSERT SEMANTICS, stated explicitly ─────────────────────────────────
 *
 * Conflict target: the unique index `(org_id, period_year, period_month,
 * connector_id)` created by migration 0002. That index IS the idempotency
 * mechanism — a re-run collides rather than duplicating.
 *
 * **Overwritten on conflict**, because a re-run recomputes them from the same
 * evidence and a later run has strictly more of it:
 *
 *   source, session_count, active_days, charging_station_id, last_seen_at
 *
 * **Preserved on conflict**, because a re-run must not destroy them:
 *
 *   id           — the row's identity; anything referencing it stays valid.
 *   created_at   — when we first observed this connector-month.
 *   first_seen_at — kept at the EARLIEST of the two, via LEAST(). A later run
 *                  over a narrower window must not move the start of the month
 *                  forward.
 *   cap_applied_isk — **the load-bearing one.** Settlement writes it after
 *                  this job runs. Overwriting it with NULL on a routine
 *                  re-aggregation would erase the record of what a connector
 *                  was actually billed, silently, on a table nobody watches.
 *
 * So a re-run is a no-op when the evidence is unchanged, an update when more
 * evidence has arrived, and never a deletion of a settled figure.
 */
export async function writeConnectorActivity(
  db: Db,
  period: BillingPeriodRef,
  evidence: ConnectorEvidence,
  access: ActivityAccess,
): Promise<ActivityWriteResult> {
  assertOrgInScope(period.orgId, access);

  const derived = deriveConnectorActivity({
    period,
    sessions: evidence.sessions,
    statuses: evidence.statuses,
    assertions: evidence.assertions,
  });
  if (derived.rows.length === 0) {
    return { rowsWritten: 0, outOfPeriodObservations: derived.outOfPeriodObservations };
  }

  await db
    .insert(connectorActivityMonth)
    .values(derived.rows.map(toConnectorInsert))
    .onConflictDoUpdate({
      target: [
        connectorActivityMonth.orgId,
        connectorActivityMonth.periodYear,
        connectorActivityMonth.periodMonth,
        connectorActivityMonth.connectorId,
      ],
      set: {
        source: sql`excluded.source`,
        sessionCount: sql`excluded.session_count`,
        activeDays: sql`excluded.active_days`,
        chargingStationId: sql`COALESCE(excluded.charging_station_id, ${connectorActivityMonth.chargingStationId})`,
        firstSeenAt: sql`LEAST(${connectorActivityMonth.firstSeenAt}, excluded.first_seen_at)`,
        lastSeenAt: sql`GREATEST(${connectorActivityMonth.lastSeenAt}, excluded.last_seen_at)`,
        // cap_applied_isk deliberately absent from this SET. See the header.
      },
    });

  return {
    rowsWritten: derived.rows.length,
    outOfPeriodObservations: derived.outOfPeriodObservations,
  };
}

/** Same discipline for drivers. `driver_activity_month` has no settled-figure
 *  column, so the only preserved fields are `id`, `created_at` and the earliest
 *  `first_seen_at`. */
export async function writeDriverActivity(
  db: Db,
  period: BillingPeriodRef,
  sessions: readonly DriverSessionObservation[],
  access: ActivityAccess,
): Promise<ActivityWriteResult> {
  assertOrgInScope(period.orgId, access);

  const derived = deriveDriverActivity({ period, sessions });
  if (derived.rows.length === 0) {
    return { rowsWritten: 0, outOfPeriodObservations: derived.outOfPeriodObservations };
  }

  await db
    .insert(driverActivityMonth)
    .values(derived.rows.map(toDriverInsert))
    .onConflictDoUpdate({
      target: [
        driverActivityMonth.orgId,
        driverActivityMonth.periodYear,
        driverActivityMonth.periodMonth,
        driverActivityMonth.driverUserId,
      ],
      set: {
        source: sql`excluded.source`,
        sessionCount: sql`excluded.session_count`,
        firstSeenAt: sql`LEAST(${driverActivityMonth.firstSeenAt}, excluded.first_seen_at)`,
        lastSeenAt: sql`GREATEST(${driverActivityMonth.lastSeenAt}, excluded.last_seen_at)`,
      },
    });

  return {
    rowsWritten: derived.rows.length,
    outOfPeriodObservations: derived.outOfPeriodObservations,
  };
}

// ── The job ──────────────────────────────────────────────────────────────

export interface ActivityAggregationResult {
  period: BillingPeriodRef;
  connectors: ActivityWriteResult;
  drivers: ActivityWriteResult;
}

/**
 * Aggregate and persist one org-month of activity. The unit of work a cron or
 * an operator action invokes.
 *
 * Deliberately NOT a route. Repository before route (FOCUS rule 1's
 * discipline): this is the composition of gather-then-write, and the HTTP
 * surface that triggers it can land once there is a database to run it
 * against. Today its callers are the first-invoice dry run and the tests.
 *
 * Safe to re-run: both writers upsert on the unique indexes from `0002`, and
 * neither overwrites a settled figure. See the upsert note on
 * `writeConnectorActivity`.
 */
export async function runActivityAggregation(
  db: Db,
  period: BillingPeriodRef,
  access: ActivityAccess,
): Promise<ActivityAggregationResult> {
  assertOrgInScope(period.orgId, access);

  const connectorEvidence = await gatherConnectorEvidence(db, period, access);
  const driverSessions = await gatherDriverEvidence(db, period, access);

  return {
    period,
    connectors: await writeConnectorActivity(db, period, connectorEvidence, access),
    drivers: await writeDriverActivity(db, period, driverSessions, access),
  };
}

// ── Reads, for the flat-fee feeder ───────────────────────────────────────

export async function readConnectorActivityCount(
  db: Db,
  period: BillingPeriodRef,
  access: ActivityAccess,
): Promise<number> {
  assertOrgInScope(period.orgId, access);
  const rows = await db
    .select({ connectorId: connectorActivityMonth.connectorId })
    .from(connectorActivityMonth)
    .where(
      and(
        eq(connectorActivityMonth.orgId, period.orgId),
        eq(connectorActivityMonth.periodYear, period.year),
        eq(connectorActivityMonth.periodMonth, period.month),
        orgFilter(access, connectorActivityMonth.orgId),
      ),
    );
  return rows.length;
}

export async function readDriverActivityCount(
  db: Db,
  period: BillingPeriodRef,
  access: ActivityAccess,
): Promise<number> {
  assertOrgInScope(period.orgId, access);
  const rows = await db
    .select({ driverUserId: driverActivityMonth.driverUserId })
    .from(driverActivityMonth)
    .where(
      and(
        eq(driverActivityMonth.orgId, period.orgId),
        eq(driverActivityMonth.periodYear, period.year),
        eq(driverActivityMonth.periodMonth, period.month),
        orgFilter(access, driverActivityMonth.orgId),
      ),
    );
  return rows.length;
}

// ── The port adapter ─────────────────────────────────────────────────────

/**
 * The Drizzle-backed implementation of `ActivitySourcePort`.
 *
 * This is the ONLY place the flat-fee feeder touches a database, and it does so
 * through an interface the feeder defines — so `flat-fee.ts` stays pure and the
 * first-invoice dry run can hand the same feeder a fixture-backed port instead.
 *
 * ── DELTA 9.8, CLOSED ───────────────────────────────────────────────────
 *
 * This used to take `{ activityJobHasRun: boolean }` from its caller, because
 * nothing recorded whether the aggregation had run and `false` was the only
 * honest default — which meant every period held.
 *
 * It now takes a `PeriodStateReader` and derives the answer from the period's
 * recorded lifecycle state. The boolean cannot be asserted any more; it is
 * earned by a `seal_activity` transition that records who sealed the period
 * and when.
 */
export function makeActivitySourcePort(
  db: Db,
  access: ActivityAccess,
  periods: PeriodStateReader,
): ActivitySourcePort {
  return {
    async connectorCount(period) {
      const [rows, periodState] = await Promise.all([
        readConnectorActivityCount(db, period, access),
        periods.stateOf(period),
      ]);
      return countFromRows(rows, { periodState, source: "activity_month_table" });
    },
    async driverCount(period) {
      const [rows, periodState] = await Promise.all([
        readDriverActivityCount(db, period, access),
        periods.stateOf(period),
      ]);
      return countFromRows(rows, { periodState, source: "activity_month_table" });
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * A period whose org the caller may not see is a caller bug, not an empty
 * result. Returning zero rows would be indistinguishable from "that org had no
 * connectors", which is the zero-versus-unknown confusion this whole lane
 * exists to remove.
 */
function assertOrgInScope(orgId: string, access: ActivityAccess): void {
  if (access.restrictToOrgIds === null) return;
  if (!access.restrictToOrgIds.includes(orgId)) {
    throw new Error("activity_period_org_not_in_scope");
  }
}

function toConnectorInsert(r: ConnectorActivityRow) {
  return {
    orgId: r.orgId,
    periodYear: r.periodYear,
    periodMonth: r.periodMonth,
    connectorId: r.connectorId,
    chargingStationId: r.chargingStationId,
    source: r.source,
    sessionCount: r.sessionCount,
    activeDays: r.activeDays,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    capAppliedIsk: null,
  };
}

function toDriverInsert(r: DriverActivityRow) {
  return {
    orgId: r.orgId,
    periodYear: r.periodYear,
    periodMonth: r.periodMonth,
    driverUserId: r.driverUserId,
    source: r.source,
    sessionCount: r.sessionCount,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
  };
}
