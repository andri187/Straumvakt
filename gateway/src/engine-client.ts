/**
 * Gateway -> engine calls (Checkpoint A/B).
 *
 * Two lanes, chosen by whether the charger's reply depends on a durable write:
 *
 *   SYNC   Boot, Authorize, StartTransaction, StopTransaction. The reply carries
 *          a decision or a transaction id, so it is only sent after the engine
 *          has committed. An unreachable/slow engine becomes CALLERROR
 *          InternalError - never an invented decision.
 *   ASYNC  MeterValues, StatusNotification. The reply is `{}`; the frame is
 *          validated here, written to the DO-storage outbox, and delivered
 *          later (bounded delay, retried, acked only after the engine commits).
 *
 * Heartbeat never leaves the Durable Object (fast path, no storage beyond the
 * existing single `ops` key and no service-binding call).
 */
import type { EngineContext } from "./connection-ownership";
import type { LiveDevice } from "@engine/live-projection";

export type CallAnswer =
  | { kind: "result"; payload: Record<string, unknown> }
  | { kind: "error"; code: string; description: string };

/**
 * The service binding to the shell Worker's named `EngineEntrypoint`. RPC, not
 * HTTP: there is no URL, cookie or shared secret in this hop, and the entrypoint
 * has no public route (see src/lib/ocpp-engine/rpc.ts for the decision).
 */
export interface EngineBinding {
  publishLiveV1?(value: LiveDevice): Promise<{ ok: boolean }>;
  admit(input: { host: string; pathname: string; authorization: string | null; acceptPending?: boolean }): Promise<AdmitOutcome>;
  call(input: EngineCallBody): Promise<EngineOutcome>;
  callBatchV1?(input: EngineCallBody[]): Promise<{ messageId: string; outcome: EngineOutcome }[]>;
  /** Pending onboarding of an unregistered charger (boot capture, registration check, close note). */
  pending?(input: PendingCall): Promise<PendingAnswer>;
}

export async function publishLive(env: EngineEnv, value: LiveDevice): Promise<boolean> {
  if (!env.ENGINE?.publishLiveV1) return false;
  try {
    const out = await withTimeout(env.ENGINE.publishLiveV1(value), 1000); // disposable projection must not monopolize command/evidence work
    return out !== "timeout" && out?.ok === true;
  } catch { return false; }
}

export type PendingCall = { op: "boot" | "check" | "closed"; routingId: string; chargePointId: string; messageId?: string; receivedAt?: string; frameBytes?: number; payload?: unknown };
export type PendingAnswer =
  | { kind: "state"; state: "unregistered" | "registered" | "known" | "inactive"; hasCapture?: boolean }
  | { kind: "captured"; result: "stored" | "unchanged" | "full" }
  | { kind: "ok" }
  | { kind: "unavailable" }
  | { kind: "rejected"; status: number };

export interface EngineEnv {
  ENGINE?: EngineBinding;
}

/** The engine must answer well inside a charger's own request timeout (OCPP-J default 30 s). */
export const ENGINE_TIMEOUT_MS = 10_000;

export type EngineCallBody = { ctx: EngineContext; messageId: string; action: string; payload: unknown; receivedAt: string };

export type EngineOutcome = { kind: "answer"; answer: CallAnswer } | { kind: "unavailable" } | { kind: "rejected"; status: number };

/** RPC has no AbortSignal: bound the wait ourselves. A timeout is `unavailable`, never an answer. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isAnswer(v: unknown): v is CallAnswer {
  return !!v && typeof v === "object" && ((v as CallAnswer).kind === "result" || (v as CallAnswer).kind === "error");
}

export async function callEngine(env: EngineEnv, body: EngineCallBody, timeoutMs = ENGINE_TIMEOUT_MS): Promise<EngineOutcome> {
  if (!env.ENGINE) return { kind: "unavailable" }; // not bound: fail closed, retry later
  try {
    const out = await withTimeout(env.ENGINE.call(body), timeoutMs);
    if (out === "timeout" || !out || typeof out !== "object") return { kind: "unavailable" };
    if (out.kind === "answer" && isAnswer(out.answer)) return out;
    if (out.kind === "rejected" && typeof out.status === "number") return { kind: "rejected", status: out.status };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Missing/old bindings and uncertain replies leave ALL original events retryable.
 * Never fall back to individual calls after a timeout: those commits may still finish.
 */
export async function callEngineBatch(env: EngineEnv, bodies: EngineCallBody[], timeoutMs = ENGINE_TIMEOUT_MS): Promise<EngineOutcome[]> {
  const unavailable = (): EngineOutcome[] => bodies.map(() => ({ kind: "unavailable" }));
  if (!env.ENGINE?.callBatchV1 || bodies.length < 1 || bodies.length > 20) return unavailable();
  try {
    const out = await withTimeout(env.ENGINE.callBatchV1(bodies), timeoutMs);
    if (!Array.isArray(out) || out.length !== bodies.length) return unavailable();
    if (!out.every((item, index) => {
      const v = item?.outcome;
      return item?.messageId === bodies[index]?.messageId && v && (v.kind === "unavailable" || (v.kind === "answer" && isAnswer(v.answer)) || (v.kind === "rejected" && typeof v.status === "number"));
    })) return unavailable();
    return out.map(item => item.outcome);
  } catch { return unavailable(); }
}

export const INTERNAL_ERROR: CallAnswer = { kind: "error", code: "InternalError", description: "backend unavailable; retry" };

export type AdmitOutcome =
  | { kind: "admit"; context: EngineContext }
  | { kind: "pending"; orgId: string; routingId: string; chargePointId: string }
  | { kind: "deny" }
  | { kind: "unavailable" };

/**
 * Asks the engine to admit an upgrade. The raw Authorization header crosses the binding only. `acceptPending` asks
 * the engine to answer `pending` for a genuinely unknown charger instead of `deny`; without it nothing changes.
 */
export async function admit(env: EngineEnv, host: string, pathname: string, authorization: string | null, acceptPending = false): Promise<AdmitOutcome> {
  if (!env.ENGINE) return { kind: "unavailable" };
  try {
    const out = await withTimeout(env.ENGINE.admit({ host, pathname, authorization, ...(acceptPending ? { acceptPending: true } : {}) }), ENGINE_TIMEOUT_MS);
    if (out === "timeout" || !out || typeof out !== "object") return { kind: "unavailable" };
    if (out.kind === "admit" && out.context) return out;
    if (out.kind === "pending" && acceptPending && typeof out.orgId === "string" && typeof out.routingId === "string" && typeof out.chargePointId === "string") return out;
    if (out.kind === "deny") return { kind: "deny" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Pending onboarding call. Never throws; a missing binding, timeout or malformed answer is `unavailable`. */
export async function callPending(env: EngineEnv, input: PendingCall): Promise<PendingAnswer> {
  if (!env.ENGINE?.pending) return { kind: "unavailable" };
  try {
    const out = await withTimeout(env.ENGINE.pending(input), ENGINE_TIMEOUT_MS);
    if (out === "timeout" || !out || typeof out !== "object") return { kind: "unavailable" };
    const k = (out as { kind?: unknown }).kind;
    if (k === "state" || k === "captured" || k === "ok" || k === "rejected") return out;
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
