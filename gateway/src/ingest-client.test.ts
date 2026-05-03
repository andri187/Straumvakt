// Tests for the gateway's ingest path. Sprint 5 / ADR 0017 added
// `enqueueOrPost` as the primary entrypoint — the DO calls this on
// every translated OCPP frame. The behaviour we lock in here:
//
//   1. Queue bound + send succeeds → event goes onto the queue,
//      service-binding is NOT touched.
//   2. Queue bound + send throws → fall back to postEvent so we don't
//      drop the event.
//   3. Queue NOT bound (local dev) → fall straight through to postEvent.
//   4. Outcome shape matches across both paths so the DO's caller
//      logic doesn't have to know which transport ran.

import { describe, expect, it, vi } from "vitest";
import { enqueueOrPost, type IngestEvent } from "./ingest-client";
import type { GatewayEnv } from "./auth";

const SAMPLE_EVENT: IngestEvent = {
  eventId: "11111111-1111-1111-1111-111111111111",
  orgId: "22222222-2222-2222-2222-222222222222",
  aggregateType: "ocpp_identity",
  aggregateId: "33333333-3333-3333-3333-333333333333",
  eventType: "ocpp.raw.Heartbeat",
  occurredAt: "2026-05-03T13:00:00.000Z",
  correlationId: "44444444-4444-4444-4444-444444444444",
  retentionClass: "raw_protocol",
  payload: { action: "Heartbeat", request: {} },
};

function makeEnv(opts: {
  queueSend?: (body: unknown) => Promise<void>;
  mainAppFetch?: (req: Request) => Promise<Response>;
}): GatewayEnv {
  return {
    MAIN_APP: {
      fetch:
        opts.mainAppFetch ??
        vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 500 })),
    },
    OCPP_INGEST_SECRET: "test-secret",
    OCPP_EVENTS_QUEUE: opts.queueSend ? { send: opts.queueSend } : undefined,
  };
}

describe("enqueueOrPost", () => {
  it("uses the queue when bound and send succeeds; does not call MAIN_APP", async () => {
    const queueSend = vi.fn(async () => undefined);
    const mainAppFetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const env = makeEnv({ queueSend, mainAppFetch });

    const outcome = await enqueueOrPost(env, SAMPLE_EVENT);

    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(queueSend).toHaveBeenCalledWith(SAMPLE_EVENT);
    expect(mainAppFetch).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "accepted",
      eventId: SAMPLE_EVENT.eventId,
      recorded: false,
    });
  });

  it("falls back to postEvent when the queue throws", async () => {
    const queueSend = vi.fn(async () => {
      throw new Error("queue accept failed");
    });
    const mainAppFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ eventId: SAMPLE_EVENT.eventId, recorded: true }),
          { status: 202 },
        ),
    );
    const env = makeEnv({ queueSend, mainAppFetch });

    const outcome = await enqueueOrPost(env, SAMPLE_EVENT);

    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(mainAppFetch).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      kind: "accepted",
      eventId: SAMPLE_EVENT.eventId,
      recorded: true,
    });
  });

  it("falls straight through to postEvent when queue is not bound (local dev)", async () => {
    const mainAppFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ eventId: SAMPLE_EVENT.eventId, recorded: true }),
          { status: 202 },
        ),
    );
    const env = makeEnv({ mainAppFetch });

    const outcome = await enqueueOrPost(env, SAMPLE_EVENT);

    expect(mainAppFetch).toHaveBeenCalledTimes(1);
    const callArg = mainAppFetch.mock.calls[0][0] as Request;
    expect(callArg.url).toBe("https://main.internal/api/internal/ocpp-events");
    expect(outcome.kind).toBe("accepted");
  });

  it("propagates a postEvent retriable outcome from the fallback path", async () => {
    const queueSend = vi.fn(async () => {
      throw new Error("queue down");
    });
    const mainAppFetch = vi.fn(
      async () => new Response("ingest failed", { status: 500 }),
    );
    const env = makeEnv({ queueSend, mainAppFetch });

    const outcome = await enqueueOrPost(env, SAMPLE_EVENT);

    expect(outcome.kind).toBe("retriable");
    if (outcome.kind === "retriable") {
      expect(outcome.status).toBe(500);
    }
  });
});
