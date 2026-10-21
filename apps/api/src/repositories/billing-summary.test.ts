// Tenant confinement on the billing overview dashboard.
//
// This file exists because billing-summary.ts's header claimed for months
// that "all functions take orgId = undefined for platform-admin (no filter)
// or a specific orgId for tenant-scoped reads" while none of the five had an
// orgId parameter at all. There was no test either — the claim was load
// bearing and unverified in both directions.
//
// Every assertion below reads the WHERE that reached Prisma, because that is
// the only place the confinement is real.

import { describe, expect, it, vi } from "vitest";
import {
  getCostHealthMetric,
  getPeriodTotals,
  getProjectedOrgRevenue,
  getRecentLedgerEntries,
} from "./billing-summary";
import type { PrismaClient } from "../generated/prisma/client";

const ORG_A = "org-A";
const ORG_B = "org-B";

function makeFake() {
  const aggregateCalls: Array<Record<string, unknown>> = [];
  const groupByCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];
  const db = {
    sessionLedger: {
      aggregate: vi.fn(async (args: Record<string, unknown>) => {
        aggregateCalls.push(args);
        return { _count: { sessionId: 0 }, _sum: { energyKwh: null, costIskMinor: null } };
      }),
      groupBy: vi.fn(async (args: Record<string, unknown>) => {
        groupByCalls.push(args);
        return [];
      }),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        findManyCalls.push(args);
        return [];
      }),
    },
    organization: { findMany: vi.fn(async () => []) },
    site: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;
  return { db, aggregateCalls, groupByCalls, findManyCalls };
}

describe("billing summary — tenant confinement", () => {
  it("getPeriodTotals confines to the caller's orgs", () => {
    const f = makeFake();
    return getPeriodTotals(f.db, 2026, 8, [ORG_A]).then(() => {
      expect(f.aggregateCalls[0].where).toMatchObject({ orgId: { in: [ORG_A] } });
    });
  });

  it("getPeriodTotals with null is platform-wide, and says so by omission", async () => {
    const f = makeFake();
    await getPeriodTotals(f.db, 2026, 8, null);
    expect(f.aggregateCalls[0].where).not.toHaveProperty("orgId");
  });

  it("getCostHealthMetric confines BOTH of its aggregates", async () => {
    // Two queries make one percentage. Confining the numerator and not the
    // denominator would produce a health figure that is not wrong in any
    // single query and is nonsense as a ratio.
    const f = makeFake();
    await getCostHealthMetric(f.db, [ORG_A]);
    expect(f.aggregateCalls).toHaveLength(2);
    expect(f.aggregateCalls[0].where).toMatchObject({ orgId: { in: [ORG_A] } });
    expect(f.aggregateCalls[1].where).toMatchObject({ orgId: { in: [ORG_A] } });
  });

  it("getProjectedOrgRevenue confines the cross-tenant revenue league table", async () => {
    // Unscoped, this tile returns the top ten orgs by monthly revenue,
    // ordered by size, to anyone holding billing.read.
    const f = makeFake();
    await getProjectedOrgRevenue(f.db, 2026, 8, 10, [ORG_A]);
    expect(f.groupByCalls[0].where).toMatchObject({ orgId: { in: [ORG_A] } });
  });

  it("getRecentLedgerEntries confines the recent-activity feed", async () => {
    const f = makeFake();
    await getRecentLedgerEntries(f.db, 10, [ORG_B]);
    expect(f.findManyCalls[0].where).toEqual({ orgId: { in: [ORG_B] } });
  });

  it("an empty allow-list matches nothing, never everything", async () => {
    // A caller with no memberships and no platform grant. `{}` would be
    // Prisma's "no WHERE"; `{ in: [] }` is "no rows".
    const f = makeFake();
    await getPeriodTotals(f.db, 2026, 8, []);
    await getRecentLedgerEntries(f.db, 10, []);
    expect(f.aggregateCalls[0].where).toMatchObject({ orgId: { in: [] } });
    expect(f.findManyCalls[0].where).toEqual({ orgId: { in: [] } });
  });

  it("confinement does not eat the period bounds it sits beside", async () => {
    // Spreading the tenant predicate into an object that already has
    // startedAt must add, not replace.
    const f = makeFake();
    await getPeriodTotals(f.db, 2026, 8, [ORG_A]);
    const where = f.aggregateCalls[0].where as Record<string, unknown>;
    expect(where).toHaveProperty("startedAt");
    expect(where).toHaveProperty("orgId");
  });
});
