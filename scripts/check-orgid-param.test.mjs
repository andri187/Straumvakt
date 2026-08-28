// Tenant-scoping guard — tests.
//
// The guard's value is that it fails in BOTH directions: when a new unscoped
// gate appears, and when an allowlisted one is fixed but left in the list. A
// debt register that never shrinks stops being a debt register.

import { describe, it, expect } from "vitest";
import {
  findUnscopedGates,
  diffAgainstAllowlist,
  isPerTenantVerb,
  stripComments,
  GATE,
  ALLOWED,
  PER_TENANT_PREFIXES,
} from "./check-orgid-param.mjs";

describe("the committed repo", () => {
  it("has exactly the allowlisted unscoped gates and no others", () => {
    const { unexpected, vanished } = diffAgainstAllowlist(findUnscopedGates());
    expect(unexpected).toEqual([]);
    expect(vanished).toEqual([]);
  });

  it("records the measured debt rather than an empty gesture", () => {
    // 36 distinct file:verb pairs, measured 2026-08-11. If this drops, the
    // debt was paid and entries must be deleted; if it rises, something
    // slipped past review.
    expect(ALLOWED.size).toBe(36);
  });

  it("every allowlist entry carries a reason, not just a path", () => {
    for (const [key, reason] of ALLOWED) {
      expect(key).toMatch(/^apps\/api\/src\/routes\/.+\.ts:[a-z]+\.[a-z_]+$/);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("the debt is concentrated in billing, which is what Core needs", () => {
    const billing = [...ALLOWED.keys()].filter((k) => k.endsWith(":billing.read") || k.endsWith(":billing.write"));
    expect(billing.length).toBeGreaterThanOrEqual(15);
  });
});

describe("it can actually fail — the fool tests", () => {
  it("flags a NEW unscoped gate", () => {
    const found = [
      ...findUnscopedGates(),
      { file: "apps/api/src/routes/admin/brand-new.ts", line: 12, verb: "billing.read" },
    ];
    const { unexpected } = diffAgainstAllowlist(found);
    expect(unexpected).toHaveLength(1);
    expect(unexpected[0].file).toBe("apps/api/src/routes/admin/brand-new.ts");
  });

  it("flags an allowlisted gate that was FIXED and left in the list", () => {
    const found = findUnscopedGates().filter(
      (g) => g.file !== "apps/api/src/routes/admin/billing-dso.ts",
    );
    const { vanished } = diffAgainstAllowlist(found);
    expect(vanished).toContain("apps/api/src/routes/admin/billing-dso.ts:billing.read");
  });

  it("an empty allowlist rejects everything currently unscoped", () => {
    const { unexpected } = diffAgainstAllowlist(findUnscopedGates(), new Map());
    expect(unexpected.length).toBeGreaterThan(30);
  });
});

describe("which verbs count", () => {
  it("treats per-tenant verbs as needing a tenant", () => {
    for (const v of ["billing.read", "billing.write", "member.read", "tariff.write", "site.read", "charger.config", "property.delete"]) {
      expect(isPerTenantVerb(v), v).toBe(true);
    }
  });

  it("does NOT flag platform verbs, which are tenant-wide by definition", () => {
    // Flagging these would train people to ignore the check.
    for (const v of ["platform.tenant.read", "platform.tenant.write", "platform.admin"]) {
      expect(isPerTenantVerb(v), v).toBe(false);
    }
  });

  it("keeps the prefix list explicit rather than matching everything", () => {
    expect(PER_TENANT_PREFIXES.length).toBeGreaterThan(3);
    expect(PER_TENANT_PREFIXES.every((p) => p.endsWith("."))).toBe(true);
  });
});

describe("detection is narrow on purpose", () => {
  it("matches a gate with no options object", () => {
    GATE.lastIndex = 0;
    expect(GATE.test('requirePermission("billing.read")')).toBe(true);
  });

  it("does not count a gate named inside a comment", () => {
    const src = '// requirePermission("billing.read") is the gate\nconst x = 1;';
    expect(stripComments(src)).not.toContain("requirePermission");
  });

  it("does not count one inside a block comment", () => {
    expect(stripComments('/* requirePermission("billing.read") */')).not.toContain("requirePermission");
  });

  it("still sees a real gate after a trailing comment on the same line", () => {
    const src = 'requirePermission("billing.read"), // the gate';
    expect(stripComments(src)).toContain("requirePermission");
  });
});
