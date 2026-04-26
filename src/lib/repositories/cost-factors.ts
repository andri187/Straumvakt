import { prisma } from "@/lib/prisma";

export interface CostFactorSummary {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  anchorTier: string;
  defaultVatRatePct: string;
  defaultCurrency: string;
  status: string;
}

export async function listCostFactors(): Promise<CostFactorSummary[]> {
  const db = prisma();
  const rows = await db.costFactor.findMany({ orderBy: [{ anchorTier: "asc" }, { code: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    displayName: r.displayName,
    description: r.description,
    anchorTier: r.anchorTier,
    defaultVatRatePct: r.defaultVatRatePct.toString(),
    defaultCurrency: r.defaultCurrency,
    status: r.status,
  }));
}
