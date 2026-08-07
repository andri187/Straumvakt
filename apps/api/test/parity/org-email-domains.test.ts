// tenancy.org_email_domains — route guards + repository, against the real DB.
//
// ── WHY THIS MOVED HERE 2026-08-07 ──────────────────────────────────────
//
// Fifth and final conversion of the hand-rolled fake-PrismaClient pattern in
// this batch. Same breakage, same resolution: real Postgres, every case in a
// transaction that is rolled back, `makeDrizzle` mocked to hand the route
// that transaction.
//
// What the fake could not have caught and this does:
//   - `domain` carries a UNIQUE constraint, so the 409 path is a real
//     constraint violation rather than a lookup the fake simulated.
//   - the driver-group cross-org guard runs against a real FK.
//
// It borrows an existing org and driver group off the branch rather than
// seeding them: driver_groups.agreement_id and owner_org_id are both NOT
// NULL FKs, so seeding one means standing up an agreement and an org.
//
// EVERY CASE ROLLS BACK.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeAll, getDrizzle, hasDb } from "./_harness";
import { driverGroups } from "@straumvakt/shared/db/commercial";
import { orgEmailDomains } from "@straumvakt/shared/db/identity";

const ROLLBACK = Symbol("rollback");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeTx: any = null;

vi.mock("../../src/lib/drizzle", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, makeDrizzle: () => activeTx };
});

vi.mock("../../src/lib/admin-session", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (await importOriginal()) as any;
  return {
    ...real,
    verifyAdminSession: async () => ({ sub: "admin", iat: Math.floor(Date.now() / 1000) }),
    adminSessionConfig: real.adminSessionConfig ?? { SESSION_COOKIE_NAME: "sv_session" },
  };
});

let effectivePerms: string[] = ["member.write", "member.read", "platform.tenant.read"];
vi.mock("../../src/lib/auth/effective-permissions", () => ({
  resolveEffectivePermissions: async () => effectivePerms,
}));

const { adminOrgEmailDomains } = await import("../../src/routes/admin/org-email-domains");
const {
  listEmailDomainsForOrg,
  createEmailDomain,
  updateEmailDomain,
  deleteEmailDomain,
  findEmailDomainByDomain,
} = await import("../../src/repositories/org-email-domains");

const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ENV: any = { AUTH_SECRET: "test" };

async function call(method: string, url: string, body?: unknown) {
  return adminOrgEmailDomains.fetch(
    new Request(`http://test${url}`, {
      method,
      headers: { "content-type": "application/json", cookie: "straumvakt_admin_session=fake" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    ENV,
  );
}

async function inRollback(fn: () => Promise<void>): Promise<void> {
  try {
    await getDrizzle().transaction(async (tx) => {
      activeTx = tx;
      await fn();
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  } finally {
    activeTx = null;
  }
}

let ORG_ID = "";
let GROUP_ID = "";
// Unique per run so a crashed run cannot collide with the next.
const dom = (n: string) => `parity-${n}-${Math.floor(performance.now() * 1e6)}.is`;

describe.skipIf(!hasDb)("org email domains (real DB, rolled back)", () => {
  afterAll(closeAll);

  beforeAll(async () => {
    const [g] = await getDrizzle()
      .select({ id: driverGroups.id, ownerOrgId: driverGroups.ownerOrgId })
      .from(driverGroups)
      .limit(1);
    if (!g) throw new Error("no driver_groups row on this branch — cannot run");
    GROUP_ID = g.id;
    ORG_ID = g.ownerOrgId;
  });

  beforeEach(() => {
    effectivePerms = ["member.write", "member.read", "platform.tenant.read"];
  });

  // ── route ───────────────────────────────────────────────────────────────

  it("POST creates a rule with policy=request_approval and returns 201", async () => {
    await inRollback(async () => {
      const res = await call("POST", `/${ORG_ID}/email-domains`, {
        domain: dom("create"),
        policy: "request_approval",
      });
      expect(res.status).toBe(201);
    });
  });

  it("POST with auto_join and a driver group from another org → 400", async () => {
    await inRollback(async () => {
      // The group exists but belongs to ORG_ID, so asking under OTHER_ORG
      // must be refused rather than silently accepted.
      const res = await call("POST", `/${OTHER_ORG}/email-domains`, {
        domain: dom("crossorg"),
        policy: "auto_join",
        defaultDriverGroupId: GROUP_ID,
      });
      expect(res.status).toBe(400);
    });
  });

  it("POST with a duplicate domain → 409 domain_taken", async () => {
    await inRollback(async () => {
      const d = dom("dupe");
      const first = await call("POST", `/${ORG_ID}/email-domains`, {
        domain: d,
        policy: "request_approval",
      });
      expect(first.status).toBe(201);
      // A real UNIQUE violation, not a simulated lookup.
      const second = await call("POST", `/${ORG_ID}/email-domains`, {
        domain: d,
        policy: "request_approval",
      });
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: string }).error).toBe("domain_taken");
    });
  });

  it("GET returns only rules belonging to the requested org", async () => {
    await inRollback(async () => {
      const mine = dom("mine");
      await createEmailDomain(activeTx, { orgId: ORG_ID, domain: mine, policy: "disabled" });
      const res = await call("GET", `/${ORG_ID}/email-domains`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { domains: { domain: string; orgId: string }[] };
      expect(body.domains.some((r) => r.domain === mine)).toBe(true);
      expect(body.domains.every((r) => r.orgId === ORG_ID)).toBe(true);
    });
  });

  // ── repository ──────────────────────────────────────────────────────────

  it("createEmailDomain lowercases the domain before storing", async () => {
    await inRollback(async () => {
      const d = dom("Case").toUpperCase();
      const row = await createEmailDomain(activeTx, {
        orgId: ORG_ID,
        domain: d,
        policy: "disabled",
      });
      expect(row.domain).toBe(d.toLowerCase());
      const found = await findEmailDomainByDomain(activeTx, d);
      expect(found?.id).toBe(row.id);
    });
  });

  it("resolves the default driver group's display name through the join", async () => {
    await inRollback(async () => {
      const [g] = await activeTx
        .select({ displayName: driverGroups.displayName })
        .from(driverGroups)
        .where(eq(driverGroups.id, GROUP_ID))
        .limit(1);
      const row = await createEmailDomain(activeTx, {
        orgId: ORG_ID,
        domain: dom("join"),
        policy: "auto_join",
        defaultDriverGroupId: GROUP_ID,
      });
      expect(row.defaultDriverGroupId).toBe(GROUP_ID);
      expect(row.defaultDriverGroupDisplayName).toBe(g.displayName);
    });
  });

  it("returns a null group name when no default group is set", async () => {
    // The join must be LEFT — a rule with no group has to come back anyway.
    await inRollback(async () => {
      const row = await createEmailDomain(activeTx, {
        orgId: ORG_ID,
        domain: dom("nogroup"),
        policy: "disabled",
      });
      expect(row.defaultDriverGroupId).toBeNull();
      expect(row.defaultDriverGroupDisplayName).toBeNull();
    });
  });

  it("updateEmailDomain changes the policy and returns the fresh row", async () => {
    await inRollback(async () => {
      const row = await createEmailDomain(activeTx, {
        orgId: ORG_ID,
        domain: dom("patch"),
        policy: "disabled",
      });
      const updated = await updateEmailDomain(activeTx, row.id, {
        policy: "request_approval",
      });
      expect(updated?.policy).toBe("request_approval");
    });
  });

  it("updateEmailDomain returns null for a non-existent row", async () => {
    await inRollback(async () => {
      expect(await updateEmailDomain(activeTx, MISSING_ID, { policy: "disabled" })).toBeNull();
    });
  });

  it("deleteEmailDomain returns true then false", async () => {
    await inRollback(async () => {
      const row = await createEmailDomain(activeTx, {
        orgId: ORG_ID,
        domain: dom("del"),
        policy: "disabled",
      });
      expect(await deleteEmailDomain(activeTx, row.id)).toBe(true);
      expect(await deleteEmailDomain(activeTx, row.id)).toBe(false);
      const [gone] = await activeTx
        .select()
        .from(orgEmailDomains)
        .where(eq(orgEmailDomains.id, row.id));
      expect(gone).toBeUndefined();
    });
  });

  it("findEmailDomainByDomain returns null when no rule matches", async () => {
    await inRollback(async () => {
      expect(await findEmailDomainByDomain(activeTx, dom("absent"))).toBeNull();
    });
  });

  it("listEmailDomainsForOrg returns an empty array for an org with no rules", async () => {
    await inRollback(async () => {
      expect(await listEmailDomainsForOrg(activeTx, OTHER_ORG)).toEqual([]);
    });
  });
});
