// Org-level Contract repository (billing.contracts).
// Distinct from DriverContract (people.driver_contracts).
//
// Sprint 8.13 adds scope-name resolution + getById/update/delete so
// the operator console can render and manage individual contracts.

import type { PrismaClient } from "../generated/prisma/client";
import type {
  ContractScopeType,
  ContractStatus,
  ContractSummary,
  ContractUpdateInput,
} from "@straumvakt/shared/domain/contracts";

interface RawContractRow {
  id: string;
  orgId: string;
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
}

export async function listContractsByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<ContractSummary[]> {
  const rows = await db.contract.findMany({
    where: { orgId },
    orderBy: [{ validFrom: "desc" }],
    include: { organization: { select: { displayName: true } } },
  });
  const scopeNames = await resolveScopeNames(db, rows);
  return rows.map((r) => toSummary(r as RawContractRow, scopeNames.get(r.id) ?? null));
}

/**
 * Platform-wide listing — admin-only surface, every contract across
 * every org. Powers the top-level /billing/contracts page.
 */
export async function listAllContracts(
  db: PrismaClient,
): Promise<ContractSummary[]> {
  const rows = await db.contract.findMany({
    orderBy: [{ validFrom: "desc" }],
    include: { organization: { select: { displayName: true } } },
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
    include: { organization: { select: { displayName: true } } },
  });
  if (!row) return null;
  const scopeNames = await resolveScopeNames(db, [row]);
  return toSummary(row as RawContractRow, scopeNames.get(row.id) ?? null);
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

// ─────────────────────────────────────────────────────────────────────
// Scope-name resolution: collects scopeIds by scopeType and does one
// lookup per type. Today the production-relevant scopes are site +
// installation; org_default has no scopeId. Other scopes (charger,
// circuit, user, …) are not used yet but resolvable when they show up.
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
