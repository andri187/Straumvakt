// The flat platform fee — Straumvakt → host, per connector, per month.
//
// This is the MARKET line (FOCUS rule 3): Straumvakt's own revenue, billed to
// the org on Straumvakt's own invoice, as principal. It ships first precisely
// because it needs no CDR and no driver attribution — nobody else's money
// passes through it, so none of the agent-posture obligations apply.
//
// ── IT IS A DEGENERATE AGREEMENT, NOT A SHORTCUT ─────────────────────────
//
// The prices come from rate references resolved with `pickActiveRate` — the
// SAME window-selection the session resolver uses — not from constants read at
// generation time. That is what makes this one engine with two feeders rather
// than a fourth billing generation:
//
//   • the session feeder resolves per-kWh/minute/day/session bases through
//     `basisQuantityFor`, which THROWS on `per_connector` by design;
//   • this feeder supplies the one quantity a session cannot imply — a count
//     of connectors and drivers on an org over a month — and uses the same
//     rate rows, the same rate-window rule and the same money conventions.
//
// `computeCoreSubscription` still owns the cap arithmetic. This module owns
// where the numbers come from and what happens when they are not there.
//
// ── WHAT IT REFUSES, AND WHY THAT IS THE FEATURE ─────────────────────────
//
// A zero and an unknown look identical on an invoice. An org billed 0 kr
// because nobody could count its connectors is indistinguishable, to the
// person reading the invoice, from an org that genuinely owes nothing — and
// the first one is a month of revenue that no longer exists. So every input
// this module cannot verify produces a HOLD carrying a named reason, never a
// number.

import {
  CORE_CONNECTOR_CAP_MINOR,
  CORE_CONNECTOR_PRICE_MINOR,
  CORE_DRIVER_PRICE_MINOR,
  computeCoreSubscription,
} from "./subscription";
import { roundAurarToIsk, sumRoundedLinesIsk, type Aurar, type Isk } from "./money";
import { periodBounds, type BillingPeriodRef } from "./period-close";
import { pickActiveRate } from "../agreement/resolve";
import type { RateRefInput } from "../agreement/types";

/** The rate-reference codes this feeder resolves. Degenerate agreement: one
 *  cost factor, three rate rows — the two prices and the cap. */
export const FLAT_FEE_CONNECTOR_CODE = "CORE_CONNECTOR";
export const FLAT_FEE_DRIVER_CODE = "CORE_DRIVER";
export const FLAT_FEE_CAP_CODE = "CORE_CAP";

// ── The activity-count contract ──────────────────────────────────────────

/**
 * Where a count came from. Recorded on the line, because "how many connectors
 * did this org have in March" is the first question anyone disputes and the
 * answer must not be a re-derivation performed at dispute time.
 */
export type ActivityCountSource =
  /** Derived from connector enable/disable timestamps. */
  | "connector_lifecycle"
  /** Read from reports.connector_activity_month / driver_activity_month. */
  | "activity_month_table"
  /** Entered by an operator against a named period. */
  | "operator_entry";

/** Why a count is not available. Each is a different fix. */
export type ActivityCountGap =
  /** The reports.*_activity_month tables exist in migration 0002 and have no
   *  writer, so there is nothing to read. */
  | "no_activity_source"
  /** "Active driver" is defined as charging OR REPORTING activity, and
   *  reporting activity has no persisted event of any kind. A count derived
   *  from charging alone silently omits half the definition. */
  | "driver_definition_incomplete"
  /** A source exists but disagrees with itself for this period. */
  | "conflicting_sources";

export type CountEvidence =
  | { kind: "measured"; count: number; source: ActivityCountSource }
  | { kind: "unavailable"; reason: ActivityCountGap };

/** Convenience for a source that produced a real number. */
export function measured(count: number, source: ActivityCountSource): CountEvidence {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("activity_count_must_be_a_non_negative_integer");
  }
  return { kind: "measured", count, source };
}

/** Convenience for a source that did not. Deliberately as easy to write as
 *  `measured`, so that returning a fake zero is never the path of least
 *  resistance. */
export function unavailable(reason: ActivityCountGap): CountEvidence {
  return { kind: "unavailable", reason };
}

// ── Plug time ────────────────────────────────────────────────────────────

/**
 * The plug-time fee input contract.
 *
 * Plug time is occupancy after charging ceases, with a grace period. It needs
 * two timestamps the schema does not yet carry: when charging CEASED (distinct
 * from when the session ended) and when the vehicle was UNPLUGGED. Neither
 * exists on charging.sessions today.
 *
 * So the contract is stated here and the behaviour until it can be met is
 * REJECTION, not a default. A default of zero would bill nothing and look
 * settled; a default of "session duration" would bill a driver for the hours
 * they were legitimately charging. Both are wrong and neither is visible.
 */
export type PlugTimeInput =
  | {
      kind: "measured";
      chargingCeasedAt: Date;
      unpluggedAt: Date;
      graceMinutes: number;
    }
  /** The honest state today: the timestamps do not exist. */
  | { kind: "unavailable" };

// ── Holds ────────────────────────────────────────────────────────────────

/**
 * Why a period could not be settled.
 *
 * These are FLAT-FEE reasons and they are deliberately NOT the same union as
 * `ReviewReason`. Only `manual_hold` in the Postgres `billing."ReviewReason"`
 * enum could receive any of them, and writing "manual_hold" for a machine
 * refusal would be a lie of exactly the kind this codebase has been paying
 * for. The schema delta needed to persist these honestly is specified in
 * docs/notes/2026-08-18-migration-0002-preflight.md.
 */
export type FlatFeeHoldReason =
  | "connector_count_unavailable"
  | "driver_count_unavailable"
  | "no_rate_at_period_start"
  | "rate_disagrees_with_locked_frame"
  | "plug_time_unmeasurable";

export interface FlatFeeHold {
  reason: FlatFeeHoldReason;
  detail: string;
}

// ── Output ───────────────────────────────────────────────────────────────

export type FlatFeeLineKind =
  | "subscription_connector"
  | "subscription_driver"
  | "cap_relief";

/**
 * One priced line, with its rate provenance COPIED onto it.
 *
 * `unitPriceMinor`, `effectiveFrom` and `effectiveUntil` are copies, not
 * lookups. `rateVersionId` records which row priced it so the figure can be
 * traced, but it is deliberately NOT the path the price is read back through:
 * editing that rate row later changes what future periods cost and cannot
 * restate this one.
 */
export interface FlatFeeLine {
  kind: FlatFeeLineKind;
  code: string;
  description: string;
  quantity: number;
  unit: "connector" | "driver" | null;
  rateVersionId: string | null;
  unitPriceMinor: Aurar | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  countSource: ActivityCountSource | null;
  /** Unrounded aurar, kept for audit. */
  amountMinor: Aurar;
  /** The BILLED figure: whole ISK, half-up. These sum to the total. */
  amountIsk: Isk;
}

export interface FlatFeeStatement {
  period: BillingPeriodRef;
  periodStart: string;
  periodEnd: string;
  recipientKind: "organisation";
  recipientId: string;
  lines: FlatFeeLine[];
  /** Sum of the ROUNDED lines — never the rounded sum. */
  totalIsk: Isk;
  currency: "ISK";
  activeConnectors: number;
  activeDrivers: number;
  capApplied: boolean;
}

export type FlatFeeResult =
  | { kind: "settled"; statement: FlatFeeStatement }
  | {
      kind: "held";
      period: BillingPeriodRef;
      holds: FlatFeeHold[];
      /** Always empty for the flat fee — it settles no sessions. Present so a
       *  period hold and a session hold have the same shape downstream, and so
       *  that "no sessions were excluded" is stated rather than inferred. */
      excludedSessionIds: string[];
    };

export interface FlatFeeInput {
  period: BillingPeriodRef;
  activeConnectors: CountEvidence;
  activeDrivers: CountEvidence;
  /** Every rate reference the org's flat-fee cost factor carries. Filtered and
   *  window-selected here, by the same `pickActiveRate` the session path uses. */
  rateReferences: readonly RateRefInput[];
  /** Present only when the org's agreement carries a plug-time factor. */
  plugTime?: PlugTimeInput;
}

/**
 * Generate one org's flat-fee statement for one month, or refuse.
 *
 * The rate window is evaluated at the PERIOD START, not at generation time.
 * Generating March's invoice in April must not pick up April's prices, and a
 * regeneration in June must produce the identical document.
 */
export function generateFlatFeeStatement(input: FlatFeeInput): FlatFeeResult {
  const { start, end } = periodBounds(input.period);
  const holds: FlatFeeHold[] = [];

  if (input.activeConnectors.kind === "unavailable") {
    holds.push({
      reason: "connector_count_unavailable",
      detail: input.activeConnectors.reason,
    });
  }
  if (input.activeDrivers.kind === "unavailable") {
    holds.push({
      reason: "driver_count_unavailable",
      detail: input.activeDrivers.reason,
    });
  }
  if (input.plugTime && input.plugTime.kind === "unavailable") {
    holds.push({
      reason: "plug_time_unmeasurable",
      detail:
        "charging-cease and unplug timestamps do not exist on charging.sessions; " +
        "a plug-time factor cannot be priced and must not default to zero",
    });
  }

  const connectorRate = pickActiveRate([...input.rateReferences], FLAT_FEE_CONNECTOR_CODE, start);
  const driverRate = pickActiveRate([...input.rateReferences], FLAT_FEE_DRIVER_CODE, start);
  const capRate = pickActiveRate([...input.rateReferences], FLAT_FEE_CAP_CODE, start);

  for (const [code, rate] of [
    [FLAT_FEE_CONNECTOR_CODE, connectorRate],
    [FLAT_FEE_DRIVER_CODE, driverRate],
    [FLAT_FEE_CAP_CODE, capRate],
  ] as const) {
    if (!rate) {
      holds.push({
        reason: "no_rate_at_period_start",
        detail: `${code} has no rate reference effective at ${start.toISOString()}`,
      });
    }
  }

  // The commercial frame is LOCKED (200 / 50 / 450). A rate row that disagrees
  // is a data error, and pricing on it silently would bill a customer an
  // amount nobody agreed to. Pricing on the constant instead would make the
  // rate rows decorative. Refusing is the only option that surfaces it.
  const frameChecks: Array<[string, RateRefInput | null, bigint]> = [
    [FLAT_FEE_CONNECTOR_CODE, connectorRate, CORE_CONNECTOR_PRICE_MINOR],
    [FLAT_FEE_DRIVER_CODE, driverRate, CORE_DRIVER_PRICE_MINOR],
    [FLAT_FEE_CAP_CODE, capRate, CORE_CONNECTOR_CAP_MINOR],
  ];
  for (const [code, rate, expected] of frameChecks) {
    if (rate && rate.priceMinor !== expected) {
      holds.push({
        reason: "rate_disagrees_with_locked_frame",
        detail: `${code} rate ${rate.id} prices ${rate.priceMinor} aurar; the locked frame is ${expected}`,
      });
    }
    if (rate && rate.basis !== "per_connector" && code !== FLAT_FEE_DRIVER_CODE) {
      holds.push({
        reason: "rate_disagrees_with_locked_frame",
        detail: `${code} rate ${rate.id} carries basis ${rate.basis}; the flat fee is per_connector`,
      });
    }
  }

  if (holds.length > 0) {
    return { kind: "held", period: input.period, holds, excludedSessionIds: [] };
  }

  // Everything below is unreachable unless both counts are measured and all
  // three rates resolved; the narrowing is asserted rather than assumed.
  if (input.activeConnectors.kind !== "measured" || input.activeDrivers.kind !== "measured") {
    throw new Error("flat_fee_unreachable_state");
  }
  if (!connectorRate || !driverRate || !capRate) {
    throw new Error("flat_fee_unreachable_state");
  }

  const breakdown = computeCoreSubscription({
    activeConnectors: input.activeConnectors.count,
    activeDrivers: input.activeDrivers.count,
  });

  const lines: FlatFeeLine[] = [];
  if (input.activeConnectors.count > 0) {
    lines.push({
      kind: "subscription_connector",
      code: FLAT_FEE_CONNECTOR_CODE,
      description: "Core — active connectors",
      quantity: input.activeConnectors.count,
      unit: "connector",
      rateVersionId: connectorRate.id,
      unitPriceMinor: connectorRate.priceMinor,
      effectiveFrom: connectorRate.effectiveFrom,
      effectiveUntil: connectorRate.effectiveUntil,
      countSource: input.activeConnectors.source,
      amountMinor: breakdown.connectorComponentMinor,
      amountIsk: roundAurarToIsk(breakdown.connectorComponentMinor),
    });
  }
  if (input.activeDrivers.count > 0) {
    lines.push({
      kind: "subscription_driver",
      code: FLAT_FEE_DRIVER_CODE,
      description: "Core — active drivers",
      quantity: input.activeDrivers.count,
      unit: "driver",
      rateVersionId: driverRate.id,
      unitPriceMinor: driverRate.priceMinor,
      effectiveFrom: driverRate.effectiveFrom,
      effectiveUntil: driverRate.effectiveUntil,
      countSource: input.activeDrivers.source,
      amountMinor: breakdown.driverComponentMinor,
      amountIsk: roundAurarToIsk(breakdown.driverComponentMinor),
    });
  }
  if (breakdown.capApplied) {
    // Its own negative line rather than a quietly smaller driver line. An org
    // that hit the cap should see that it did, and by how much, without
    // recomputing anything.
    lines.push({
      kind: "cap_relief",
      code: FLAT_FEE_CAP_CODE,
      description: `Core — cap at 450 kr per connector (${input.activeConnectors.count})`,
      quantity: input.activeConnectors.count,
      unit: null,
      rateVersionId: capRate.id,
      unitPriceMinor: capRate.priceMinor,
      effectiveFrom: capRate.effectiveFrom,
      effectiveUntil: capRate.effectiveUntil,
      countSource: input.activeConnectors.source,
      amountMinor: -breakdown.capReliefMinor,
      amountIsk: roundAurarToIsk(-breakdown.capReliefMinor),
    });
  }

  return {
    kind: "settled",
    statement: {
      period: input.period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      recipientKind: "organisation",
      recipientId: input.period.orgId,
      lines,
      // Rule 3 of money.ts: the sum of the ROUNDED lines, never the rounded sum.
      totalIsk: sumRoundedLinesIsk(lines.map((l) => l.amountIsk)),
      currency: "ISK",
      activeConnectors: input.activeConnectors.count,
      activeDrivers: input.activeDrivers.count,
      capApplied: breakdown.capApplied,
    },
  };
}

// ── Deriving the counts ──────────────────────────────────────────────────

export interface ConnectorLifecycle {
  connectorId: string;
  /** When the connector became billable on Straumvakt. */
  enabledAt: Date;
  /** When it stopped being billable, or null if still enabled. */
  disabledAt: Date | null;
}

/**
 * Active connectors for a period, from connector lifecycle timestamps.
 *
 * "Active" is presence for ANY part of the month, not proration: the locked
 * frame says "200 kr / active connector / month" and says nothing about
 * fractions of a month. A connector enabled on the 28th counts, and so does
 * one disabled on the 2nd. That is a commercial decision already made; this
 * function implements it literally rather than inventing day-weighting.
 *
 * Deduplicated by connectorId — a connector disabled and re-enabled inside one
 * month is one connector, not two.
 */
export function deriveActiveConnectors(
  lifecycles: readonly ConnectorLifecycle[],
  period: BillingPeriodRef,
): CountEvidence {
  const { start, end } = periodBounds(period);
  const active = new Set<string>();
  for (const c of lifecycles) {
    const startedBeforeEnd = c.enabledAt.getTime() < end.getTime();
    const endedAfterStart = c.disabledAt === null || c.disabledAt.getTime() > start.getTime();
    if (startedBeforeEnd && endedAfterStart) active.add(c.connectorId);
  }
  return measured(active.size, "connector_lifecycle");
}

/**
 * Active drivers for a period — and why this returns `unavailable`.
 *
 * The locked definition is "a driver with charging OR REPORTING activity in
 * the month". Charging activity is derivable: distinct `driver_user_id` on the
 * period's ledger rows. **Reporting activity has no persisted event of any
 * kind** — no table, no column, no log line. There is nothing to count.
 *
 * So a count derived from charging alone is not the defined quantity; it is a
 * lower bound on it. Returning that number would under-bill by an unknown
 * amount, on a line that reads as authoritative, at 50 kr per driver per
 * month. Returning it with a warning would be worse, because the warning is
 * not on the invoice.
 *
 * This function therefore takes the charging count and REFUSES anyway,
 * carrying the count in the gap's name rather than in a total. It becomes a
 * real derivation the moment either (a) reporting activity gains a persisted
 * event, or (b) the definition is narrowed to charging activity — and (b) is a
 * one-line change here plus a decision that is not a developer's to make.
 */
export function deriveActiveDrivers(
  chargingDriverIds: readonly string[],
  _period: BillingPeriodRef,
): CountEvidence {
  void chargingDriverIds;
  return unavailable("driver_definition_incomplete");
}
