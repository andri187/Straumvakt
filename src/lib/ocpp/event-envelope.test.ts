import { describe, it, expect } from "vitest";
import { parseIngestEvent } from "./event-envelope";

const VALID = {
  eventId: "22222222-2222-2222-2222-222222222222",
  orgId: "11111111-1111-1111-1111-111111111111",
  aggregateType: "charger",
  aggregateId: "33333333-3333-3333-3333-333333333333",
  eventType: "charger.booted",
  occurredAt: "2026-04-24T09:00:00.000Z",
  correlationId: "44444444-4444-4444-4444-444444444444",
  retentionClass: "operational",
  payload: { firmware: "1.0.0" },
};

describe("parseIngestEvent", () => {
  it("accepts a well-formed envelope", () => {
    const r = parseIngestEvent(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.eventType).toBe("charger.booted");
  });

  it("rejects missing eventId", () => {
    const r = parseIngestEvent({ ...VALID, eventId: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("eventId");
  });

  it("rejects invalid UUID for orgId", () => {
    const r = parseIngestEvent({ ...VALID, orgId: "not-a-uuid" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("orgId");
  });

  it("rejects unknown retentionClass", () => {
    const r = parseIngestEvent({ ...VALID, retentionClass: "mystery" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("retentionClass");
  });

  it("rejects non-ISO occurredAt", () => {
    const r = parseIngestEvent({ ...VALID, occurredAt: "yesterday" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("occurredAt");
  });

  it("rejects array payload", () => {
    const r = parseIngestEvent({ ...VALID, payload: [1, 2, 3] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("payload");
  });

  it("rejects non-object body", () => {
    expect(parseIngestEvent(null).ok).toBe(false);
    expect(parseIngestEvent("string").ok).toBe(false);
    expect(parseIngestEvent(42).ok).toBe(false);
  });
});
