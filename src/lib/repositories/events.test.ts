/**
 * Sprint 1.1 exit test — idempotent event ingest.
 *
 * Exit criterion: "Replaying the same `eventId` posted twice produces
 * exactly one event-log row and one projection dispatch."
 *
 * These tests exercise `ingestEventInTx` with an in-memory transaction
 * stub — faster and more deterministic than round-tripping Postgres.
 * The real DB integration test lands in Sprint 1.5 (end-to-end with
 * the simulator). At that point a correct replay is observable
 * end-to-end; here we prove the unit-level invariant.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: () => ({}) as never }));

import {
  ingestEventInTx,
  registerProjection,
  __resetProjectionsForTests,
} from "./events";
import type { IngestEvent } from "@/lib/ocpp/event-envelope";

const ORG = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";
const AGG_ID = "33333333-3333-3333-3333-333333333333";
const CORR_ID = "44444444-4444-4444-4444-444444444444";

function event(overrides: Partial<IngestEvent> = {}): IngestEvent {
  return {
    eventId: EVENT_ID,
    orgId: ORG,
    aggregateType: "charger",
    aggregateId: AGG_ID,
    eventType: "charger.booted",
    occurredAt: "2026-04-24T09:00:00.000Z",
    correlationId: CORR_ID,
    retentionClass: "operational",
    payload: { firmware: "1.0.0" },
    ...overrides,
  };
}

/**
 * In-memory Prisma transaction stub. Models the two tables we write to:
 *   events.event_log (append), events.idempotency_keys (composite-pk upsert-on-read).
 */
function makeTx() {
  const logRows: Array<{ id: string; eventType: string; orgId: string }> = [];
  const idemRows: Map<string, { result: unknown; expiresAt: Date }> = new Map();
  let nextLogId = 1;

  const tx = {
    idempotencyKey: {
      findUnique: vi.fn(async ({ where }: { where: { scope_key: { scope: string; key: string } } }) => {
        const row = idemRows.get(`${where.scope_key.scope}:${where.scope_key.key}`);
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: { data: { scope: string; key: string; result: unknown; expiresAt: Date } }) => {
        idemRows.set(`${data.scope}:${data.key}`, { result: data.result, expiresAt: data.expiresAt });
        return { scope: data.scope, key: data.key };
      }),
    },
    eventLogEntry: {
      create: vi.fn(async ({ data, select: _select }: { data: { orgId: string; eventType: string }; select?: unknown }) => {
        const id = String(nextLogId++).padStart(32, "0").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
        logRows.push({ id, eventType: data.eventType, orgId: data.orgId });
        return { id };
      }),
    },
  };

  return { tx, logRows, idemRows };
}

describe("ingestEventInTx — idempotency", () => {
  beforeEach(() => {
    __resetProjectionsForTests();
  });

  it("records exactly one event_log row + one idempotency row on first call", async () => {
    const { tx, logRows, idemRows } = makeTx();
    // biome-ignore lint/suspicious/noExplicitAny: unit-test stub
    const result = await ingestEventInTx(tx as any, ORG, event());

    expect(logRows).toHaveLength(1);
    expect(idemRows.size).toBe(1);
    expect(result.recorded).toBe(true);
    expect(result.eventId).toBe(EVENT_ID);
    expect(typeof result.logEntryId).toBe("string");
  });

  it("replays return the cached result without touching event_log", async () => {
    const { tx, logRows, idemRows } = makeTx();
    // biome-ignore lint/suspicious/noExplicitAny: unit-test stub
    const first = await ingestEventInTx(tx as any, ORG, event());
    // biome-ignore lint/suspicious/noExplicitAny: unit-test stub
    const second = await ingestEventInTx(tx as any, ORG, event());

    expect(logRows).toHaveLength(1);
    expect(idemRows.size).toBe(1);
    expect(second).toEqual(first);
    expect(tx.eventLogEntry.create).toHaveBeenCalledTimes(1);
  });

  it("dispatches projection exactly once on the first call, never on replay", async () => {
    const projection = vi.fn(async () => {});
    registerProjection("charger.booted", projection);

    const { tx } = makeTx();
    // biome-ignore lint/suspicious/noExplicitAny: unit-test stub
    await ingestEventInTx(tx as any, ORG, event());
    // biome-ignore lint/suspicious/noExplicitAny: unit-test stub
    await ingestEventInTx(tx as any, ORG, event());

    expect(projection).toHaveBeenCalledTimes(1);
  });

  it("unhandled event types still land in the log (projection dispatch is optional)", async () => {
    const { tx, logRows } = makeTx();
    // biome-ignore lint/suspicious/noExplicitAny: unit-test stub
    const result = await ingestEventInTx(tx as any, ORG, event({ eventType: "charger.never_registered" }));

    expect(result.recorded).toBe(true);
    expect(logRows).toHaveLength(1);
  });

  it("different eventIds produce distinct log rows", async () => {
    const { tx, logRows } = makeTx();
    // biome-ignore lint/suspicious/noExplicitAny: unit-test stub
    await ingestEventInTx(tx as any, ORG, event({ eventId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }));
    // biome-ignore lint/suspicious/noExplicitAny: unit-test stub
    await ingestEventInTx(tx as any, ORG, event({ eventId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }));

    expect(logRows).toHaveLength(2);
  });
});
