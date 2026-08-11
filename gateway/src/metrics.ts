/**
 * OCPP economics metrics — Workers Analytics Engine writer.
 *
 * Why Analytics Engine and not Neon: these are high-cardinality counts
 * whose value is entirely in aggregate. They must never compete with
 * business truth for storage, and they must never be on the restore
 * path — a telemetry write that fails is a lost data point, a business
 * write that fails is a lost session.
 *
 * Three properties this module is built to guarantee:
 *
 *  1. **No-op safe.** The binding is optional. Absent binding, or a
 *     binding that throws, must never affect the OCPP hot path. A
 *     charger does not stop charging because a counter failed.
 *  2. **Closed event vocabulary.** Event names are a union type, not
 *     strings, so a typo is a compile error rather than a metric that
 *     silently never appears on a dashboard.
 *  3. **No personal data, structurally.** The write surface accepts a
 *     fixed shape with no free-form payload field, so an OCPP frame
 *     cannot be passed through by accident. A runtime guard backs that
 *     up for the JS callers TypeScript cannot see.
 *
 * The pair that matters most is `heartbeats_received` against
 * `heartbeats_suppressed`: their ratio is the fast path's health as a
 * number. If suppression collapses, cost silently returns to the
 * pre-fix baseline and nothing else in the system notices.
 */
import type { AnalyticsEngineLike } from "./auth";

/** Closed vocabulary. Adding a metric is a deliberate edit here. */
export type MetricName =
  | "heartbeats_received"
  | "heartbeats_suppressed"
  | "missed_heartbeats"
  | "queue_messages_by_type"
  | "noisy_charger_events"
  | "gateway_errors_by_type"
  | "billing_job_started"
  | "billing_job_completed"
  | "billing_job_failed";

export const METRIC_NAMES: readonly MetricName[] = [
  "heartbeats_received",
  "heartbeats_suppressed",
  "missed_heartbeats",
  "queue_messages_by_type",
  "noisy_charger_events",
  "gateway_errors_by_type",
  "billing_job_started",
  "billing_job_completed",
  "billing_job_failed",
] as const;

/**
 * The only dimensions a metric may carry. Deliberately not
 * `Record<string, string>` — a free-form bag is how an idTag ends up in
 * telemetry.
 *
 * `identity` is a *charger* identity (an OCPP station id such as
 * ZPR074002). It is pseudonymised before it is written; see
 * `pseudonymiseIdentity`.
 */
export interface MetricDimensions {
  /** Raw charger identity. Pseudonymised by the writer, never written raw. */
  identity?: string;
  /** OCPP action or event type, e.g. "Heartbeat", "MeterValues". */
  eventType?: string;
  /** Error class, e.g. "parse_error". Never an error *message*. */
  errorKind?: string;
  /** Billing period key, e.g. "2026-08". */
  period?: string;
}

/**
 * Values that must never reach telemetry, checked at runtime as
 * defence in depth behind the type system.
 *
 * `idTag` is the important one: in OCPP it identifies a driver's RFID
 * token, so an unscrubbed idTag in an analytics blob is a personal-data
 * export. The others catch credential-shaped strings that occasionally
 * travel in the same structures.
 */
const FORBIDDEN_DIMENSION_KEYS = new Set([
  "idtag",
  "idtaginfo",
  "authorization",
  "password",
  "token",
  "secret",
  "dsn",
  "email",
  "vin",
]);

/**
 * FNV-1a, 32-bit, hex. Chosen because it is synchronous — the hot path
 * cannot await a hash — and because the requirement here is
 * pseudonymisation for dashboard grouping, not secrecy.
 *
 * This is explicitly NOT anonymisation. With a known salt and a known
 * charger list the mapping is reversible by brute force in
 * milliseconds. It exists so that a leaked analytics export does not
 * hand over a customer's site inventory in plaintext, not so that the
 * operator cannot identify a charger. Rotate `salt` and the series
 * breaks, which is why it is stable per-deployment rather than random.
 */
export function pseudonymiseIdentity(identity: string, salt = ""): string {
  const input = `${salt}:${identity}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `cid_${h.toString(16).padStart(8, "0")}`;
}

/**
 * Strips anything not in the allowed dimension set and pseudonymises
 * the identity. Returns the blob array Analytics Engine expects.
 *
 * Order is fixed and positional because Analytics Engine blobs are
 * indexed, not named: blob1 = metric, blob2 = identity, blob3 = event
 * type, blob4 = error kind, blob5 = period. A dashboard query depends
 * on this order, so it is asserted in the tests.
 */
export function buildBlobs(
  name: MetricName,
  dims: MetricDimensions,
  salt = "",
): string[] {
  for (const key of Object.keys(dims)) {
    if (FORBIDDEN_DIMENSION_KEYS.has(key.toLowerCase())) {
      throw new Error(`metrics: forbidden dimension "${key}"`);
    }
  }
  return [
    name,
    dims.identity ? pseudonymiseIdentity(dims.identity, salt) : "",
    dims.eventType ?? "",
    dims.errorKind ?? "",
    dims.period ?? "",
  ];
}

export interface MetricsWriter {
  /** Records one occurrence. `value` defaults to 1. */
  count: (name: MetricName, dims?: MetricDimensions, value?: number) => void;
  /** True when a real binding is attached — for tests and health output. */
  readonly enabled: boolean;
}

/**
 * Builds a writer over an optional binding.
 *
 * Every failure mode collapses to "do nothing": no binding, a binding
 * that throws, a forbidden dimension, a non-finite value. The gateway's
 * correctness must not depend on telemetry succeeding, so this function
 * never throws and never rejects.
 */
export function createMetricsWriter(
  binding: AnalyticsEngineLike | undefined,
  opts: { salt?: string; onError?: (err: unknown) => void } = {},
): MetricsWriter {
  const salt = opts.salt ?? "";
  const enabled = typeof binding?.writeDataPoint === "function";

  return {
    enabled,
    count(name: MetricName, dims: MetricDimensions = {}, value = 1) {
      if (!enabled) return;
      try {
        if (!Number.isFinite(value)) return;
        binding!.writeDataPoint({
          // Index is what Analytics Engine samples and groups by. The
          // metric name is the right choice: it keeps each series
          // independently queryable without making cardinality a
          // function of fleet size.
          indexes: [name],
          blobs: buildBlobs(name, dims, salt),
          doubles: [value],
        });
      } catch (err) {
        // Swallow deliberately. A telemetry failure is not an OCPP
        // failure. Surfaced through onError so tests can assert it was
        // seen rather than silently lost.
        opts.onError?.(err);
      }
    },
  };
}

/** A writer with no binding — the shape tests and local dev use. */
export const NOOP_METRICS: MetricsWriter = createMetricsWriter(undefined);
