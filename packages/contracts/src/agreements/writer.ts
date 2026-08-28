// The agreement writer — thirteen operations over a port.
//
// Pure domain logic. No database, no clock, no network. The store is a port;
// the fixture adapter is in `fixture-store.ts` and the Drizzle adapter lives
// in apps/api and is never executed this round.
//
// ── THE SHAPE OF EVERY OPERATION ────────────────────────────────────────
//
//   1. idempotency key present, or refuse
//   2. replay? return the receipt, write nothing
//   3. tenancy, or refuse
//   4. target exists, or refuse
//   5. would this touch settled money? refuse with a named reason
//   6. interval sane and non-overlapping, or refuse
//   7. write, and emit a receipt
//
// Step 5 is the one that matters and the one that is easy to skip. See
// `assertNotSettled`.

import type {
  AgreementAmendInput,
  AgreementCreateInput,
  AgreementTerminateInput,
  BearerRuleChangeInput,
  BearerRuleSetInput,
  ClauseAddInput,
  ClauseAmendInput,
  ClauseEndInput,
  DriverGroupCloseInput,
  DriverGroupCreateInput,
  DriverGroupRenameInput,
  MembershipAddInput,
  MembershipRemoveInput,
  MutationReceipt,
  Period,
  Scoped,
  SettledPeriodPort,
  WriteOperationName,
} from "./write-ops";
import { WriteRefused, periodsOverlap } from "./write-ops";

// ── the store port ──────────────────────────────────────────────────────

export interface StoredAgreement {
  id: string;
  orgScope: string;
  agreementType: string;
  displayName: string;
  counterpartyOrgId: string;
  installationId: string | null;
  period: Period;
  notes: string | null;
}

export interface StoredClause {
  id: string;
  agreementId: string;
  orgScope: string;
  factorCode: string;
  bearerType: string;
  rateRefCode: string | null;
  allocationJson: unknown;
  period: Period;
}

export interface StoredGroup {
  id: string;
  agreementId: string;
  orgScope: string;
  displayName: string;
  ownerOrgId: string;
  period: Period;
}

export interface StoredMembership {
  id: string;
  groupId: string;
  orgScope: string;
  userId: string;
  period: Period;
}

export interface StoredBearerRule {
  id: string;
  agreementId: string;
  orgScope: string;
  factorCode: string;
  scopeType: string | null;
  scopeId: string | null;
  audienceType: string | null;
  audienceId: string | null;
  bearerType: string;
  rateRefCode: string | null;
  period: Period;
}

export interface AgreementStorePort {
  nextId(kind: string): string;
  receiptFor(key: string): MutationReceipt | null;
  putReceipt(r: MutationReceipt): void;

  getAgreement(id: string): StoredAgreement | null;
  putAgreement(a: StoredAgreement): void;

  getClause(id: string): StoredClause | null;
  putClause(c: StoredClause): void;
  clausesOf(agreementId: string): StoredClause[];

  getGroup(id: string): StoredGroup | null;
  putGroup(g: StoredGroup): void;

  getMembership(id: string): StoredMembership | null;
  putMembership(m: StoredMembership): void;
  membershipsOf(groupId: string, userId?: string): StoredMembership[];

  getBearerRule(id: string): StoredBearerRule | null;
  putBearerRule(b: StoredBearerRule): void;
  bearerRulesOf(agreementId: string): StoredBearerRule[];
}

// ── known vocabularies ──────────────────────────────────────────────────
//
// Deliberately narrow. The bearer ladder is not redesigned here — these are
// the rungs `BearerRuleRow` already reads, and the write surface must express
// every one of them and no more.

export const KNOWN_BEARER_TYPES = ["org", "user", "driver_group", "third_party"] as const;

export interface WriterDeps {
  store: AgreementStorePort;
  settled: SettledPeriodPort;
  /** Factor codes the commercial module recognises. Injected — not hardcoded here. */
  knownFactorCodes: readonly string[];
}

export interface WriteResult<T> {
  value: T;
  receipt: MutationReceipt;
}

export class AgreementWriter {
  constructor(private readonly deps: WriterDeps) {}

  // ── shared preamble ───────────────────────────────────────────────────

  private begin(
    input: Scoped,
    operation: WriteOperationName,
  ): { replayed: MutationReceipt } | null {
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      // Never generated. See MutationReceipt's docblock.
      throw new WriteRefused(
        "idempotency_key_required",
        `${operation} requires an idempotency key; one is never generated for you`,
      );
    }
    const prior = this.deps.store.receiptFor(input.idempotencyKey);
    if (prior) return { replayed: { ...prior, replayed: true } };
    return null;
  }

  private receipt(
    input: Scoped,
    operation: WriteOperationName,
    targetId: string,
  ): MutationReceipt {
    const r: MutationReceipt = {
      idempotencyKey: input.idempotencyKey,
      operation,
      orgScope: input.orgScope,
      targetId,
      at: input.at,
      replayed: false,
    };
    this.deps.store.putReceipt(r);
    return r;
  }

  private assertTenant(scope: string, rowScope: string, what: string): void {
    if (scope !== rowScope) {
      throw new WriteRefused("cross_tenant_write", `${what} belongs to another tenant`);
    }
  }

  private assertPeriodSane(p: Period): void {
    if (p.until !== null && p.until <= p.from) {
      throw new WriteRefused("period_reversed", "period ends at or before it starts");
    }
  }

  /**
   * The settled-money guard.
   *
   * FOCUS rule 4: money is derived from the record and never rewritten. If the
   * instant being changed is at or before the settled watermark, the change
   * would alter a period whose invoice is already in someone else's books.
   *
   * `unavailable` is NOT treated as "nothing settled". A watermark that cannot
   * be read is a reason to refuse, not a licence to proceed — ledger note 22
   * applied to a write path, where the cost of being wrong is an amended
   * invoice.
   */
  private async assertNotSettled(
    orgScope: string,
    instant: string,
    reason: "amend_would_change_settled_period" | "terminate_would_change_settled_period",
  ): Promise<void> {
    const ev = await this.deps.settled.settledThrough(orgScope);
    if (ev.status === "unavailable") {
      throw new WriteRefused(
        reason,
        `cannot confirm the settled watermark (${ev.reason}); refusing rather than risking a settled period`,
      );
    }
    const watermark = ev.value;
    if (watermark !== null && instant <= watermark) {
      throw new WriteRefused(
        reason,
        `instant falls at or before the settled watermark; end the row and add a new one from the next open instant`,
      );
    }
  }

  // ── agreement ─────────────────────────────────────────────────────────

  async createAgreement(input: AgreementCreateInput): Promise<WriteResult<StoredAgreement>> {
    const replay = this.begin(input, "agreement.create");
    if (replay) {
      const existing = this.deps.store.getAgreement(replay.replayed.targetId)!;
      return { value: existing, receipt: replay.replayed };
    }
    this.assertPeriodSane(input.period);
    const id = this.deps.store.nextId("agreement");
    const row: StoredAgreement = {
      id,
      orgScope: input.orgScope,
      agreementType: input.agreementType,
      displayName: input.displayName,
      counterpartyOrgId: input.counterpartyOrgId,
      installationId: input.installationId,
      period: input.period,
      notes: input.notes ?? null,
    };
    this.deps.store.putAgreement(row);
    return { value: row, receipt: this.receipt(input, "agreement.create", id) };
  }

  async amendAgreement(input: AgreementAmendInput): Promise<WriteResult<StoredAgreement>> {
    const replay = this.begin(input, "agreement.amend");
    const row = this.deps.store.getAgreement(input.agreementId);
    if (!row) throw new WriteRefused("agreement_not_found", "no such agreement");
    this.assertTenant(input.orgScope, row.orgScope, "agreement");
    if (replay) return { value: row, receipt: replay.replayed };

    if (input.newUntil !== undefined) {
      const moving = input.newUntil;
      // Shortening over settled time is the dangerous direction.
      if (moving !== null) await this.assertNotSettled(input.orgScope, moving, "amend_would_change_settled_period");
      const next: Period = { from: row.period.from, until: moving };
      this.assertPeriodSane(next);
      row.period = next;
    }
    if (input.displayName !== undefined) row.displayName = input.displayName;
    if (input.notes !== undefined) row.notes = input.notes;
    this.deps.store.putAgreement(row);
    return { value: row, receipt: this.receipt(input, "agreement.amend", row.id) };
  }

  async terminateAgreement(
    input: AgreementTerminateInput,
  ): Promise<WriteResult<StoredAgreement>> {
    const replay = this.begin(input, "agreement.terminate");
    const row = this.deps.store.getAgreement(input.agreementId);
    if (!row) throw new WriteRefused("agreement_not_found", "no such agreement");
    this.assertTenant(input.orgScope, row.orgScope, "agreement");
    if (replay) return { value: row, receipt: replay.replayed };
    if (row.period.until !== null) {
      throw new WriteRefused("already_terminated", "agreement interval is already closed");
    }
    await this.assertNotSettled(input.orgScope, input.until, "terminate_would_change_settled_period");
    row.period = { from: row.period.from, until: input.until };
    this.assertPeriodSane(row.period);
    this.deps.store.putAgreement(row);
    return { value: row, receipt: this.receipt(input, "agreement.terminate", row.id) };
  }

  // ── clause ────────────────────────────────────────────────────────────

  async addClause(input: ClauseAddInput): Promise<WriteResult<StoredClause>> {
    const replay = this.begin(input, "clause.add");
    const agreement = this.deps.store.getAgreement(input.agreementId);
    if (!agreement) throw new WriteRefused("agreement_not_found", "no such agreement");
    this.assertTenant(input.orgScope, agreement.orgScope, "agreement");
    if (replay) {
      return { value: this.deps.store.getClause(replay.replayed.targetId)!, receipt: replay.replayed };
    }
    this.assertPeriodSane(input.period);
    if (!this.deps.knownFactorCodes.includes(input.factorCode)) {
      throw new WriteRefused("unknown_factor_code", "factor code is not one the engine recognises");
    }
    if (!input.bearerType || input.bearerType.trim() === "") {
      // A clause with no bearer prices nothing and nobody owes it.
      throw new WriteRefused("clause_has_no_bearer", "a clause must name who bears the cost");
    }
    if (!(KNOWN_BEARER_TYPES as readonly string[]).includes(input.bearerType)) {
      throw new WriteRefused("unknown_bearer_type", "bearer type is not a rung of the ladder");
    }
    // A clause cannot price time the agreement does not cover.
    if (
      input.period.from < agreement.period.from ||
      (agreement.period.until !== null &&
        (input.period.until === null || input.period.until > agreement.period.until))
    ) {
      throw new WriteRefused(
        "agreement_period_does_not_cover_clause",
        "clause interval extends beyond the agreement interval",
      );
    }
    // Two clauses for one factor cannot overlap — the engine would not know
    // which rate applied.
    for (const c of this.deps.store.clausesOf(input.agreementId)) {
      if (c.factorCode === input.factorCode && periodsOverlap(c.period, input.period)) {
        throw new WriteRefused(
          "period_overlaps_existing",
          "another clause for this factor already covers part of that interval",
        );
      }
    }
    const id = this.deps.store.nextId("clause");
    const row: StoredClause = {
      id,
      agreementId: input.agreementId,
      orgScope: input.orgScope,
      factorCode: input.factorCode,
      bearerType: input.bearerType,
      rateRefCode: input.rateRefCode,
      allocationJson: input.allocationJson ?? null,
      period: input.period,
    };
    this.deps.store.putClause(row);
    return { value: row, receipt: this.receipt(input, "clause.add", id) };
  }

  async amendClause(input: ClauseAmendInput): Promise<WriteResult<StoredClause>> {
    const replay = this.begin(input, "clause.amend");
    const row = this.deps.store.getClause(input.clauseId);
    if (!row) throw new WriteRefused("clause_not_found", "no such clause");
    this.assertTenant(input.orgScope, row.orgScope, "clause");
    if (replay) return { value: row, receipt: replay.replayed };

    // THE rule. Amending a clause changes what a period cost. If any part of
    // the clause's interval has been settled, the amendment is refused and the
    // caller is told to end-and-add instead.
    await this.assertNotSettled(input.orgScope, row.period.from, "amend_would_change_settled_period");

    if (input.bearerType !== undefined) {
      if (!(KNOWN_BEARER_TYPES as readonly string[]).includes(input.bearerType)) {
        throw new WriteRefused("unknown_bearer_type", "bearer type is not a rung of the ladder");
      }
      row.bearerType = input.bearerType;
    }
    if (input.rateRefCode !== undefined) row.rateRefCode = input.rateRefCode;
    if (input.allocationJson !== undefined) row.allocationJson = input.allocationJson;
    this.deps.store.putClause(row);
    return { value: row, receipt: this.receipt(input, "clause.amend", row.id) };
  }

  async endClause(input: ClauseEndInput): Promise<WriteResult<StoredClause>> {
    const replay = this.begin(input, "clause.end");
    const row = this.deps.store.getClause(input.clauseId);
    if (!row) throw new WriteRefused("clause_not_found", "no such clause");
    this.assertTenant(input.orgScope, row.orgScope, "clause");
    if (replay) return { value: row, receipt: replay.replayed };
    if (row.period.until !== null) {
      throw new WriteRefused("already_terminated", "clause interval is already closed");
    }
    await this.assertNotSettled(input.orgScope, input.until, "terminate_would_change_settled_period");
    row.period = { from: row.period.from, until: input.until };
    this.assertPeriodSane(row.period);
    this.deps.store.putClause(row);
    return { value: row, receipt: this.receipt(input, "clause.end", row.id) };
  }

  // ── driver group ──────────────────────────────────────────────────────

  async createGroup(input: DriverGroupCreateInput): Promise<WriteResult<StoredGroup>> {
    const replay = this.begin(input, "driverGroup.create");
    const agreement = this.deps.store.getAgreement(input.agreementId);
    if (!agreement) throw new WriteRefused("agreement_not_found", "no such agreement");
    this.assertTenant(input.orgScope, agreement.orgScope, "agreement");
    if (replay) {
      return { value: this.deps.store.getGroup(replay.replayed.targetId)!, receipt: replay.replayed };
    }
    const id = this.deps.store.nextId("group");
    const row: StoredGroup = {
      id,
      agreementId: input.agreementId,
      orgScope: input.orgScope,
      displayName: input.displayName,
      ownerOrgId: input.ownerOrgId,
      period: { from: agreement.period.from, until: null },
    };
    this.deps.store.putGroup(row);
    return { value: row, receipt: this.receipt(input, "driverGroup.create", id) };
  }

  async renameGroup(input: DriverGroupRenameInput): Promise<WriteResult<StoredGroup>> {
    const replay = this.begin(input, "driverGroup.rename");
    const row = this.deps.store.getGroup(input.groupId);
    if (!row) throw new WriteRefused("group_not_found", "no such group");
    this.assertTenant(input.orgScope, row.orgScope, "group");
    if (replay) return { value: row, receipt: replay.replayed };
    // A rename changes a label, never an amount — no settled check.
    row.displayName = input.displayName;
    this.deps.store.putGroup(row);
    return { value: row, receipt: this.receipt(input, "driverGroup.rename", row.id) };
  }

  async closeGroup(input: DriverGroupCloseInput): Promise<WriteResult<StoredGroup>> {
    const replay = this.begin(input, "driverGroup.close");
    const row = this.deps.store.getGroup(input.groupId);
    if (!row) throw new WriteRefused("group_not_found", "no such group");
    this.assertTenant(input.orgScope, row.orgScope, "group");
    if (replay) return { value: row, receipt: replay.replayed };
    if (row.period.until !== null) {
      throw new WriteRefused("already_terminated", "group interval is already closed");
    }
    await this.assertNotSettled(input.orgScope, input.until, "terminate_would_change_settled_period");
    row.period = { from: row.period.from, until: input.until };
    this.assertPeriodSane(row.period);
    this.deps.store.putGroup(row);
    return { value: row, receipt: this.receipt(input, "driverGroup.close", row.id) };
  }

  // ── membership ────────────────────────────────────────────────────────
  //
  // The default idTag is an ORDINARY member here. There is no branch naming
  // it, no nullable userId, and no special case — it is a token registered as
  // a user, put in a group, and the clause's bearer is `org`. Grep this file
  // for "idTag" and you will find nothing, which is the proof.

  async addMembership(input: MembershipAddInput): Promise<WriteResult<StoredMembership>> {
    const replay = this.begin(input, "membership.add");
    const group = this.deps.store.getGroup(input.groupId);
    if (!group) throw new WriteRefused("group_not_found", "no such group");
    this.assertTenant(input.orgScope, group.orgScope, "group");
    if (replay) {
      return {
        value: this.deps.store.getMembership(replay.replayed.targetId)!,
        receipt: replay.replayed,
      };
    }
    this.assertPeriodSane(input.period);
    // Uniqueness is on the INTERVAL, not on (group, user) — which is exactly
    // what makes move-out then move-in expressible. ADR 0054 decision 4.
    for (const m of this.deps.store.membershipsOf(input.groupId, input.userId)) {
      if (periodsOverlap(m.period, input.period)) {
        throw new WriteRefused(
          "membership_overlaps_existing",
          "this user already has a membership overlapping that interval",
        );
      }
    }
    const id = this.deps.store.nextId("membership");
    const row: StoredMembership = {
      id,
      groupId: input.groupId,
      orgScope: input.orgScope,
      userId: input.userId,
      period: input.period,
    };
    this.deps.store.putMembership(row);
    return { value: row, receipt: this.receipt(input, "membership.add", id) };
  }

  async removeMembership(input: MembershipRemoveInput): Promise<WriteResult<StoredMembership>> {
    const replay = this.begin(input, "membership.remove");
    const row = this.deps.store.getMembership(input.membershipId);
    if (!row) throw new WriteRefused("membership_not_found", "no such membership");
    this.assertTenant(input.orgScope, row.orgScope, "membership");
    if (replay) return { value: row, receipt: replay.replayed };
    if (row.period.until !== null) {
      throw new WriteRefused("already_terminated", "membership interval is already closed");
    }
    // Closing, never deleting. The closed row is what a later dispute reads.
    row.period = { from: row.period.from, until: input.until };
    this.assertPeriodSane(row.period);
    this.deps.store.putMembership(row);
    return { value: row, receipt: this.receipt(input, "membership.remove", row.id) };
  }

  // ── bearer rules ──────────────────────────────────────────────────────

  async setBearerRule(input: BearerRuleSetInput): Promise<WriteResult<StoredBearerRule>> {
    const replay = this.begin(input, "bearerRule.set");
    const agreement = this.deps.store.getAgreement(input.agreementId);
    if (!agreement) throw new WriteRefused("agreement_not_found", "no such agreement");
    this.assertTenant(input.orgScope, agreement.orgScope, "agreement");
    if (replay) {
      return {
        value: this.deps.store.getBearerRule(replay.replayed.targetId)!,
        receipt: replay.replayed,
      };
    }
    this.assertPeriodSane(input.period);
    if (!(KNOWN_BEARER_TYPES as readonly string[]).includes(input.bearerType)) {
      throw new WriteRefused("unknown_bearer_type", "bearer type is not a rung of the ladder");
    }
    const id = this.deps.store.nextId("bearerRule");
    const row: StoredBearerRule = {
      id,
      agreementId: input.agreementId,
      orgScope: input.orgScope,
      factorCode: input.factorCode,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      audienceType: input.audienceType,
      audienceId: input.audienceId,
      bearerType: input.bearerType,
      rateRefCode: input.rateRefCode,
      period: input.period,
    };
    this.deps.store.putBearerRule(row);
    return { value: row, receipt: this.receipt(input, "bearerRule.set", id) };
  }

  /**
   * Change a rung by superseding it — close the old, open the new.
   *
   * Never an in-place rewrite, because a bearer rule that priced a period is
   * evidence of who owed what, and rewriting it changes history.
   */
  async changeBearerRule(input: BearerRuleChangeInput): Promise<WriteResult<StoredBearerRule>> {
    const replay = this.begin(input, "bearerRule.change");
    const old = this.deps.store.getBearerRule(input.bearerRuleId);
    if (!old) throw new WriteRefused("clause_not_found", "no such bearer rule");
    this.assertTenant(input.orgScope, old.orgScope, "bearer rule");
    if (replay) {
      return {
        value: this.deps.store.getBearerRule(replay.replayed.targetId)!,
        receipt: replay.replayed,
      };
    }
    await this.assertNotSettled(
      input.orgScope,
      input.supersedeFrom,
      "amend_would_change_settled_period",
    );
    if (input.bearerType !== undefined && !(KNOWN_BEARER_TYPES as readonly string[]).includes(input.bearerType)) {
      throw new WriteRefused("unknown_bearer_type", "bearer type is not a rung of the ladder");
    }
    old.period = { from: old.period.from, until: input.supersedeFrom };
    this.assertPeriodSane(old.period);
    this.deps.store.putBearerRule(old);

    const id = this.deps.store.nextId("bearerRule");
    const next: StoredBearerRule = {
      ...old,
      id,
      bearerType: input.bearerType ?? old.bearerType,
      rateRefCode: input.rateRefCode !== undefined ? input.rateRefCode : old.rateRefCode,
      period: { from: input.supersedeFrom, until: null },
    };
    this.deps.store.putBearerRule(next);
    return { value: next, receipt: this.receipt(input, "bearerRule.change", id) };
  }
}
