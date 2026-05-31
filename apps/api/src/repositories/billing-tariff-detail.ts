// Tariff detail — read-side repository for /billing/tariffs/[id].
// Sprint 9 Track A.
//
// Returns:
//   - The TariffDefinition header (org, costFactor, compute rule, etc.)
//   - "Used by" counts and rows for Sites (dsoTariffId), Installations
//     (retailerTariffId), ChargingStations (chrgrfTariffId)
//   - Recent ledger entries that resolved through this tariff (last 30 days,
//     top 20)
//
// All BigInt fields are serialised to string before leaving this module so
// JSON.stringify() doesn't throw. Callers receive plain objects.

import type { PrismaClient } from "../generated/prisma/client";

export interface TariffDetailHeader {
  id: string;
  orgId: string;
  orgDisplayName: string;
  displayName: string;
  currency: string;
  vatRatePct: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
  computeRule: Record<string, unknown>;
  computeRuleKind: string | null;
  pricePerKwhMinor: string | null;
  costFactorId: string;
  costFactorCode: string;
  costFactorDisplayName: string;
  costFactorAnchorTier: string;
  costFactorStatus: string;
}

export interface TariffUsedBySite {
  siteId: string;
  displayName: string;
  orgId: string;
  orgDisplayName: string;
  role: "dso";
}

export interface TariffUsedByInstallation {
  installationId: string;
  displayName: string;
  siteId: string;
  siteDisplayName: string;
  orgId: string;
  orgDisplayName: string;
  role: "retailer";
}

export interface TariffUsedByStation {
  stationId: string;
  displayName: string;
  orgId: string;
  orgDisplayName: string;
  role: "chrgrf";
}

export interface TariffRecentLedgerEntry {
  sessionId: string;
  orgId: string;
  orgDisplayName: string | null;
  siteId: string | null;
  siteDisplayName: string | null;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  startedAt: string;
  stoppedAt: string | null;
  energyKwh: string;
  costIskMinor: string | null;
}

export interface TariffDetailResult {
  tariff: TariffDetailHeader | null;
  usedBySites: TariffUsedBySite[];
  usedByInstallations: TariffUsedByInstallation[];
  usedByStations: TariffUsedByStation[];
  isOrphan: boolean;
  recentLedger: TariffRecentLedgerEntry[];
}

/**
 * Full read-side detail for a single TariffDefinition by id.
 * Returns null-filled result when the tariff doesn't exist.
 */
export async function getTariffDetail(
  db: PrismaClient,
  tariffId: string,
): Promise<TariffDetailResult> {
  const tariff = await db.tariffDefinition.findUnique({
    where: { id: tariffId },
    include: {
      organization: { select: { id: true, displayName: true } },
      costFactor: {
        select: {
          id: true,
          code: true,
          displayName: true,
          anchorTier: true,
          status: true,
        },
      },
    },
  });

  if (!tariff) {
    return {
      tariff: null,
      usedBySites: [],
      usedByInstallations: [],
      usedByStations: [],
      isOrphan: true,
      recentLedger: [],
    };
  }

  const rule = tariff.computeRule as Record<string, unknown> | null ?? {};
  const header: TariffDetailHeader = {
    id: tariff.id,
    orgId: tariff.orgId,
    orgDisplayName: tariff.organization.displayName,
    displayName: tariff.displayName,
    currency: tariff.currency,
    vatRatePct: tariff.vatRatePct.toString(),
    status: tariff.status,
    validFrom: tariff.validFrom.toISOString(),
    validUntil: tariff.validUntil?.toISOString() ?? null,
    computeRule: rule,
    computeRuleKind: typeof rule.kind === "string" ? rule.kind : null,
    pricePerKwhMinor:
      rule.pricePerKwhMinor !== undefined ? String(rule.pricePerKwhMinor) : null,
    costFactorId: tariff.costFactor.id,
    costFactorCode: tariff.costFactor.code,
    costFactorDisplayName: tariff.costFactor.displayName,
    costFactorAnchorTier: tariff.costFactor.anchorTier,
    costFactorStatus: tariff.costFactor.status,
  };

  // Fetch "used by" entities in parallel
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [sitesRaw, installationsRaw, stationsRaw, ledgerRaw] = await Promise.all([
    db.site.findMany({
      where: { dsoTariffId: tariffId },
      select: {
        id: true,
        displayName: true,
        orgId: true,
        organization: { select: { displayName: true } },
      },
      orderBy: { displayName: "asc" },
    }),
    db.installation.findMany({
      where: { retailerTariffId: tariffId },
      select: {
        id: true,
        displayName: true,
        siteId: true,
        orgId: true,
        organization: { select: { displayName: true } },
        site: { select: { displayName: true } },
      },
      orderBy: { displayName: "asc" },
    }),
    db.chargingStation.findMany({
      where: { chrgrfTariffId: tariffId },
      select: {
        siteAssetId: true,
        orgId: true,
        siteAsset: { select: { displayName: true } },
        ownerOrg: { select: { displayName: true } },
      },
      orderBy: { siteAsset: { displayName: "asc" } },
    }),
    db.sessionLedger.findMany({
      where: {
        tariffDefinitionId: tariffId,
        startedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        sessionId: true,
        orgId: true,
        siteId: true,
        chargingStationId: true,
        startedAt: true,
        stoppedAt: true,
        energyKwh: true,
        costIskMinor: true,
      },
    }),
  ]);

  // Enrich ledger rows with display names
  const ledgerOrgIds = Array.from(new Set(ledgerRaw.map((r) => r.orgId)));
  const ledgerSiteIds = Array.from(
    new Set(ledgerRaw.map((r) => r.siteId).filter((v): v is string => Boolean(v))),
  );
  const ledgerStationIds = Array.from(
    new Set(
      ledgerRaw.map((r) => r.chargingStationId).filter((v): v is string => Boolean(v)),
    ),
  );

  const [ledgerOrgs, ledgerSites, ledgerAssets] = await Promise.all([
    ledgerOrgIds.length > 0
      ? db.organization.findMany({
          where: { id: { in: ledgerOrgIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
    ledgerSiteIds.length > 0
      ? db.site.findMany({
          where: { id: { in: ledgerSiteIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
    ledgerStationIds.length > 0
      ? db.siteAsset.findMany({
          where: { id: { in: ledgerStationIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
  ]);

  const orgNameById = new Map(ledgerOrgs.map((o) => [o.id, o.displayName]));
  const siteNameById = new Map(ledgerSites.map((s) => [s.id, s.displayName]));
  const assetNameById = new Map(ledgerAssets.map((a) => [a.id, a.displayName]));

  const usedBySites: TariffUsedBySite[] = sitesRaw.map((s) => ({
    siteId: s.id,
    displayName: s.displayName,
    orgId: s.orgId,
    orgDisplayName: s.organization.displayName,
    role: "dso",
  }));

  const usedByInstallations: TariffUsedByInstallation[] = installationsRaw.map((i) => ({
    installationId: i.id,
    displayName: i.displayName,
    siteId: i.siteId,
    siteDisplayName: i.site.displayName,
    orgId: i.orgId,
    orgDisplayName: i.organization.displayName,
    role: "retailer",
  }));

  const usedByStations: TariffUsedByStation[] = stationsRaw.map((cs) => ({
    stationId: cs.siteAssetId,
    displayName: cs.siteAsset.displayName,
    orgId: cs.orgId,
    orgDisplayName: cs.ownerOrg?.displayName ?? cs.orgId,
    role: "chrgrf",
  }));

  const recentLedger: TariffRecentLedgerEntry[] = ledgerRaw.map((r) => ({
    sessionId: r.sessionId,
    orgId: r.orgId,
    orgDisplayName: orgNameById.get(r.orgId) ?? null,
    siteId: r.siteId,
    siteDisplayName: r.siteId ? siteNameById.get(r.siteId) ?? null : null,
    chargingStationId: r.chargingStationId,
    chargerDisplayName: r.chargingStationId
      ? assetNameById.get(r.chargingStationId) ?? null
      : null,
    startedAt: r.startedAt.toISOString(),
    stoppedAt: r.stoppedAt?.toISOString() ?? null,
    energyKwh: r.energyKwh.toString(),
    costIskMinor: r.costIskMinor?.toString() ?? null,
  }));

  const isOrphan =
    usedBySites.length === 0 &&
    usedByInstallations.length === 0 &&
    usedByStations.length === 0;

  return {
    tariff: header,
    usedBySites,
    usedByInstallations,
    usedByStations,
    isOrphan,
    recentLedger,
  };
}
