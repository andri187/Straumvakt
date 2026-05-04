// Sprint 8.9 — Zaptec webhook receiver tests. Same fake-PrismaClient
// pattern as zaptec-session-sync.test.ts; the routes' bearer-secret
// middleware is exercised through Hono.

import { describe, expect, it, beforeEach, vi } from "vitest";

// Stub Prisma client factory — the route imports makePrisma(env)
// to acquire a client, so we mock the factory to hand back our fake.
const fakePrismaState = {
  reset() {
    fakeState.idTokens = [];
    fakeState.sessions = [];
    fakeState.imported = [];
    fakeState.ledger = [];
    fakeState.identityForCharger = "ZAP-1";
    fakeState.tariffsConfigured = true;
  },
};

interface FakeState {
  idTokens: Array<{ id: string; value: string; userId: string; status: string }>;
  sessions: Array<{ id: string; status: string }>;
  imported: Array<{
    sourceKind: string;
    sourceCdrId: string;
    sessionId: string;
    orgId: string;
  }>;
  ledger: Array<{ sessionId: string; costIskMinor: bigint }>;
  identityForCharger: string;
  tariffsConfigured: boolean;
}

const fakeState: FakeState = {
  idTokens: [],
  sessions: [],
  imported: [],
  ledger: [],
  identityForCharger: "ZAP-1",
  tariffsConfigured: true,
};

const ORG = "11111111-1111-1111-1111-111111111111";
const STATION = "22222222-2222-2222-2222-222222222222";
const SITE = "33333333-3333-3333-3333-333333333333";
const EVSE = "44444444-4444-4444-4444-444444444444";
const INSTALL = "55555555-5555-5555-5555-555555555555";

function makeFake() {
  const tx = {
    idToken: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where }: any) =>
        fakeState.idTokens.find(
          (t) => t.value === where.value && t.status === where.status,
        ) ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async () => undefined,
    },
    importedCdrRef: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const k = where.sourceKind_sourceCdrId;
        return (
          fakeState.imported.find(
            (r) =>
              r.sourceKind === k.sourceKind &&
              r.sourceCdrId === k.sourceCdrId,
          ) ?? null
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        fakeState.imported.push({
          sourceKind: data.sourceKind,
          sourceCdrId: data.sourceCdrId,
          sessionId: data.sessionId,
          orgId: data.orgId,
        });
      },
    },
    ocppIdentity: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where }: any) =>
        where.vendorResourceId === fakeState.identityForCharger
          ? { id: "id-1", orgId: ORG, chargingStationId: STATION }
          : null,
    },
    siteAsset: {
      findUnique: async () => ({ siteId: SITE }),
    },
    eVSE: {
      findFirst: async () => ({ id: EVSE }),
    },
    site: {
      findUnique: async () =>
        fakeState.tariffsConfigured ? { id: SITE, dsoTariffId: "dso" } : null,
    },
    chargingStation: {
      findUnique: async () =>
        fakeState.tariffsConfigured
          ? { siteAssetId: STATION, installationId: INSTALL }
          : null,
    },
    installation: {
      findUnique: async () =>
        fakeState.tariffsConfigured
          ? { id: INSTALL, retailerTariffId: "ret" }
          : null,
    },
    tariffDefinition: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (!fakeState.tariffsConfigured) return null;
        if (where.id === "dso") {
          return {
            id: "dso",
            displayName: "Veitur AD1",
            computeRule: { kind: "flat", pricePerKwhMinor: 864 },
            vatRatePct: 24,
            currency: "ISK",
            status: "active",
          };
        }
        if (where.id === "ret") {
          return {
            id: "ret",
            displayName: "N1",
            computeRule: { kind: "flat", pricePerKwhMinor: 883 },
            vatRatePct: 24,
            currency: "ISK",
            status: "active",
          };
        }
        return null;
      },
    },
    chargeSession: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        fakeState.sessions.push({ id: data.id, status: data.status });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const s = fakeState.sessions.find((s) => s.id === where.id);
        if (!s) return null;
        return {
          id: s.id,
          orgId: ORG,
          siteId: SITE,
          chargingStationId: STATION,
          startedAt: new Date("2026-04-15T12:00:00Z"),
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async () => undefined,
    },
    sessionLedger: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert: async ({ create }: any) => {
        fakeState.ledger.push({
          sessionId: create.sessionId,
          costIskMinor: create.costIskMinor,
        });
      },
    },
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: any) => fn(tx),
    ...tx,
  };
}

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => makeFake(),
}));

import { zaptecWebhooks } from "./zaptec";

const SECRET = "shh-test-secret";

function makeReq(path: string, body: unknown, opts: { auth?: string } = {}) {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.auth !== undefined ? { authorization: opts.auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(path: string, body: unknown, opts: { auth?: string; env?: any } = {}) {
  const env = opts.env ?? { ZAPTEC_WEBHOOK_SECRET: SECRET };
  return zaptecWebhooks.fetch(makeReq(path, body, opts), env);
}

describe("zaptec webhooks", () => {
  beforeEach(() => {
    fakePrismaState.reset();
  });

  it("returns 503 when webhook secret is unset", async () => {
    const res = await call("/auth", {}, { env: {} });
    expect(res.status).toBe(503);
  });

  it("diagnostic mode bypasses auth + accepts unauthenticated calls", async () => {
    const res = await call(
      "/auth",
      { cardId: "TEST" },
      { env: { ZAPTEC_WEBHOOK_DIAGNOSTIC: "1" } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    // No matching IdToken seeded → returns Reject (but route ran).
    expect(body.result).toBe("Reject");
  });

  it("returns 401 when authorization header is missing/wrong", async () => {
    const res = await call("/auth", {});
    expect(res.status).toBe(401);
    const res2 = await call("/auth", {}, { auth: "Bearer nope" });
    expect(res2.status).toBe(401);
  });

  it("auth: rejects unknown card", async () => {
    const res = await call(
      "/auth",
      { cardId: "ABCD1234" },
      { auth: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("Reject");
  });

  it("auth: accepts known active card", async () => {
    fakeState.idTokens.push({
      id: "tok-1",
      value: "ABCD1234",
      userId: "user-1",
      status: "active",
    });
    const res = await call(
      "/auth",
      { cardId: "ABCD1234" },
      { auth: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("Accept");
  });

  it("session-start: creates session + ImportedCdrRef", async () => {
    const res = await call(
      "/session-start",
      {
        sessionId: "z-1",
        chargerId: "ZAP-1",
        startedAt: "2026-04-15T12:00:00Z",
        cardId: "ABCD1234",
      },
      { auth: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(200);
    expect(fakeState.sessions).toHaveLength(1);
    expect(fakeState.imported).toHaveLength(1);
    expect(fakeState.imported[0].sourceCdrId).toBe("z-1");
  });

  it("session-start: idempotent on duplicate Zaptec session id", async () => {
    fakeState.imported.push({
      sourceKind: "zaptec",
      sourceCdrId: "z-1",
      sessionId: "prev",
      orgId: ORG,
    });
    const res = await call(
      "/session-start",
      {
        sessionId: "z-1",
        chargerId: "ZAP-1",
        startedAt: "2026-04-15T12:00:00Z",
      },
      { auth: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(200);
    expect(fakeState.sessions).toHaveLength(0);
    expect(fakeState.imported).toHaveLength(1); // unchanged
  });

  it("session-end: closes session, computes cost via Veitur+N1, writes ledger", async () => {
    const res = await call(
      "/session-end",
      {
        sessionId: "z-2",
        chargerId: "ZAP-1",
        startedAt: "2026-04-15T12:00:00Z",
        endedAt: "2026-04-15T13:00:00Z",
        energyKwh: 30,
      },
      { auth: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; costIskMinor: string };
    expect(body.ok).toBe(true);
    expect(body.costIskMinor).toBe("64988"); // 30 kWh × (864+883) × 1.24
    expect(fakeState.ledger).toHaveLength(1);
    expect(fakeState.ledger[0].costIskMinor).toBe(64988n);
  });

  it("session-end: surfaces tariff misconfig as error", async () => {
    fakeState.tariffsConfigured = false;
    const res = await call(
      "/session-end",
      {
        sessionId: "z-3",
        chargerId: "ZAP-1",
        startedAt: "2026-04-15T12:00:00Z",
        endedAt: "2026-04-15T13:00:00Z",
        energyKwh: 30,
      },
      { auth: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("session_site_not_found");
  });
});
