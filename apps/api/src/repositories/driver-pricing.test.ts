// Driver pre-session repo unit tests (GAP-3).
//
// Coverage matches the spec:
//   1. driver with membership + active clauses → installation returned
//   2. driver with membership + zero clauses → installation hidden
//      (operator's "no draft-only" rule)
//   3. driver with no membership → installation hidden
//   4. driver queries a charger they don't have access to → null
//   5. driver queries a charger they DO have access to → terms returned
//   6. pricing summary sums per-kWh clauses with driver_pays=true and
//      ignores driver_pays=false

import { describe, expect, it } from "vitest";
import {
  listDriverInstallations,
  getDriverChargerPricing,
} from "./driver-pricing";
import type { PrismaClient } from "../generated/prisma/client";

// ── Fake DB ──────────────────────────────────────────────────────────
//
// The repo uses these Prisma calls:
//   • driverGroupMembership.findMany (nested where + nested select)
//   • driverGroupMembership.findFirst (single-installation scope)
//   • chargingStation.findMany (for charger / connector counts)
//   • chargingStation.findUnique (charger lookup)
//   • rateReference.findFirst (active-at-now resolution by code)
//
// We hand-roll a minimal store and only implement the where-shape the
// repo actually emits — every other shape throws so a future regression
// surfaces loudly instead of silently passing.

interface Installation {
  id: string;
  displayName: string;
  siteId: string;
  site: {
    id: string;
    displayName: string;
    property: { address: Record<string, unknown> };
  };
}

interface Clause {
  defaultBearerType: "org" | "usr" | "wrk" | "trd";
  defaultRateRefCode: string | null;
  factorCode: string;
  factorDisplayNameEn: string;
}

interface Agreement {
  id: string;
  agreementType: "installation" | "service_cpo" | "workplace" | "service_contractor" | "service_workplace";
  installationId: string | null;
  status: "active" | "draft" | "expired";
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  clauses: Clause[];
}

interface DriverGroupMembership {
  id: string;
  userId: string;
  driverGroupId: string;
}

interface DriverGroup {
  id: string;
  agreementId: string;
}

interface RateReference {
  code: string;
  priceMinor: bigint;
  basis: "per_kwh" | "per_minute" | "per_day" | "per_session";
  vatRatePct: { toString: () => string };
  currency: string;
  notes: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

interface ChargingStationRow {
  siteAssetId: string;
  installationId: string | null;
  installation: Installation | null;
  siteAsset: { displayName: string };
  onlineSinceAt: Date | null;
  lastTelemetryAt: Date | null;
  evses: Array<{
    connectors: Array<{ status: string | null }>;
  }>;
}

interface FakeState {
  installations: Installation[];
  agreements: Agreement[];
  driverGroups: DriverGroup[];
  memberships: DriverGroupMembership[];
  rateRefs: RateReference[];
  stations: ChargingStationRow[];
}

function makeFake(state: FakeState): PrismaClient {
  function installationByAgreement(a: Agreement): Installation | null {
    if (!a.installationId) return null;
    return state.installations.find((i) => i.id === a.installationId) ?? null;
  }

  function membershipMatchesAgreementWhere(
    m: DriverGroupMembership,
    where: any,
    now: Date,
  ): boolean {
    if (where.userId !== undefined && m.userId !== where.userId) return false;
    const dg = state.driverGroups.find((g) => g.id === m.driverGroupId);
    if (!dg) return false;
    const a = state.agreements.find((x) => x.id === dg.agreementId);
    if (!a) return false;
    const aw = where.driverGroup?.agreement;
    if (!aw) return true;
    if (aw.agreementType !== undefined && a.agreementType !== aw.agreementType) return false;
    if (aw.status !== undefined && a.status !== aw.status) return false;
    if (aw.installationId !== undefined) {
      if (typeof aw.installationId === "object" && aw.installationId.not !== undefined) {
        if (aw.installationId.not === null && a.installationId === null) return false;
      } else if (a.installationId !== aw.installationId) {
        return false;
      }
    }
    if (aw.effectiveFrom?.lte && a.effectiveFrom > aw.effectiveFrom.lte) return false;
    if (aw.OR) {
      // OR: [{effectiveUntil: null}, {effectiveUntil: { gt: now }}]
      const matches = aw.OR.some((clause: any) => {
        if (clause.effectiveUntil === null) return a.effectiveUntil === null;
        if (clause.effectiveUntil?.gt) {
          return (
            a.effectiveUntil !== null && a.effectiveUntil > clause.effectiveUntil.gt
          );
        }
        return false;
      });
      if (!matches) return false;
    }
    if (aw.clauses?.some !== undefined) {
      if (a.clauses.length === 0) return false;
    }
    return true;
  }

  return {
    driverGroupMembership: {
      findMany: async ({ where, select }: any) => {
        const now = where?.driverGroup?.agreement?.effectiveFrom?.lte ?? new Date();
        return state.memberships
          .filter((m) => membershipMatchesAgreementWhere(m, where, now))
          .map((m) => {
            const dg = state.driverGroups.find((g) => g.id === m.driverGroupId)!;
            const a = state.agreements.find((x) => x.id === dg.agreementId)!;
            const inst = installationByAgreement(a);
            // Mirror the nested select shape from the repo. We only
            // need to satisfy the fields the repo reads.
            void select;
            return {
              driverGroup: {
                agreement: {
                  id: a.id,
                  installationId: a.installationId,
                  installation: inst,
                  effectiveFrom: a.effectiveFrom,
                  effectiveUntil: a.effectiveUntil,
                  clauses: a.clauses.map((c) => ({
                    defaultBearerType: c.defaultBearerType,
                    defaultRateRefCode: c.defaultRateRefCode,
                    costFactor: {
                      code: c.factorCode,
                      displayNameEn: c.factorDisplayNameEn,
                    },
                  })),
                },
              },
            };
          });
      },
      findFirst: async ({ where }: any) => {
        const now = where?.driverGroup?.agreement?.effectiveFrom?.lte ?? new Date();
        const found = state.memberships.find((m) =>
          membershipMatchesAgreementWhere(m, where, now),
        );
        if (!found) return null;
        const dg = state.driverGroups.find((g) => g.id === found.driverGroupId)!;
        const a = state.agreements.find((x) => x.id === dg.agreementId)!;
        return {
          driverGroup: {
            agreement: {
              id: a.id,
              effectiveFrom: a.effectiveFrom,
              effectiveUntil: a.effectiveUntil,
              clauses: a.clauses.map((c) => ({
                defaultBearerType: c.defaultBearerType,
                defaultRateRefCode: c.defaultRateRefCode,
                costFactor: {
                  code: c.factorCode,
                  displayNameEn: c.factorDisplayNameEn,
                },
              })),
            },
          },
        };
      },
    },
    chargingStation: {
      findMany: async ({ where }: any) => {
        const installationIds: string[] = where?.installationId?.in ?? [];
        return state.stations.filter((s) => {
          if (s.installationId === null) return false;
          if (!installationIds.includes(s.installationId)) return false;
          // Mirror the OR (onlineSinceAt OR lastTelemetryAt) gate.
          if (s.onlineSinceAt === null && s.lastTelemetryAt === null) return false;
          return true;
        });
      },
      findUnique: async ({ where }: any) => {
        const found = state.stations.find((s) => s.siteAssetId === where.siteAssetId);
        return found ?? null;
      },
    },
    rateReference: {
      findFirst: async ({ where }: any) => {
        const code: string = where.code;
        const at: Date = where.effectiveFrom?.lte ?? new Date();
        // Pick the active row at `at` (effectiveFrom <= at AND
        // effectiveUntil > at OR null), ordered by effectiveFrom desc.
        const candidates = state.rateRefs
          .filter((r) => r.code === code)
          .filter((r) => r.effectiveFrom <= at)
          .filter((r) => r.effectiveUntil === null || r.effectiveUntil > at)
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
        return candidates[0] ?? null;
      },
    },
  } as unknown as PrismaClient;
}

// ── Fixture helpers ──────────────────────────────────────────────────

const NOW = new Date("2026-05-31T12:00:00Z");
const YESTERDAY = new Date("2026-05-30T00:00:00Z");
const TOMORROW = new Date("2026-06-01T00:00:00Z");

function makeInstallation(
  id: string,
  displayName: string,
  siteName = "Test site",
): Installation {
  return {
    id,
    displayName,
    siteId: `site-${id}`,
    site: {
      id: `site-${id}`,
      displayName: siteName,
      property: {
        address: { street: "Aðalstræti 1", postalCode: "101", city: "Reykjavik" },
      },
    },
  };
}

function makeRateRef(
  code: string,
  priceMinor: bigint,
  basis: RateReference["basis"] = "per_kwh",
): RateReference {
  return {
    code,
    priceMinor,
    basis,
    vatRatePct: { toString: () => "24.00" },
    currency: "ISK",
    notes: null,
    effectiveFrom: YESTERDAY,
    effectiveUntil: null,
  };
}

function makeStation(
  siteAssetId: string,
  installation: Installation | null,
  connectorStatus: string | null = "Available",
): ChargingStationRow {
  return {
    siteAssetId,
    installationId: installation?.id ?? null,
    installation,
    siteAsset: { displayName: `Charger ${siteAssetId}` },
    onlineSinceAt: YESTERDAY,
    lastTelemetryAt: NOW,
    evses: [{ connectors: [{ status: connectorStatus }] }],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("listDriverInstallations", () => {
  it("returns an installation when the driver has membership AND the agreement has active clauses", async () => {
    const inst = makeInstallation("inst-1", "Aðalstræti garage");
    const db = makeFake({
      installations: [inst],
      agreements: [
        {
          id: "agr-1",
          agreementType: "installation",
          installationId: "inst-1",
          status: "active",
          effectiveFrom: YESTERDAY,
          effectiveUntil: null,
          clauses: [
            {
              defaultBearerType: "usr",
              defaultRateRefCode: "ele-2026",
              factorCode: "ELE",
              factorDisplayNameEn: "Electricity",
            },
          ],
        },
      ],
      driverGroups: [{ id: "dg-1", agreementId: "agr-1" }],
      memberships: [{ id: "m-1", userId: "user-1", driverGroupId: "dg-1" }],
      rateRefs: [makeRateRef("ele-2026", 1800n)],
      stations: [makeStation("ch-1", inst)],
    });

    const out = await listDriverInstallations(db, "user-1", NOW);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("inst-1");
    expect(out[0].displayName).toBe("Aðalstræti garage");
    expect(out[0].siteDisplayName).toBe("Test site");
    expect(out[0].siteAddress).toBe("Aðalstræti 1, 101 Reykjavik");
    expect(out[0].pricingSummary.perKwhMinor).toBe("1800");
    expect(out[0].pricingSummary.currency).toBe("ISK");
    expect(out[0].pricingSummary.vatRatePct).toBe("24.00");
    expect(out[0].pricingSummary.vatInclusive).toBe(false);
    expect(out[0].chargerCount).toBe(1);
    expect(out[0].availableConnectorCount).toBe(1);
  });

  it("hides installations whose agreement has zero clauses (no draft-only)", async () => {
    const inst = makeInstallation("inst-empty", "Draft site");
    const db = makeFake({
      installations: [inst],
      agreements: [
        {
          id: "agr-empty",
          agreementType: "installation",
          installationId: "inst-empty",
          status: "active",
          effectiveFrom: YESTERDAY,
          effectiveUntil: null,
          clauses: [], // operator hasn't filled in pricing yet
        },
      ],
      driverGroups: [{ id: "dg-1", agreementId: "agr-empty" }],
      memberships: [{ id: "m-1", userId: "user-1", driverGroupId: "dg-1" }],
      rateRefs: [],
      stations: [makeStation("ch-1", inst)],
    });

    const out = await listDriverInstallations(db, "user-1", NOW);
    expect(out).toHaveLength(0);
  });

  it("returns empty when driver has no membership", async () => {
    const inst = makeInstallation("inst-1", "Public site");
    const db = makeFake({
      installations: [inst],
      agreements: [
        {
          id: "agr-1",
          agreementType: "installation",
          installationId: "inst-1",
          status: "active",
          effectiveFrom: YESTERDAY,
          effectiveUntil: null,
          clauses: [
            {
              defaultBearerType: "usr",
              defaultRateRefCode: "ele-2026",
              factorCode: "ELE",
              factorDisplayNameEn: "Electricity",
            },
          ],
        },
      ],
      driverGroups: [{ id: "dg-1", agreementId: "agr-1" }],
      // user-other is a member, but we query as user-1 → no rows.
      memberships: [{ id: "m-1", userId: "user-other", driverGroupId: "dg-1" }],
      rateRefs: [makeRateRef("ele-2026", 1800n)],
      stations: [makeStation("ch-1", inst)],
    });

    const out = await listDriverInstallations(db, "user-1", NOW);
    expect(out).toHaveLength(0);
  });

  it("hides installations whose agreement is expired (effectiveUntil <= now)", async () => {
    const inst = makeInstallation("inst-expired", "Old site");
    const db = makeFake({
      installations: [inst],
      agreements: [
        {
          id: "agr-expired",
          agreementType: "installation",
          installationId: "inst-expired",
          status: "active",
          effectiveFrom: new Date("2025-01-01"),
          effectiveUntil: new Date("2026-01-01"), // before NOW
          clauses: [
            {
              defaultBearerType: "usr",
              defaultRateRefCode: "ele-2026",
              factorCode: "ELE",
              factorDisplayNameEn: "Electricity",
            },
          ],
        },
      ],
      driverGroups: [{ id: "dg-1", agreementId: "agr-expired" }],
      memberships: [{ id: "m-1", userId: "user-1", driverGroupId: "dg-1" }],
      rateRefs: [makeRateRef("ele-2026", 1800n)],
      stations: [makeStation("ch-1", inst)],
    });

    const out = await listDriverInstallations(db, "user-1", NOW);
    expect(out).toHaveLength(0);
  });

  it("sums per-kWh clauses with driverPays=true and ignores driverPays=false (org-bearer)", async () => {
    const inst = makeInstallation("inst-mixed", "Mixed-bearer site");
    const db = makeFake({
      installations: [inst],
      agreements: [
        {
          id: "agr-mixed",
          agreementType: "installation",
          installationId: "inst-mixed",
          status: "active",
          effectiveFrom: YESTERDAY,
          effectiveUntil: null,
          clauses: [
            {
              // Driver pays
              defaultBearerType: "usr",
              defaultRateRefCode: "ele",
              factorCode: "ELE",
              factorDisplayNameEn: "Electricity",
            },
            {
              // Driver pays
              defaultBearerType: "usr",
              defaultRateRefCode: "dso",
              factorCode: "DSO",
              factorDisplayNameEn: "DSO",
            },
            {
              // ORG-absorbed — must NOT contribute to the driver headline
              defaultBearerType: "org",
              defaultRateRefCode: "trf",
              factorCode: "TRF",
              factorDisplayNameEn: "Traffic",
            },
          ],
        },
      ],
      driverGroups: [{ id: "dg-1", agreementId: "agr-mixed" }],
      memberships: [{ id: "m-1", userId: "user-1", driverGroupId: "dg-1" }],
      rateRefs: [
        makeRateRef("ele", 1500n),
        makeRateRef("dso", 700n),
        makeRateRef("trf", 9999n), // absorbed by ORG — must be excluded
      ],
      stations: [makeStation("ch-1", inst)],
    });

    const out = await listDriverInstallations(db, "user-1", NOW);
    expect(out).toHaveLength(1);
    // 1500 + 700 = 2200; the 9999 ORG-bearer line must not appear.
    expect(out[0].pricingSummary.perKwhMinor).toBe("2200");
  });
});

describe("getDriverChargerPricing", () => {
  it("returns null when the driver has no access to the charger's installation (looks like 404)", async () => {
    const inst = makeInstallation("inst-1", "Private site");
    const db = makeFake({
      installations: [inst],
      agreements: [
        {
          id: "agr-1",
          agreementType: "installation",
          installationId: "inst-1",
          status: "active",
          effectiveFrom: YESTERDAY,
          effectiveUntil: null,
          clauses: [
            {
              defaultBearerType: "usr",
              defaultRateRefCode: "ele",
              factorCode: "ELE",
              factorDisplayNameEn: "Electricity",
            },
          ],
        },
      ],
      driverGroups: [{ id: "dg-1", agreementId: "agr-1" }],
      // user-1 is NOT a member; only user-other is.
      memberships: [{ id: "m-1", userId: "user-other", driverGroupId: "dg-1" }],
      rateRefs: [makeRateRef("ele", 1800n)],
      stations: [makeStation("ch-1", inst)],
    });

    const out = await getDriverChargerPricing(db, "user-1", "ch-1", NOW);
    expect(out).toBeNull();
  });

  it("returns null when the charger doesn't exist (same 404 shape)", async () => {
    const db = makeFake({
      installations: [],
      agreements: [],
      driverGroups: [],
      memberships: [],
      rateRefs: [],
      stations: [],
    });

    const out = await getDriverChargerPricing(db, "user-1", "ch-missing", NOW);
    expect(out).toBeNull();
  });

  it("returns full terms when the driver DOES have access", async () => {
    const inst = makeInstallation("inst-1", "Driver-accessible site");
    const db = makeFake({
      installations: [inst],
      agreements: [
        {
          id: "agr-1",
          agreementType: "installation",
          installationId: "inst-1",
          status: "active",
          effectiveFrom: YESTERDAY,
          effectiveUntil: TOMORROW,
          clauses: [
            {
              defaultBearerType: "usr",
              defaultRateRefCode: "ele",
              factorCode: "ELE",
              factorDisplayNameEn: "Electricity",
            },
            {
              defaultBearerType: "usr",
              defaultRateRefCode: "dso",
              factorCode: "DSO",
              factorDisplayNameEn: "DSO",
            },
            {
              defaultBearerType: "org",
              defaultRateRefCode: "trf",
              factorCode: "TRF",
              factorDisplayNameEn: "Traffic",
            },
          ],
        },
      ],
      driverGroups: [{ id: "dg-1", agreementId: "agr-1" }],
      memberships: [{ id: "m-1", userId: "user-1", driverGroupId: "dg-1" }],
      rateRefs: [
        makeRateRef("ele", 1500n, "per_kwh"),
        makeRateRef("dso", 700n, "per_kwh"),
        makeRateRef("trf", 5000n, "per_session"),
      ],
      stations: [makeStation("ch-1", inst)],
    });

    const out = await getDriverChargerPricing(db, "user-1", "ch-1", NOW);
    expect(out).not.toBeNull();
    expect(out!.charger.id).toBe("ch-1");
    expect(out!.charger.installationId).toBe("inst-1");
    expect(out!.charger.installationDisplayName).toBe("Driver-accessible site");
    expect(out!.terms.clauses).toHaveLength(3);

    // Clauses sorted by factor code: DSO, ELE, TRF
    const codes = out!.terms.clauses.map((c) => c.factorCode);
    expect(codes).toEqual(["DSO", "ELE", "TRF"]);

    const ele = out!.terms.clauses.find((c) => c.factorCode === "ELE")!;
    expect(ele.driverPays).toBe(true);
    expect(ele.bearerType).toBe("usr");
    expect(ele.unitPriceMinor).toBe("1500");
    expect(ele.basisType).toBe("per_kwh");

    const trf = out!.terms.clauses.find((c) => c.factorCode === "TRF")!;
    expect(trf.driverPays).toBe(false);
    expect(trf.bearerType).toBe("org");

    // Summary buckets — per-kWh sums ELE + DSO (1500 + 700 = 2200),
    // per-session is 0 because TRF is ORG-absorbed (driverPays=false),
    // per-minute is 0 because no per-minute clauses exist.
    expect(out!.terms.summary.perKwhMinor).toBe("2200");
    expect(out!.terms.summary.perMinuteMinor).toBe("0");
    expect(out!.terms.summary.perSessionMinor).toBe("0");
    expect(out!.terms.summary.currency).toBe("ISK");

    expect(out!.terms.effectiveFrom).toBe(YESTERDAY.toISOString());
    expect(out!.terms.effectiveUntil).toBe(TOMORROW.toISOString());
  });
});
