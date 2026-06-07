// Host-portal read views — drivers + agreements for a single org, reachable
// by that org's host_admin (orgIdParam-gated routes). Kept separate from the
// platform-wide repos because they answer the host's "my network" questions.

import type { PrismaClient } from "../generated/prisma/client";

export interface HostDriver {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  groups: string[];
  addedAt: string;
}

export interface HostAgreement {
  id: string;
  displayName: string;
  agreementType: string;
  status: string;
  installationDisplayName: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

/** Drivers with access to the org's network — members of the driver groups it
 *  owns (agreements.driver_groups → memberships → users), deduped per user. */
export async function listOrgDrivers(
  db: PrismaClient,
  orgId: string,
): Promise<HostDriver[]> {
  const groups = await db.driverGroup.findMany({
    where: { ownerOrgId: orgId },
    select: {
      displayName: true,
      memberships: {
        select: {
          addedAt: true,
          user: { select: { id: true, email: true, displayName: true, status: true } },
        },
      },
    },
  });

  const byUser = new Map<string, HostDriver>();
  for (const g of groups) {
    for (const m of g.memberships) {
      const u = m.user;
      const existing = byUser.get(u.id);
      if (existing) {
        if (!existing.groups.includes(g.displayName)) existing.groups.push(g.displayName);
      } else {
        byUser.set(u.id, {
          userId: u.id,
          email: u.email,
          displayName: u.displayName ?? u.email,
          status: u.status,
          groups: [g.displayName],
          addedAt: m.addedAt.toISOString(),
        });
      }
    }
  }
  return [...byUser.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Agreements the org is party to (either counterparty or CPO side). */
export async function listOrgAgreements(
  db: PrismaClient,
  orgId: string,
): Promise<HostAgreement[]> {
  const rows = await db.agreement.findMany({
    where: { OR: [{ counterpartyOrgId: orgId }, { cpoOrgId: orgId }] },
    orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
    select: {
      id: true,
      displayName: true,
      agreementType: true,
      status: true,
      effectiveFrom: true,
      effectiveUntil: true,
      installation: { select: { displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    agreementType: r.agreementType,
    status: r.status,
    installationDisplayName: r.installation?.displayName ?? null,
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveUntil: r.effectiveUntil ? r.effectiveUntil.toISOString() : null,
  }));
}
