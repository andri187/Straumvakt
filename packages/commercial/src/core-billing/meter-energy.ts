// Meter-energy resolution — pure functions, no I/O.
//
// ─── The question this settles ─────────────────────────────────────
//
// OCPP 1.6 `MeterStart` / `MeterStop` are readings of the charge point's
// energy-active-import register. The specification does not promise the
// register is reset per transaction, and vendors differ:
//
//   per-session   the charger reports 0 at start and the session's kWh at
//                 stop. `meterStop` alone is the session energy.
//   cumulative    the charger reports a lifetime register. `meterStop`
//                 alone is the charger's TOTAL energy since manufacture.
//
// Straumvakt's ledger writers currently take `meterStop` directly
// (`projections.ts:344` and `:928`, both overwriting the `meterStart`
// value stored moments earlier). That is correct for the first mode and
// catastrophically wrong for the second — a cumulative charger would bill
// its entire lifetime as one session.
//
// ─── Measured on the deployed fleet, 2026-08-10 ────────────────────
//
// 1,655 sessions on the staging branch:
//   median 9.85 kWh · p95 36.9 kWh · max 79.5 kWh · none above 200 kWh
//   correlation between session sequence and energy, three busiest
//   chargers: -0.075, +0.112, -0.145   (a cumulative register gives ~+1.0)
//   minima of 11-28 Wh recur throughout, including 29 sub-1 kWh sessions
//   on a charger averaging 7.3 kWh
//
// So the deployed fleet is per-session and **today's billing is correct**.
// This module exists because nothing in the code says so, nothing tests
// it, and onboarding one cumulative-register charger would be silent.
//
// ─── The resolution rule ───────────────────────────────────────────
//
//     energy = meterStop - meterStart
//
// That single expression is correct in BOTH modes: per-session chargers
// report meterStart = 0, so the subtraction is a no-op. The current code
// is only accidentally right because the subtrahend happens to be zero.
//
// Money/unit conventions: energy is integer **Wh**, matching
// `charging.sessions.energy_wh`. Conversion to kWh happens at the pricing
// boundary, as `compute-session-cost.ts` already does.

/** What the charger's register appears to be doing. */
export type MeterMode = "per_session" | "cumulative" | "unknown";

/** Why a resolved reading cannot be billed as-is. */
export type BillingHoldReason =
  | "meter_stop_missing"
  | "meter_stop_before_start"
  | "meter_energy_implausible"
  | "meter_energy_without_duration";

export type MeterAnomaly = BillingHoldReason | "none";

export interface MeterReading {
  /** Register value at StartTransaction, in Wh. */
  meterStartWh?: number | null;
  /** Register value at StopTransaction, in Wh. */
  meterStopWh?: number | null;
}

export interface MeterResolutionInput {
  reading: MeterReading;
  /** Session duration; used only to catch energy with no time to produce it. */
  durationSeconds?: number | null;
  /**
   * Ceiling above which a single AC session is not believable, in Wh.
   * Default 150 kWh — roughly double the largest session ever observed on
   * this fleet (79.5 kWh), so it flags a cumulative register without
   * tripping on a genuinely long overnight charge.
   */
  maxPlausibleWh?: number;
  /**
   * Above this start value the charger is treated as reporting a
   * cumulative register. Default 1 kWh: a per-session charger reports 0,
   * and a rounding artefact will not reach a kilowatt-hour.
   */
  cumulativeStartThresholdWh?: number;
}

export interface MeterResolution {
  /** Session energy in Wh, or null when it cannot be resolved. */
  energyWh: number | null;
  mode: MeterMode;
  anomaly: MeterAnomaly;
  /** False when the row must not be priced without review. */
  billable: boolean;
  holdReason: BillingHoldReason | null;
  /** What the decision was based on — for the ledger and for disputes. */
  evidence: {
    meterStartWh: number | null;
    meterStopWh: number | null;
    startAssumedZero: boolean;
    maxPlausibleWh: number;
  };
}

export const DEFAULT_MAX_PLAUSIBLE_WH = 150_000;
export const DEFAULT_CUMULATIVE_START_THRESHOLD_WH = 1_000;

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Resolve a session's billable energy from its meter readings.
 *
 * Pure. Never throws — a malformed reading is a *hold*, not an exception,
 * because the caller is a queue consumer and throwing would retry the
 * message forever rather than surface the bad data.
 */
export function resolveMeterEnergy(
  input: MeterResolutionInput,
): MeterResolution {
  const maxPlausibleWh = input.maxPlausibleWh ?? DEFAULT_MAX_PLAUSIBLE_WH;
  const cumulativeThreshold =
    input.cumulativeStartThresholdWh ?? DEFAULT_CUMULATIVE_START_THRESHOLD_WH;

  const start = finiteOrNull(input.reading.meterStartWh);
  const stop = finiteOrNull(input.reading.meterStopWh);
  const startAssumedZero = start === null;

  const evidence = {
    meterStartWh: start,
    meterStopWh: stop,
    startAssumedZero,
    maxPlausibleWh,
  };

  const hold = (
    holdReason: BillingHoldReason,
    mode: MeterMode,
    energyWh: number | null = null,
  ): MeterResolution => ({
    energyWh,
    mode,
    anomaly: holdReason,
    billable: false,
    holdReason,
    evidence,
  });

  // No stop reading: there is no session energy to resolve at all. This is
  // a hold rather than zero, because billing zero silently turns a lost
  // StopTransaction into a free charge.
  if (stop === null) return hold("meter_stop_missing", "unknown");

  // A missing start is treated as zero, which is what the charger means
  // when it omits it and what today's code already does. The mode stays
  // `unknown` because absence is not evidence of a reset register.
  const effectiveStart = start ?? 0;

  // A register that went backwards means a meter replacement, a firmware
  // reset, a rollover, or two sessions crossed. Any of those makes the
  // subtraction meaningless.
  if (stop < effectiveStart) {
    return hold("meter_stop_before_start", "unknown");
  }

  const energyWh = stop - effectiveStart;

  const mode: MeterMode =
    start === null
      ? "unknown"
      : start >= cumulativeThreshold
        ? "cumulative"
        : "per_session";

  // Implausible energy is the guard that catches a cumulative register
  // whose start reading was lost — the exact case where subtraction
  // cannot save us.
  if (energyWh > maxPlausibleWh) {
    return hold("meter_energy_implausible", mode, energyWh);
  }

  // Energy without elapsed time is physically impossible and usually means
  // two sessions were conflated. Only checked when a duration was supplied.
  const duration = finiteOrNull(input.durationSeconds ?? null);
  if (duration !== null && duration <= 0 && energyWh > 0) {
    return hold("meter_energy_without_duration", mode, energyWh);
  }

  return {
    energyWh,
    mode,
    anomaly: "none",
    billable: true,
    holdReason: null,
    evidence,
  };
}

/**
 * The narrow form for call sites that only need the number and must not
 * change behaviour today.
 *
 * `meterStop - (meterStart ?? 0)` is byte-identical to the current
 * `meterStop` for every session on the deployed fleet (all starts are 0 or
 * absent), and becomes correct the day a cumulative charger is onboarded.
 * Returns null when there is no stop reading, so the caller keeps its
 * existing "leave energy unchanged" behaviour rather than writing 0.
 */
export function sessionEnergyWh(reading: MeterReading): number | null {
  const stop = finiteOrNull(reading.meterStopWh);
  if (stop === null) return null;
  const start = finiteOrNull(reading.meterStartWh) ?? 0;
  if (stop < start) return null;
  return stop - start;
}

/**
 * Human-facing explanation of a hold, for the operator console and for the
 * driver-facing statement. Deliberately does not name internal columns.
 */
export function describeHold(reason: BillingHoldReason): string {
  switch (reason) {
    case "meter_stop_missing":
      return "The charger did not report a final meter reading for this session.";
    case "meter_stop_before_start":
      return "The charger's meter reading decreased during this session.";
    case "meter_energy_implausible":
      return "The reported energy is too large to be a single session.";
    case "meter_energy_without_duration":
      return "Energy was reported for a session with no elapsed time.";
  }
}
