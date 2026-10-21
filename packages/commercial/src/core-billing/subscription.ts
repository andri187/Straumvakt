// Straumvakt Core subscription pricing — pure functions, no I/O.
//
// The locked Core commercial frame, Iceland only, ISK:
//
//     200 kr / active connector / month
//   +  50 kr / active driver    / month
//   capped at 450 kr / connector / month
//
//   Active connector = connector enabled on Straumvakt during the billing month.
//   Active driver    = driver with charging or reporting activity in the month.
//
// This is the platform subscription. It is NOT the energy price — that is
// `apps/api/src/lib/tariff/compute-session-cost.ts`, whose header explicitly
// lists "per-day fastagjald (subscription)" as out of scope. This module is
// the piece that was missing, and it is deliberately separate: energy is
// billed per session against a tariff chain, subscription is billed per
// organisation per month against a headcount.
//
// ─── Money math conventions ────────────────────────────────────────
//
// Identical to compute-session-cost.ts, on purpose — one convention in the
// codebase, not two. All money is BigInt **minor units** = 1/100 króna
// (aurar). Half-up rounding via `(n + d/2) / d`.
//
// Subscription prices are whole krónur, so every constant below is an exact
// multiple of 100 minor and no rounding occurs in the subtotal. Rounding can
// still appear once VAT is applied by the caller.
//
// ─── The cap ───────────────────────────────────────────────────────
//
// The cap is per connector, applied to the ORGANISATION total:
//
//     uncapped = 200·C + 50·D
//     cap      = 450·C
//     total    = min(uncapped, cap)
//
// So the cap binds exactly when 50·D > 250·C, i.e. when D > 5·C — more than
// five active drivers per active connector. Below that the cap never
// engages, which is the common MDU shape (one connector per parking space,
// one or two drivers each).

/** 200 kr per active connector per month, in minor units. */
export const CORE_CONNECTOR_PRICE_MINOR = 20_000n;
/** 50 kr per active driver per month, in minor units. */
export const CORE_DRIVER_PRICE_MINOR = 5_000n;
/** 450 kr per active connector per month — the ceiling on the org total. */
export const CORE_CONNECTOR_CAP_MINOR = 45_000n;

/**
 * Drivers per connector at which the cap starts to bind.
 * (450 − 200) / 50 = 5. At exactly 5 the uncapped total equals the cap.
 */
export const CORE_CAP_BREAKEVEN_DRIVERS_PER_CONNECTOR = 5;

export type CoreSubscriptionLineKind =
  | "connector_subscription"
  | "driver_subscription"
  | "connector_cap_relief";

export interface CoreSubscriptionLine {
  kind: CoreSubscriptionLineKind;
  code: string;
  displayName: string;
  qty: number;
  qtyUnit: "connector" | "driver" | "—";
  /** Ex-VAT unit price in minor units; null on the relief line. */
  unitPriceMinor: bigint | null;
  /** Ex-VAT amount. NEGATIVE on the relief line — it is a reduction. */
  amountMinor: bigint;
}

export interface CoreSubscriptionInput {
  /** Connectors enabled on Straumvakt during the billing month. */
  activeConnectors: number;
  /** Drivers with charging or reporting activity during the month. */
  activeDrivers: number;
}

export interface CoreSubscriptionBreakdown {
  currency: "ISK";
  activeConnectors: number;
  activeDrivers: number;
  connectorComponentMinor: bigint;
  driverComponentMinor: bigint;
  /** 200·C + 50·D, before the cap. */
  uncappedSubtotalMinor: bigint;
  /** 450·C. */
  capMinor: bigint;
  /** True when the cap actually reduced the total (uncapped strictly above). */
  capApplied: boolean;
  /** How much the cap took off. Zero when it did not bind. */
  capReliefMinor: bigint;
  /** What the organisation owes, ex-VAT: min(uncapped, cap). */
  subtotalExVatMinor: bigint;
  lineItems: CoreSubscriptionLine[];
}

function assertCount(value: number, field: string): bigint {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field}_must_be_nonneg_integer`);
  }
  return BigInt(value);
}

/**
 * Compute one organisation's Core subscription for one billing month.
 *
 * Pure. Deterministic. The unit tests are the contract.
 *
 * Note the degenerate case, which is a real product question rather than a
 * rounding detail: with **zero active connectors the cap is zero**, so an
 * organisation with drivers but no connectors owes nothing, however many
 * drivers it has. That follows directly from the locked frame ("capped at
 * 450 kr / connector") and this function implements it literally. If Core
 * should instead bill drivers in that state, the frame needs a floor and
 * this function needs a decision, not a patch.
 */
export function computeCoreSubscription(
  input: CoreSubscriptionInput,
): CoreSubscriptionBreakdown {
  const connectors = assertCount(input.activeConnectors, "active_connectors");
  const drivers = assertCount(input.activeDrivers, "active_drivers");

  const connectorComponentMinor = connectors * CORE_CONNECTOR_PRICE_MINOR;
  const driverComponentMinor = drivers * CORE_DRIVER_PRICE_MINOR;
  const uncappedSubtotalMinor = connectorComponentMinor + driverComponentMinor;
  const capMinor = connectors * CORE_CONNECTOR_CAP_MINOR;

  const capApplied = uncappedSubtotalMinor > capMinor;
  const subtotalExVatMinor = capApplied ? capMinor : uncappedSubtotalMinor;
  const capReliefMinor = capApplied ? uncappedSubtotalMinor - capMinor : 0n;

  const lineItems: CoreSubscriptionLine[] = [];
  if (connectors > 0n) {
    lineItems.push({
      kind: "connector_subscription",
      code: "CORE_CONNECTOR",
      displayName: "Core — active connectors",
      qty: input.activeConnectors,
      qtyUnit: "connector",
      unitPriceMinor: CORE_CONNECTOR_PRICE_MINOR,
      amountMinor: connectorComponentMinor,
    });
  }
  if (drivers > 0n) {
    lineItems.push({
      kind: "driver_subscription",
      code: "CORE_DRIVER",
      displayName: "Core — active drivers",
      qty: input.activeDrivers,
      qtyUnit: "driver",
      unitPriceMinor: CORE_DRIVER_PRICE_MINOR,
      amountMinor: driverComponentMinor,
    });
  }
  if (capApplied) {
    // Surfaced as its own negative line rather than silently shrinking the
    // driver line. An organisation that hits the cap should be able to see
    // that it did, and by how much, without recomputing anything.
    lineItems.push({
      kind: "connector_cap_relief",
      code: "CORE_CAP",
      displayName: `Core — cap at 450 kr per connector (${input.activeConnectors})`,
      qty: input.activeConnectors,
      qtyUnit: "—",
      unitPriceMinor: null,
      amountMinor: -capReliefMinor,
    });
  }

  return {
    currency: "ISK",
    activeConnectors: input.activeConnectors,
    activeDrivers: input.activeDrivers,
    connectorComponentMinor,
    driverComponentMinor,
    uncappedSubtotalMinor,
    capMinor,
    capApplied,
    capReliefMinor,
    subtotalExVatMinor,
    lineItems,
  };
}

/**
 * The largest number of active drivers that can be added before the cap
 * starts to bite, for a given connector count. Useful for the operator
 * console: "you can add N more drivers at no extra cost".
 *
 * Returns 0 when the cap already binds.
 */
export function driversUntilCapBinds(
  activeConnectors: number,
  activeDrivers: number,
): number {
  const connectors = assertCount(activeConnectors, "active_connectors");
  const drivers = assertCount(activeDrivers, "active_drivers");
  const headroomMinor = connectors * CORE_CONNECTOR_CAP_MINOR
    - connectors * CORE_CONNECTOR_PRICE_MINOR
    - drivers * CORE_DRIVER_PRICE_MINOR;
  if (headroomMinor <= 0n) return 0;
  return Number(headroomMinor / CORE_DRIVER_PRICE_MINOR);
}

/**
 * Effective price per connector per month, in minor units, rounded half-up.
 * The number an operator actually compares against "200–450 kr".
 * Zero connectors yields 0 rather than throwing — there is nothing to
 * divide by, and a caller rendering a dashboard should not have to guard.
 */
export function effectivePricePerConnectorMinor(
  breakdown: CoreSubscriptionBreakdown,
): bigint {
  const connectors = BigInt(breakdown.activeConnectors);
  if (connectors === 0n) return 0n;
  const n = breakdown.subtotalExVatMinor;
  return (n + connectors / 2n) / connectors;
}
