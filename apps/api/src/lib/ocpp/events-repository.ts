/**
 * Events repository — the event-log-first write path for OCPP ingest.
 *
 * Ported from src/lib/repositories/events.ts to apps/api per Sprint S1.
 * The dispatcher table (`PROJECTIONS`), the idempotency-key derivation
 * (scope + eventId), the dedupe TTL, and the Serializable transaction
 * isolation are preserved **byte-for-byte** so a brief overlap window
 * during cutover (or after rollback) cannot double-write.
 *
 * Key change vs the UI-Worker version: this module no longer wraps
 * `withOrgContext` — that helper was a UI-Worker tenancy primitive
 * that doesn't fit the API Worker's per-request makePrisma factory.
 * The route handler passes the PrismaClient directly. The orgId still
 * scopes the event-log row; nothing about the multi-tenant boundary
 * relaxes.
 *
 * Sprint 1.1 scope: idempotent single-event ingest. One Postgres
 * transaction per envelope:
 *
 *   1. Upsert `events.idempotency_keys` (scope = 'ocpp', key = eventId).
 *      If the row already exists, return its cached `result` and do
 *      nothing else. Makes retry from the gateway side safe — DO-side
 *      retry (ADR 0004) may fire the same event multiple times if the
 *      API ack is lost; we count it exactly once.
 *
 *   2. Insert one log row carrying the submitted retention class,
 *      payload, and metadata. ADR 0039 D1 routes `raw_protocol` frames
 *      to `events.protocol_log` and everything else to
 *      `events.event_log`; the two tables have the same shape.
 *
 *   3. Dispatch a projection by event type. Sprint 1.2 wired
 *      handlers; today's set lives in ./projections.
 *
 *   4. Persist the idempotency result with the response we are about
 *      to return to the gateway.
 *
 * All four steps ride one `$transaction` — either everything commits
 * or nothing does. A crash mid-flight leaves no event log row and no
 * idempotency record, so the next retry replays cleanly.
 */
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { IngestEvent } from "./event-envelope";

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
 * Pure projection dispatcher — keyed by eventType. Handlers register
 * themselves at module-load via `registerProjection`; the apps/api
 * bootstrap calls `registerAllProjections()` from ./projections.
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

const PROJECTIONS: Record<string, ProjectionHandler> = {};

/**
 * Top-level entrypoint. The route handler calls this with a
 * per-request PrismaClient minted by makePrisma(env). Wraps the
 * single-event ingest in a Serializable transaction so projection
 * failure rolls back the log row.
 */
export async function ingestEvent(
  db: PrismaClient,
  event: IngestEvent,
): Promise<IngestResult> {
  return db.$transaction(
    async (tx) => ingestEventInTx(tx, event.orgId, event),
    { isolationLevel: "Serializable" },
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

  // ADR 0039 D1 — raw OCPP frames land in events.protocol_log, domain
  // facts stay in events.event_log. Identical column shape, identical
  // idempotency semantics; only the table differs. Routed by retention
  // class, never by event type, so a new `ocpp.raw.*` frame goes to the
  // right table without anyone updating a list.
  //
  // The dispatch below is deliberately UNCHANGED: projections run off
  // the envelope, not the log row, and both writes ride the same
  // transaction — so the Sprint 5 atomicity invariant (log row and
  // projection commit together or not at all) holds exactly as before.
  const data = {
    orgId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion ?? 1,
    payload: event.payload as Prisma.InputJsonValue,
    metadata: { correlationId: event.correlationId },
    retentionClass: event.retentionClass,
    occurredAt: new Date(event.occurredAt),
  };

  const entry =
    event.retentionClass === "raw_protocol"
      ? await tx.protocolLogEntry.create({ data, select: { id: true } })
      : await tx.eventLogEntry.create({ data, select: { id: true } });

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
 * Typed hook for projection registration — ./projections calls
 * `registerProjection("charger.booted", handler)` at module load time.
 */
export function registerProjection(
  eventType: string,
  handler: ProjectionHandler,
): void {
  PROJECTIONS[eventType] = handler;
}

/** Escape hatch for tests — reset projections between runs. */
export function __resetProjectionsForTests(): void {
  for (const k of Object.keys(PROJECTIONS)) delete PROJECTIONS[k];
}

/** Typed re-export so callers don't have to import Prisma directly. */
export type EventsPrismaClient = PrismaClient;
