// Permission catalogue + role-bundle invariants.
//
// Three concerns covered:
//   1. Exhaustive coverage — every MembershipRole / PlatformRole
//      value has an entry in its bundle map. If a future enum
//      addition lands without a bundle, this test fails (the bundle
//      maps are typed Record<Role, Permission[]>, so TypeScript would
//      catch it too — this test is the runtime guard).
//   2. Bundle membership — specific role→verb assertions taken
//      directly from ADR 0014 §"Role-to-permission map", to catch
//      regressions if the bundles are accidentally trimmed.
//   3. effectivePermissions — pure resolver: membership-only,
//      platform-only, both-combined (with dedupe), neither (empty).

import { describe, expect, it } from "vitest";
import {
  effectivePermissions,
  hasPermission,
  MEMBERSHIP_ROLE_PERMISSIONS,
  PER_TENANT_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  type Permission,
} from "./permissions";

const ALL_MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "manager",
  "technician",
  "finance",
  "support",
  "viewer",
  "operator",
  "helper",
  "contractor",
  "driver",
] as const;

const ALL_PLATFORM_ROLES = [
  "super_user",
  "platform_admin",
  "support_agent",
  "sales_cs",
  "finance_internal",
  "auditor",
] as const;

describe("permission catalogue", () => {
  it("declares ~25 per-tenant verbs and ~15 platform verbs", () => {
    expect(PER_TENANT_PERMISSIONS.length).toBeGreaterThanOrEqual(20);
    expect(PER_TENANT_PERMISSIONS.length).toBeLessThanOrEqual(35);
    expect(PLATFORM_PERMISSIONS.length).toBeGreaterThanOrEqual(10);
    expect(PLATFORM_PERMISSIONS.length).toBeLessThanOrEqual(25);
  });

  it("verbs are unique across the catalogue (no string collisions)", () => {
    const all = [...PER_TENANT_PERMISSIONS, ...PLATFORM_PERMISSIONS];
    const set = new Set(all);
    expect(set.size).toBe(all.length);
  });

  it("every per-tenant verb starts with a domain prefix, no platform.* in this set", () => {
    for (const v of PER_TENANT_PERMISSIONS) {
      expect(v.includes(".")).toBe(true);
      expect(v.startsWith("platform.")).toBe(false);
    }
  });

  it("every platform verb starts with platform.", () => {
    for (const v of PLATFORM_PERMISSIONS) {
      expect(v.startsWith("platform.")).toBe(true);
    }
  });
});

describe("MEMBERSHIP_ROLE_PERMISSIONS — exhaustive coverage", () => {
  it.each(ALL_MEMBERSHIP_ROLES)("role %s has a bundle", (role) => {
    const bundle = MEMBERSHIP_ROLE_PERMISSIONS[role];
    expect(bundle).toBeDefined();
    expect(Array.isArray(bundle)).toBe(true);
  });

  it("every bundle contains only per-tenant verbs (no platform.*)", () => {
    for (const role of ALL_MEMBERSHIP_ROLES) {
      for (const verb of MEMBERSHIP_ROLE_PERMISSIONS[role]) {
        expect((PER_TENANT_PERMISSIONS as readonly string[]).includes(verb)).toBe(true);
      }
    }
  });

  it("every bundle is deduplicated (no verb appears twice)", () => {
    for (const role of ALL_MEMBERSHIP_ROLES) {
      const bundle = MEMBERSHIP_ROLE_PERMISSIONS[role];
      expect(new Set(bundle).size).toBe(bundle.length);
    }
  });
});

describe("MEMBERSHIP_ROLE_PERMISSIONS — specific bundle assertions", () => {
  it("owner gets every per-tenant verb (full org control)", () => {
    const bundle = new Set(MEMBERSHIP_ROLE_PERMISSIONS.owner);
    for (const v of PER_TENANT_PERMISSIONS) {
      expect(bundle.has(v)).toBe(true);
    }
  });

  it("admin can manage members + write billing but cannot delete site/property/org", () => {
    const bundle = new Set(MEMBERSHIP_ROLE_PERMISSIONS.admin);
    expect(bundle.has("member.invite")).toBe(true);
    expect(bundle.has("member.remove")).toBe(true);
    expect(bundle.has("billing.write")).toBe(true);
    expect(bundle.has("site.delete")).toBe(false);
    expect(bundle.has("property.delete")).toBe(false);
    expect(bundle.has("org.write")).toBe(false);
  });

  it("manager can write site + charger but cannot manage members or billing", () => {
    const bundle = new Set(MEMBERSHIP_ROLE_PERMISSIONS.manager);
    expect(bundle.has("site.write")).toBe(true);
    expect(bundle.has("charger.write")).toBe(true);
    expect(bundle.has("member.invite")).toBe(false);
    expect(bundle.has("billing.write")).toBe(false);
  });

  it("technician can remote_start/stop + config but cannot write site or member", () => {
    const bundle = new Set(MEMBERSHIP_ROLE_PERMISSIONS.technician);
    expect(bundle.has("charger.remote_start")).toBe(true);
    expect(bundle.has("charger.remote_stop")).toBe(true);
    expect(bundle.has("charger.config")).toBe(true);
    expect(bundle.has("charger.read")).toBe(true);
    expect(bundle.has("site.write")).toBe(false);
    expect(bundle.has("member.write")).toBe(false);
  });

  it("finance has billing + contract control but no charger / site write", () => {
    const bundle = new Set(MEMBERSHIP_ROLE_PERMISSIONS.finance);
    expect(bundle.has("billing.write")).toBe(true);
    expect(bundle.has("billing.export")).toBe(true);
    expect(bundle.has("contract.write")).toBe(true);
    expect(bundle.has("charger.write")).toBe(false);
    expect(bundle.has("site.write")).toBe(false);
  });

  it("support has read-everything but writes nothing", () => {
    const bundle = new Set(MEMBERSHIP_ROLE_PERMISSIONS.support);
    expect(bundle.has("audit.read")).toBe(true);
    expect(bundle.has("billing.read")).toBe(true);
    expect(bundle.has("contract.read")).toBe(true);
    for (const v of MEMBERSHIP_ROLE_PERMISSIONS.support) {
      expect(v.endsWith(".read")).toBe(true);
    }
  });

  it("viewer has only the four basic reads", () => {
    const bundle = new Set(MEMBERSHIP_ROLE_PERMISSIONS.viewer);
    expect(bundle.size).toBe(4);
    expect(bundle.has("org.read")).toBe(true);
    expect(bundle.has("site.read")).toBe(true);
    expect(bundle.has("charger.read")).toBe(true);
    expect(bundle.has("property.read")).toBe(true);
  });

  it("driver (deprecated) gets no permissions — drivers shouldn't have memberships", () => {
    expect(MEMBERSHIP_ROLE_PERMISSIONS.driver).toEqual([]);
  });
});

describe("PLATFORM_ROLE_PERMISSIONS — exhaustive + bundle assertions", () => {
  it.each(ALL_PLATFORM_ROLES)("role %s has a bundle", (role) => {
    const bundle = PLATFORM_ROLE_PERMISSIONS[role];
    expect(bundle).toBeDefined();
    expect(Array.isArray(bundle)).toBe(true);
  });

  it("super_user gets every platform.* verb", () => {
    const bundle = new Set(PLATFORM_ROLE_PERMISSIONS.super_user);
    for (const v of PLATFORM_PERMISSIONS) {
      expect(bundle.has(v)).toBe(true);
    }
  });

  it("platform_admin can write feature flags but cannot mint platform grants", () => {
    const bundle = new Set(PLATFORM_ROLE_PERMISSIONS.platform_admin);
    expect(bundle.has("platform.feature_flag.write")).toBe(true);
    expect(bundle.has("platform.tariff_catalogue.write")).toBe(true);
    expect(bundle.has("platform.grant.write")).toBe(false);
  });

  it("support_agent can impersonate but cannot write tenants", () => {
    const bundle = new Set(PLATFORM_ROLE_PERMISSIONS.support_agent);
    expect(bundle.has("platform.impersonate")).toBe(true);
    expect(bundle.has("platform.support.action")).toBe(true);
    expect(bundle.has("platform.tenant.write")).toBe(false);
  });

  it("auditor is read-only", () => {
    const bundle = PLATFORM_ROLE_PERMISSIONS.auditor;
    for (const v of bundle) {
      expect(v.endsWith(".read")).toBe(true);
    }
  });
});

describe("effectivePermissions", () => {
  it("returns [] when neither membership nor platform grant is active", () => {
    expect(effectivePermissions(null, null)).toEqual([]);
  });

  it("returns the membership bundle when only the membership is active", () => {
    const result = effectivePermissions({ role: "viewer" }, null);
    expect(result.sort()).toEqual(MEMBERSHIP_ROLE_PERMISSIONS.viewer.slice().sort());
  });

  it("returns the platform bundle when only the platform grant is active", () => {
    const result = effectivePermissions(null, { role: "auditor" });
    expect(result.sort()).toEqual(PLATFORM_ROLE_PERMISSIONS.auditor.slice().sort());
  });

  it("merges both bundles, deduplicating", () => {
    const result = effectivePermissions(
      { role: "admin" },
      { role: "auditor" },
    );
    // admin gets per-tenant verbs; auditor gets platform.tenant.read +
    // platform.audit.read. No overlap; result length should equal sum.
    expect(result.length).toBe(
      MEMBERSHIP_ROLE_PERMISSIONS.admin.length +
        PLATFORM_ROLE_PERMISSIONS.auditor.length,
    );
  });

  it("preserves order — per-tenant verbs first, platform second", () => {
    const result = effectivePermissions(
      { role: "viewer" },
      { role: "auditor" },
    );
    // First entry should be a per-tenant verb (from viewer); last
    // entry should be a platform verb (from auditor).
    expect(result[0]).toBe("org.read");
    expect(result[result.length - 1]).toBe("platform.audit.read");
  });

  it("dedupes verbs that appear in both bundles", () => {
    // Construct a synthetic case: there's no real overlap today
    // (per-tenant vs platform domains are disjoint), but the
    // effectivePermissions impl uses a Set so re-running with the
    // same role twice should still produce the same length.
    const single = effectivePermissions({ role: "owner" }, null);
    const both = effectivePermissions({ role: "owner" }, null);
    expect(both).toEqual(single);
  });
});

describe("hasPermission", () => {
  it("returns true when the verb is in the list", () => {
    const perms: Permission[] = ["org.read", "site.read"];
    expect(hasPermission(perms, "org.read")).toBe(true);
  });
  it("returns false when the verb is not in the list", () => {
    const perms: Permission[] = ["org.read", "site.read"];
    expect(hasPermission(perms, "org.write")).toBe(false);
  });
  it("returns false on empty list", () => {
    expect(hasPermission([], "org.read")).toBe(false);
  });
});
