/**
 * Missed-heartbeat liveness sweeper.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────
 *
 * `recordFrame` in heartbeat-fastpath.ts computes liveness when a frame
 * ARRIVES. That covers going online and recovering. It cannot cover going
 * offline, because going offline is the absence of a frame and absence does
 * not call a handler. The 2026-08-11 run recorded this as its second finding:
 * "missed heartbeats create no event — a charger that dies silently is never
 * reported." heartbeat-fastpath.ts:31 already says as much: "absence needs a
 * timer, not a handler", and emits `expectedNextHeartbeatAt` for a sweep that
 * did not exist. This is that sweep.
 *
 * ── WHY PURE ───────────────────────────────────────────────────────────
 *
 * The mechanism decision (DO alarm vs scheduled Worker vs queue consumer vs
 * Workflow vs API cron) changes what deploys, and deploy decisions are not
 * this run's to make. The logic does not depend on it, so the logic ships now
 * and the adapter is gated. See docs/notes/2026-08-18-release-ops-queue.md
 * for the comparison and the recommendation.
 *
 * ── THE ONE RULE ───────────────────────────────────────────────────────
 *
 * EMIT ON TRANSITION, NEVER ON STATE. A sweeper that emits "still offline"
 * every tick turns one dead charger into 24 alerts a day, and the fleet is
 * 21 chargers. The `offlineEventEmitted` latch is what makes the second sweep
 * silent, and there is a fool-test that removes it.
 */

import type { LivenessState } from "./heartbeat-fastpath";

export interface SweepConfig {
  /**
   * Silence, as a multiple of the identity's OWN heartbeat interval, before it
   * counts as offline. Never 1: a single late heartbeat is jitter.
   */
  offlineAfterMissedIntervals: number;
  /**
   * Absolute slack on top, for delayed queues, a slow sweep tick, and clock
   * skew between the charger and the edge. Additive rather than multiplicative
   * so that a short interval does not get a proportionally tiny allowance.
   */
  graceMs: number;
}

export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  offlineAfterMissedIntervals: 3,
  graceMs: 5 * 60 * 1000,
};

/**
 * What the sweeper needs to know about one identity.
 *
 * Deliberately carries IDs and nothing else. No idTag, no credential, no
 * serial, no raw frame, no payload. An alerting path that needs more than
 * org/site/connector to be actionable has a naming problem, not a data
 * problem — and every extra field here is a field that ends up in a log.
 */
export interface SweepSubject {
  identityId: string;
  orgId: string;
  siteId: string | null;
  connectorId: string | null;
  /** Deliberately out of service. Never swept, never alerted on. */
  enabled: boolean;
  /**
   * This identity's own interval. Per-charger rather than per-Worker, because
   * a mixed fleet has mixed intervals and a global constant would mark the
   * slow half of it offline.
   */
  heartbeatIntervalMs: number;
  /** Null when the identity has never been seen. */
  liveness: LivenessState | null;
  /** Latch: an offline event has already been emitted for the CURRENT silence. */
  offlineEventEmitted: boolean;
}

export interface SweepDecision {
  identityId: string;
  orgId: string;
  siteId: string | null;
  connectorId: string | null;
  /** True only on the sweep where the identity crosses into offline. */
  emit: boolean;
  transition: "offline" | null;
  /** How long the identity has been silent, ms. Never negative. */
  silenceMs: number;
  /** Whether the identity is considered offline as of this sweep. */
  offline: boolean;
  /** Persist these two fields. */
  next: { online: boolean; offlineEventEmitted: boolean };
  /** Why nothing was emitted, when nothing was. For operators reading a sweep log. */
  reason:
    | "emitted"
    | "disabled"
    | "never-seen"
    | "within-threshold"
    | "already-emitted"
    | "clock-skew";
}

export function offlineThresholdMs(
  subject: Pick<SweepSubject, "heartbeatIntervalMs">,
  cfg: SweepConfig = DEFAULT_SWEEP_CONFIG,
): number {
  return subject.heartbeatIntervalMs * cfg.offlineAfterMissedIntervals + cfg.graceMs;
}

/**
 * Evaluate one identity at sweep time.
 *
 * Pure. `now` is passed in rather than read from a clock so that skew,
 * rollover and delayed ticks are testable rather than aspirational.
 */
export function sweepOne(
  subject: SweepSubject,
  now: number,
  cfg: SweepConfig = DEFAULT_SWEEP_CONFIG,
): SweepDecision {
  const base = {
    identityId: subject.identityId,
    orgId: subject.orgId,
    siteId: subject.siteId,
    connectorId: subject.connectorId,
  };
  const quiet = (
    reason: SweepDecision["reason"],
    silenceMs: number,
    offline: boolean,
    online: boolean,
  ): SweepDecision => ({
    ...base,
    emit: false,
    transition: null,
    silenceMs,
    offline,
    next: { online, offlineEventEmitted: subject.offlineEventEmitted },
    reason,
  });

  // A charger taken out of service on purpose is not an incident.
  if (!subject.enabled) return quiet("disabled", 0, false, subject.liveness?.online ?? false);

  // Never seen: it cannot go offline, because it was never online. Emitting
  // here would alert on every identity row that exists but has not connected,
  // which is exactly the noise that makes people mute an alert channel.
  if (!subject.liveness) return quiet("never-seen", 0, false, false);

  const rawSilence = now - subject.liveness.lastSeenAt;

  // Clock skew or a replayed tick. Never emit on a negative silence, and never
  // let it read as "seen very recently" either — report zero and say why.
  if (rawSilence < 0) return quiet("clock-skew", 0, false, subject.liveness.online);

  const threshold = offlineThresholdMs(subject, cfg);
  if (rawSilence <= threshold) {
    // Back within the threshold — the latch resets so a future outage emits
    // again. Without this, a charger that flaps once is never reported again.
    return {
      ...base,
      emit: false,
      transition: null,
      silenceMs: rawSilence,
      offline: false,
      next: { online: true, offlineEventEmitted: false },
      reason: "within-threshold",
    };
  }

  // Past the threshold. Emit exactly once.
  if (subject.offlineEventEmitted) {
    return {
      ...base,
      emit: false,
      transition: null,
      silenceMs: rawSilence,
      offline: true,
      next: { online: false, offlineEventEmitted: true },
      reason: "already-emitted",
    };
  }

  return {
    ...base,
    emit: true,
    transition: "offline",
    silenceMs: rawSilence,
    offline: true,
    next: { online: false, offlineEventEmitted: true },
    reason: "emitted",
  };
}

export function sweep(
  subjects: readonly SweepSubject[],
  now: number,
  cfg: SweepConfig = DEFAULT_SWEEP_CONFIG,
): SweepDecision[] {
  return subjects.map((s) => sweepOne(s, now, cfg));
}

/**
 * Clear the latch when a frame arrives.
 *
 * `recordFrame` already emits the "online" recovery transition; this only
 * releases the sweeper's latch so the NEXT outage is reportable. Calling it
 * twice is a no-op, which is what makes recovery emit once.
 */
export function clearOfflineLatch(
  subject: Pick<SweepSubject, "offlineEventEmitted">,
): { offlineEventEmitted: boolean } {
  return { offlineEventEmitted: false };
}

/** Group emitted transitions for alerting. One alert per site beats N per charger. */
export function groupBySite(
  decisions: readonly SweepDecision[],
): Map<string, SweepDecision[]> {
  const out = new Map<string, SweepDecision[]>();
  for (const d of decisions) {
    if (!d.emit) continue;
    const key = `${d.orgId}/${d.siteId ?? "unsited"}`;
    const list = out.get(key) ?? [];
    list.push(d);
    out.set(key, list);
  }
  return out;
}

export function groupByOrg(decisions: readonly SweepDecision[]): Map<string, SweepDecision[]> {
  const out = new Map<string, SweepDecision[]>();
  for (const d of decisions) {
    if (!d.emit) continue;
    const list = out.get(d.orgId) ?? [];
    list.push(d);
    out.set(d.orgId, list);
  }
  return out;
}

/**
 * The closed set of fields an emitted event may carry.
 *
 * Asserted by a test. A closed vocabulary is the only way "we do not log
 * idTags" stays true past the next person who adds a helpful field.
 */
export const SWEEP_EVENT_FIELDS = [
  "identityId",
  "orgId",
  "siteId",
  "connectorId",
  "transition",
  "silenceMs",
] as const;

export function toEvent(d: SweepDecision): Record<string, unknown> {
  return {
    identityId: d.identityId,
    orgId: d.orgId,
    siteId: d.siteId,
    connectorId: d.connectorId,
    transition: d.transition,
    silenceMs: d.silenceMs,
  };
}
