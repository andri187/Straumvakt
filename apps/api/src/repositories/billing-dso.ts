// DSO cost-factor catalogue — read-side repository for /billing/dso.
// Sprint 9 Track A.
//
// "DSO factors" in billing.cost_factors are those with anchorTier = "site"
// (per ADR 0008: one site → one DSO). Codes follow the convention DSOF,
// DSOF_VEITUR, DSOF_OR, etc. — the anchor tier is the canonical discriminator
// since the schema has no separate `kind` column on cost_factors.
//
// For each factor we return:
//   - Factor metadata (code, displayName, anchorTier, status, defaultVatRatePct)
//   - Per-org usage: which TariffDefinitions reference this factor, grouped by org
//   - Orphan flag: factor exists but no TariffDefinition references it
//
// The cross-reference against the reference catalogue is performed in the
// route handler (not here) so the repository stays pure-DB.

import type { PrismaClient } from "../generated/prisma/client";

export interface DsoCostFactor {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  anchorTier: string;
  defaultVatRatePct: string;
  defaultCurrency: string;
  status: string;
  tariffCount: number;
  isOrphan: boolean;
  tariffsByOrg: DsoCostFactorOrgEntry[];
}

export interface DsoCostFactorOrgEntry {
  orgId: string;
  orgDisplayName: string;
  tariffs: DsoCostFactorTariffRef[];
}

export interface DsoCostFactorTariffRef {
  id: string;
  displayName: string;
  status: string;
  currency: string;
  validFrom: string;
  validUntil: string | null;
  computeRuleKind: string | null;
  pricePerKwhMinor: string | null;
}

export interface DsoCatalogueSummary {
  totalFactors: number;
  totalTariffs: number;
  orphanFactors: number;
  factors: DsoCostFactor[];
}

/**
 * Returns all cost factors with anchorTier = "site" (DSO-level factors)
 * with their per-org TariffDefinition usage.
 */
export async function getDsoCostFactors(db: PrismaClient): Promise<DsoCatalogueSummary> {
  // Fetch all site-anchored cost factors with their tariff definitions
  const factors = await db.costFactor.findMany({
    where: { anchorTier: "site" },
    include: {
      tariffDefinitions: {
        include: {
          organization: { select: { id: true, displayName: true } },
        },
        orderBy: [{ orgId: "asc" }, { displayName: "asc" }],
      },
    },
    orderBy: { code: "asc" },
  });

  const result: DsoCostFactor[] = factors.map((f) => {
    const tariffCount = f.tariffDefinitions.length;

    // Group tariff definitions by org
    const byOrg = new Map<string, { orgDisplayName: string; tariffs: DsoCostFactorTariffRef[] }>();
    for (const td of f.tariffDefinitions) {
      const orgId = td.organization.id;
      if (!byOrg.has(orgId)) {
        byOrg.set(orgId, {
          orgDisplayName: td.organization.displayName,
          tariffs: [],
        });
      }
      const rule = td.computeRule as Record<string, unknown> | null ?? {};
      byOrg.get(orgId)!.tariffs.push({
        id: td.id,
        displayName: td.displayName,
        status: td.status,
        currency: td.currency,
        validFrom: td.validFrom.toISOString(),
        validUntil: td.validUntil?.toISOString() ?? null,
        computeRuleKind: typeof rule.kind === "string" ? rule.kind : null,
        pricePerKwhMinor:
          rule.pricePerKwhMinor !== undefined ? String(rule.pricePerKwhMinor) : null,
      });
    }

    const tariffsByOrg: DsoCostFactorOrgEntry[] = Array.from(byOrg.entries())
      .sort((a, b) => a[1].orgDisplayName.localeCompare(b[1].orgDisplayName, "is"))
      .map(([orgId, v]) => ({
        orgId,
        orgDisplayName: v.orgDisplayName,
        tariffs: v.tariffs,
      }));

    return {
      id: f.id,
      code: f.code,
      displayName: f.displayName,
      description: f.description ?? null,
      anchorTier: f.anchorTier,
      defaultVatRatePct: f.defaultVatRatePct.toString(),
      defaultCurrency: f.defaultCurrency,
      status: f.status,
      tariffCount,
      isOrphan: tariffCount === 0,
      tariffsByOrg,
    };
  });

  const totalTariffs = result.reduce((sum, f) => sum + f.tariffCount, 0);
  const orphanFactors = result.filter((f) => f.isOrphan).length;

  return {
    totalFactors: result.length,
    totalTariffs,
    orphanFactors,
    factors: result,
  };
}
