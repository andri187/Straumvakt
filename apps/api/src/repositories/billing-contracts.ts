// Repository — agreements-schema Agreement catalogue (Sprint 9 / ADR 0019).
//
// Reads from agreements.agreements + agreements.driver_groups +
// agreements.driver_group_memberships. Returns UI-shaped objects
// (all BigInt fields stringified, all Date fields ISO-stringified).
//
// Per Rule 7: every function takes orgId as its first arg (or null for
// platform-admin scope), returns a typed interface, never exposes Prisma types.

import type { PrismaClient } from "../generated/prisma/client";

// ─── UI types ────────────────────────────────────────────────────────────────

export interface AgreementRow {
  id: string;
  agreementType: string;
  displayName: string;
  status: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** The org this agreement is "for" — counterparty perspective. */
  counterpartyOrgId: string;
  counterpartyOrgName: string;
  /** CPO org (workplace agreements only; null for service_* types). */
  cpoOrgId: string | null;
  cpoOrgName: string | null;
  /** Installation scoped (installation-type agreements). */
  installationId: string | null;
  installationDisplayName: string | null;
  /** DriverGroup names under this agreement. */
  driverGroupNames: string[];
  /** Cost-factor codes listed in clauses. */
  clauseFactorCodes: string[];
  /** Total members across all driver groups. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractsTileData {
  totalAgreements: number;
  activeAgreements: number;
  totalCounterparties: number;
  totalDriversCovered: number;
}

// ─── Repository functions ────────────────────────────────────────────────────

/**
 * Platform-wide listing — every Agreement across every counterparty org.
 * Optionally filter by orgId (as counterpartyOrgId or cpoOrgId).
 */
export async function listAgreements(
  db: PrismaClient,
  orgId: string | null,
): Promise<AgreementRow[]> {
  const where = orgId
    ? {
        OR: [
          { counterpartyOrgId: orgId },
          { cpoOrgId: orgId },
        ],
      }
    : {};

  const rows = await db.agreement.findMany({
    where,
    orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
    include: {
      counterpartyOrg: { select: { id: true, displayName: true } },
      cpoOrg: { select: { id: true, displayName: true } },
      installation: { select: { id: true, displayName: true } },
      driverGroups: {
        select: {
          id: true,
          displayName: true,
          memberships: { select: { userId: true } },
        },
      },
      clauses: {
        include: {
          costFactor: { select: { code: true } },
        },
      },
    },
  });

  return rows.map((r) => {
    const memberCount = r.driverGroups.reduce(
      (acc, g) => acc + g.memberships.length,
      0,
    );
    return {
      id: r.id,
      agreementType: r.agreementType,
      displayName: r.displayName,
      status: r.status,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveUntil: r.effectiveUntil ? r.effectiveUntil.toISOString() : null,
      counterpartyOrgId: r.counterpartyOrg.id,
      counterpartyOrgName: r.counterpartyOrg.displayName,
      cpoOrgId: r.cpoOrg ? r.cpoOrg.id : null,
      cpoOrgName: r.cpoOrg ? r.cpoOrg.displayName : null,
      installationId: r.installation ? r.installation.id : null,
      installationDisplayName: r.installation ? r.installation.displayName : null,
      driverGroupNames: r.driverGroups.map((g) => g.displayName),
      clauseFactorCodes: r.clauses.map((cl) => cl.costFactor.code),
      memberCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** Tile aggregates for the /billing/contracts dashboard strip. */
export async function getContractsTiles(
  db: PrismaClient,
): Promise<ContractsTileData> {
  const [allAgreements, activeAgreements] = await Promise.all([
    db.agreement.count(),
    db.agreement.count({ where: { status: "active" } }),
  ]);

  // Distinct counterparty orgs across all agreements.
  const counterpartyGroups = await db.agreement.groupBy({
    by: ["counterpartyOrgId"],
  });

  // Total distinct members across all driver groups.
  const memberCount = await db.driverGroupMembership.count();

  return {
    totalAgreements: allAgreements,
    activeAgreements,
    totalCounterparties: counterpartyGroups.length,
    totalDriversCovered: memberCount,
  };
}
