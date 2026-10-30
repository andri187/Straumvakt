// S1 explainable test costs from a completed OCPP transaction.
//
// NO new money engine. This file only (1) decides whether a transaction CAN be
// costed from facts that already exist, (2) calls the retained pure resolver
// (`@straumvakt/commercial` resolveBillingLines / resolveFactor) unchanged, and
// (3) reports an explicit outcome. S1 scope: explainable test costs and payer
// attribution; no invoice, collection or commercial release.
//
// The rule that matters most: UNKNOWN IS NEVER ZERO. The resolver returns an
// empty list when a factor has no rate ("nothing to bill"), which is
// indistinguishable on a statement from a free session. Here a missing rate,
// missing access, missing energy or an unusable duration each yields a NAMED
// unresolved state and writes no line, so the transaction stays visible as
// work to do. Unauthorized energy is never costed as ordinary use.

import { resolveBillingLines, resolveFactor } from "@straumvakt/commercial/agreement/resolve";
import type { BillingLineDraft, ClauseInput, RateRefInput, RuleInput, SessionContext } from "@straumvakt/commercial/agreement/types";

export type CostingState = "costed" | "blocked_energy" | "excluded_unauthorized" | "unresolved_access" | "unresolved_rates" | "unresolved_context";

export type CostingTxFacts = {
  id: string;
  orgId: string; // SEALED at start: the CPO that owned the device then, not now
  installationId: string; // SEALED
  deviceId: string;
  placementId: string; // SEALED
  authorized: boolean;
  userId: string | null;
  energyWh: number | null;
  energyQuality: string | null;
  startedReportedAt: Date;
  stoppedReportedAt: Date | null;
  startedReceivedAt: Date;
  stoppedReceivedAt: Date | null;
  /** The terms snapshot captured at start (raw JSON). Costing reads ONLY this, never the mutable term tables. */
  terms: unknown | null;
};

export type AgreementFacts = {
  installationAgreementId: string | null;
  driverGroup: { id: string; ownerOrgId: string } | null;
  clauses: ClauseInput[];
  rules: RuleInput[];
  rateReferences: RateRefInput[];
};

export type PlacementFacts = { circuitId: string | null; siteId: string | null };

export type CostingOutcome =
  | { state: "costed"; agreementId: string; lines: BillingLineDraft[]; workplaceOrgId: string | null; detail: Record<string, unknown> }
  | { state: Exclude<CostingState, "costed">; detail: Record<string, unknown> };

/** A charger clock far from the server's is not evidence of a duration. */
const MAX_PLAUSIBLE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function usableDuration(tx: CostingTxFacts): { ms: number; source: "charger_clock" | "server_clock" } | null {
  const pairs: [Date | null, Date, "charger_clock" | "server_clock"][] = [
    [tx.stoppedReportedAt, tx.startedReportedAt, "charger_clock"],
    [tx.stoppedReceivedAt, tx.startedReceivedAt, "server_clock"],
  ];
  for (const [stop, start, source] of pairs) {
    if (!stop) continue;
    const ms = stop.getTime() - start.getTime();
    if (ms > 0 && ms <= MAX_PLAUSIBLE_SESSION_MS) return { ms, source };
  }
  return null;
}

export function decideCosting(tx: CostingTxFacts, placement: PlacementFacts | null, agr: AgreementFacts | null): CostingOutcome {
  if (!tx.authorized) return { state: "excluded_unauthorized", detail: { reason: "unauthorized_energy_is_evidence_not_billable_use" } };
  if (tx.energyWh === null || tx.energyQuality !== "ok") return { state: "blocked_energy", detail: { reason: "energy_unresolved", quality: tx.energyQuality } };
  if (!tx.userId) return { state: "unresolved_access", detail: { reason: "no_driver" } };
  if (!placement) return { state: "unresolved_context", detail: { reason: "placement_not_found", placementId: tx.placementId } };
  const dur = usableDuration(tx);
  if (!dur) return { state: "unresolved_context", detail: { reason: "duration_unusable" } };
  if (!agr || !agr.installationAgreementId) return { state: "unresolved_access", detail: { reason: "no_installation_agreement" } };
  if (!agr.driverGroup) return { state: "unresolved_access", detail: { reason: "no_membership" } };
  if (agr.clauses.length === 0) return { state: "unresolved_rates", detail: { reason: "agreement_has_no_clauses" } };

  const durationMinutes = dur.ms / 60_000;
  const ctx: SessionContext = {
    agreementId: agr.installationAgreementId,
    cpoOrgId: tx.orgId,
    user: { id: tx.userId },
    driverGroup: agr.driverGroup,
    chargerId: tx.deviceId,
    circuitId: placement.circuitId,
    installationId: tx.installationId,
    siteId: placement.siteId ?? "",
    startedAt: tx.startedReceivedAt, // server time; the agreement/rate in force is judged on OUR clock, never the charger's
    endedAt: new Date(tx.startedReceivedAt.getTime() + dur.ms),
    energyKwh: tx.energyWh / 1000,
    durationMinutes,
    durationDays: dur.ms / 86_400_000,
    clauses: agr.clauses,
    rules: agr.rules,
    rateReferences: agr.rateReferences,
  };

  // The resolver emits NOTHING for a factor with no rate. Surface that explicitly.
  const missing = agr.clauses.filter((c) => resolveFactor(ctx, c).rateRef === null).map((c) => c.costFactorCode);
  if (missing.length > 0) return { state: "unresolved_rates", detail: { reason: "rate_missing_for_factor", factors: missing } };

  const lines = resolveBillingLines(ctx);
  if (lines.length === 0) return { state: "unresolved_rates", detail: { reason: "resolver_produced_no_lines" } };

  const total = lines.reduce((s, l) => s + l.amountExVatMinor, 0n);
  return {
    state: "costed",
    agreementId: agr.installationAgreementId,
    lines,
    workplaceOrgId: agr.driverGroup.ownerOrgId,
    detail: { lineCount: lines.length, totalExVatMinor: total.toString(), currency: lines[0]!.currency, durationSource: dur.source, energyKwh: ctx.energyKwh, explainable: true },
  };
}
