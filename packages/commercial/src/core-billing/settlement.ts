// The settlement snapshot: what was charged, frozen at the moment it was
// decided.
//
// WHY THIS EXISTS
//
// Today `reports.session_ledger` stores one `tariff_definition_id` whose
// `compute_rule` is mutable in place. The id does not reconstruct the price.
// Worse, the retailer component IS resolved (resolve-tariff-chain.ts:286) and
// then discarded (projections.ts:444), and the ex-VAT/VAT split is computed
// (compute-session-cost.ts:178-195) and discarded. So the system computes the
// right answer and throws away the evidence.
//
// The consequence is not theoretical: editing a rate silently restates every
// session already priced against it, because pricing reads whatever
// `computeRule` is current AT PRICING TIME. `compute-session-cost.ts:69-70`
// declares `startedAt` and `stoppedAt` and never reads them, and
// `resolve-tariff-chain.ts` contains no reference to `validFrom`,
// `validUntil` or `effectiveFrom` at all.
//
// This module is the fix in pure form. It takes the inputs that were true at
// SESSION START, produces a snapshot that carries its own evidence, and
// refuses to settle when the inputs cannot support a defensible number.
//
// It is pure: no I/O, no clock, no ORM. Every time-dependent decision is
// driven by a timestamp passed in, so a snapshot is reproducible.

import {
  apportionAurar,
  roundAurarToIsk,
  vatOnAurar,
  type Aurar,
  type Isk,
} from "./money";
import { resolveMeterEnergy, type MeterResolution } from "./meter-energy";
import type { ProvenanceState } from "./provenance-state";

/** Where the energy figure came from. Distinct from the 7-state machine, which
 *  tracks the reconciliation LIFECYCLE; this is the source of the number. */
export type SettlementProvenance = "ocpp" | "cdr" | "manual" | "unknown";

/** Why a session could not be settled. Every one of these produces a snapshot
 *  in `billing_review_required`, never a silent number. */
export type ReviewReason =
  | "no_rate_at_session_start"
  | "meter_unresolvable"
  | "cdr_mismatch_beyond_tolerance"
  | "negative_or_impossible_energy"
  | "missing_session_times"
  | "unsupported_compute_rule"
  | "manual_hold";

export type SettlementStatus = "settled" | "billing_review_required";

/** A price component, locked. The version identifiers are what make the
 *  snapshot defensible a year later. */
export interface RateComponentInput {
  kind: "dso" | "retailer" | "cpo_addon";
  /** Which rate row priced this. Recorded so the figure can be traced back. */
  rateVersionId: string;
  /** ex-VAT, aurar per kWh. */
  pricePerKwhMinor: bigint;
  /** The window the rate row was valid for, so a later edit is visibly a
   *  different row rather than a silent restatement of this one. */
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

export interface SettlementComponent {
  kind: RateComponentInput["kind"];
  rateVersionId: string;
  pricePerKwhMinor: bigint;
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** ex-VAT, aurar. */
  amountExVatMinor: Aurar;
}

export interface SettlementInput {
  orgId: string;
  sessionId: string;
  connectorId: string;
  /** Null for an unattributed session — it still settles, it just has no
   *  driver to bill. */
  driverId: string | null;

  startedAt: Date;
  stoppedAt: Date;

  /** Meter readings. Handed to resolveMeterEnergy so the existing
   *  cumulative/per-session DETECTION and plausibility holds apply — the mode
   *  is inferred from the readings, never declared by the caller. */
  meterStartWh: number | null | undefined;
  meterStopWh: number | null | undefined;

  /** The rate rows that were in force AT startedAt. Selecting them is the
   *  caller's job (see rate-window.selectRateVersions); this module records
   *  what it was given and verifies the window covers session start. */
  components: readonly RateComponentInput[];

  vatRatePct: number;

  /** Occupancy fee already computed by plug-time.ts, in aurar. */
  plugTimeFeeMinor?: Aurar;
  plugTimeSeconds?: number | null;

  provenance: SettlementProvenance;

  /** When a CDR disagrees with the OCPP figure. Beyond tolerance the session
   *  goes to review rather than being silently restated. */
  cdrEnergyKwh?: number | null;
  cdrToleranceKwh?: number;

  /** Forced hold, e.g. an operator flagged the session. */
  manualHold?: boolean;

  /** Stamped onto the snapshot. Passed in, never read from a clock, so the
   *  same inputs always produce the same snapshot. */
  pricedAt: Date;
}

export interface SettlementSnapshot {
  orgId: string;
  sessionId: string;
  connectorId: string;
  driverId: string | null;

  startedAt: string;
  stoppedAt: string;

  energyWh: number | null;
  meterStartWh: number | null;
  meterStopWh: number | null;

  components: SettlementComponent[];
  plugTimeFeeMinor: Aurar;
  plugTimeSeconds: number | null;

  /** ex-VAT subtotal in aurar, across all components plus plug time. */
  amountExVatMinor: Aurar;
  vatRatePct: number;
  vatMinor: Aurar;
  totalIncVatMinor: Aurar;
  /** The billed figure: the ex-VAT+VAT total rounded to whole ISK. */
  totalIsk: Isk;
  currency: "ISK";

  status: SettlementStatus;
  reviewReasons: ReviewReason[];
  provenance: SettlementProvenance;
  provenanceState: ProvenanceState;

  rateSelectionPolicy: "start_rate";
  pricedAt: string;

  /** Always. A snapshot is evidence for a bill, not authority to send one. */
  billingApplicability: "requires-admin-confirmation";
  explanation: string;
}

export const DEFAULT_CDR_TOLERANCE_KWH = 0.05;

/** Milliwatt-hour scale keeps the per-kWh multiplication exact in BigInt. */
const WH_PER_KWH = 1_000n;

function iso(d: Date): string {
  return d.toISOString();
}

/**
 * Does this rate row actually cover the moment the session started?
 *
 * This is the whole point of lock-in. A component whose window does not
 * contain `startedAt` cannot price the session, however current it is now.
 */
export function coversSessionStart(component: RateComponentInput, startedAt: Date): boolean {
  const from = component.effectiveFrom.getTime();
  const until = component.effectiveUntil?.getTime() ?? Infinity;
  const at = startedAt.getTime();
  return at >= from && at < until;
}

/**
 * Build the snapshot.
 *
 * Never throws for bad data. Anything that cannot be defended becomes
 * `billing_review_required` with a named reason — a session a human must look
 * at is a better outcome than a number nobody can explain.
 */
export function buildSettlementSnapshot(input: SettlementInput): SettlementSnapshot {
  const reviewReasons: ReviewReason[] = [];

  const startMs = input.startedAt?.getTime?.();
  const stopMs = input.stoppedAt?.getTime?.();
  const timesUsable =
    Number.isFinite(startMs) && Number.isFinite(stopMs) && (stopMs as number) >= (startMs as number);
  if (!timesUsable) reviewReasons.push("missing_session_times");

  // ── energy ────────────────────────────────────────────────────────────
  // resolveMeterEnergy DETECTS the register mode; it is not told. Duration is
  // passed so it can catch energy with no time to have produced it.
  const durationSeconds = timesUsable
    ? Math.round(((stopMs as number) - (startMs as number)) / 1000)
    : null;
  const meter: MeterResolution = resolveMeterEnergy({
    reading: { meterStartWh: input.meterStartWh, meterStopWh: input.meterStopWh },
    durationSeconds,
  });
  let energyWh: number | null = meter.billable ? meter.energyWh : null;
  if (!meter.billable) {
    reviewReasons.push(
      meter.holdReason === "meter_stop_before_start" || meter.holdReason === "meter_energy_implausible"
        ? "negative_or_impossible_energy"
        : "meter_unresolvable",
    );
    energyWh = null;
  }

  // ── CDR reconciliation ────────────────────────────────────────────────
  const tolerance = input.cdrToleranceKwh ?? DEFAULT_CDR_TOLERANCE_KWH;
  if (
    input.cdrEnergyKwh !== null &&
    input.cdrEnergyKwh !== undefined &&
    Number.isFinite(input.cdrEnergyKwh) &&
    energyWh !== null
  ) {
    const ourKwh = energyWh / 1000;
    if (Math.abs(ourKwh - input.cdrEnergyKwh) > tolerance) {
      reviewReasons.push("cdr_mismatch_beyond_tolerance");
    }
  }

  // ── rate lock at session start ────────────────────────────────────────
  const usable = timesUsable
    ? input.components.filter((c) => coversSessionStart(c, input.startedAt))
    : [];
  if (input.components.length === 0 || usable.length === 0) {
    reviewReasons.push("no_rate_at_session_start");
  }

  // ── price ─────────────────────────────────────────────────────────────
  const energyWhBig = energyWh === null ? 0n : BigInt(Math.round(energyWh));
  const components: SettlementComponent[] = usable.map((c) => ({
    kind: c.kind,
    rateVersionId: c.rateVersionId,
    pricePerKwhMinor: c.pricePerKwhMinor,
    effectiveFrom: iso(c.effectiveFrom),
    effectiveUntil: c.effectiveUntil ? iso(c.effectiveUntil) : null,
    // half-up at Wh scale: (wh * price + 500) / 1000
    amountExVatMinor:
      energyWh === null
        ? 0n
        : (energyWhBig * c.pricePerKwhMinor + WH_PER_KWH / 2n) / WH_PER_KWH,
  }));

  const plugTimeFeeMinor = input.plugTimeFeeMinor ?? 0n;
  const energyExVat = components.reduce((sum, c) => sum + c.amountExVatMinor, 0n);
  const amountExVatMinor = energyExVat + plugTimeFeeMinor;

  const vatMinor = vatOnAurar(amountExVatMinor, input.vatRatePct);
  const totalIncVatMinor = amountExVatMinor + vatMinor;

  const status: SettlementStatus =
    reviewReasons.length > 0 ? "billing_review_required" : "settled";

  if (input.manualHold) reviewReasons.push("manual_hold");

  const provenanceState: ProvenanceState =
    reviewReasons.length > 0
      ? "held_manual_review"
      : input.provenance === "cdr"
        ? "cdr_confirmed"
        : input.provenance === "ocpp"
          ? "ocpp_derived"
          : "estimated";

  const finalStatus: SettlementStatus =
    input.manualHold || reviewReasons.length > 0 ? "billing_review_required" : status;

  return {
    orgId: input.orgId,
    sessionId: input.sessionId,
    connectorId: input.connectorId,
    driverId: input.driverId,
    startedAt: timesUsable ? iso(input.startedAt) : "",
    stoppedAt: timesUsable ? iso(input.stoppedAt) : "",
    energyWh,
    meterStartWh: input.meterStartWh ?? null,
    meterStopWh: input.meterStopWh ?? null,
    components,
    plugTimeFeeMinor,
    plugTimeSeconds: input.plugTimeSeconds ?? null,
    amountExVatMinor,
    vatRatePct: input.vatRatePct,
    vatMinor,
    totalIncVatMinor,
    totalIsk: roundAurarToIsk(totalIncVatMinor),
    currency: "ISK",
    status: finalStatus,
    reviewReasons,
    provenance: input.provenance,
    provenanceState,
    rateSelectionPolicy: "start_rate",
    pricedAt: iso(input.pricedAt),
    billingApplicability: "requires-admin-confirmation",
    explanation:
      finalStatus === "settled"
        ? `Settled at ${components.length} component(s) locked to the rate in force at session start.`
        : `Held for review: ${reviewReasons.join(", ")}.`,
  };
}

/**
 * Ex-VAT aurar this snapshot's energy would cost at the given prices.
 *
 * Exported so "what would this session cost under today's rate book" is
 * answerable without re-settling it — which is the question a dispute asks,
 * and the question snapshotIsImmutableUnder needs in order to mean anything.
 */
export function repriceExVat(
  snapshot: SettlementSnapshot,
  components: readonly { kind: RateComponentInput["kind"]; pricePerKwhMinor: Aurar }[],
): Aurar {
  const wh = snapshot.energyWh === null ? 0n : BigInt(Math.round(snapshot.energyWh));
  const energy = components.reduce(
    (sum, c) => sum + (wh * c.pricePerKwhMinor + WH_PER_KWH / 2n) / WH_PER_KWH,
    0n,
  );
  return energy + snapshot.plugTimeFeeMinor;
}

/**
 * Would a later rate edit change this snapshot?
 *
 * The answer must always be no, and this makes that testable rather than
 * merely asserted in a comment.
 *
 * THIS FUNCTION USED TO PROVE NOTHING. It was
 * `snapshot.components.every(c => typeof c.pricePerKwhMinor === "bigint")`,
 * with `newComponents` explicitly voided — which is true of every snapshot
 * this module can produce, so it returned true unconditionally and its test
 * passed for a reason unrelated to rate lock-in. That is worse than no check:
 * the name is quoted elsewhere as evidence the property holds.
 *
 * It now checks two things, and both use both arguments:
 *
 *   1. SELF-CONSISTENCY. The stored ex-VAT figure must be reproducible from
 *      the prices the snapshot itself carries. False here means the snapshot
 *      is storing one price and billing another.
 *
 *   2. INDEPENDENCE. If the new rate book's prices differ, re-pricing under it
 *      must produce a DIFFERENT figure. Otherwise the stored total cannot be
 *      distinguished from one computed against whatever is current — locking
 *      and coincidence would look the same.
 *
 * Skipped when there is no energy: at zero kWh every price gives zero, so (2)
 * would report a lock failure for a session that simply has nothing to price.
 */
export function snapshotIsImmutableUnder(
  snapshot: SettlementSnapshot,
  newComponents: readonly RateComponentInput[],
): boolean {
  if (repriceExVat(snapshot, snapshot.components) !== snapshot.amountExVatMinor) return false;

  if (snapshot.energyWh === null || snapshot.energyWh === 0) return true;

  const own = new Map(snapshot.components.map((c) => [c.kind, c.pricePerKwhMinor]));
  const pricesDiffer = newComponents.some((c) => own.get(c.kind) !== c.pricePerKwhMinor);
  if (!pricesDiffer) return true;

  return repriceExVat(snapshot, newComponents) !== snapshot.amountExVatMinor;
}

/** Split a settled total between bearers without losing aurar. */
export function splitBetweenBearers(
  snapshot: SettlementSnapshot,
  weights: readonly bigint[],
): Aurar[] {
  return apportionAurar(snapshot.totalIncVatMinor, weights);
}
