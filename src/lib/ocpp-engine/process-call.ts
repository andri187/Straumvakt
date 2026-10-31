// The one generic path from an OCPP Call to a wire answer (Checkpoints A+B).
//
//   connection context (already admitted)  +  Call{messageId, action, payload}
//     -> validate payload against the action's schema
//     -> dispatch to the durable handler
//     -> a CallResult payload, or a CALLERROR code
//
// Nothing here knows about a manufacturer. Vendor integrations may enrich the
// context later; they do not get a different path. The caller (the gateway DO
// via a service binding) maps `unavailable` to a CALLERROR InternalError so a
// charger is never told something the backend could not durably record.

import type { ConnectionContext } from "./admission";
import { handleMeterValues } from "./meter";
import { canonicalJson, sha256Hex } from "./canonical";
import { handleStatus } from "./status";
import { bootResponse, isExercised, rejectionForUnknownAction, validatePayload, type CallErrorCode } from "./protocol";
import { handleAuthorize, handleStartTransaction, handleStopTransaction, type TransactionStore } from "./transactions";

export type CallAnswer =
  | { kind: "result"; payload: Record<string, unknown> }
  | { kind: "error"; code: CallErrorCode; description: string };

export type CallInput = { ctx: ConnectionContext; messageId: string; action: string; payload: unknown; receivedAt: Date };

export type EngineEnv = {
  store: TransactionStore;
  /** Called AFTER a changed status commits (never inside the transaction). Failure must not affect the reply. */
  onStatusCommitted?: (installationId: string, seq: number) => Promise<void>;
  /** BootNotification heartbeat interval, seconds. Product setting, not a protocol constant. */
  heartbeatIntervalSeconds: number;
  now: () => Date;
};

export { canonicalJson };

const unavailable: CallAnswer = { kind: "error", code: "InternalError", description: "backend unavailable; retry" };

export async function processCall(env: EngineEnv, call: CallInput): Promise<CallAnswer> {
  if (!isExercised(call.action)) {
    const r = rejectionForUnknownAction(call.action);
    return { kind: "error", code: r.code, description: r.description };
  }
  const v = validatePayload(call.action, call.payload);
  if (!v.ok) return { kind: "error", code: v.error.code, description: v.error.description };

  const base = { ctx: call.ctx, messageId: call.messageId, receivedAt: call.receivedAt };
  const requestHash = await sha256Hex(`${call.action}:${canonicalJson(call.payload)}`);

  switch (call.action) {
    case "BootNotification": {
      // Store only equipment details, not SIM identifiers or arbitrary payloads.
      // An observation never changes ownership, physical identity or access.
      const p = v.value as { chargePointVendor: string; chargePointModel: string; chargePointSerialNumber?: string; chargeBoxSerialNumber?: string; firmwareVersion?: string; meterType?: string; meterSerialNumber?: string };
      const payload = {
        chargePointVendor: p.chargePointVendor, chargePointModel: p.chargePointModel,
        ...(p.chargePointSerialNumber !== undefined ? { chargePointSerialNumber: p.chargePointSerialNumber } : {}),
        ...(p.chargeBoxSerialNumber !== undefined ? { chargeBoxSerialNumber: p.chargeBoxSerialNumber } : {}),
        ...(p.firmwareVersion !== undefined ? { firmwareVersion: p.firmwareVersion } : {}),
        ...(p.meterType !== undefined ? { meterType: p.meterType } : {}),
        ...(p.meterSerialNumber !== undefined ? { meterSerialNumber: p.meterSerialNumber } : {}),
      };
      try {
        return await env.store.run(async (tx) => {
          const rec = await tx.receipt({ ...base, action: "BootNotification", requestHash, payload });
          if (!rec.created && rec.response) return { kind: "result", payload: rec.response as Record<string, unknown> } as const;
          const response = bootResponse(env.now(), env.heartbeatIntervalSeconds);
          await tx.setReceiptOutcome(rec.id, { disposition: "boot_observed" }, response, call.receivedAt);
          return { kind: "result", payload: response } as const;
        });
      } catch {
        return unavailable;
      }
    }
    case "Heartbeat":
      return { kind: "result", payload: { currentTime: env.now().toISOString() } };
    case "StatusNotification": {
      const p = v.value as { connectorId: number; status: string; errorCode: string; timestamp?: string };
      const o = await handleStatus(env, { ctx: call.ctx, connectorId: p.connectorId, status: p.status, errorCode: p.errorCode, ...(p.timestamp ? { timestamp: p.timestamp } : {}), receivedAt: call.receivedAt });
      if (o.kind === "unavailable") return unavailable;
      if (o.kind === "applied") await env.onStatusCommitted?.(call.ctx.installationId, o.seq).catch(() => undefined);
      return { kind: "result", payload: {} };
    }
    case "Authorize": {
      const o = await handleAuthorize(env, { ...base, requestHash, payload: v.value as never });
      return o.kind === "reply" ? { kind: "result", payload: o.payload } : o.kind === "call_error" ? { kind: "error", code: o.code, description: o.description } : unavailable;
    }
    case "StartTransaction": {
      const o = await handleStartTransaction(env, { ...base, requestHash, payload: v.value as never });
      return o.kind === "reply" ? { kind: "result", payload: o.payload } : o.kind === "call_error" ? { kind: "error", code: o.code, description: o.description } : unavailable;
    }
    case "StopTransaction": {
      const o = await handleStopTransaction(env, { ...base, requestHash, payload: v.value as never });
      return o.kind === "reply" ? { kind: "result", payload: o.payload } : o.kind === "call_error" ? { kind: "error", code: o.code, description: o.description } : unavailable;
    }
    case "MeterValues": {
      const o = await handleMeterValues(env, { ...base, requestHash, payload: v.value as never });
      // The reply never depends on the write succeeding for a *known* transaction's evidence being lost:
      // `unavailable` is surfaced so the caller keeps the frame in its durable outbox and retries.
      return o.kind === "unavailable" ? unavailable : { kind: "result", payload: {} };
    }
  }
}
