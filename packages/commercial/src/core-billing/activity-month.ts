// What was active in a billing month — derived, with its evidence named.
//
// This closes preflight gap 9.6: `reports.connector_activity_month` and
// `reports.driver_activity_month` are created by migration 0002 and had **zero
// writers**, so the flat-fee feeder had no count source and every period held.
//
// ── THE DEFINITION OF AN ACTIVE CONNECTOR ────────────────────────────────
//
//   A connector is ACTIVE in a month if it existed on Straumvakt at any point
//   in that month and we hold evidence it was still installed — whether or not
//   anybody charged on it.
//
// **The zero-session case is active, deliberately.** The locked model prices
// `200 kr / active connector / month` and caps at `450 kr / connector / month`
// — both per CONNECTOR, neither per session. A host is paying for capacity
// Straumvakt operates on their behalf: the OCPP connection, the availability,
// the monitoring, the readiness to bill. A quiet month is a month that
// capacity was available and unused, not a month it was not provided. If
// activity meant "had a session", a host with ten connectors and a quiet
// February would owe nothing while we carried all ten, and the per-connector
// cap would be pricing a unit that was not the billable unit.
//
// That reading is worth writing down because the opposite one is a plausible
// mistake that bills the customer wrong in a direction nobody notices — under-
// billing produces no complaint and no error, only a smaller number.
//
// ── WHAT WE CANNOT PROVE, AND THEREFORE DO NOT ASSERT ────────────────────
//
// `assets.connectors` has `created_at`, `status` and `status_updated_at`. It
// has **no `disabled_at` and no status history**. So the roster answers "does
// this connector exist now" and cannot answer "was it still installed last
// March". A connector physically removed in February still has its row.
//
// Hence three evidence tiers, and the third is not derived:
//
//   session_observed   a session on that connector inside the period. Proves
//                      existence and function. Strongest.
//   status_available   a StatusNotification inside the period. Proves the
//                      connector was talking to us. Nearly as strong, and far
//                      more common — chargers report status constantly, so
//                      this is what covers a connector nobody used.
//   manually_asserted  an operator stated it was installed. **Never derived.**
//                      A roster row with no in-period evidence produces NO
//                      activity row; the feeder then holds and asks. Inventing
//                      one here would bill 200 kr for hardware that may have
//                      been in a skip since February.
//
// ── A CONSEQUENCE THAT CHANGES THE ANSWER ────────────────────────────────
//
// `charging.sessions.connector_id` is NULLABLE, and the Zaptec importer writes
// `connectorId: null` on every synthetic session it creates
// (zaptec-session-sync.ts:394). So **session evidence is blind to every
// Zaptec-native session**. That is not a reason to distrust the derivation; it
// is the reason `status_available` exists as a tier, and the reason a
// session-only derivation would have silently under-counted an entire
// installation type.

import { periodBounds, type BillingPeriodRef } from "./period-close";

// ── Source unions — typed, not free text ─────────────────────────────────
//
// `reports.*.source` is a `text` column. The permitted values were documented
// in a doc comment on the Drizzle declaration and enforced nowhere, which is
// how the last census found five headers describing capabilities that did not
// exist. These unions are that documentation made checkable.

/** Evidence tier for `reports.connector_activity_month.source`. */
export const CONNECTOR_ACTIVITY_SOURCES = [
  /** A charging session on this connector inside the period. */
  "session_observed",
  /** A connector StatusNotification inside the period. */
  "status_available",
  /** An operator asserted the connector was installed. Never derived. */
  "manually_asserted",
] as const;
export type ConnectorActivitySource = (typeof CONNECTOR_ACTIVITY_SOURCES)[number];

/** Evidence tier for `reports.driver_activity_month.source`. */
export const DRIVER_ACTIVITY_SOURCES = [
  /** The driver had a charging session in the period. Unambiguous. */
  "charging_session",
  /** The driver used a reporting surface. **No persisted source exists.** */
  "reporting_access",
  /** The driver was on the org's roster for the period. Never derived. */
  "roster_membership",
] as const;
export type DriverActivitySource = (typeof DRIVER_ACTIVITY_SOURCES)[number];

/** Strength order, strongest first. A connector with both kinds of evidence is
 *  recorded under the stronger one — the row carries one source, and it should
 *  be the one a human would cite in a dispute. */
const CONNECTOR_SOURCE_STRENGTH: readonly ConnectorActivitySource[] = [
  "session_observed",
  "status_available",
  "manually_asserted",
];

// ── Inputs ───────────────────────────────────────────────────────────────

/** A session that names its connector. Sessions with a null connector_id are
 *  filtered out by the caller's query and are invisible here by construction. */
export interface ConnectorSessionObservation {
  orgId: string;
  connectorId: string;
  chargingStationId: string | null;
  startedAt: Date;
}

/** One connector StatusNotification, already reduced to (connector, instant)
 *  by the aggregating query — see the hot-path note in the repository. */
export interface ConnectorStatusObservation {
  orgId: string;
  connectorId: string;
  chargingStationId: string | null;
  observedAt: Date;
}

/** An explicit operator assertion for one connector-month. */
export interface ConnectorManualAssertion {
  orgId: string;
  connectorId: string;
  chargingStationId: string | null;
  assertedAt: Date;
}

export interface ConnectorActivityInput {
  period: BillingPeriodRef;
  sessions: readonly ConnectorSessionObservation[];
  statuses: readonly ConnectorStatusObservation[];
  assertions?: readonly ConnectorManualAssertion[];
}

/** A driver session, for the charging-activity half of the driver definition. */
export interface DriverSessionObservation {
  orgId: string;
  driverUserId: string;
  startedAt: Date;
}

export interface DriverActivityInput {
  period: BillingPeriodRef;
  sessions: readonly DriverSessionObservation[];
}

// ── Outputs ──────────────────────────────────────────────────────────────

/** Maps one-to-one onto a `reports.connector_activity_month` row. */
export interface ConnectorActivityRow {
  orgId: string;
  periodYear: number;
  periodMonth: number;
  connectorId: string;
  chargingStationId: string | null;
  source: ConnectorActivitySource;
  sessionCount: number;
  /**
   * Distinct UTC days inside the period on which we hold evidence.
   *
   * NULL means **"no evidence-based day count exists"** — which today happens
   * only for `manually_asserted` rows, where an operator vouched for the month
   * without per-day evidence. It never means zero: a row exists at all only
   * because there was at least one day of something, so a derived row always
   * carries `activeDays >= 1`.
   */
  activeDays: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /**
   * Always NULL from this writer.
   *
   * The column means "whole ISK actually charged for this connector-month,
   * after the 450 cap" — a BILLING OUTCOME, produced by settlement, which runs
   * after this. Writing 0 here would state that the connector was billed
   * nothing, which is a different and false claim from "not yet billed".
   */
  capAppliedIsk: null;
}

/** Maps one-to-one onto a `reports.driver_activity_month` row. */
export interface DriverActivityRow {
  orgId: string;
  periodYear: number;
  periodMonth: number;
  driverUserId: string;
  source: DriverActivitySource;
  sessionCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface ConnectorActivityDerivation {
  rows: ConnectorActivityRow[];
  /** Observations discarded because they fall outside the period. Reported so
   *  a query bug shows up as a number rather than as a quietly smaller bill. */
  outOfPeriodObservations: number;
}

export interface DriverActivityDerivation {
  rows: DriverActivityRow[];
  outOfPeriodObservations: number;
}

// ── Derivation ───────────────────────────────────────────────────────────

function inPeriod(period: BillingPeriodRef, at: Date): boolean {
  const { start, end } = periodBounds(period);
  const t = at.getTime();
  return t >= start.getTime() && t < end.getTime();
}

function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

interface Accumulator {
  orgId: string;
  connectorId: string;
  chargingStationId: string | null;
  source: ConnectorActivitySource;
  sessionCount: number;
  days: Set<string>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  hasEvidence: boolean;
}

/**
 * Derive one period's connector activity from evidence.
 *
 * Pure. Deterministic. Rows come out sorted by `connectorId`, so two runs over
 * the same evidence in a different order produce byte-identical output — which
 * is what makes the writer's idempotency checkable rather than hoped for.
 *
 * A connector appearing in `sessions` but with an org that differs between
 * observations is a caller bug, not a merge case: the query is org-scoped, so
 * two orgs for one connector cannot both be true. It throws.
 */
export function deriveConnectorActivity(
  input: ConnectorActivityInput,
): ConnectorActivityDerivation {
  const acc = new Map<string, Accumulator>();
  let outOfPeriod = 0;

  const touch = (
    orgId: string,
    connectorId: string,
    chargingStationId: string | null,
    at: Date,
    source: ConnectorActivitySource,
    countsAsSession: boolean,
    hasEvidence: boolean,
  ) => {
    const existing = acc.get(connectorId);
    if (existing && existing.orgId !== orgId) {
      throw new Error("connector_activity_org_conflict");
    }
    if (!existing) {
      acc.set(connectorId, {
        orgId,
        connectorId,
        chargingStationId,
        source,
        sessionCount: countsAsSession ? 1 : 0,
        days: hasEvidence ? new Set([utcDayKey(at)]) : new Set(),
        firstSeenAt: at,
        lastSeenAt: at,
        hasEvidence,
      });
      return;
    }
    existing.sessionCount += countsAsSession ? 1 : 0;
    if (hasEvidence) existing.days.add(utcDayKey(at));
    existing.hasEvidence = existing.hasEvidence || hasEvidence;
    if (at.getTime() < existing.firstSeenAt.getTime()) existing.firstSeenAt = at;
    if (at.getTime() > existing.lastSeenAt.getTime()) existing.lastSeenAt = at;
    // Keep the strongest source seen. A connector with both a session and a
    // status frame is cited as session_observed.
    if (
      CONNECTOR_SOURCE_STRENGTH.indexOf(source) <
      CONNECTOR_SOURCE_STRENGTH.indexOf(existing.source)
    ) {
      existing.source = source;
    }
    // A station id learned later fills one learned as null earlier.
    existing.chargingStationId = existing.chargingStationId ?? chargingStationId;
  };

  for (const s of input.sessions) {
    if (!inPeriod(input.period, s.startedAt)) {
      outOfPeriod += 1;
      continue;
    }
    touch(s.orgId, s.connectorId, s.chargingStationId, s.startedAt, "session_observed", true, true);
  }

  for (const st of input.statuses) {
    if (!inPeriod(input.period, st.observedAt)) {
      outOfPeriod += 1;
      continue;
    }
    touch(
      st.orgId,
      st.connectorId,
      st.chargingStationId,
      st.observedAt,
      "status_available",
      false,
      true,
    );
  }

  for (const a of input.assertions ?? []) {
    if (!inPeriod(input.period, a.assertedAt)) {
      outOfPeriod += 1;
      continue;
    }
    // hasEvidence=false: an assertion makes the connector billable but
    // contributes no day evidence, which is why activeDays stays null unless
    // real evidence also arrived.
    touch(
      a.orgId,
      a.connectorId,
      a.chargingStationId,
      a.assertedAt,
      "manually_asserted",
      false,
      false,
    );
  }

  const rows: ConnectorActivityRow[] = [...acc.values()]
    .sort((x, y) => (x.connectorId < y.connectorId ? -1 : x.connectorId > y.connectorId ? 1 : 0))
    .map((a) => ({
      orgId: a.orgId,
      periodYear: input.period.year,
      periodMonth: input.period.month,
      connectorId: a.connectorId,
      chargingStationId: a.chargingStationId,
      source: a.source,
      sessionCount: a.sessionCount,
      activeDays: a.hasEvidence ? a.days.size : null,
      firstSeenAt: a.firstSeenAt,
      lastSeenAt: a.lastSeenAt,
      capAppliedIsk: null,
    }));

  return { rows, outOfPeriodObservations: outOfPeriod };
}

/**
 * Derive one period's driver activity from CHARGING sessions only.
 *
 * This half of the definition is unambiguous and fully implemented. The other
 * half — "reporting activity" — has no persisted event of any kind, which is
 * why `flat-fee.ts`'s `deriveActiveDrivers` still refuses to answer the locked
 * question. See `docs/notes/2026-08-18-active-driver-definition.md`.
 *
 * Every row this produces carries `source: "charging_session"`, so a reader
 * can tell at a glance that the count is the charging-only lower bound and not
 * the defined quantity.
 */
export function deriveDriverActivity(input: DriverActivityInput): DriverActivityDerivation {
  const acc = new Map<
    string,
    { orgId: string; driverUserId: string; count: number; first: Date; last: Date }
  >();
  let outOfPeriod = 0;

  for (const s of input.sessions) {
    if (!inPeriod(input.period, s.startedAt)) {
      outOfPeriod += 1;
      continue;
    }
    // A driver may charge at several hosts, so the key is (org, driver): the
    // same person is a separate billable driver for each org they charge with,
    // and collapsing them would under-bill every host but one.
    const key = `${s.orgId}${s.driverUserId}`;
    const existing = acc.get(key);
    if (!existing) {
      acc.set(key, {
        orgId: s.orgId,
        driverUserId: s.driverUserId,
        count: 1,
        first: s.startedAt,
        last: s.startedAt,
      });
      continue;
    }
    existing.count += 1;
    if (s.startedAt.getTime() < existing.first.getTime()) existing.first = s.startedAt;
    if (s.startedAt.getTime() > existing.last.getTime()) existing.last = s.startedAt;
  }

  const rows: DriverActivityRow[] = [...acc.values()]
    .sort((x, y) =>
      x.orgId !== y.orgId
        ? x.orgId < y.orgId
          ? -1
          : 1
        : x.driverUserId < y.driverUserId
          ? -1
          : x.driverUserId > y.driverUserId
            ? 1
            : 0,
    )
    .map((a) => ({
      orgId: a.orgId,
      periodYear: input.period.year,
      periodMonth: input.period.month,
      driverUserId: a.driverUserId,
      source: "charging_session" as const,
      sessionCount: a.count,
      firstSeenAt: a.first,
      lastSeenAt: a.last,
    }));

  return { rows, outOfPeriodObservations: outOfPeriod };
}
