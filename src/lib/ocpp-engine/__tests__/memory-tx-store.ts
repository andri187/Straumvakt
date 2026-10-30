// TEST-ONLY in-memory TransactionStore. Models the guarantees the real schema
// provides (unique receipt key, global sequence, atomic run with rollback) so
// the service logic can be exercised without a database. It proves service
// logic only; PostgreSQL enforcement is a separate, unexecuted verification.

import { mergeConnector, type ConnectorMap } from "../status";
import { TransactionIdExhausted, type EnergyQuality, type TransactionRow, type TransactionStore, type TransactionTx } from "../transactions";
import type { AuthorizationFacts, AuthorizationStore } from "../authorization";
import type { AgreementFacts } from "@/lib/costing/cost-session";

type ReceiptRec = { id: string; key: string; deviceId: string; action: string; payload: unknown; decision: unknown; response: unknown; receivedAt: Date };
type TxRec = TransactionRow & { termsSnapshot?: unknown; receiptId: string; idTag: string; authorization: unknown; startedReceivedAt: Date; stopReceiptId?: string; energyWh?: number | null; energyQuality?: EnergyQuality; stopReason?: string | null };
type Quarantined = { receiptId: string; reason: string; transactionNo: number | null; orgId: string; deviceId: string };

export type MemState = { receipts: ReceiptRec[]; txs: TxRec[]; quarantine: Quarantined[]; seq: number; statusVersion: Record<string, number>; devices: Record<string, { connectors: ConnectorMap; seq: number; installationId: string }>; readings: { txId: string; sampledAt: number; energyWh: number | null; powerW: number | null }[] };

export function memoryTxStore(opts: { facts?: (idTag: string) => AuthorizationFacts; failRead?: () => boolean; failWriteAfterReceipt?: () => boolean; maxSeq?: number; blockedDevices?: Set<string>; closedPlacements?: Set<string>; gateLog?: string[]; terms?: (userId: string) => AgreementFacts; failCapture?: () => boolean; captureLog?: string[] } = {}) {
  let state: MemState = { receipts: [], txs: [], quarantine: [], seq: 0, statusVersion: {}, devices: {}, readings: [] };
  const stats = { reads: 0, runs: 0 };
  const maxSeq = opts.maxSeq ?? 2_147_483_647;
  let uid = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++uid).padStart(12, "0")}`;

  const reader: AuthorizationStore = {
    async facts({ idTag }) {
      if (opts.failRead?.()) throw new Error("db down");
      return opts.facts ? opts.facts(idTag) : { token: null, userActive: false, hasInstallationAccess: false };
    },
  };

  const store: TransactionStore = {
    async read(fn) {
      stats.reads++;
      return fn(reader);
    },
    captureTerms: opts.terms || opts.failCapture
      ? async ({ userId }) => {
          opts.captureLog?.push(userId);
          if (opts.failCapture?.()) throw new Error("terms lookup failed");
          return opts.terms!(userId);
        }
      : undefined,
    async findReceipt(deviceId, messageId, requestHash) {
      const r = state.receipts.find((x) => x.key === `${deviceId}|${messageId}|${requestHash}`);
      return r ? { id: r.id, response: r.response ?? null } : null;
    },
    async run(fn) {
      stats.runs++;
      const snapshot = structuredClone(state);
      try {
        const tx: TransactionTx = {
          async receipt({ ctx, action, messageId, requestHash, payload, receivedAt }) {
            const key = `${ctx.deviceId}|${messageId}|${requestHash}`;
            const existing = state.receipts.find((x) => x.key === key);
            if (existing) return { id: existing.id, created: false, response: existing.response ?? null };
            const rec: ReceiptRec = { id: nextId(), key, deviceId: ctx.deviceId, action, payload, decision: null, response: null, receivedAt };
            state.receipts.push(rec);
            return { id: rec.id, created: true, response: null };
          },
          async setReceiptOutcome(receiptId, decision, response) {
            if (opts.failWriteAfterReceipt?.()) throw new Error("write failed");
            const r = state.receipts.find((x) => x.id === receiptId)!;
            r.decision = decision;
            r.response = response;
          },
          async openOnConnector(deviceId, connectorNo) {
            return state.txs.filter((t) => t.deviceId === deviceId && t.connectorNo === connectorNo && t.stoppedAt === null);
          },
          async insertTransaction(i) {
            if (state.seq >= maxSeq) throw new TransactionIdExhausted();
            const row: TxRec = {
              id: nextId(),
              transactionNo: ++state.seq,
              orgId: i.ctx.orgId,
              installationId: i.ctx.installationId,
              deviceId: i.ctx.deviceId,
              placementId: i.ctx.placementId,
              connectorNo: i.connectorNo,
              authorized: i.authorized,
              meterStartWh: i.meterStartWh,
              startedReportedAt: i.startedReportedAt,
              stoppedAt: null,
              meterStopWh: null,
              costingState: "not_needed",
              reconcileFlag: null,
              receiptId: i.receiptId,
              idTag: i.idTag,
              authorization: i.authorization,
              startedReceivedAt: i.startedReceivedAt,
              termsSnapshot: i.termsSnapshot,
            };
            state.txs.push(row);
            return row;
          },
          async byNumber(no) {
            return state.txs.find((t) => t.transactionNo === no) ?? null;
          },
          async applyStop(i) {
            const t = state.txs.find((x) => x.id === i.id)!;
            t.stoppedAt = i.stoppedReceivedAt;
            t.meterStopWh = i.meterStopWh;
            t.costingState = i.costingState;
            t.energyWh = i.energyWh;
            t.energyQuality = i.energyQuality;
            t.stopReason = i.reason;
            t.stopReceiptId = i.receiptId;
          },
          async startGate(ctx) {
            opts.gateLog?.push(`gate:${ctx.placementId}`);
            if (opts.closedPlacements?.has(ctx.placementId)) return { placementOpen: false, blocked: false };
            return { placementOpen: true, blocked: opts.blockedDevices?.has(ctx.deviceId) ?? false };
          },
          async applyStatus({ ctx, connectorNo, status, errorCode, reportedAt }) {
            if (opts.closedPlacements?.has(ctx.placementId)) return { applied: false };
            const held = state.devices[ctx.deviceId];
            const m = mergeConnector(held?.connectors ?? {}, connectorNo, { status, errorCode, reportedAt });
            if (!m.changed) return { applied: false };
            const sv = (state.statusVersion[ctx.installationId] ?? 0) + 1;
            state.statusVersion[ctx.installationId] = sv;
            state.devices[ctx.deviceId] = { connectors: m.next, seq: sv, installationId: ctx.installationId };
            return { applied: true, seq: sv };
          },
          async upsertReadings(txId, rows) {
            let n = 0;
            for (const r of rows) {
              if (state.readings.some((x) => x.txId === txId && x.sampledAt === r.sampledAt.getTime())) continue;
              state.readings.push({ txId, sampledAt: r.sampledAt.getTime(), energyWh: r.energyWh, powerW: r.powerW });
              n++;
            }
            return n;
          },
          async flag(id, flag) {
            state.txs.find((x) => x.id === id)!.reconcileFlag = flag;
          },
          async quarantine(i) {
            state.quarantine.push({ receiptId: i.receiptId, reason: i.reason, transactionNo: i.transactionNo, orgId: i.ctx.orgId, deviceId: i.ctx.deviceId });
          },
        };
        return await fn(tx);
      } catch (e) {
        state = snapshot; // atomic: nothing from a failed run survives
        throw e;
      }
    },
  };
  return { store, stats, get state() { return state; } };
}
