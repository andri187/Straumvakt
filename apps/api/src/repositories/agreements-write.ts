// The Drizzle adapter for the agreement write surface.
//
// ── THIS FILE IS NEVER EXECUTED THIS ROUND ──────────────────────────────
//
// Ledger note 21: build over a port, test against a fixture, write the
// Drizzle adapter and never execute it. Round 4 generates no migration —
// `dev/market-rails` carries `0000` and `0001` only, and a migration
// generated here would be numbered `0002` and collide destructively with
// Claude A's at assembly.
//
// So this adapter is the shape the real one takes, and the parts that cannot
// compile against today's schema are given as exact SQL rather than as
// Drizzle expressions that would not typecheck. Writing a broken adapter to
// look complete would be worse than saying which columns are missing.
//
// ── WHAT IS MISSING, AND WHY ────────────────────────────────────────────
//
// Two columns this surface needs do not exist yet. Both are filed:
//
//   SR-1 — `agreements.clauses` needs an effective-dated interval. The read
//          surface (`ClauseRow`) exposes none, so a clause today is
//          existence-only and cannot express "this rate applied in June and a
//          different one from July".
//   SR-2 — `driver_group_memberships` needs the interval from ADR 0054 item
//          5, replacing the `(group, user)` unique with the temporal key.
//          `MemberRow` exposes only `addedAt`.
//
// Both are in docs/notes/2026-08-28-round-4-schema-requests.md. Neither
// blocks anything this round: the fixture adapter carries the interval and
// every rule in `AgreementWriter` is exercised against it.

import type {
  AgreementStorePort,
  StoredAgreement,
  StoredBearerRule,
  StoredClause,
  StoredGroup,
  StoredMembership,
} from "@straumvakt/contracts/agreements/writer";
import type { MutationReceipt } from "@straumvakt/contracts/agreements/write-ops";

/**
 * The tables this adapter reads and writes, and the state of each.
 *
 * Recorded as data so the gap is checkable rather than described in prose
 * that drifts.
 */
export const REQUIRED_SCHEMA = {
  agreements: { table: "agreements.agreements", status: "exists" },
  clauses: {
    table: "agreements.clauses",
    status: "needs-interval",
    schemaRequest: "SR-1",
    missing: "period tstzrange NOT NULL, with a temporal key per (agreement_id, factor_code)",
  },
  driverGroups: { table: "agreements.driver_groups", status: "exists" },
  memberships: {
    table: "agreements.driver_group_memberships",
    status: "needs-interval",
    schemaRequest: "SR-2",
    missing:
      "period tstzrange NOT NULL; drop UNIQUE (group_id, user_id); add UNIQUE (group_id, user_id, period WITHOUT OVERLAPS)",
  },
  bearerRules: { table: "agreements.bearer_rules", status: "exists" },
  mutationReceipts: {
    table: "agreements.mutation_receipts",
    status: "needs-table",
    schemaRequest: "SR-3",
    missing:
      "idempotency_key text PRIMARY KEY, operation text, org_id uuid, target_id uuid, at timestamptz, replayed boolean",
  },
} as const;

/**
 * The SQL each operation issues, as a specification.
 *
 * Given as text rather than as Drizzle builders because two of the columns do
 * not exist, so the builder form would not compile. When SR-1..SR-3 land this
 * becomes ordinary Drizzle and the strings go away.
 *
 * Every statement is parameterised — no interpolation — and every one carries
 * `org_id = $scope`, because FOCUS rule 5 says tenancy belongs in the query
 * and not only in the middleware in front of it.
 */
export const OPERATION_SQL: Readonly<Record<string, string>> = {
  "receipt.lookup": `
    SELECT idempotency_key, operation, org_id, target_id, at, true AS replayed
      FROM agreements.mutation_receipts
     WHERE idempotency_key = $1`,

  "receipt.insert": `
    INSERT INTO agreements.mutation_receipts
      (idempotency_key, operation, org_id, target_id, at, replayed)
    VALUES ($1, $2, $3, $4, $5, false)
    ON CONFLICT (idempotency_key) DO NOTHING`,

  "agreement.create": `
    INSERT INTO agreements.agreements
      (id, org_id, agreement_type, display_name, counterparty_org_id,
       installation_id, effective_from, effective_until, notes)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id`,

  "agreement.terminate": `
    UPDATE agreements.agreements
       SET effective_until = $3
     WHERE id = $1 AND org_id = $2 AND effective_until IS NULL`,

  // SR-1: period does not exist yet.
  "clause.add": `
    INSERT INTO agreements.clauses
      (id, agreement_id, org_id, factor_code, default_bearer_type,
       default_rate_ref_code, allocation_json, period)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, tstzrange($7, $8, '[)'))
    RETURNING id`,

  "clause.end": `
    UPDATE agreements.clauses
       SET period = tstzrange(lower(period), $3, '[)')
     WHERE id = $1 AND org_id = $2 AND upper_inf(period)`,

  // SR-2: the interval and the temporal key.
  "membership.add": `
    INSERT INTO agreements.driver_group_memberships
      (id, driver_group_id, org_id, user_id, period)
    VALUES (gen_random_uuid(), $1, $2, $3, tstzrange($4, $5, '[)'))
    RETURNING id`,

  "membership.remove": `
    UPDATE agreements.driver_group_memberships
       SET period = tstzrange(lower(period), $3, '[)')
     WHERE id = $1 AND org_id = $2 AND upper_inf(period)`,

  "bearerRule.set": `
    INSERT INTO agreements.bearer_rules
      (id, agreement_id, org_id, factor_code, scope_type, scope_id,
       audience_type, audience_id, bearer_type, rate_ref_code,
       effective_from, effective_until)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id`,

  "bearerRule.supersede": `
    UPDATE agreements.bearer_rules
       SET effective_until = $3
     WHERE id = $1 AND org_id = $2 AND effective_until IS NULL`,
} as const;

/**
 * The adapter, unimplemented on purpose.
 *
 * Every method throws. That is deliberate and it is safer than a
 * half-implementation: a partially working adapter invites someone to wire it
 * up and discover the missing columns at runtime, against a real database.
 *
 * When SR-1..SR-3 land, each method becomes the corresponding entry in
 * `OPERATION_SQL` executed through Drizzle, and the fixture tests in
 * `packages/contracts/src/agreements/writer.test.ts` become the contract this
 * must satisfy unchanged.
 */
export class DrizzleAgreementStore implements AgreementStorePort {
  private notYet(op: string): never {
    throw new Error(
      `DrizzleAgreementStore.${op} is not implemented: the agreement write surface is blocked on ` +
        `SR-1 (clause interval), SR-2 (membership interval) and SR-3 (mutation_receipts). ` +
        `See docs/notes/2026-08-28-round-4-schema-requests.md. Use FixtureAgreementStore until then.`,
    );
  }

  nextId(_kind: string): string {
    // Postgres generates it; the port's synchronous signature is a fixture
    // convenience and the real adapter returns the RETURNING id instead.
    return this.notYet("nextId");
  }
  receiptFor(_key: string): MutationReceipt | null {
    return this.notYet("receiptFor");
  }
  putReceipt(_r: MutationReceipt): void {
    return this.notYet("putReceipt");
  }
  getAgreement(_id: string): StoredAgreement | null {
    return this.notYet("getAgreement");
  }
  putAgreement(_a: StoredAgreement): void {
    return this.notYet("putAgreement");
  }
  getClause(_id: string): StoredClause | null {
    return this.notYet("getClause");
  }
  putClause(_c: StoredClause): void {
    return this.notYet("putClause");
  }
  clausesOf(_agreementId: string): StoredClause[] {
    return this.notYet("clausesOf");
  }
  getGroup(_id: string): StoredGroup | null {
    return this.notYet("getGroup");
  }
  putGroup(_g: StoredGroup): void {
    return this.notYet("putGroup");
  }
  getMembership(_id: string): StoredMembership | null {
    return this.notYet("getMembership");
  }
  putMembership(_m: StoredMembership): void {
    return this.notYet("putMembership");
  }
  membershipsOf(_groupId: string, _userId?: string): StoredMembership[] {
    return this.notYet("membershipsOf");
  }
  getBearerRule(_id: string): StoredBearerRule | null {
    return this.notYet("getBearerRule");
  }
  putBearerRule(_b: StoredBearerRule): void {
    return this.notYet("putBearerRule");
  }
  bearerRulesOf(_agreementId: string): StoredBearerRule[] {
    return this.notYet("bearerRulesOf");
  }
}
