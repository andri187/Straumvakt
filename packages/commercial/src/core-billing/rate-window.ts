// Rate versioning and window selection — pure functions, no I/O.
//
// The question this answers: a session runs from 23:40 to 00:20 and the DSO
// rate changes at midnight. Which price applies?
//
// ─── The three candidate policies ──────────────────────────────────
//
//   "start_rate"      The version active when the session STARTED prices the
//                     whole session. One rate, one line, no interpolation.
//
//   "highest_rate"    The most expensive version overlapping the session
//                     prices all of it. Never under-bills the operator;
//                     systematically over-bills the driver.
//
//   "split_by_time"   Energy is apportioned to each version in proportion to
//                     the TIME the session spent in that version's window.
//
// ─── Recommendation for Core V1: start_rate ────────────────────────
//
// Not because it is simplest, but because the other two cannot be honestly
// computed on the data this system has:
//
//   • `split_by_time` apportions ENERGY by TIME, which is only correct if
//     power is constant across the session. Real charging tapers — an EV
//     near full draws a fraction of its early-session power — so a session
//     that crosses midnight typically consumed most of its kWh before the
//     boundary. Splitting it evenly moves money in a direction nobody can
//     defend to a customer. Doing it properly needs interval energy, and
//     `charging.meter_values` is EMPTY: energy telemetry lands in
//     `charging.live_session_samples`, which is a live-view sampler, not a
//     billing-grade interval series.
//
//   • `highest_rate` is defensible only as a deliberate commercial choice.
//     It is implemented here so an operator can select it knowingly, and it
//     is not the default.
//
// `start_rate` also matches how the rest of the stack already behaves:
// `pickActiveRate` in the agreements resolver selects ONE active rate for a
// session rather than a set of windows.
//
// Boundary-crossing sessions are reported (`crossedBoundary`) whichever
// policy is chosen, so the exposure is measurable rather than invisible.
//
// Money conventions follow compute-session-cost.ts: BigInt minor units
// (1/100 króna), half-up rounding.

/** The Core V1 default. See the rationale above before changing it. */
export const CORE_V1_RATE_POLICY: RateSelectionPolicy = "start_rate";

export type RateSelectionPolicy = "start_rate" | "highest_rate" | "split_by_time";

export interface RateVersion {
  code: string;
  /** Ex-VAT price per kWh in minor units. */
  pricePerKwhMinor: bigint;
  effectiveFrom: Date;
  /** null = still in force. Matches persist.ts, where null means active. */
  effectiveUntil: Date | null;
}

export interface RateWindowSession {
  startedAt: Date;
  endedAt: Date;
  /** Total kWh delivered across the whole session. */
  energyKwh: number;
}

export interface RateAllocation {
  code: string;
  pricePerKwhMinor: bigint;
  /** kWh attributed to this version. */
  energyKwh: number;
  /** Share of the session's duration spent in this version's window, 0..1. */
  timeFraction: number;
  windowFrom: Date;
  windowUntil: Date;
}

export interface RateSelectionResult {
  policy: RateSelectionPolicy;
  /** True when more than one version overlapped the session. */
  crossedBoundary: boolean;
  /** Every version that overlapped, regardless of policy — the audit trail. */
  overlappingCodes: string[];
  allocations: RateAllocation[];
  /** Sum of allocation energies. Equals session energy up to float epsilon. */
  totalEnergyKwh: number;
}

function assertInstant(d: Date, field: string): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(`${field}_must_be_a_valid_date`);
  }
  return d;
}

function coversInstant(v: RateVersion, t: number): boolean {
  const from = v.effectiveFrom.getTime();
  const until = v.effectiveUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  return from <= t && t < until;
}

/**
 * Versions overlapping [startedAt, endedAt), in chronological order.
 * A zero-length session overlaps whatever covers its single instant.
 */
export function overlappingVersions(
  versions: RateVersion[],
  session: Pick<RateWindowSession, "startedAt" | "endedAt">,
): RateVersion[] {
  const s = session.startedAt.getTime();
  const e = session.endedAt.getTime();
  const hits = versions.filter((v) => {
    const from = v.effectiveFrom.getTime();
    const until = v.effectiveUntil?.getTime() ?? Number.POSITIVE_INFINITY;
    if (s === e) return coversInstant(v, s);
    return from < e && until > s;
  });
  return hits.sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
}

/**
 * Apportion a session's energy across rate versions under a policy.
 *
 * Pure. Throws when no version covers the session start — billing energy at
 * no rate is worse than failing loudly, because the resulting zero looks
 * like a free session rather than a missing rate.
 */
export function selectRateVersions(
  versions: RateVersion[],
  session: RateWindowSession,
  policy: RateSelectionPolicy = CORE_V1_RATE_POLICY,
): RateSelectionResult {
  assertInstant(session.startedAt, "started_at");
  assertInstant(session.endedAt, "ended_at");
  if (session.endedAt.getTime() < session.startedAt.getTime()) {
    throw new Error("session_ended_before_it_started");
  }
  if (!Number.isFinite(session.energyKwh) || session.energyKwh < 0) {
    throw new Error("energy_kwh_must_be_nonneg_finite");
  }
  for (const v of versions) {
    if (v.pricePerKwhMinor < 0n) throw new Error(`negative_price_for_${v.code}`);
    assertInstant(v.effectiveFrom, `effective_from_${v.code}`);
  }

  const overlaps = overlappingVersions(versions, session);
  if (overlaps.length === 0) throw new Error("no_applicable_rate_version");

  const startVersion = overlaps.find((v) => coversInstant(v, session.startedAt.getTime()));
  if (!startVersion) {
    // A session can overlap a later version while nothing covers its start —
    // a coverage gap. Silently falling back to the next version would bill
    // at a price that was not in force when the driver plugged in.
    throw new Error("no_rate_version_covers_session_start");
  }

  const crossedBoundary = overlaps.length > 1;
  const overlappingCodes = overlaps.map((v) => v.code);
  const s = session.startedAt.getTime();
  const e = session.endedAt.getTime();
  const durationMs = e - s;

  const whole = (v: RateVersion): RateAllocation[] => [
    {
      code: v.code,
      pricePerKwhMinor: v.pricePerKwhMinor,
      energyKwh: session.energyKwh,
      timeFraction: 1,
      windowFrom: session.startedAt,
      windowUntil: session.endedAt,
    },
  ];

  let allocations: RateAllocation[];
  switch (policy) {
    case "start_rate":
      allocations = whole(startVersion);
      break;

    case "highest_rate": {
      const highest = overlaps.reduce((a, b) =>
        b.pricePerKwhMinor > a.pricePerKwhMinor ? b : a,
      );
      allocations = whole(highest);
      break;
    }

    case "split_by_time": {
      if (durationMs === 0) {
        allocations = whole(startVersion);
        break;
      }
      const raw = overlaps.map((v) => {
        const from = Math.max(s, v.effectiveFrom.getTime());
        const until = Math.min(e, v.effectiveUntil?.getTime() ?? e);
        const ms = Math.max(0, until - from);
        return { v, from, until, ms };
      }).filter((w) => w.ms > 0);

      const totalMs = raw.reduce((a, w) => a + w.ms, 0);
      allocations = raw.map((w, i) => {
        const fraction = w.ms / totalMs;
        // Give the last window the remainder so the energies sum exactly to
        // the session total rather than drifting by a float epsilon.
        const energy =
          i === raw.length - 1
            ? session.energyKwh - raw.slice(0, -1).reduce((a, x) => a + session.energyKwh * (x.ms / totalMs), 0)
            : session.energyKwh * fraction;
        return {
          code: w.v.code,
          pricePerKwhMinor: w.v.pricePerKwhMinor,
          energyKwh: energy,
          timeFraction: fraction,
          windowFrom: new Date(w.from),
          windowUntil: new Date(w.until),
        };
      });
      break;
    }
  }

  return {
    policy,
    crossedBoundary,
    overlappingCodes,
    allocations,
    totalEnergyKwh: allocations.reduce((a, x) => a + x.energyKwh, 0),
  };
}

/**
 * Ex-VAT cost of a set of allocations, in minor units, half-up rounded per
 * allocation. Mirrors compute-session-cost.ts: kWh → milli-kWh integer,
 * multiply, then one half-up division.
 */
export function priceAllocationsMinor(allocations: RateAllocation[]): bigint {
  let total = 0n;
  for (const a of allocations) {
    const milliKwh = BigInt(Math.round(a.energyKwh * 1000));
    total += (milliKwh * a.pricePerKwhMinor + 500n) / 1000n;
  }
  return total;
}
