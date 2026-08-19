// The Drizzle-backed `BillingOperationsPort`.
//
// ── WRITTEN, AND NEVER EXECUTED ─────────────────────────────────────────
//
// Neither migration 0002 (session settlements, statements, mutation receipts,
// activity months) nor 0003 (period transitions, connector assertions) has
// been applied to any database. Every query below is typed against the real
// tables and has never run.
//
// That is deliberate and it is the whole shape of this lane: the routes are
// proven against `makeFixtureOperationsPort`, which uses the same pure state
// machine, the same feeder and the same numbering. When `0002` and `0003` are
// applied, swapping the adapter is the change — not rewriting the handlers.
//
// The one thing this file must therefore get right is the SHAPE, because
// nothing here will fail a test until a database exists. Where a decision was
// available it is spelled out rather than implied.

import { and, eq, inArray } from "drizzle-orm";
import {
  connectorAssertions,
  mutationReceipts,
  statements as statementsTable,
} from "@straumvakt/shared/db/commercial";
import type { BillingPeriodRef, FlatFeeResult } from "@straumvakt/commercial";
import { makeDrizzle } from "../drizzle";
import type { Env } from "../../bindings";
import {
  generateFlatFeeStatementFromSource,
  type RateRefInput,
} from "@straumvakt/commercial";
import {
  makeActivitySourcePort,
  type ActivityAccess,
} from "../../repositories/activity-month";
import {
  applyPeriodEventAndPersist,
  makePeriodStateReader,
  readPeriodState,
} from "./period-repository";
import type {
  BillingAccess,
  BillingOperationsPort,
  IssuedDocument,
  MutationReceipt,
  ReceiptLookup,
  StatementSummary,
} from "./operations-port";

/** Receipts expire, so a key cannot be replayed forever. Seven days matches
 *  `lib/db/raw.ts`'s IDEMPOTENCY_TTL_MS, so the two do not disagree. */
const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function makeDrizzleOperationsPort(
  env: Env,
  access: BillingAccess,
): BillingOperationsPort {
  const db = makeDrizzle(env);
  const activityAccess: ActivityAccess = { restrictToOrgIds: access.restrictToOrgIds };
  const periodAccess = { restrictToOrgIds: access.restrictToOrgIds };
  const periods = makePeriodStateReader(db, periodAccess);

  return {
    async lookupReceipt(orgId, scope, idempotencyKey, requestHash): Promise<ReceiptLookup> {
      const rows = await db
        .select({
          requestHash: mutationReceipts.requestHash,
          responseStatus: mutationReceipts.responseStatus,
          responseBody: mutationReceipts.responseBody,
        })
        .from(mutationReceipts)
        .where(
          and(
            eq(mutationReceipts.orgId, orgId),
            eq(mutationReceipts.scope, scope),
            eq(mutationReceipts.idempotencyKey, idempotencyKey),
            access.restrictToOrgIds === null
              ? undefined
              : inArray(mutationReceipts.orgId, access.restrictToOrgIds),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return { kind: "fresh" };
      const receipt: MutationReceipt = {
        orgId,
        scope,
        idempotencyKey,
        requestHash: row.requestHash,
        responseStatus: row.responseStatus,
        responseBody: row.responseBody,
      };
      // A key reused with different inputs is a caller bug, and answering with
      // the first result would hide it.
      return row.requestHash === requestHash
        ? { kind: "replay", receipt }
        : { kind: "key_reused_with_different_request", receipt };
    },

    async recordReceipt(receipt) {
      await db
        .insert(mutationReceipts)
        .values({
          orgId: receipt.orgId,
          scope: receipt.scope,
          idempotencyKey: receipt.idempotencyKey,
          requestHash: receipt.requestHash,
          responseStatus: receipt.responseStatus,
          responseBody: receipt.responseBody as object,
          expiresAt: new Date(Date.now() + RECEIPT_TTL_MS),
        })
        // The unique index (org_id, scope, idempotency_key) is the mechanism.
        // A concurrent retry collides here rather than double-executing, and
        // the winner's answer is the one that stands.
        .onConflictDoNothing();
    },

    async periodState(period) {
      return readPeriodState(db, period, periodAccess);
    },

    async applyPeriodEvent(input) {
      return applyPeriodEventAndPersist(db, input, periodAccess);
    },

    async recordActivity(period) {
      // Deliberately NOT implemented here. The aggregation lives in
      // repositories/activity-month.ts as `runActivityAggregation`, which owns
      // the raw-SQL evidence gathering and the upsert semantics. Duplicating
      // the call chain here would give the same job two entry points that can
      // disagree about what "ran" means — which is the defect delta 9.8 was.
      throw new Error("record_activity_runs_via_runActivityAggregation");
    },

    async assertConnector(input) {
      if (
        access.restrictToOrgIds !== null &&
        !access.restrictToOrgIds.includes(input.period.orgId)
      ) {
        return { kind: "refused", reason: "org_not_in_scope" };
      }
      await db
        .insert(connectorAssertions)
        .values({
          orgId: input.period.orgId,
          periodYear: input.period.year,
          periodMonth: input.period.month,
          connectorId: input.connectorId,
          assertedByUserId: input.actorUserId,
          reason: input.reason,
          evidenceNote: input.evidenceNote ?? null,
          assertedAt: input.assertedAt,
        })
        // A duplicate assertion is a no-op, not an error: the connector is
        // already vouched for and asserting twice changes nothing. The unique
        // index (org, year, month, connector) is what makes that true.
        .onConflictDoNothing();
      return { kind: "recorded" };
    },

    async price(period): Promise<FlatFeeResult> {
      const source = makeActivitySourcePort(db, activityAccess, periods);
      return generateFlatFeeStatementFromSource(source, {
        period,
        rateReferences: await loadFlatFeeRates(db, period),
      });
    },

    async listStatements(orgId): Promise<StatementSummary[]> {
      const rows = await db
        .select({
          orgId: statementsTable.orgId,
          totalIsk: statementsTable.totalIsk,
          currency: statementsTable.currency,
          statementKey: statementsTable.statementKey,
        })
        .from(statementsTable)
        .where(
          and(
            eq(statementsTable.orgId, orgId),
            access.restrictToOrgIds === null
              ? undefined
              : inArray(statementsTable.orgId, access.restrictToOrgIds),
          ),
        );
      return rows.map((r) => ({
        orgId: r.orgId,
        // The period is carried on the statement's own period row; this
        // projection is the list view and does not join it.
        period: { orgId: r.orgId, year: 0, month: 0 },
        totalIsk: String(r.totalIsk),
        currency: r.currency,
        documentNumber: r.statementKey,
        lineCount: 0,
      }));
    },

    async issueDocument(): Promise<
      { kind: "issued"; document: IssuedDocument } | { kind: "refused"; reason: string }
    > {
      // Allocation MUST be transactional with the document insert, and the
      // sequence state must be persisted in the same transaction — a number
      // persisted without a document leaves a hole in a sequence Icelandic law
      // requires to be unbroken, and there is no release operation.
      //
      // The sequence has no table yet: `0002` and `0003` create no counter.
      // Rather than invent one here, unapplied and untested, this refuses and
      // the gap is recorded in the runbook and the artifact. The fixture
      // adapter proves the SHAPE end to end today.
      return { kind: "refused", reason: "document_sequence_table_not_yet_created" };
    },

    async fetchDocument() {
      return null;
    },
  };
}

/**
 * The org's flat-fee rate references.
 *
 * A degenerate agreement — one cost factor, three rate rows. Loading it is a
 * join through `agreements` that this round did not need to build, because the
 * dry run supplies the rates directly. Left explicit rather than stubbed
 * silently: an empty list makes the feeder hold with
 * `no_rate_at_period_start`, which is the correct behaviour for an org whose
 * agreement has not been set up.
 */
async function loadFlatFeeRates(
  _db: ReturnType<typeof makeDrizzle>,
  _period: BillingPeriodRef,
): Promise<RateRefInput[]> {
  return [];
}
