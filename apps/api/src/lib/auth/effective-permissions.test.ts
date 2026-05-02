// Tests for the DB-aware effective-permissions resolver. Drives the
// pure resolver via `expandPermissionsSync` to exercise the
// platform.tenant.* expansion logic without hitting Prisma; the
// DB-touching `resolveEffectivePermissions` is exercised end-to-end
// via the route tests in admin/orgs.test.ts (TBD).

import { describe, expect, it } from "vitest";
import { expandPermissionsSync } from "./effective-permissions";
import type { Permission } from "./permissions";

describe("expandPermissionsSync — platform.tenant.* expansion", () => {
  it("returns [] for null/null inputs", () => {
    expect(expandPermissionsSync(null, null)).toEqual([]);
  });

  it("returns membership-only bundle when no platform grant", () => {
    const perms = expandPermissionsSync({ role: "viewer" }, null);
    expect(perms).toContain("org.read");
    expect(perms).toContain("site.read");
    // viewer doesn't get write
    expect(perms).not.toContain("site.write");
  });

  it("returns platform-only bundle when no membership", () => {
    const perms = expandPermissionsSync(null, { role: "auditor" });
    // auditor has platform.tenant.read + platform.audit.read
    expect(perms).toContain("platform.tenant.read");
    expect(perms).toContain("platform.audit.read");
    // platform.tenant.read expansion → all per-tenant *.read
    expect(perms).toContain("site.read");
    expect(perms).toContain("charger.read");
    expect(perms).toContain("billing.read");
    // No write expansion for read-only
    expect(perms).not.toContain("site.write");
    expect(perms).not.toContain("charger.write");
  });

  it("platform_admin gets full per-tenant read+write+delete expansion", () => {
    // platform_admin has platform.tenant.{read,write,delete} per ADR 0014.
    const perms = expandPermissionsSync(null, { role: "platform_admin" });
    expect(perms).toContain("site.write");
    expect(perms).toContain("charger.write");
    expect(perms).toContain("charger.config");
    expect(perms).toContain("charger.remote_start");
    expect(perms).toContain("billing.write");
    expect(perms).toContain("billing.export");
    expect(perms).toContain("member.invite");
    expect(perms).toContain("member.write");
    expect(perms).toContain("member.remove");
    expect(perms).toContain("site.delete");
    expect(perms).toContain("property.delete");
  });

  it("sales_cs (platform.tenant.{read,write} only) gets read+write but NOT delete", () => {
    const perms = expandPermissionsSync(null, { role: "sales_cs" });
    expect(perms).toContain("site.read");
    expect(perms).toContain("site.write");
    // sales_cs lacks platform.tenant.delete → no delete expansion
    expect(perms).not.toContain("site.delete");
    expect(perms).not.toContain("property.delete");
  });

  it("super_user gets full per-tenant read+write+delete expansion", () => {
    const perms = expandPermissionsSync(null, { role: "super_user" });
    expect(perms).toContain("site.delete");
    expect(perms).toContain("property.delete");
    // also has all platform.* verbs natively
    expect(perms).toContain("platform.grant.write");
    expect(perms).toContain("platform.migration.run");
  });

  it("platform_admin + viewer membership unions cleanly", () => {
    const perms = expandPermissionsSync(
      { role: "viewer" },
      { role: "platform_admin" },
    );
    // Has both viewer's per-tenant + platform_admin's expanded set
    expect(perms).toContain("site.write"); // from platform expansion
    expect(perms).toContain("charger.write"); // from platform expansion
    expect(perms).toContain("platform.feature_flag.write"); // from platform native
  });

  it("auditor (read-only) does NOT confer write access even with viewer membership", () => {
    const perms = expandPermissionsSync(
      { role: "viewer" },
      { role: "auditor" },
    );
    expect(perms).toContain("site.read");
    expect(perms).not.toContain("site.write");
    expect(perms).not.toContain("charger.remote_start");
  });

  it("expansion is idempotent — verbs aren't duplicated", () => {
    const perms = expandPermissionsSync(
      { role: "owner" }, // owner has every per-tenant verb already
      { role: "super_user" }, // expansion adds the same verbs
    );
    const set = new Set(perms);
    expect(set.size).toBe(perms.length);
  });

  it("preserves union semantics — both bundles' verbs end up in the result", () => {
    const perms = expandPermissionsSync(
      { role: "manager" },
      { role: "auditor" },
    );
    // manager-specific verb
    expect(perms).toContain("charger.write");
    // auditor's platform verbs
    expect(perms).toContain("platform.audit.read");
    // platform.tenant.read expansion adds tenant reads
    expect(perms).toContain("audit.read");
  });

  it("a finance_internal grant does NOT touch per-tenant verbs (no platform.tenant.*)", () => {
    const perms = expandPermissionsSync(null, { role: "finance_internal" });
    // finance_internal has platform.tenant.read → adds *.read
    expect(perms).toContain("site.read");
    // But NOT site.write, since it doesn't have platform.tenant.write
    expect(perms).not.toContain("site.write");
    // It DOES have platform.finance.* natively
    expect(perms).toContain("platform.finance.read");
    expect(perms).toContain("platform.finance.write");
  });
});

describe("expandPermissionsSync — degenerate cases", () => {
  it("driver membership gives no per-tenant verbs (deprecated value mapped to [])", () => {
    const perms: Permission[] = expandPermissionsSync({ role: "driver" }, null);
    expect(perms).toEqual([]);
  });

  it("operator membership (deprecated) gives manager-equivalent perms", () => {
    const operatorPerms = expandPermissionsSync({ role: "operator" }, null);
    const managerPerms = expandPermissionsSync({ role: "manager" }, null);
    expect(operatorPerms.sort()).toEqual(managerPerms.slice().sort());
  });
});
