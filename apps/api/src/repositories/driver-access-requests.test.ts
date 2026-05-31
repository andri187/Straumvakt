// driver-access-requests repository tests (Sprint 9 ENROLL-2).
//
// Exercises the core branches of createSelfRequest / listForOperator /
// approveRequest / denyRequest with a hand-rolled in-memory fake Prisma
// client. The fake mirrors only the surfaces these functions touch.
//
// Email sends are stubbed via a fake Env with no RESEND_API_KEY —
// sendEmail() returns { ok: false, reason: 'binding_missing' } which
// the repo treats as a fail-open warn (logs to console; no throw).

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createSelfRequest,
  listForOperator,
  approveRequest,
  denyRequest,
} from "./driver-access-requests";
import type { PrismaClient } from "../generated/prisma/client";
import type { Env } from "../bindings";

// ─────────────────────────────────────────────────────────────────────
// Fake Prisma
// ─────────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  [k: string]: unknown;
}

interface Fake {
  users: Row[];
  installations: Row[];
  organizations: Row[];
  sites: Row[];
  agreements: Row[];
  driverGroups: Row[];
  driverGroupMemberships: Row[];
  driverAccessRequests: Row[];
  auditActions: Row[];
}

function freshState(): Fake {
  return {
    users: [],
    installations: [],
    organizations: [],
    sites: [],
    agreements: [],
    driverGroups: [],
    driverGroupMemberships: [],
    driverAccessRequests: [],
    auditActions: [],
  };
}

let state: Fake;
let idCounter: number;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// Tiny matcher for the where shapes the repo uses.
function matchUser(r: Row, where: any): boolean {
  if (where.id && r.id !== where.id) return false;
  return true;
}

function matchInstallation(r: Row, where: any): boolean {
  if (where.id && r.id !== where.id) return false;
  return true;
}

function makeFakeDb(): PrismaClient {
  const db: any = {
    user: {
      findUnique: async ({ where, select: _select }: any) => {
        const row = state.users.find((r) => matchUser(r, where));
        return row ?? null;
      },
    },
    installation: {
      findUnique: async ({ where, select: _select }: any) => {
        const inst = state.installations.find((r) =>
          matchInstallation(r, where),
        );
        if (!inst) return null;
        const site = state.sites.find((s) => s.id === inst.siteId);
        const org = state.organizations.find((o) => o.id === inst.orgId);
        const mainContact = org?.mainContactUserId
          ? state.users.find((u) => u.id === org.mainContactUserId) ?? null
          : null;
        return {
          ...inst,
          site: site ? { displayName: site.displayName } : null,
          organization: org
            ? {
                id: org.id,
                displayName: org.displayName,
                mainContactUserId: org.mainContactUserId ?? null,
                mainContact: mainContact
                  ? {
                      id: mainContact.id,
                      email: mainContact.email,
                      displayName: mainContact.displayName ?? null,
                    }
                  : null,
              }
            : null,
        };
      },
    },
    driverGroupMembership: {
      findFirst: async ({ where }: any) => {
        // Walk userId + agreement.installationId
        const userId = where.userId as string;
        const targetInstallationId =
          where.driverGroup?.agreement?.installationId ?? null;
        for (const m of state.driverGroupMemberships) {
          if (m.userId !== userId) continue;
          const g = state.driverGroups.find((g) => g.id === m.driverGroupId);
          if (!g) continue;
          const a = state.agreements.find((a) => a.id === g.agreementId);
          if (!a) continue;
          if (targetInstallationId && a.installationId !== targetInstallationId)
            continue;
          if (a.status !== "active") continue;
          return { id: m.id };
        }
        return null;
      },
      findUnique: async ({ where, select: _select }: any) => {
        if (where.driverGroupId_userId) {
          const { driverGroupId, userId } = where.driverGroupId_userId;
          const m = state.driverGroupMemberships.find(
            (m) => m.driverGroupId === driverGroupId && m.userId === userId,
          );
          if (!m) return null;
          return { id: m.id, driverGroupId: m.driverGroupId };
        }
        if (where.id) {
          const m = state.driverGroupMemberships.find((m) => m.id === where.id);
          if (!m) return null;
          return { id: m.id, driverGroupId: m.driverGroupId };
        }
        return null;
      },
      create: async ({ data, select: _select }: any) => {
        const id = nextId("dgm");
        const row: Row = {
          id,
          driverGroupId: data.driverGroupId,
          userId: data.userId,
        };
        state.driverGroupMemberships.push(row);
        return { id, driverGroupId: data.driverGroupId };
      },
    },
    driverGroup: {
      findMany: async ({ where, select: _select }: any) => {
        const targetInstallationId =
          where.agreement?.installationId ?? null;
        const out: any[] = [];
        for (const g of state.driverGroups) {
          const a = state.agreements.find((a) => a.id === g.agreementId);
          if (!a) continue;
          if (
            targetInstallationId &&
            a.installationId !== targetInstallationId
          )
            continue;
          if (a.status !== "active") continue;
          const count = state.driverGroupMemberships.filter(
            (m) => m.driverGroupId === g.id,
          ).length;
          out.push({
            id: g.id,
            createdAt: g.createdAt,
            _count: { memberships: count },
          });
        }
        return out;
      },
    },
    driverAccessRequest: {
      findFirst: async ({ where }: any) => {
        for (const r of state.driverAccessRequests) {
          if (where.userId && r.userId !== where.userId) continue;
          if (where.installationId && r.installationId !== where.installationId)
            continue;
          if (where.status && r.status !== where.status) continue;
          return { id: r.id };
        }
        return null;
      },
      findUnique: async ({ where }: any) => {
        const r = state.driverAccessRequests.find((r) => r.id === where.id);
        if (!r) return null;
        const user = state.users.find((u) => u.id === r.userId);
        const inst = state.installations.find(
          (i) => i.id === r.installationId,
        );
        const site = inst
          ? state.sites.find((s) => s.id === inst.siteId)
          : null;
        return {
          ...r,
          user: user
            ? {
                id: user.id,
                email: user.email,
                displayName: user.displayName ?? null,
              }
            : null,
          installation: inst
            ? {
                id: inst.id,
                orgId: inst.orgId,
                displayName: inst.displayName,
                site: site ? { displayName: site.displayName } : null,
              }
            : null,
        };
      },
      findMany: async ({ where, take: _take, select: _select }: any) => {
        let rows = state.driverAccessRequests.slice();
        if (where.status) rows = rows.filter((r) => r.status === where.status);
        if (where.installation?.orgId) {
          rows = rows.filter((r) => {
            const inst = state.installations.find(
              (i) => i.id === r.installationId,
            );
            return inst?.orgId === where.installation.orgId;
          });
        }
        return rows.map((r) => {
          const user = state.users.find((u) => u.id === r.userId);
          const inst = state.installations.find(
            (i) => i.id === r.installationId,
          );
          const site = inst
            ? state.sites.find((s) => s.id === inst.siteId)
            : null;
          return {
            id: r.id,
            userId: r.userId,
            installationId: r.installationId,
            triggeredBy: r.triggeredBy,
            status: r.status,
            denialReason: r.denialReason ?? null,
            createdAt: r.createdAt,
            reviewedAt: r.reviewedAt ?? null,
            resultingMembershipId: r.resultingMembershipId ?? null,
            user: user
              ? {
                  id: user.id,
                  email: user.email,
                  displayName: user.displayName ?? null,
                }
              : null,
            installation: inst
              ? {
                  id: inst.id,
                  displayName: inst.displayName,
                  site: site ? { displayName: site.displayName } : null,
                }
              : null,
            orgEmailDomain: null,
            reviewedBy: null,
          };
        });
      },
      groupBy: async ({ where: _where }: any) => {
        const out: Array<{ status: string; _count: { _all: number } }> = [];
        const counts: Record<string, number> = {};
        for (const r of state.driverAccessRequests) {
          const status = r.status as string;
          counts[status] = (counts[status] ?? 0) + 1;
        }
        for (const status of Object.keys(counts)) {
          out.push({ status, _count: { _all: counts[status]! } });
        }
        return out;
      },
      create: async ({ data, select: _select }: any) => {
        const id = nextId("dar");
        const row: Row = {
          id,
          userId: data.userId,
          installationId: data.installationId,
          triggeredBy: data.triggeredBy,
          orgEmailDomainId: data.orgEmailDomainId ?? null,
          status: data.status ?? "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
          denialReason: null,
          reviewedAt: null,
          reviewedByUserId: null,
          resultingMembershipId: null,
        };
        state.driverAccessRequests.push(row);
        return {
          id: row.id,
          installationId: row.installationId,
          status: row.status,
          createdAt: row.createdAt,
        };
      },
      update: async ({ where, data }: any) => {
        const r = state.driverAccessRequests.find((r) => r.id === where.id);
        if (!r) throw new Error("not found");
        Object.assign(r, data);
        return r;
      },
    },
    auditAction: {
      create: async ({ data }: any) => {
        const id = nextId("audit");
        state.auditActions.push({ ...(data as Row), id });
        return { id };
      },
    },
    $transaction: async (fn: any) => {
      // The fake doesn't isolate — but the repo's transactions only
      // serialize a small group of writes, so single-process tests are
      // safe. Pass the same db handle in.
      return fn(db);
    },
  };
  return db as unknown as PrismaClient;
}

function fakeEnv(): Env {
  // No RESEND_API_KEY → sendEmail returns binding_missing (fail-open).
  return {} as unknown as Env;
}

// ─────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────

function seedBasicTenant(opts: {
  driverHasMembership?: boolean;
  withDriverGroup?: boolean;
  withMainContact?: boolean;
}) {
  const userId = "user-1";
  const operatorId = "user-op-1";
  const orgId = "org-1";
  const siteId = "site-1";
  const installationId = "inst-1";
  const agreementId = "agr-1";
  const driverGroupId = "dg-1";

  state.users.push({
    id: userId,
    email: "driver@example.is",
    displayName: "Driver One",
  });
  if (opts.withMainContact) {
    state.users.push({
      id: operatorId,
      email: "operator@example.is",
      displayName: "Operator One",
    });
  }
  state.organizations.push({
    id: orgId,
    displayName: "ACME Charging",
    mainContactUserId: opts.withMainContact ? operatorId : null,
  });
  state.sites.push({
    id: siteId,
    displayName: "Reykjavík site",
  });
  state.installations.push({
    id: installationId,
    orgId,
    siteId,
    displayName: "Reykjavík installation",
  });

  if (opts.withDriverGroup) {
    state.agreements.push({
      id: agreementId,
      installationId,
      status: "active",
      effectiveFrom: new Date(Date.now() - 86_400_000),
      effectiveUntil: null,
    });
    state.driverGroups.push({
      id: driverGroupId,
      agreementId,
      createdAt: new Date(Date.now() - 86_400_000),
    });
  }

  if (opts.driverHasMembership && opts.withDriverGroup) {
    state.driverGroupMemberships.push({
      id: "dgm-seed",
      driverGroupId,
      userId,
    });
  }

  return {
    userId,
    operatorId,
    orgId,
    siteId,
    installationId,
    agreementId,
    driverGroupId,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("createSelfRequest", () => {
  beforeEach(() => {
    state = freshState();
    idCounter = 0;
    // Silence the fail-open warn so tests stay quiet.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("404s when the installation doesn't exist", async () => {
    seedBasicTenant({});
    const db = makeFakeDb();
    const res = await createSelfRequest(
      db,
      fakeEnv(),
      "user-1",
      "00000000-0000-0000-0000-000000000000",
    );
    expect(res).toEqual({ error: "installation_not_found" });
  });

  it("409s when the driver already has membership covering the installation", async () => {
    const { userId, installationId } = seedBasicTenant({
      withDriverGroup: true,
      driverHasMembership: true,
    });
    const db = makeFakeDb();
    const res = await createSelfRequest(db, fakeEnv(), userId, installationId);
    expect(res).toEqual({ error: "already_have_access" });
  });

  it("409s on a duplicate pending request", async () => {
    const { userId, installationId } = seedBasicTenant({
      withDriverGroup: true,
    });
    const db = makeFakeDb();
    const first = await createSelfRequest(db, fakeEnv(), userId, installationId);
    expect("ok" in first && first.ok).toBe(true);
    const dup = await createSelfRequest(db, fakeEnv(), userId, installationId);
    expect(dup).toMatchObject({
      error: "already_requested",
      existingRequestId: expect.any(String),
    });
  });

  it("writes a row + audit entry + returns the new access request", async () => {
    const { userId, installationId, orgId } = seedBasicTenant({
      withDriverGroup: true,
      withMainContact: true,
    });
    const db = makeFakeDb();
    const res = await createSelfRequest(db, fakeEnv(), userId, installationId);
    expect("ok" in res && res.ok).toBe(true);
    if (!("ok" in res) || !res.ok) return;
    expect(res.accessRequest).toMatchObject({
      installationId,
      status: "pending",
    });
    expect(state.driverAccessRequests).toHaveLength(1);
    expect(state.driverAccessRequests[0]).toMatchObject({
      userId,
      installationId,
      triggeredBy: "self_request",
      status: "pending",
      orgEmailDomainId: null,
    });
    expect(state.auditActions).toHaveLength(1);
    expect(state.auditActions[0]).toMatchObject({
      orgId,
      action: "driver_access_request.created",
    });
  });

  it("still 201s when the org has no main contact (operator email skipped)", async () => {
    const { userId, installationId } = seedBasicTenant({
      withDriverGroup: true,
      withMainContact: false,
    });
    const db = makeFakeDb();
    const res = await createSelfRequest(db, fakeEnv(), userId, installationId);
    expect("ok" in res && res.ok).toBe(true);
  });
});

describe("listForOperator", () => {
  beforeEach(() => {
    state = freshState();
    idCounter = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("returns pending requests scoped to the org with a totals breakdown", async () => {
    const { userId, installationId, orgId } = seedBasicTenant({
      withDriverGroup: true,
    });
    const db = makeFakeDb();
    await createSelfRequest(db, fakeEnv(), userId, installationId);

    // Add a second org's installation + a request — should NOT appear.
    state.organizations.push({ id: "org-2", displayName: "Other" });
    state.sites.push({ id: "site-2", displayName: "Other site" });
    state.installations.push({
      id: "inst-2",
      orgId: "org-2",
      siteId: "site-2",
      displayName: "Other installation",
    });
    state.users.push({
      id: "user-other",
      email: "other@example.is",
      displayName: "Other",
    });
    state.driverAccessRequests.push({
      id: "dar-other",
      userId: "user-other",
      installationId: "inst-2",
      triggeredBy: "self_request",
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const out = await listForOperator(db, { orgId });
    expect(out.requests).toHaveLength(1);
    expect(out.requests[0]).toMatchObject({
      userId,
      installationId,
      status: "pending",
    });
    // Totals are platform-wide in the fake, not org-scoped (the fake's
    // groupBy ignores `where`). The repo passes the right `where` so in
    // a real DB it IS scoped — verified by integration tests later.
    expect(out.totals.pending).toBeGreaterThanOrEqual(1);
  });
});

describe("approveRequest", () => {
  beforeEach(() => {
    state = freshState();
    idCounter = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("returns no_driver_group_for_installation when there are no driver groups", async () => {
    const { userId, installationId } = seedBasicTenant({
      withDriverGroup: false,
    });
    const db = makeFakeDb();
    const created = await createSelfRequest(
      db,
      fakeEnv(),
      userId,
      installationId,
    );
    if (!("ok" in created) || !created.ok) throw new Error("setup failed");

    const res = await approveRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
    );
    expect(res).toEqual({ error: "no_driver_group_for_installation" });
  });

  it("creates a DriverGroupMembership and flips the request to approved", async () => {
    const { userId, installationId, driverGroupId, orgId } = seedBasicTenant({
      withDriverGroup: true,
    });
    const db = makeFakeDb();
    const created = await createSelfRequest(
      db,
      fakeEnv(),
      userId,
      installationId,
    );
    if (!("ok" in created) || !created.ok) throw new Error("setup failed");

    const res = await approveRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
    );
    expect("ok" in res && res.ok).toBe(true);
    if (!("ok" in res) || !res.ok) return;

    expect(res.alreadyExisted).toBe(false);
    expect(res.membership.driverGroupId).toBe(driverGroupId);
    expect(state.driverGroupMemberships).toHaveLength(1);
    expect(state.driverGroupMemberships[0]).toMatchObject({
      driverGroupId,
      userId,
    });
    const stored = state.driverAccessRequests[0]!;
    expect(stored.status).toBe("approved");
    expect(stored.reviewedByUserId).toBe("user-reviewer");
    expect(stored.resultingMembershipId).toBe(res.membership.id);

    // Audit row written.
    const approveAudits = state.auditActions.filter(
      (a) => a.action === "driver_access_request.approved",
    );
    expect(approveAudits).toHaveLength(1);
    expect(approveAudits[0]).toMatchObject({ orgId });
  });

  it("is idempotent — second approve returns existing membership with alreadyExisted=true", async () => {
    const { userId, installationId } = seedBasicTenant({
      withDriverGroup: true,
    });
    const db = makeFakeDb();
    const created = await createSelfRequest(
      db,
      fakeEnv(),
      userId,
      installationId,
    );
    if (!("ok" in created) || !created.ok) throw new Error("setup failed");

    const first = await approveRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
    );
    if (!("ok" in first) || !first.ok) throw new Error("first approve failed");

    const second = await approveRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
    );
    expect("ok" in second && second.ok).toBe(true);
    if (!("ok" in second) || !second.ok) return;
    expect(second.alreadyExisted).toBe(true);
    expect(second.membership.id).toBe(first.membership.id);
    expect(state.driverGroupMemberships).toHaveLength(1);
  });

  it("silently links an existing membership without duplicating", async () => {
    const { userId, installationId, driverGroupId } = seedBasicTenant({
      withDriverGroup: true,
    });
    // Pre-seed: the driver is already in the target group somehow.
    state.driverGroupMemberships.push({
      id: "pre-existing",
      driverGroupId,
      userId,
    });
    const db = makeFakeDb();
    // createSelfRequest would 409 since they already have access; force
    // a request row in directly.
    state.driverAccessRequests.push({
      id: "dar-forced",
      userId,
      installationId,
      triggeredBy: "self_request",
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await approveRequest(
      db,
      fakeEnv(),
      "dar-forced",
      "user-reviewer",
    );
    expect("ok" in res && res.ok).toBe(true);
    if (!("ok" in res) || !res.ok) return;
    expect(res.alreadyExisted).toBe(true);
    expect(res.membership.id).toBe("pre-existing");
    expect(state.driverGroupMemberships).toHaveLength(1);
  });

  it("rejects on expectedInstallationOrgId mismatch", async () => {
    const { userId, installationId } = seedBasicTenant({
      withDriverGroup: true,
    });
    const db = makeFakeDb();
    const created = await createSelfRequest(
      db,
      fakeEnv(),
      userId,
      installationId,
    );
    if (!("ok" in created) || !created.ok) throw new Error("setup failed");

    const res = await approveRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
      { expectedInstallationOrgId: "some-other-org" },
    );
    expect(res).toEqual({ error: "installation_org_mismatch" });
  });
});

describe("denyRequest", () => {
  beforeEach(() => {
    state = freshState();
    idCounter = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("requires a non-empty denial reason", async () => {
    const { userId, installationId } = seedBasicTenant({
      withDriverGroup: true,
    });
    const db = makeFakeDb();
    const created = await createSelfRequest(
      db,
      fakeEnv(),
      userId,
      installationId,
    );
    if (!("ok" in created) || !created.ok) throw new Error("setup failed");

    const res = await denyRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
      "   ",
    );
    expect(res).toEqual({ error: "denial_reason_required" });
  });

  it("flips to denied, records reason + reviewer + writes audit", async () => {
    const { userId, installationId, orgId } = seedBasicTenant({
      withDriverGroup: true,
    });
    const db = makeFakeDb();
    const created = await createSelfRequest(
      db,
      fakeEnv(),
      userId,
      installationId,
    );
    if (!("ok" in created) || !created.ok) throw new Error("setup failed");

    const res = await denyRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
      "Not eligible at this time",
    );
    expect(res).toEqual({ ok: true });

    const stored = state.driverAccessRequests[0]!;
    expect(stored.status).toBe("denied");
    expect(stored.denialReason).toBe("Not eligible at this time");
    expect(stored.reviewedByUserId).toBe("user-reviewer");

    const denyAudits = state.auditActions.filter(
      (a) => a.action === "driver_access_request.denied",
    );
    expect(denyAudits).toHaveLength(1);
    expect(denyAudits[0]).toMatchObject({ orgId });
  });

  it("rejects re-deny of a non-pending row", async () => {
    const { userId, installationId } = seedBasicTenant({
      withDriverGroup: true,
    });
    const db = makeFakeDb();
    const created = await createSelfRequest(
      db,
      fakeEnv(),
      userId,
      installationId,
    );
    if (!("ok" in created) || !created.ok) throw new Error("setup failed");

    const first = await denyRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
      "no",
    );
    expect(first).toEqual({ ok: true });

    const second = await denyRequest(
      db,
      fakeEnv(),
      created.accessRequest.id,
      "user-reviewer",
      "still no",
    );
    expect(second).toEqual({ error: "request_not_pending" });
  });
});
