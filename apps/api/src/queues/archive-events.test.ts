// Sprint 7.4 — archive consumer tests. R2 binding mocked; we verify
// the key scheme + headers + retry/ack semantics. Real R2 writes
// are integration territory (Sprint 9 load test exercises them).

import { describe, expect, it, vi } from "vitest";
import { buildArchiveKey, handleArchiveEventsBatch } from "./archive-events";
import type { Env, OcppEventMessage } from "../bindings";
import type { Message, MessageBatch, R2Bucket } from "@cloudflare/workers-types";

const VALID: OcppEventMessage = {
  eventId: "11111111-1111-1111-1111-111111111111",
  orgId: "22222222-2222-2222-2222-222222222222",
  aggregateType: "ocpp_identity",
  aggregateId: "33333333-3333-3333-3333-333333333333",
  eventType: "ocpp.raw.Heartbeat",
  occurredAt: "2026-05-03T15:30:00.000Z",
  correlationId: "44444444-4444-4444-4444-444444444444",
  retentionClass: "raw_protocol",
  payload: { action: "Heartbeat", request: {} },
};

interface FakeMsg {
  body: unknown;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function makeMsg(body: unknown): FakeMsg {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

function makeBatch(messages: FakeMsg[]): MessageBatch<OcppEventMessage> {
  return {
    queue: "straumvakt-archive-events-staging",
    messages: messages as unknown as Message<OcppEventMessage>[],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<OcppEventMessage>;
}

interface PutCall {
  key: string;
  body: ArrayBuffer;
  options?: {
    httpMetadata?: { contentType?: string; contentEncoding?: string };
    customMetadata?: Record<string, string>;
  };
}

function makeBucket(): { bucket: R2Bucket; calls: PutCall[]; failNext: () => void } {
  const calls: PutCall[] = [];
  let shouldFail = false;
  const bucket = {
    put: vi.fn(
      async (key: string, body: ArrayBuffer, options?: PutCall["options"]) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("R2 outage");
        }
        calls.push({ key, body, options });
        return { etag: "fake-etag" };
      },
    ),
  } as unknown as R2Bucket;
  return { bucket, calls, failNext: () => { shouldFail = true; } };
}

describe("buildArchiveKey", () => {
  it("formats per ADR 0018 Decision 3b: <orgId>/<yyyy>/<mm>/<dd>/<chargerId>/<eventId>.json.gz", () => {
    expect(buildArchiveKey(VALID)).toBe(
      "22222222-2222-2222-2222-222222222222/2026/05/03/33333333-3333-3333-3333-333333333333/11111111-1111-1111-1111-111111111111.json.gz",
    );
  });

  it("uses UTC date components, not local", () => {
    const env_: typeof VALID = { ...VALID, occurredAt: "2026-12-31T23:30:00.000Z" };
    expect(buildArchiveKey(env_)).toContain("/2026/12/31/");
  });

  it("zero-pads month + day", () => {
    const env_: typeof VALID = { ...VALID, occurredAt: "2026-01-09T01:00:00.000Z" };
    expect(buildArchiveKey(env_)).toContain("/2026/01/09/");
  });
});

describe("handleArchiveEventsBatch", () => {
  it("writes a valid envelope to R2 with the right headers + acks", async () => {
    const { bucket, calls } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const msg = makeMsg(VALID);
    await handleArchiveEventsBatch(makeBatch([msg]), env);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toMatch(/\.json\.gz$/);
    expect(calls[0].options?.httpMetadata?.contentType).toBe("application/json");
    expect(calls[0].options?.httpMetadata?.contentEncoding).toBe("gzip");
    expect(calls[0].options?.customMetadata?.eventType).toBe("ocpp.raw.Heartbeat");
    expect(calls[0].options?.customMetadata?.retentionClass).toBe("raw_protocol");
  });

  it("acks invalid envelopes without writing R2 (poison drop)", async () => {
    const { bucket, calls } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const msg = makeMsg({ eventId: "not-a-uuid" });
    await handleArchiveEventsBatch(makeBatch([msg]), env);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("retries on R2 put failure", async () => {
    const { bucket, calls, failNext } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    failNext();
    const msg = makeMsg(VALID);
    await handleArchiveEventsBatch(makeBatch([msg]), env);
    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("processes a mixed batch correctly", async () => {
    const { bucket, calls } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const valid1 = makeMsg(VALID);
    const invalid = makeMsg({ eventId: "bad" });
    const valid2 = makeMsg({
      ...VALID,
      eventId: "55555555-5555-5555-5555-555555555555",
    });
    await handleArchiveEventsBatch(
      makeBatch([valid1, invalid, valid2]),
      env,
    );
    expect(valid1.ack).toHaveBeenCalledTimes(1);
    expect(invalid.ack).toHaveBeenCalledTimes(1);
    expect(valid2.ack).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("body is gzip-compressed JSON of the envelope", async () => {
    const { bucket, calls } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const msg = makeMsg(VALID);
    await handleArchiveEventsBatch(makeBatch([msg]), env);
    // gzip magic number: 0x1f 0x8b
    const view = new Uint8Array(calls[0].body);
    expect(view[0]).toBe(0x1f);
    expect(view[1]).toBe(0x8b);
    // Should compress meaningfully — JSON of a Heartbeat envelope is
    // ~250+ bytes uncompressed, gzipped should be smaller.
    const uncompressedLen = JSON.stringify(VALID).length;
    expect(view.byteLength).toBeLessThan(uncompressedLen);
  });
});
