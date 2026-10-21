/**
 * Heartbeat fast path, liveness transitions, and the per-connector frame cap.
 *
 * WHY THIS EXISTS
 *
 * `handleInboundCall` enqueued every OCPP Call frame, Heartbeat included. The
 * retention class was computed correctly and Heartbeat was correctly classified
 * disposable — but the classification travelled *on* the queue message rather
 * than gating the send, so the queue operation was already paid for by the time
 * anything downstream knew the frame carried nothing.
 *
 * An idle connector emits one heartbeat an hour: ~720 a month. Each one bought a
 * queue operation, a consumer invocation, and a row that a TTL later deletes.
 * Core prices at 200 kr per connector per month, capped at 450 kr, so a cost that
 * scales with FRAMES rather than with SESSIONS is the one thing the price cannot
 * absorb.
 *
 * WHY IT IS A SEPARATE, PURE MODULE
 *
 * Every function here is pure: state in, decision out, no `this`, no storage, no
 * network, no Durable Object. That is deliberate. The DO only runs inside
 * workerd, so logic embedded in it can only be tested with the full Cloudflare
 * test harness. These rules are the part most likely to be got wrong and most
 * worth testing exhaustively, so they are pulled out where a plain Node process
 * can exercise them.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 * It does not detect a charger going *offline*. A charger that vanishes sends no
 * frame, so nothing here can observe it — offline is the absence of an event, and
 * absence needs a timer, not a handler. `expectedNextHeartbeatAt` is emitted so an
 * alarm or a sweep can do that job, and until one exists, online→offline is
 * genuinely undetected. That gap is stated rather than papered over.
 */

/** Frames whose only content is liveness plus a clock. */
const LIVENESS_ONLY_ACTIONS = new Set<string>(["Heartbeat"]);

/**
 * Frames that must NEVER be dropped by the frame cap, however noisy the
 * connector is. A charger stuck in a reconnect loop is a cost problem; a
 * charger whose StopTransaction was discarded is a billing dispute.
 */
export const CAP_EXEMPT_ACTIONS = new Set<string>([
  "StartTransaction",
  "StopTransaction",
  "MeterValues",
  "Authorize",
  "BootNotification",
]);

export interface LivenessState {
  /** Epoch ms of the last frame of any kind from this identity. */
  lastSeenAt: number;
  /** What we last told the rest of the system. */
  online: boolean;
  /** Epoch ms when `online` last changed, for downtime arithmetic. */
  onlineSince: number;
  /** Bucket start (epoch ms, hour-aligned) for the current rollup. */
  rollupHourStartedAt: number;
  /** Frames counted into the current rollup bucket, by action. */
  rollupCounts: Record<string, number>;
}

export interface LivenessDecision {
  next: LivenessState;
  /** Emit a durable transition event. Only true when `online` actually flipped. */
  emitTransition: boolean;
  transition: "online" | "offline" | null;
  /** Milliseconds the identity was in the previous state. */
  previousStateDurationMs: number | null;
  /** Flush the completed rollup bucket. True only when the hour rolls over. */
  flushRollup: boolean;
  flushedBucket: { startedAt: number; endedAt: number; counts: Record<string, number> } | null;
  /** When a heartbeat is next expected, for a sweep to detect silence. */
  expectedNextHeartbeatAt: number;
}

export interface LivenessConfig {
  /** Locked at one hour by the product frame. */
  idleHeartbeatIntervalMs: number;
  /**
   * How much silence counts as offline. A multiple of the interval, never equal
   * to it: one late heartbeat is jitter, not an outage, and flapping between
   * online and offline generates exactly the event volume this module exists to
   * avoid.
   */
  offlineAfterMissedIntervals: number;
  rollupBucketMs: number;
}

export const DEFAULT_LIVENESS_CONFIG: LivenessConfig = {
  idleHeartbeatIntervalMs: 60 * 60 * 1000,
  offlineAfterMissedIntervals: 3,
  rollupBucketMs: 60 * 60 * 1000,
};

/**
 * Does this frame carry anything the ingest pipeline needs?
 *
 * Deliberately an allow-list of things to DROP rather than a list of things to
 * keep. An unrecognised action must reach the pipeline: an untriaged frame type
 * is far more likely to be something new that matters than something disposable.
 * Fail long, not short — the same reasoning `retentionClassFor` already uses for
 * its default.
 */
export function bypassesIngest(action: string): boolean {
  return LIVENESS_ONLY_ACTIONS.has(action);
}

export function initialLiveness(now: number, bucketMs: number): LivenessState {
  return {
    lastSeenAt: now,
    online: true,
    onlineSince: now,
    rollupHourStartedAt: Math.floor(now / bucketMs) * bucketMs,
    rollupCounts: {},
  };
}

/**
 * Fold one frame into liveness state.
 *
 * Pure: it never writes. The caller persists `decision.next` and acts on the
 * emit/flush flags. Splitting it this way means the interesting behaviour —
 * when a transition fires, when a bucket rolls — is testable without a DO.
 */
export function recordFrame(
  prev: LivenessState | null,
  action: string,
  now: number,
  cfg: LivenessConfig = DEFAULT_LIVENESS_CONFIG,
): LivenessDecision {
  const bucketMs = cfg.rollupBucketMs;
  const bucketStart = Math.floor(now / bucketMs) * bucketMs;

  // First contact. Treat as a transition to online so the rest of the system
  // learns the identity exists, rather than inferring it from silence.
  if (!prev) {
    const next = initialLiveness(now, bucketMs);
    next.rollupCounts = { [action]: 1 };
    return {
      next,
      emitTransition: true,
      transition: "online",
      previousStateDurationMs: null,
      flushRollup: false,
      flushedBucket: null,
      expectedNextHeartbeatAt: now + cfg.idleHeartbeatIntervalMs,
    };
  }

  // Was the identity silent long enough that anyone watching would have called
  // it offline? If so this frame is a recovery, and the recovery is the event.
  const silenceMs = now - prev.lastSeenAt;
  const offlineThreshold = cfg.idleHeartbeatIntervalMs * cfg.offlineAfterMissedIntervals;
  const wasEffectivelyOffline = !prev.online || silenceMs > offlineThreshold;

  const rolled = bucketStart !== prev.rollupHourStartedAt;
  const flushedBucket = rolled
    ? { startedAt: prev.rollupHourStartedAt, endedAt: bucketStart, counts: { ...prev.rollupCounts } }
    : null;

  const counts = rolled ? {} : { ...prev.rollupCounts };
  counts[action] = (counts[action] ?? 0) + 1;

  const next: LivenessState = {
    lastSeenAt: now,
    online: true,
    onlineSince: wasEffectivelyOffline ? now : prev.onlineSince,
    rollupHourStartedAt: bucketStart,
    rollupCounts: counts,
  };

  return {
    next,
    emitTransition: wasEffectivelyOffline,
    transition: wasEffectivelyOffline ? "online" : null,
    previousStateDurationMs: wasEffectivelyOffline ? now - prev.lastSeenAt : null,
    flushRollup: rolled && Object.keys(flushedBucket?.counts ?? {}).length > 0,
    flushedBucket,
    expectedNextHeartbeatAt: now + cfg.idleHeartbeatIntervalMs,
  };
}

// ── Per-connector frame cap ─────────────────────────────────────────

export interface FrameCapState {
  windowStartedAt: number;
  count: number;
  /** Set when the cap was breached in the current window. */
  quarantinedUntil: number | null;
  /** How many windows in a row this identity has breached. */
  consecutiveBreaches: number;
}

export interface FrameCapConfig {
  windowMs: number;
  /** Frames per window before ingest is shed. */
  maxFramesPerWindow: number;
  /** How long ingest stays shed once breached. */
  quarantineMs: number;
  /** Consecutive breaches before this is an anomaly worth a human. */
  anomalyAfterConsecutiveBreaches: number;
}

export const DEFAULT_FRAME_CAP: FrameCapConfig = {
  windowMs: 60 * 60 * 1000,
  // An idle connector sends 1/hour. A busy one in session sends meter values —
  // the real interval is TBD from charger data, so this is set well above any
  // plausible legitimate rate rather than tuned to a number nobody has measured.
  maxFramesPerWindow: 120,
  quarantineMs: 60 * 60 * 1000,
  anomalyAfterConsecutiveBreaches: 3,
};

export interface FrameCapDecision {
  next: FrameCapState;
  /** Drop this frame's INGEST. The protocol reply is always still sent. */
  shedIngest: boolean;
  /** Cross the cap on this exact frame — emit one anomaly event, not one per frame. */
  emitBreachEvent: boolean;
  /** Repeated breaches: this needs a human, not just shedding. */
  emitAnomalyEvent: boolean;
  reason: string | null;
}

export function initialFrameCap(now: number, cfg: FrameCapConfig = DEFAULT_FRAME_CAP): FrameCapState {
  return { windowStartedAt: Math.floor(now / cfg.windowMs) * cfg.windowMs, count: 0, quarantinedUntil: null, consecutiveBreaches: 0 };
}

/**
 * Decide whether this frame's ingest is shed.
 *
 * Two invariants, both load-bearing:
 *
 *   1. The OCPP reply is NEVER withheld. Shedding ingest is a cost control;
 *      withholding a protocol reply would break charging. A quarantined charger
 *      still charges — it just stops filling the pipeline.
 *   2. Financial frames are never shed. A discarded StopTransaction is a billing
 *      dispute, which costs more than any queue operation it saved.
 */
export function frameCapDecision(
  prev: FrameCapState | null,
  action: string,
  now: number,
  cfg: FrameCapConfig = DEFAULT_FRAME_CAP,
): FrameCapDecision {
  const windowStart = Math.floor(now / cfg.windowMs) * cfg.windowMs;
  const state = prev ?? initialFrameCap(now, cfg);

  const rolled = windowStart !== state.windowStartedAt;
  const wasOverInPrevWindow = !rolled ? false : state.count > cfg.maxFramesPerWindow;
  const count = (rolled ? 0 : state.count) + 1;
  const consecutive = rolled
    ? (wasOverInPrevWindow ? state.consecutiveBreaches : 0)
    : state.consecutiveBreaches;

  const next: FrameCapState = {
    windowStartedAt: windowStart,
    count,
    quarantinedUntil: rolled ? null : state.quarantinedUntil,
    consecutiveBreaches: consecutive,
  };

  if (CAP_EXEMPT_ACTIONS.has(action)) {
    return { next, shedIngest: false, emitBreachEvent: false, emitAnomalyEvent: false, reason: null };
  }

  const stillQuarantined = next.quarantinedUntil != null && now < next.quarantinedUntil;
  if (stillQuarantined) {
    return { next, shedIngest: true, emitBreachEvent: false, emitAnomalyEvent: false, reason: "quarantined" };
  }

  if (count > cfg.maxFramesPerWindow) {
    const crossingNow = count === cfg.maxFramesPerWindow + 1;
    next.quarantinedUntil = now + cfg.quarantineMs;
    if (crossingNow) next.consecutiveBreaches = consecutive + 1;
    return {
      next,
      shedIngest: true,
      emitBreachEvent: crossingNow,
      emitAnomalyEvent: crossingNow && next.consecutiveBreaches >= cfg.anomalyAfterConsecutiveBreaches,
      reason: `frame cap exceeded: ${count} > ${cfg.maxFramesPerWindow} in ${cfg.windowMs}ms`,
    };
  }

  return { next, shedIngest: false, emitBreachEvent: false, emitAnomalyEvent: false, reason: null };
}

// ───────────────────────────────────────────────────────────────────
// BootNotification interval
// ───────────────────────────────────────────────────────────────────

/**
 * The interval, in seconds, the gateway asks a charger to heartbeat at
 * in its BootNotification reply.
 *
 * This is deliberately DERIVED from `idleHeartbeatIntervalMs` rather
 * than being an independent constant. The two numbers must agree: the
 * liveness window declares a charger offline after
 * `offlineAfterMissedIntervals` idle intervals, so if BootNotification
 * asked for 60 s while liveness assumed 3600 s, a perfectly healthy
 * charger would be judged against a window 60x too wide — and the cost
 * model, which is sized off this number, would be wrong by the same
 * factor. Deriving it makes that class of drift unrepresentable.
 *
 * Product frame: 3600 s. See docs/notes/2026-08-11-ocpp-heartbeat-
 * interval-and-cost-gate.md.
 */
export const PRODUCT_HEARTBEAT_INTERVAL_SECONDS = 3600;

/** Range a charger-facing interval may legally take (OCPP 1.6J leaves this open). */
export const MIN_HEARTBEAT_INTERVAL_SECONDS = 60;
export const MAX_HEARTBEAT_INTERVAL_SECONDS = 86_400;

export function bootNotificationIntervalSeconds(
  cfg: LivenessConfig = DEFAULT_LIVENESS_CONFIG,
): number {
  return Math.round(cfg.idleHeartbeatIntervalMs / 1000);
}

/**
 * Resolves the interval to advertise, allowing an env override for the
 * case the prompt anticipates: hardware that proves a different safe
 * value. An override outside the legal range, or unparseable, is
 * ignored in favour of the product frame — a typo must never be able to
 * put the fleet on a 1-second heartbeat.
 *
 * Returns the value plus why it was chosen, so the caller can log the
 * decision rather than silently swallowing a rejected override.
 */
export function resolveHeartbeatIntervalSeconds(raw: string | undefined | null): {
  seconds: number;
  source: "product-default" | "env-override" | "rejected-override";
} {
  const fallback = bootNotificationIntervalSeconds();
  if (raw == null || raw.trim() === "") {
    return { seconds: fallback, source: "product-default" };
  }
  const parsed = Number(raw.trim());
  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < MIN_HEARTBEAT_INTERVAL_SECONDS ||
    parsed > MAX_HEARTBEAT_INTERVAL_SECONDS
  ) {
    return { seconds: fallback, source: "rejected-override" };
  }
  return { seconds: parsed, source: "env-override" };
}
