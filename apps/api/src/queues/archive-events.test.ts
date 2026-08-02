// Sprint 7.4 — archive consumer tests. R2 binding mocked; we verify
// the key scheme + headers + retry/ack semantics. Real R2 writes
// are integration territory (Sprint 9 load test exercises them).

import { describe, expect, it, vi } from "vitest";
import { buildArchiveKey, handleArchiveEventsBatch } from "./archive-events";
import { RETENTION_CLASSES } from "../lib/ocpp/event-envelope";
import type { ArchiveWatermarkDelta } from "../lib/db/archive-watermark";
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

/**
 * Injected watermark sink. Keeps the consumer's ADR 0037 D5 upsert out
 * of these tests' way while letting the watermark cases below assert
 * exactly what would have been written.
 */
function recorder(): {
  recordWatermarks: (d: ArchiveWatermarkDelta[]) => Promise<void>;
  batches: ArchiveWatermarkDelta[][];
  failNext: () => void;
} {
  const batches: ArchiveWatermarkDelta[][] = [];
  let shouldFail = false;
  return {
    batches,
    failNext: () => { shouldFail = true; },
    recordWatermarks: async (d) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("watermark upsert failed");
      }
      batches.push(d);
    },
  };
}

describe("buildArchiveKey", () => {
  it("formats per ADR 0037 D1: <retentionClass>/<orgId>/<yyyy>/<mm>/<dd>/<chargerId>/<eventId>.json.gz", () => {
    expect(buildArchiveKey(VALID)).toBe(
      "raw_protocol/22222222-2222-2222-2222-222222222222/2026/05/03/33333333-3333-3333-3333-333333333333/11111111-1111-1111-1111-111111111111.json.gz",
    );
  });

  it("leads with the retention class so a literal-prefix lifecycle rule can match it", () => {
    // The entire point of D1: R2 lifecycle rules match a literal
    // string prefix and cannot read customMetadata. Two envelopes
    // identical but for their class must land under different
    // top-level prefixes.
    const financial = buildArchiveKey({ ...VALID, retentionClass: "financial" });
    const raw = buildArchiveKey({ ...VALID, retentionClass: "raw_protocol" });
    expect(financial.startsWith("financial/")).toBe(true);
    expect(raw.startsWith("raw_protocol/")).toBe(true);
    expect(financial).not.toBe(raw);
  });

  it("covers every retention class in the enum", () => {
    for (const rc of RETENTION_CLASSES) {
      expect(buildArchiveKey({ ...VALID, retentionClass: rc })).toBe(
        `${rc}/22222222-2222-2222-2222-222222222222/2026/05/03/33333333-3333-3333-3333-333333333333/11111111-1111-1111-1111-111111111111.json.gz`,
      );
    }
  });

  it("uses UTC date components, not local", () => {
    const env_: typeof VALID = { ...VALID, occurredAt: "2026-12-31T23:30:00.000Z" };
    expect(buildArchiveKey(env_)).toContain("/2026/12/31/");
  });

  it("zero-pads month + day", () => {
    const env_: typeof VALID = { ...VALID, occurredAt: "2026-01-09T01:00:00.000Z" };
    expect(buildArchiveKey(env_)).toContain("/2026/01/09/");
  });

  it("is pure — same envelope, same key", () => {
    expect(buildArchiveKey(VALID)).toBe(buildArchiveKey({ ...VALID }));
  });
});

describe("handleArchiveEventsBatch", () => {
  it("writes a valid envelope to R2 with the right headers + acks", async () => {
    const { bucket, calls } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const msg = makeMsg(VALID);
    await handleArchiveEventsBatch(makeBatch([msg]), env, recorder());
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
    await handleArchiveEventsBatch(makeBatch([msg]), env, recorder());
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("retries on R2 put failure", async () => {
    const { bucket, calls, failNext } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    failNext();
    const msg = makeMsg(VALID);
    await handleArchiveEventsBatch(makeBatch([msg]), env, recorder());
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
      recorder(),
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
    await handleArchiveEventsBatch(makeBatch([msg]), env, recorder());
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

describe("handleArchiveEventsBatch — archive watermark (ADR 0037 D5)", () => {
  it("records one delta per (retentionClass, UTC day) for objects actually written", async () => {
    const { bucket } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const rec = recorder();
    await handleArchiveEventsBatch(
      makeBatch([
        makeMsg(VALID),
        makeMsg({ ...VALID, eventId: "55555555-5555-5555-5555-555555555555" }),
        makeMsg({
          ...VALID,
          eventId: "66666666-6666-6666-6666-666666666666",
          retentionClass: "financial",
        }),
      ]),
      env,
      rec,
    );
    expect(rec.batches).toHaveLength(1);
    expect(rec.batches[0]).toEqual(
      expect.arrayContaining([
        { retentionClass: "raw_protocol", day: "2026-05-03", objects: 2 },
        { retentionClass: "financial", day: "2026-05-03", objects: 1 },
      ]),
    );
    expect(rec.batches[0]).toHaveLength(2);
  });

  it("does not count envelopes whose R2 put failed — the watermark can only under-count", async () => {
    const { bucket, failNext } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const rec = recorder();
    failNext();
    await handleArchiveEventsBatch(
      makeBatch([
        makeMsg(VALID),
        makeMsg({ ...VALID, eventId: "55555555-5555-5555-5555-555555555555" }),
      ]),
      env,
      rec,
    );
    // First put threw and was retried; only the second was archived.
    expect(rec.batches[0]).toEqual([
      { retentionClass: "raw_protocol", day: "2026-05-03", objects: 1 },
    ]);
  });

  it("does not record anything when nothing was archived", async () => {
    const { bucket } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const rec = recorder();
    await handleArchiveEventsBatch(makeBatch([makeMsg({ eventId: "bad" })]), env, rec);
    expect(rec.batches).toHaveLength(0);
  });

  it("a watermark failure does not un-ack a successful R2 write", async () => {
    // ADR 0018 3d: R2 must not back-pressure. Retrying the message
    // would re-put an object we already have and inflate the count,
    // so the watermark write is best-effort by design.
    const { bucket, calls } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const rec = recorder();
    rec.failNext();
    const msg = makeMsg(VALID);
    await handleArchiveEventsBatch(makeBatch([msg]), env, rec);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("splits the day on the UTC boundary, matching the key's date segment", async () => {
    const { bucket, calls } = makeBucket();
    const env = { EVIDENCE_BUCKET: bucket } as unknown as Env;
    const rec = recorder();
    await handleArchiveEventsBatch(
      makeBatch([
        makeMsg({ ...VALID, occurredAt: "2026-05-03T23:59:59.000Z" }),
        makeMsg({
          ...VALID,
          eventId: "55555555-5555-5555-5555-555555555555",
          occurredAt: "2026-05-04T00:00:01.000Z",
        }),
      ]),
      env,
      rec,
    );
    expect(rec.batches[0]).toEqual(
      expect.arrayContaining([
        { retentionClass: "raw_protocol", day: "2026-05-03", objects: 1 },
        { retentionClass: "raw_protocol", day: "2026-05-04", objects: 1 },
      ]),
    );
    // The watermark day and the key's date segment must never diverge
    // — the whole gate assumes they agree.
    expect(calls[0].key).toContain("/2026/05/03/");
    expect(calls[1].key).toContain("/2026/05/04/");
  });
});
