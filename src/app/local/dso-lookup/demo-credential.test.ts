// The demo credential — the contract.

import { describe, expect, it } from "vitest";
import {
  checkDemoCredential,
  DEMO_CREDENTIAL_WARNING,
  DEMO_PASSWORD,
  DEMO_USERNAME,
} from "./demo-credential";

describe("the demo credential accepts exactly one pair", () => {
  it("accepts DSO / map", () => {
    expect(checkDemoCredential("DSO", "map")).toBe(true);
  });

  it("accepts the username in any case, and tolerates stray whitespace", () => {
    expect(checkDemoCredential("dso", "map")).toBe(true);
    expect(checkDemoCredential("Dso", "map")).toBe(true);
    expect(checkDemoCredential("  DSO  ", "map")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(checkDemoCredential("DSO", "MAP")).toBe(false);
    expect(checkDemoCredential("DSO", "map ")).toBe(false);
    expect(checkDemoCredential("DSO", "maps")).toBe(false);
    expect(checkDemoCredential("DSO", "")).toBe(false);
  });

  it("rejects a wrong username", () => {
    expect(checkDemoCredential("admin", "map")).toBe(false);
    expect(checkDemoCredential("", "map")).toBe(false);
    expect(checkDemoCredential("DSO2", "map")).toBe(false);
  });

  it("rejects both wrong", () => {
    expect(checkDemoCredential("root", "toor")).toBe(false);
  });

  it("does not fall over on non-string input", () => {
    // @ts-expect-error deliberately wrong — the runtime guard is the subject
    expect(checkDemoCredential(undefined, undefined)).toBe(false);
    // @ts-expect-error deliberately wrong
    expect(checkDemoCredential({ toUpperCase: () => "DSO" }, "map")).toBe(false);
    // @ts-expect-error deliberately wrong
    expect(checkDemoCredential(null, null)).toBe(false);
  });

  it("is not truthy-coercible into an accidental pass", () => {
    // @ts-expect-error deliberately wrong
    expect(checkDemoCredential(true, true)).toBe(false);
    // @ts-expect-error deliberately wrong
    expect(checkDemoCredential(["DSO"], ["map"])).toBe(false);
  });
});

describe("it grants nothing", () => {
  it("returns a boolean and nothing else", () => {
    expect(typeof checkDemoCredential("DSO", "map")).toBe("boolean");
  });

  it("says plainly that it is a local demo", () => {
    expect(DEMO_CREDENTIAL_WARNING).toMatch(/local demo/i);
    expect(DEMO_CREDENTIAL_WARNING).toMatch(/no account|no session/i);
  });

  it("keeps the literals where the guard test can find them", () => {
    expect(DEMO_USERNAME).toBe("DSO");
    expect(DEMO_PASSWORD).toBe("map");
  });
});
