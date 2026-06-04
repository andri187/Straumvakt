import { describe, it, expect, beforeEach } from "vitest";
import {
  createBillObject,
  listBillObjectsForOrg,
  getBillObject,
  assignDriverToBillObject,
  listBillObjectMembers,
} from "./bill-objects";
import type { PrismaClient } from "../generated/prisma/client";

interface Row {
  id: string;
  [k: string]: unknown;
}

let billObjects: Row[];
let members: Row[];
let boCounter: number;
let mCounter: number;

function makeDb(): PrismaClient {
  const db: Record<string, unknown> = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    billObject: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = {
          id: `bo-${++boCounter}`,
          status: "active",
          createdAt: now,
          updatedAt: now,
          installationId: null,
          parentId: null,
          ownerUserId: null,
          ownerOrgId: null,
          ...data,
        };
        billObjects.push(row);
        return row;
      },
      findMany: async ({
        where,
      }: {
        where: { orgId: string; installationId?: string };
      }) => {
        return billObjects.filter(
          (b) =>
            b.orgId === where.orgId &&
            (where.installationId === undefined ||
              b.installationId === where.installationId),
        );
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        billObjects.find((b) => b.id === where.id) ?? null,
    },
    billObjectMember: {
      findMany: async ({
        where,
      }: {
        where: {
          userId?: string;
          billObjectId?: string;
          effectiveTo?: null;
          billObject?: { orgId: string };
        };
      }) => {
        return members.filter((m) => {
          if (where.userId && m.userId !== where.userId) return false;
          if (where.billObjectId && m.billObjectId !== where.billObjectId)
            return false;
          if ("effectiveTo" in where && m.effectiveTo !== null) return false;
          if (where.billObject?.orgId) {
            const bo = billObjects.find((b) => b.id === m.billObjectId);
            if (!bo || bo.orgId !== where.billObject.orgId) return false;
          }
          return true;
        });
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const m of members) {
          if (where.id.in.includes(m.id as string)) {
            Object.assign(m, data);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = {
          id: `m-${++mCounter}`,
          effectiveFrom: new Date(),
          effectiveTo: null,
          ...data,
        };
        members.push(row);
        return row;
      },
    },
  };
  return db as unknown as PrismaClient;
}

beforeEach(() => {
  billObjects = [];
  members = [];
  boCounter = 0;
  mCounter = 0;
});

describe("createBillObject", () => {
  it("maps a user owner", async () => {
    const db = makeDb();
    const bo = await createBillObject(db, "org-1", {
      kind: "apartment",
      label: "Apt 304",
      ownerUserId: "user-alice",
    });
    expect(bo.kind).toBe("apartment");
    expect(bo.owner).toEqual({ kind: "user", userId: "user-alice" });
    expect(bo.status).toBe("active");
  });

  it("maps an org owner (company-flat)", async () => {
    const db = makeDb();
    const bo = await createBillObject(db, "org-1", {
      kind: "company",
      label: "N1",
      ownerOrgId: "org-1",
    });
    expect(bo.owner).toEqual({ kind: "org", orgId: "org-1" });
  });
});

describe("getBillObject tenant guard", () => {
  it("returns null when the bill object belongs to another org", async () => {
    const db = makeDb();
    const bo = await createBillObject(db, "org-1", {
      kind: "unit",
      label: "U1",
      ownerOrgId: "org-1",
    });
    expect(await getBillObject(db, "org-2", bo.id)).toBeNull();
    expect(await getBillObject(db, "org-1", bo.id)).not.toBeNull();
  });
});

describe("assignDriverToBillObject — one active billing home per host", () => {
  it("creates, is idempotent, and moves the driver (closing the old home)", async () => {
    const db = makeDb();
    const apt304 = await createBillObject(db, "org-1", {
      kind: "apartment",
      label: "Apt 304",
      ownerUserId: "user-alice",
    });
    const apt512 = await createBillObject(db, "org-1", {
      kind: "apartment",
      label: "Apt 512",
      ownerUserId: "user-bob",
    });

    // First assignment.
    const r1 = await assignDriverToBillObject(db, "org-1", apt304.id, "user-alice");
    expect(r1.created).toBe(true);
    expect(r1.closedPrevious).toBe(0);

    // Idempotent — same home.
    const r2 = await assignDriverToBillObject(db, "org-1", apt304.id, "user-alice");
    expect(r2.created).toBe(false);
    expect(r2.closedPrevious).toBe(0);

    // Move to a different home in the same host — closes the old one.
    const r3 = await assignDriverToBillObject(db, "org-1", apt512.id, "user-alice");
    expect(r3.created).toBe(true);
    expect(r3.closedPrevious).toBe(1);

    // Only one active home now.
    const active512 = await listBillObjectMembers(db, apt512.id);
    expect(active512).toHaveLength(1);
    const active304 = await listBillObjectMembers(db, apt304.id);
    expect(active304).toHaveLength(0);

    // History preserved on the old home.
    const all304 = await listBillObjectMembers(db, apt304.id, {
      includeEnded: true,
    });
    expect(all304).toHaveLength(1);
    expect(all304[0].effectiveTo).not.toBeNull();
  });

  it("does not cross hosts — a home in another org is untouched", async () => {
    const db = makeDb();
    const aptOrg1 = await createBillObject(db, "org-1", {
      kind: "apartment",
      label: "A",
      ownerUserId: "u",
    });
    const aptOrg2 = await createBillObject(db, "org-2", {
      kind: "apartment",
      label: "B",
      ownerUserId: "u",
    });
    await assignDriverToBillObject(db, "org-1", aptOrg1.id, "user-x");
    const r = await assignDriverToBillObject(db, "org-2", aptOrg2.id, "user-x");
    // Cross-host: org-1 membership stays active (closedPrevious counts
    // only same-org homes).
    expect(r.closedPrevious).toBe(0);
    expect(await listBillObjectMembers(db, aptOrg1.id)).toHaveLength(1);
    expect(await listBillObjectMembers(db, aptOrg2.id)).toHaveLength(1);
  });
});

describe("listBillObjectsForOrg", () => {
  it("scopes to the org", async () => {
    const db = makeDb();
    await createBillObject(db, "org-1", { kind: "unit", label: "1", ownerOrgId: "org-1" });
    await createBillObject(db, "org-2", { kind: "unit", label: "2", ownerOrgId: "org-2" });
    expect(await listBillObjectsForOrg(db, "org-1")).toHaveLength(1);
  });
});
