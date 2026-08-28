// ADR 0054 decision 5 — billing counts placements OVERLAPPING the period.
//
// Not placements current at the moment of billing. That distinction is the
// whole of item 7, and it fails in both directions:
//
//   - a device placed on the 2nd and removed on the 28th is billable, and a
//     read of "where is this device now", run in April, finds it nowhere and
//     bills nobody for 26 days of hardware;
//   - a device that moves on the 12th belongs to the old host for eleven days
//     and the new one for the rest, and a current-row read attributes the
//     whole month to whoever holds it when the query runs.
//
// The second is the one that bills the WRONG host rather than no host, which
// is worse: the invoice looks right to everyone except the two people it is
// wrong for.
//
// ── WHY THIS IS PURE AND THE SQL IS NOT ───────────────────────────────────
//
// Migrations 0005-0008 are unapplied, so `assets.placements` does not exist in
// any database and the query in `gatherConnectorEvidence` has never run. The
// decisions live here, where a fixture can drive them. Same shape as every
// other port in this lane.

import { overlaps, type Tstzrange } from "@straumvakt/shared/domain/effective-dating";
import { activeForBilling, type BillableActivity, type VendorConfigObservation } from "../vendor-config/sink-port";

/** One placement row, as the overlap join returns it. */
export interface PlacementRow {
  id: string;
  publicId: string;
  deviceId: string;
  /** The HOST being billed. Not the session's org — the placement's. */
  orgId: string;
  installationId: string;
  period: Tstzrange;
  /** The connectors on that device, resolved through evses. */
  connectorIds: string[];
}

/** The billing period, half-open: `[start, end)`. */
export interface PeriodWindow {
  start: Date;
  end: Date;
}

/**
 * How a month is split when a device is held by more than one host.
 *
 * **This is a commercial decision, and the default is deliberately the one
 * that changes nothing.** See the argument below.
 */
export type MoveFeePolicy =
  /**
   * Each host pays a full connector-month. TODAY'S BEHAVIOUR: the
   * `connector_activity_month` key is `(org, year, month, connector)`, so two
   * hosts already produce two rows and the feeder already prices both at the
   * full rate. **Default, because changing what an invoice says must not be a
   * side effect of a schema change.**
   */
  | "whole_month_per_host"
  /**
   * Each host pays for the days it held the device, as a fraction of the
   * month. What ADR 0054 argues for and what this file recommends.
   */
  | "prorate_by_overlap_days";

export const DEFAULT_MOVE_FEE_POLICY: MoveFeePolicy = "whole_month_per_host";

// ═══════════════════════════════════════════════════════════════════════════
// THE PRORATION FORK — argued, implemented both ways, not stalled on
//
// The question: one device, two hosts, one month. What is billed?
//
// ── The option that is wrong, and why it is worth ruling out first ────────
//
// "One fee to one host" cannot be made to work. Whichever host is chosen is
// wrong for the other, and the only non-arbitrary rule — "whoever holds it at
// month end" — makes the fee depend on WHEN the query runs, which is precisely
// what decision 5 exists to forbid. A device that moves on the 28th would bill
// the new host for a month it held for three days.
//
// ── The two that are defensible ───────────────────────────────────────────
//
// TWO FULL FEES is what the system does today. Its case: the 200 kr is a
// PLATFORM fee, and onboarding a charger — provisioning, credentials, support
// — costs per host, not per day. The 450 kr cap is expressed per connector per
// month, which reads as a per-connector-month unit. And a host who had the
// hardware for eleven days still had a working charger for eleven days.
//
// Its cost: one physical device produces 400 kr in a month. That is the exact
// arithmetic ADR 0054 calls a defect in its double-invoice example. The only
// difference is that here both hosts consented — which is a real difference,
// and also a hard one to explain to either of them.
//
// PRORATION BY OVERLAP DAYS is what this file recommends. ADR 0054 names it
// twice: decision 5 says the device "belongs to the old host for eleven days
// and the new one for the rest", and "What this aligns with" lists
// overlap-based proration as the ordinary subscription convention. It makes
// the total for one device-month equal one fee no matter how many hosts held
// it, which is the property that makes the invoice explainable.
//
// It also composes correctly with FOCUS rule 3 — one money engine, two money
// lines. Proration is a multiplier on a quantity, computed before the engine
// sees it; the engine still prices one rate against one count and neither
// money line learns about placements.
//
// ── WHY THE DEFAULT IS NOT WHAT I ARGUE FOR ───────────────────────────────
//
// **Changing what an invoice says must not be a side effect of a schema
// change.** `whole_month_per_host` is what the system does today, so it is the
// default, and flipping it is one constant in this file plus a decision that
// is Andri's rather than mine. Both branches are implemented and both are
// tested; nothing is stalled and nothing is silently changed.
//
// If proration is chosen, one thing has to move with it: the 450 kr per
// connector per month CAP is expressed in whole connector-months and would
// need to apply to the prorated total, not to each host's share. That is
// noted here because it is the kind of thing that gets missed when a switch is
// flipped six weeks later.
// ═══════════════════════════════════════════════════════════════════════════

/** Days in the period, from its half-open bounds. Whole days, UTC. */
export function periodDays(window: PeriodWindow): number {
  const ms = window.end.getTime() - window.start.getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * The days a placement and the period share, as whole days.
 *
 * Rounded rather than truncated, and it matters at the boundary: a placement
 * closing at 09:00 on the 12th shares 11 days and 9 hours with the month, and
 * truncation would hand the host 11 while rounding hands it 11 — but a
 * placement closing at 18:00 gets 12 under rounding and 11 under truncation.
 * Rounding is chosen because the alternative systematically favours the
 * platform, and a rule that always rounds the customer's way when it is
 * uncertain is the one that survives being explained.
 */
export function overlapDays(placement: Tstzrange, window: PeriodWindow): number {
  const from = Math.max(placement.from.getTime(), window.start.getTime());
  const until = Math.min(placement.until?.getTime() ?? Infinity, window.end.getTime());
  if (!(until > from)) return 0;
  return Math.round((until - from) / 86_400_000);
}

/** What one host is billed for one connector in one period. */
export interface ConnectorPlacementShare {
  orgId: string;
  connectorId: string;
  deviceId: string;
  placementId: string;
  /** Whole days this host held the device inside the period. */
  overlapDays: number;
  /** Days in the period. Carried so a share is auditable without the period. */
  periodDays: number;
  /**
   * The multiplier applied to one connector-month.
   *
   * `1` under `whole_month_per_host`. Under proration, `overlapDays /
   * periodDays` — carried as a numerator and denominator rather than a float,
   * because the money engine works in aurar as BigInt and a float here would
   * put a rounding decision in the wrong layer.
   */
  shareNumerator: number;
  shareDenominator: number;
}

export type ConnectorShareOutcome =
  | { kind: "counted"; shares: ConnectorPlacementShare[] }
  | { kind: "unavailable"; reason: "no_placements_for_period" | "vendor_config_unavailable" };

/**
 * Decision 5, executed.
 *
 * Two halves, and both must hold — this is the Dalvegur predicate from Phase 3
 * with its (a) supplied:
 *
 *   (a) the device had a PLACEMENT overlapping the period
 *   (b) the latest vendor-config observation before the period's end has
 *       `chargerActive === true`
 *
 * `vendorConfigByDevice` is the observation log per device. A device with no
 * log is **not** billed as inactive — it makes the whole answer `unavailable`,
 * because an unavailable count is a hold and not a smaller number. That is
 * round 3's rule and it is the one this function most easily gets wrong.
 */
export function connectorSharesForPeriod(
  placements: readonly PlacementRow[],
  window: PeriodWindow,
  vendorConfigByDevice: ReadonlyMap<string, readonly VendorConfigObservation[]>,
  policy: MoveFeePolicy = DEFAULT_MOVE_FEE_POLICY,
): ConnectorShareOutcome {
  const periodRange: Tstzrange = { from: window.start, until: window.end };
  const overlapping = placements.filter((p) => overlaps(p.period, periodRange));

  // NOT a zero. Ledger note 22: "no placements overlapped this period" and "we
  // have not loaded any placements" are the same empty list, and the caller
  // must hold rather than invoice for nothing.
  if (overlapping.length === 0) {
    return { kind: "unavailable", reason: "no_placements_for_period" };
  }

  const days = periodDays(window);
  const shares: ConnectorPlacementShare[] = [];

  for (const p of overlapping) {
    const verdict: BillableActivity = activeForBilling(
      vendorConfigByDevice.get(p.deviceId) ?? [],
      window.end,
    );
    // A device we have never polled cannot be priced either way. Refusing the
    // whole period is deliberate: silently dropping one device would produce
    // an invoice that looks complete and is short by one connector.
    if (verdict.kind === "unavailable") {
      return { kind: "unavailable", reason: "vendor_config_unavailable" };
    }
    if (verdict.kind === "not_billable") continue;

    const held = overlapDays(p.period, window);
    for (const connectorId of p.connectorIds) {
      shares.push({
        orgId: p.orgId,
        connectorId,
        deviceId: p.deviceId,
        placementId: p.id,
        overlapDays: held,
        periodDays: days,
        shareNumerator: policy === "prorate_by_overlap_days" ? held : 1,
        shareDenominator: policy === "prorate_by_overlap_days" ? days : 1,
      });
    }
  }

  // Every placement was vendor-deactivated. Still `counted`, with an empty
  // list — and this is the one place an empty answer is NOT `unavailable`,
  // because we looked, we have the evidence, and the answer is genuinely
  // "none of these are billable". The distinction is the whole of note 22:
  // measured zero is legal, ASSUMED zero is not.
  return { kind: "counted", shares };
}
