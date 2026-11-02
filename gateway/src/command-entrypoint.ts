/**
 * Named entrypoint of the gateway Worker for COMMANDS from the shell Worker.
 *
 * Like the engine entrypoint on the shell side, this is not a route: it has no
 * URL and is reachable only through a service binding that names it, configured
 * in the shell Worker's own config. The public `fetch` handler does not route
 * to it. Today it offers one command, `requestStop`, which sends a standard
 * RemoteStopTransaction to the device's CURRENT owning socket.
 *
 * `accepted` means the charger said it will try. It never means the session is
 * stopped; that is only the durable StopTransaction the engine records.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import type { PromoteOutcome } from "./pending-mode";
import { validateStopInput, type StopCommandInput, type StopCommandOutcome, type StopCommandResult } from "./stop-command";

type Env = { IDENTITY_DO: DurableObjectNamespace };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES: readonly string[] = ["accepted", "rejected", "offline", "timeout", "unavailable"];

export type RequestStopInput = StopCommandInput & { deviceId: string };

/**
 * One durable stop ATTEMPT for one permanent device. The lifecycle service reserves `attemptId` before calling, so a
 * retried or concurrent call carries the SAME id and the device object sends at most once; every field is forwarded so
 * the object can fence by placement and deadline. Anything ill-formed is "unavailable" and nothing is sent.
 */
export async function requestStopVia(env: Env, input: RequestStopInput): Promise<StopCommandResult> {
  if (!input || typeof input.deviceId !== "string" || !UUID.test(input.deviceId)) return { outcome: "unavailable", reason: "bad_device" };
  const bad = validateStopInput(input, Date.now());
  if (bad) return { outcome: "unavailable", reason: bad };
  try {
    const stub = env.IDENTITY_DO.get(env.IDENTITY_DO.idFromName(`device:${input.deviceId}`));
    const body = JSON.stringify({ transactionNo: input.transactionNo, requestId: input.requestId, attemptId: input.attemptId, placementId: input.placementId, deadlineMs: input.deadlineMs });
    const res = await stub.fetch(new Request("https://do.internal/command/stop", { method: "POST", headers: { "content-type": "application/json" }, body }));
    const reply = (await res.json()) as { outcome?: string; reason?: unknown };
    const outcome = (OUTCOMES.includes(reply.outcome ?? "") ? reply.outcome : "unavailable") as StopCommandOutcome;
    return { outcome, ...(typeof reply.reason === "string" ? { reason: reply.reason } : {}) };
  } catch {
    return { outcome: "unavailable" };
  }
}

const CP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
/** Hard bound on one presence read, so a refresh costs a known, small number of object requests. */
export const MAX_PRESENCE_IDS = 25;
export type PromoteResult = { outcome: PromoteOutcome };

const pendingStub = (env: Env, orgId: string, chargePointId: string) => env.IDENTITY_DO.get(env.IDENTITY_DO.idFromName(`pending:${orgId}:${chargePointId}`));

/**
 * Signal that a charger of this CPO was just saved into a circuit. The pending object re-reads the ACTUAL registration
 * before doing anything, so this carries no authority: a forged or stale signal can only cause one re-check.
 */
export async function promotePendingVia(env: Env, input: { orgId: string; chargePointId: string }): Promise<PromoteResult> {
  if (!UUID.test(input.orgId) || !CP_ID.test(input.chargePointId)) return { outcome: "unavailable" };
  try {
    const res = await pendingStub(env, input.orgId, input.chargePointId).fetch(new Request("https://do.internal/pending/promote", { method: "POST" }));
    const body = (await res.json()) as { outcome?: PromoteOutcome };
    return { outcome: body.outcome ?? "unavailable" };
  } catch {
    return { outcome: "unavailable" };
  }
}

/**
 * Which of these charge point ids of this CPO currently hold a pending socket at the gateway. Gateway-observed socket
 * presence only: it says nothing about whether the device is alive. Bounded to MAX_PRESENCE_IDS; ids beyond that, or
 * malformed, are reported as not connected, and an unreachable object is left out of `connected` (unknown, not "no").
 */
export async function pendingPresenceVia(env: Env, input: { orgId: string; chargePointIds: string[] }): Promise<{ connected: string[]; unknown: string[] }> {
  if (!UUID.test(input.orgId) || !Array.isArray(input.chargePointIds)) return { connected: [], unknown: [] };
  const ids = [...new Set(input.chargePointIds)].filter((x) => typeof x === "string" && CP_ID.test(x)).slice(0, MAX_PRESENCE_IDS);
  const connected: string[] = [];
  const unknown: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await pendingStub(env, input.orgId, id).fetch(new Request("https://do.internal/pending/presence", { method: "GET" }));
        const body = (await res.json()) as { connected?: boolean };
        if (body.connected === true) connected.push(id);
      } catch {
        unknown.push(id);
      }
    }),
  );
  return { connected, unknown };
}

export class CommandEntrypoint extends WorkerEntrypoint<Env> {
  /** Only reachable through the existing trusted service binding. Caller supplies its authenticated operator label. */
  async repairOutbox(input: { orgId: string; deviceId: string; op: "inspect" | "replay"; after?: number; ids?: number[]; requestId?: string; actor?: string }) {
    if (!input || !UUID.test(input.orgId) || !UUID.test(input.deviceId)) return { error: "input" };
    try {
      const stub = this.env.IDENTITY_DO.get(this.env.IDENTITY_DO.idFromName(`device:${input.deviceId}`));
      return await (await stub.fetch(new Request("https://do.internal/command/outbox", { method: "POST", body: JSON.stringify(input) }))).json();
    } catch { return { error: "unavailable" }; }
  }
  /**
   * Durable, attempt-keyed stop (contract version 1). A caller that needs these semantics calls THIS name: an older gateway
   * has no such method, so the call fails ("does not implement") and the caller treats it as unavailable. The unversioned
   * `requestStop` below is the same implementation, kept only so an existing caller of this gateway keeps working.
   */
  async requestStopV1(input: RequestStopInput) {
    return requestStopVia(this.env, input);
  }
  async requestStop(input: RequestStopInput) {
    return requestStopVia(this.env, input);
  }

  async promotePending(input: { orgId: string; chargePointId: string }) {
    return promotePendingVia(this.env, input);
  }

  async pendingPresence(input: { orgId: string; chargePointIds: string[] }) {
    return pendingPresenceVia(this.env, input);
  }
}
