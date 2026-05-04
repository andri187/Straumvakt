// Sprint 8.7 — Zaptec API-only writeback tests. Uses an in-memory
// fake Prisma client because the writer touches six tables across
// schemas (ocpp.ocpp_identities, properties.site_assets, assets.evses,
// charging.sessions, charging.imported_cdr_refs, reports.session_ledger,
// billing.tariff_definitions, properties.sites, hardware.installations).
// Writing real-DB integration tests for this would need fixture
// scaffolding ten times larger; the fake covers the orchestration
// invariants, and the real backfill against staging is the integration
// test of record (see deployment plan).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/zaptec", () => ({
  listZaptecChargeHistory: vi.fn(),
}));

import { listZaptecChargeHistory } from "../lib/zaptec";
import { syncZaptecSessions } from "./zaptec-session-sync";
import type { PrismaClient } from "../generated/prisma/client";

const Z_CHARGER = "ZAPTEC-CH-001";
const STATION = "11111111-1111-1111-1111-111111111111";
const ORG = "22222222-2222-2222-2222-222222222222";
const SITE = "33333333-3333-3333-3333-333333333333";
const EVSE = "44444444-4444-4444-4444-444444444444";
const INSTALL = "55555555-5555-5555-5555-555555555555";
const DSO_TARIFF = "66666666-6666-6666-6666-666666666666";
const RETAILER_TARIFF = "77777777-7777-7777-7777-777777777777";
const OCPP_IDENTITY = "88888888-8888-8888-8888-888888888888";

interface State {
  importedCdrRefs: Array<{
    sourceKind: string;
    sourceCdrId: string;
    sessionId: string;
    orgId: string;
  }>;
  chargeSessions: Array<{ id: string; orgId: string; energyWh: bigint | null }>;
  sessionLedger: Array<{ sessionId: string; costIskMinor: bigint | null }>;
}

interface FakeOpts {
  hasIdentity?: boolean;
  hasEvse?: boolean;
  hasSiteAsset?: boolean;
  hasTariffs?: boolean;
}

function makeFakeDb(state: State, opts: FakeOpts = {}): PrismaClient {
  const hasIdentity = opts.hasIdentity ?? true;
  const hasEvse = opts.hasEvse ?? true;
  const hasSiteAsset = opts.hasSiteAsset ?? true;
  const hasTariffs = opts.hasTariffs ?? true;

  const tx = {
    importedCdrRef: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const key = where.sourceKind_sourceCdrId;
        return (
          state.importedCdrRefs.find(
            (r) =>
              r.sourceKind === key.sourceKind &&
              r.sourceCdrId === key.sourceCdrId,
          ) ?? null
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        state.importedCdrRefs.push({
          sourceKind: data.sourceKind,
          sourceCdrId: data.sourceCdrId,
          sessionId: data.sessionId,
          orgId: data.orgId,
        });
        return { id: "ref-" + state.importedCdrRefs.length };
      },
    },
    ocppIdentity: {
      findFirst: async () =>
        hasIdentity
          ? { id: OCPP_IDENTITY, orgId: ORG, chargingStationId: STATION }
          : null,
    },
    siteAsset: {
      findUnique: async () => (hasSiteAsset ? { siteId: SITE } : null),
    },
    eVSE: {
      findFirst: async () => (hasEvse ? { id: EVSE } : null),
    },
    idToken: {
      findFirst: async () => null,
    },
    site: {
      findUnique: async () =>
        hasTariffs ? { id: SITE, dsoTariffId: DSO_TARIFF } : null,
    },
    chargingStation: {
      findUnique: async () =>
        hasTariffs ? { siteAssetId: STATION, installationId: INSTALL } : null,
    },
    installation: {
      findUnique: async () =>
        hasTariffs ? { id: INSTALL, retailerTariffId: RETAILER_TARIFF } : null,
    },
    tariffDefinition: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (!hasTariffs) return null;
        if (where.id === DSO_TARIFF) {
          return {
            id: DSO_TARIFF,
            displayName: "Veitur AD1",
            computeRule: { kind: "flat", pricePerKwhMinor: 864 },
            vatRatePct: 24,
            currency: "ISK",
            status: "active",
          };
        }
        if (where.id === RETAILER_TARIFF) {
          return {
            id: RETAILER_TARIFF,
            displayName: "N1_RAFMAGN-REPF-01",
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
        state.chargeSessions.push({
          id: data.id,
          orgId: data.orgId,
          energyWh: data.energyWh ?? null,
        });
        return { id: data.id };
      },
    },
    sessionLedger: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert: async ({ create }: any) => {
        state.sessionLedger.push({
          sessionId: create.sessionId,
          costIskMinor: create.costIskMinor,
        });
        return { sessionId: create.sessionId };
      },
    },
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: any) => fn(tx),
  } as unknown as PrismaClient;
}

function happyPathHistory(): unknown {
  return {
    ok: true,
    value: [
      {
        Id: "z-session-1",
        ChargerId: Z_CHARGER,
        StartDateTime: "2026-04-15T12:00:00Z",
        EndDateTime: "2026-04-15T13:00:00Z",
        Energy: 30, // kWh
        UserUserName: "andri",
      },
    ],
  };
}

describe("syncZaptecSessions", () => {
  beforeEach(() => {
    vi.mocked(listZaptecChargeHistory).mockReset();
  });

  it("happy path — synth session + ledger row, cost via Veitur+N1", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(happyPathHistory() as never);
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
    };
    const db = makeFakeDb(state);

    const report = await syncZaptecSessions(db, { accessToken: "stub" });

    expect(report.zaptecCount).toBe(1);
    expect(report.imported).toHaveLength(1);
    expect(report.skipped).toEqual([]);
    expect(report.errors).toEqual([]);

    // 30 kWh × (864 + 883) ex-VAT = 52410 minor; × 1.24 VAT = 64988 minor.
    expect(report.imported[0].costIskMinor).toBe("64988");
    expect(state.chargeSessions).toHaveLength(1);
    expect(state.sessionLedger).toHaveLength(1);
    expect(state.sessionLedger[0].costIskMinor).toBe(64988n);
    expect(state.importedCdrRefs[0].sourceKind).toBe("zaptec");
    expect(state.importedCdrRefs[0].sourceCdrId).toBe("z-session-1");
  });

  it("idempotent — second run with existing ImportedCdrRef skips", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(happyPathHistory() as never);
    const state: State = {
      importedCdrRefs: [
        {
          sourceKind: "zaptec",
          sourceCdrId: "z-session-1",
          sessionId: "prev-session",
          orgId: ORG,
        },
      ],
      chargeSessions: [],
      sessionLedger: [],
    };
    const db = makeFakeDb(state);

    const report = await syncZaptecSessions(db, { accessToken: "stub" });
    expect(report.imported).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].reason).toBe("already_imported");
    expect(state.chargeSessions).toHaveLength(0);
    expect(state.sessionLedger).toHaveLength(0);
  });

  it("open session (no EndDateTime) is skipped", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({
      ok: true,
      value: [
        {
          Id: "z-open",
          ChargerId: Z_CHARGER,
          StartDateTime: "2026-04-15T12:00:00Z",
          EndDateTime: null,
          Energy: 5,
        },
      ],
    } as never);
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
    };
    const db = makeFakeDb(state);

    const report = await syncZaptecSessions(db, { accessToken: "stub" });
    expect(report.imported).toEqual([]);
    expect(report.skipped[0].reason).toBe("session_open");
    expect(state.chargeSessions).toHaveLength(0);
  });

  it("station not mapped (no OcppIdentity) → skipped no_station_mapped", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(happyPathHistory() as never);
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
    };
    const db = makeFakeDb(state, { hasIdentity: false });

    const report = await syncZaptecSessions(db, { accessToken: "stub" });
    expect(report.imported).toEqual([]);
    expect(report.skipped[0].reason).toBe("no_station_mapped");
    expect(state.chargeSessions).toHaveLength(0);
  });

  it("missing tariff config surfaces as error (TariffResolutionError)", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(happyPathHistory() as never);
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
    };
    const db = makeFakeDb(state, { hasTariffs: false });

    const report = await syncZaptecSessions(db, { accessToken: "stub" });
    expect(report.imported).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("session_site_not_found");
    expect(state.chargeSessions).toHaveLength(0);
  });

  it("rethrows on Zaptec fetch failure", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({
      ok: false,
      error: { kind: "list", status: 502 },
    } as never);
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
    };
    const db = makeFakeDb(state);

    await expect(syncZaptecSessions(db, { accessToken: "stub" })).rejects.toThrow(
      /zaptec_chargehistory_fetch_failed/,
    );
  });
});
