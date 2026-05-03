// Sprint 8.4 — session-ledger read repo tests. Hand-rolled fake
// Prisma client mirroring `findMany` + `aggregate`. Verifies that
// scope.kind tags translate to the right `where` predicates.

import { describe, expect, it, vi } from "vitest";
import {
  listSessionLedger,
  totalSessionLedger,
  type LedgerScope,
} from "./session-ledger";
import type { PrismaClient } from "../generated/prisma/client";

interface CapturedFindMany {
  where: Record<string, unknown>;
  orderBy: unknown;
  take: number;
  skip: number;
}

function makeFake(rows: Record<string, unknown>[]) {
  const findManyCalls: CapturedFindMany[] = [];
  const aggregateCalls: Array<{ where: Record<string, unknown> }> = [];
  const db = {
    sessionLedger: {
      findMany: vi.fn(async (args: CapturedFindMany) => {
        findManyCalls.push(args);
        return rows.map((r) => ({
          // Decimal values come back from Prisma with .toString()
          energyKwh: { toString: () => "30.000" },
          ...r,
        }));
      }),
      aggregate: vi.fn(async (args: { where: Record<string, unknown> }) => {
        aggregateCalls.push(args);
        return {
          _count: { sessionId: rows.length },
          _sum: {
            energyKwh: { toString: () => "30.000" },
            costIskMinor: 64988n,
          },
        };
      }),
    },
  };
  return {
    db: db as unknown as PrismaClient,
    findManyCalls,
    aggregateCalls,
  };
}

const ROW = {
  sessionId: "session-1",
  orgId: "org-1",
  siteId: "site-1",
  chargingStationId: "stn-1",
  driverUserId: "user-1",
  driverIdTag: "ABC",
  startedAt: new Date("2026-05-04T08:00:00Z"),
  stoppedAt: new Date("2026-05-04T09:00:00Z"),
  durationSec: 3600,
  costIskMinor: 64988n,
  tariffDefinitionId: null,
  computedAt: new Date("2026-05-04T09:00:01Z"),
};

describe("listSessionLedger — scope translation", () => {
  it("admin scope → no tenant filter", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(f.db, { kind: "admin" });
    expect(f.findManyCalls[0].where).toEqual({});
  });

  it("org scope → WHERE org_id = orgId", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(f.db, { kind: "org", orgId: "org-X" });
    expect(f.findManyCalls[0].where).toEqual({ orgId: "org-X" });
  });

  it("site scope → WHERE site_id = siteId", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(f.db, { kind: "site", siteId: "site-X" });
    expect(f.findManyCalls[0].where).toEqual({ siteId: "site-X" });
  });

  it("charger scope → WHERE charging_station_id = chargingStationId", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(f.db, {
      kind: "charger",
      chargingStationId: "stn-X",
    });
    expect(f.findManyCalls[0].where).toEqual({ chargingStationId: "stn-X" });
  });

  it("driver scope → WHERE driver_user_id = driverUserId", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(f.db, {
      kind: "driver",
      driverUserId: "user-X",
    });
    expect(f.findManyCalls[0].where).toEqual({ driverUserId: "user-X" });
  });
});

describe("listSessionLedger — filters", () => {
  it("startedAfter + startedBefore add a startedAt range predicate", async () => {
    const f = makeFake([ROW]);
    const after = new Date("2026-05-01T00:00:00Z");
    const before = new Date("2026-06-01T00:00:00Z");
    await listSessionLedger(
      f.db,
      { kind: "org", orgId: "org-1" },
      { startedAfter: after, startedBefore: before },
    );
    expect(f.findManyCalls[0].where).toEqual({
      orgId: "org-1",
      startedAt: { gte: after, lt: before },
    });
  });

  it("limit/offset are honoured (default 100, max 500)", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(
      f.db,
      { kind: "admin" },
      { limit: 250, offset: 50 },
    );
    expect(f.findManyCalls[0].take).toBe(250);
    expect(f.findManyCalls[0].skip).toBe(50);
  });

  it("limit clamped to MAX_LIMIT=500 when called with 9999", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(f.db, { kind: "admin" }, { limit: 9999 });
    expect(f.findManyCalls[0].take).toBe(500);
  });

  it("limit clamped to 1 when called with 0", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(f.db, { kind: "admin" }, { limit: 0 });
    expect(f.findManyCalls[0].take).toBe(1);
  });

  it("orderBy is startedAt desc", async () => {
    const f = makeFake([ROW]);
    await listSessionLedger(f.db, { kind: "admin" });
    expect(f.findManyCalls[0].orderBy).toEqual({ startedAt: "desc" });
  });
});

describe("totalSessionLedger", () => {
  it("returns counts + sums via aggregate, scope respected", async () => {
    const f = makeFake([ROW, ROW, ROW]);
    const totals = await totalSessionLedger(f.db, {
      kind: "org",
      orgId: "org-1",
    });
    expect(totals.sessionCount).toBe(3);
    expect(totals.totalEnergyKwh).toBe("30.000");
    expect(totals.totalCostIskMinor).toBe(64988n);
    expect(f.aggregateCalls[0].where).toEqual({ orgId: "org-1" });
  });
});
