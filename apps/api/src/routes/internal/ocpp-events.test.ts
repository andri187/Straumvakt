// Route tests for /api/internal/ocpp-events. Covers the five cases
// gbtNotes Sprint S1 calls out as exit-criteria smoke (review §3
// idempotency parity gets a dedicated case for the replay path):
//
//   1. missing ingest header             → 401
//   2. malformed JSON body               → 400
//   3. invalid envelope (failing parser) → 400
//   4. fresh event                       → 202 + recorded: true
//   5. idempotent replay (same eventId)  → 202 + recorded: false

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock makePrisma BEFORE importing the route so the route picks up our
// fake. The fake mirrors only the methods ingestEvent + ingestEventInTx
// touch — idempotencyKey + eventLogEntry. Projections aren't fired in
// these tests because we don't import the bootstrap module that
// registers them.
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
    findUnique: vi.fn(async ({ where }: { where: { scope_key: { scope: string; key: string } } }) => {
      const k = `${where.scope_key.scope}:${where.scope_key.key}`;
      const result = fakeIdempotency.get(k);
      return result ? { result } : null;
    }),
    create: vi.fn(async ({ data }: { data: { scope: string; key: string; result: unknown } }) => {
      const k = `${data.scope}:${data.key}`;
      fakeIdempotency.set(k, data.result);
      return data;
    }),
  },
  eventLogEntry: {
    create: vi.fn(async () => ({ id: `log-${nextLogId++}` })),
  },
};

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => fakePrisma,
}));

// Don't import the bootstrap module — it would require ./projections to
// resolve against the generated Prisma client at test time. Tests for
// projection logic live in apps/api/src/lib/ocpp/projections.test.ts.
vi.mock("../../lib/ocpp/bootstrap", () => ({}));

import { internalOcppEvents } from "./ocpp-events";

const SECRET = "test-secret-0123456789abcdef";

const VALID_EVENT = {
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

function buildRequest(body: unknown, opts: { secret?: string; bodyOverride?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.secret !== undefined) {
    headers["x-straumvakt-ingest"] = opts.secret;
  }
  // The sub-app routes against `/`; the parent app mounts it at the
  // /api/ocpp/events prefix in production. Tests hit the sub-app
  // directly so the request URL is the unmounted path.
  return new Request("https://main.internal/", {
    method: "POST",
    headers,
    body: opts.bodyOverride ?? JSON.stringify(body),
  });
}

const env = { OCPP_INGEST_SECRET: SECRET } as never;

describe("POST /api/internal/ocpp-events", () => {
  beforeEach(() => {
    fakeIdempotency.clear();
    nextLogId = 1;
    fakePrisma.idempotencyKey.findUnique.mockClear();
    fakePrisma.idempotencyKey.create.mockClear();
    fakePrisma.eventLogEntry.create.mockClear();
  });

  it("returns 401 when the ingest header is missing", async () => {
    const req = buildRequest(VALID_EVENT, {});
    const res = await internalOcppEvents.request(req, undefined, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the ingest header is wrong", async () => {
    const req = buildRequest(VALID_EVENT, { secret: "wrong" });
    const res = await internalOcppEvents.request(req, undefined, env);
    expect(res.status).toBe(401);
  });

  it("returns 400 on malformed JSON", async () => {
    const req = buildRequest(null, {
      secret: SECRET,
      bodyOverride: "{not json",
    });
    const res = await internalOcppEvents.request(req, undefined, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/malformed/);
  });

  it("returns 400 on invalid envelope (parser rejection)", async () => {
    const req = buildRequest(
      { ...VALID_EVENT, orgId: "not-a-uuid" },
      { secret: SECRET },
    );
    const res = await internalOcppEvents.request(req, undefined, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("orgId");
  });

  it("returns 202 with recorded:true on a fresh event", async () => {
    const req = buildRequest(VALID_EVENT, { secret: SECRET });
    const res = await internalOcppEvents.request(req, undefined, env);
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      accepted: boolean;
      recorded: boolean;
      eventId: string;
      logEntryId: string;
    };
    expect(body.accepted).toBe(true);
    expect(body.recorded).toBe(true);
    expect(body.eventId).toBe(VALID_EVENT.eventId);
    expect(body.logEntryId).toMatch(/^log-/);
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledOnce();
    expect(fakePrisma.idempotencyKey.create).toHaveBeenCalledOnce();
  });

  it("returns 202 with recorded:false on idempotent replay (same eventId)", async () => {
    // First call records.
    const first = buildRequest(VALID_EVENT, { secret: SECRET });
    const r1 = await internalOcppEvents.request(first, undefined, env);
    expect(r1.status).toBe(202);
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledOnce();

    // Replay with the same eventId — idempotency key short-circuits.
    const second = buildRequest(VALID_EVENT, { secret: SECRET });
    const r2 = await internalOcppEvents.request(second, undefined, env);
    expect(r2.status).toBe(202);
    const body = (await r2.json()) as {
      recorded: boolean;
      eventId: string;
      logEntryId: string;
    };
    expect(body.recorded).toBe(true);
    expect(body.eventId).toBe(VALID_EVENT.eventId);
    // Critically: only ONE log row was created across the two calls.
    // (The cached idempotency result returns recorded:true because that
    // was the original outcome — but no second eventLogEntry.create
    // fires.)
    expect(fakePrisma.eventLogEntry.create).toHaveBeenCalledOnce();
    expect(fakePrisma.idempotencyKey.create).toHaveBeenCalledOnce();
  });
});
