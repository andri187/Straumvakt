// Activity derivation, pinned.
//
// The case that decides the invoice is "one connector, zero sessions": the fee
// is per connector, so that connector is active and billable. A derivation
// that only counted sessions would under-bill every quiet month, produce no
// error, and be discovered by nobody.

import { describe, expect, it } from "vitest";
import {
  CONNECTOR_ACTIVITY_SOURCES,
  DRIVER_ACTIVITY_SOURCES,
  deriveConnectorActivity,
  deriveDriverActivity,
  type ConnectorSessionObservation,
  type ConnectorStatusObservation,
} from "./activity-month";

const ORG_A = "org-a-0000-0000-0000-00000000001";
const ORG_B = "org-b-0000-0000-0000-00000000002";
const C1 = "conn-1-0000-0000-0000-000000001";
const C2 = "conn-2-0000-0000-0000-000000002";
const STN = "stn-1-0000-0000-0000-0000000001";
const PERIOD = { orgId: ORG_A, year: 2026, month: 3 };

const at = (day: number, hour = 12) =>
  new Date(Date.UTC(2026, 2, day, hour, 0, 0)); // March 2026

function session(
  connectorId: string,
  day: number,
  over: Partial<ConnectorSessionObservation> = {},
): ConnectorSessionObservation {
  return {
    orgId: ORG_A,
    connectorId,
    chargingStationId: STN,
    startedAt: at(day),
    ...over,
  };
}

function status(
  connectorId: string,
  day: number,
  over: Partial<ConnectorStatusObservation> = {},
): ConnectorStatusObservation {
  return {
    orgId: ORG_A,
    connectorId,
    chargingStationId: STN,
    observedAt: at(day),
    ...over,
  };
}

describe("deriveConnectorActivity", () => {
  it("an empty period produces no rows, not a zero row", () => {
    // No rows at all is what makes the feeder hold. A row with count 0 would
    // read as "we checked and there is nothing", which is a different claim.
    const out = deriveConnectorActivity({ period: PERIOD, sessions: [], statuses: [] });
    expect(out.rows).toEqual([]);
    expect(out.outOfPeriodObservations).toBe(0);
  });

  it("one connector, one session", () => {
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 5)],
      statuses: [],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      orgId: ORG_A,
      connectorId: C1,
      chargingStationId: STN,
      source: "session_observed",
      sessionCount: 1,
      activeDays: 1,
      periodYear: 2026,
      periodMonth: 3,
      capAppliedIsk: null,
    });
  });

  it("ONE CONNECTOR, ZERO SESSIONS is active on status evidence alone", () => {
    // The load-bearing case. 200 kr/connector/month is not 200 kr/session.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [status(C1, 3), status(C1, 17)],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      connectorId: C1,
      source: "status_available",
      sessionCount: 0,
      activeDays: 2,
    });
  });

  it("cites the strongest evidence when a connector has both kinds", () => {
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 10)],
      statuses: [status(C1, 3), status(C1, 10)],
    });
    expect(out.rows[0]!.source).toBe("session_observed");
    expect(out.rows[0]!.sessionCount).toBe(1);
    // Days come from ALL evidence, not only the cited tier.
    expect(out.rows[0]!.activeDays).toBe(2);
  });

  it("a connector activated mid-period is active from its first evidence", () => {
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [status(C1, 28), status(C1, 29)],
    });
    expect(out.rows[0]!.firstSeenAt).toEqual(at(28));
    expect(out.rows[0]!.lastSeenAt).toEqual(at(29));
    expect(out.rows[0]!.activeDays).toBe(2);
  });

  it("a connector deactivated mid-period still counts for the month", () => {
    // No proration. "200 kr / active connector / month" says nothing about
    // fractions of one, and day-weighting would be an invention.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 1)],
      statuses: [status(C1, 2)],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.lastSeenAt).toEqual(at(2));
  });

  it("a connector moved between stations keeps the station it was last seen at", () => {
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 4, { chargingStationId: "stn-old" })],
      statuses: [status(C1, 20, { chargingStationId: "stn-new" })],
    });
    expect(out.rows).toHaveLength(1);
    // One connector, one row. The station is context, not identity — the
    // unique index is on (org, year, month, connector).
    expect(out.rows[0]!.chargingStationId).toBe("stn-old");
  });

  it("fills a null station id learned later from evidence that has one", () => {
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 4, { chargingStationId: null })],
      statuses: [status(C1, 20, { chargingStationId: STN })],
    });
    expect(out.rows[0]!.chargingStationId).toBe(STN);
  });

  it("two orgs do not mix, even sharing a period shape", () => {
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 5), session(C2, 5, { orgId: ORG_B })],
      statuses: [],
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.find((r) => r.connectorId === C1)!.orgId).toBe(ORG_A);
    expect(out.rows.find((r) => r.connectorId === C2)!.orgId).toBe(ORG_B);
  });

  it("throws when one connector arrives under two orgs", () => {
    // The query is org-scoped, so this cannot both be true. Silently keeping
    // the first would attribute a connector to the wrong host's invoice.
    expect(() =>
      deriveConnectorActivity({
        period: PERIOD,
        sessions: [session(C1, 5), session(C1, 6, { orgId: ORG_B })],
        statuses: [],
      }),
    ).toThrow("connector_activity_org_conflict");
  });

  it("discards and COUNTS observations outside the period", () => {
    // A query bug shows up as a number rather than as a quietly smaller bill.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [
        { ...session(C1, 5), startedAt: new Date(Date.UTC(2026, 1, 28)) }, // Feb
        { ...session(C1, 5), startedAt: new Date(Date.UTC(2026, 3, 1)) }, // Apr
        session(C1, 5),
      ],
      statuses: [],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.sessionCount).toBe(1);
    expect(out.outOfPeriodObservations).toBe(2);
  });

  it("treats the period boundaries as start-inclusive, end-exclusive", () => {
    const first = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));
    const justAfter = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [
        { ...session(C1, 1), startedAt: first },
        { ...session(C1, 1), startedAt: justAfter },
      ],
      statuses: [],
    });
    expect(out.rows[0]!.sessionCount).toBe(1);
    expect(out.outOfPeriodObservations).toBe(1);
  });

  it("never derives manually_asserted from a roster", () => {
    // The roster cannot prove a connector was still installed - there is no
    // disabled_at column and no status history. An assertion has to be made,
    // not inferred, and with none supplied there is nothing to bill.
    const out = deriveConnectorActivity({ period: PERIOD, sessions: [], statuses: [] });
    expect(out.rows.some((r) => r.source === "manually_asserted")).toBe(false);
  });

  it("accepts an explicit operator assertion, with activeDays null not zero", () => {
    // Null means "no evidence-based day count exists". It must not read as
    // "active on zero days", which would be a claim the operator did not make.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [],
      assertions: [
        { orgId: ORG_A, connectorId: C1, chargingStationId: STN, assertedAt: at(15) },
      ],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ source: "manually_asserted", activeDays: null });
  });

  it("is deterministic: shuffled evidence yields byte-identical rows", () => {
    // This is what makes the writer's idempotency checkable rather than hoped
    // for - a re-run over the same month in a different query order must not
    // produce a different row.
    const s = [session(C2, 9), session(C1, 4), session(C1, 20)];
    const st = [status(C2, 2), status(C1, 11)];
    const a = deriveConnectorActivity({ period: PERIOD, sessions: s, statuses: st });
    const b = deriveConnectorActivity({
      period: PERIOD,
      sessions: [s[2]!, s[0]!, s[1]!],
      statuses: [st[1]!, st[0]!],
    });
    expect(a).toEqual(b);
    expect(a.rows.map((r) => r.connectorId)).toEqual([C1, C2].sort());
  });

  it("counts multiple sessions on one connector without duplicating the row", () => {
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 4), session(C1, 4, {}), session(C1, 19)],
      statuses: [],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.sessionCount).toBe(3);
    expect(out.rows[0]!.activeDays).toBe(2);
  });

  it("never populates capAppliedIsk — settlement owns that column", () => {
    // 0 would state the connector was billed nothing. Null states it has not
    // been billed yet. The activity writer runs before settlement.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 5)],
      statuses: [status(C2, 6)],
    });
    expect(out.rows.every((r) => r.capAppliedIsk === null)).toBe(true);
  });

  // ── Calendar boundaries ────────────────────────────────────────────
  //
  // Every one of these is a month whose length or position the derivation
  // must take from the calendar rather than from a constant. A hardcoded 30
  // or 31 would bill a real month wrong exactly once a year, quietly.

  it("includes 29 February in a leap year", () => {
    const feb2028 = { orgId: ORG_A, year: 2028, month: 2 };
    const leapDay = new Date(Date.UTC(2028, 1, 29, 12));
    const out = deriveConnectorActivity({
      period: feb2028,
      sessions: [{ orgId: ORG_A, connectorId: C1, chargingStationId: STN, startedAt: leapDay }],
      statuses: [],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.outOfPeriodObservations).toBe(0);
    expect(out.rows[0]!.activeDays).toBe(1);
  });

  it("excludes 29 February from the following March", () => {
    const out = deriveConnectorActivity({
      period: { orgId: ORG_A, year: 2028, month: 3 },
      sessions: [
        {
          orgId: ORG_A,
          connectorId: C1,
          chargingStationId: STN,
          startedAt: new Date(Date.UTC(2028, 1, 29, 12)),
        },
      ],
      statuses: [],
    });
    expect(out.rows).toEqual([]);
    expect(out.outOfPeriodObservations).toBe(1);
  });

  it("counts the last instant of a 31-day month and not the first of the next", () => {
    const lastInstant = new Date(Date.UTC(2026, 2, 31, 23, 59, 59, 999));
    const firstOfApril = new Date(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [
        { orgId: ORG_A, connectorId: C1, chargingStationId: STN, startedAt: lastInstant },
        { orgId: ORG_A, connectorId: C1, chargingStationId: STN, startedAt: firstOfApril },
      ],
      statuses: [],
    });
    expect(out.rows[0]!.sessionCount).toBe(1);
    expect(out.rows[0]!.lastSeenAt).toEqual(lastInstant);
    expect(out.outOfPeriodObservations).toBe(1);
  });

  it("handles the December to January year rollover", () => {
    const dec = { orgId: ORG_A, year: 2026, month: 12 };
    const newYearsEve = new Date(Date.UTC(2026, 11, 31, 23, 0));
    const newYearsDay = new Date(Date.UTC(2027, 0, 1, 1, 0));
    const out = deriveConnectorActivity({
      period: dec,
      sessions: [
        { orgId: ORG_A, connectorId: C1, chargingStationId: STN, startedAt: newYearsEve },
        { orgId: ORG_A, connectorId: C1, chargingStationId: STN, startedAt: newYearsDay },
      ],
      statuses: [],
    });
    expect(out.rows[0]!.sessionCount).toBe(1);
    expect(out.rows[0]!.periodYear).toBe(2026);
    expect(out.rows[0]!.periodMonth).toBe(12);
    expect(out.outOfPeriodObservations).toBe(1);
  });

  it("a period with no sessions anywhere still bills on status alone", () => {
    // The shape of a real quiet month across a whole org: nobody charged,
    // every connector was up. All of them are billable.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [status(C1, 4), status(C2, 4), status(C1, 25)],
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.every((r) => r.sessionCount === 0)).toBe(true);
    expect(out.rows.every((r) => r.source === "status_available")).toBe(true);
  });

  it("handles a period containing pre-Authorize sessions without special-casing", () => {
    // Pre-Authorize sessions are unattributable to a DRIVER. They still name a
    // connector, so connector activity is unaffected - which is the point:
    // the flat fee needs no driver attribution.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 7)],
      statuses: [],
    });
    expect(out.rows[0]!.sessionCount).toBe(1);
  });
});

// ── The two source unions must not drift apart ───────────────────────
//
// They are separate unions on separate tables and they will be edited by
// separate people. What must stay true of both is the SHAPE: every value a
// derivation can emit is in its union, and each union carries exactly one
// value that is never derived — the operator assertion that exists so a
// missing count is asked about rather than invented.

describe("the connector and driver source unions", () => {
  it("every value a derivation emits is a member of its own union", () => {
    const c = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 5)],
      statuses: [status(C2, 6)],
      assertions: [
        { orgId: ORG_A, connectorId: "conn-3", chargingStationId: null, assertedAt: at(7) },
      ],
    });
    for (const row of c.rows) {
      expect(CONNECTOR_ACTIVITY_SOURCES).toContain(row.source);
    }
    const d = deriveDriverActivity({
      period: PERIOD,
      sessions: [{ orgId: ORG_A, driverUserId: "drv-1", startedAt: at(3) }],
    });
    for (const row of d.rows) {
      expect(DRIVER_ACTIVITY_SOURCES).toContain(row.source);
    }
  });

  it("each union carries exactly one never-derived assertion value", () => {
    // If someone adds a second never-derived value to one union and not the
    // other, the two tables stop agreeing about what an operator assertion
    // means — and only one of them will be audited for it.
    expect(CONNECTOR_ACTIVITY_SOURCES).toContain("manually_asserted");
    expect(DRIVER_ACTIVITY_SOURCES).toContain("roster_membership");
    expect(CONNECTOR_ACTIVITY_SOURCES).toHaveLength(3);
    expect(DRIVER_ACTIVITY_SOURCES).toHaveLength(3);
  });

  it("the never-derived values are in fact never derived", () => {
    // The safety property of both unions, asserted rather than trusted.
    const c = deriveConnectorActivity({ period: PERIOD, sessions: [session(C1, 5)], statuses: [] });
    expect(c.rows.some((r) => r.source === "manually_asserted")).toBe(false);
    const d = deriveDriverActivity({
      period: PERIOD,
      sessions: [{ orgId: ORG_A, driverUserId: "drv-1", startedAt: at(3) }],
    });
    expect(d.rows.some((r) => r.source === "roster_membership")).toBe(false);
    // And reporting_access is never derived either, because nothing persists
    // it — that is the whole subject of the active-driver decision packet.
    expect(d.rows.some((r) => r.source === "reporting_access")).toBe(false);
  });
});

// ── Operator assertions — preflight delta 9.7 ────────────────────────
//
// A connector on a vendor-native (Zaptec-authentication) installation
// produces NEITHER session nor status evidence, permanently: the Zaptec
// importer writes connector_id NULL on its sessions, and StatusNotification
// only reaches events.event_log from our own OCPP gateway, which such a
// charger does not talk to. Without an assertion those connectors produce no
// row and the period holds — a host not billed for hardware that is installed
// and theirs.

describe("connector assertions", () => {
  const assertion = (connectorId: string, day: number, orgId = ORG_A) => ({
    orgId,
    connectorId,
    chargingStationId: null,
    assertedAt: at(day),
  });

  it("an assertion SAVES a period that would otherwise have no rows", () => {
    // The delta-9.7 case in one test: no session, no status, and without the
    // assertion the feeder holds.
    const without = deriveConnectorActivity({ period: PERIOD, sessions: [], statuses: [] });
    expect(without.rows).toEqual([]);

    const with_ = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [],
      assertions: [assertion(C1, 15)],
    });
    expect(with_.rows).toHaveLength(1);
    expect(with_.rows[0]).toMatchObject({ source: "manually_asserted", activeDays: null });
  });

  it("machine evidence WINS over an assertion for the cited source", () => {
    // Decision, and the reasoning: the assertion claims "this connector was
    // installed"; the evidence proves the same thing. The COUNT does not
    // change — it was already one — so what is at stake is only which proof
    // the invoice cites, and an invoice should cite the strongest available.
    // The assertion row is not deleted: the audit trail should still show that
    // a human vouched before proof existed.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [session(C1, 6)],
      statuses: [],
      assertions: [assertion(C1, 2)],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.source).toBe("session_observed");
    // Status evidence also outranks an assertion.
    const out2 = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [status(C1, 6)],
      assertions: [assertion(C1, 2)],
    });
    expect(out2.rows[0]!.source).toBe("status_available");
  });

  it("an assertion adds no day evidence, so activeDays stays null under it alone", () => {
    // NULL means "no evidence-based day count exists". It must not read as
    // "active on zero days", which is a claim the operator did not make.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [],
      assertions: [assertion(C1, 3), assertion(C1, 20)],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.activeDays).toBeNull();
  });

  it("a duplicate assertion counts the connector once", () => {
    // The unique index (org, year, month, connector) makes a duplicate collide
    // in the database; the derivation must not double-count either, so that a
    // fixture-driven run and a database-driven run agree.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [],
      assertions: [assertion(C1, 3), assertion(C1, 3), assertion(C1, 9)],
    });
    expect(out.rows).toHaveLength(1);
  });

  it("an assertion cannot cross an org boundary", () => {
    // Asserting another org's connector into this org's period would bill the
    // wrong host 200 kr for hardware that is not theirs.
    expect(() =>
      deriveConnectorActivity({
        period: PERIOD,
        sessions: [session(C1, 5)],
        statuses: [],
        assertions: [assertion(C1, 7, ORG_B)],
      }),
    ).toThrow("connector_activity_org_conflict");
  });

  it("an assertion outside the period is discarded and counted", () => {
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [],
      assertions: [
        { orgId: ORG_A, connectorId: C1, chargingStationId: null, assertedAt: new Date(Date.UTC(2026, 1, 2)) },
      ],
    });
    expect(out.rows).toEqual([]);
    expect(out.outOfPeriodObservations).toBe(1);
  });

  it("asserted and evidenced connectors coexist in one period", () => {
    // The realistic mixed installation: OCPP chargers that report, plus a
    // vendor-native one that cannot.
    const out = deriveConnectorActivity({
      period: PERIOD,
      sessions: [],
      statuses: [status(C1, 4)],
      assertions: [assertion(C2, 4)],
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.find((r) => r.connectorId === C1)!.source).toBe("status_available");
    expect(out.rows.find((r) => r.connectorId === C2)!.source).toBe("manually_asserted");
  });
});

describe("deriveDriverActivity", () => {
  const d1 = "drv-1-0000-0000-0000-00000001";
  const d2 = "drv-2-0000-0000-0000-00000002";

  it("counts a driver's sessions in the period", () => {
    const out = deriveDriverActivity({
      period: PERIOD,
      sessions: [
        { orgId: ORG_A, driverUserId: d1, startedAt: at(3) },
        { orgId: ORG_A, driverUserId: d1, startedAt: at(9) },
      ],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      driverUserId: d1,
      source: "charging_session",
      sessionCount: 2,
    });
    expect(out.rows[0]!.firstSeenAt).toEqual(at(3));
    expect(out.rows[0]!.lastSeenAt).toEqual(at(9));
  });

  it("a driver charging at two hosts is a billable driver for EACH", () => {
    // Collapsing them would under-bill every host but one, at 50 kr a month
    // each, invisibly.
    const out = deriveDriverActivity({
      period: PERIOD,
      sessions: [
        { orgId: ORG_A, driverUserId: d1, startedAt: at(3) },
        { orgId: ORG_B, driverUserId: d1, startedAt: at(4) },
      ],
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.map((r) => r.orgId).sort()).toEqual([ORG_A, ORG_B]);
  });

  it("a driver with zero sessions produces no row", () => {
    const out = deriveDriverActivity({ period: PERIOD, sessions: [] });
    expect(out.rows).toEqual([]);
  });

  it("a driver active in one period is absent from the next", () => {
    const march = deriveDriverActivity({
      period: PERIOD,
      sessions: [{ orgId: ORG_A, driverUserId: d1, startedAt: at(3) }],
    });
    const april = deriveDriverActivity({
      period: { orgId: ORG_A, year: 2026, month: 4 },
      sessions: [{ orgId: ORG_A, driverUserId: d1, startedAt: at(3) }],
    });
    expect(march.rows).toHaveLength(1);
    expect(april.rows).toEqual([]);
    expect(april.outOfPeriodObservations).toBe(1);
  });

  it("a driver whose token was disabled mid-period keeps the sessions they had", () => {
    // The token's later state does not un-happen a charge. Attribution is
    // decided at import time by cdr-driver-resolution; by the time a session
    // carries a driver_user_id, that question is settled.
    const out = deriveDriverActivity({
      period: PERIOD,
      sessions: [
        { orgId: ORG_A, driverUserId: d1, startedAt: at(2) },
        { orgId: ORG_A, driverUserId: d1, startedAt: at(6) },
      ],
    });
    expect(out.rows[0]!.sessionCount).toBe(2);
  });

  it("is deterministic and sorted by (org, driver)", () => {
    const out = deriveDriverActivity({
      period: PERIOD,
      sessions: [
        { orgId: ORG_B, driverUserId: d2, startedAt: at(5) },
        { orgId: ORG_A, driverUserId: d2, startedAt: at(5) },
        { orgId: ORG_A, driverUserId: d1, startedAt: at(5) },
      ],
    });
    expect(out.rows.map((r) => `${r.orgId}/${r.driverUserId}`)).toEqual([
      `${ORG_A}/${d1}`,
      `${ORG_A}/${d2}`,
      `${ORG_B}/${d2}`,
    ]);
  });

  it("every derived row is sourced charging_session, never the locked definition", () => {
    // A reader must be able to tell at a glance that this is the charging-only
    // lower bound and not "active drivers" as the commercial model defines it.
    const out = deriveDriverActivity({
      period: PERIOD,
      sessions: [{ orgId: ORG_A, driverUserId: d1, startedAt: at(3) }],
    });
    expect(out.rows.every((r) => r.source === "charging_session")).toBe(true);
  });
});
