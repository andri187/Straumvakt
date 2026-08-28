// Pricing single-source-of-truth guard — tests.
//
// The guard's value is that it fails when a fifth pricing path appears, so
// the tests that matter are the ones proving it CAN fail.

import { describe, it, expect } from "vitest";
import {
  findPricingCallSites,
  diffAgainstAllowlist,
  stripCommentsAndStrings,
  PRICING_CALL,
  ALLOWED,
} from "./check-pricing-ssot.mjs";

describe("the committed repo", () => {
  it("has exactly the six known pricing call sites", () => {
    const found = findPricingCallSites();
    expect(found).toEqual([
      "apps/api/scripts/backfill-session-costs.ts",
      "apps/api/scripts/shadow-compare-resolvers.ts",
      "apps/api/src/lib/ocpp/projections.ts",
      "apps/api/src/lib/tariff/compute-session-cost.ts",
      "apps/api/src/repositories/zaptec-session-sync.ts",
      "apps/api/src/routes/webhooks/zaptec.ts",
    ]);
  });

  it("passes the allowlist with nothing unexpected and nothing stale", () => {
    const { unexpected, vanished } = diffAgainstAllowlist(findPricingCallSites());
    expect(unexpected).toEqual([]);
    expect(vanished).toEqual([]);
  });

  it("every allowlist entry carries a reason, not just a path", () => {
    for (const [path, reason] of ALLOWED) {
      expect(reason.length).toBeGreaterThan(20);
      expect(path).toMatch(/\.(ts|mts|mjs)$/);
    }
  });
});

describe("it can actually fail — the fool tests", () => {
  it("flags a new pricing path", () => {
    const found = [...findPricingCallSites(), "apps/api/src/routes/admin/new-invoice.ts"].sort();
    const { unexpected } = diffAgainstAllowlist(found);
    expect(unexpected).toEqual(["apps/api/src/routes/admin/new-invoice.ts"]);
  });

  it("flags an allowlist entry that no longer prices", () => {
    const found = findPricingCallSites().filter(
      (f) => f !== "apps/api/src/routes/webhooks/zaptec.ts",
    );
    const { vanished } = diffAgainstAllowlist(found);
    expect(vanished).toEqual(["apps/api/src/routes/webhooks/zaptec.ts"]);
  });

  it("an empty allowlist rejects everything", () => {
    const { unexpected } = diffAgainstAllowlist(findPricingCallSites(), new Map());
    expect(unexpected.length).toBe(6);
  });
});

describe("detection is narrow on purpose", () => {
  it("matches a real call", () => {
    expect(PRICING_CALL.test("const b = computeSessionCost(session, chain);")).toBe(true);
    expect(PRICING_CALL.test("computeSessionCost (a, b)")).toBe(true);
  });

  it("does not match an import or a bare mention", () => {
    expect(PRICING_CALL.test('import { computeSessionCost } from "x";')).toBe(false);
    expect(PRICING_CALL.test("// see computeSessionCost for the rules")).toBe(false);
  });

  it("ignores a call named inside a comment", () => {
    const src = "// computeSessionCost(a) is the entry point\nconst x = 1;";
    expect(PRICING_CALL.test(stripCommentsAndStrings(src))).toBe(false);
  });

  it("ignores a call named inside a block comment or a string", () => {
    expect(PRICING_CALL.test(stripCommentsAndStrings("/* computeSessionCost(a) */"))).toBe(false);
    expect(PRICING_CALL.test(stripCommentsAndStrings('const s = "computeSessionCost(a)";'))).toBe(false);
    expect(PRICING_CALL.test(stripCommentsAndStrings("const s = `computeSessionCost(a)`;"))).toBe(false);
  });

  it("still sees a real call sitting after a comment on the same line", () => {
    const src = "const b = computeSessionCost(s, c); // prices the session";
    expect(PRICING_CALL.test(stripCommentsAndStrings(src))).toBe(true);
  });

  // Selecting, serialising or type-declaring a money column is not pricing.
  // Matching those was the first attempt and produced 36 files of noise.
  it("does not treat a money column reference as a pricing path", () => {
    for (const line of [
      "costIskMinor: true,",
      "costIskMinor: string | null;",
      "costIskMinor: r.costIskMinor?.toString() ?? null,",
      '_sum: { costIskMinor: true },',
    ]) {
      expect(PRICING_CALL.test(stripCommentsAndStrings(line))).toBe(false);
    }
  });
});
