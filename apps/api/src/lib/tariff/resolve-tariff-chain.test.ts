// Sprint 8.3 — tariff-chain resolver tests. Hand-rolled fake
// PrismaClient mirroring only the methods this resolver touches:
// site.findUnique, chargingStation.findUnique, installation.findUnique,
// tariffDefinition.findUnique. Each error class has its own case.

import { describe, expect, it } from "vitest";
import {
  parseComputeRule,
  resolveTariffChainForSession,
  TariffResolutionError,
} from "./resolve-tariff-chain";
import type { PrismaClient } from "../../generated/prisma/client";

interface SiteRow {
  id: string;
  dsoTariffId: string | null;
}
interface StationRow {
  siteAssetId: string;
  installationId: string | null;
}
interface InstallationRow {
  id: string;
  retailerTariffId: string | null;
}
interface TariffDefRow {
  id: string;
  displayName: string;
  computeRule: unknown;
  vatRatePct: number;
  currency: string;
  status: string;
}

function makeFake(rows: {
  sites?: SiteRow[];
  stations?: StationRow[];
  installations?: InstallationRow[];
  tariffs?: TariffDefRow[];
}) {
  const sites = rows.sites ?? [];
  const stations = rows.stations ?? [];
  const installations = rows.installations ?? [];
  const tariffs = rows.tariffs ?? [];
  const db = {
    site: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) =>
        sites.find((s) => s.id === where.id) ?? null,
    },
    chargingStation: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) =>
        stations.find((s) => s.siteAssetId === where.siteAssetId) ?? null,
    },
    installation: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) =>
        installations.find((i) => i.id === where.id) ?? null,
    },
    tariffDefinition: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) =>
        tariffs.find((t) => t.id === where.id) ?? null,
    },
  };
  return db as unknown as PrismaClient;
}

const VEITUR_AD1: TariffDefRow = {
  id: "tariff-veitur-ad1",
  displayName: "Veitur AD1",
  computeRule: { kind: "flat", pricePerKwhMinor: 864 },
  vatRatePct: 24,
  currency: "ISK",
  status: "active",
};

const N1_RETAILER: TariffDefRow = {
  id: "tariff-n1-retailer",
  displayName: "N1 N1_RAFMAGN-REPF-01",
  computeRule: { kind: "flat", pricePerKwhMinor: 883 },
  vatRatePct: 24,
  currency: "ISK",
  status: "active",
};

const SITE: SiteRow = { id: "site-1", dsoTariffId: VEITUR_AD1.id };
const INSTALLATION: InstallationRow = {
  id: "inst-1",
  retailerTariffId: N1_RETAILER.id,
};
const STATION: StationRow = {
  siteAssetId: "stn-1",
  installationId: INSTALLATION.id,
};

describe("resolveTariffChainForSession", () => {
  it("happy path — Veitur AD1 (site DSO) + N1 retailer (installation) → 2-component chain", async () => {
    const db = makeFake({
      sites: [SITE],
      stations: [STATION],
      installations: [INSTALLATION],
      tariffs: [VEITUR_AD1, N1_RETAILER],
    });
    const chain = await resolveTariffChainForSession(db, {
      siteId: "site-1",
      chargingStationId: "stn-1",
    });
    expect(chain.currency).toBe("ISK");
    expect(chain.components).toHaveLength(2);
    expect(chain.components[0]).toEqual({
      kind: "dso",
      code: "Veitur AD1",
      displayName: "Veitur AD1",
      pricePerKwhMinor: 864n,
      vatRatePct: 24,
    });
    expect(chain.components[1]).toEqual({
      kind: "retailer",
      code: "N1 N1_RAFMAGN-REPF-01",
      displayName: "N1 N1_RAFMAGN-REPF-01",
      pricePerKwhMinor: 883n,
      vatRatePct: 24,
    });
  });

  it("missing site → session_site_not_found", async () => {
    const db = makeFake({});
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "missing",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({
      name: "TariffResolutionError",
      code: "session_site_not_found",
    });
  });

  it("site without dsoTariffId → dso_tariff_unconfigured", async () => {
    const db = makeFake({
      sites: [{ id: "site-1", dsoTariffId: null }],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "dso_tariff_unconfigured" });
  });

  it("dsoTariffId points to non-existent row → tariff_definition_missing", async () => {
    const db = makeFake({
      sites: [{ id: "site-1", dsoTariffId: "tariff-ghost" }],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "tariff_definition_missing" });
  });

  it("inactive tariff → tariff_definition_inactive", async () => {
    const db = makeFake({
      sites: [SITE],
      tariffs: [{ ...VEITUR_AD1, status: "archived" }],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "tariff_definition_inactive" });
  });

  it("unsupported computeRule kind → compute_rule_unsupported", async () => {
    const db = makeFake({
      sites: [SITE],
      stations: [STATION],
      installations: [INSTALLATION],
      tariffs: [
        { ...VEITUR_AD1, computeRule: { kind: "tou", windows: [] } },
        N1_RETAILER,
      ],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "compute_rule_unsupported" });
  });

  it("malformed computeRule → compute_rule_malformed", async () => {
    const db = makeFake({
      sites: [SITE],
      stations: [STATION],
      installations: [INSTALLATION],
      tariffs: [
        { ...VEITUR_AD1, computeRule: { kind: "flat" /* missing price */ } },
        N1_RETAILER,
      ],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "compute_rule_malformed" });
  });

  it("missing chargingStation → session_installation_not_found", async () => {
    const db = makeFake({
      sites: [SITE],
      tariffs: [VEITUR_AD1],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "missing-stn",
      }),
    ).rejects.toMatchObject({ code: "session_installation_not_found" });
  });

  it("station with no installation → session_installation_not_found", async () => {
    const db = makeFake({
      sites: [SITE],
      stations: [{ siteAssetId: "stn-1", installationId: null }],
      tariffs: [VEITUR_AD1],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "session_installation_not_found" });
  });

  it("installation without retailerTariffId → retailer_tariff_unconfigured", async () => {
    const db = makeFake({
      sites: [SITE],
      stations: [STATION],
      installations: [{ id: "inst-1", retailerTariffId: null }],
      tariffs: [VEITUR_AD1],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "retailer_tariff_unconfigured" });
  });

  it("DSO/retailer VAT mismatch → vat_rate_mismatch", async () => {
    const db = makeFake({
      sites: [SITE],
      stations: [STATION],
      installations: [INSTALLATION],
      tariffs: [VEITUR_AD1, { ...N1_RETAILER, vatRatePct: 11 }],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "vat_rate_mismatch" });
  });

  it("non-ISK currency → vat_rate_mismatch", async () => {
    const db = makeFake({
      sites: [SITE],
      stations: [STATION],
      installations: [INSTALLATION],
      tariffs: [
        { ...VEITUR_AD1, currency: "EUR" },
        { ...N1_RETAILER, currency: "EUR" },
      ],
    });
    await expect(
      resolveTariffChainForSession(db, {
        siteId: "site-1",
        chargingStationId: "stn-1",
      }),
    ).rejects.toMatchObject({ code: "vat_rate_mismatch" });
  });
});

describe("parseComputeRule", () => {
  it("accepts numeric pricePerKwhMinor", () => {
    expect(
      parseComputeRule({ kind: "flat", pricePerKwhMinor: 864 }),
    ).toEqual({ kind: "flat", pricePerKwhMinor: 864n });
  });

  it("accepts string pricePerKwhMinor (large numbers)", () => {
    expect(
      parseComputeRule({ kind: "flat", pricePerKwhMinor: "1000000" }),
    ).toEqual({ kind: "flat", pricePerKwhMinor: 1_000_000n });
  });

  it("rejects negative price", () => {
    expect(() =>
      parseComputeRule({ kind: "flat", pricePerKwhMinor: -100 }),
    ).toThrow(TariffResolutionError);
  });

  it("rejects unknown kind", () => {
    expect(() => parseComputeRule({ kind: "tou", windows: [] })).toThrow(
      TariffResolutionError,
    );
    try {
      parseComputeRule({ kind: "tou", windows: [] });
    } catch (e) {
      expect((e as TariffResolutionError).code).toBe("compute_rule_unsupported");
    }
  });

  it("rejects null/undefined input", () => {
    expect(() => parseComputeRule(null)).toThrow(TariffResolutionError);
    expect(() => parseComputeRule(undefined)).toThrow(TariffResolutionError);
  });
});
