// Sprint 9 / ADR 0022 (ENROLL-3) — OrgEmailDomain route tests.
//
// Covers all spec cases:
//   1. POST with policy=request_approval (default) → 201
//   2. POST with policy=auto_join and no defaultDriverGroupId → 400
//   3. POST with policy=auto_join and defaultDriverGroupId from wrong org → 400
//   4. POST with duplicate domain → 409
//   5. PATCH updates policy
//   6. DELETE removes the row
//   7. GET filters by orgId
//   8. findEmailDomainByDomain returns the row for ENROLL-1's verify-email handler
//
// Pattern: fake PrismaClient via vi.mock("../../lib/prisma"), fake admin
// session via vi.mock("../../lib/admin-session"). Same approach as
// driver-group-memberships.test.ts.

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  findEmailDomainByDomain,
  listEmailDomainsForOrg,
  createEmailDomain,
  updateEmailDomain,
  deleteEmailDomain,
} from "../../repositories/org-email-domains";

// ─── Fake state ──────────────────────────────────────────────────────────────

interface FakeDomainRow {
  id: string;
  orgId: string;
  domain: string;
  policy: string;
  defaultDriverGroupId: string | null;
  createdAt: Date;
  updatedAt: Date;
  defaultDriverGroup: { id: string; displayName: string } | null;
}

interface FakeGroup {
  id: string;
  ownerOrgId: string;
  displayName: string;
}

interface FakeState {
  domains: FakeDomainRow[];
  groups: FakeGroup[];
  // set to true to simulate a unique constraint error on the next create
  simulateDuplicateDomain: boolean;
}

const fakeState: FakeState = {
  domains: [],
  groups: [],
  simulateDuplicateDomain: false,
};

function resetState() {
  fakeState.domains = [];
  fakeState.groups = [];
  fakeState.simulateDuplicateDomain = false;
}

// ─── Fake PrismaClient factory ───────────────────────────────────────────────

function makeFake() {
  return {
    orgEmailDomain: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) => {
        return fakeState.domains.filter((d) => d.orgId === where.orgId);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (where.domain !== undefined) {
          return fakeState.domains.find((d) => d.domain === where.domain) ?? null;
        }
        return fakeState.domains.find((d) => d.id === where.id) ?? null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        if (fakeState.simulateDuplicateDomain) {
          const err = new Error("Unique constraint failed on the fields: (`domain`)");
          (err as unknown as { code: string }).code = "P2002";
          throw err;
        }
        if (fakeState.domains.find((d) => d.domain === data.domain)) {
          const err = new Error("Unique constraint failed on the fields: (`domain`)");
          (err as unknown as { code: string }).code = "P2002";
          throw err;
        }
        const row: FakeDomainRow = {
          id: "dom-" + crypto.randomUUID(),
          orgId: data.orgId,
          domain: data.domain,
          policy: data.policy,
          defaultDriverGroupId: data.defaultDriverGroupId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          defaultDriverGroup: data.defaultDriverGroupId
            ? fakeState.groups.find((g) => g.id === data.defaultDriverGroupId) ?? null
            : null,
        };
        fakeState.domains.push(row);
        return row;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where, data }: any) => {
        const idx = fakeState.domains.findIndex((d) => d.id === where.id);
        if (idx === -1) {
          const err = new Error("Record to update does not exist.");
          (err as unknown as { code: string }).code = "P2025";
          throw err;
        }
        const row = { ...fakeState.domains[idx]!, ...data, updatedAt: new Date() };
        fakeState.domains[idx] = row;
        return row;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete: async ({ where }: any) => {
        const idx = fakeState.domains.findIndex((d) => d.id === where.id);
        if (idx === -1) {
          const err = new Error("Record to delete does not exist.");
          (err as unknown as { code: string }).code = "P2025";
          throw err;
        }
        fakeState.domains.splice(idx, 1);
      },
    },
    driverGroup: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        return fakeState.groups.find((g) => g.id === where.id) ?? null;
      },
    },
  };
}

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => makeFake(),
}));

vi.mock("../../lib/admin-session", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (await importOriginal()) as any;
  return {
    ...real,
    verifyAdminSession: async (_secret: string, _cookie: string | undefined) => ({
      sub: "admin",
      iat: Math.floor(Date.now() / 1000),
    }),
    adminSessionConfig: real.adminSessionConfig ?? { SESSION_COOKIE_NAME: "sv_session" },
  };
});

// Import the Hono router AFTER mocks are installed.
import { adminOrgEmailDomains } from "./org-email-domains";

// ─── Constants ───────────────────────────────────────────────────────────────

const ORG_ID    = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
// Must be an RFC-9562-valid UUID (v4 nibble + 8/9/a/b variant nibble):
// the POST/PATCH bodies run defaultDriverGroupId through z.uuid(), which
// is strict under Zod 4. A structurally-invalid id short-circuits at
// validation and never reaches the cross-tenant ownerOrgId guard below.
// Real DriverGroup.id values are @default(uuid()) → v4, so this matches
// production shape.
const GROUP_ID  = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DOMAIN_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

// ─── HTTP helper ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRoute(method: string, path: string, body?: unknown, env: any = { AUTH_SECRET: "test" }) {
  const req = new Request(`http://test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: "straumvakt_admin_session=fake",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return adminOrgEmailDomains.fetch(req, env);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OrgEmailDomain routes (ENROLL-3)", () => {
  beforeEach(() => {
    resetState();
  });

  // ── Case 1: POST creates row with policy=request_approval ────────────────

  it("POST creates a domain rule with policy=request_approval and returns 201", async () => {
    const res = await callRoute("POST", `/${ORG_ID}/email-domains`, {
      domain: "example.com",
      policy: "request_approval",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { emailDomain: { domain: string; policy: string } };
    expect(body.emailDomain.domain).toBe("example.com");
    expect(body.emailDomain.policy).toBe("request_approval");
    expect(fakeState.domains).toHaveLength(1);
  });

  // ── Case 2: POST with auto_join requires defaultDriverGroupId → 400 ──────

  it("POST with policy=auto_join and no defaultDriverGroupId → 400", async () => {
    const res = await callRoute("POST", `/${ORG_ID}/email-domains`, {
      domain: "example.com",
      policy: "auto_join",
      // no defaultDriverGroupId
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("default_driver_group_required_for_auto_join");
    expect(fakeState.domains).toHaveLength(0);
  });

  // ── Case 3: POST with auto_join + group from different org → 400 ─────────

  it("POST with auto_join and defaultDriverGroupId from a different org → 400", async () => {
    fakeState.groups.push({
      id: GROUP_ID,
      ownerOrgId: OTHER_ORG, // belongs to a different org
      displayName: "Other Group",
    });

    const res = await callRoute("POST", `/${ORG_ID}/email-domains`, {
      domain: "example.com",
      policy: "auto_join",
      defaultDriverGroupId: GROUP_ID,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
    expect(fakeState.domains).toHaveLength(0);
  });

  // ── Case 4: POST with duplicate domain → 409 ─────────────────────────────

  it("POST with duplicate domain → 409 domain_taken", async () => {
    // First create succeeds.
    await callRoute("POST", `/${ORG_ID}/email-domains`, {
      domain: "dupe.is",
      policy: "disabled",
    });
    expect(fakeState.domains).toHaveLength(1);

    // Second create with same domain.
    const res = await callRoute("POST", `/${ORG_ID}/email-domains`, {
      domain: "dupe.is",
      policy: "request_approval",
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("domain_taken");
    expect(fakeState.domains).toHaveLength(1); // no new row
  });

  // ── Case 5: PATCH updates policy ─────────────────────────────────────────

  it("PATCH updates the policy of an existing domain rule", async () => {
    // Seed a row directly via fake state.
    const seed: FakeDomainRow = {
      id: DOMAIN_ID,
      orgId: ORG_ID,
      domain: "to-update.is",
      policy: "disabled",
      defaultDriverGroupId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      defaultDriverGroup: null,
    };
    fakeState.domains.push(seed);

    const res = await callRoute("PATCH", `/${ORG_ID}/email-domains/${DOMAIN_ID}`, {
      policy: "request_approval",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { emailDomain: { policy: string } };
    expect(body.emailDomain.policy).toBe("request_approval");
    expect(fakeState.domains[0]!.policy).toBe("request_approval");
  });

  // ── Case 6: DELETE removes the row ───────────────────────────────────────

  it("DELETE removes the domain rule and returns ok:true", async () => {
    fakeState.domains.push({
      id: DOMAIN_ID,
      orgId: ORG_ID,
      domain: "to-delete.is",
      policy: "disabled",
      defaultDriverGroupId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      defaultDriverGroup: null,
    });

    const res = await callRoute("DELETE", `/${ORG_ID}/email-domains/${DOMAIN_ID}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(fakeState.domains).toHaveLength(0);
  });

  // ── Case 7: GET filters by orgId ─────────────────────────────────────────

  it("GET returns only domain rules belonging to the requested orgId", async () => {
    // Seed two rows: one for ORG_ID, one for OTHER_ORG.
    fakeState.domains.push(
      {
        id: "aaa-" + DOMAIN_ID,
        orgId: ORG_ID,
        domain: "org-a.is",
        policy: "disabled",
        defaultDriverGroupId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        defaultDriverGroup: null,
      },
      {
        id: "bbb-" + DOMAIN_ID,
        orgId: OTHER_ORG,
        domain: "org-b.is",
        policy: "disabled",
        defaultDriverGroupId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        defaultDriverGroup: null,
      },
    );

    const res = await callRoute("GET", `/${ORG_ID}/email-domains`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { domains: Array<{ domain: string }> };
    expect(body.domains).toHaveLength(1);
    expect(body.domains[0]!.domain).toBe("org-a.is");
  });
});

// ─── Repository unit test: findEmailDomainByDomain ───────────────────────────
//
// Tests the function used by ENROLL-1's verify-email handler directly via the
// repository module (not the HTTP layer).

describe("findEmailDomainByDomain (ENROLL-1 integration point)", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns the domain row when a matching rule exists", async () => {
    fakeState.domains.push({
      id: DOMAIN_ID,
      orgId: ORG_ID,
      domain: "n1.is",
      policy: "auto_join",
      defaultDriverGroupId: GROUP_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
      defaultDriverGroup: { id: GROUP_ID, displayName: "N1 Drivers" },
    });

    const db = makeFake() as unknown as Parameters<typeof findEmailDomainByDomain>[0];
    const result = await findEmailDomainByDomain(db, "N1.IS"); // test case-insensitivity

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("n1.is");
    expect(result!.policy).toBe("auto_join");
    expect(result!.defaultDriverGroupId).toBe(GROUP_ID);
    expect(result!.defaultDriverGroupDisplayName).toBe("N1 Drivers");
  });

  it("returns null when no rule matches the domain", async () => {
    const db = makeFake() as unknown as Parameters<typeof findEmailDomainByDomain>[0];
    const result = await findEmailDomainByDomain(db, "unknown.com");
    expect(result).toBeNull();
  });

  it("createEmailDomain lowercases the domain before storing", async () => {
    const db = makeFake() as unknown as Parameters<typeof createEmailDomain>[0];
    const row = await createEmailDomain(db, {
      orgId: ORG_ID,
      domain: "EXAMPLE.COM",
      policy: "disabled",
    });
    expect(row.domain).toBe("example.com");
    expect(fakeState.domains[0]!.domain).toBe("example.com");
  });

  it("updateEmailDomain returns null for a non-existent row", async () => {
    const db = makeFake() as unknown as Parameters<typeof updateEmailDomain>[0];
    const result = await updateEmailDomain(db, "nonexistent-id", {
      policy: "disabled",
    });
    expect(result).toBeNull();
  });

  it("deleteEmailDomain returns false for a non-existent row", async () => {
    const db = makeFake() as unknown as Parameters<typeof deleteEmailDomain>[0];
    const result = await deleteEmailDomain(db, "nonexistent-id");
    expect(result).toBe(false);
  });

  it("listEmailDomainsForOrg returns empty array when no rules exist", async () => {
    const db = makeFake() as unknown as Parameters<typeof listEmailDomainsForOrg>[0];
    const result = await listEmailDomainsForOrg(db, ORG_ID);
    expect(result).toHaveLength(0);
  });
});
