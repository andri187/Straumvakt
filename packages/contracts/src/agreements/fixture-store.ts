// In-memory adapter for the agreement store port.
//
// Ledger note 21: build over a port, test against a fixture, write the Drizzle
// adapter and never execute it. This is the fixture half. It is deliberately
// dumb — every rule lives in the writer, so a test that passes here is a test
// of the rule and not of the adapter.

import type { MutationReceipt, Period } from "./write-ops";
import { available, unavailable } from "./write-ops";
import type { Evidence, SettledPeriodPort } from "./write-ops";
import type {
  AgreementStorePort,
  StoredAgreement,
  StoredBearerRule,
  StoredClause,
  StoredGroup,
  StoredMembership,
} from "./writer";

export class FixtureAgreementStore implements AgreementStorePort {
  private seq = 0;
  private receipts = new Map<string, MutationReceipt>();
  agreements = new Map<string, StoredAgreement>();
  clauses = new Map<string, StoredClause>();
  groups = new Map<string, StoredGroup>();
  memberships = new Map<string, StoredMembership>();
  bearerRules = new Map<string, StoredBearerRule>();

  nextId(kind: string): string {
    this.seq += 1;
    return `${kind}-${this.seq}`;
  }

  receiptFor(key: string): MutationReceipt | null {
    return this.receipts.get(key) ?? null;
  }
  putReceipt(r: MutationReceipt): void {
    this.receipts.set(r.idempotencyKey, r);
  }
  /** Every receipt written, for tests that assert one per mutating call. */
  allReceipts(): MutationReceipt[] {
    return [...this.receipts.values()];
  }

  getAgreement(id: string) {
    return this.agreements.get(id) ?? null;
  }
  putAgreement(a: StoredAgreement) {
    this.agreements.set(a.id, a);
  }

  getClause(id: string) {
    return this.clauses.get(id) ?? null;
  }
  putClause(c: StoredClause) {
    this.clauses.set(c.id, c);
  }
  clausesOf(agreementId: string) {
    return [...this.clauses.values()].filter((c) => c.agreementId === agreementId);
  }

  getGroup(id: string) {
    return this.groups.get(id) ?? null;
  }
  putGroup(g: StoredGroup) {
    this.groups.set(g.id, g);
  }

  getMembership(id: string) {
    return this.memberships.get(id) ?? null;
  }
  putMembership(m: StoredMembership) {
    this.memberships.set(m.id, m);
  }
  membershipsOf(groupId: string, userId?: string) {
    return [...this.memberships.values()].filter(
      (m) => m.groupId === groupId && (userId === undefined || m.userId === userId),
    );
  }

  getBearerRule(id: string) {
    return this.bearerRules.get(id) ?? null;
  }
  putBearerRule(b: StoredBearerRule) {
    this.bearerRules.set(b.id, b);
  }
  bearerRulesOf(agreementId: string) {
    return [...this.bearerRules.values()].filter((b) => b.agreementId === agreementId);
  }
}

/** A settled-period port that answers from a fixed watermark. */
export class FixtureSettledPeriod implements SettledPeriodPort {
  constructor(private readonly watermark: string | null) {}
  async settledThrough(): Promise<Evidence<string | null>> {
    return available(this.watermark);
  }
}

/**
 * A settled-period port that cannot answer.
 *
 * Exists so the "unavailable is not permission" rule is testable. A writer
 * that treats this as "nothing settled" will amend a settled period.
 */
export class UnavailableSettledPeriod implements SettledPeriodPort {
  constructor(private readonly reason = "watermark query failed") {}
  async settledThrough(): Promise<Evidence<string | null>> {
    return unavailable(this.reason);
  }
}

/** Convenience for tests. */
export const period = (from: string, until: string | null = null): Period => ({ from, until });
