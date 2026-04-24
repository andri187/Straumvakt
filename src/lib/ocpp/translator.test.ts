import { describe, it, expect } from "vitest";
import { translate, type TranslationContext } from "./translator";
import { parseIngestEvent } from "./event-envelope";

const CTX: TranslationContext = {
  orgId: "11111111-1111-1111-1111-111111111111",
  eventId: "22222222-2222-2222-2222-222222222222",
  correlationId: "33333333-3333-3333-3333-333333333333",
  ocppIdentityId: "44444444-4444-4444-4444-444444444444",
  connectorId: "55555555-5555-5555-5555-555555555555",
  chargeSessionId: "66666666-6666-6666-6666-666666666666",
};

/** Every successful translation must pass through `parseIngestEvent`
 *  cleanly — same validator the route uses. This guarantees the
 *  translator never emits an envelope that the route would reject. */
function expectRoundTrip(result: ReturnType<typeof translate>) {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  const parse = parseIngestEvent(result.event);
  expect(parse.ok).toBe(true);
  return result.event;
}

describe("translator — OCPP 1.6J", () => {
  it("BootNotification → charger.booted / operational", () => {
    const r = translate(
      "BootNotification",
      {
        chargePointVendor: "ACME",
        chargePointModel: "ModelX",
        firmwareVersion: "1.2.3",
      },
      CTX,
    );
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("charger.booted");
    expect(e.retentionClass).toBe("operational");
    expect(e.aggregateType).toBe("ocpp_identity");
    expect(e.aggregateId).toBe(CTX.ocppIdentityId);
    expect(e.payload).toMatchObject({ chargePointVendor: "ACME", chargePointModel: "ModelX" });
  });

  it("Heartbeat → charger.heartbeat / raw_protocol", () => {
    const r = translate("Heartbeat", {}, CTX);
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("charger.heartbeat");
    expect(e.retentionClass).toBe("raw_protocol");
  });

  it("StatusNotification connectorId=0 → charger.status_updated", () => {
    const r = translate(
      "StatusNotification",
      { connectorId: 0, status: "Available", errorCode: "NoError" },
      CTX,
    );
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("charger.status_updated");
    expect(e.aggregateType).toBe("ocpp_identity");
    expect(e.aggregateId).toBe(CTX.ocppIdentityId);
  });

  it("StatusNotification connectorId>0 → connector.status_updated", () => {
    const r = translate(
      "StatusNotification",
      { connectorId: 1, status: "Preparing", errorCode: "NoError" },
      CTX,
    );
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("connector.status_updated");
    expect(e.aggregateType).toBe("connector");
    expect(e.aggregateId).toBe(CTX.connectorId);
  });

  it("StatusNotification connectorId>0 without ctx.connectorId → error", () => {
    const r = translate(
      "StatusNotification",
      { connectorId: 1, status: "Preparing", errorCode: "NoError" },
      { ...CTX, connectorId: undefined },
    );
    expect(r.ok).toBe(false);
  });

  it("Authorize → card.authorize_requested / operational", () => {
    const r = translate("Authorize", { idTag: "ABC123" }, CTX);
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("card.authorize_requested");
    expect(e.retentionClass).toBe("operational");
    expect((e.payload as { idTag?: string }).idTag).toBe("ABC123");
  });

  it("StartTransaction → session.started / financial", () => {
    const r = translate(
      "StartTransaction",
      {
        connectorId: 1,
        idTag: "ABC123",
        meterStart: 0,
        timestamp: "2026-04-24T10:00:00.000Z",
      },
      CTX,
    );
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("session.started");
    expect(e.retentionClass).toBe("financial");
    expect(e.aggregateType).toBe("charge_session");
    expect(e.aggregateId).toBe(CTX.chargeSessionId);
    expect(e.occurredAt).toBe("2026-04-24T10:00:00.000Z");
  });

  it("MeterValues → session.meter_value_recorded / raw_protocol", () => {
    const r = translate(
      "MeterValues",
      {
        connectorId: 1,
        transactionId: 42,
        meterValue: [
          {
            timestamp: "2026-04-24T10:05:00.000Z",
            sampledValue: [{ value: "1234", measurand: "Energy.Active.Import.Register" }],
          },
        ],
      },
      CTX,
    );
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("session.meter_value_recorded");
    expect(e.retentionClass).toBe("raw_protocol");
    expect(e.occurredAt).toBe("2026-04-24T10:05:00.000Z");
  });

  it("StopTransaction → session.stopped / financial", () => {
    const r = translate(
      "StopTransaction",
      {
        meterStop: 10500,
        timestamp: "2026-04-24T10:30:00.000Z",
        transactionId: 42,
        reason: "Local",
      },
      CTX,
    );
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("session.stopped");
    expect(e.retentionClass).toBe("financial");
    expect((e.payload as { meterStopWh?: number }).meterStopWh).toBe(10500);
  });

  it("Unknown action → ocpp.unknown_message / raw_protocol", () => {
    const r = translate("GetConfiguration", { key: "foo" }, CTX);
    const e = expectRoundTrip(r);
    expect(e.eventType).toBe("ocpp.unknown_message");
    expect(e.retentionClass).toBe("raw_protocol");
    expect((e.payload as { action?: string }).action).toBe("GetConfiguration");
  });
});

describe("translator — payload validation rejections", () => {
  it("BootNotification rejects missing chargePointVendor", () => {
    const r = translate("BootNotification", { chargePointModel: "X" }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("BootNotification");
  });

  it("StartTransaction rejects negative meterStart", () => {
    const r = translate(
      "StartTransaction",
      { connectorId: 1, idTag: "A", meterStart: -5, timestamp: "2026-04-24T10:00:00Z" },
      CTX,
    );
    expect(r.ok).toBe(false);
  });

  it("StopTransaction rejects non-ISO timestamp", () => {
    const r = translate(
      "StopTransaction",
      { meterStop: 100, timestamp: "yesterday", transactionId: 1 },
      CTX,
    );
    expect(r.ok).toBe(false);
  });

  it("Authorize rejects idTag > 20 chars", () => {
    const r = translate(
      "Authorize",
      { idTag: "A".repeat(25) },
      CTX,
    );
    expect(r.ok).toBe(false);
  });
});
