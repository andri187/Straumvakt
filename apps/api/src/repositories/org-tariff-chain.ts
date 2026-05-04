// Per-org tariff-chain summary — Sprint 8.10.
//
// Walks every Site and Installation under an organization and resolves
// the bound DSO + retailer tariff for each. Powers the
// /accounts/organizations/[id]/tariff-chain UI tab so an operator can
// answer "what is each site under this org being charged?" in one
// view, instead of opening every Site / Installation edit panel.
//
// Read-only, no side effects. Skips org boundary checks because the
// admin route layer already gates with requirePermission("contract.read").

import type { PrismaClient } from "../generated/prisma/client";

export interface TariffSummary {
  id: string;
  displayName: string;
  pricePerKwhMinor: string | null;
  vatRatePct: number | null;
  status: string;
}

export interface InstallationChainNode {
  installationId: string;
  displayName: string;
  retailerTariff: TariffSummary | null;
  stationCount: number;
}

export interface SiteChainNode {
  siteId: string;
  displayName: string;
  dsoTariff: TariffSummary | null;
  installations: InstallationChainNode[];
}

export interface OrgTariffChainSummary {
  orgId: string;
  sites: SiteChainNode[];
  unconfiguredCount: number;
}

export async function getOrgTariffChainSummary(
  db: PrismaClient,
  orgId: string,
): Promise<OrgTariffChainSummary> {
  const sites = await db.site.findMany({
    where: { orgId },
    select: {
      id: true,
      displayName: true,
      dsoTariffId: true,
    },
    orderBy: { displayName: "asc" },
  });

  const installations = await db.installation.findMany({
    where: { orgId },
    select: {
      id: true,
      siteId: true,
      displayName: true,
      retailerTariffId: true,
    },
    orderBy: { displayName: "asc" },
  });

  // Pull station counts per installation so the operator sees scope.
  const stationGroups = await db.chargingStation.groupBy({
    by: ["installationId"],
    where: {
      orgId,
      installationId: { not: null },
    },
    _count: { siteAssetId: true },
  });
  const stationCountByInstallation = new Map<string, number>();
  for (const g of stationGroups) {
    if (g.installationId) {
      stationCountByInstallation.set(g.installationId, g._count.siteAssetId);
    }
  }

  // Resolve every distinct tariff id we touched in one go.
  const tariffIds = new Set<string>();
  for (const s of sites) if (s.dsoTariffId) tariffIds.add(s.dsoTariffId);
  for (const i of installations)
    if (i.retailerTariffId) tariffIds.add(i.retailerTariffId);

  const tariffById = new Map<string, TariffSummary>();
  if (tariffIds.size > 0) {
    const rows = await db.tariffDefinition.findMany({
      where: { id: { in: [...tariffIds] } },
      select: {
        id: true,
        displayName: true,
        computeRule: true,
        vatRatePct: true,
        status: true,
      },
    });
    for (const r of rows) {
      tariffById.set(r.id, {
        id: r.id,
        displayName: r.displayName,
        pricePerKwhMinor: extractFlatPrice(r.computeRule),
        vatRatePct: r.vatRatePct !== null ? Number(r.vatRatePct) : null,
        status: r.status,
      });
    }
  }

  const installationsBySite = new Map<string, InstallationChainNode[]>();
  for (const i of installations) {
    const node: InstallationChainNode = {
      installationId: i.id,
      displayName: i.displayName,
      retailerTariff: i.retailerTariffId
        ? tariffById.get(i.retailerTariffId) ?? null
        : null,
      stationCount: stationCountByInstallation.get(i.id) ?? 0,
    };
    const list = installationsBySite.get(i.siteId) ?? [];
    list.push(node);
    installationsBySite.set(i.siteId, list);
  }

  let unconfiguredCount = 0;
  const siteNodes: SiteChainNode[] = sites.map((s) => {
    const dsoTariff = s.dsoTariffId ? tariffById.get(s.dsoTariffId) ?? null : null;
    if (!dsoTariff) unconfiguredCount++;
    const insts = installationsBySite.get(s.id) ?? [];
    for (const inst of insts) {
      if (!inst.retailerTariff) unconfiguredCount++;
    }
    return {
      siteId: s.id,
      displayName: s.displayName,
      dsoTariff,
      installations: insts,
    };
  });

  return { orgId, sites: siteNodes, unconfiguredCount };
}

/**
 * Pull the flat-rate price out of a TariffDefinition.computeRule JSONB
 * for display purposes. Returns null on any unsupported / malformed
 * shape — the summary view degrades gracefully and surfaces "unknown
 * rate" instead of throwing.
 */
function extractFlatPrice(rule: unknown): string | null {
  if (!rule || typeof rule !== "object") return null;
  const obj = rule as Record<string, unknown>;
  if (obj.kind !== "flat") return null;
  const v = obj.pricePerKwhMinor;
  if (typeof v === "number" || typeof v === "string" || typeof v === "bigint") {
    try {
      return String(BigInt(v as bigint | number | string));
    } catch {
      return null;
    }
  }
  return null;
}
