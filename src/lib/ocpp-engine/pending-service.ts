// Engine side of pending onboarding: what the gateway may ask about an unregistered charger, and nothing more.
//
// Three operations over the existing `ocpp.pending_discoveries` row (one per CPO + charge point id; no second registry):
//   boot    store the complete received BootNotification, deduplicated and bounded
//   check   is this charger now registered (so the gateway should let it reconnect through normal admission)?
//   closed  note that the socket went away, so the Incoming window starts from the disconnect
// None of them registers, places, authorises or costs anything. Every input is untrusted until validated here.

import type { AdmissionLookup } from "./admission";
import { MAX_PENDING_FRAME_BYTES, buildBootCapture, type BootCapture } from "./pending";

/**
 * unregistered  no connection identity of this CPO matches: it may keep waiting.
 * registered    exactly one current identity with one current placement in an installation of this CPO: it should reconnect
 *               through normal admission (credentials are checked THERE, never here).
 * known         an identity exists but is retired, unplaced or ambiguous: a known device is never resurrected through discovery.
 * inactive      the CPO is unknown or not active.
 */
export type RegistrationState = "unregistered" | "registered" | "known" | "inactive";

export interface PendingStore {
  /** The CPO is derived from the routing id (the host), never from a caller-supplied organisation id. */
  registration(input: { routingId: string; chargePointId: string; at: Date }): Promise<{ state: RegistrationState; orgId: string | null }>;
  /** One bounded write. `unchanged` writes nothing; `full` means the CPO already holds the maximum of distinct identities. */
  storeBoot(input: { orgId: string; chargePointId: string; capture: BootCapture; at: Date }): Promise<"stored" | "unchanged" | "full">;
  touch(input: { orgId: string; chargePointId: string; at: Date }): Promise<void>;
  /** Whether a captured body is still stored for this identity (an evicted or lost capture lets the gateway store it again). */
  hasCapture(input: { orgId: string; chargePointId: string }): Promise<boolean>;
}

/** Pure classification of an admission lookup. Credentials are deliberately not evaluated. */
export function classifyRegistration(found: AdmissionLookup, chargePointId: string): RegistrationState {
  if (!found.org || !found.org.active) return "inactive";
  if (found.identities.length === 0) return "unregistered";
  const exact = found.identities.filter((i) => i.chargePointId === chargePointId && i.current);
  if (exact.length !== 1) return "known";
  const live = exact[0]!.placements.filter((p) => p.current);
  if (live.length !== 1) return "known";
  const p = live[0]!;
  const inst = p.installation;
  if (p.orgId !== found.org.id || !inst || inst.id !== p.installationId || inst.orgId !== found.org.id || inst.archived) return "known";
  return "registered";
}

export type PendingOutcome =
  | { kind: "state"; state: RegistrationState; /** Only for `check` of an unregistered charger. */ hasCapture?: boolean }
  | { kind: "captured"; result: "stored" | "unchanged" | "full" }
  | { kind: "ok" }
  | { kind: "unavailable" }
  | { kind: "rejected"; status: number };

export type PendingDeps = {
  now: () => Date;
  /** Opens request-scoped database access; null when the database is not configured. */
  withPending: <T>(fn: (s: PendingStore) => Promise<T>) => Promise<T | null>;
};

const ROUTING = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Same shape the route accepts (installations/address.ts CHARGE_POINT_ID is the authority at the edge).
const CP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function rpcPending(deps: PendingDeps, input: unknown): Promise<PendingOutcome> {
  if (!isObj(input) || typeof input.routingId !== "string" || !ROUTING.test(input.routingId) || typeof input.chargePointId !== "string" || !CP_ID.test(input.chargePointId)) {
    return { kind: "rejected", status: 400 };
  }
  const { routingId, chargePointId } = input as { routingId: string; chargePointId: string };
  const at = deps.now();

  if (input.op === "closed") {
    // Only an unregistered charger's row is touched, and the store throttles it like any other knock.
    const out = await deps.withPending(async (s) => {
      const reg = await s.registration({ routingId, chargePointId, at });
      if (reg.state !== "unregistered" || !reg.orgId) return;
      await s.touch({ orgId: reg.orgId, chargePointId, at });
    }).catch(() => null);
    return out === null ? { kind: "unavailable" } : { kind: "ok" };
  }

  if (input.op === "check") {
    const reg = await deps
      .withPending(async (s) => {
        const r = await s.registration({ routingId, chargePointId, at });
        return { ...r, hasCapture: r.state === "unregistered" && r.orgId ? await s.hasCapture({ orgId: r.orgId, chargePointId }) : undefined };
      })
      .catch(() => null);
    return reg === null ? { kind: "unavailable" } : { kind: "state", state: reg.state, ...(reg.hasCapture === undefined ? {} : { hasCapture: reg.hasCapture }) };
  }

  if (input.op === "boot") {
    if (typeof input.messageId !== "string" || input.messageId.length < 1 || input.messageId.length > 36) return { kind: "rejected", status: 400 };
    const receivedAt = typeof input.receivedAt === "string" ? new Date(input.receivedAt) : null;
    if (!receivedAt || Number.isNaN(receivedAt.getTime())) return { kind: "rejected", status: 400 };
    const frameBytes = typeof input.frameBytes === "number" && Number.isInteger(input.frameBytes) && input.frameBytes > 0 && input.frameBytes <= MAX_PENDING_FRAME_BYTES ? input.frameBytes : null;
    if (frameBytes === null) return { kind: "rejected", status: 413 };
    let size = 0;
    try {
      size = JSON.stringify(input.payload ?? null).length;
    } catch {
      return { kind: "rejected", status: 400 };
    }
    if (size > MAX_PENDING_FRAME_BYTES) return { kind: "rejected", status: 413 };

    const capture = await buildBootCapture({ messageId: input.messageId, receivedAt: receivedAt.toISOString(), frameBytes, payload: input.payload });
    const out = await deps
      .withPending(async (s) => {
        const reg = await s.registration({ routingId, chargePointId, at });
        // A charger that became registered, retired or ambiguous is not stored as a new candidate.
        if (reg.state !== "unregistered" || !reg.orgId) return { kind: "state", state: reg.state } as const;
        return { kind: "captured", result: await s.storeBoot({ orgId: reg.orgId, chargePointId, capture, at }) } as const;
      })
      .catch(() => null);
    return out === null ? { kind: "unavailable" } : out;
  }
  return { kind: "rejected", status: 400 };
}

