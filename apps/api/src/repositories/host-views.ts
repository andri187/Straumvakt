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
  /** Active physical RFID card value(s) belonging to the driver. */
  rfids: string[];
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
          rfids: [],
          addedAt: m.addedAt.toISOString(),
        });
      }
    }
  }

  // Enrich with each driver's active physical RFID card(s).
  const userIds = [...byUser.keys()];
  if (userIds.length > 0) {
    const tokens = await db.idToken.findMany({
      where: { userId: { in: userIds }, kind: "rfid", status: "active" },
      select: { userId: true, value: true },
    });
    for (const t of tokens) {
      byUser.get(t.userId)?.rfids.push(t.value);
    }
  }

  return [...byUser.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface HostRecentSession {
  id: string;
  startedAt: string;
  station: string;
  energyKwh: number | null;
  status: string;
}
export interface HostSessionSummary {
  totalCount: number;
  totalEnergyKwh: number;
  monthCount: number;
  monthEnergyKwh: number;
  recent: HostRecentSession[];
}

function whToKwh(wh: bigint | null): number | null {
  if (wh === null) return null;
  return Math.round(Number(wh) / 100) / 10; // kWh, 1 decimal
}

/** Charging-session aggregates + recent activity for the org's dashboard. */
export async function getOrgSessionSummary(
  db: PrismaClient,
  orgId: string,
  now: Date,
): Promise<HostSessionSummary> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [agg, monthAgg, recent] = await Promise.all([
    db.chargeSession.aggregate({ where: { orgId }, _count: { _all: true }, _sum: { energyWh: true } }),
    db.chargeSession.aggregate({
      where: { orgId, startedAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { energyWh: true },
    }),
    db.chargeSession.findMany({
      where: { orgId },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        startedAt: true,
        energyWh: true,
        status: true,
        ocppIdentityId: true,
        chargingStationId: true,
      },
    }),
  ]);

  const idIds = [
    ...new Set(recent.map((r) => r.ocppIdentityId).filter((x): x is string => !!x)),
  ];
  const idMap = new Map<string, string>();
  if (idIds.length > 0) {
    const ids = await db.ocppIdentity.findMany({
      where: { id: { in: idIds } },
      select: { id: true, identityString: true },
    });
    for (const i of ids) idMap.set(i.id, i.identityString);
  }

  return {
    totalCount: agg._count._all,
    totalEnergyKwh: whToKwh(agg._sum.energyWh) ?? 0,
    monthCount: monthAgg._count._all,
    monthEnergyKwh: whToKwh(monthAgg._sum.energyWh) ?? 0,
    recent: recent.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      station: (r.ocppIdentityId && idMap.get(r.ocppIdentityId)) || r.chargingStationId.slice(0, 8),
      energyKwh: whToKwh(r.energyWh),
      status: r.status,
    })),
  };
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
