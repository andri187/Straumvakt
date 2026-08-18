// Activity derivation, pinned.
//
// The case that decides the invoice is "one connector, zero sessions": the fee
// is per connector, so that connector is active and billable. A derivation
// that only counted sessions would under-bill every quiet month, produce no
// error, and be discovered by nobody.

import { describe, expect, it } from "vitest";
import {
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
