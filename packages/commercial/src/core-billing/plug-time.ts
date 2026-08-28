// Plug-time (occupancy) fee — pure functions, no I/O.
//
// Core includes "plug-time fee with grace period". The session-cost engine
// lists "overtime/parking-grace penalties" as explicitly out of scope, so
// this is the missing piece rather than a duplicate of it.
//
// ─── What the fee is for ───────────────────────────────────────────
//
// In an MDU or workplace car park the scarce resource is the CONNECTOR, not
// the electricity. A finished car occupying a charger is the problem the fee
// exists to price. That drives the default anchor below.
//
// ─── The anchor decision ───────────────────────────────────────────
//
// The grace clock can start at two different moments and they are not
// interchangeable:
//
//   "charging_end"  grace runs from when charging STOPPED. A driver who
//                   plugs in for eight hours and draws power the whole time
//                   pays nothing. Only idle occupancy is charged. This is
//                   the default, because it prices the behaviour the fee is
//                   meant to discourage.
//
//   "plug_in"       grace runs from when the cable went in. A long slow
//                   charge accrues a fee even while actively charging.
//                   Appropriate for a high-demand public site; punitive and
//                   surprising in an MDU where overnight charging is normal.
//
// Core V1 default is `charging_end`. `plug_in` is implemented because some
// workplace sites will want it, not because it is recommended.
//
// ─── Timestamp trust ───────────────────────────────────────────────
//
// This function takes the instants it is given and does arithmetic. It does
// NOT decide which stored timestamp is authoritative — `charging.sessions`
// carries both `ocpp_stopped_at` and `cdr_stopped_at` and they can disagree.
// Choosing between them is a data-quality decision for the caller, and
// billing occupancy on the wrong one produces a charge the driver can
// legitimately dispute. See the Core billing contract note.
//
// Money conventions are those of compute-session-cost.ts: BigInt minor units
// (1/100 króna), half-up rounding.

export type PlugTimeAnchor = "charging_end" | "plug_in";

/**
 * How a partial final minute is treated.
 *
 * `down` is the default: a driver is charged only for whole minutes they
 * actually overstayed. Rounding up means someone one second past the grace
 * period pays a full minute, which is the kind of detail that generates
 * support tickets worth more than the fee.
 */
export type PlugTimeRounding = "down" | "up" | "nearest";

export interface PlugTimeRule {
  /** Free minutes after the anchor. 0 means the fee starts immediately. */
  graceMinutes: number;
  /** Ex-VAT fee per billable minute, in minor units. */
  feePerMinuteMinor: bigint;
  /** Default "charging_end". */
  anchor?: PlugTimeAnchor;
  /** Default "down". */
  rounding?: PlugTimeRounding;
  /** Optional ceiling on the fee for one session. null = uncapped. */
  maxFeeMinor?: bigint | null;
}

export interface PlugTimeSession {
  /** When the cable went in. Required when anchor is "plug_in". */
  pluggedInAt?: Date | null;
  /** When charging stopped. Required when anchor is "charging_end". */
  chargingEndedAt?: Date | null;
  /** When the cable came out. */
  unpluggedAt: Date;
}

export type PlugTimeLineKind = "plug_time_fee" | "plug_time_cap_relief";

export interface PlugTimeLine {
  kind: PlugTimeLineKind;
  code: string;
  displayName: string;
  qty: number;
  qtyUnit: "minute" | "—";
  unitPriceMinor: bigint | null;
  amountMinor: bigint;
}

export interface PlugTimeBreakdown {
  currency: "ISK";
  anchor: PlugTimeAnchor;
  /** Whole minutes from the anchor to unplug, before grace. */
  occupiedMinutes: number;
  graceMinutes: number;
  /** Minutes actually charged for, after grace and rounding. */
  billableMinutes: number;
  feePerMinuteMinor: bigint;
  uncappedFeeMinor: bigint;
  maxFeeMinor: bigint | null;
  capApplied: boolean;
  amountExVatMinor: bigint;
  lineItems: PlugTimeLine[];
}

const MS_PER_MINUTE = 60_000;

function assertInstant(d: Date | null | undefined, field: string): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(`${field}_must_be_a_valid_date`);
  }
  return d;
}

function roundMinutes(exact: number, mode: PlugTimeRounding): number {
  switch (mode) {
    case "down":
      return Math.floor(exact);
    case "up":
      return Math.ceil(exact);
    case "nearest":
      return Math.round(exact);
  }
}

/**
 * Compute the plug-time fee for one session.
 *
 * Pure. Returns a zero-amount breakdown rather than throwing when the
 * driver stayed inside the grace period — "no fee" is a normal outcome, not
 * an error, and callers should be able to render it either way.
 *
 * Throws only on inputs that cannot mean anything: an invalid date, a
 * missing anchor timestamp, a negative rate or grace, or an unplug that
 * precedes the anchor (which is a data fault, not a free session).
 */
export function computePlugTimeFee(
  session: PlugTimeSession,
  rule: PlugTimeRule,
): PlugTimeBreakdown {
  const anchor: PlugTimeAnchor = rule.anchor ?? "charging_end";
  const rounding: PlugTimeRounding = rule.rounding ?? "down";

  if (!Number.isFinite(rule.graceMinutes) || rule.graceMinutes < 0) {
    throw new Error("grace_minutes_must_be_nonneg_finite");
  }
  if (rule.feePerMinuteMinor < 0n) {
    throw new Error("fee_per_minute_must_be_nonneg");
  }
  if (rule.maxFeeMinor != null && rule.maxFeeMinor < 0n) {
    throw new Error("max_fee_must_be_nonneg");
  }

  const unpluggedAt = assertInstant(session.unpluggedAt, "unplugged_at");
  const anchorAt =
    anchor === "charging_end"
      ? assertInstant(session.chargingEndedAt, "charging_ended_at")
      : assertInstant(session.pluggedInAt, "plugged_in_at");

  const elapsedMs = unpluggedAt.getTime() - anchorAt.getTime();
  if (elapsedMs < 0) {
    // Unplugging before the anchor is impossible in reality; it means the
    // timestamps are wrong. Silently treating it as zero would bill nothing
    // and hide a data fault that also corrupts energy billing.
    throw new Error("unplugged_before_anchor");
  }

  const occupiedMinutesExact = elapsedMs / MS_PER_MINUTE;
  const billableExact = Math.max(0, occupiedMinutesExact - rule.graceMinutes);
  const billableMinutes = Math.max(0, roundMinutes(billableExact, rounding));

  const uncappedFeeMinor = BigInt(billableMinutes) * rule.feePerMinuteMinor;
  const maxFeeMinor = rule.maxFeeMinor ?? null;
  const capApplied = maxFeeMinor !== null && uncappedFeeMinor > maxFeeMinor;
  const amountExVatMinor = capApplied ? maxFeeMinor! : uncappedFeeMinor;

  const lineItems: PlugTimeLine[] = [];
  if (uncappedFeeMinor > 0n) {
    lineItems.push({
      kind: "plug_time_fee",
      code: "CORE_PLUG_TIME",
      displayName: `Plug time beyond ${rule.graceMinutes} min grace`,
      qty: billableMinutes,
      qtyUnit: "minute",
      unitPriceMinor: rule.feePerMinuteMinor,
      amountMinor: uncappedFeeMinor,
    });
  }
  if (capApplied) {
    lineItems.push({
      kind: "plug_time_cap_relief",
      code: "CORE_PLUG_TIME_CAP",
      displayName: "Plug-time cap",
      qty: 1,
      qtyUnit: "—",
      unitPriceMinor: null,
      amountMinor: -(uncappedFeeMinor - maxFeeMinor!),
    });
  }

  return {
    currency: "ISK",
    anchor,
    occupiedMinutes: Math.floor(occupiedMinutesExact),
    graceMinutes: rule.graceMinutes,
    billableMinutes,
    feePerMinuteMinor: rule.feePerMinuteMinor,
    uncappedFeeMinor,
    maxFeeMinor,
    capApplied,
    amountExVatMinor,
    lineItems,
  };
}

/**
 * The instant at which a session starts accruing a plug-time fee, or null
 * when the anchor timestamp is missing. Useful for the driver app: "free
 * until 07:42".
 */
export function plugTimeChargeableFrom(
  session: Pick<PlugTimeSession, "pluggedInAt" | "chargingEndedAt">,
  rule: Pick<PlugTimeRule, "graceMinutes" | "anchor">,
): Date | null {
  const anchor: PlugTimeAnchor = rule.anchor ?? "charging_end";
  const at = anchor === "charging_end" ? session.chargingEndedAt : session.pluggedInAt;
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() + rule.graceMinutes * MS_PER_MINUTE);
}
