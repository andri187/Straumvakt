// Drizzle implementation of the costing store. Session identity for billing
// lines is `charging.ocpp_transactions.id` (one authoritative identity per OCPP
// transaction, written into `agreements.billing_lines.session_id`); it is a
// fresh UUID namespace, so it cannot collide with legacy `charging.sessions` ids.
//
// The legacy station/EVSE chain is NOT consulted. The asset path comes from the
// transaction's SEALED placement (circuit + site), and the agreements are looked
// up on the SEALED installation and organisation at the session's start time.

import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { circuits, placements } from "@straumvakt/shared/db/assets";
import { agreementClauses, agreements, agreementsBillingLines, agreementsCostFactors, bearerRules, driverGroupMemberships, driverGroups, rateReferences } from "@straumvakt/shared/db/commercial";
import { ocppTransactions } from "@straumvakt/shared/db/charging";
import { allocationSchema, type ClauseInput, type RateRefInput, type RuleInput } from "@straumvakt/commercial/agreement/types";
import type { Db, Executor } from "@/lib/installations/db";
import type { AgreementFacts, CostingTxFacts } from "./cost-session";
import { MAX_COSTING_ATTEMPTS, type CostingStore, type CostingTxPort } from "./service";

const toFacts = (r: typeof ocppTransactions.$inferSelect): CostingTxFacts => ({
  id: r.id, orgId: r.orgId, installationId: r.installationId, deviceId: r.deviceId, placementId: r.placementId,
  authorized: r.authorized, userId: r.userId, energyWh: r.energyWh, energyQuality: r.energyQuality,
  startedReportedAt: r.startedReportedAt, stoppedReportedAt: r.stoppedReportedAt, startedReceivedAt: r.startedReceivedAt, stoppedReceivedAt: r.stoppedReceivedAt, terms: r.termsSnapshot,
});

/**
 * Reads the terms applicable at `at`. Called ONCE, at StartTransaction, to build the immutable snapshot (terms-snapshot.ts);
 * costing never calls it. The newest installation agreement wins (id tiebreak); workplace agreements for the org are included.
 */
export async function loadAgreementFacts(x: Executor, { userId, installationId, orgId, at }: { userId: string; installationId: string; orgId: string; at: Date }): Promise<AgreementFacts> {
  const atTs = at.toISOString();
  const window = (a: typeof agreements) => and(eq(a.status, "active"), lte(a.effectiveFrom, at), or(isNull(a.effectiveUntil), gt(a.effectiveUntil, at)));

  // Newest staged installation agreement wins; id is the stable tiebreak (resolver determinism, GAP-1).
  const [inst] = await x
    .select({ id: agreements.id })
    .from(agreements)
    .where(and(eq(agreements.agreementType, "installation"), eq(agreements.installationId, installationId), window(agreements)))
    .orderBy(desc(agreements.effectiveFrom), asc(agreements.id))
    .limit(1);

  const memberOf = (agreementIds: string[]) =>
    x
      .select({ groupId: driverGroups.id, ownerOrgId: driverGroups.ownerOrgId, agreementId: driverGroups.agreementId })
      .from(driverGroupMemberships)
      .innerJoin(driverGroups, eq(driverGroups.id, driverGroupMemberships.driverGroupId))
      .where(and(eq(driverGroupMemberships.userId, userId), inArray(driverGroups.agreementId, agreementIds), sql`${driverGroupMemberships.period} @> ${atTs}::timestamptz`))
      .limit(1);

  const workplace = await x
    .select({ id: agreements.id })
    .from(agreements)
    .where(and(eq(agreements.agreementType, "workplace"), eq(agreements.cpoOrgId, orgId), window(agreements)));

  const ids = [...(inst ? [inst.id] : []), ...workplace.map((w) => w.id)];
  const [group] = ids.length ? await memberOf(ids) : [];
  if (!inst && !group) return { installationAgreementId: null, driverGroup: null, clauses: [], rules: [], rateReferences: [] };

  const clauseRows = ids.length
    ? await x
        .select({ c: agreementClauses, code: agreementsCostFactors.code })
        .from(agreementClauses)
        .innerJoin(agreementsCostFactors, eq(agreementsCostFactors.id, agreementClauses.costFactorId))
        .where(and(inArray(agreementClauses.agreementId, ids), sql`${agreementClauses.period} @> ${atTs}::timestamptz`))
    : [];
  const clauses: ClauseInput[] = clauseRows.map(({ c, code }) => ({
    costFactorId: c.costFactorId, costFactorCode: code, defaultBearerType: c.defaultBearerType as ClauseInput["defaultBearerType"],
    defaultBearerRef: c.defaultBearerRef, defaultRateRefCode: c.defaultRateRefCode, allocation: allocationSchema.parse(c.allocationJson),
  }));
  const ruleRows = ids.length ? await x.select().from(bearerRules).where(inArray(bearerRules.agreementId, ids)) : [];
  const rules: RuleInput[] = ruleRows.map((r) => ({
    id: r.id, costFactorId: r.costFactorId, scopeType: r.scopeType, scopeId: r.scopeId, audienceType: r.audienceType, audienceId: r.audienceId,
    bearerType: r.bearerType as RuleInput["bearerType"], bearerRef: r.bearerRef, rateRefCode: r.rateRefCode,
    allocation: r.allocationJson ? allocationSchema.parse(r.allocationJson) : null, effectiveFrom: r.effectiveFrom, effectiveUntil: r.effectiveUntil,
  }));
  const codes = [...new Set([...clauses.map((c) => c.defaultRateRefCode), ...rules.map((r) => r.rateRefCode)].filter((s): s is string => s !== null))];
  const rrRows = codes.length ? await x.select().from(rateReferences).where(inArray(rateReferences.code, codes)) : [];
  const refs: RateRefInput[] = rrRows.map((r) => ({
    id: r.id, code: r.code, costFactorId: r.costFactorId, basis: r.basis, priceMinor: r.priceMinor, vatRatePct: Number(r.vatRatePct),
    currency: r.currency, supplierOrgId: r.supplierOrgId, effectiveFrom: r.effectiveFrom, effectiveUntil: r.effectiveUntil,
  }));
  return { installationAgreementId: inst?.id ?? null, driverGroup: group ? { id: group.groupId, ownerOrgId: group.ownerOrgId } : null, clauses, rules, rateReferences: refs };
}

function port(x: Executor): CostingTxPort {
  return {
    async claimOne(onlyId) {
      // FOR UPDATE SKIP LOCKED: a row another consumer holds is skipped, never waited for or doubled.
      const [row] = await x
        .select()
        .from(ocppTransactions)
        .where(and(eq(ocppTransactions.costingState, "needed"), onlyId ? eq(ocppTransactions.id, onlyId) : undefined))
        .orderBy(asc(ocppTransactions.startedReceivedAt))
        .limit(1)
        .for("update", { skipLocked: true });
      return row ? { tx: toFacts(row), attempts: row.costingAttempts } : null;
    },

    async placement(placementId) {
      const [p] = await x.select({ circuitId: placements.circuitId, siteId: placements.siteId, installationId: placements.installationId }).from(placements).where(eq(placements.id, placementId));
      if (!p) return null;
      let siteId = p.siteId;
      if (!siteId && p.circuitId) {
        const [c] = await x.select({ siteId: circuits.siteId }).from(circuits).where(eq(circuits.id, p.circuitId));
        siteId = c?.siteId ?? null;
      }
      return { circuitId: p.circuitId, siteId };
    },

    async linesExist(sessionId) {
      const [r] = await x.select({ id: agreementsBillingLines.id }).from(agreementsBillingLines).where(and(eq(agreementsBillingLines.sessionId, sessionId), eq(agreementsBillingLines.billableEventType, "session"))).limit(1);
      return !!r;
    },

    async writeLines({ sessionId, agreementId, workplaceOrgId, lines }) {
      await x.insert(agreementsBillingLines).values(
        lines.map((l) => ({
          agreementId, billableEventType: "session", sessionId, factorCode: l.factorCode, kind: l.kind, basisType: l.basisType,
          basisQuantity: String(l.basisQuantity), unitPriceMinor: l.unitPriceMinor, amountExVatMinor: l.amountExVatMinor,
          vatRatePct: String(l.vatRatePct), vatAmountMinor: l.vatAmountMinor, amountIncVatMinor: l.amountIncVatMinor, currency: l.currency,
          // The resolver's authoring shorthand "wrk" means "the workplace ORG pays": translate at the storage boundary (as the legacy writer did).
          bearerType: l.bearerType === "wrk" ? ("org" as const) : l.bearerType,
          bearerRef: l.bearerType === "wrk" ? workplaceOrgId : l.bearerRef,
          recipientOrgId: l.recipientOrgId, recipientUserId: l.recipientUserId, rateRefId: l.rateRefId, ruleId: l.ruleId, computationDetail: l.computationDetail,
        })),
      );
    },

    async mark(id, state, detail, at) {
      await x
        .update(ocppTransactions)
        .set({ costingState: state, costingDetail: detail, costedAt: at })
        // The guard keeps a stale writer from overwriting a row that is no longer `needed`.
        .where(and(eq(ocppTransactions.id, id), eq(ocppTransactions.costingState, "needed")));
    },
  };
}

export function drizzleCostingStore(db: Db): CostingStore {
  return {
    run: (fn) => db.transaction((tx) => fn(port(tx))),
    async recordFailure(id, message, at) {
      await db
        .update(ocppTransactions)
        .set({
          costingAttempts: sql`${ocppTransactions.costingAttempts} + 1`,
          costingDetail: { lastError: message.slice(0, 200), at: at.toISOString() },
          // At the bound, park it: an explicit state, never an endless retry.
          costingState: sql`CASE WHEN ${ocppTransactions.costingAttempts} + 1 >= ${MAX_COSTING_ATTEMPTS} THEN 'unresolved_context' ELSE ${ocppTransactions.costingState} END`,
          costedAt: sql`CASE WHEN ${ocppTransactions.costingAttempts} + 1 >= ${MAX_COSTING_ATTEMPTS} THEN ${at.toISOString()}::timestamptz ELSE ${ocppTransactions.costedAt} END`,
        })
        .where(and(eq(ocppTransactions.id, id), eq(ocppTransactions.costingState, "needed")));
    },
  };
}
