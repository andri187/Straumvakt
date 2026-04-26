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
  createdAt: string;
  updatedAt: string;
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
  return rows.map((r) => ({
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
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
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
  return {
    id: created.id,
    orgId: created.orgId,
    orgDisplayName: created.organization.displayName,
    propertyId: created.propertyId,
    propertyDisplayName: created.property.displayName,
    displayName: created.displayName,
    timezone: created.timezone,
    siteType: created.siteType,
    accessLevel: created.accessLevel,
    powerClass: created.powerClass,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}
