// Drizzle implementation of TransactionStore (Checkpoint B).
//
// Each `run` is ONE interactive database transaction (Neon WebSocket pool, see
// installations/db.ts). The receipt insert relies on the unique key
// (device_id, message_id, request_hash): a retransmission conflicts, and the
// stored response is returned instead of a second decision being made.
//
// Postgres sequences are not transactional: a rolled-back StartTransaction
// leaves a GAP in transaction numbers. That is acceptable (ids are unique and
// monotonic, not dense) and is the price of never reusing one.

import { and, eq, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { deviceOperationalState, installations, lifecycleRequests, placements } from "@straumvakt/shared/db/assets";
import { ocppTransactionReadings, ocppTransactions } from "@straumvakt/shared/db/charging";
import { protocolReceipts, quarantinedEvents } from "@straumvakt/shared/db/protocol";
import type { Db, Executor } from "@/lib/installations/db";
import { loadAgreementFacts } from "@/lib/costing/drizzle-costing-store";
import { drizzleAuthorizationStore } from "./drizzle-admission-store";
import { mergeConnector, type ConnectorMap } from "./status";
import { TransactionIdExhausted, type TransactionRow, type TransactionStore, type TransactionTx } from "./transactions";

const upperInf = (period: unknown): SQL => sql`upper_inf(${period})`;

const toRow = (r: typeof ocppTransactions.$inferSelect): TransactionRow => ({
  id: r.id,
  transactionNo: r.transactionNo,
  orgId: r.orgId,
  installationId: r.installationId,
  deviceId: r.deviceId,
  placementId: r.placementId,
  connectorNo: r.connectorNo,
  authorized: r.authorized,
  meterStartWh: r.meterStartWh,
  startedReportedAt: r.startedReportedAt,
  stoppedAt: r.stoppedReceivedAt,
  meterStopWh: r.meterStopWh,
  costingState: r.costingState as TransactionRow["costingState"],
  reconcileFlag: r.reconcileFlag,
});

function txPort(x: Executor): TransactionTx {
  return {
    async receipt({ ctx, action, messageId, requestHash, payload, receivedAt }) {
      const inserted = await x
        .insert(protocolReceipts)
        .values({
          orgId: ctx.orgId,
          installationId: ctx.installationId,
          deviceId: ctx.deviceId,
          placementId: ctx.placementId,
          identityString: ctx.identityString,
          action,
          messageId,
          requestHash,
          payload: payload as Record<string, unknown>,
          receivedAt,
        })
        .onConflictDoNothing()
        .returning({ id: protocolReceipts.id });
      if (inserted[0]) return { id: inserted[0].id, created: true, response: null };
      const [existing] = await x
        .select({ id: protocolReceipts.id, response: protocolReceipts.response })
        .from(protocolReceipts)
        .where(and(eq(protocolReceipts.deviceId, ctx.deviceId), eq(protocolReceipts.messageId, messageId), eq(protocolReceipts.requestHash, requestHash)))
        .limit(1);
      return { id: existing!.id, created: false, response: existing!.response ?? null };
    },

    async setReceiptOutcome(receiptId, decision, response, at) {
      await x.update(protocolReceipts).set({ decision: decision as Record<string, unknown>, response: response as Record<string, unknown>, respondedAt: at }).where(eq(protocolReceipts.id, receiptId));
    },

    async openOnConnector(deviceId, connectorNo) {
      const rows = await x
        .select()
        .from(ocppTransactions)
        .where(and(eq(ocppTransactions.deviceId, deviceId), eq(ocppTransactions.connectorNo, connectorNo), isNull(ocppTransactions.stoppedReceivedAt)));
      return rows.map(toRow);
    },

    async insertTransaction(i) {
      try {
        const [row] = await x
          .insert(ocppTransactions)
          .values({
            orgId: i.ctx.orgId,
            installationId: i.ctx.installationId,
            deviceId: i.ctx.deviceId,
            placementId: i.ctx.placementId,
            identityString: i.ctx.identityString,
            connectorNo: i.connectorNo,
            idTag: i.idTag,
            authorization: i.authorization,
            authorized: i.authorized,
            userId: i.authorization.userId ?? null,
            idTokenId: i.authorization.idTokenId ?? null,
            meterStartWh: i.meterStartWh,
            startedReportedAt: i.startedReportedAt,
            startedReceivedAt: i.startedReceivedAt,
            startReceiptId: i.receiptId,
            termsSnapshot: i.termsSnapshot,
          })
          .returning();
        return toRow(row!);
      } catch (e) {
        // 2200H: sequence_generator_limit_exceeded — the 32-bit namespace is spent.
        if ((e as { code?: string }).code === "2200H") throw new TransactionIdExhausted();
        throw e;
      }
    },

    async byNumber(transactionNo) {
      const [row] = await x.select().from(ocppTransactions).where(eq(ocppTransactions.transactionNo, transactionNo)).limit(1);
      return row ? toRow(row) : null;
    },

    async applyStop(i) {
      await x
        .update(ocppTransactions)
        .set({
          meterStopWh: i.meterStopWh,
          stoppedReportedAt: i.stoppedReportedAt,
          stoppedReceivedAt: i.stoppedReceivedAt,
          stopReason: i.reason,
          energyWh: i.energyWh,
          energyQuality: i.energyQuality,
          costingState: i.costingState,
          stopReceiptId: i.receiptId,
        })
        // The guard makes a racing second stop a no-op rather than an overwrite.
        .where(and(eq(ocppTransactions.id, i.id), isNull(ocppTransactions.stoppedReceivedAt)));
    },

    async startGate(ctx) {
      // FOR SHARE on the placement row FIRST. Removal request and close take this row FOR UPDATE, so they queue behind us
      // (and then see our session), or have already committed (and we see a closed placement). Lock order: placement only;
      // this path never takes the installation lock, so it cannot deadlock with status writes or closes (installation -> placement).
      const [open] = await x
        .select({ id: placements.id })
        .from(placements)
        .where(and(eq(placements.id, ctx.placementId), eq(placements.deviceId, ctx.deviceId), upperInf(placements.period)))
        .for("share");
      if (!open) return { placementOpen: false, blocked: false };
      // Read AFTER the lock (READ COMMITTED: a later statement sees a request that committed while we waited).
      const [r] = await x
        .select({ id: lifecycleRequests.id })
        .from(lifecycleRequests)
        .where(and(eq(lifecycleRequests.deviceId, ctx.deviceId), notInArray(lifecycleRequests.state, ["completed", "cancelled"])))
        .limit(1);
      return { placementOpen: true, blocked: !!r };
    },

    async flag(id, flag) {
      await x.update(ocppTransactions).set({ reconcileFlag: flag }).where(eq(ocppTransactions.id, id));
    },

    async applyStatus({ ctx, connectorNo, status, errorCode, reportedAt, receivedAt }) {
      // Lock the installation row FIRST. Every status writer in the installation queues here, so the
      // read-merge-write below is serial and the counter's order equals commit order.
      const [inst] = await x.select({ sv: installations.statusVersion }).from(installations).where(eq(installations.id, ctx.installationId)).for("update").limit(1);
      if (!inst) return { applied: false }; // an installation that no longer exists has no operational view
      // Closure takes this same installation lock before changing placement.
      // Check only after acquiring it, so a close committed while we waited is visible.
      const [live] = await x.select({ id: placements.id }).from(placements).where(and(eq(placements.id, ctx.placementId), eq(placements.deviceId, ctx.deviceId), upperInf(placements.period))).limit(1);
      if (!live) return { applied: false };
      const [row] = await x.select({ connectors: deviceOperationalState.connectors }).from(deviceOperationalState).where(eq(deviceOperationalState.deviceId, ctx.deviceId)).limit(1);
      const m = mergeConnector((row?.connectors ?? {}) as ConnectorMap, connectorNo, { status, errorCode, reportedAt });
      if (!m.changed) return { applied: false };
      const seq = inst.sv + 1;
      await x.update(installations).set({ statusVersion: seq }).where(eq(installations.id, ctx.installationId));
      await x
        .insert(deviceOperationalState)
        .values({ deviceId: ctx.deviceId, orgId: ctx.orgId, installationId: ctx.installationId, placementId: ctx.placementId, connectors: m.next, lastReportedAt: reportedAt, lastReceivedAt: receivedAt, seq })
        .onConflictDoUpdate({
          target: deviceOperationalState.deviceId,
          set: { orgId: ctx.orgId, installationId: ctx.installationId, placementId: ctx.placementId, connectors: m.next, lastReportedAt: reportedAt, lastReceivedAt: receivedAt, seq },
        });
      return { applied: true, seq };
    },

    async upsertReadings(transactionId, rows, receivedAt) {
      if (rows.length === 0) return 0;
      const inserted = await x
        .insert(ocppTransactionReadings)
        .values(rows.map((r) => ({ transactionId, sampledAt: r.sampledAt, energyWh: r.energyWh, powerW: r.powerW, other: r.other, receivedAt })))
        .onConflictDoNothing()
        .returning({ t: ocppTransactionReadings.transactionId });
      return inserted.length;
    },

    async quarantine({ ctx, receiptId, reason, transactionNo, receivedAt }) {
      await x.insert(quarantinedEvents).values({ orgId: ctx.orgId, installationId: ctx.installationId, deviceId: ctx.deviceId, receiptId, reason, transactionNo, receivedAt });
    },
  };
}

export function drizzleTransactionStore(db: Db): TransactionStore {
  return {
    read: (fn) => fn(drizzleAuthorizationStore(db)),
    captureTerms: (i) => loadAgreementFacts(db, i),
    run: (fn) => db.transaction((tx) => fn(txPort(tx))),
    async findReceipt(deviceId, messageId, requestHash) {
      const [r] = await db
        .select({ id: protocolReceipts.id, response: protocolReceipts.response })
        .from(protocolReceipts)
        .where(and(eq(protocolReceipts.deviceId, deviceId), eq(protocolReceipts.messageId, messageId), eq(protocolReceipts.requestHash, requestHash)))
        .limit(1);
      return r ? { id: r.id, response: r.response ?? null } : null;
    },
  };
}
