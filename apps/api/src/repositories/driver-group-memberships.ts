// Repository — agreements.driver_group_memberships CRUD.
//
// Exposes:
//   createMembership   — idempotent upsert, returns { membership, created }
//   listMembershipsForDriverGroup — page of members for a group
//   removeMembership   — CLOSES a membership interval; see ADR 0054 decision 4

import { and, desc, eq, sql } from "drizzle-orm";
import { driverGroupMemberships } from "@straumvakt/shared/db/commercial";
import type { Db } from "../lib/drizzle";

type MembershipRecord = typeof driverGroupMemberships.$inferSelect;

// ─── Output shapes ───────────────────────────────────────────────────────────

export interface MembershipRow {
  id: string;
  driverGroupId: string;
  userId: string;
  addedAt: string; // ISO-8601
  /**
   * When the membership ENDED, or null while it is live. Additive.
   *
   * Without it `includeEnded: true` would hand back a list in which a current
   * member and a former one are indistinguishable, which is the same defect
   * as deleting the row — the information is present in the database and lost
   * on the way out.
   */
  endedAt: string | null;
}

export interface CreateMembershipResult {
  membership: MembershipRow;
  created: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toRow(m: MembershipRecord): MembershipRow {
  return {
    id: m.id,
    driverGroupId: m.driverGroupId,
    userId: m.userId,
    addedAt: m.addedAt.toISOString(),
    endedAt: membershipEnd(m.period),
  };
}



/**
 * Parse a Postgres `timestamptz` as it appears inside a range literal.
 *
 * Postgres writes `2026-01-15 00:00:00+00`. JavaScript's `Date` rejects that
 * on two counts: the space instead of `T`, and — the one that is easy to miss
 * — the **two-digit offset**. `new Date("2026-01-15T00:00:00+00")` is
 * `Invalid Date`; ECMA-262 wants `+00:00` or `Z`. A parser written against
 * ISO-8601 test fixtures passes every test and then reads nothing at all from
 * the database, which is why the fixtures in the test file are in Postgres's
 * shape rather than the convenient one.
 *
 * Returns null rather than an Invalid Date, so callers branch on a value
 * instead of on NaN.
 */
function parsePgTimestamptz(raw: string): Date | null {
  const s = raw.replace(/^"|"$/g, "").trim();
  if (s === "") return null;
  let iso = s.replace(" ", "T");
  // `+00` -> `+00:00`, `-0300` -> `-03:00`; `+00:00` and `Z` are left alone.
  iso = iso.replace(/([+-])(\d{2})$/, "$1$2:00").replace(/([+-])(\d{2})(\d{2})$/, "$1$2:$3");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Split a stored range literal into its two bounds, or null if it is not one.
 *
 * An empty bound string means unbounded on that side.
 */
function splitRange(range: string): { lower: string; upper: string } | null {
  const m = /^\[([^,]*),([^)\]]*)[)\]]$/.exec(range.trim());
  if (!m) return null;
  return { lower: m[1]!.trim(), upper: m[2]!.trim() };
}
// ─── Membership validity ─────────────────────────────────────────────────────

/**
 * Which of a pair's rows is the LIVE membership at `at`.
 *
 * ADR 0054 decision 4 / SR-2. Before migration 0006 a `(group, user)` pair had
 * at most one row and "is this person a member" was `row exists`. With the
 * interval that question has a different answer: a driver who moved out in
 * March and back in July has TWO rows, and only one of them is live.
 *
 * Pure, and separated from the query for that reason — the decision is what
 * changed, the `SELECT` did not, and this lane has no database to test the
 * `SELECT` against.
 *
 * Returns `null` when every row for the pair is closed. That is "not a member
 * now", which is a different fact from "never was one" — and the caller can
 * still see the closed rows it passed in.
 */
export function selectLiveMembership<T extends { period: string }>(
  rows: readonly T[],
  at: Date,
): T | null {
  return rows.find((r) => membershipCoversInstant(r.period, at)) ?? null;
}

/**
 * `period @> at`, read off the stored `tstzrange` literal.
 *
 * Postgres hands a range back as `["2026-01-01 00:00:00+00","2026-03-01 ...")`
 * or `["2026-01-01 00:00:00+00",)` when unbounded above. Drizzle's customType
 * does no parsing, so this does — and it does it strictly: an unparseable
 * range is NOT a member, because guessing on a value that decides access is
 * how a closed membership becomes an open door.
 */
export function membershipCoversInstant(range: string, at: Date): boolean {
  const parts = splitRange(range);
  if (!parts) return false;
  if (parts.lower === "") return false; // lower_inf — refused by the CHECK, refused here
  const from = parsePgTimestamptz(parts.lower);
  if (!from) return false;
  if (at.getTime() < from.getTime()) return false;
  if (parts.upper === "") return true; // `[from,)` — still a member
  const until = parsePgTimestamptz(parts.upper);
  if (!until) return false;
  return at.getTime() < until.getTime();
}

/**
 * The upper bound of a stored `tstzrange`, or null when it is unbounded.
 *
 * Returns null for an unparseable range too. That is the same conservative
 * choice `membershipCoversInstant` makes and it is deliberately the OPPOSITE
 * direction: there, an unreadable range means "not a member"; here it means
 * "no end recorded". Both refuse to invent a date, and neither turns a parse
 * failure into an access grant.
 */
function membershipEnd(range: string): string | null {
  const parts = splitRange(range);
  if (!parts || parts.upper === "") return null;
  return parsePgTimestamptz(parts.upper)?.toISOString() ?? null;
}
// ─── createMembership ────────────────────────────────────────────────────────

export interface CreateMembershipInput {
  driverGroupId: string;
  userId: string;
  /** The instant to judge validity at. Defaults to now; injectable so a test
   *  can ask "was this person a member in February" without a clock. */
  at?: Date;
}

/**
 * Idempotent create. If a membership for this (driverGroupId, userId) pair
 * already exists, returns it with created=false. Otherwise inserts and
 * returns with created=true. Callers never get a duplicate-key error.
 */
export async function createMembership(
  db: Db,
  input: CreateMembershipInput,
): Promise<CreateMembershipResult> {
  // Check for existing before attempting create so we can distinguish
  // "already existed" from a fresh insert without relying on upsert
  // semantics that would mask concurrent inserts behind a silent no-op.
  //
  // WHAT MIGRATION 0006 CHANGED HERE. `.limit(1)` on the pair used to be
  // exact, because the pair was unique. It is not any more: a driver who
  // moved out and back has several rows, and taking the first would report
  // "already a member" for someone whose only membership ended in March.
  // So: fetch every row for the pair, and let `selectLiveMembership` decide.
  const rows = await db
    .select()
    .from(driverGroupMemberships)
    .where(
      and(
        eq(driverGroupMemberships.driverGroupId, input.driverGroupId),
        eq(driverGroupMemberships.userId, input.userId),
      ),
    );

  const live = selectLiveMembership(rows, input.at ?? new Date());
  if (live) {
    return { membership: toRow(live), created: false };
  }

  // No live membership. A CLOSED one may exist and that is fine — the new
  // row opens after it, and the temporal key is what proves they do not
  // overlap. It refuses at write time if they do.

  const [created] = await db
    .insert(driverGroupMemberships)
    .values({
      driverGroupId: input.driverGroupId,
      userId: input.userId,
    })
    .returning();

  return { membership: toRow(created!), created: true };
}

// ─── listMembershipsForDriverGroup ───────────────────────────────────────────

export interface ListMembershipsOptions {
  limit?: number;
  /**
   * Include memberships that have ENDED. Defaults to false.
   *
   * WHAT MIGRATION 0006 CHANGED HERE, and why the default is `false`. Before
   * the interval, `removeMembership` deleted the row, so this query could
   * only ever return current members. It now closes the row instead, so the
   * same query would start listing everyone who ever left — the members tab
   * would grow silently and never shrink. Filtering here preserves exactly
   * the behaviour the callers already have; `true` is the new capability.
   */
  includeEnded?: boolean;
  /** The instant validity is judged at. Defaults to now. */
  at?: Date;
}

/**
 * Returns memberships for a single DriverGroup, ordered by addedAt desc.
 * Useful for the "members" tab on the group detail page.
 *
 * Filtering is done in JS rather than as a `period @> now()` predicate on the
 * server, deliberately: it keeps one definition of "is this membership live"
 * — `membershipCoversInstant` — instead of a second one written in SQL that
 * can drift from it. The row count per group is a page, not a scan, so the
 * predicate is not worth duplicating for. The GiST index that migration 0006
 * creates is there for the queries that DO need it, in billing.
 */
export async function listMembershipsForDriverGroup(
  db: Db,
  driverGroupId: string,
  options: ListMembershipsOptions = {},
): Promise<MembershipRow[]> {
  const rows = await db
    .select()
    .from(driverGroupMemberships)
    .where(eq(driverGroupMemberships.driverGroupId, driverGroupId))
    .orderBy(desc(driverGroupMemberships.addedAt))
    .limit(options.limit ?? 100);
  const at = options.at ?? new Date();
  const visible = options.includeEnded
    ? rows
    : rows.filter((r) => membershipCoversInstant(r.period, at));
  return visible.map(toRow);
}

// ─── removeMembership ────────────────────────────────────────────────────────

/**
 * ENDS a membership. It does not delete one.
 *
 * ADR 0054 decision 4: membership rows are closed, never deleted. A deleted
 * row takes the record of the stay with it — so a driver-count for last
 * February, run after someone left, silently loses them, and a dispute about
 * who had access on a given day becomes unanswerable.
 *
 * Closing is `UPDATE ... SET period = tstzrange(lower(period), $at, '[)')`.
 * It is bounded to rows that are still OPEN, so:
 *
 *   - calling it twice does not move an already-set end date, which keeps the
 *     endpoint idempotent in the way its previous `delete` was;
 *   - and a row whose interval is already closed is left exactly as it is.
 *
 * `$at` before the row's start would make the range empty, which the CHECK
 * constraint refuses at write time rather than storing a membership that
 * never was. `WHERE lower(period) < $at` makes that refusal a no-op instead,
 * so a mis-typed date changes nothing rather than raising.
 */
export async function removeMembership(db: Db, id: string, at: Date = new Date()): Promise<void> {
  await db
    .update(driverGroupMemberships)
    .set({ period: sql`tstzrange(lower(${driverGroupMemberships.period}), ${at.toISOString()}::timestamptz, '[)')` })
    .where(
      and(
        eq(driverGroupMemberships.id, id),
        sql`upper_inf(${driverGroupMemberships.period})`,
        sql`lower(${driverGroupMemberships.period}) < ${at.toISOString()}::timestamptz`,
      ),
    );
}
