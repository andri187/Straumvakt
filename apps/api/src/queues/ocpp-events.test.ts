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

// P4.12 — the batched heartbeat path. Mocked at the raw.ts boundary so
// these tests assert consumer partitioning/ack/archive behaviour; the
// SQL itself is covered by src/lib/db/raw.test.ts.
const rawMocks = vi.hoisted(() => ({
  batchIngestHeartbeats: vi.fn(),
  poolEnd: vi.fn(async () => undefined),
  clientRelease: vi.fn(),
}));

vi.mock("../lib/db/raw", () => ({
  makePool: () => ({
    connect: async () => ({ release: rawMocks.clientRelease }),
    end: rawMocks.poolEnd,
  }),
  batchIngestHeartbeats: rawMocks.batchIngestHeartbeats,
}));

import { handleOcppEventsBatch } from "./ocpp-events";
import type { OcppEventMessage, Env } from "../bindings";
import type { Message, MessageBatch } from "@cloudflare/workers-types";

// Sprint 7 atomic-batch fast path treats charger.heartbeat /
// ocpp.raw.Heartbeat specially. To keep these slow-path tests
// exercising the Prisma per-event branch, default eventType is
// 'charger.status_updated' (a non-heartbeat). Fast-path tests
// further down explicitly use heartbeat with a mocked pg pool.
const VALID: OcppEventMessage = {
  eventId: "22222222-2222-2222-2222-222222222222",
  orgId: "11111111-1111-1111-1111-111111111111",
  aggregateType: "ocpp_identity",
  aggregateId: "33333333-3333-3333-3333-333333333333",
  eventType: "charger.status_updated",
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

// ─────────────────────────────────────────────────────────────────────
// P4.12 — batch partitioning (ADR 0035)
//
// Before this change the fast path was gated on EVERY message in the
// batch being a heartbeat, so a single non-heartbeat sent the whole
// batch down the per-event Prisma loop. At ~250 concurrent sessions
// that meant ~99% of batches. These tests pin the partitioning
// behaviour, and the archive-identity fix (F2) that came with it.
// ─────────────────────────────────────────────────────────────────────

function heartbeat(eventId: string, aggregateId = "33333333-3333-3333-3333-333333333333"): OcppEventMessage {
  return { ...VALID, eventId, aggregateId, eventType: "ocpp.raw.Heartbeat" };
}

describe("handleOcppEventsBatch — batch partitioning", () => {
  // Typed parameter, not `vi.fn(async () => …)`: without it the mock's
  // call tuple is empty and `mock.calls[0][0]` doesn't typecheck.
  const archiveSendBatch = vi.fn(
    async (_messages: Array<{ body: OcppEventMessage }>) => undefined,
  );
  const ENV_ARCHIVE = {
    ARCHIVE_QUEUE: { sendBatch: archiveSendBatch },
  } as unknown as Env;

  beforeEach(() => {
    fakeIdempotency.clear();
    nextLogId = 1;
    vi.clearAllMocks();
    fakePrisma.eventLogEntry.create.mockImplementation(async () => ({
      id: `log-${nextLogId++}`,
    }));
    rawMocks.batchIngestHeartbeats.mockResolvedValue({
      fresh: 0,
      replays: 0,
      identitiesTouched: 0,
      freshEventIds: [],
    });
  });

  it("splits a mixed batch: heartbeats batched, the rest through Prisma", async () => {
    // THE regression this milestone exists for. One non-heartbeat used
    // to drag every heartbeat onto the per-event path.
    const hb1 = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000001"));
    const hb2 = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000002"));
    const status = makeMsg(VALID); // charger.status_updated

    rawMocks.batchIngestHeartbeats.mockResolvedValue({
      fresh: 2,
      replays: 0,
      identitiesTouched: 1,
      freshEventIds: [
        "aaaaaaaa-0000-0000-0000-000000000001",
        "aaaaaaaa-0000-0000-0000-000000000002",
      ],
    });

    await handleOcppEventsBatch(makeBatch([hb1, status, hb2]), ENV_ARCHIVE);

    // Both heartbeats went through the batched transaction, once.
    expect(rawMocks.batchIngestHeartbeats).toHaveBeenCalledTimes(1);
    expect(rawMocks.batchIngestHeartbeats.mock.calls[0][1]).toHaveLength(2);

    // The non-heartbeat still went through Prisma — exactly once, and
    // the heartbeats did NOT.
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledTimes(1);

    // Everything acked.
    for (const m of [hb1, hb2, status]) {
      expect(m.ack).toHaveBeenCalledTimes(1);
      expect(m.retry).not.toHaveBeenCalled();
    }
  });

  it("archives the events the insert reported fresh, not the first N (F2)", async () => {
    // The old code did slice(0, result.fresh), which assumes fresh
    // events are first in input order. With a replay interleaved that
    // archived the WRONG envelopes — silently.
    const hb1 = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000001"));
    const replay = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000002"));
    const hb3 = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000003"));

    // The middle one is a replay; #1 and #3 are fresh.
    rawMocks.batchIngestHeartbeats.mockResolvedValue({
      fresh: 2,
      replays: 1,
      identitiesTouched: 1,
      freshEventIds: [
        "aaaaaaaa-0000-0000-0000-000000000001",
        "aaaaaaaa-0000-0000-0000-000000000003",
      ],
    });

    await handleOcppEventsBatch(makeBatch([hb1, replay, hb3]), ENV_ARCHIVE);

    expect(archiveSendBatch).toHaveBeenCalledTimes(1);
    const archived = archiveSendBatch.mock.calls[0][0];
    // Assert on identity, not count — slice(0,2) would have passed a
    // count-only assertion while archiving #1 and #2.
    expect(archived.map((m) => m.body.eventId)).toEqual([
      "aaaaaaaa-0000-0000-0000-000000000001",
      "aaaaaaaa-0000-0000-0000-000000000003",
    ]);
  });

  it("fast-path failure retries only the heartbeats; Prisma partition still runs", async () => {
    const hb = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000001"));
    const status = makeMsg(VALID);

    rawMocks.batchIngestHeartbeats.mockRejectedValue(new Error("hyperdrive blip"));

    await handleOcppEventsBatch(makeBatch([hb, status]), ENV_ARCHIVE);

    // Heartbeat retried — its transaction rolled back, nothing written.
    expect(hb.retry).toHaveBeenCalledTimes(1);
    expect(hb.ack).not.toHaveBeenCalled();

    // The independent partition is unaffected. Before partitioning a
    // fast-path failure retried the entire batch.
    expect(status.ack).toHaveBeenCalledTimes(1);
    expect(status.retry).not.toHaveBeenCalled();
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledTimes(1);
  });

  it("an all-heartbeat batch never touches Prisma", async () => {
    const hb1 = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000001"));
    const hb2 = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000002"));
    rawMocks.batchIngestHeartbeats.mockResolvedValue({
      fresh: 2,
      replays: 0,
      identitiesTouched: 1,
      freshEventIds: [
        "aaaaaaaa-0000-0000-0000-000000000001",
        "aaaaaaaa-0000-0000-0000-000000000002",
      ],
    });

    await handleOcppEventsBatch(makeBatch([hb1, hb2]), ENV_ARCHIVE);

    expect(fakePrisma.eventLogEntry.create).not.toHaveBeenCalled();
    expect(hb1.ack).toHaveBeenCalledTimes(1);
    expect(hb2.ack).toHaveBeenCalledTimes(1);
  });

  it("a batch with no heartbeats never opens a pg pool", async () => {
    // Guards the cost of the batched path when it has nothing to do.
    const status = makeMsg(VALID);
    await handleOcppEventsBatch(makeBatch([status]), ENV_ARCHIVE);
    expect(rawMocks.batchIngestHeartbeats).not.toHaveBeenCalled();
    expect(rawMocks.poolEnd).not.toHaveBeenCalled();
  });

  it("malformed heartbeat envelopes drop to the validation path, not the batch", async () => {
    // Eligibility is decided AFTER parsing. A message that claims to be
    // a heartbeat but fails envelope validation must not reach the
    // batched insert.
    const bad = makeMsg({ eventType: "ocpp.raw.Heartbeat", nope: true });
    await handleOcppEventsBatch(makeBatch([bad]), ENV_ARCHIVE);

    expect(rawMocks.batchIngestHeartbeats).not.toHaveBeenCalled();
    expect(bad.ack).toHaveBeenCalledTimes(1); // poison → drop, not retry
    expect(bad.retry).not.toHaveBeenCalled();
  });

  it("archive fanout is batched, not one send per event", async () => {
    // P4.13 — the old loop awaited one send() per event, up to 100
    // sequential round trips inside the batch window.
    const msgs = Array.from({ length: 5 }, (_, i) =>
      makeMsg(heartbeat(`aaaaaaaa-0000-0000-0000-00000000000${i + 1}`)),
    );
    rawMocks.batchIngestHeartbeats.mockResolvedValue({
      fresh: 5,
      replays: 0,
      identitiesTouched: 1,
      freshEventIds: msgs.map(
        (_, i) => `aaaaaaaa-0000-0000-0000-00000000000${i + 1}`,
      ),
    });

    await handleOcppEventsBatch(makeBatch(msgs), ENV_ARCHIVE);

    expect(archiveSendBatch).toHaveBeenCalledTimes(1);
    expect(archiveSendBatch.mock.calls[0][0]).toHaveLength(5);
  });

  it("archive failure never blocks the ack", async () => {
    // ADR 0018 Decision 3 — two queues exist so an archive outage
    // cannot block Postgres ack.
    const hb = makeMsg(heartbeat("aaaaaaaa-0000-0000-0000-000000000001"));
    rawMocks.batchIngestHeartbeats.mockResolvedValue({
      fresh: 1,
      replays: 0,
      identitiesTouched: 1,
      freshEventIds: ["aaaaaaaa-0000-0000-0000-000000000001"],
    });
    archiveSendBatch.mockRejectedValueOnce(new Error("R2 unavailable"));

    await expect(
      handleOcppEventsBatch(makeBatch([hb]), ENV_ARCHIVE),
    ).resolves.toBeUndefined();

    expect(hb.ack).toHaveBeenCalledTimes(1);
    expect(hb.retry).not.toHaveBeenCalled();
  });
});
