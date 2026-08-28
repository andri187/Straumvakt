// Membership validity, after migration 0006 put the interval on the row.
//
// The repository's two queries need a database and this lane has none. What
// CHANGED is not the queries — it is the decision they wrap: "is this person a
// member" stopped being `row exists` the moment a pair could have more than
// one row. That decision is pure, it is extracted, and it is what is pinned
// here.
//
// Every range literal below is in the shape Postgres actually returns:
// space-separated, `+00` offset, quoted bounds, `[from,)` when unbounded.
// A test that fed ISO-8601 back to the parser would prove only that the
// parser agrees with the test.

import { describe, expect, it } from "vitest";
import {
  membershipCoversInstant,
  selectLiveMembership,
} from "./driver-group-memberships";

const PG_OPEN = '["2026-01-15 00:00:00+00",)';
const PG_CLOSED = '["2026-01-15 00:00:00+00","2026-03-01 00:00:00+00")';

const FEB = new Date("2026-02-10T00:00:00Z");
const APR = new Date("2026-04-10T00:00:00Z");
const LAST_YEAR = new Date("2025-06-01T00:00:00Z");

describe("membershipCoversInstant", () => {
  it("reads the Postgres range shape, quotes and space separator included", () => {
    expect(membershipCoversInstant(PG_OPEN, FEB)).toBe(true);
    expect(membershipCoversInstant(PG_CLOSED, FEB)).toBe(true);
  });

  it("is a member before the end and not on it — the upper bound is exclusive", () => {
    const justBefore = new Date("2026-02-28T23:59:59Z");
    const exactly = new Date("2026-03-01T00:00:00Z");
    expect(membershipCoversInstant(PG_CLOSED, justBefore)).toBe(true);
    expect(membershipCoversInstant(PG_CLOSED, exactly)).toBe(false);
  });

  it("is a member ON the start instant — the lower bound is inclusive", () => {
    expect(membershipCoversInstant(PG_OPEN, new Date("2026-01-15T00:00:00Z"))).toBe(true);
  });

  it("is not a member before the membership began", () => {
    expect(membershipCoversInstant(PG_OPEN, LAST_YEAR)).toBe(false);
  });

  it("an open interval covers any later instant", () => {
    expect(membershipCoversInstant(PG_OPEN, new Date("2099-01-01T00:00:00Z"))).toBe(true);
  });

  it("REFUSES an unparseable range rather than guessing", () => {
    // This decides access. Guessing on a value that decides access is how a
    // closed membership becomes an open door, so every unreadable shape is
    // "not a member" — including the empty string, which is what a NULL
    // column would arrive as if the NOT NULL were ever lost.
    for (const bad of ["", "not a range", "[,)", '["not a date",)', "{}", "[2026-01-01,"]) {
      expect(membershipCoversInstant(bad, FEB)).toBe(false);
    }
  });

  it("refuses an unbounded LOWER bound, which the CHECK constraint also refuses", () => {
    expect(membershipCoversInstant('(,"2026-03-01 00:00:00+00")', FEB)).toBe(false);
  });
});

describe("selectLiveMembership — the move-out, move-in case", () => {
  const marchLeaver = { id: "m1", period: PG_CLOSED };
  const julyReturner = { id: "m2", period: '["2026-07-01 00:00:00+00",)' };

  it("picks the live row when a pair has both a closed and an open one", () => {
    const rows = [marchLeaver, julyReturner];
    expect(selectLiveMembership(rows, new Date("2026-08-01T00:00:00Z"))?.id).toBe("m2");
  });

  it("picks the CLOSED row when asked about a date inside it", () => {
    // The reason `at` is a parameter and not `Date.now()`: a billing question
    // about February must not be answered with August's membership state.
    const rows = [marchLeaver, julyReturner];
    expect(selectLiveMembership(rows, FEB)?.id).toBe("m1");
  });

  it("returns null in the gap between the two stays", () => {
    // April: left in March, came back in July. Not a member, and the rows
    // that say so are still there — which is the whole of decision 4.
    const rows = [marchLeaver, julyReturner];
    expect(selectLiveMembership(rows, APR)).toBeNull();
  });

  it("returns null when every row is closed", () => {
    expect(selectLiveMembership([marchLeaver], APR)).toBeNull();
  });

  it("returns null for no rows at all — and the caller keeps the difference", () => {
    // "Not a member now" and "never was one" are different facts. This returns
    // null for both, and deliberately does not return a count: the caller
    // holds the rows it passed in and can tell them apart. Ledger note 22.
    expect(selectLiveMembership([], APR)).toBeNull();
  });

  it("would have reported the March leaver as a current member under the OLD rule", () => {
    // The defect this replaces, executed. `rows[0]` is what a `.limit(1)` on
    // the pair returned, and it is a row whose membership ended in March.
    const rows = [marchLeaver, julyReturner];
    const oldRule = rows[0];
    expect(oldRule!.id).toBe("m1");
    expect(membershipCoversInstant(oldRule!.period, APR)).toBe(false);
    expect(selectLiveMembership(rows, APR)).toBeNull();
  });
});
