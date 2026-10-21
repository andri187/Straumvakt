// Census row 104 — the enrichment view was cross-tenant.
//
// `listEnrichmentSessions` read `session_ledger` with no tenant term in EITHER
// half, and is mounted behind `billing.read`, which `requireAdmin` grants to
// any org member. The tests below pin the confinement on BOTH halves and, more
// importantly, that they are confined THE SAME WAY — a summary tile confined
// differently from the list beneath it is worse than either being wrong alone,
// because the total is the number an operator believes.
//
// Prisma is faked at the call boundary: what is under test is the WHERE clause
// this repository builds, and a fake that records it is the only way to assert
// on a predicate that never reaches a database in this lane.

import { describe, expect, it } from "vitest";
import { listEnrichmentSessions, scopeFrom } from "./billing-enrichment";

interface Recorded {
  groupByWhere: Record<string, unknown> | null;
  findManyWhere: Record<string, unknown> | null;
}

function fakePrisma() {
  const rec: Recorded = { groupByWhere: null, findManyWhere: null };
  const db = {
    sessionLedger: {
      groupBy: async (args: { where: Record<string, unknown> }) => {
        rec.groupByWhere = args.where;
        return [];
      },
      findMany: async (args: { where: Record<string, unknown> }) => {
        rec.findManyWhere = args.where;
        return [];
      },
    },
    chargeSession: { findMany: async () => [] },
    chargingStation: { findMany: async () => [] },
    site: { findMany: async () => [] },
  };
  return { db: db as never, rec };
}

describe("tenant confinement", () => {
  it("applies the org filter to BOTH the summary and the list", async () => {
    const { db, rec } = fakePrisma();
    await listEnrichmentSessions(db, ["org-a", "org-b"]);
    expect(rec.groupByWhere).toMatchObject({ orgId: { in: ["org-a", "org-b"] } });
    expect(rec.findManyWhere).toMatchObject({ orgId: { in: ["org-a", "org-b"] } });
  });

  it("confines them IDENTICALLY — the tile cannot disagree with the rows", async () => {
    const { db, rec } = fakePrisma();
    await listEnrichmentSessions(db, ["org-a"]);
    expect(rec.groupByWhere!.orgId).toEqual(rec.findManyWhere!.orgId);
  });

  it("an EMPTY allow-list means 'may see nothing', not 'everything'", async () => {
    // `{}` would mean everything. The empty case has to be spelled out rather
    // than fallen into, and it is the case a deny-all session produces:
    // resolveOrgScope returns { all: false, orgIds: [] } for an unknown user.
    const { db, rec } = fakePrisma();
    await listEnrichmentSessions(db, []);
    expect(rec.groupByWhere).toMatchObject({ orgId: { in: [] } });
    expect(rec.findManyWhere).toMatchObject({ orgId: { in: [] } });
  });

  it("null is platform-wide and adds NO org term", async () => {
    const { db, rec } = fakePrisma();
    await listEnrichmentSessions(db, null);
    expect(rec.groupByWhere).not.toHaveProperty("orgId");
    expect(rec.findManyWhere).not.toHaveProperty("orgId");
  });

  it("the status filter is applied ON TOP of the tenant term, never instead", async () => {
    const { db, rec } = fakePrisma();
    await listEnrichmentSessions(db, ["org-a"], { status: "mismatch" });
    expect(rec.findManyWhere).toMatchObject({
      orgId: { in: ["org-a"] },
      enrichmentStatus: "mismatch",
    });
    // And the summary is deliberately NOT status-filtered — it is the
    // aggregate across every bucket — but it is still tenant-confined.
    expect(rec.groupByWhere).toMatchObject({ orgId: { in: ["org-a"] } });
    expect(rec.groupByWhere).not.toHaveProperty("enrichmentStatus");
  });

  it("the time window survives the confinement", async () => {
    const { db, rec } = fakePrisma();
    await listEnrichmentSessions(db, ["org-a"], { days: 7 });
    expect(rec.groupByWhere).toHaveProperty("startedAt");
    expect(rec.findManyWhere).toHaveProperty("startedAt");
  });
});

describe("scopeFrom — what the route hands the repository", () => {
  it("maps platform scope to null, unchanged behaviour", () => {
    expect(scopeFrom({ all: true })).toBeNull();
  });

  it("maps an org member to their org list", () => {
    expect(scopeFrom({ all: false, orgIds: ["org-a"] })).toEqual(["org-a"]);
  });

  it("maps an unknown session to the EMPTY list, which denies everything", () => {
    // resolveOrgScope returns { all: false, orgIds: [] } for no userId. That
    // must reach the repository as [] and not as null.
    expect(scopeFrom({ all: false, orgIds: [] })).toEqual([]);
    expect(scopeFrom({ all: false, orgIds: [] })).not.toBeNull();
  });
});
