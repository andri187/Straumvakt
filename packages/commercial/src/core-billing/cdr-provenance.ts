// CDR provenance invariant — pure functions, no I/O.
//
// ─── The invariant ─────────────────────────────────────────────────
//
//   A ledger row may claim `verified_source = 'cdr'` only if the energy it
//   carries IS the CDR energy.
//
// Anything else is a statement to a customer that the figure was confirmed
// against the operator's authoritative record when it was not.
//
// ─── Measured on the deployed fleet, 2026-08-10 ────────────────────
//
//   verified_source  enrichment_status   rows   disagree with CDR
//   cdr              complete           1,136                   0
//   (null)           (null)               492                   0   (no CDR to compare)
//   ocpp             pending                9                   0
//   cdr              mismatch               5                   5   max delta 12.105 kWh
//
// So the overlay is right 1,136 times out of 1,141 and wrong 5 times. The
// five are not random: they are exactly the rows the sync itself flagged
// `mismatch`. `zaptec-session-sync.ts` writes only `verifiedSource` and
// `enrichmentStatus` in its update branch, so on a row the OCPP path had
// already priced, the label changes and the number does not.
//
// 12.105 kWh at a typical Icelandic AC rate is roughly 170 kr on a single
// session — small in isolation, and precisely the kind of discrepancy a
// driver notices and disputes.
//
// ─── Why `mismatch` is not a sufficient answer ─────────────────────
//
// It records that a difference existed. It does not stop the row asserting
// CDR provenance, and no downstream reader treats `mismatch` as "do not
// trust `verified_source`". A statement generator selecting
// `WHERE verified_source = 'cdr'` picks up all 1,141.

/** Where a ledger row's energy and cost actually came from. */
export type LedgerProvenance = "cdr" | "ocpp" | "amqp" | "unverified";

export type ProvenanceViolation =
  | "claims_cdr_without_cdr_energy"
  | "claims_cdr_but_energy_differs"
  | "unverified_but_has_cdr_energy";

export interface LedgerProvenanceInput {
  /** What the row currently claims. */
  verifiedSource: LedgerProvenance | null;
  /** Energy the row is billing, kWh. */
  ledgerEnergyKwh: number;
  /** Energy the CDR reported, kWh, when a CDR exists. */
  cdrEnergyKwh?: number | null;
  /** Tolerance for float/decimal noise. Default 0.001 kWh = 1 Wh. */
  toleranceKwh?: number;
}

export interface ProvenanceCheck {
  ok: boolean;
  violation: ProvenanceViolation | null;
  /** What the row is entitled to claim given its numbers. */
  entitledSource: LedgerProvenance;
  deltaKwh: number | null;
  explanation: string;
}

export const DEFAULT_PROVENANCE_TOLERANCE_KWH = 0.001;

/**
 * Check one ledger row against the provenance invariant.
 *
 * Pure. Returns the source the row is *entitled* to claim, so a caller can
 * either overlay the authoritative figure or downgrade the label — the two
 * honest resolutions. Silently keeping the label is not one of them.
 */
export function checkLedgerProvenance(
  input: LedgerProvenanceInput,
): ProvenanceCheck {
  const tol = input.toleranceKwh ?? DEFAULT_PROVENANCE_TOLERANCE_KWH;
  const cdr =
    typeof input.cdrEnergyKwh === "number" && Number.isFinite(input.cdrEnergyKwh)
      ? input.cdrEnergyKwh
      : null;
  const delta = cdr === null ? null : Math.abs(input.ledgerEnergyKwh - cdr);

  if (input.verifiedSource === "cdr") {
    if (cdr === null) {
      return {
        ok: false,
        violation: "claims_cdr_without_cdr_energy",
        entitledSource: "unverified",
        deltaKwh: null,
        explanation:
          "Row claims CDR provenance but no CDR energy exists to have confirmed it.",
      };
    }
    if (delta! > tol) {
      return {
        ok: false,
        violation: "claims_cdr_but_energy_differs",
        entitledSource: "ocpp",
        deltaKwh: delta,
        explanation:
          `Row claims CDR provenance but bills ${input.ledgerEnergyKwh} kWh against a CDR of ${cdr} kWh.`,
      };
    }
    return {
      ok: true,
      violation: null,
      entitledSource: "cdr",
      deltaKwh: delta,
      explanation: "Row bills the CDR figure and may claim CDR provenance.",
    };
  }

  // A row with a matching CDR figure but no label is under-claiming. Not
  // dangerous — it bills the right number — but it hides good provenance
  // from a statement, and it is how the 492 unlabelled rows arose.
  if ((input.verifiedSource === null || input.verifiedSource === "unverified") && cdr !== null && delta! <= tol) {
    return {
      ok: false,
      violation: "unverified_but_has_cdr_energy",
      entitledSource: "cdr",
      deltaKwh: delta,
      explanation: "Row bills the CDR figure but claims no provenance.",
    };
  }

  return {
    ok: true,
    violation: null,
    entitledSource: input.verifiedSource ?? "unverified",
    deltaKwh: delta,
    explanation: "Row makes no CDR claim.",
  };
}

/**
 * The two honest resolutions for a violating row. Returned as data so the
 * caller — a backfill script or a review queue — chooses deliberately.
 */
export type ProvenanceResolution =
  | { action: "overlay_cdr_figure"; energyKwh: number; verifiedSource: "cdr" }
  | { action: "downgrade_label"; verifiedSource: LedgerProvenance }
  | { action: "promote_label"; verifiedSource: "cdr" }
  | { action: "none" };

export function resolveProvenanceViolation(
  input: LedgerProvenanceInput,
  prefer: "authoritative_figure" | "honest_label" = "authoritative_figure",
): ProvenanceResolution {
  const check = checkLedgerProvenance(input);
  if (check.ok) return { action: "none" };

  switch (check.violation) {
    case "claims_cdr_but_energy_differs":
      return prefer === "authoritative_figure"
        ? { action: "overlay_cdr_figure", energyKwh: input.cdrEnergyKwh!, verifiedSource: "cdr" }
        : { action: "downgrade_label", verifiedSource: "ocpp" };
    case "claims_cdr_without_cdr_energy":
      return { action: "downgrade_label", verifiedSource: "unverified" };
    case "unverified_but_has_cdr_energy":
      return { action: "promote_label", verifiedSource: "cdr" };
    default:
      return { action: "none" };
  }
}
