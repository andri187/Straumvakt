import { describe, it, expect } from "vitest";
import {
  parseFrame,
  serializeCall,
  serializeCallResult,
  serializeCallError,
} from "./ocpp-frame";

describe("parseFrame", () => {
  it("parses a Call frame", () => {
    const raw = JSON.stringify([2, "u-1", "BootNotification", { chargePointVendor: "ACME" }]);
    const r = parseFrame(raw);
    expect(r.ok).toBe(true);
    if (r.ok && r.frame.kind === "call") {
      expect(r.frame.uniqueId).toBe("u-1");
      expect(r.frame.action).toBe("BootNotification");
      expect(r.frame.payload).toEqual({ chargePointVendor: "ACME" });
    }
  });

  it("parses a CallResult frame", () => {
    const raw = JSON.stringify([3, "u-1", { status: "Accepted" }]);
    const r = parseFrame(raw);
    expect(r.ok).toBe(true);
    if (r.ok && r.frame.kind === "call_result") {
      expect(r.frame.uniqueId).toBe("u-1");
      expect(r.frame.payload).toEqual({ status: "Accepted" });
    }
  });

  it("parses a CallError frame", () => {
    const raw = JSON.stringify([4, "u-1", "NotImplemented", "unknown action", { tried: "Foo" }]);
    const r = parseFrame(raw);
    expect(r.ok).toBe(true);
    if (r.ok && r.frame.kind === "call_error") {
      expect(r.frame.errorCode).toBe("NotImplemented");
      expect(r.frame.errorDescription).toBe("unknown action");
    }
  });

  it("rejects invalid JSON", () => {
    expect(parseFrame("not json").ok).toBe(false);
  });

  it("rejects non-array bodies", () => {
    expect(parseFrame('{"a":1}').ok).toBe(false);
  });

  it("rejects unknown messageTypeId", () => {
    expect(parseFrame(JSON.stringify([99, "u-1", "x"])).ok).toBe(false);
  });

  it("rejects Call with non-string action", () => {
    expect(parseFrame(JSON.stringify([2, "u-1", 42, {}])).ok).toBe(false);
  });

  it("rejects Call with array payload", () => {
    expect(parseFrame(JSON.stringify([2, "u-1", "Boot", [1, 2, 3]])).ok).toBe(false);
  });

  it("rejects Call with wrong arity", () => {
    expect(parseFrame(JSON.stringify([2, "u-1", "Boot"])).ok).toBe(false);
  });

  it("rejects empty uniqueId", () => {
    expect(parseFrame(JSON.stringify([2, "", "Boot", {}])).ok).toBe(false);
  });
});

describe("serialize helpers", () => {
  it("serializeCall produces a 4-element array", () => {
    expect(serializeCall("u-1", "Heartbeat", {})).toBe('[2,"u-1","Heartbeat",{}]');
  });

  it("serializeCallResult produces a 3-element array", () => {
    expect(serializeCallResult("u-1", { currentTime: "2026-04-24T00:00:00Z" })).toBe(
      '[3,"u-1",{"currentTime":"2026-04-24T00:00:00Z"}]',
    );
  });

  it("serializeCallError defaults details to empty object", () => {
    expect(serializeCallError("u-1", "NotImplemented", "nope")).toBe(
      '[4,"u-1","NotImplemented","nope",{}]',
    );
  });
});
