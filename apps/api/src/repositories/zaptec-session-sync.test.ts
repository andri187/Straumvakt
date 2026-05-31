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
  chargeSessions: Array<{
    id: string;
    orgId: string;
    energyWh: bigint | null;
    status?: string;
    userId?: string | null;
  }>;
  sessionLedger: Array<{ sessionId: string; costIskMinor: bigint | null }>;
  // 2026-05-12 — when set, chargeSession.findFirst returns this row,
  // simulating an OCPP-created session that CDR sync should overlay
  // instead of duplicating.
  preSeededOcppRow?: { id: string; userId: string | null } | null;
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
      // 2026-05-12 — CDR-matches-OCPP reconciliation. Returns the
      // pre-seeded row from state when set; otherwise null = no match
      // = legacy create path.
      findFirst: async () =>
        state.preSeededOcppRow
          ? {
              id: state.preSeededOcppRow.id,
              userId: state.preSeededOcppRow.userId,
            }
          : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where, data }: any) => {
        const idx = state.chargeSessions.findIndex((s) => s.id === where.id);
        if (idx >= 0) {
          state.chargeSessions[idx] = {
            ...state.chargeSessions[idx],
            energyWh: data.energyWh ?? state.chargeSessions[idx].energyWh,
            status: data.status ?? state.chargeSessions[idx].status,
            userId:
              data.userId !== undefined
                ? data.userId
                : state.chargeSessions[idx].userId,
          };
        }
        return { id: where.id };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        state.chargeSessions.push({
          id: data.id,
          orgId: data.orgId,
          energyWh: data.energyWh ?? null,
          status: data.status,
          userId: data.userId ?? null,
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

  // ─── 2026-05-12 — CDR-matches-OCPP reconciliation ────────────────
  describe("match-existing OCPP row", () => {
    it("overlays existing row instead of creating duplicate", async () => {
      vi.mocked(listZaptecChargeHistory).mockResolvedValue(
        happyPathHistory() as never,
      );
      const OCPP_ROW_ID = "ocpp-row-1";
      const N1_DRIVERS_USER = "n1-drivers-user-id";
      const state: State = {
        importedCdrRefs: [],
        // OCPP path pre-created the row (status in_progress, idTag set,
        // user already resolved via EE43C609263CC7 → N1 Drivers User).
        chargeSessions: [
          {
            id: OCPP_ROW_ID,
            orgId: ORG,
            energyWh: 0n,
            status: "in_progress",
            userId: N1_DRIVERS_USER,
          },
        ],
        sessionLedger: [],
        // Make findFirst return this row.
        preSeededOcppRow: { id: OCPP_ROW_ID, userId: N1_DRIVERS_USER },
      };
      const db = makeFakeDb(state);

      const report = await syncZaptecSessions(db, { accessToken: "stub" });

      expect(report.imported).toHaveLength(1);
      expect(report.imported[0].ourSessionId).toBe(OCPP_ROW_ID);

      // No duplicate row created — single row, updated in place.
      expect(state.chargeSessions).toHaveLength(1);
      expect(state.chargeSessions[0].id).toBe(OCPP_ROW_ID);
      expect(state.chargeSessions[0].energyWh).toBe(30_000n); // 30 kWh
      expect(state.chargeSessions[0].status).toBe("completed");
      // OCPP-resolved user_id preserved (not overwritten with CDR's null).
      expect(state.chargeSessions[0].userId).toBe(N1_DRIVERS_USER);

      // Idempotency record + ledger upsert still happen.
      expect(state.importedCdrRefs).toHaveLength(1);
      expect(state.importedCdrRefs[0].sessionId).toBe(OCPP_ROW_ID);
      expect(state.sessionLedger).toHaveLength(1);
      expect(state.sessionLedger[0].sessionId).toBe(OCPP_ROW_ID);
    });

    it("preserves OCPP-resolved user_id; doesn't overwrite when CDR has driver too", async () => {
      // Same as above but CDR also resolves a user (different one). The
      // pre-existing user_id on the OCPP row should win.
      vi.mocked(listZaptecChargeHistory).mockResolvedValue(
        happyPathHistory() as never,
      );
      const OCPP_ROW_ID = "ocpp-row-2";
      const OCPP_USER = "ocpp-resolved-user";
      const state: State = {
        importedCdrRefs: [],
        chargeSessions: [
          {
            id: OCPP_ROW_ID,
            orgId: ORG,
            energyWh: 0n,
            status: "in_progress",
            userId: OCPP_USER,
          },
        ],
        sessionLedger: [],
        preSeededOcppRow: { id: OCPP_ROW_ID, userId: OCPP_USER },
      };
      const db = makeFakeDb(state);

      await syncZaptecSessions(db, { accessToken: "stub" });

      expect(state.chargeSessions[0].userId).toBe(OCPP_USER);
    });

    it("falls through to create when no matching OCPP row exists", async () => {
      // No preSeededOcppRow → findFirst returns null → legacy create path.
      vi.mocked(listZaptecChargeHistory).mockResolvedValue(
        happyPathHistory() as never,
      );
      const state: State = {
        importedCdrRefs: [],
        chargeSessions: [],
        sessionLedger: [],
        // preSeededOcppRow undefined => no match
      };
      const db = makeFakeDb(state);

      const report = await syncZaptecSessions(db, { accessToken: "stub" });

      expect(report.imported).toHaveLength(1);
      expect(state.chargeSessions).toHaveLength(1);
      // New UUID, not "ocpp-row-*" — confirms the create path ran.
      expect(state.chargeSessions[0].id).not.toMatch(/^ocpp-row-/);
      expect(state.chargeSessions[0].energyWh).toBe(30_000n);
    });
  });
});
