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

export type CallAnswer =
  | { kind: "result"; payload: Record<string, unknown> }
  | { kind: "error"; code: string; description: string };

/**
 * The service binding to the shell Worker's named `EngineEntrypoint`. RPC, not
 * HTTP: there is no URL, cookie or shared secret in this hop, and the entrypoint
 * has no public route (see src/lib/ocpp-engine/rpc.ts for the decision).
 */
export interface EngineBinding {
  admit(input: { host: string; pathname: string; authorization: string | null }): Promise<AdmitOutcome>;
  call(input: EngineCallBody): Promise<EngineOutcome>;
}

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

export const INTERNAL_ERROR: CallAnswer = { kind: "error", code: "InternalError", description: "backend unavailable; retry" };

export type AdmitOutcome = { kind: "admit"; context: EngineContext } | { kind: "deny" } | { kind: "unavailable" };

/** Asks the engine to admit an upgrade. The raw Authorization header crosses the binding only. */
export async function admit(env: EngineEnv, host: string, pathname: string, authorization: string | null): Promise<AdmitOutcome> {
  if (!env.ENGINE) return { kind: "unavailable" };
  try {
    const out = await withTimeout(env.ENGINE.admit({ host, pathname, authorization }), ENGINE_TIMEOUT_MS);
    if (out === "timeout" || !out || typeof out !== "object") return { kind: "unavailable" };
    if (out.kind === "admit" && out.context) return out;
    if (out.kind === "deny") return { kind: "deny" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
