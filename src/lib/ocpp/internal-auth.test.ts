import { describe, it, expect } from "vitest";
import { sha256Hex, hexEquals } from "./internal-auth";

describe("sha256Hex", () => {
  it("produces a 64-char lowercase hex digest", async () => {
    const out = await sha256Hex("hello");
    expect(out).toMatch(/^[0-9a-f]{64}$/);
    expect(out).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("is deterministic across calls", async () => {
    expect(await sha256Hex("same")).toBe(await sha256Hex("same"));
  });

  it("differs for different inputs", async () => {
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });
});

describe("hexEquals", () => {
  it("matches identical strings", () => {
    expect(hexEquals("abc123", "abc123")).toBe(true);
  });
  it("fails for different values of same length", () => {
    expect(hexEquals("abc123", "abc124")).toBe(false);
  });
  it("fails for different-length strings", () => {
    expect(hexEquals("abc", "abcd")).toBe(false);
    expect(hexEquals("abcd", "abc")).toBe(false);
  });
  it("passes for empty strings", () => {
    expect(hexEquals("", "")).toBe(true);
  });
});
