// Half-open time intervals, and the two constraints ADR 0054 chose between.
//
// ── WHAT THIS FILE IS, AND WHAT IT IS NOT ──────────────────────────────────
//
// The ENFORCEMENT is in migration 0005: an exclusion constraint (or, on
// PostgreSQL 18+, `UNIQUE (device_id, period WITHOUT OVERLAPS)`). The database
// is what actually stops a bad write, including one made by a script, by psql,
// or by a future service that never imports this module.
//
// This file is the SAME PREDICATE expressed where it can be tested, and it
// earns its place three ways:
//
//   1 · No database in this lane has migration 0005 applied. Without this, the
//       ADR's central claim — that the constraint is the only thing standing
//       between decision 5 and a silent double-invoice — would be an assertion
//       nobody had run.
//   2 · `attachDevice` needs to REFUSE with a reason a caller can read, not
//       surface SQLSTATE 23P01. The pre-check reads here; the constraint still
//       has the last word, because a pre-check loses every race.
//   3 · The rejected alternative is implemented here too. A design document
//       that says "a partial unique index would permit this" is worth more
//       when the permission is demonstrated rather than described.
//
// IF THIS AND THE DATABASE EVER DISAGREE, THE DATABASE IS RIGHT. This is a
// mirror of the constraint, never a substitute for it.

/**
 * A `tstzrange` in the shape the schema stores it: `[from, until)`.
 *
 * `until: null` is the UNBOUNDED upper bound — `[from,)`, "still there". It is
 * not a null column and the distinction is the whole of ADR 0054's "why not
 * the simpler constraint": the range VALUE is always present and the column is
 * `NOT NULL`; only the upper BOUND may be infinite. Postgres has one value for
 * that and this type has one spelling of it, so no predicate anywhere needs
 * `COALESCE(until, 'infinity')`.
 */
export interface Tstzrange {
  readonly from: Date;
  readonly until: Date | null;
}

/** `[from,)` — open-ended, the ordinary case for a live placement. */
export function openEnded(from: Date): Tstzrange {
  return { from, until: null };
}

/** `[from, until)` — closed. */
export function closed(from: Date, until: Date): Tstzrange {
  return { from, until };
}

/**
 * Postgres `isempty(range)`.
 *
 * `[x, x)` contains no instant. It matters because `empty && anything` is
 * FALSE, so an EXCLUDE constraint can never fire on one — which is exactly why
 * migration 0005 carries a `CHECK (NOT isempty(period))` alongside, and why
 * that CHECK is applied under BOTH constraint forms.
 */
export function isEmpty(r: Tstzrange): boolean {
  return r.until !== null && r.until.getTime() <= r.from.getTime();
}

/**
 * Postgres `&&`, for half-open ranges. Empty ranges overlap nothing, including
 * themselves — matching Postgres, not the intuitive reading.
 *
 * Touching is not overlapping: `[Jan, Feb)` and `[Feb, Mar)` do not overlap,
 * which is what makes a same-day move representable at all.
 */
export function overlaps(a: Tstzrange, b: Tstzrange): boolean {
  if (isEmpty(a) || isEmpty(b)) return false;
  const aUntil = a.until?.getTime() ?? Infinity;
  const bUntil = b.until?.getTime() ?? Infinity;
  return a.from.getTime() < bUntil && b.from.getTime() < aUntil;
}

/** Postgres `@>` for an instant. Lower bound inclusive, upper exclusive. */
export function containsInstant(r: Tstzrange, at: Date): boolean {
  if (isEmpty(r)) return false;
  return r.from.getTime() <= at.getTime() && at.getTime() < (r.until?.getTime() ?? Infinity);
}

/** The rendering Postgres accepts as a `tstzrange` literal. */
export function toRangeLiteral(r: Tstzrange): string {
  return `[${r.from.toISOString()},${r.until === null ? "" : r.until.toISOString()})`;
}

export type WellFormedResult =
  | { ok: true }
  | { ok: false; reason: "period_is_empty" | "period_has_no_start" };

/**
 * The mirror of `CHECK (NOT isempty(period) AND NOT lower_inf(period))`.
 *
 * A row whose START is unknown cannot be billed for any period, so an
 * unbounded lower bound is refused. An unbounded UPPER bound is the ordinary
 * "still there" and is allowed. `Tstzrange` cannot express `lower_inf` at all —
 * `from` is a `Date` — so the only reachable failure here is emptiness; the
 * second reason exists because a range parsed from the database CAN be
 * `(,upper)` and must be refused by name rather than crash a `getTime()`.
 */
export function checkWellFormed(r: Tstzrange): WellFormedResult {
  if (!(r.from instanceof Date) || Number.isNaN(r.from.getTime())) {
    return { ok: false, reason: "period_has_no_start" };
  }
  if (isEmpty(r)) return { ok: false, reason: "period_is_empty" };
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TWO CONSTRAINTS, SIDE BY SIDE
//
// Both are here on purpose. ADR 0054's §"Why not the simpler constraint" makes
// a claim about the alternative, and a claim about a design that was NOT built
// is the easiest kind to get wrong. Implementing both makes the comparison a
// test rather than a paragraph.
// ═══════════════════════════════════════════════════════════════════════════

/** Any row that occupies a keyed slot over an interval. */
export interface DatedRow {
  readonly id: string;
  readonly period: Tstzrange;
}

export type TemporalConflict<T> =
  | { ok: true }
  | {
      ok: false;
      reason: "overlaps_existing";
      /** The row already occupying the slot. Named, so a refusal can say which. */
      conflictsWith: T;
    };

/**
 * THE CHOSEN CONSTRAINT — `EXCLUDE USING GIST (key WITH =, period WITH &&)`,
 * or `UNIQUE (key, period WITHOUT OVERLAPS)` on 18+. Identical semantics; see
 * migration 0005 for the three ways they differ operationally.
 *
 * It constrains ALL rows against ALL rows, open and closed alike. That is the
 * single difference from the alternative below, and it is the whole argument.
 */
export function checkTemporalKey<T extends DatedRow>(
  existing: readonly T[],
  candidate: DatedRow,
  sameKey: (row: T) => boolean,
): TemporalConflict<T> {
  for (const row of existing) {
    if (row.id === candidate.id) continue; // updating a row does not conflict with itself
    if (!sameKey(row)) continue;
    if (overlaps(row.period, candidate.period)) {
      return { ok: false, reason: "overlaps_existing", conflictsWith: row };
    }
  }
  return { ok: true };
}

/**
 * THE REJECTED ALTERNATIVE — a partial unique index `WHERE until IS NULL`.
 *
 * Implemented so that what it permits is demonstrated rather than described.
 * It enforces "one OPEN row per key" and, in ADR 0054's words, **nothing
 * whatsoever about closed rows**: two closed placements for one device may
 * overlap freely, and a closed placement may overlap the open one.
 *
 * Never call this from production code. It exists to be shown failing.
 */
export function checkPartialUniqueOpenRow<T extends DatedRow>(
  existing: readonly T[],
  candidate: DatedRow,
  sameKey: (row: T) => boolean,
): TemporalConflict<T> {
  // A closed candidate is invisible to the index — it is not in the index at
  // all — so nothing can be raised about it, whatever it overlaps.
  if (candidate.period.until !== null) return { ok: true };
  for (const row of existing) {
    if (row.id === candidate.id) continue;
    if (!sameKey(row)) continue;
    if (row.period.until !== null) continue; // closed rows are not in the index
    return { ok: false, reason: "overlaps_existing", conflictsWith: row };
  }
  return { ok: true };
}

/**
 * ADR 0054 decision 5 — billing counts rows OVERLAPPING the period, not rows
 * current at the moment of billing.
 *
 * A device placed on the 2nd and removed on the 28th is billable; a device
 * that moves on the 12th belongs to the old host for eleven days and the new
 * one for the rest. This is the predicate that makes the constraint above
 * load-bearing: it sums over overlaps, so a permitted overlap is a double
 * count by construction.
 */
export function rowsOverlappingPeriod<T extends DatedRow>(
  rows: readonly T[],
  period: Tstzrange,
): T[] {
  return rows.filter((r) => overlaps(r.period, period));
}
