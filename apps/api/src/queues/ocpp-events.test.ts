// Queue-consumer tests for the inbound OCPP events queue. Mirrors the
// route-side tests in src/routes/internal/ocpp-events.test.ts so the
// idempotency invariant is asserted on the new transport too.
//
// Cases:
//   1. valid envelope               → message.ack(); ingestEvent fired
//   2. invalid envelope (bad shape) → message.ack(); ingestEvent NOT fired
//   3. transient DB error           → message.retry(); ack NOT called
//   4. idempotent replay            → both messages.ack(); second has recorded:false
//
// Sprint 5.3 will refine with explicit ValidationError type tests +
// DLQ-routing assertions; for 5.1 we just verify the consumer wiring.

import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeIdempotency = new Map<string, unknown>();
let nextLogId = 1;

interface FakePrisma {
  $transaction: <T>(fn: (tx: FakePrisma) => Promise<T>) => Promise<T>;
  idempotencyKey: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  eventLogEntry: {
    create: ReturnType<typeof vi.fn>;
  };
}

const fakePrisma: FakePrisma = {
  $transaction: async <T,>(
    fn: (tx: FakePrisma) => Promise<T>,
  ): Promise<T> => fn(fakePrisma),
  idempotencyKey: {
    findUnique: vi.fn(
      async ({ where }: { where: { scope_key: { scope: string; key: string } } }) => {
        const k = `${where.scope_key.scope}:${where.scope_key.key}`;
        const result = fakeIdempotency.get(k);
        return result ? { result } : null;
      },
    ),
    create: vi.fn(
      async ({
        data,
      }: {
        data: { scope: string; key: string; result: unknown };
      }) => {
        const k = `${data.scope}:${data.key}`;
        fakeIdempotency.set(k, data.result);
        return data;
      },
    ),
  },
  eventLogEntry: {
    create: vi.fn(async () => ({ id: `log-${nextLogId++}` })),
  },
};

vi.mock("../lib/prisma", () => ({
  makePrisma: () => fakePrisma,
}));

vi.mock("../lib/ocpp/bootstrap", () => ({}));

import { handleOcppEventsBatch } from "./ocpp-events";
import type { OcppEventMessage, Env } from "../bindings";
import type { Message, MessageBatch } from "@cloudflare/workers-types";

const VALID: OcppEventMessage = {
  eventId: "22222222-2222-2222-2222-222222222222",
  orgId: "11111111-1111-1111-1111-111111111111",
  aggregateType: "ocpp_identity",
  aggregateId: "33333333-3333-3333-3333-333333333333",
  eventType: "charger.heartbeat",
  occurredAt: "2026-05-02T10:00:00.000Z",
  correlationId: "44444444-4444-4444-4444-444444444444",
  retentionClass: "operational",
  payload: {},
};

interface FakeMsg {
  body: unknown;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function makeMsg(body: unknown): FakeMsg {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function makeBatch(messages: FakeMsg[]): MessageBatch<OcppEventMessage> {
  return {
    queue: "straumvakt-ocpp-events-staging",
    messages: messages as unknown as Message<OcppEventMessage>[],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<OcppEventMessage>;
}

const ENV = {} as Env;

describe("handleOcppEventsBatch", () => {
  beforeEach(() => {
    fakeIdempotency.clear();
    nextLogId = 1;
    vi.clearAllMocks();
  });

  it("acks a valid envelope and records the event", async () => {
    const msg = makeMsg(VALID);
    await handleOcppEventsBatch(makeBatch([msg]), ENV);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledTimes(1);
  });

  it("acks (does not retry) an invalid envelope so DLQ catches poison", async () => {
    const msg = makeMsg({ eventId: "not-a-uuid", orgId: "also-bad" });
    await handleOcppEventsBatch(makeBatch([msg]), ENV);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(fakePrisma.eventLogEntry.create).not.toHaveBeenCalled();
  });

  it("retries on transient DB error (does not ack)", async () => {
    fakePrisma.eventLogEntry.create.mockImplementationOnce(async () => {
      throw new Error("hyperdrive connection reset");
    });
    const msg = makeMsg(VALID);
    await handleOcppEventsBatch(makeBatch([msg]), ENV);
    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it("idempotent replay: same eventId twice → both ack, second is recorded:false", async () => {
    const msg1 = makeMsg(VALID);
    const msg2 = makeMsg(VALID);
    await handleOcppEventsBatch(makeBatch([msg1]), ENV);
    await handleOcppEventsBatch(makeBatch([msg2]), ENV);
    expect(msg1.ack).toHaveBeenCalledTimes(1);
    expect(msg2.ack).toHaveBeenCalledTimes(1);
    // ingestEvent calls findUnique twice (once per message); the second
    // hit returns the cached result so eventLogEntry.create only fires
    // on the first.
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledTimes(1);
  });

  it("processes a mixed batch correctly", async () => {
    const valid1 = makeMsg(VALID);
    const invalid = makeMsg({ eventId: "bad" });
    const valid2 = makeMsg({
      ...VALID,
      eventId: "55555555-5555-5555-5555-555555555555",
    });
    await handleOcppEventsBatch(
      makeBatch([valid1, invalid, valid2]),
      ENV,
    );
    expect(valid1.ack).toHaveBeenCalledTimes(1);
    expect(invalid.ack).toHaveBeenCalledTimes(1);
    expect(valid2.ack).toHaveBeenCalledTimes(1);
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledTimes(2);
  });
});
