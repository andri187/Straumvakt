import { describe, it, expect, beforeEach } from "vitest";
import {
  createHostApplication,
  listHostApplications,
  getHostApplication,
  updateHostApplicationStatus,
  type CreateHostApplicationInput,
} from "./host-applications";
import type { PrismaClient } from "../generated/prisma/client";
import type { Env } from "../bindings";

// In-memory fake of the single table the repo touches. Only the Prisma
// methods actually called are implemented.
interface Row {
  id: string;
  [k: string]: unknown;
}

let rows: Row[];
let idCounter: number;

function makeDb(): PrismaClient {
  const db = {
    hostApplication: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = {
          id: `app-${++idCounter}`,
          status: "new",
          convertedOrgId: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        rows.push(row);
        return row;
      },
      findMany: async ({
        where,
      }: {
        where?: { status?: string };
        orderBy?: unknown;
      }) => {
        let r = rows.slice();
        if (where?.status) r = r.filter((x) => x.status === where.status);
        r.sort(
          (a, b) =>
            (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
        );
        return r;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((x) => x.id === where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((x) => x.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
  };
  return db as unknown as PrismaClient;
}

// No RESEND_API_KEY → sendEmail fails open (binding_missing); no fetch.
const env = {} as Env;

const sampleInput: CreateHostApplicationInput = {
  companyName: "Dalvegur HOA",
  contactName: "Anna",
  contactEmail: "anna@dalvegur.is",
  siteType: "multi_dwelling",
  sites: [{ address: "Dalvegur 10", estimatedChargers: 4, estimatedDrivers: 12 }],
};

beforeEach(() => {
  rows = [];
  idCounter = 0;
});

describe("createHostApplication", () => {
  it("persists a row and returns a summary defaulting to status=new", async () => {
    const db = makeDb();
    const res = await createHostApplication(db, env, sampleInput);

    expect(res.application.status).toBe("new");
    expect(res.application.companyName).toBe("Dalvegur HOA");
    expect(res.application.siteType).toBe("multi_dwelling");
    expect(res.application.sites).toHaveLength(1);
    expect(res.application.sites[0].estimatedChargers).toBe(4);
    expect(res.application.contactPhone).toBeNull();
    expect(res.application.kennitala).toBeNull();
    expect(res.application.convertedOrgId).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it("fails open on email when RESEND key is absent (row still persists)", async () => {
    const db = makeDb();
    const res = await createHostApplication(db, env, sampleInput);
    expect(res.email.sent).toBe(false);
    expect(res.email.reason).toBe("binding_missing");
    expect(rows).toHaveLength(1);
  });
});

describe("listHostApplications", () => {
  it("returns all by default and filters by status", async () => {
    const db = makeDb();
    await createHostApplication(db, env, sampleInput);
    await createHostApplication(db, env, {
      ...sampleInput,
      companyName: "N1",
      siteType: "company",
    });

    const all = await listHostApplications(db);
    expect(all).toHaveLength(2);

    await updateHostApplicationStatus(db, all[0].id, "won");
    const won = await listHostApplications(db, { status: "won" });
    expect(won).toHaveLength(1);
    expect(won[0].status).toBe("won");
  });
});

describe("getHostApplication / updateHostApplicationStatus", () => {
  it("returns null for an unknown id", async () => {
    const db = makeDb();
    expect(await getHostApplication(db, "nope")).toBeNull();
    expect(await updateHostApplicationStatus(db, "nope", "won")).toBeNull();
  });

  it("updates an existing application's status", async () => {
    const db = makeDb();
    const created = await createHostApplication(db, env, sampleInput);
    const updated = await updateHostApplicationStatus(
      db,
      created.application.id,
      "in_review",
    );
    expect(updated?.status).toBe("in_review");

    const fetched = await getHostApplication(db, created.application.id);
    expect(fetched?.status).toBe("in_review");
  });
});
