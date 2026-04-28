/**
 * Events repository — the event-log-first write path for OCPP ingest.
 *
 * Sprint 1.1 scope: idempotent single-event ingest. One Postgres
 * transaction per envelope:
 *
 *   1. Upsert `events.idempotency_keys` (scope = 'ocpp', key = eventId).
 *      If the row already exists, return its cached `result` and do
 *      nothing else. This makes retry from the gateway side safe —
 *      DO-side retry (see ADR 0004) may fire the same event multiple
 *      times if the main-app ack is lost; we must count it exactly
 *      once.
 *
 *   2. Insert one row into `events.event_log` carrying the submitted
 *      retention class, payload, and metadata.
 *
 *   3. Dispatch a projection by event type. In Sprint 1.1 the
 *      projection table is empty — no eventType has a handler yet.
 *      Unhandled events still land in the log (Principle 2: event log
 *      is source of truth, projections are derivations). Sprint 1.2
 *      fills in OCPP 1.6J event types.
 *
 *   4. Persist the idempotency result with the response we are about
 *      to return to the gateway.
 *
 * All four steps ride one `$transaction` — either everything commits
 * or nothing does. A crash mid-flight leaves no event log row and no
 * idempotency record, so the next retry replays cleanly.
 */
import type { Prisma, PrismaClient } from "straumvakt-prisma-cf-client/client";
import { withOrgContext } from "./_context";
import type { IngestEvent } from "@/lib/ocpp/event-envelope";

const IDEMPOTENCY_SCOPE = "ocpp";
/** Retain idempotency keys for one week — enough to cover any credible
 * gateway retry window while keeping the table small. Raw_protocol
 * events aging out of the event_log at 30–90d (see Architecture V3
 * §8) outlive this, so the idempotency window can be short. */
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IngestResult {
  accepted: true;
  eventId: string;
  /** True if this call caused a new event_log row; false on replay. */
  recorded: boolean;
  /** The event_log row id (stable across replays). */
  logEntryId: string;
}

/**
 * Pure projection dispatcher — keyed by eventType. Sprint 1.1 ships
 * empty. Handlers are added alongside the 1.2 domain event translator.
 *
 * A handler runs inside the same transaction as the event_log write,
 * so projection failure rolls back the log entry too. That is
 * deliberate: a projection failure means we have a bug, and silently
 * accepting the log row while the projection fails would break the
 * invariant that operational tables are faithful derivations.
 */
type ProjectionHandler = (
  tx: Prisma.TransactionClient,
  event: IngestEvent,
) => Promise<void>;

const PROJECTIONS: Record<string, ProjectionHandler> = {
  // Sprint 1.2 will register handlers here, e.g.:
  //   "charger.booted": async (tx, e) => { ... }
  //   "session.started": async (tx, e) => { ... }
};

export async function ingestEvent(event: IngestEvent): Promise<IngestResult> {
  return withOrgContext(event.orgId, async ({ db, orgId }) =>
    db.$transaction(
      async (tx) => ingestEventInTx(tx, orgId, event),
      { isolationLevel: "Serializable" },
    ),
  );
}

/**
 * Exposed for direct unit testing with a stubbed transaction client —
 * the route handler only calls `ingestEvent` above.
 */
export async function ingestEventInTx(
  tx: Prisma.TransactionClient,
  orgId: string,
  event: IngestEvent,
): Promise<IngestResult> {
  const existing = await tx.idempotencyKey.findUnique({
    where: {
      scope_key: { scope: IDEMPOTENCY_SCOPE, key: event.eventId },
    },
  });

  if (existing && existing.result) {
    // Replay path — return the cached result unchanged. Do not touch
    // event_log or projections; they already ran on the original call.
    return existing.result as unknown as IngestResult;
  }

  const entry = await tx.eventLogEntry.create({
    data: {
      orgId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      schemaVersion: event.schemaVersion ?? 1,
      payload: event.payload as Prisma.InputJsonValue,
      metadata: { correlationId: event.correlationId },
      retentionClass: event.retentionClass,
      occurredAt: new Date(event.occurredAt),
    },
    select: { id: true },
  });

  const handler = PROJECTIONS[event.eventType];
  if (handler) {
    await handler(tx, event);
  }

  const result: IngestResult = {
    accepted: true,
    eventId: event.eventId,
    recorded: true,
    logEntryId: entry.id,
  };

  await tx.idempotencyKey.create({
    data: {
      scope: IDEMPOTENCY_SCOPE,
      key: event.eventId,
      result: result as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    },
  });

  return result;
}

/**
 * Typed hook for Sprint 1.2's domain event translator — it will call
 * `registerProjection("charger.booted", handler)` at module load time.
 * Kept internal to this file so the dispatcher remains a single point
 * of truth.
 */
export function registerProjection(eventType: string, handler: ProjectionHandler): void {
  PROJECTIONS[eventType] = handler;
}

/** Escape hatch for tests — reset projections between runs. */
export function __resetProjectionsForTests(): void {
  for (const k of Object.keys(PROJECTIONS)) delete PROJECTIONS[k];
}

/** Typed re-export so callers don't have to import Prisma directly. */
export type EventsPrismaClient = PrismaClient;
