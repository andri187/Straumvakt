// ADR 0054's temporal key, pinned.
//
// The suite is arranged around ONE claim, made in the ADR's section "Why not
// the simpler constraint": that a partial unique index on `WHERE until IS
// NULL` permits a write which then causes a silent double-invoice, and that
// the temporal key refuses the same write. Both halves are executed here.
//
// Everything above that pair exists to make it trustworthy: if `overlaps` is
// wrong, the demonstration proves nothing.

import { describe, expect, it } from "vitest";
import {
  checkPartialUniqueOpenRow,
  checkTemporalKey,
  checkWellFormed,
  closed,
  containsInstant,
  isEmpty,
  openEnded,
  overlaps,
  rowsOverlappingPeriod,
  toRangeLiteral,
  type DatedRow,
} from "./effective-dating";

const at = (iso: string) => new Date(iso);
const JAN1 = at("2026-01-01T00:00:00Z");
const FEB1 = at("2026-02-01T00:00:00Z");
const MAR1 = at("2026-03-01T00:00:00Z");

/** February, as the billing period. `[Feb 1, Mar 1)`. */
const FEBRUARY = closed(FEB1, MAR1);

interface Placement extends DatedRow {
  deviceId: string;
  orgId: string;
  installationId: string;
}

const placement = (o: Partial<Placement> & { id: string; period: Placement["period"] }): Placement => ({
  deviceId: "device-1",
  orgId: "org-site-a",
  installationId: "inst-a",
  ...o,
});

const sameDevice = (id: string) => (r: Placement) => r.deviceId === id;

describe("half-open interval algebra", () => {
  it("touching is not overlapping, which is what makes a same-day move representable", () => {
    expect(overlaps(closed(JAN1, FEB1), closed(FEB1, MAR1))).toBe(false);
  });

  it("containment overlaps, in both directions", () => {
    const outer = closed(JAN1, MAR1);
    const inner = closed(FEB1, at("2026-02-10T00:00:00Z"));
    expect(overlaps(outer, inner)).toBe(true);
    expect(overlaps(inner, outer)).toBe(true);
  });

  it("an open-ended range overlaps everything at or after its start", () => {
    const open = openEnded(FEB1);
    expect(overlaps(open, closed(JAN1, MAR1))).toBe(true);
    expect(overlaps(open, closed(JAN1, FEB1))).toBe(false); // ends exactly where it starts
    expect(overlaps(open, openEnded(at("2030-01-01T00:00:00Z")))).toBe(true);
  });

  it("an EMPTY range overlaps nothing — matching Postgres, not intuition", () => {
    // `empty && anything` is FALSE. That is precisely why an EXCLUDE
    // constraint can never fire on an empty range, and why migration 0005
    // carries `CHECK (NOT isempty(period))` under BOTH constraint forms
    // rather than only under the exclusion one.
    const empty = closed(FEB1, FEB1);
    expect(isEmpty(empty)).toBe(true);
    expect(overlaps(empty, closed(JAN1, MAR1))).toBe(false);
    expect(overlaps(empty, empty)).toBe(false);
    expect(overlaps(closed(JAN1, MAR1), empty)).toBe(false);
  });

  it("checkWellFormed refuses an empty period and accepts an open-ended one", () => {
    expect(checkWellFormed(closed(FEB1, FEB1))).toEqual({ ok: false, reason: "period_is_empty" });
    expect(checkWellFormed(closed(MAR1, FEB1))).toEqual({ ok: false, reason: "period_is_empty" });
    expect(checkWellFormed(openEnded(FEB1))).toEqual({ ok: true });
    expect(checkWellFormed(closed(JAN1, FEB1))).toEqual({ ok: true });
  });

  it("renders a Postgres range literal, unbounded above as `[from,)`", () => {
    expect(toRangeLiteral(openEnded(JAN1))).toBe("[2026-01-01T00:00:00.000Z,)");
    expect(toRangeLiteral(closed(JAN1, FEB1))).toBe(
      "[2026-01-01T00:00:00.000Z,2026-02-01T00:00:00.000Z)",
    );
  });

  it("contains an instant with the lower bound inclusive and the upper exclusive", () => {
    const r = closed(JAN1, FEB1);
    expect(containsInstant(r, JAN1)).toBe(true);
    expect(containsInstant(r, FEB1)).toBe(false);
    expect(containsInstant(openEnded(JAN1), at("2099-01-01T00:00:00Z"))).toBe(true);
  });
});

describe("the temporal key — one place at a time", () => {
  it("refuses a second OPEN placement for a device that is already placed", () => {
    const existing = [placement({ id: "p1", period: openEnded(JAN1) })];
    const result = checkTemporalKey(existing, { id: "p2", period: openEnded(FEB1) }, sameDevice("device-1"));
    expect(result).toMatchObject({ ok: false, reason: "overlaps_existing" });
    expect(result.ok === false && result.conflictsWith.id).toBe("p1");
  });

  it("allows a same-day move: close at noon, open at noon", () => {
    const noon = at("2026-02-12T12:00:00Z");
    const existing = [placement({ id: "p1", period: closed(JAN1, noon) })];
    expect(
      checkTemporalKey(
        existing,
        { id: "p2", period: openEnded(noon) },
        sameDevice("device-1"),
      ),
    ).toEqual({ ok: true });
  });

  it("allows a gap — a device in transit is placed nowhere, and that is legal", () => {
    const existing = [placement({ id: "p1", period: closed(JAN1, FEB1) })];
    expect(
      checkTemporalKey(existing, { id: "p2", period: openEnded(MAR1) }, sameDevice("device-1")),
    ).toEqual({ ok: true });
  });

  it("does not constrain two DIFFERENT devices at the same site at the same time", () => {
    // The key is the device, not the installation. A site has many chargers.
    const existing = [placement({ id: "p1", deviceId: "device-1", period: openEnded(JAN1) })];
    expect(
      checkTemporalKey(existing, { id: "p2", period: openEnded(JAN1) }, sameDevice("device-2")),
    ).toEqual({ ok: true });
  });

  it("a row does not conflict with itself when its own period is edited", () => {
    // Correcting a placement's start date must not be refused by the row it
    // is correcting. `EXCLUDE` behaves the same way on an UPDATE.
    const existing = [placement({ id: "p1", period: openEnded(JAN1) })];
    expect(
      checkTemporalKey(existing, { id: "p1", period: openEnded(FEB1) }, sameDevice("device-1")),
    ).toEqual({ ok: true });
  });

  it("refuses a CLOSED row that overlaps the open one — the case the alternative misses", () => {
    const existing = [placement({ id: "p1", period: openEnded(JAN1) })];
    expect(
      checkTemporalKey(
        existing,
        { id: "p2", period: closed(FEB1, MAR1) },
        sameDevice("device-1"),
      ),
    ).toMatchObject({ ok: false, reason: "overlaps_existing" });
  });

  it("refuses two devices answering to ONE identity at the same instant", () => {
    // The gateway resolves an inbound connection by its identity string, so
    // this is an authentication ambiguity, not merely untidy data.
    interface Ident extends DatedRow { deviceId: string; identityString: string }
    const existing: Ident[] = [
      { id: "i1", deviceId: "device-1", identityString: "SVK-0001", period: openEnded(JAN1) },
    ];
    const sameIdentity = (r: Ident) => r.identityString === "SVK-0001";
    expect(
      checkTemporalKey(existing, { id: "i2", period: openEnded(FEB1) }, sameIdentity),
    ).toMatchObject({ ok: false, reason: "overlaps_existing" });
  });

  it("allows an identity to be REUSED once the first device released it — the swap case", () => {
    // Operators keep the identity when swapping a faulty unit at a site. A
    // globally unique identity column on the device row made that a data-model
    // violation; the dated key makes it an ordinary sequence of two rows.
    interface Ident extends DatedRow { deviceId: string; identityString: string }
    const existing: Ident[] = [
      { id: "i1", deviceId: "device-1", identityString: "SVK-0001", period: closed(JAN1, FEB1) },
    ];
    const sameIdentity = (r: Ident) => r.identityString === "SVK-0001";
    expect(checkTemporalKey(existing, { id: "i2", period: openEnded(FEB1) }, sameIdentity)).toEqual({
      ok: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE ADR 0054 DOUBLE-INVOICE — the reason the ADR exists
//
// Verbatim from the ADR:
//
//   "A device is placed at site A [Jan 1, Mar 1). A correction is later
//    backfilled as a second closed row at site B [Feb 1, Mar 1) without
//    ending the first — a bad import, or an operator fixing one half of a
//    move. The `until IS NULL` index sees zero open rows and raises nothing.
//    February's billing run counts the device twice and invoices two
//    customers for the same physical unit."
//
// Three assertions, in the order the ADR argues them:
//   1 · the temporal key REFUSES the backfill at write time;
//   2 · the partial unique index PERMITS it;
//   3 · and once permitted, February's billing predicate returns two rows for
//       one physical device, held by two different orgs. The double invoice.
// ═══════════════════════════════════════════════════════════════════════════

describe("ADR 0054 double-invoice: the worked example", () => {
  /** The original, correct row: site A holds the device for Jan and Feb. */
  const siteA = placement({
    id: "p-site-a",
    orgId: "org-site-a",
    installationId: "inst-a",
    period: closed(JAN1, MAR1),
  });

  /** The bad backfill: site B, overlapping, with site A never ended. */
  const siteBBackfill = placement({
    id: "p-site-b",
    orgId: "org-site-b",
    installationId: "inst-b",
    period: closed(FEB1, MAR1),
  });

  it("1 · the temporal key REFUSES the backfilled overlap at write time", () => {
    const result = checkTemporalKey([siteA], siteBBackfill, sameDevice("device-1"));
    expect(result).toMatchObject({ ok: false, reason: "overlaps_existing" });
    expect(result.ok === false && result.conflictsWith.id).toBe("p-site-a");
    // In the database this is SQLSTATE 23P01 under Form A, or 23505 under
    // Form B. Either way the row never lands, so step 3 below cannot happen.
  });

  it("2 · the partial unique index on `WHERE until IS NULL` PERMITS it", () => {
    // Neither row is open, so neither is in the index. It has nothing to say.
    expect(checkPartialUniqueOpenRow([siteA], siteBBackfill, sameDevice("device-1"))).toEqual({
      ok: true,
    });
    // And it would equally permit a CLOSED row overlapping an OPEN one, which
    // is the same hole reached from the other side.
    const openAtA = placement({ id: "p-open-a", period: openEnded(JAN1) });
    expect(checkPartialUniqueOpenRow([openAtA], siteBBackfill, sameDevice("device-1"))).toEqual({
      ok: true,
    });
    // The one thing it DOES enforce, so this is not a vacuous stub: two open
    // rows for one device.
    expect(
      checkPartialUniqueOpenRow(
        [openAtA],
        placement({ id: "p-open-b", period: openEnded(FEB1) }),
        sameDevice("device-1"),
      ),
    ).toMatchObject({ ok: false });
  });

  it("3 · and February then bills TWO hosts for ONE physical device", () => {
    // This is the consequence, computed rather than asserted. Decision 5 sums
    // over placements overlapping the period; with both rows present, one
    // device produces two billable placements held by two different orgs.
    const withBadRow = [siteA, siteBBackfill];
    const billable = rowsOverlappingPeriod(withBadRow, FEBRUARY);

    expect(billable).toHaveLength(2);
    expect(new Set(billable.map((p) => p.deviceId))).toEqual(new Set(["device-1"]));
    expect(new Set(billable.map((p) => p.orgId))).toEqual(
      new Set(["org-site-a", "org-site-b"]),
    );
    // One physical unit, two invoices. At 200 kr per active connector that is
    // 400 kr charged for 200 kr of hardware, and neither host can see it.

    // With the constraint in place the bad row never exists, and February
    // bills exactly one host.
    const asWritten = rowsOverlappingPeriod([siteA], FEBRUARY);
    expect(asWritten).toHaveLength(1);
    expect(asWritten[0].orgId).toBe("org-site-a");
  });

  it("4 · a REAL mid-month move also returns two rows — and that one is correct", () => {
    // The sharp contrast, and the reason the constraint cannot simply be
    // "refuse two rows in a month". A device that moves on the 12th genuinely
    // belongs to two hosts in February. The query is identical; what differs
    // is that these two rows DO NOT OVERLAP, so the temporal key permits them.
    const moveDay = at("2026-02-12T00:00:00Z");
    const oldHost = placement({ id: "m1", orgId: "org-site-a", period: closed(JAN1, moveDay) });
    const newHost = placement({ id: "m2", orgId: "org-site-b", period: openEnded(moveDay) });

    expect(checkTemporalKey([oldHost], newHost, sameDevice("device-1"))).toEqual({ ok: true });

    const billable = rowsOverlappingPeriod([oldHost, newHost], FEBRUARY);
    expect(billable).toHaveLength(2);
    expect(billable.map((p) => p.orgId)).toEqual(["org-site-a", "org-site-b"]);
    // Eleven days to the old host, the rest to the new one. Proration is
    // Phase 5's decision; that both rows are BILLABLE is decision 5's, here.
  });
});

describe("decision 5 — billing counts placements OVERLAPPING the period", () => {
  it("counts a device placed on the 2nd and removed on the 28th", () => {
    // Not "current at the moment of billing". A run on March 3rd would see
    // this device placed nowhere and bill nobody for a unit that was on site
    // for 26 days.
    const p = placement({
      id: "p1",
      period: closed(at("2026-02-02T00:00:00Z"), at("2026-02-28T00:00:00Z")),
    });
    expect(rowsOverlappingPeriod([p], FEBRUARY)).toHaveLength(1);
  });

  it("does not count a placement that ended before the period began", () => {
    const p = placement({ id: "p1", period: closed(JAN1, FEB1) });
    expect(rowsOverlappingPeriod([p], FEBRUARY)).toEqual([]);
  });

  it("does not count a placement that begins after the period ended", () => {
    const p = placement({ id: "p1", period: openEnded(MAR1) });
    expect(rowsOverlappingPeriod([p], FEBRUARY)).toEqual([]);
  });

  it("counts an open-ended placement that started before the period", () => {
    // The ordinary case: a device installed last year and still there.
    expect(rowsOverlappingPeriod([placement({ id: "p1", period: openEnded(JAN1) })], FEBRUARY))
      .toHaveLength(1);
  });

  it("returns nothing for a device with no placements — unavailable, not zero", () => {
    // Ledger note 22 lives one layer up: this returns an EMPTY LIST, and the
    // caller must decide whether that means "no placements" or "we have not
    // looked". It deliberately does not return a count, because a count of 0
    // is the exact shape that erases the difference.
    const result = rowsOverlappingPeriod([], FEBRUARY);
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADR 0054 item 5 / SR-2 — memberships take the same shape
//
// Uniqueness is on the INTERVAL, not on the (group, user) pair. Same
// `checkTemporalKey`, a different key function, because it is the same
// constraint: at most one live row per keyed slot at any instant.
// ═══════════════════════════════════════════════════════════════════════════

describe("driver_group_memberships — item 5", () => {
  interface Membership extends DatedRow {
    driverGroupId: string;
    userId: string;
  }
  const samePair = (r: Membership) => r.driverGroupId === "grp-1" && r.userId === "usr-1";
  const m = (id: string, period: Membership["period"]): Membership => ({
    id,
    driverGroupId: "grp-1",
    userId: "usr-1",
    period,
  });

  it("MOVE-OUT THEN MOVE-IN: one user, one group, two rows, both kept", () => {
    // The capability that had no owner. Under `UNIQUE (group_id, user_id)` the
    // second row collided with the first, so the only way to re-add a driver
    // was to DELETE the record of their first stay — and a driver-count for
    // last February, run afterwards, silently lost them.
    const marchStay = m("m1", closed(JAN1, MAR1));
    const julyReturn = m("m2", openEnded(at("2026-07-01T00:00:00Z")));

    expect(checkTemporalKey([marchStay], julyReturn, samePair)).toEqual({ ok: true });

    // Both rows survive, and each period answers for its own months.
    const both = [marchStay, julyReturn];
    expect(rowsOverlappingPeriod(both, FEBRUARY)).toHaveLength(1);
    expect(rowsOverlappingPeriod(both, closed(at("2026-08-01T00:00:00Z"), at("2026-09-01T00:00:00Z"))))
      .toHaveLength(1);
    // And April, in the gap between the two stays, correctly has neither.
    expect(rowsOverlappingPeriod(both, closed(at("2026-04-01T00:00:00Z"), at("2026-05-01T00:00:00Z"))))
      .toEqual([]);
  });

  it("TWO OVERLAPPING MEMBERSHIPS are rejected", () => {
    // The half the pair unique used to cover and the interval must not lose.
    // Adding a driver twice without ending the first row is the membership
    // version of the double-invoice: two live memberships, and any count that
    // sums rows counts the person twice.
    const first = m("m1", openEnded(JAN1));
    const overlapping = m("m2", closed(FEB1, MAR1));
    const result = checkTemporalKey([first], overlapping, samePair);
    expect(result).toMatchObject({ ok: false, reason: "overlaps_existing" });
    expect(result.ok === false && result.conflictsWith.id).toBe("m1");

    // And the double-count it prevents, computed rather than asserted.
    expect(rowsOverlappingPeriod([first, overlapping], FEBRUARY)).toHaveLength(2);
    expect(rowsOverlappingPeriod([first], FEBRUARY)).toHaveLength(1);
  });

  it("the same user in a DIFFERENT group at the same time is fine", () => {
    // The key is (group, user), not user. A driver may belong to a workplace
    // group and a family group at once.
    const inGroup1 = m("m1", openEnded(JAN1));
    const inGroup2: Membership = { id: "m2", driverGroupId: "grp-2", userId: "usr-1", period: openEnded(JAN1) };
    expect(checkTemporalKey([inGroup1], inGroup2, (r) => r.driverGroupId === "grp-2")).toEqual({
      ok: true,
    });
  });
});
