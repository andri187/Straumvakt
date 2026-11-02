// Pending onboarding: policy constants and the capture record for a charger that is not registered yet.
//
// A genuinely unknown charger of an active CPO may keep a restricted socket open. It is told `Pending`, which is NOT
// a registration: nothing here creates a device, a placement, a session or a cost. The charger becomes `Accepted`
// only after the CPO saves it into an installation circuit and the normal admission path then admits a fresh
// connection (see gateway/src/pending-mode.ts for why promotion goes through a reconnect).
//
// Import-light on purpose: the gateway Durable Object imports this file.

import { sha256Hex, canonicalJson } from "./canonical";
import { validatePayload } from "./protocol";

/**
 * Seconds the charger is told to wait before it repeats its BootNotification (OCPP 1.6 ed.2, section 4.2: when the
 * status is Pending, `interval` is the minimum time before the next request and MUST be nonzero for retries to be
 * paced). One value, one place; the gateway may override it with OCPP_PENDING_RETRY_SECONDS within bounds.
 */
export const PENDING_RETRY_SECONDS = 1800;
export const MIN_PENDING_RETRY_SECONDS = 60;
export const MAX_PENDING_RETRY_SECONDS = 86_400;

export function pendingRetrySeconds(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= MIN_PENDING_RETRY_SECONDS && n <= MAX_PENDING_RETRY_SECONDS ? n : PENDING_RETRY_SECONDS;
}

/**
 * Longest a pending socket goes without re-reading its registration. This is the bounded recovery path for a LOST
 * post-save signal; a reconnect always re-reads it immediately through normal admission. It is checked on a boot retry,
 * never on a timer, and costs one engine call (two small reads). Six hours keeps an idle waiting charger to about four
 * database wake-ups a day for this purpose; a lost signal delays acceptance by at most this plus one boot retry.
 */
export const PENDING_RECHECK_SECONDS = 6 * 3600;

/** A socket that has not sent a BootNotification this soon after connecting is closed. */
export const PENDING_FIRST_BOOT_DEADLINE_MS = 60_000;

/** ENFORCED. Frames larger than this are refused before parsing; a BootNotification is well under 2 KiB. */
export const MAX_PENDING_FRAME_BYTES = 8 * 1024;
/**
 * ENFORCED per socket, and it survives hibernation: the window lives in the socket attachment (no storage write per message).
 * A reconnect gets a fresh window, which the ingress limiters and the capture budget below bound.
 */
export const PENDING_MESSAGES_PER_WINDOW = 12;
export const PENDING_MESSAGE_WINDOW_MS = 60_000;
/**
 * ENFORCED per identity, persisted in the pending object: after a capture ATTEMPT (successful or not) the next changed,
 * invalid or re-stored body waits this long before it may reach the engine. Protocol replies are never delayed; a body held
 * back is simply not stored yet and is stored by the next boot after the interval. This, not the payload hash, is what bounds
 * database work from a charger that keeps changing its body or from a reconnect storm.
 */
export const PENDING_CAPTURE_MIN_INTERVAL_MS = 10 * 60_000;
/**
 * ENFORCED per CPO by the admission gate (gateway/src/pending-gate.ts): pending sockets held at once. Exact within a lease; a
 * lease that is never released (an object lost without a close event) lapses after PENDING_LEASE_MS.
 */
export const MAX_PENDING_SOCKETS_PER_CPO = 25;
export const PENDING_LEASE_MS = 7 * 3600_000;
/**
 * ENFORCED at capture time, under a per-CPO advisory lock: distinct identities holding a stored capture. At the cap a new
 * identity may evict the capture BODY of an idle, unregistered row (never a row, never a registered charger's body); with none
 * eligible the boot is answered Rejected.
 */
export const MAX_PENDING_IDENTITIES_PER_CPO = 100;
export const PENDING_CAPTURE_EVICT_AFTER_DAYS = 14;

/** Close codes the gateway uses itself (private range). A close with one of these is not a charger-side loss. */
export const PENDING_SUPERSEDED_CLOSE = 4001;
export const PENDING_REGISTERED_CLOSE = 4002;

/**
 * Activation of an ADMITTED, registered connection that has not sent a BootNotification (gateway/src/boot-activation.ts).
 *
 * Gateway side, per connection: the charger gets ACTIVATION_PROBE_AFTER_MS to boot by itself; if it has not, ONE correlated
 * TriggerMessage(BootNotification) is sent on the same socket, and the attempt is given up (recorded as incomplete) at
 * ACTIVATION_CONNECTION_WINDOW_MS after the connection. Only an Accepted BootNotification the engine committed completes it.
 */
export const ACTIVATION_PROBE_AFTER_MS = 10_000;
export const ACTIVATION_CONNECTION_WINDOW_MS = 60_000;

/**
 * Operator side, measured from the save (the retained promotion timestamp): how long a DELIVERED "you are registered" signal may
 * wait for an accepted BootNotification before the list says so. It is longer than the connection window above because it also
 * covers the charger's own reconnect delay, which Straumvakt does not control (the first real trial reconnected about six
 * minutes after the save). Computed at read time from stored timestamps: no timer, no write, no polling. A late accepted
 * boot still clears the row. Limit: a signal that was only delivered later, by a retried read, is still measured from the save.
 */
export const ACTIVATION_WAIT_MS = 15 * 60_000;

export function pendingBootResponse(now: Date, intervalSeconds: number = PENDING_RETRY_SECONDS) {
  return { status: "Pending" as const, currentTime: now.toISOString(), interval: intervalSeconds };
}

/** The complete received BootNotification, kept before any schema stripping. */
export type BootCapture = {
  messageId: string;
  receivedAt: string;
  /** SHA-256 over the key-order-independent JSON of `payload`; equal hashes are an unchanged boot. */
  hash: string;
  /** Byte length of the received text frame. */
  frameBytes: number;
  validation: { ok: true } | { ok: false; code: string; description: string };
  /** Exactly as the charger sent it, including fields the schema would refuse. */
  payload: unknown;
};

export async function payloadHash(payload: unknown): Promise<string> {
  return sha256Hex(canonicalJson(payload));
}

export async function buildBootCapture(input: { messageId: string; receivedAt: string; frameBytes: number; payload: unknown }): Promise<BootCapture> {
  const v = validatePayload("BootNotification", input.payload);
  return {
    messageId: input.messageId,
    receivedAt: input.receivedAt,
    hash: await payloadHash(input.payload),
    frameBytes: input.frameBytes,
    validation: v.ok ? { ok: true } : { ok: false, code: v.error.code, description: v.error.description },
    payload: input.payload,
  };
}

/** Bounded view for the list: when and which message, never the body. */
export type BootCaptureMeta = { messageId: string; receivedAt: string };
