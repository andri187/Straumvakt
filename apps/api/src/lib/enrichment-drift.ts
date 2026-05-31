// enrichment-drift.ts — observability-only helpers for OCPP↔CDR drift.
//
// Sprint 9 — ENRICH-2 deliverable 2.
//
// When a Zaptec CDR (vendor /chargehistory entry) is enriched onto a
// session that already has OCPP-side figures, we want to know if the
// vendor value diverges from the OCPP value beyond tolerance. The CDR
// is canonical for billing (vendor-signed OCMF), so it overwrites; but
// significant divergence is a smell — clock drift on the charger,
// meter calibration issue, or a sampled-vs-final-value mismatch.
//
// These helpers are pure side-effecting: console.warn() only. They
// MUST NOT mutate session rows, ledger rows, or anything else. The
// integration point (a future edit to zaptec-session-sync) calls
// logEnergyDrift + logStopTimeDrift before overwriting the canonical
// energy/stoppedAt columns; downstream log scraping picks up the
// `[enrichment-drift]` prefix for alerting.
//
// Default tolerances match the reconciliation probe so a session that
// trips a drift warn here will surface in `probe-reconciliation.ts`
// under MISMATCH_ENERGY / MISMATCH_TIME.

const DEFAULT_ENERGY_TOLERANCE_KWH = 0.05;
const DEFAULT_TIME_TOLERANCE_SEC = 30;

export interface EnergyDriftInput {
  sessionId: string;
  chargerId: string;
  ocppEnergyKwh: number | null;
  cdrEnergyKwh: number | null;
  /** kWh; default 0.05 — must match probe-reconciliation default. */
  toleranceKwh?: number;
}

export interface StopTimeDriftInput {
  sessionId: string;
  ocppStoppedAt: Date | null;
  cdrStoppedAt: Date | null;
  /** seconds; default 30 — must match probe-reconciliation default. */
  toleranceSec?: number;
}

/**
 * Logs a drift warning if both OCPP-side and CDR-side energy figures
 * are present AND their absolute delta exceeds tolerance. No warn is
 * emitted when either side is null (no comparison possible) or when
 * the delta is within tolerance.
 *
 * Pure side-effecting: console.warn only. No return value, no DB
 * writes, no thrown exceptions on bad input.
 */
export function logEnergyDrift(input: EnergyDriftInput): void {
  const { sessionId, chargerId, ocppEnergyKwh, cdrEnergyKwh } = input;
  const tolerance = input.toleranceKwh ?? DEFAULT_ENERGY_TOLERANCE_KWH;

  if (ocppEnergyKwh === null || cdrEnergyKwh === null) {
    // No comparison possible — one side hasn't arrived yet.
    return;
  }

  const delta = Math.abs(Number(ocppEnergyKwh) - Number(cdrEnergyKwh));
  if (!Number.isFinite(delta) || delta <= tolerance) {
    return;
  }

  console.warn(
    `[enrichment-drift] session=${sessionId} charger=${chargerId} ` +
      `ocpp_energy=${ocppEnergyKwh} cdr_energy=${cdrEnergyKwh} ` +
      `delta=${delta.toFixed(3)}kWh — CDR overwrote OCPP figure; verify with operator if delta grows`,
  );
}

/**
 * Logs a drift warning if both OCPP-side and CDR-side stop timestamps
 * are present AND their absolute delta exceeds tolerance. No warn is
 * emitted when either side is null or when the delta is within
 * tolerance.
 *
 * Pure side-effecting: console.warn only.
 */
export function logStopTimeDrift(input: StopTimeDriftInput): void {
  const { sessionId, ocppStoppedAt, cdrStoppedAt } = input;
  const tolerance = input.toleranceSec ?? DEFAULT_TIME_TOLERANCE_SEC;

  if (ocppStoppedAt === null || cdrStoppedAt === null) {
    return;
  }

  const deltaSec =
    Math.abs(ocppStoppedAt.getTime() - cdrStoppedAt.getTime()) / 1000;
  if (!Number.isFinite(deltaSec) || deltaSec <= tolerance) {
    return;
  }

  console.warn(
    `[enrichment-drift] session=${sessionId} stop-time drift ${deltaSec.toFixed(0)}s`,
  );
}
