/**
 * Activation of an admitted, REGISTERED connection that has not sent a BootNotification (pure state machine, no I/O).
 *
 * WHY: a WebSocket upgrade proves transport only. After the pending-to-registered handoff the first real charger
 * reconnected (HTTP 101) but no registered BootNotification followed, and nothing asked for one. The device object now keeps
 * ONE small record per connection attempt and, if the charger stays silent, sends ONE TriggerMessage(BootNotification) on the
 * SAME socket.
 *
 * WHAT COMPLETES IT: only an Accepted BootNotification that the engine committed on a current socket of this placement. A
 * TriggerMessage reply (even Accepted), HTTP 101 or a stored discovery boot is never enough; the reply is recorded for diagnosis.
 *
 * LIFECYCLE (all timestamps durable, so hibernation/eviction changes nothing):
 *   waiting --(probeAt, socket present)--> probing --(Accepted boot)--> done
 *   waiting/probing --(deadline | disconnect | superseded | send failure)--> incomplete --(late Accepted boot)--> done
 * `done` is final for that placement: ordinary reconnects do not repeat activation. Removal/re-addition or transfer gives
 * the device a new placement and must establish its own accepted boot. An unfinished placement starts a fresh attempt
 * on a new connection (one probe per attempt, never a resend).
 *
 * COMPATIBILITY: a device object that predates this record has no marker and is seeded like a new one on its next upgrade.
 * That costs one storage read/write per connection and, only if the charger does not boot within ACTIVATION_PROBE_AFTER_MS, one
 * TriggerMessage. Nothing is blocked while a record is open: heartbeats, sessions, meter data and stop commands are unaffected.
 *
 * COST per attempt (structural, not measured): upgrade 1 get + 1 put; probe 1 get + 1 put + 1 frame; reply 1 get + 1 put;
 * accepted boot 1 get (+1 put while open); deadline 1 get + 1 put. No engine/Neon call, no new RPC, no heartbeat write.
 */
import { ACTIVATION_CONNECTION_WINDOW_MS, ACTIVATION_PROBE_AFTER_MS } from "@engine/pending";

export const ACTIVATION_KEY = "engine:activation";

export type ProbeReply = "accepted" | "rejected" | "error";

export type BootActivation = {
  placementId: string;
  /** Socket generation this attempt belongs to. */
  generation: number;
  phase: "waiting" | "probing" | "done" | "incomplete";
  startedAt: number;
  probeAt: number;
  deadline: number;
  /** The one TriggerMessage of this attempt: persisted BEFORE it is sent. `reply` is diagnostic only. */
  probe?: { uniqueId: string; sentAt: number; reply?: ProbeReply };
  /** Why an attempt is incomplete (diagnostic, never shown as a cause to the operator). */
  reason?: string;
  doneAt?: number;
};

export const isOpenActivation = (a: BootActivation | null | undefined): a is BootActivation => !!a && (a.phase === "waiting" || a.phase === "probing");

/** A fresh attempt, unless this exact placement already has an accepted boot. Device identity alone is insufficient. */
export function seedActivation(stored: BootActivation | null, placementId: string, generation: number, now: number): BootActivation | null {
  if (stored?.phase === "done" && stored.placementId === placementId) return null;
  return { placementId, generation, phase: "waiting", startedAt: now, probeAt: now + ACTIVATION_PROBE_AFTER_MS, deadline: now + ACTIVATION_CONNECTION_WINDOW_MS };
}

export type ActivationStep = {
  /** Replacement record, or null when unchanged. */
  next: BootActivation | null;
  /** True exactly when the persisted `next` carries a NEW probe that must now go on the wire. */
  send: boolean;
  /** When to wake again for this record, or null when it needs no further wake-up. */
  rearmAt: number | null;
};

/** One alarm tick. `owner` is the device's current owner; `socketPresent` says a current socket of that generation exists. */
export function stepActivation(a: BootActivation | null, now: number, owner: { generation: number; placementId: string } | null, socketPresent: boolean, newId: () => string): ActivationStep {
  const none: ActivationStep = { next: null, send: false, rearmAt: null };
  if (!isOpenActivation(a)) return none;
  const close = (reason: string): ActivationStep => ({ next: { ...a, phase: "incomplete", reason }, send: false, rearmAt: null });
  if (!owner || owner.generation !== a.generation || owner.placementId !== a.placementId) return close("superseded");
  if (now >= a.deadline) return close(a.probe ? "no_boot_after_probe" : "no_boot");
  if (a.phase === "waiting" && now >= a.probeAt) {
    if (!socketPresent) return close("no_socket");
    return { next: { ...a, phase: "probing", probe: { uniqueId: newId(), sentAt: now } }, send: true, rearmAt: a.deadline };
  }
  return { next: null, send: false, rearmAt: a.phase === "waiting" ? Math.min(a.probeAt, a.deadline) : a.deadline };
}

export const isProbeReply = (a: BootActivation | null, uniqueId: string): boolean => !!a?.probe && a.probe.uniqueId === uniqueId;

/**
 * Records the charger's answer to the probe. Only while the attempt is open, on its own generation and before its deadline;
 * anything else (late, duplicate, replacement socket) changes nothing. Never completes the activation.
 */
export function recordProbeReply(a: BootActivation | null, generation: number, now: number, reply: ProbeReply): BootActivation | null {
  if (!isOpenActivation(a) || a.phase !== "probing" || a.generation !== generation || now >= a.deadline || !a.probe || a.probe.reply) return null;
  return { ...a, probe: { ...a.probe, reply } };
}

/** An Accepted BootNotification was committed on a current socket of this placement. Also clears `incomplete` (a late boot). */
export function completeActivation(a: BootActivation | null, placementId: string, now: number): BootActivation | null {
  if (!a || a.phase === "done" || a.placementId !== placementId) return null;
  return { ...a, phase: "done", doneAt: now };
}

/** The socket of this attempt is gone: it can no longer be probed or answer. A newer connection starts its own attempt. */
export function abandonActivation(a: BootActivation | null, generation: number): BootActivation | null {
  if (!isOpenActivation(a) || a.generation !== generation) return null;
  return { ...a, phase: "incomplete", reason: "disconnected" };
}
