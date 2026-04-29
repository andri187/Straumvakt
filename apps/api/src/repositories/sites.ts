import type { PrismaClient } from "../generated/prisma/client";
import type { SiteSummary } from "@straumvakt/shared/domain/sites";
import type { SiteCreateInput, SiteUpdateInput } from "@straumvakt/shared/inputs/sites";

const include = {
  organization: { select: { displayName: true } },
  property: { select: { displayName: true } },
} as const;

type Row = {
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
};

function toSummary(r: Row): SiteSummary {
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

export async function listAllSites(db: PrismaClient): Promise<SiteSummary[]> {
  const rows = await db.site.findMany({ orderBy: [{ updatedAt: "desc" }], include });
  return rows.map(toSummary);
}

export async function listSitesByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<SiteSummary[]> {
  const rows = await db.site.findMany({
    where: { orgId },
    orderBy: [{ displayName: "asc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function getSiteById(
  db: PrismaClient,
  id: string,
): Promise<SiteSummary | null> {
  const r = await db.site.findUnique({ where: { id }, include });
  return r ? toSummary(r) : null;
}

export async function createSite(
  db: PrismaClient,
  input: SiteCreateInput,
): Promise<SiteSummary> {
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
    include,
  });
  return toSummary(created);
}

export async function updateSite(
  db: PrismaClient,
  id: string,
  patch: SiteUpdateInput,
): Promise<SiteSummary> {
  const updated = await db.site.update({ where: { id }, data: patch, include });
  return toSummary(updated);
}
