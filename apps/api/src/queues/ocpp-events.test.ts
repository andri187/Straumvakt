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

  // ────────────────────────────────────────────────────────────────
  // Sprint 5.3 — additional edge cases not covered by the 5.1 set.
  // ────────────────────────────────────────────────────────────────

  it("triple-replay (3 deliveries of same eventId) → still only one event_log row", async () => {
    // CF Queues at-least-once can redeliver the same envelope more
    // than twice in a row (network blip → retry → blip → retry → blip
    // → retry → finally succeeds). The idempotency contract has to
    // hold across N deliveries, not just 2.
    const m1 = makeMsg(VALID);
    const m2 = makeMsg(VALID);
    const m3 = makeMsg(VALID);
    await handleOcppEventsBatch(makeBatch([m1]), ENV);
    await handleOcppEventsBatch(makeBatch([m2]), ENV);
    await handleOcppEventsBatch(makeBatch([m3]), ENV);
    expect(m1.ack).toHaveBeenCalledTimes(1);
    expect(m2.ack).toHaveBeenCalledTimes(1);
    expect(m3.ack).toHaveBeenCalledTimes(1);
    // Only one real write — second + third hit the idempotency cache.
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledTimes(1);
  });

  it("partial-batch failure: one transient error in the middle does not poison neighbours", async () => {
    // The consumer must isolate failures per message. A transient DB
    // error on message #2 must not prevent #1 and #3 from acking.
    // Without this property, a single bad row would block the whole
    // batch and force redelivery of the whole batch — multiplying
    // retries N-fold.
    const m1 = makeMsg(VALID);
    const m2 = makeMsg({
      ...VALID,
      eventId: "66666666-6666-6666-6666-666666666666",
    });
    const m3 = makeMsg({
      ...VALID,
      eventId: "77777777-7777-7777-7777-777777777777",
    });

    // Stage the failure: eventLogEntry.create throws on the SECOND
    // invocation (the middle message), then succeeds for the third.
    let calls = 0;
    fakePrisma.eventLogEntry.create.mockImplementation(async () => {
      calls++;
      if (calls === 2) throw new Error("hyperdrive blip");
      return { id: `log-${nextLogId++}` };
    });

    await handleOcppEventsBatch(makeBatch([m1, m2, m3]), ENV);

    expect(m1.ack).toHaveBeenCalledTimes(1);
    expect(m1.retry).not.toHaveBeenCalled();

    expect(m2.retry).toHaveBeenCalledTimes(1);
    expect(m2.ack).not.toHaveBeenCalled();

    expect(m3.ack).toHaveBeenCalledTimes(1);
    expect(m3.retry).not.toHaveBeenCalled();
  });

  it("empty batch: no errors, no calls into prisma or projections", async () => {
    await handleOcppEventsBatch(makeBatch([]), ENV);
    expect(fakePrisma.eventLogEntry.create).not.toHaveBeenCalled();
    expect(fakePrisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  it("DLQ replay: a message that originally succeeded becomes a no-op on replay", async () => {
    // Operator runs apps/api/scripts/replay-dlq.ts which pulls from
    // the DLQ and re-publishes onto the main queue. When the original
    // copy DID make it to Postgres before being DLQ'd (a partial-
    // success edge case — the consumer crashed AFTER the DB tx
    // committed but BEFORE the ack reached CF Queues), the replayed
    // copy must be a silent no-op, not a double-write.
    //
    // Step 1: original processes successfully.
    const original = makeMsg(VALID);
    await handleOcppEventsBatch(makeBatch([original]), ENV);
    expect(original.ack).toHaveBeenCalledTimes(1);
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledTimes(1);

    // Step 2: operator pulled from DLQ and re-published. The replayed
    // message body is byte-for-byte identical (the replay script
    // doesn't touch it).
    const replayed = makeMsg(VALID);
    await handleOcppEventsBatch(makeBatch([replayed]), ENV);

    // Step 3: ack on the replay too. eventLogEntry.create still 1 —
    // idempotency held, no double-projection, no double-billing-row.
    expect(replayed.ack).toHaveBeenCalledTimes(1);
    expect(replayed.retry).not.toHaveBeenCalled();
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledTimes(1);
  });
});
