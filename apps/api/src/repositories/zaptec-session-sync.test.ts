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
    // ENRICH-1 — per-source mirror columns.
    ocppEnergyKwh?: string | null;
    cdrEnergyKwh?: string | null;
    cdrStoppedAt?: Date | null;
  }>;
  sessionLedger: Array<{
    sessionId: string;
    costIskMinor: bigint | null;
    // Who the money was attributed to. null = nobody, which is a real and
    // acceptable state; a WRONG value here is a stranger's invoice.
    driverUserId?: string | null;
    // ENRICH-1 — provenance metadata.
    verifiedSource?: string | null;
    enrichmentStatus?: string | null;
  }>;
  // 2026-05-12 — when set, chargeSession.findFirst returns this row,
  // simulating an OCPP-created session that CDR sync should overlay
  // instead of duplicating. ENRICH-1 — ocppEnergyKwh allows tests to
  // exercise the mismatch / agreement classifier.
  preSeededOcppRow?:
    | { id: string; userId: string | null; ocppEnergyKwh?: string | null }
    | null;
  // Driver attribution inputs. Empty by default, which is the pre-Authorize
  // historical case: no token, no membership, nobody to bill.
  idTokens?: Array<{
    value: string;
    userId: string;
    status: string;
    expiresAt: Date | null;
  }>;
  memberships?: Array<{ userId: string; orgId: string }>;
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
      // The importer no longer calls findFirst — it fetches every candidate
      // row and lets the pure resolver decide. Left present and throwing so a
      // regression to the unscoped single-row lookup fails loudly here.
      findFirst: async () => {
        throw new Error("idToken.findFirst is not the attribution path any more");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) => {
        const wanted: string[] = where?.value?.in ?? [];
        return (state.idTokens ?? []).filter((t) => wanted.includes(t.value));
      },
    },
    membership: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) => {
        const users: string[] = where?.userId?.in ?? [];
        const orgId: string | undefined = where?.orgId;
        return (state.memberships ?? []).filter(
          (m) => users.includes(m.userId) && (orgId === undefined || m.orgId === orgId),
        );
      },
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
      // = legacy create path. ENRICH-1 — also surfaces ocppEnergyKwh
      // so the mismatch classifier has a value to compare against.
      findFirst: async () =>
        state.preSeededOcppRow
          ? {
              id: state.preSeededOcppRow.id,
              userId: state.preSeededOcppRow.userId,
              ocppEnergyKwh:
                state.preSeededOcppRow.ocppEnergyKwh ?? null,
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
            // ENRICH-1 — record the per-source CDR mirror fields.
            cdrEnergyKwh:
              data.cdrEnergyKwh !== undefined
                ? data.cdrEnergyKwh
                : state.chargeSessions[idx].cdrEnergyKwh ?? null,
            cdrStoppedAt:
              data.cdrStoppedAt !== undefined
                ? data.cdrStoppedAt
                : state.chargeSessions[idx].cdrStoppedAt ?? null,
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
          // ENRICH-1 — capture mirror fields written by the synth path.
          cdrEnergyKwh: data.cdrEnergyKwh ?? null,
          cdrStoppedAt: data.cdrStoppedAt ?? null,
        });
        return { id: data.id };
      },
    },
    sessionLedger: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert: async ({ create, update }: any) => {
        const idx = state.sessionLedger.findIndex(
          (l) => l.sessionId === create.sessionId,
        );
        if (idx >= 0) {
          // Existing row (e.g. OCPP already wrote it); apply the update
          // patch so verified_source / enrichment_status flip from
          // "ocpp" / "pending" → "cdr" / "complete" | "mismatch".
          state.sessionLedger[idx] = {
            ...state.sessionLedger[idx],
            verifiedSource:
              update.verifiedSource ??
              state.sessionLedger[idx].verifiedSource ??
              null,
            enrichmentStatus:
              update.enrichmentStatus ??
              state.sessionLedger[idx].enrichmentStatus ??
              null,
          };
        } else {
          state.sessionLedger.push({
            sessionId: create.sessionId,
            costIskMinor: create.costIskMinor,
            driverUserId: create.driverUserId ?? null,
            verifiedSource: create.verifiedSource ?? null,
            enrichmentStatus: create.enrichmentStatus ?? null,
          });
        }
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

// ── Driver attribution across tenants ────────────────────────────────
//
// Every token value below is synthetic. The importer used to resolve a driver
// with `idToken.findFirst({ value: { in: candidates }, status: "active" })` —
// no org term — four lines after identity.orgId came into scope, and the
// resolved userId went straight onto session_ledger.driver_user_id. These
// tests exercise the real query shapes through the fake, so they fail if the
// importer stops passing org context even though the pure resolver still
// refuses correctly in isolation.

const LOCAL_DRIVER = "aaaaaaaa-0000-0000-0000-00000000000a";
const FOREIGN_DRIVER = "bbbbbbbb-0000-0000-0000-00000000000b";
const OTHER_ORG = "99999999-9999-9999-9999-999999999999";

function historyWithToken(tokenName: string): unknown {
  return {
    ok: true,
    value: [
      {
        Id: "z-session-1",
        ChargerId: Z_CHARGER,
        StartDateTime: "2026-04-15T12:00:00Z",
        EndDateTime: "2026-04-15T13:00:00Z",
        Energy: 30,
        TokenName: tokenName,
      },
    ],
  };
}

describe("syncZaptecSessions — driver attribution is tenant-scoped", () => {
  beforeEach(() => {
    vi.mocked(listZaptecChargeHistory).mockReset();
  });

  it("attributes a token whose owner belongs to the charger's org", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(
      historyWithToken("SYNTH-TAG-LOCAL-01") as never,
    );
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
      idTokens: [
        { value: "SYNTH-TAG-LOCAL-01", userId: LOCAL_DRIVER, status: "active", expiresAt: null },
      ],
      memberships: [{ userId: LOCAL_DRIVER, orgId: ORG }],
    };

    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });

    expect(report.errors).toEqual([]);
    expect(report.imported[0].driverAttribution).toEqual({
      kind: "attributed",
      userId: LOCAL_DRIVER,
    });
    expect(state.sessionLedger[0].driverUserId).toBe(LOCAL_DRIVER);
    expect(state.chargeSessions[0].userId).toBe(LOCAL_DRIVER);
  });

  it("refuses to bill a driver from another org, and still imports the session", async () => {
    // The charge happened. It must be recorded and priced — it just cannot be
    // put on a stranger's invoice.
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(
      historyWithToken("SYNTH-TAG-FOREIGN-01") as never,
    );
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
      idTokens: [
        {
          value: "SYNTH-TAG-FOREIGN-01",
          userId: FOREIGN_DRIVER,
          status: "active",
          expiresAt: null,
        },
      ],
      memberships: [{ userId: FOREIGN_DRIVER, orgId: OTHER_ORG }],
    };

    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });

    expect(report.errors).toEqual([]);
    expect(report.imported).toHaveLength(1);
    expect(report.imported[0].costIskMinor).toBe("64988");
    expect(report.imported[0].driverAttribution).toEqual({
      kind: "unattributed",
      reason: "driver_outside_charger_org",
    });
    expect(state.sessionLedger[0].driverUserId).toBeNull();
    expect(state.chargeSessions[0].userId).toBeNull();
  });

  it("refuses when two vendor identifiers on one CDR point at two drivers", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({
      ok: true,
      value: [
        {
          Id: "z-session-1",
          ChargerId: Z_CHARGER,
          StartDateTime: "2026-04-15T12:00:00Z",
          EndDateTime: "2026-04-15T13:00:00Z",
          Energy: 30,
          TokenName: "SYNTH-TAG-LOCAL-01",
          UserUserName: "SYNTH-NAME-COLLIDES",
        },
      ],
    } as never);
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
      idTokens: [
        { value: "SYNTH-TAG-LOCAL-01", userId: LOCAL_DRIVER, status: "active", expiresAt: null },
        {
          value: "SYNTH-NAME-COLLIDES",
          userId: FOREIGN_DRIVER,
          status: "active",
          expiresAt: null,
        },
      ],
      // Both are members here, so only refusing to choose can save this.
      memberships: [
        { userId: LOCAL_DRIVER, orgId: ORG },
        { userId: FOREIGN_DRIVER, orgId: ORG },
      ],
    };

    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });

    expect(report.imported[0].driverAttribution).toEqual({
      kind: "unattributed",
      reason: "ambiguous_candidates",
    });
    expect(state.sessionLedger[0].driverUserId).toBeNull();
  });

  it("records a pre-Authorize CDR with no identifiers as imported, not as an error", async () => {
    // ADR 0049 amendment: structurally unattributable, and not broken.
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({
      ok: true,
      value: [
        {
          Id: "z-session-1",
          ChargerId: Z_CHARGER,
          StartDateTime: "2026-04-15T12:00:00Z",
          EndDateTime: "2026-04-15T13:00:00Z",
          Energy: 30,
        },
      ],
    } as never);
    const state: State = { importedCdrRefs: [], chargeSessions: [], sessionLedger: [] };

    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });

    expect(report.errors).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.imported[0].driverAttribution).toEqual({
      kind: "unattributed",
      reason: "no_candidates",
    });
  });

  it("refuses a revoked token belonging to a member of the charger's org", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(
      historyWithToken("SYNTH-TAG-LOCAL-01") as never,
    );
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [],
      sessionLedger: [],
      idTokens: [
        { value: "SYNTH-TAG-LOCAL-01", userId: LOCAL_DRIVER, status: "revoked", expiresAt: null },
      ],
      memberships: [{ userId: LOCAL_DRIVER, orgId: ORG }],
    };

    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });

    expect(report.imported[0].driverAttribution).toEqual({
      kind: "unattributed",
      reason: "token_not_usable",
    });
    expect(state.sessionLedger[0].driverUserId).toBeNull();
  });

  it("does not overwrite a userId the OCPP path already pinned", async () => {
    // The reconciliation branch. OCPP's Authorize-driven resolution is
    // stronger than the CDR's vendor-profile chain, so an existing userId
    // wins — and an unattributed CDR must not clear it either.
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(
      historyWithToken("SYNTH-TAG-FOREIGN-01") as never,
    );
    const state: State = {
      importedCdrRefs: [],
      chargeSessions: [
        { id: "ocpp-row-1", orgId: ORG, energyWh: 30_000n, userId: LOCAL_DRIVER },
      ],
      sessionLedger: [],
      preSeededOcppRow: { id: "ocpp-row-1", userId: LOCAL_DRIVER },
      idTokens: [
        {
          value: "SYNTH-TAG-FOREIGN-01",
          userId: FOREIGN_DRIVER,
          status: "active",
          expiresAt: null,
        },
      ],
      memberships: [{ userId: FOREIGN_DRIVER, orgId: OTHER_ORG }],
    };

    await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });

    expect(state.chargeSessions[0].userId).toBe(LOCAL_DRIVER);
  });
});

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

  // ─── Sprint 9 / ENRICH-1 — per-source columns + verifiedSource ─────
  describe("enrichment v1 — per-source columns + verifiedSource", () => {
    it("synth path writes cdrEnergyKwh + verifiedSource=cdr + enrichmentStatus=complete", async () => {
      vi.mocked(listZaptecChargeHistory).mockResolvedValue(
        happyPathHistory() as never,
      );
      const state: State = {
        importedCdrRefs: [],
        chargeSessions: [],
        sessionLedger: [],
        // preSeededOcppRow undefined => synth path
      };
      const db = makeFakeDb(state);

      await syncZaptecSessions(db, { accessToken: "stub" });

      // CDR figure recorded in dedicated mirror column.
      expect(state.chargeSessions[0].cdrEnergyKwh).toBe("30.0000");
      expect(state.chargeSessions[0].cdrStoppedAt).toBeInstanceOf(Date);
      // Ledger flagged with CDR provenance.
      expect(state.sessionLedger[0].verifiedSource).toBe("cdr");
      // No OCPP value to compare against on the synth path — "complete"
      // by definition (CDR is the only source).
      expect(state.sessionLedger[0].enrichmentStatus).toBe("complete");
    });

    it("overlay path preserves ocppEnergyKwh on the row + writes cdrEnergyKwh", async () => {
      // Existing OCPP row carries ocppEnergyKwh = "30.0000" (matches
      // CDR within tolerance). CDR overlay must NOT touch
      // ocppEnergyKwh; only its own cdrEnergyKwh column.
      vi.mocked(listZaptecChargeHistory).mockResolvedValue(
        happyPathHistory() as never,
      );
      const OCPP_ROW_ID = "ocpp-row-enrich-1";
      const state: State = {
        importedCdrRefs: [],
        chargeSessions: [
          {
            id: OCPP_ROW_ID,
            orgId: ORG,
            energyWh: 30_000n,
            status: "completed",
            userId: null,
            // OCPP wrote this when StopTransaction landed.
            ocppEnergyKwh: "30.0000",
          },
        ],
        sessionLedger: [
          {
            sessionId: OCPP_ROW_ID,
            costIskMinor: 0n,
            verifiedSource: "ocpp",
            enrichmentStatus: "pending",
          },
        ],
        preSeededOcppRow: {
          id: OCPP_ROW_ID,
          userId: null,
          ocppEnergyKwh: "30.0000",
        },
      };
      const db = makeFakeDb(state);

      await syncZaptecSessions(db, { accessToken: "stub" });

      // ocppEnergyKwh untouched; cdrEnergyKwh populated.
      expect(state.chargeSessions[0].ocppEnergyKwh).toBe("30.0000");
      expect(state.chargeSessions[0].cdrEnergyKwh).toBe("30.0000");
      // Ledger promoted from "ocpp" / "pending" → "cdr" / "complete"
      // (CDR == OCPP within 0.05 kWh).
      expect(state.sessionLedger[0].verifiedSource).toBe("cdr");
      expect(state.sessionLedger[0].enrichmentStatus).toBe("complete");
    });

    it("flags enrichmentStatus=mismatch when CDR and OCPP diverge by > 0.05 kWh", async () => {
      // OCPP recorded 30.00 kWh; CDR reports 30.10 kWh. |diff| = 0.10
      // > 0.05 → mismatch.
      vi.mocked(listZaptecChargeHistory).mockResolvedValue({
        ok: true,
        value: [
          {
            Id: "z-mismatch-1",
            ChargerId: Z_CHARGER,
            StartDateTime: "2026-04-15T12:00:00Z",
            EndDateTime: "2026-04-15T13:00:00Z",
            Energy: 30.1, // CDR figure
            UserUserName: "andri",
          },
        ],
      } as never);
      const OCPP_ROW_ID = "ocpp-row-mismatch";
      const state: State = {
        importedCdrRefs: [],
        chargeSessions: [
          {
            id: OCPP_ROW_ID,
            orgId: ORG,
            energyWh: 30_000n,
            status: "completed",
            userId: null,
            ocppEnergyKwh: "30.0000",
          },
        ],
        sessionLedger: [
          {
            sessionId: OCPP_ROW_ID,
            costIskMinor: 0n,
            verifiedSource: "ocpp",
            enrichmentStatus: "pending",
          },
        ],
        preSeededOcppRow: {
          id: OCPP_ROW_ID,
          userId: null,
          ocppEnergyKwh: "30.0000",
        },
      };
      const db = makeFakeDb(state);

      await syncZaptecSessions(db, { accessToken: "stub" });

      // CDR mirror column carries the new figure; OCPP figure preserved.
      expect(state.chargeSessions[0].cdrEnergyKwh).toBe("30.1000");
      expect(state.chargeSessions[0].ocppEnergyKwh).toBe("30.0000");
      // Ledger flagged for operator attention.
      expect(state.sessionLedger[0].verifiedSource).toBe("cdr");
      expect(state.sessionLedger[0].enrichmentStatus).toBe("mismatch");
    });

    it("treats |diff| at the 0.05 kWh boundary as complete (inclusive tolerance)", async () => {
      // OCPP recorded 30.00 kWh; CDR reports 30.05 kWh exactly.
      vi.mocked(listZaptecChargeHistory).mockResolvedValue({
        ok: true,
        value: [
          {
            Id: "z-boundary",
            ChargerId: Z_CHARGER,
            StartDateTime: "2026-04-15T12:00:00Z",
            EndDateTime: "2026-04-15T13:00:00Z",
            Energy: 30.05,
            UserUserName: "andri",
          },
        ],
      } as never);
      const OCPP_ROW_ID = "ocpp-row-boundary";
      const state: State = {
        importedCdrRefs: [],
        chargeSessions: [
          {
            id: OCPP_ROW_ID,
            orgId: ORG,
            energyWh: 30_000n,
            status: "completed",
            userId: null,
            ocppEnergyKwh: "30.0000",
          },
        ],
        sessionLedger: [],
        preSeededOcppRow: {
          id: OCPP_ROW_ID,
          userId: null,
          ocppEnergyKwh: "30.0000",
        },
      };
      const db = makeFakeDb(state);

      await syncZaptecSessions(db, { accessToken: "stub" });

      expect(state.sessionLedger[0].enrichmentStatus).toBe("complete");
    });
  });
});

// ── Ledger note 22, at ingest ────────────────────────────────────────────
//
// `const energyKwh = z.Energy ?? 0` stood at line 235. A CDR with no `Energy`
// field was priced at zero and, on a Zaptec-native installation where no OCPP
// row exists to compare against, marked `complete`: a free session with a
// clean bill of health, invisible to the enrichment view that exists to catch
// exactly this.
//
// A missing reading is not zero energy. It is no reading.

function historyWithEnergy(energy: unknown): unknown {
  const cdr: Record<string, unknown> = {
    Id: "z-session-1",
    ChargerId: Z_CHARGER,
    StartDateTime: "2026-04-15T12:00:00Z",
    EndDateTime: "2026-04-15T13:00:00Z",
    UserUserName: "andri",
  };
  if (energy !== "__omit__") cdr.Energy = energy;
  return { ok: true, value: [cdr] };
}

function emptyState(): State {
  return {
    importedCdrRefs: [],
    chargeSessions: [],
    sessionLedger: [],
    idTokens: [],
    memberships: [],
  };
}

describe("a CDR with no Energy is SKIPPED, never priced at zero", () => {
  beforeEach(() => {
    vi.mocked(listZaptecChargeHistory).mockReset();
  });

  it("skips when the field is absent entirely", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(historyWithEnergy("__omit__") as never);
    const state = emptyState();
    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });

    expect(report.skipped).toEqual([{ zaptecId: "z-session-1", reason: "no_energy_in_cdr" }]);
    expect(report.imported).toEqual([]);
    // The proof that matters: NO row was written. A zero-priced session is
    // invisible forever; a skipped one is in the report and re-importable the
    // moment the vendor supplies the figure.
    expect(state.chargeSessions).toEqual([]);
    expect(state.sessionLedger).toEqual([]);
    expect(state.importedCdrRefs).toEqual([]);
  });

  it("skips when the field is null", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(historyWithEnergy(null) as never);
    const state = emptyState();
    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });
    expect(report.skipped[0]?.reason).toBe("no_energy_in_cdr");
    expect(state.sessionLedger).toEqual([]);
  });

  it("skips a NaN reading rather than pricing one", async () => {
    // `Number.isFinite` catches what `?? 0` never could: a field that is
    // present, non-null, and not a number.
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(historyWithEnergy(Number.NaN) as never);
    const state = emptyState();
    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });
    expect(report.skipped[0]?.reason).toBe("no_energy_in_cdr");
    expect(state.sessionLedger).toEqual([]);
  });

  it("a MEASURED zero is imported — it is a real reading", async () => {
    // The distinction the whole fix rests on. A session that genuinely
    // delivered nothing — a plug-in that never drew — is a fact, and refusing
    // it would be the same error in the other direction.
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(historyWithEnergy(0) as never);
    const state = emptyState();
    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });
    expect(report.skipped).toEqual([]);
    expect(report.imported).toHaveLength(1);
    expect(state.sessionLedger).toHaveLength(1);
  });

  it("a real reading is imported unchanged", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue(historyWithEnergy(30) as never);
    const state = emptyState();
    const report = await syncZaptecSessions(makeFakeDb(state), { accessToken: "stub" });
    expect(report.skipped).toEqual([]);
    expect(report.imported).toHaveLength(1);
  });
});
