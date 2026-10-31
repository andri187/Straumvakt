// Durable authorization, transaction and meter processing (Checkpoint B).
//
// One synchronous, database-backed step per financially relevant request
// (Authorize, StartTransaction, StopTransaction). Each runs as ONE database
// transaction that writes, together:
//   raw receipt (evidence)  +  authorization decision  +  wire response
//   +  the transaction row / its update.
// So a reply that depends on a transaction id is only ever sent after that id
// is durably committed with the context it was issued under, and a charger
// retransmitting the same request gets the SAME stored response.
//
// Four facts are kept apart on purpose:
//   receipt        what arrived, verbatim (bounded), when WE received it
//   decision       what authorization concluded and why
//   response       what we told the charger
//   transaction    the projected facts: sealed context, readings, energy
// An unauthorized start still creates a transaction row (authorized=false):
// if the charger delivers energy anyway, that energy is evidence of an
// exception, not something to drop and not something to price as ordinary use.
//
// Three clocks are kept apart: `receivedAt` (server), `reportedAt` (charger),
// and the physical effective time (only ever the reported register readings).
// The charger's clock never selects a tenant; ownership is the sealed context
// captured when the transaction started.

import { MAX_TRANSACTION_ID, type CallErrorCode, type IdTagInfo, type Payload } from "./protocol";
import type { AuthorizationDecision, AuthorizationStore } from "./authorization";
import { decideAuthorization } from "./authorization";
import type { ConnectionContext } from "./admission";
import type { AgreementFacts } from "@/lib/costing/cost-session";
import { buildSnapshot, type TermsSnapshot } from "@/lib/costing/terms-snapshot";

export type Outcome<R> = { kind: "reply"; payload: R } | { kind: "call_error"; code: CallErrorCode; description: string } | { kind: "unavailable" };

export type EnergyQuality = "ok" | "missing_stop" | "register_decreased" | "implausible" | "unparseable";

/** IMPLEMENTATION bound, not a protocol limit: a single AC transaction above this is held for review, not priced. */
export const MAX_PLAUSIBLE_TRANSACTION_WH = 500_000;

export function computeEnergy(meterStartWh: number | null, meterStopWh: number | null): { energyWh: number | null; quality: EnergyQuality } {
  if (meterStartWh === null || !Number.isSafeInteger(meterStartWh)) return { energyWh: null, quality: "unparseable" };
  if (meterStopWh === null) return { energyWh: null, quality: "missing_stop" };
  if (!Number.isSafeInteger(meterStopWh)) return { energyWh: null, quality: "unparseable" };
  // A register that goes backwards is a meter reset or a bad read. The raw
  // values are kept; consumption is NOT inferred from the lifetime register.
  if (meterStopWh < meterStartWh) return { energyWh: null, quality: "register_decreased" };
  const wh = meterStopWh - meterStartWh;
  if (wh > MAX_PLAUSIBLE_TRANSACTION_WH) return { energyWh: null, quality: "implausible" };
  return { energyWh: wh, quality: "ok" };
}

// ── Persistence port ─────────────────────────────────────────────────────
export type Receipt = { id: string; response: unknown | null };

export type TransactionRow = {
  id: string;
  transactionNo: number;
  orgId: string;
  installationId: string;
  deviceId: string;
  placementId: string;
  connectorNo: number;
  authorized: boolean;
  meterStartWh: number;
  startedReportedAt: Date;
  stoppedAt: Date | null;
  meterStopWh: number | null;
  costingState: "not_needed" | "needed" | "blocked_energy" | "excluded_unauthorized";
  reconcileFlag: string | null;
};

export interface TransactionTx {
  /** Insert or return the existing receipt for (device, messageId, requestHash). `created` is false on a retransmission. */
  receipt(input: { ctx: ConnectionContext; action: string; messageId: string; requestHash: string; payload: unknown; receivedAt: Date }): Promise<{ id: string; created: boolean; response: unknown | null }>;
  setReceiptOutcome(receiptId: string, decision: unknown, response: unknown, at: Date): Promise<void>;
  openOnConnector(deviceId: string, connectorNo: number): Promise<TransactionRow[]>;
  /** Allocates the next transaction number from the database sequence. Throws `TransactionIdExhausted` at the 32-bit ceiling. */
  insertTransaction(input: {
    ctx: ConnectionContext;
    receiptId: string;
    connectorNo: number;
    idTag: string;
    authorization: { status: string; reason: string; userId?: string; idTokenId?: string; decidedAt: string };
    authorized: boolean;
    meterStartWh: number;
    startedReportedAt: Date;
    startedReceivedAt: Date;
    /** The terms that applied, captured once at start (null for refused/unauthorized starts, which are never costed). */
    termsSnapshot: TermsSnapshot | null;
  }): Promise<TransactionRow>;
  byNumber(transactionNo: number): Promise<TransactionRow | null>;
  applyStop(input: {
    id: string;
    receiptId: string;
    meterStopWh: number;
    stoppedReportedAt: Date;
    stoppedReceivedAt: Date;
    reason: string | null;
    energyWh: number | null;
    energyQuality: EnergyQuality;
    costingState: TransactionRow["costingState"];
  }): Promise<void>;
  flag(id: string, flag: string): Promise<void>;
  /**
   * The ONE gate for anything that begins service: Authorize and StartTransaction.
   *
   * It must row-lock the connection's placement (FOR SHARE) BEFORE reading anything else, so that:
   *   - a removal request or a placement close (both take that row FOR UPDATE) waits for this transaction to commit,
   *     and then sees the session this transaction inserted (no start can slip past a close that counted zero);
   *   - if the close committed first, `placementOpen` is false and the start is refused (a stale admitted socket
   *     cannot start under a placement that no longer exists).
   * `blocked` = an OPEN removal/retirement request exists for the device. Stops and meter evidence are never gated.
   */
  startGate(ctx: ConnectionContext): Promise<{ placementOpen: boolean; blocked: boolean }>;
  /** Writes only a CHANGED connector state, under the installation's status lock. "unchanged" = no write, no counter bump. */
  applyStatus(input: { ctx: ConnectionContext; connectorNo: number; status: string; errorCode: string; reportedAt: Date | null; receivedAt: Date }): Promise<{ applied: false } | { applied: true; seq: number }>;
  /** Idempotent on (transaction, sampledAt): a redelivered MeterValues inserts nothing new. Returns rows actually inserted. */
  upsertReadings(transactionId: string, rows: { sampledAt: Date; energyWh: number | null; powerW: number | null; other: Record<string, unknown> }[], receivedAt: Date): Promise<number>;
  /** Evidence that could not be attached to any known transaction. Recoverable, bounded, never silently dropped. */
  quarantine(input: { ctx: ConnectionContext; receiptId: string; reason: string; transactionNo: number | null; receivedAt: Date }): Promise<void>;
}

export type TermsReader = (input: { userId: string; installationId: string; orgId: string; at: Date }) => Promise<AgreementFacts>;
export interface TransactionStore {
  /** Optional compatible-meter fast path. False means no effects: use the existing per-event handler. */
  tryIngestMeters?(items: import("./meter").MeterRequest[]): Promise<boolean>;
  /** Authorization and terms use ONE coherent read snapshot. Missing capture is explicitly held, never read separately. */
  read<T>(fn: (store: AuthorizationStore, captureTerms?: TermsReader) => Promise<T>): Promise<T>;
  run<T>(fn: (tx: TransactionTx) => Promise<T>): Promise<T>;
  /** Replay lookup outside the write transaction: cheap, avoids a redundant authorization query on retransmits. */
  findReceipt(deviceId: string, messageId: string, requestHash: string): Promise<Receipt | null>;
}

/**
 * `reconcile_flag` value set on an older OPEN transaction when the charger starts a new one on the same connector.
 * It means only "the charger itself moved on"; it is NOT evidence that energy stopped, it never closes the row, and
 * it is never settled automatically. The lifecycle treats it as non-gating but unconfirmed (see lifecycle/plan.ts).
 */
export const SUPERSEDED_FLAG = "superseded_by_new_start";

export class TransactionIdExhausted extends Error {
  constructor() {
    super("ocpp transaction id space exhausted");
  }
}

const decisionRecord = (d: Extract<AuthorizationDecision, { kind: "decided" }>, at: Date) => ({
  status: d.status,
  reason: d.reason,
  ...(d.userId ? { userId: d.userId } : {}),
  ...(d.idTokenId ? { idTokenId: d.idTokenId } : {}),
  decidedAt: at.toISOString(),
});

/** Why a start/authorize is refused although the driver may be entitled: the SERVICE is not available at this placement. */
export type ServiceRefusal = "service_blocked_removal" | "placement_closed";
function refusalFor(gate: { placementOpen: boolean; blocked: boolean }): ServiceRefusal | null {
  if (!gate.placementOpen) return "placement_closed"; // checked first: a closed placement cannot also be "being removed"
  if (gate.blocked) return "service_blocked_removal";
  return null;
}

type Env = { store: TransactionStore; now: () => Date };
type Req<A> = { ctx: ConnectionContext; messageId: string; requestHash: string; payload: A; receivedAt: Date };

/** Authorize: evidence + decision + response in one commit. Never creates a transaction. */
export async function handleAuthorize(env: Env, r: Req<Payload<"Authorize">>): Promise<Outcome<{ idTagInfo: IdTagInfo }>> {
  try {
    const replay = await env.store.findReceipt(r.ctx.deviceId, r.messageId, r.requestHash);
    if (replay?.response) return { kind: "reply", payload: replay.response as { idTagInfo: IdTagInfo } };

    const decision = await env.store.read((a) => decideAuthorization(a, { idTag: r.payload.idTag, installationId: r.ctx.installationId, at: r.receivedAt }));
    // No decision, no reply that pretends to be one. The charger gets an error and may retry.
    if (decision.kind === "unavailable") return { kind: "unavailable" };

    return await env.store.run(async (tx) => {
      const rec = await tx.receipt({ ctx: r.ctx, action: "Authorize", messageId: r.messageId, requestHash: r.requestHash, payload: r.payload, receivedAt: r.receivedAt });
      if (!rec.created && rec.response) return { kind: "reply", payload: rec.response as { idTagInfo: IdTagInfo } } as const;
      // A charger being removed/retired accepts no new use, whoever the driver is. Decided in the SAME transaction as the receipt.
      const gate = await tx.startGate(r.ctx);
      const refusal = refusalFor(gate);
      const status = refusal ? "Blocked" : decision.status;
      const response = { idTagInfo: { status } };
      await tx.setReceiptOutcome(rec.id, refusal ? { ...decisionRecord(decision, r.receivedAt), status, reason: refusal } : decisionRecord(decision, r.receivedAt), response, r.receivedAt);
      return { kind: "reply", payload: response } as const;
    });
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * StartTransaction. The transaction id is allocated by the database sequence
 * (global, monotonic, 1..2^31-1, no cycle) and committed with the sealed
 * context BEFORE the reply is built. The id doubles as the lookup key for
 * every later StopTransaction / MeterValues on this device.
 */
export async function handleStartTransaction(env: Env, r: Req<Payload<"StartTransaction">>): Promise<Outcome<{ transactionId: number; idTagInfo: IdTagInfo }>> {
  try {
    const replay = await env.store.findReceipt(r.ctx.deviceId, r.messageId, r.requestHash);
    if (replay?.response) return { kind: "reply", payload: replay.response as { transactionId: number; idTagInfo: IdTagInfo } };

    // One read snapshot covers token/access, membership, agreement, rules and rates. The later placement-locked write
    // remains READ COMMITTED: it must see removal/closure committed while waiting for the placement lock.
    const { decision, termsSnapshot } = await env.store.read(async (a, captureTerms) => {
      const decision = await decideAuthorization(a, { idTag: r.payload.idTag, installationId: r.ctx.installationId, at: r.receivedAt });
      let termsSnapshot: TermsSnapshot | null = null;
      if (decision.kind === "decided" && decision.status === "Accepted" && decision.userId) {
        try {
          const facts = captureTerms ? await captureTerms({ userId: decision.userId, installationId: r.ctx.installationId, orgId: r.ctx.orgId, at: r.receivedAt }) : null;
          termsSnapshot = await buildSnapshot({ facts, at: r.receivedAt, capturedAt: env.now(), missingReason: "capture_not_available" });
        } catch {
          termsSnapshot = await buildSnapshot({ facts: null, at: r.receivedAt, capturedAt: env.now(), missingReason: "capture_failed" });
        }
      }
      return { decision, termsSnapshot };
    });
    if (decision.kind === "unavailable") return { kind: "unavailable" };

    return await env.store.run(async (tx) => {
      const rec = await tx.receipt({ ctx: r.ctx, action: "StartTransaction", messageId: r.messageId, requestHash: r.requestHash, payload: r.payload, receivedAt: r.receivedAt });
      if (!rec.created && rec.response) return { kind: "reply", payload: rec.response as { transactionId: number; idTagInfo: IdTagInfo } } as const;

      // A new start on a connector that still has an open transaction means the
      // earlier stop never arrived. Do not guess which one the world meant:
      // keep both, and flag the older for reconciliation. It is never closed here.
      // Removal/retirement in progress: refuse, but still record the transaction as unauthorized evidence (never dropped, never costed).
      const gate = await tx.startGate(r.ctx);
      const refusal = refusalFor(gate);
      const finalStatus = refusal ? "Blocked" : decision.status;
      const authorized = finalStatus === "Accepted";
      const authRecord = refusal ? { ...decisionRecord(decision, r.receivedAt), status: finalStatus, reason: refusal } : decisionRecord(decision, r.receivedAt);

      // A refused start is only evidence of an attempted transaction. It cannot
      // establish that an already-running session has been superseded, especially
      // while removal is trying to stop that session.
      if (authorized) {
        const open = await tx.openOnConnector(r.ctx.deviceId, r.payload.connectorId);
        for (const o of open) await tx.flag(o.id, SUPERSEDED_FLAG);
      }

      const row = await tx.insertTransaction({
        ctx: r.ctx,
        receiptId: rec.id,
        connectorNo: r.payload.connectorId,
        idTag: r.payload.idTag,
        authorization: authRecord,
        authorized,
        meterStartWh: r.payload.meterStart,
        startedReportedAt: new Date(r.payload.timestamp),
        startedReceivedAt: r.receivedAt,
        termsSnapshot: authorized ? termsSnapshot : null,
      });
      if (row.transactionNo < 1 || row.transactionNo > MAX_TRANSACTION_ID) throw new TransactionIdExhausted();

      // A refused start still gets an id: the charger needs one to report any
      // energy it delivers anyway (OCPP 1.6 6.x), and that energy is evidence.
      const response = { transactionId: row.transactionNo, idTagInfo: { status: finalStatus } };
      await tx.setReceiptOutcome(rec.id, authRecord, response, r.receivedAt);
      return { kind: "reply", payload: response } as const;
    });
  } catch {
    // Includes exhaustion: the charger gets an error rather than a duplicated or wrapped id.
    return { kind: "unavailable" };
  }
}

/**
 * StopTransaction. Resolves by transaction number, then requires the SAME
 * permanent device as the connection (a transaction id from another charger is
 * not honoured). The row is updated under its sealed context, so a late stop
 * after the device moved CPO still lands in the original tenant's record.
 */
export async function handleStopTransaction(env: Env, r: Req<Payload<"StopTransaction">>): Promise<Outcome<{ idTagInfo?: IdTagInfo }>> {
  try {
    const replay = await env.store.findReceipt(r.ctx.deviceId, r.messageId, r.requestHash);
    if (replay?.response) return { kind: "reply", payload: replay.response as { idTagInfo?: IdTagInfo } };

    return await env.store.run(async (tx) => {
      const rec = await tx.receipt({ ctx: r.ctx, action: "StopTransaction", messageId: r.messageId, requestHash: r.requestHash, payload: r.payload, receivedAt: r.receivedAt });
      if (!rec.created && rec.response) return { kind: "reply", payload: rec.response as { idTagInfo?: IdTagInfo } } as const;

      const response: { idTagInfo?: IdTagInfo } = {};
      const row = await tx.byNumber(r.payload.transactionId);

      if (!row || row.deviceId !== r.ctx.deviceId) {
        // Unknown id, or an id belonging to a different device. The charger is
        // answered normally (retrying forever helps nobody) but the evidence is
        // kept for reconciliation; it is never logged-and-discarded.
        await tx.quarantine({ ctx: r.ctx, receiptId: rec.id, reason: row ? "stop_for_other_device" : "stop_unknown_transaction", transactionNo: r.payload.transactionId, receivedAt: r.receivedAt });
        await tx.setReceiptOutcome(rec.id, { disposition: "quarantined", reason: row ? "stop_for_other_device" : "stop_unknown_transaction" }, response, r.receivedAt);
        return { kind: "reply", payload: response } as const;
      }

      if (row.stoppedAt !== null) {
        // A second, different stop: first writer wins, the conflict is flagged.
        if (row.meterStopWh !== r.payload.meterStop) await tx.flag(row.id, "conflicting_stop");
        await tx.setReceiptOutcome(rec.id, { disposition: "duplicate_stop", conflicting: row.meterStopWh !== r.payload.meterStop }, response, r.receivedAt);
        return { kind: "reply", payload: response } as const;
      }

      const e = computeEnergy(row.meterStartWh, r.payload.meterStop);
      const costingState: TransactionRow["costingState"] = !row.authorized ? "excluded_unauthorized" : e.energyWh === null ? "blocked_energy" : "needed";
      await tx.applyStop({
        id: row.id,
        receiptId: rec.id,
        meterStopWh: r.payload.meterStop,
        stoppedReportedAt: new Date(r.payload.timestamp),
        stoppedReceivedAt: r.receivedAt,
        reason: r.payload.reason ?? null,
        energyWh: e.energyWh,
        energyQuality: e.quality,
        costingState,
      });
      await tx.setReceiptOutcome(rec.id, { disposition: "stopped", energyQuality: e.quality, costingState }, response, r.receivedAt);
      return { kind: "reply", payload: response } as const;
    });
  } catch {
    return { kind: "unavailable" };
  }
}
