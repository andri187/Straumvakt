// Sprint 9 / 2026-06-04 — Driver session-lifecycle repo unit tests.
//
// Hand-rolled fake Prisma client (same style as session-ledger.test.ts /
// driver-pricing.test.ts). Verifies driver-scoping (every read filters on
// the driver's userId), the stop-session resolution discriminated result,
// the history enrichment join, and the profile-patch behaviour.

import { describe, expect, it, vi } from "vitest";
import {
  getDriverActiveSessions,
  resolveStoppableSession,
  listDriverSessionHistory,
  updateDriverProfile,
} from "./driver-sessions";
import type { PrismaClient } from "../generated/prisma/client";

// ── getDriverActiveSessions ──────────────────────────────────────────

describe("getDriverActiveSessions", () => {
  it("scopes to the driver's userId + in_progress and maps Wh→kWh", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      chargeSession: {
        findMany: vi.fn(async (args: Record<string, unknown>) => {
          calls.push(args);
          return [
            {
              id: "sess-1",
              connectorId: "conn-1",
              status: "in_progress",
              startedAt: new Date("2026-06-04T08:00:00Z"),
              energyWh: 12500n,
              costIncVatMinor: null,
              chargingStation: { siteAsset: { displayName: "Festi 8" } },
            },
          ];
        }),
      },
    } as unknown as PrismaClient;

    const out = await getDriverActiveSessions(db, "user-1");

    expect(calls[0].where).toEqual({ userId: "user-1", status: "in_progress" });
    expect(out).toEqual([
      {
        sessionId: "sess-1",
        connectorId: "conn-1",
        chargerName: "Festi 8",
        status: "Charging",
        startedAt: "2026-06-04T08:00:00.000Z",
        powerKw: 0,
        energyKwh: 12.5,
        costIsk: 0,
      },
    ]);
  });

  it("falls back to 'Hleðslustöð' when the asset has no display name", async () => {
    const db = {
      chargeSession: {
        findMany: vi.fn(async () => [
          {
            id: "sess-2",
            connectorId: null,
            status: "in_progress",
            startedAt: new Date("2026-06-04T08:00:00Z"),
            energyWh: null,
            costIncVatMinor: null,
            chargingStation: null,
          },
        ]),
      },
    } as unknown as PrismaClient;

    const out = await getDriverActiveSessions(db, "user-1");
    // Driver-facing copy is Icelandic (a54c4e6, "Copy: … charger fallback
    // Hleðslustöð"), not the original English "Charger".
    expect(out[0].chargerName).toBe("Hleðslustöð");
    expect(out[0].energyKwh).toBe(0);
    expect(out[0].connectorId).toBeNull();
  });
});

// ── resolveStoppableSession ──────────────────────────────────────────

function makeStopFake(session: Record<string, unknown> | null) {
  const calls: Array<Record<string, unknown>> = [];
  const db = {
    chargeSession: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        calls.push(args);
        return session;
      }),
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

describe("resolveStoppableSession", () => {
  it("filters by sessionId + userId + in_progress (ownership guard)", async () => {
    const { db, calls } = makeStopFake(null);
    await resolveStoppableSession(db, "user-1", "sess-1");
    expect(calls[0].where).toEqual({
      id: "sess-1",
      userId: "user-1",
      status: "in_progress",
    });
  });

  it("returns not_found when the session isn't the driver's / doesn't exist", async () => {
    const { db } = makeStopFake(null);
    const r = await resolveStoppableSession(db, "user-1", "sess-x");
    expect(r.kind).toBe("not_found");
  });

  it("returns no_ocpp_identity when the session has no OCPP identity", async () => {
    const { db } = makeStopFake({
      id: "sess-1",
      orgId: "org-1",
      connectorId: "conn-1",
      ocppIdentityId: null,
      startedAt: new Date("2026-06-04T08:00:00Z"),
      chargingStation: { siteAsset: { displayName: "K1" } },
      protocolTransactionRefs: [],
    });
    const r = await resolveStoppableSession(db, "user-1", "sess-1");
    expect(r.kind).toBe("no_ocpp_identity");
  });

  it("returns no_transaction_id when no ocpp protocol ref exists", async () => {
    const { db } = makeStopFake({
      id: "sess-1",
      orgId: "org-1",
      connectorId: "conn-1",
      ocppIdentityId: "ident-1",
      startedAt: new Date("2026-06-04T08:00:00Z"),
      chargingStation: { siteAsset: { displayName: "K1" } },
      protocolTransactionRefs: [],
    });
    const r = await resolveStoppableSession(db, "user-1", "sess-1");
    expect(r.kind).toBe("no_transaction_id");
  });

  it("returns ok with the parsed integer transactionId", async () => {
    const { db } = makeStopFake({
      id: "sess-1",
      orgId: "org-1",
      connectorId: "conn-1",
      ocppIdentityId: "ident-1",
      startedAt: new Date("2026-06-04T08:00:00Z"),
      chargingStation: { siteAsset: { displayName: "K1" } },
      protocolTransactionRefs: [{ sourceId: "98765" }],
    });
    const r = await resolveStoppableSession(db, "user-1", "sess-1");
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.session).toEqual({
      sessionId: "sess-1",
      orgId: "org-1",
      identityId: "ident-1",
      transactionId: 98765,
      connectorId: "conn-1",
      chargerName: "K1",
      startedAt: "2026-06-04T08:00:00.000Z",
    });
  });

  it("treats a non-numeric sourceId as no_transaction_id", async () => {
    const { db } = makeStopFake({
      id: "sess-1",
      orgId: "org-1",
      connectorId: "conn-1",
      ocppIdentityId: "ident-1",
      startedAt: new Date("2026-06-04T08:00:00Z"),
      chargingStation: { siteAsset: { displayName: "K1" } },
      protocolTransactionRefs: [{ sourceId: "not-a-number" }],
    });
    const r = await resolveStoppableSession(db, "user-1", "sess-1");
    expect(r.kind).toBe("no_transaction_id");
  });
});

// ── listDriverSessionHistory ─────────────────────────────────────────

function makeHistoryFake(rows: Record<string, unknown>[]) {
  const calls: Array<Record<string, unknown>> = [];
  const db = {
    sessionLedger: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        calls.push(args);
        return rows;
      }),
    },
    siteAsset: {
      findMany: vi.fn(async () => [{ id: "stn-1", displayName: "Festi 8" }]),
    },
    site: {
      findMany: vi.fn(async () => [{ id: "site-1", displayName: "Festi Reykjavík" }]),
    },
    organization: {
      findMany: vi.fn(async () => [{ id: "org-1", displayName: "Festi hf" }]),
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

const LEDGER_ROW = {
  sessionId: "sess-1",
  orgId: "org-1",
  siteId: "site-1",
  chargingStationId: "stn-1",
  startedAt: new Date("2026-06-01T08:00:00Z"),
  stoppedAt: new Date("2026-06-01T09:00:00Z"),
  durationSec: 3600,
  energyKwh: { toString: () => "30.000" },
  costIskMinor: 64988n,
};

describe("listDriverSessionHistory", () => {
  it("scopes to the driver, defaults limit=25 skip=0, newest-first", async () => {
    const { db, calls } = makeHistoryFake([LEDGER_ROW]);
    await listDriverSessionHistory(db, "user-1");
    expect(calls[0].where).toEqual({ driverUserId: "user-1" });
    expect(calls[0].orderBy).toEqual({ startedAt: "desc" });
    expect(calls[0].take).toBe(25);
    expect(calls[0].skip).toBe(0);
  });

  it("honours skip/limit and clamps limit to 100", async () => {
    const { db, calls } = makeHistoryFake([LEDGER_ROW]);
    await listDriverSessionHistory(db, "user-1", { skip: 40, limit: 9999 });
    expect(calls[0].skip).toBe(40);
    expect(calls[0].take).toBe(100);
  });

  it("enriches charger/site/billing-home names + maps cost", async () => {
    const { db } = makeHistoryFake([LEDGER_ROW]);
    const out = await listDriverSessionHistory(db, "user-1");
    expect(out).toEqual([
      {
        sessionId: "sess-1",
        startedAt: "2026-06-01T08:00:00.000Z",
        stoppedAt: "2026-06-01T09:00:00.000Z",
        durationSec: 3600,
        energyKwh: 30,
        costIsk: 64988,
        chargerName: "Festi 8",
        siteName: "Festi Reykjavík",
        billingHomeName: "Festi hf",
      },
    ]);
  });

  it("returns [] without firing enrichment lookups when no rows", async () => {
    const { db } = makeHistoryFake([]);
    const out = await listDriverSessionHistory(db, "user-1");
    expect(out).toEqual([]);
  });

  it("passes through a null cost (unbilled-yet) as null", async () => {
    const { db } = makeHistoryFake([{ ...LEDGER_ROW, costIskMinor: null }]);
    const out = await listDriverSessionHistory(db, "user-1");
    expect(out[0].costIsk).toBeNull();
  });
});

// ── updateDriverProfile ──────────────────────────────────────────────

function makeProfileFake(opts: { exists: boolean }) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const db = {
    user: {
      findUnique: vi.fn(async (args: { select?: Record<string, unknown> }) => {
        if (!opts.exists) return null;
        // resolveDriverProfile select asks for the full row; the
        // existence pre-check asks for { id }. Return a superset.
        return {
          id: "user-1",
          email: "driver@example.is",
          displayName: "New Name",
          locale: "en",
        };
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        updateCalls.push(args);
        return { id: "user-1" };
      }),
    },
    membership: {
      findFirst: vi.fn(async () => ({ organization: { displayName: "Festi hf" } })),
    },
  } as unknown as PrismaClient;
  return { db, updateCalls };
}

describe("updateDriverProfile", () => {
  it("writes only the provided fields and returns the refreshed profile", async () => {
    const { db, updateCalls } = makeProfileFake({ exists: true });
    const out = await updateDriverProfile(db, "user-1", {
      displayName: "New Name",
      locale: "en",
    });
    expect(updateCalls[0]).toEqual({
      where: { id: "user-1" },
      data: { displayName: "New Name", locale: "en" },
    });
    expect(out).toEqual({
      id: "user-1",
      email: "driver@example.is",
      displayName: "New Name",
      locale: "en",
      organizationName: "Festi hf",
    });
  });

  it("empty patch is a no-op read (no update call)", async () => {
    const { db, updateCalls } = makeProfileFake({ exists: true });
    const out = await updateDriverProfile(db, "user-1", {});
    expect(updateCalls).toHaveLength(0);
    expect(out?.id).toBe("user-1");
  });

  it("returns null when the user no longer exists", async () => {
    const { db, updateCalls } = makeProfileFake({ exists: false });
    const out = await updateDriverProfile(db, "user-1", { locale: "is" });
    expect(out).toBeNull();
    expect(updateCalls).toHaveLength(0);
  });
});
