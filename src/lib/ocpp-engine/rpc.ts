// Engine entry for the gateway: two RPC methods on a NAMED Worker entrypoint of
// the CPO shell Worker (workers/cpo-shell-engine.mjs), reached only through a
// Cloudflare service binding that names that entrypoint.
//
// WHY THIS SHAPE (decision, from current source/config):
//   - The shell Worker already owns Drizzle + the `DATABASE_URL` requirement and
//     is the only deployed unit with this code. Reusing it adds no Worker.
//   - Its public `fetch` is fronted by an EXACT allow-list (edge Worker). Mounting
//     internal HTTP routes would mean widening that list, giving public traffic a
//     path to code that must only be reachable from the gateway.
//   - A named entrypoint is not a route: it has no URL, no cookie, no browser
//     login and no allow-list entry. The only way in is a service binding
//     configured in ANOTHER Worker's config by the account owner. Public traffic
//     therefore cannot forge an admitted context or skip the tenant/password
//     checks; the checks below run on every call regardless of who calls.
//   (Platform behaviour of entrypoints/RPC is NOT verified here: see the handoff.
//   What is verified is the logic and the entrypoint class against a local harness.)
//
// Every input is validated as untrusted. No secret is returned or logged.

import { decideAdmission, type AdmissionStore, type ConnectionContext } from "./admission";
import { processCall, type EngineEnv } from "./process-call";
import { rpcPending, type PendingOutcome, type PendingStore } from "./pending-service";
import { parseBasic, parseRoute } from "./route";
import { validatePayload, type Payload } from "./protocol";
import { canonicalJson, sha256Hex } from "./canonical";

export type AdmitOutcome = { kind: "admit"; context: ConnectionContext } | { kind: "pending"; orgId: string; routingId: string; chargePointId: string } | { kind: "deny" } | { kind: "unavailable" };
export type CallAnswer = { kind: "result"; payload: Record<string, unknown> } | { kind: "error"; code: string; description: string };
export type CallOutcome = { kind: "answer"; answer: CallAnswer } | { kind: "unavailable" } | { kind: "rejected"; status: number };

export const MAX_PAYLOAD_JSON_BYTES = 64 * 1024;
export const MAX_BATCH_ENTRIES = 20;
export const MAX_BATCH_JSON_BYTES = 384 * 1024;

function jsonBytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength; }
  catch { return Infinity; }
}

export type EngineRpcDeps = {
  now: () => Date;
  heartbeatIntervalSeconds: number;
  /** Opens request-scoped database access; null when the database is not configured. */
  withAdmission: <T>(fn: (s: AdmissionStore) => Promise<T>) => Promise<T | null>;
  /** Pending onboarding persistence; null when the database is not configured. */
  withPending?: <T>(fn: (s: PendingStore) => Promise<T>) => Promise<T | null>;
  withEngine: <T>(fn: (env: Omit<EngineEnv, "now" | "heartbeatIntervalSeconds">) => Promise<T>) => Promise<T | null>;
  /** Announce a COMMITTED status change to the cross-instance hub (optional; failure is harmless). */
  onStatusCommitted?: (installationId: string, seq: number) => Promise<void>;
  /** Called AFTER a StopTransaction reply is decided. Best-effort costing trigger; must not block or fail the reply. */
  afterStop?: () => void;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export async function rpcAdmit(deps: EngineRpcDeps, input: unknown): Promise<AdmitOutcome> {
  if (!isObj(input) || !str(input.host, 253) || !str(input.pathname, 200)) return { kind: "deny" };
  const parsed = parseRoute(input.host, input.pathname);
  if (!parsed.ok) return { kind: "deny" }; // a malformed route is a refusal like any other
  const authorization = typeof input.authorization === "string" && input.authorization.length <= 2048 ? input.authorization : null;
  // Pending is opt-in per call: a gateway that does not ask keeps the plain refusal for unknown chargers.
  const acceptPending = input.acceptPending === true;
  const d = await deps.withAdmission((store) => decideAdmission(store, parsed.route, parseBasic(authorization), deps.now(), { acceptPending })).catch(() => null);
  if (d === null || d.kind === "unavailable") return { kind: "unavailable" };
  if (d.kind === "pending") return { kind: "pending", orgId: d.orgId, routingId: parsed.route.routingId, chargePointId: d.chargePointId };
  return d.kind === "admit" ? { kind: "admit", context: d.context } : { kind: "deny" };
}

/** Pending onboarding operations (boot capture, registration check, close). See pending-service.ts. */
export async function rpcPendingOp(deps: EngineRpcDeps, input: unknown): Promise<PendingOutcome> {
  const withPending = deps.withPending;
  if (!withPending) return { kind: "unavailable" };
  return rpcPending({ now: deps.now, withPending }, input);
}

function readContext(v: unknown): ConnectionContext | null {
  if (!isObj(v)) return null;
  for (const k of ["orgId", "installationId", "chargePointId", "identityString", "deviceId", "placementId", "credentialEpoch"] as const) if (!str(v[k], 128)) return null;
  if (v.credentialMode !== "none" && v.credentialMode !== "password") return null;
  return v as unknown as ConnectionContext;
}

export async function rpcCall(deps: EngineRpcDeps, input: unknown): Promise<CallOutcome> {
  if (!isObj(input)) return { kind: "rejected", status: 400 };
  const ctx = readContext(input.ctx);
  const receivedAt = typeof input.receivedAt === "string" ? new Date(input.receivedAt) : null;
  if (!ctx || !str(input.messageId, 64) || !str(input.action, 64) || !receivedAt || Number.isNaN(receivedAt.getTime())) return { kind: "rejected", status: 400 };
  if (jsonBytes(input.payload) > MAX_PAYLOAD_JSON_BYTES) return { kind: "rejected", status: 413 };

  const answer = await deps
    .withEngine((e) => processCall({ ...e, ...(deps.onStatusCommitted ? { onStatusCommitted: deps.onStatusCommitted } : {}), heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds, now: deps.now }, { ctx, messageId: input.messageId as string, action: input.action as string, payload: input.payload, receivedAt }))
    .catch(() => null);
  if (answer === null) return { kind: "unavailable" };
  // An InternalError answer means "the backend could not record this": the gateway retries it, so surface it as unavailable.
  if (answer.kind === "error" && answer.code === "InternalError") return { kind: "unavailable" };
  if (input.action === "StopTransaction" && answer.kind === "result") {
    try {
      deps.afterStop?.(); // fire-and-forget: the physical stop is already committed and answered
    } catch {
      /* a costing trigger can never affect the charger's reply */
    }
  }
  return { kind: "answer", answer };
}

/** Transport batching only: one database client, independent per-event transactions.
 * No command/start/stop can enter this lane. Scope is checked before opening a client.
 * A failed event stops database work for this wake-up; remaining entries retry too.
 */
export async function rpcCallBatch(deps: EngineRpcDeps, input: unknown): Promise<CallOutcome[]> {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_BATCH_ENTRIES) return [];
  const reject = (status: number): CallOutcome[] => input.map(() => ({ kind: "rejected", status }));
  if (jsonBytes(input) > MAX_BATCH_JSON_BYTES) return reject(413);
  const first = isObj(input[0]) ? readContext(input[0].ctx) : null;
  const keys = ["orgId", "installationId", "chargePointId", "identityString", "deviceId", "placementId", "credentialEpoch", "credentialMode"] as const;
  if (!first || input.some(item => {
    if (!isObj(item) || !["MeterValues", "StatusNotification"].includes(String(item.action))) return true;
    const ctx = readContext(item.ctx);
    return !ctx || keys.some(key => ctx[key] !== first[key]);
  })) return reject(400);
  const unavailable = (): CallOutcome => ({ kind: "unavailable" });
  const results = await deps.withEngine(async engine => {
    if (engine.store.tryIngestMeters && input.every(item => item.action === "MeterValues" && str(item.messageId, 64) && typeof item.receivedAt === "string" && !Number.isNaN(Date.parse(item.receivedAt)) && jsonBytes(item.payload) <= MAX_PAYLOAD_JSON_BYTES && validatePayload("MeterValues", item.payload).ok)) {
      const items = await Promise.all(input.map(async item => ({ ctx: readContext(item.ctx)!, messageId: item.messageId as string, payload: item.payload as Payload<"MeterValues">, receivedAt: new Date(item.receivedAt as string), requestHash: await sha256Hex(`MeterValues:${canonicalJson(item.payload)}`) })));
      if (await engine.store.tryIngestMeters(items)) return input.map((): CallOutcome => ({ kind: "answer", answer: { kind: "result", payload: {} } }));
    }
    const outcomes: CallOutcome[] = [];
    let down = false;
    for (const item of input) {
      const outcome = down ? unavailable() : await rpcCall({ ...deps, withEngine: async fn => fn(engine) }, item);
      outcomes.push(outcome);
      if (outcome.kind === "unavailable") down = true;
    }
    return outcomes;
  }).catch(() => null);
  // A lost outer response is uncertain: retry using the original event identities.
  return results ?? input.map(unavailable);
}
