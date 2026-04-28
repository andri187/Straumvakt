/**
 * Gateway → main-app event envelope.
 *
 * The gateway (`straumvakt-ocpp`) translates OCPP 1.6J / 2.0.1 messages
 * into named domain events (Sprint 1.2) and delivers them here via
 * Cloudflare Service Binding (ADR 0004). Each call carries exactly one
 * event, already in domain vocabulary — this route never sees OCPP
 * vocabulary (Architecture V3 §2 principle 4).
 *
 * The envelope shape is queue-migratable: if we move to Cloudflare
 * Queues in a later sprint, the message body stays identical; only
 * transport changes.
 *
 * Retention classes come from the sender so the gateway can tag raw
 * protocol traces vs. operational state changes vs. financial events
 * without the main app having to classify them from the event type.
 */
import type { RetentionClass } from "@/generated/prisma/client";

export const RETENTION_CLASSES = [
  "financial",
  "operational",
  "raw_protocol",
  "aggregate",
  "issue_history",
] as const satisfies readonly RetentionClass[];

export interface IngestEvent {
  /** Stable id the gateway assigns at OCPP message receipt — idempotency key. */
  eventId: string;
  orgId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  /** ISO-8601 timestamp when the source event occurred (OCPP message time). */
  occurredAt: string;
  /** Request correlation id so a single OCPP message can be traced across services. */
  correlationId: string;
  retentionClass: RetentionClass;
  /** Arbitrary JSON payload — specific to eventType. Never OCPP vocabulary. */
  payload: Record<string, unknown>;
  /** Optional monotonic counter from the gateway's own DO; stored in metadata. */
  schemaVersion?: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isIso(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

function isRetention(v: unknown): v is RetentionClass {
  return typeof v === "string" && (RETENTION_CLASSES as readonly string[]).includes(v);
}

export type ValidationResult =
  | { ok: true; event: IngestEvent }
  | { ok: false; error: string };

/**
 * Validates a raw parsed JSON body as an `IngestEvent`. Rejects on the
 * first structural problem with a terse reason — the reason leaks out
 * to the gateway (our own code), not to the public internet, so it is
 * allowed to be specific.
 */
export function parseIngestEvent(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body not object" };
  const r = raw as Record<string, unknown>;

  if (!isUuid(r.eventId)) return { ok: false, error: "eventId not uuid" };
  if (!isUuid(r.orgId)) return { ok: false, error: "orgId not uuid" };
  if (typeof r.aggregateType !== "string" || r.aggregateType.length === 0)
    return { ok: false, error: "aggregateType missing" };
  if (!isUuid(r.aggregateId)) return { ok: false, error: "aggregateId not uuid" };
  if (typeof r.eventType !== "string" || r.eventType.length === 0)
    return { ok: false, error: "eventType missing" };
  if (!isIso(r.occurredAt)) return { ok: false, error: "occurredAt not iso" };
  if (!isUuid(r.correlationId)) return { ok: false, error: "correlationId not uuid" };
  if (!isRetention(r.retentionClass))
    return { ok: false, error: "retentionClass invalid" };
  if (!r.payload || typeof r.payload !== "object" || Array.isArray(r.payload))
    return { ok: false, error: "payload not object" };
  if (r.schemaVersion !== undefined && typeof r.schemaVersion !== "number")
    return { ok: false, error: "schemaVersion not number" };

  return {
    ok: true,
    event: {
      eventId: r.eventId,
      orgId: r.orgId,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      eventType: r.eventType,
      occurredAt: r.occurredAt,
      correlationId: r.correlationId,
      retentionClass: r.retentionClass,
      payload: r.payload as Record<string, unknown>,
      schemaVersion: r.schemaVersion as number | undefined,
    },
  };
}
