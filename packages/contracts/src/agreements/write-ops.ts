// The agreement write surface — the operations, enumerated from the reads.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────
//
// `apps/api/src/repositories/agreements.ts` exports three functions and all
// three read. Nothing in the codebase writes an agreement, a clause, a bearer
// rule, a driver group or a membership. So the money engine correctly refuses
// to price an org with no billable clause, and there has never been a way to
// give it one except by hand in SQL — which nobody is permitted to run.
//
// Round 3 recorded that as the single blocker between an operator and a first
// invoice. This is the surface that removes it.
//
// ── ENUMERATED FROM THE READS, NOT INVENTED ─────────────────────────────
//
// Every operation below is derived from a row interface that already exists,
// so the write surface can express exactly what the read surface can show and
// no more. The mapping is explicit in `OPERATION_PROVENANCE` at the bottom,
// asserted by a test, because "we built what was already there" is a claim
// worth being able to check.
//
// ── THE THREE RULES THAT SHAPE EVERYTHING ───────────────────────────────
//
// 1. FOCUS rule 4 — money is derived from the record and never rewritten. An
//    amendment that would change a period already priced is a REFUSAL with a
//    named reason, not an update. There is no force flag.
// 2. ADR 0054 decision 4 — dated rows are closed, never deleted. "Terminate"
//    closes an interval. Uniqueness is on the interval, which is the only
//    thing that makes move-out-then-move-in expressible.
// 3. FOCUS rule 5 — tenancy on every operation. A write whose scope does not
//    match its target is a refusal, not a silent no-op.

import type { Evidence } from "../resolution/validity";

/** Half-open interval `[from, until)`. `until: null` means open-ended. */
export interface Period {
  from: string;
  until: string | null;
}

/**
 * Does the instant fall inside the interval?
 *
 * Half-open on purpose: the boundary instant belongs to the LATER interval.
 * That is what lets a move-out at 12:00 and a move-in at 12:00 describe one
 * continuous tenancy with no overlap and no gap.
 */
export function coversInstant(p: Period, at: string): boolean {
  if (at < p.from) return false;
  if (p.until === null) return true;
  return at < p.until;
}

/** Do two half-open intervals overlap? */
export function periodsOverlap(a: Period, b: Period): boolean {
  const aEnd = a.until ?? "￿";
  const bEnd = b.until ?? "￿";
  return a.from < bEnd && b.from < aEnd;
}

// ── refusals ────────────────────────────────────────────────────────────

export type WriteRefusalReason =
  | "idempotency_key_required"
  | "cross_tenant_write"
  | "agreement_not_found"
  | "clause_not_found"
  | "group_not_found"
  | "membership_not_found"
  | "amend_would_change_settled_period"
  | "terminate_would_change_settled_period"
  | "already_terminated"
  | "period_reversed"
  | "period_overlaps_existing"
  | "clause_has_no_bearer"
  | "unknown_factor_code"
  | "unknown_bearer_type"
  | "membership_overlaps_existing"
  | "agreement_period_does_not_cover_clause";

export class WriteRefused extends Error {
  readonly reason: WriteRefusalReason;
  readonly detail: string;
  constructor(reason: WriteRefusalReason, detail: string) {
    // The message is the reason code so a log line is greppable; the detail
    // carries the human half. Neither ever contains an identifier.
    super(reason);
    this.name = "WriteRefused";
    this.reason = reason;
    this.detail = detail;
  }
}

// ── mutation receipts ───────────────────────────────────────────────────

/**
 * Every mutating operation produces one.
 *
 * A missing idempotency key is a REFUSAL, never a generated one. Generating a
 * key on the caller's behalf defeats the entire mechanism: the second call
 * gets a different key and the write happens twice. That is the failure this
 * exists to prevent, so the ergonomic convenience is deliberately unavailable.
 */
export interface MutationReceipt {
  idempotencyKey: string;
  operation: WriteOperationName;
  orgScope: string;
  /** The row this touched. */
  targetId: string;
  at: string;
  /** True when the key had already been seen and nothing new was written. */
  replayed: boolean;
}

export const WRITE_OPERATIONS = [
  "agreement.create",
  "agreement.amend",
  "agreement.terminate",
  "clause.add",
  "clause.amend",
  "clause.end",
  "driverGroup.create",
  "driverGroup.rename",
  "driverGroup.close",
  "membership.add",
  "membership.remove",
  "bearerRule.set",
  "bearerRule.change",
] as const;
export type WriteOperationName = (typeof WRITE_OPERATIONS)[number];

// ── operation inputs ────────────────────────────────────────────────────

export interface Scoped {
  /** FOCUS rule 5 — tenancy on every operation. */
  orgScope: string;
  /** Required. Absence is a refusal. */
  idempotencyKey: string;
  /** ISO instant the operation is recorded at. Passed in, never read from a clock. */
  at: string;
}

export interface AgreementCreateInput extends Scoped {
  agreementType: string;
  displayName: string;
  counterpartyOrgId: string;
  installationId: string | null;
  period: Period;
  notes?: string | null;
}

export interface AgreementAmendInput extends Scoped {
  agreementId: string;
  displayName?: string;
  notes?: string | null;
  /** Extending the end is allowed; moving it earlier over settled time is not. */
  newUntil?: string | null;
}

export interface AgreementTerminateInput extends Scoped {
  agreementId: string;
  /** The instant the interval closes. */
  until: string;
}

export interface ClauseAddInput extends Scoped {
  agreementId: string;
  factorCode: string;
  bearerType: string;
  rateRefCode: string | null;
  allocationJson?: unknown;
  /**
   * Clauses are dated. The read surface does not expose this today — see
   * SR-1 — so the fixture adapter carries it and the Drizzle adapter is
   * written against the column A adds.
   */
  period: Period;
}

export interface ClauseAmendInput extends Scoped {
  clauseId: string;
  bearerType?: string;
  rateRefCode?: string | null;
  allocationJson?: unknown;
}

export interface ClauseEndInput extends Scoped {
  clauseId: string;
  until: string;
}

export interface DriverGroupCreateInput extends Scoped {
  agreementId: string;
  displayName: string;
  ownerOrgId: string;
}

export interface DriverGroupRenameInput extends Scoped {
  groupId: string;
  displayName: string;
}

export interface DriverGroupCloseInput extends Scoped {
  groupId: string;
  until: string;
}

export interface MembershipAddInput extends Scoped {
  groupId: string;
  userId: string;
  period: Period;
}

export interface MembershipRemoveInput extends Scoped {
  membershipId: string;
  /** Closes the interval. Never deletes — ADR 0054 decision 4. */
  until: string;
}

export interface BearerRuleSetInput extends Scoped {
  agreementId: string;
  factorCode: string;
  scopeType: string | null;
  scopeId: string | null;
  audienceType: string | null;
  audienceId: string | null;
  bearerType: string;
  rateRefCode: string | null;
  period: Period;
}

export interface BearerRuleChangeInput extends Scoped {
  bearerRuleId: string;
  bearerType?: string;
  rateRefCode?: string | null;
  /** Closes the old rung and opens a new one — never an in-place rewrite. */
  supersedeFrom: string;
}

// ── what "amend" means once a period has been priced ────────────────────

/**
 * The settled-period question, answered once, here.
 *
 * A clause that priced a period which has since been settled cannot be
 * amended, because the invoice derived from it is in someone else's books.
 * The correct action is to END the clause and ADD a new one from the next
 * open instant — which is why `clause.end` and `clause.add` exist as separate
 * operations rather than being folded into `amend`.
 *
 * `SettledPeriodPort` answers "is this instant inside a period that has been
 * priced and closed?" It is a port because only the money engine knows, and
 * the money engine is Claude A's lane.
 */
export interface SettledPeriodPort {
  /**
   * The latest instant that has been settled for this org, or null when
   * nothing has.
   *
   * Ledger note 22: a port that cannot answer returns `unavailable` — it does
   * NOT return null and let the caller read that as "nothing settled". The
   * Evidence wrapper carries the difference.
   */
  settledThrough(orgScope: string): Promise<Evidence<string | null>>;
}

// Evidence has ONE definition, in resolution/validity.ts. An earlier draft
// declared it here as well and the typecheck caught the collision — which is
// the duplication this round exists to end, appearing inside the round itself.
// Re-exported rather than redeclared so a caller importing from either module
// gets the same type.
export type { Evidence } from "../resolution/validity";
export { available, unavailable } from "../resolution/validity";

// ── provenance ──────────────────────────────────────────────────────────

/**
 * Which read interface each operation was derived from.
 *
 * Asserted by a test. The claim "the write surface expresses exactly what the
 * read surface shows, and no more" is only worth making if it can be checked.
 */
export const OPERATION_PROVENANCE: Readonly<Record<WriteOperationName, string>> = {
  "agreement.create": "AgreementDetail",
  "agreement.amend": "AgreementDetail",
  "agreement.terminate": "AgreementDetail.effectiveUntil",
  "clause.add": "ClauseRow",
  "clause.amend": "ClauseRow",
  "clause.end": "ClauseRow",
  "driverGroup.create": "DriverGroupRow",
  "driverGroup.rename": "DriverGroupRow.displayName",
  "driverGroup.close": "DriverGroupRow",
  "membership.add": "MemberRow",
  "membership.remove": "MemberRow",
  "bearerRule.set": "BearerRuleRow",
  "bearerRule.change": "BearerRuleRow",
} as const;
