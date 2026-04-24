import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyIngest, constantTimeEquals } from "./ingest-auth";

const SECRET = "test-secret-0123456789abcdef";
let original: string | undefined;

describe("constantTimeEquals", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
  });
  it("returns false for different strings of same length", () => {
    expect(constantTimeEquals("abc", "abd")).toBe(false);
  });
  it("returns false for different-length strings without early exit", () => {
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("", "a")).toBe(false);
  });
  it("handles empty strings", () => {
    expect(constantTimeEquals("", "")).toBe(true);
  });
  it("handles multi-byte UTF-8 correctly", () => {
    expect(constantTimeEquals("þórr", "þórr")).toBe(true);
    expect(constantTimeEquals("þórr", "þorr")).toBe(false);
  });
});

describe("verifyIngest", () => {
  beforeEach(() => {
    original = process.env.OCPP_INGEST_SECRET;
    process.env.OCPP_INGEST_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OCPP_INGEST_SECRET;
    else process.env.OCPP_INGEST_SECRET = original;
  });

  it("rejects a request with no header", () => {
    const req = new Request("https://internal/api/ocpp/events", { method: "POST" });
    const res = verifyIngest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a wrong header value", () => {
    const req = new Request("https://internal/api/ocpp/events", {
      method: "POST",
      headers: { "x-straumvakt-ingest": "wrong" },
    });
    expect(verifyIngest(req)!.status).toBe(401);
  });

  it("accepts the correct header value", () => {
    const req = new Request("https://internal/api/ocpp/events", {
      method: "POST",
      headers: { "x-straumvakt-ingest": SECRET },
    });
    expect(verifyIngest(req)).toBeNull();
  });

  it("rejects when the env var is unset (closed by default)", () => {
    delete process.env.OCPP_INGEST_SECRET;
    const req = new Request("https://internal/api/ocpp/events", {
      method: "POST",
      headers: { "x-straumvakt-ingest": "anything" },
    });
    expect(verifyIngest(req)!.status).toBe(401);
  });
});
