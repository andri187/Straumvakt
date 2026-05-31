// Sprint 9 / GAP-1 / Rule 5 — persist.ts resolver determinism tests.
//
// The `findFirst({ agreementType: "installation", ... })` lookup picks
// the installation agreement that owns the session at billing time.
// Without an explicit orderBy two coexisting active rows let PostgreSQL
// pick by heap order — typically the older row — which can silently
// route a session to a stale (possibly 0-clause) agreement.
//
// These tests pin the deterministic resolution contract:
//   - one match → unchanged behavior
//   - two matches, different effectiveFrom → newest wins
//   - two matches, same effectiveFrom → smaller id wins (stable tiebreak)
//   - more than one match → console.warn fires once with the expected
//     payload, observability only, not a behavior change
//
// We mock the PrismaClient minimally: only the fields and methods that
// loadAgreementContext actually touches. Anything past the multi-match
// check is irrelevant to GAP-1 — we drive the function to the membership
// branch and assert the granted-true path with whichever agreement won.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAgreementContext } from "./persist";

// ── Test fixtures ────────────────────────────────────────────────────

const INSTALLATION_ID = "00000000-0000-0000-0000-0000000000a1";
const CHARGER_ID =      "00000000-0000-0000-0000-0000000000b1";
const SITE_ASSET_ID =   "00000000-0000-0000-0000-0000000000c1";
const SITE_ID =         "00000000-0000-0000-0000-0000000000d1";
const CIRCUIT_ID =      "00000000-0000-0000-0000-0000000000e1";
const USER_ID =         "00000000-0000-0000-0000-0000000000f1";
const CPO_ORG_ID =      "00000000-0000-0000-0000-000000000010";
const GROUP_ID =        "00000000-0000-0000-0000-000000000020";

const SESSION_AT = new Date("2026-05-15T08:00:00Z");

type FakeAgreementRow = {
  id: string;
  displayName: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  status: "active";
  agreementType: "installation";
  installationId: string;
  cpoOrgId: string;
  counterpartyOrgId: string;
  clauses: Array<unknown>;
  bearerRules: Array<unknown>;
};

function makeAgreement(id: string, effectiveFrom: Date, displayName = `agreement-${id}`): FakeAgreementRow {
  return {
    id,
    displayName,
    effectiveFrom,
    effectiveUntil: null,
    status: "active",
    agreementType: "installation",
    installationId: INSTALLATION_ID,
    cpoOrgId: CPO_ORG_ID,
    counterpartyOrgId: CPO_ORG_ID,
    clauses: [],
    bearerRules: [],
  };
}

function makePrismaMock(installationRows: FakeAgreementRow[]) {
  // Sort the way the production query would: effectiveFrom desc, id asc.
  // findFirst returns the first row of that ordering; count returns the
  // total. That mirrors what Postgres + the new orderBy do.
  const sorted = [...installationRows].sort((a, b) => {
    const tA = a.effectiveFrom.getTime();
    const tB = b.effectiveFrom.getTime();
    if (tA !== tB) return tB - tA; // desc
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // asc tiebreak
  });

  // Args are loosely typed because vi.fn() infers an empty-tuple parameter
  // signature for a no-arg implementation, which then breaks mock.calls[0]
  // element access. We only need to capture the args object the production
  // code passes in.
  return {
    chargingStation: {
      findUnique: vi.fn(async (_args: unknown) => ({
        siteAssetId: SITE_ASSET_ID,
        orgId: CPO_ORG_ID,
        installationId: INSTALLATION_ID,
        circuitId: CIRCUIT_ID,
        siteAsset: {
          id: SITE_ASSET_ID,
          displayName: "Test charger",
          siteId: SITE_ID,
        },
      })),
    },
    agreement: {
      count: vi.fn(async (_args: { where: unknown }) => installationRows.length),
      findFirst: vi.fn(async (_args: { where: unknown; orderBy: unknown; include: unknown }) => sorted[0] ?? null),
      findMany: vi.fn(async (_args: unknown) => [] as FakeAgreementRow[]), // no workplace agreements
    },
    driverGroupMembership: {
      findFirst: vi.fn(async (_args: unknown) => ({
        driverGroupId: GROUP_ID,
        driverGroup: {
          id: GROUP_ID,
          ownerOrgId: CPO_ORG_ID,
          displayName: "Group",
        },
      })),
    },
    rateReference: {
      findMany: vi.fn(async (_args: unknown) => []),
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("loadAgreementContext — installation agreement resolution (GAP-1)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("one match — picks the single row, no warn", async () => {
    const only = makeAgreement("agr-only", new Date("2026-04-01T00:00:00Z"));
    const prisma = makePrismaMock([only]);

    const result = await loadAgreementContext(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      {
        userId: USER_ID,
        chargingStationId: CHARGER_ID,
        at: SESSION_AT,
        energyKwh: 10,
        durationMinutes: 60,
        durationDays: 0,
      },
    );

    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.meta.installationAgreement?.id).toBe("agr-only");
    }
    expect(warnSpy).not.toHaveBeenCalled();

    // Sanity: the production findFirst is called with orderBy
    // [effectiveFrom desc, id asc].
    const findFirstArgs = prisma.agreement.findFirst.mock.calls[0]?.[0];
    expect(findFirstArgs?.orderBy).toEqual([
      { effectiveFrom: "desc" },
      { id: "asc" },
    ]);
  });

  it("two matches, different effectiveFrom — newer wins", async () => {
    const older = makeAgreement("agr-older", new Date("2026-01-01T00:00:00Z"));
    const newer = makeAgreement("agr-newer", new Date("2026-04-01T00:00:00Z"));
    // Insertion order older-then-newer — the mock sorts internally so the
    // ordering of the input array does not influence the result.
    const prisma = makePrismaMock([older, newer]);

    const result = await loadAgreementContext(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      {
        userId: USER_ID,
        chargingStationId: CHARGER_ID,
        at: SESSION_AT,
        energyKwh: 10,
        durationMinutes: 60,
        durationDays: 0,
      },
    );

    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.meta.installationAgreement?.id).toBe("agr-newer");
    }
  });

  it("two matches, same effectiveFrom — smaller id wins (stable tiebreak)", async () => {
    const same = new Date("2026-04-01T00:00:00Z");
    // Note the input array gives the larger id first to ensure the
    // tiebreak — not the input order — drives the selection.
    const larger = makeAgreement("agr-z", same);
    const smaller = makeAgreement("agr-a", same);
    const prisma = makePrismaMock([larger, smaller]);

    const result = await loadAgreementContext(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      {
        userId: USER_ID,
        chargingStationId: CHARGER_ID,
        at: SESSION_AT,
        energyKwh: 10,
        durationMinutes: 60,
        durationDays: 0,
      },
    );

    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.meta.installationAgreement?.id).toBe("agr-a");
    }
  });

  it("multi-match — console.warn fires once with expected payload", async () => {
    const older = makeAgreement("agr-older", new Date("2026-01-01T00:00:00Z"));
    const newer = makeAgreement("agr-newer", new Date("2026-04-01T00:00:00Z"));
    const prisma = makePrismaMock([older, newer]);

    await loadAgreementContext(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      {
        userId: USER_ID,
        chargingStationId: CHARGER_ID,
        at: SESSION_AT,
        energyKwh: 10,
        durationMinutes: 60,
        durationDays: 0,
      },
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("[agreement-resolver]");
    expect(msg).toContain(`installationId=${INSTALLATION_ID}`);
    expect(msg).toContain(`at=${SESSION_AT.toISOString()}`);
    expect(msg).toContain("count=2");
    expect(msg).toContain("effectiveFrom desc, id asc tiebreak");

    // The warn must not change which row is selected — assert count
    // query was issued with the same predicate as findFirst (no orderBy).
    expect(prisma.agreement.count).toHaveBeenCalledTimes(1);
    const countArgs = prisma.agreement.count.mock.calls[0]?.[0];
    const findFirstArgs = prisma.agreement.findFirst.mock.calls[0]?.[0];
    expect(countArgs?.where).toEqual(findFirstArgs?.where);
  });
});
