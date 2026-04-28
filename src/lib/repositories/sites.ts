import { prisma } from "@/lib/prisma";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { SiteCreateInput } from "@/lib/repositories/_inputs/sites";

export interface SiteSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  propertyId: string;
  propertyDisplayName: string;
  displayName: string;
  timezone: string;
  siteType: string;
  accessLevel: string;
  powerClass: string | null;
  provisioningStatus: string;
  dsoTariffId: string | null;
  usrfTariffId: string | null;
  usrfPremTariffId: string | null;
  xtrrfTariffId: string | null;
  spvivfTariffId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toSiteSummary(r: {
  id: string;
  orgId: string;
  organization: { displayName: string };
  propertyId: string;
  property: { displayName: string };
  displayName: string;
  timezone: string;
  siteType: string;
  accessLevel: string;
  powerClass: string | null;
  provisioningStatus: string;
  dsoTariffId: string | null;
  usrfTariffId: string | null;
  usrfPremTariffId: string | null;
  xtrrfTariffId: string | null;
  spvivfTariffId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SiteSummary {
  return {
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    propertyId: r.propertyId,
    propertyDisplayName: r.property.displayName,
    displayName: r.displayName,
    timezone: r.timezone,
    siteType: r.siteType,
    accessLevel: r.accessLevel,
    powerClass: r.powerClass,
    provisioningStatus: r.provisioningStatus,
    dsoTariffId: r.dsoTariffId,
    usrfTariffId: r.usrfTariffId,
    usrfPremTariffId: r.usrfPremTariffId,
    xtrrfTariffId: r.xtrrfTariffId,
    spvivfTariffId: r.spvivfTariffId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listAllSites(): Promise<SiteSummary[]> {
  const db = prisma();
  const rows = await db.site.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      property: { select: { displayName: true } },
    },
  });
  return rows.map(toSiteSummary);
}

export async function listPropertiesByOrg(
  orgId: string,
): Promise<{ id: string; displayName: string }[]> {
  const db = prisma();
  const rows = await db.property.findMany({
    where: { orgId },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  return rows;
}

export async function createSite(
  input: SiteCreateInput,
  actorUserId: string | null,
): Promise<SiteSummary> {
  const db = prisma();
  const created = await db.site.create({
    data: {
      orgId: input.orgId,
      propertyId: input.propertyId,
      displayName: input.displayName,
      timezone: input.timezone,
      siteType: input.siteType,
      accessLevel: input.accessLevel,
      powerClass: input.powerClass,
    },
    include: {
      organization: { select: { displayName: true } },
      property: { select: { displayName: true } },
    },
  });
  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "site.create",
    targetType: "site",
    targetId: created.id,
    metadata: { displayName: created.displayName },
  });
  return toSiteSummary(created);
}

import type { SiteUpdateInput } from "@/lib/repositories/_inputs/sites";

export async function getSiteById(id: string): Promise<SiteSummary | null> {
  const db = prisma();
  const r = await db.site.findUnique({
    where: { id },
    include: {
      organization: { select: { displayName: true } },
      property: { select: { displayName: true } },
    },
  });
  if (!r) return null;
  return toSiteSummary(r);
}

export async function updateSite(
  id: string,
  patch: SiteUpdateInput,
  actorUserId: string | null,
): Promise<SiteSummary> {
  const db = prisma();
  const updated = await db.site.update({
    where: { id },
    data: patch,
    include: {
      organization: { select: { displayName: true } },
      property: { select: { displayName: true } },
    },
  });
  await recordAuditAction({
    orgId: updated.orgId,
    actorUserId,
    actorKind: "user",
    action: "site.update",
    targetType: "site",
    targetId: id,
    metadata: { fields: Object.keys(patch) },
  });
  return toSiteSummary(updated);
}
