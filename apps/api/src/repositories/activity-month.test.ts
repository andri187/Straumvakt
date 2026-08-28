// The activity writers' tenancy and upsert contract.
//
// The derivation itself is tested in
// packages/commercial/src/core-billing/activity-month.test.ts. This file tests
// what the repository adds: that an out-of-scope org is a thrown error rather
// than an empty result, and that a re-run cannot erase a settled figure.

import { describe, expect, it, vi } from "vitest";
import {
  readConnectorActivityCount,
  readDriverActivityCount,
  writeConnectorActivity,
  writeDriverActivity,
  type ActivityAccess,
  type ConnectorEvidence,
} from "./activity-month";
import type { Db } from "../lib/drizzle";

const ORG_A = "org-a-0000-0000-0000-00000000001";
const ORG_B = "org-b-0000-0000-0000-00000000002";
const C1 = "conn-1-0000-0000-0000-000000001";
const PERIOD = { orgId: ORG_A, year: 2026, month: 3 };
const at = (d: number) => new Date(Date.UTC(2026, 2, d, 12));

const PLATFORM: ActivityAccess = { restrictToOrgIds: null };
const ONLY_A: ActivityAccess = { restrictToOrgIds: [ORG_A] };
const ONLY_B: ActivityAccess = { restrictToOrgIds: [ORG_B] };

function evidence(over: Partial<ConnectorEvidence> = {}): ConnectorEvidence {
  return {
    sessions: [
      { orgId: ORG_A, connectorId: C1, chargingStationId: "stn-1", startedAt: at(5) },
    ],
    statuses: [],
    assertions: [],
    // ADR 0054 item 7 added a fourth evidence tier. Empty here on purpose:
    // these cases are about the three DERIVED tiers, and a placement row
    // would make them pass for a reason they are not testing.
    placements: [],
    ...over,
  };
}

/** The literal SQL text of a Drizzle `sql` node, with its column references
 *  omitted. Safe on nodes that reference a table, which stringifying is not. */
function sqlLiterals(node: unknown): string {
  const chunks = (node as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return "";
  return chunks
    .map((c) => {
      const v = (c as { value?: unknown }).value;
      return Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join("") : "";
    })
    .join("");
}

function makeFake() {
  const inserts: Array<{ values: unknown; conflict: Record<string, unknown> }> = [];
  const selects: Array<Record<string, unknown>> = [];
  const db = {
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: async (conflict: Record<string, unknown>) => {
          inserts.push({ values, conflict });
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: async (w: unknown) => {
          selects.push({ where: w });
          return [];
        },
      }),
    }),
  } as unknown as Db;
  return { db, inserts, selects };
}

describe("writeConnectorActivity — tenancy", () => {
  it("writes for an org in scope", async () => {
    const f = makeFake();
    const out = await writeConnectorActivity(f.db, PERIOD, evidence(), ONLY_A);
    expect(out.rowsWritten).toBe(1);
    expect(f.inserts).toHaveLength(1);
  });

  it("writes for a platform caller", async () => {
    const f = makeFake();
    const out = await writeConnectorActivity(f.db, PERIOD, evidence(), PLATFORM);
    expect(out.rowsWritten).toBe(1);
  });

  it("THROWS for an org out of scope rather than writing nothing quietly", async () => {
    // An empty result and a refusal look identical to a caller that only
    // checks rowsWritten. Only one of them is a bug worth finding.
    const f = makeFake();
    await expect(writeConnectorActivity(f.db, PERIOD, evidence(), ONLY_B)).rejects.toThrow(
      "activity_period_org_not_in_scope",
    );
    expect(f.inserts).toHaveLength(0);
  });

  it("throws for an empty allow-list, which means 'may see nothing'", async () => {
    const f = makeFake();
    await expect(
      writeConnectorActivity(f.db, PERIOD, evidence(), { restrictToOrgIds: [] }),
    ).rejects.toThrow("activity_period_org_not_in_scope");
  });

  it("writes nothing when there is no evidence, and does not touch the table", async () => {
    // No rows is what makes the feeder hold. An INSERT of zero rows would be
    // harmless but would also mean the writer had "run successfully" over a
    // month it knows nothing about.
    const f = makeFake();
    const out = await writeConnectorActivity(
      f.db,
      PERIOD,
      { sessions: [], statuses: [], assertions: [], placements: [] },
      ONLY_A,
    );
    expect(out.rowsWritten).toBe(0);
    expect(f.inserts).toHaveLength(0);
  });

  it("reports out-of-period observations rather than swallowing them", async () => {
    const f = makeFake();
    const out = await writeConnectorActivity(
      f.db,
      PERIOD,
      evidence({
        sessions: [
          { orgId: ORG_A, connectorId: C1, chargingStationId: null, startedAt: new Date(Date.UTC(2026, 1, 2)) },
        ],
      }),
      ONLY_A,
    );
    expect(out.rowsWritten).toBe(0);
    expect(out.outOfPeriodObservations).toBe(1);
  });
});

describe("writeConnectorActivity — upsert semantics", () => {
  it("targets the unique index that makes a re-run collide", async () => {
    const f = makeFake();
    await writeConnectorActivity(f.db, PERIOD, evidence(), ONLY_A);
    const target = f.inserts[0]!.conflict.target as unknown[];
    expect(target).toHaveLength(4);
  });

  it("NEVER overwrites cap_applied_isk — settlement owns it", async () => {
    // The load-bearing assertion of this file. cap_applied_isk is written by
    // settlement AFTER this job runs. A routine re-aggregation that reset it
    // to NULL would erase the record of what a connector was actually billed,
    // silently, on a table nobody watches.
    const f = makeFake();
    await writeConnectorActivity(f.db, PERIOD, evidence(), ONLY_A);
    const set = f.inserts[0]!.conflict.set as Record<string, unknown>;
    expect(Object.keys(set)).not.toContain("capAppliedIsk");
  });

  it("overwrites exactly the recomputable fields, and nothing else", async () => {
    const f = makeFake();
    await writeConnectorActivity(f.db, PERIOD, evidence(), ONLY_A);
    const set = f.inserts[0]!.conflict.set as Record<string, unknown>;
    expect(Object.keys(set).sort()).toEqual(
      ["activeDays", "chargingStationId", "firstSeenAt", "lastSeenAt", "sessionCount", "source"].sort(),
    );
  });

  it("keeps the EARLIEST first_seen_at across runs", async () => {
    // A later run over a narrower window must not move the start of the month
    // forward. LEAST, not excluded.
    //
    // Read the SQL's literal chunks rather than JSON.stringify-ing it: a
    // Drizzle SQL node holds a column reference, and a column holds its table,
    // and the table holds its columns — stringifying it is a circular
    // structure, which is how the first version of this test failed.
    const f = makeFake();
    await writeConnectorActivity(f.db, PERIOD, evidence(), ONLY_A);
    const set = f.inserts[0]!.conflict.set as Record<string, unknown>;
    expect(sqlLiterals(set.firstSeenAt)).toContain("LEAST(");
    expect(sqlLiterals(set.lastSeenAt)).toContain("GREATEST(");
  });

  it("re-running with identical evidence produces an identical insert payload", async () => {
    // Idempotency, at the level this repository controls: same evidence in,
    // same statement out. The unique index does the rest.
    const a = makeFake();
    const b = makeFake();
    await writeConnectorActivity(a.db, PERIOD, evidence(), ONLY_A);
    await writeConnectorActivity(b.db, PERIOD, evidence(), ONLY_A);
    expect(JSON.stringify(a.inserts[0]!.values)).toBe(JSON.stringify(b.inserts[0]!.values));
  });

  it("a re-run after more evidence arrives writes the larger counts", async () => {
    const f = makeFake();
    await writeConnectorActivity(
      f.db,
      PERIOD,
      evidence({
        sessions: [
          { orgId: ORG_A, connectorId: C1, chargingStationId: "stn-1", startedAt: at(5) },
          { orgId: ORG_A, connectorId: C1, chargingStationId: "stn-1", startedAt: at(19) },
        ],
      }),
      ONLY_A,
    );
    const values = f.inserts[0]!.values as Array<{ sessionCount: number; activeDays: number }>;
    expect(values[0]!.sessionCount).toBe(2);
    expect(values[0]!.activeDays).toBe(2);
  });

  it("always inserts capAppliedIsk as null, never as zero", async () => {
    const f = makeFake();
    await writeConnectorActivity(f.db, PERIOD, evidence(), ONLY_A);
    const values = f.inserts[0]!.values as Array<{ capAppliedIsk: unknown }>;
    expect(values[0]!.capAppliedIsk).toBeNull();
  });
});

describe("writeDriverActivity", () => {
  it("writes charging-derived rows for an in-scope org", async () => {
    const f = makeFake();
    const out = await writeDriverActivity(
      f.db,
      PERIOD,
      [{ orgId: ORG_A, driverUserId: "drv-1", startedAt: at(4) }],
      ONLY_A,
    );
    expect(out.rowsWritten).toBe(1);
    const values = f.inserts[0]!.values as Array<{ source: string }>;
    expect(values[0]!.source).toBe("charging_session");
  });

  it("throws for an out-of-scope org", async () => {
    const f = makeFake();
    await expect(
      writeDriverActivity(f.db, PERIOD, [{ orgId: ORG_A, driverUserId: "d", startedAt: at(4) }], ONLY_B),
    ).rejects.toThrow("activity_period_org_not_in_scope");
  });

  it("is idempotent: identical evidence produces an identical insert payload", async () => {
    // The unique index (org, year, month, driver) is the mechanism; this is
    // the half the repository controls — same evidence in, same statement out.
    const sessions = [
      { orgId: ORG_A, driverUserId: "drv-1", startedAt: at(4) },
      { orgId: ORG_A, driverUserId: "drv-1", startedAt: at(9) },
      { orgId: ORG_A, driverUserId: "drv-2", startedAt: at(9) },
    ];
    const a = makeFake();
    const b = makeFake();
    await writeDriverActivity(a.db, PERIOD, sessions, ONLY_A);
    await writeDriverActivity(b.db, PERIOD, [sessions[2]!, sessions[1]!, sessions[0]!], ONLY_A);
    expect(JSON.stringify(a.inserts[0]!.values)).toBe(JSON.stringify(b.inserts[0]!.values));
  });

  it("targets the four-column unique index, so a re-run collides", async () => {
    const f = makeFake();
    await writeDriverActivity(
      f.db,
      PERIOD,
      [{ orgId: ORG_A, driverUserId: "drv-1", startedAt: at(4) }],
      ONLY_A,
    );
    expect(f.inserts[0]!.conflict.target as unknown[]).toHaveLength(4);
  });

  it("writes nothing for a period with no attributable sessions", async () => {
    // The pre-Authorize shape: sessions exist, none carries a driver. Writing
    // nothing is correct — a zero-count row would assert we checked and found
    // the org had no active drivers, which is a different claim.
    const f = makeFake();
    const out = await writeDriverActivity(f.db, PERIOD, [], ONLY_A);
    expect(out.rowsWritten).toBe(0);
    expect(f.inserts).toHaveLength(0);
  });

  it("has no cap_applied_isk to preserve, so its SET is the recomputable four", async () => {
    const f = makeFake();
    await writeDriverActivity(
      f.db,
      PERIOD,
      [{ orgId: ORG_A, driverUserId: "drv-1", startedAt: at(4) }],
      ONLY_A,
    );
    const set = f.inserts[0]!.conflict.set as Record<string, unknown>;
    expect(Object.keys(set).sort()).toEqual(
      ["firstSeenAt", "lastSeenAt", "sessionCount", "source"].sort(),
    );
  });
});

describe("reads are org-scoped too", () => {
  it("throws when reading a period the caller may not see", async () => {
    const f = makeFake();
    await expect(readConnectorActivityCount(f.db, PERIOD, ONLY_B)).rejects.toThrow(
      "activity_period_org_not_in_scope",
    );
    await expect(readDriverActivityCount(f.db, PERIOD, ONLY_B)).rejects.toThrow(
      "activity_period_org_not_in_scope",
    );
  });

  it("reads for an in-scope org", async () => {
    const f = makeFake();
    await expect(readConnectorActivityCount(f.db, PERIOD, ONLY_A)).resolves.toBe(0);
    expect(f.selects).toHaveLength(1);
  });
});

// Guard against the fake drifting from the real client's shape.
it("the fake implements the surface the repository actually calls", () => {
  const f = makeFake();
  expect(typeof (f.db as unknown as { insert: unknown }).insert).toBe("function");
  expect(typeof (f.db as unknown as { select: unknown }).select).toBe("function");
  vi.resetAllMocks();
});
