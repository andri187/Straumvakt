// Sprint 9 — cutover step CO-3 — shadow resolver comparator.
//
// Pure-ish comparator. Given the legacy cost-of-record (already written
// to reports.session_ledger.cost_isk_minor) and an injected "new
// resolver" that returns the agreements.* total inc-VAT, classify the
// difference into one of four buckets:
//
//   match                — exact equality
//   match_within_1_aurar — |Δ| ≤ 1 minor unit (1 aurar; rounding noise)
//   mismatch             — |Δ| > 1 minor unit
//   new_resolver_failed  — new resolver returned null or threw
//
// READ-ONLY. This module MUST NOT write to reports.session_ledger,
// agreements.billing_lines, or any other domain table. It is a sanity
// instrument the operator runs alongside the canonical path; the price
// of record stays the legacy resolver's output until A.13 ships.
//
// The new resolver is INJECTED so this module is independently testable
// and so the test file doesn't need a Prisma client. The caller (the
// script) plugs in the real wiring; the test plugs in mocks.
//
// All money is BigInt minor units (1/100 ISK = 1 aurar). No floats.

export interface ShadowComparisonInput {
  /** The ChargeSession id we are evaluating. Carried into the result
   *  for downstream histogram / mismatch listing. */
  sessionId: string;
  /** The canonical legacy figure as it currently sits in
   *  reports.session_ledger.cost_isk_minor. BigInt minor units. */
  legacyCostMinor: bigint;
  /** Async closure that runs the new (agreements.*) resolver and
   *  returns the total inc-VAT in BigInt minor units, or null if the
   *  new resolver can't price this session (e.g. denial reason,
   *  missing membership, missing rate). MUST NOT throw — but if it
   *  does, the comparator catches and classifies as
   *  new_resolver_failed. */
  getNewCost: () => Promise<bigint | null>;
}

export type ShadowComparisonResult =
  | { kind: "match"; sessionId: string; cost: bigint }
  | {
      kind: "match_within_1_aurar";
      sessionId: string;
      legacy: bigint;
      newCost: bigint;
      delta: bigint;
    }
  | {
      kind: "mismatch";
      sessionId: string;
      legacy: bigint;
      newCost: bigint;
      delta: bigint;
      reason?: string;
    }
  | {
      kind: "new_resolver_failed";
      sessionId: string;
      legacy: bigint;
      error: string;
    };

/**
 * Absolute value for BigInt (no Math.abs available).
 */
export function absBig(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/**
 * Compare a legacy cost against a new-resolver-produced cost.
 *
 * Never throws. Errors from `getNewCost` are caught and surfaced as
 * `new_resolver_failed`. A `null` return is treated the same way —
 * the new resolver did not price the session, so there is nothing to
 * compare.
 *
 * The 1-aurar tolerance band exists because the two resolvers may
 * round at different intermediate steps (legacy: single VAT line at
 * the bottom; new: per-line VAT with allocations). One aurar of drift
 * is below the smallest coin denomination and never matters for
 * invoicing. Anything larger is operator-visible.
 */
export async function shadowCompare(
  input: ShadowComparisonInput,
): Promise<ShadowComparisonResult> {
  const { sessionId, legacyCostMinor } = input;

  let newCost: bigint | null;
  try {
    newCost = await input.getNewCost();
  } catch (err) {
    return {
      kind: "new_resolver_failed",
      sessionId,
      legacy: legacyCostMinor,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (newCost === null) {
    return {
      kind: "new_resolver_failed",
      sessionId,
      legacy: legacyCostMinor,
      error: "new_resolver_returned_null",
    };
  }

  const delta = newCost - legacyCostMinor;
  const absDelta = absBig(delta);

  if (absDelta === 0n) {
    return { kind: "match", sessionId, cost: legacyCostMinor };
  }
  if (absDelta <= 1n) {
    return {
      kind: "match_within_1_aurar",
      sessionId,
      legacy: legacyCostMinor,
      newCost,
      delta,
    };
  }
  return {
    kind: "mismatch",
    sessionId,
    legacy: legacyCostMinor,
    newCost,
    delta,
  };
}

// ── Aggregation helpers (script-side, but live with the type for
//    consistent shape; pure functions, easy to test downstream). ──────

export interface ShadowHistogram {
  match: number;
  matchWithin1Aurar: number;
  mismatch: number;
  newResolverFailed: number;
  total: number;
}

export function emptyHistogram(): ShadowHistogram {
  return {
    match: 0,
    matchWithin1Aurar: 0,
    mismatch: 0,
    newResolverFailed: 0,
    total: 0,
  };
}

export function tallyResult(
  hist: ShadowHistogram,
  result: ShadowComparisonResult,
): ShadowHistogram {
  const out = { ...hist, total: hist.total + 1 };
  switch (result.kind) {
    case "match":
      out.match += 1;
      break;
    case "match_within_1_aurar":
      out.matchWithin1Aurar += 1;
      break;
    case "mismatch":
      out.mismatch += 1;
      break;
    case "new_resolver_failed":
      out.newResolverFailed += 1;
      break;
  }
  return out;
}
