// Org-level Contract repository (billing.contracts).
// Distinct from DriverContract (people.driver_contracts).
//
// Sprint 8.14 — bilateral counterparty model. A single Contract row
// represents the arrangement between two orgs (orgId = primary owner,
// counterpartyOrgId = the other side). listContractsByOrg returns
// rows where the org is on EITHER side, so each side sees the same
// row from their tab. Per-tariff resolution (getContractTariffs)
// surfaces the bound DSO + retailer rates for the contract's scope.

import type { PrismaClient } from "../generated/prisma/client";
import type {
  ContractScopeType,
  ContractStatus,
  ContractSummary,
  ContractTariffSummary,
  ContractUpdateInput,
} from "@straumvakt/shared/domain/contracts";

interface RawContractRow {
  id: string;
  orgId: string;
  counterpartyOrgId: string | null;
  scopeType: string;
  scopeId: string | null;
  parentContractId: string | null;
  displayName: string;
  status: string;
  validFrom: Date;
  validUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  organization: { displayName: string };
  counterparty: { displayName: string } | null;
}

const includeShape = {
  organization: { select: { displayName: true } },
  counterparty: { select: { displayName: true } },
} as const;

export async function listContractsByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<ContractSummary[]> {
  const rows = await db.contract.findMany({
    where: {
      OR: [{ orgId }, { counterpartyOrgId: orgId }],
    },
    orderBy: [{ validFrom: "desc" }],
    include: includeShape,
  });
  const scopeNames = await resolveScopeNames(db, rows);
  return rows.map((r) => toSummary(r as RawContractRow, scopeNames.get(r.id) ?? null));
}

/**
 * Platform-wide listing — admin-only surface, every contract across
 * every org. Powers the top-level /billing/contracts page. Each row
 * shows once (no duplicate per side) because the row IS one row.
 */
export async function listAllContracts(
  db: PrismaClient,
): Promise<ContractSummary[]> {
  const rows = await db.contract.findMany({
    orderBy: [{ validFrom: "desc" }],
    include: includeShape,
  });
  const scopeNames = await resolveScopeNames(db, rows);
  return rows.map((r) => toSummary(r as RawContractRow, scopeNames.get(r.id) ?? null));
}

export async function getContractById(
  db: PrismaClient,
  contractId: string,
): Promise<ContractSummary | null> {
  const row = await db.contract.findUnique({
    where: { id: contractId },
    include: includeShape,
  });
  if (!row) return null;
  const scopeNames = await resolveScopeNames(db, [row]);
  return toSummary(row as RawContractRow, scopeNames.get(row.id) ?? null);
}

/**
 * Resolve the DSO + retailer rates that apply to this contract's
 * scope. Today supports site-scoped and installation-scoped contracts;
 * other scope types return empty (org_default / charger / circuit).
 */
export async function getContractTariffs(
  db: PrismaClient,
  contractId: string,
): Promise<ContractTariffSummary | null> {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: { id: true, scopeType: true, scopeId: true },
  });
  if (!contract || !contract.scopeId) return { dso: null, retailers: [] };

  if (contract.scopeType === "site") {
    return resolveTariffsForSite(db, contract.scopeId);
  }
  if (contract.scopeType === "installation") {
    const inst = await db.installation.findUnique({
      where: { id: contract.scopeId },
      select: { id: true, siteId: true, displayName: true, retailerTariffId: true },
    });
    if (!inst) return { dso: null, retailers: [] };
    const dso = await resolveDsoForSite(db, inst.siteId);
    const retailer = await resolveRetailerForInstallation(db, inst.id);
    return { dso, retailers: retailer ? [retailer] : [] };
  }
  return { dso: null, retailers: [] };
}

export async function updateContract(
  db: PrismaClient,
  contractId: string,
  patch: ContractUpdateInput,
): Promise<ContractSummary> {
  const data: {
    displayName?: string;
    status?: ContractStatus;
    validFrom?: Date;
    validUntil?: Date | null;
  } = {};
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.validFrom !== undefined) data.validFrom = new Date(patch.validFrom);
  if (patch.validUntil !== undefined) {
    data.validUntil = patch.validUntil === null ? null : new Date(patch.validUntil);
  }
  await db.contract.update({
    where: { id: contractId },
    data,
  });
  const reloaded = await getContractById(db, contractId);
  if (!reloaded) throw new Error("contract_not_found_after_update");
  return reloaded;
}

export async function deleteContract(
  db: PrismaClient,
  contractId: string,
): Promise<void> {
  await db.contract.delete({ where: { id: contractId } });
}

// ─── tariff helpers ──────────────────────────────────────────────────

async function resolveTariffsForSite(
  db: PrismaClient,
  siteId: string,
): Promise<ContractTariffSummary> {
  const dso = await resolveDsoForSite(db, siteId);
  const installations = await db.installation.findMany({
    where: { siteId },
    select: { id: true },
    orderBy: { displayName: "asc" },
  });
  const retailers: ContractTariffSummary["retailers"] = [];
  for (const i of installations) {
    const r = await resolveRetailerForInstallation(db, i.id);
    if (r) retailers.push(r);
  }
  return { dso, retailers };
}

async function resolveDsoForSite(
  db: PrismaClient,
  siteId: string,
): Promise<ContractTariffSummary["dso"]> {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { id: true, displayName: true, dsoTariffId: true },
  });
  if (!site || !site.dsoTariffId) return null;
  const td = await db.tariffDefinition.findUnique({
    where: { id: site.dsoTariffId },
    select: {
      id: true,
      displayName: true,
      computeRule: true,
      vatRatePct: true,
    },
  });
  if (!td) return null;
  return {
    siteId: site.id,
    siteDisplayName: site.displayName,
    tariffId: td.id,
    tariffDisplayName: td.displayName,
    pricePerKwhMinor: extractFlatPrice(td.computeRule),
    vatRatePct: td.vatRatePct !== null ? Number(td.vatRatePct) : null,
  };
}

async function resolveRetailerForInstallation(
  db: PrismaClient,
  installationId: string,
): Promise<ContractTariffSummary["retailers"][number] | null> {
  const inst = await db.installation.findUnique({
    where: { id: installationId },
    select: { id: true, displayName: true, retailerTariffId: true },
  });
  if (!inst) return null;
  if (!inst.retailerTariffId) {
    return {
      installationId: inst.id,
      installationDisplayName: inst.displayName,
      tariffId: null,
      tariffDisplayName: null,
      pricePerKwhMinor: null,
      vatRatePct: null,
    };
  }
  const td = await db.tariffDefinition.findUnique({
    where: { id: inst.retailerTariffId },
    select: {
      id: true,
      displayName: true,
      computeRule: true,
      vatRatePct: true,
    },
  });
  if (!td) {
    return {
      installationId: inst.id,
      installationDisplayName: inst.displayName,
      tariffId: null,
      tariffDisplayName: null,
      pricePerKwhMinor: null,
      vatRatePct: null,
    };
  }
  return {
    installationId: inst.id,
    installationDisplayName: inst.displayName,
    tariffId: td.id,
    tariffDisplayName: td.displayName,
    pricePerKwhMinor: extractFlatPrice(td.computeRule),
    vatRatePct: td.vatRatePct !== null ? Number(td.vatRatePct) : null,
  };
}

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

// ─── scope-name resolution ───────────────────────────────────────────

async function resolveScopeNames(
  db: PrismaClient,
  rows: ReadonlyArray<{ id: string; scopeType: string; scopeId: string | null }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const siteIds: string[] = [];
  const installIds: string[] = [];
  const chargerIds: string[] = [];
  for (const r of rows) {
    if (!r.scopeId) continue;
    if (r.scopeType === "site") siteIds.push(r.scopeId);
    else if (r.scopeType === "installation") installIds.push(r.scopeId);
    else if (r.scopeType === "charger") chargerIds.push(r.scopeId);
  }
  const siteNameById = new Map<string, string>();
  if (siteIds.length > 0) {
    const sites = await db.site.findMany({
      where: { id: { in: siteIds } },
      select: { id: true, displayName: true },
    });
    for (const s of sites) siteNameById.set(s.id, s.displayName);
  }
  const installNameById = new Map<string, string>();
  if (installIds.length > 0) {
    const insts = await db.installation.findMany({
      where: { id: { in: installIds } },
      select: { id: true, displayName: true },
    });
    for (const i of insts) installNameById.set(i.id, i.displayName);
  }
  const chargerNameById = new Map<string, string>();
  if (chargerIds.length > 0) {
    const chargers = await db.chargingStation.findMany({
      where: { siteAssetId: { in: chargerIds } },
      select: { siteAssetId: true, siteAsset: { select: { displayName: true } } },
    });
    for (const c of chargers) {
      if (c.siteAsset) chargerNameById.set(c.siteAssetId, c.siteAsset.displayName);
    }
  }
  for (const r of rows) {
    if (!r.scopeId) continue;
    let name: string | undefined;
    if (r.scopeType === "site") name = siteNameById.get(r.scopeId);
    else if (r.scopeType === "installation") name = installNameById.get(r.scopeId);
    else if (r.scopeType === "charger") name = chargerNameById.get(r.scopeId);
    if (name) out.set(r.id, name);
  }
  return out;
}

function toSummary(
  r: RawContractRow,
  scopeDisplayName: string | null,
): ContractSummary {
  return {
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    counterpartyOrgId: r.counterpartyOrgId,
    counterpartyOrgDisplayName: r.counterparty?.displayName ?? null,
    displayName: r.displayName,
    status: r.status as ContractStatus,
    scopeType: r.scopeType as ContractScopeType,
    scopeId: r.scopeId,
    scopeDisplayName,
    parentContractId: r.parentContractId,
    validFrom: r.validFrom.toISOString(),
    validUntil: r.validUntil ? r.validUntil.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
