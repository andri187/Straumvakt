// Tests for the DB-aware effective-permissions resolver. Drives the
// pure resolver via `expandPermissionsSync` to exercise the
// platform.tenant.* expansion logic without hitting Prisma; the
// DB-touching `resolveEffectivePermissions` is exercised end-to-end
// via the route tests in admin/orgs.test.ts (TBD).

import { describe, expect, it } from "vitest";
import {
  expandPermissionsSync,
  satisfiedOnlyByPlatformGrant,
  type PermissionResolution,
} from "./effective-permissions";
import {
  MEMBERSHIP_ROLE_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  type Permission,
} from "./permissions";
import type {
  MembershipRole,
  PlatformRole,
} from "@straumvakt/shared/domain/users";

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
    expect(perms).toContain("site.delete");
    expect(perms).toContain("property.delete");
  });

  it("no platform grant confers membership ADMINISTRATION, only visibility", () => {
    // The carve-out the hierarchy-review note proposed and 4.3 deferred.
    // member.write gates PUT /api/admin/users/:id/password, which sets any
    // user's password; the unconditional expansion handed that to every
    // platform.tenant.write holder, sales_cs included.
    for (const role of ["platform_admin", "super_user", "sales_cs"] as const) {
      const perms = expandPermissionsSync(null, { role });
      expect(perms).toContain("member.read"); // support still needs to see
      expect(perms).not.toContain("member.write");
      expect(perms).not.toContain("member.invite");
      expect(perms).not.toContain("member.remove");
    }
  });

  it("a membership that grants member.write still does", () => {
    // The carve-out must not lock out the legitimate path. An org owner
    // administers their own members; only the platform shortcut is gone.
    const perms = expandPermissionsSync({ role: "owner" }, { role: "sales_cs" });
    expect(perms).toContain("member.write");
    expect(perms).toContain("member.remove");
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

// ─────────────────────────────────────────────────────────────────────
// Provenance
// ─────────────────────────────────────────────────────────────────────

// Derived from the maps, never hand-listed. permissions.test.ts:26-38
// hard-codes an 11-entry ALL_MEMBERSHIP_ROLES that omits host_admin, so
// its four "exhaustive" assertions silently skip the newest bundle.
const MEMBERSHIP_ROLES = Object.keys(
  MEMBERSHIP_ROLE_PERMISSIONS,
) as MembershipRole[];
const PLATFORM_ROLES = Object.keys(
  PLATFORM_ROLE_PERMISSIONS,
) as PlatformRole[];

function resolutionFor(
  membership: MembershipRole | null,
  platform: PlatformRole | null,
): PermissionResolution {
  const viaMembership = expandPermissionsSync(
    membership ? { role: membership } : null,
    null,
  );
  const viaPlatform = expandPermissionsSync(
    null,
    platform ? { role: platform } : null,
  );
  return {
    all: Array.from(new Set<Permission>([...viaMembership, ...viaPlatform])),
    viaMembership,
    viaPlatform,
    membershipRole: membership,
    platformRole: platform,
  };
}

describe("provenance — split-then-union equals the legacy combined set", () => {
  // The merge gate. resolvePermissionsWithProvenance computes
  // union(expand(m,null), expand(null,g)); the resolver it replaced
  // computed expand(m,g). If those ever differ, the additive refactor
  // silently changes who can do what.
  it("holds for every membership role x platform role, including null", () => {
    const mismatches: string[] = [];
    for (const m of [...MEMBERSHIP_ROLES, null]) {
      for (const p of [...PLATFORM_ROLES, null]) {
        const legacy = new Set(
          expandPermissionsSync(
            m ? { role: m } : null,
            p ? { role: p } : null,
          ),
        );
        const split = new Set(resolutionFor(m, p).all);
        if (
          legacy.size !== split.size ||
          [...legacy].some((v) => !split.has(v))
        ) {
          mismatches.push(`${m ?? "none"}+${p ?? "none"}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("covers every role in the maps, not a hand-written list", () => {
    expect(MEMBERSHIP_ROLES).toContain("host_admin");
    expect(MEMBERSHIP_ROLES.length).toBe(
      Object.keys(MEMBERSHIP_ROLE_PERMISSIONS).length,
    );
    expect(PLATFORM_ROLES.length).toBe(6);
  });
});

describe("satisfiedOnlyByPlatformGrant", () => {
  it("is true when only the platform grant supplies the verb", () => {
    // staff-carol: no membership in this org, support_agent grant.
    const r = resolutionFor(null, "support_agent");
    expect(r.all).toContain("site.read");
    expect(satisfiedOnlyByPlatformGrant(r, "site.read")).toBe(true);
  });

  // ── The discriminating case (doc 19 §3.8) ──────────────────────────
  //
  // Every other fixture passes under BOTH the correct implementation and
  // the union bug. Only a user holding an active membership that grants
  // the verb AND an active platform grant separates them. If this ever
  // reads `viaPlatform.includes(verb)`, a Straumvakt employee who is
  // genuinely a member of a partner org is forced into a support context
  // for their own member actions — a staff lockout, T-SC-5.
  it("is FALSE when the user is also a member whose role grants the verb", () => {
    const r = resolutionFor("owner", "platform_admin");
    expect(r.viaMembership).toContain("site.write"); // member path exists
    expect(r.viaPlatform).toContain("site.write"); // platform path too
    expect(satisfiedOnlyByPlatformGrant(r, "site.write")).toBe(false);
  });

  it("is false for a verb the user does not have at all", () => {
    const r = resolutionFor("viewer", null);
    expect(r.all).not.toContain("site.delete");
    expect(satisfiedOnlyByPlatformGrant(r, "site.delete")).toBe(false);
  });

  it("viaMembership never carries platform-expanded verbs", () => {
    // The property the difference depends on: expandPlatformTenantVerbs
    // is inert without a platform.tenant.* verb to trigger on.
    const r = resolutionFor("viewer", "super_user");
    expect(r.viaMembership).not.toContain("site.delete");
    expect(r.viaMembership).not.toContain("member.remove");
    expect(r.viaPlatform).toContain("site.delete");
  });

  it("a sales_cs grant no longer reaches member.write — the takeover path, closed", () => {
    // permissions.ts:268 annotates sales_cs "column-restricted in repo
    // layer (org notes/tags only)" — a restriction implemented nowhere.
    // Until the carve-out, this role reached member.write and therefore
    // PUT /api/admin/users/:id/password for any user in any tenant.
    const r = resolutionFor(null, "sales_cs");
    expect(satisfiedOnlyByPlatformGrant(r, "member.write")).toBe(false);

    // Still reachable, and still not restricted by anything. Recorded
    // rather than fixed: narrowing charger control is a separate decision
    // about what customer-success staff are meant to be able to do.
    expect(satisfiedOnlyByPlatformGrant(r, "charger.remote_start")).toBe(true);
    expect(satisfiedOnlyByPlatformGrant(r, "billing.write")).toBe(true);
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
