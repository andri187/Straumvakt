import { prisma } from "@/lib/prisma";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { InstallationCreateInput } from "@/lib/repositories/_inputs/installations";

export interface InstallationSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  siteId: string;
  siteDisplayName: string;
  displayName: string;
  vendorId: string | null;
  vendorSlug: string | null;
  vendorDisplayName: string | null;
  modelId: string | null;
  vendorInstallationRef: string | null;
  credentialsRef: string | null;
  credentialsStatus: string | null;
  onboardingStatus: string;
  retailerTariffId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toInstallationSummary(r: {
  id: string;
  orgId: string;
  organization: { displayName: string };
  siteId: string;
  site: { displayName: string };
  displayName: string;
  vendorId: string | null;
  vendor: { slug: string; displayName: string } | null;
  modelId: string | null;
  vendorInstallationRef: string | null;
  credentialsRef: string | null;
  credentialsStatus: string | null;
  onboardingStatus: string;
  retailerTariffId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): InstallationSummary {
  return {
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    siteId: r.siteId,
    siteDisplayName: r.site.displayName,
    displayName: r.displayName,
    vendorId: r.vendorId,
    vendorSlug: r.vendor?.slug ?? null,
    vendorDisplayName: r.vendor?.displayName ?? null,
    modelId: r.modelId,
    vendorInstallationRef: r.vendorInstallationRef,
    credentialsRef: r.credentialsRef,
    credentialsStatus: r.credentialsStatus,
    onboardingStatus: r.onboardingStatus,
    retailerTariffId: r.retailerTariffId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listAllInstallations(): Promise<InstallationSummary[]> {
  const db = prisma();
  const rows = await db.installation.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      vendor: { select: { slug: true, displayName: true } },
    },
  });
  return rows.map(toInstallationSummary);
}

export async function listSitesByOrg(orgId: string): Promise<{ id: string; displayName: string }[]> {
  const db = prisma();
  return db.site.findMany({ where: { orgId }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } });
}

export async function listVendors(): Promise<{ id: string; slug: string; displayName: string }[]> {
  const db = prisma();
  return db.hardwareVendor.findMany({ where: { status: "active" }, select: { id: true, slug: true, displayName: true }, orderBy: { displayName: "asc" } });
}

export async function createInstallation(input: InstallationCreateInput, actorUserId: string | null): Promise<InstallationSummary> {
  const db = prisma();
  const created = await db.installation.create({
    data: {
      orgId: input.orgId,
      siteId: input.siteId,
      displayName: input.displayName,
      vendorId: input.vendorId,
      modelId: input.modelId,
      vendorInstallationRef: input.vendorInstallationRef,
      onboardingStatus: input.onboardingStatus,
    },
    include: {
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      vendor: { select: { slug: true, displayName: true } },
    },
  });
  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "installation.create",
    targetType: "installation",
    targetId: created.id,
    metadata: { displayName: created.displayName, vendor: created.vendor?.slug ?? null },
  });
  return toInstallationSummary(created);
}

import type { InstallationUpdateInput } from "@/lib/repositories/_inputs/installations";

export async function getInstallationById(id: string): Promise<InstallationSummary | null> {
  const db = prisma();
  const r = await db.installation.findUnique({
    where: { id },
    include: {
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      vendor: { select: { slug: true, displayName: true } },
    },
  });
  if (!r) return null;
  return toInstallationSummary(r);
}

export async function updateInstallation(
  id: string,
  patch: InstallationUpdateInput,
  actorUserId: string | null,
): Promise<InstallationSummary> {
  const db = prisma();
  const updated = await db.installation.update({
    where: { id },
    data: patch,
    include: {
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      vendor: { select: { slug: true, displayName: true } },
    },
  });
  await recordAuditAction({
    orgId: updated.orgId,
    actorUserId,
    actorKind: "user",
    action: "installation.update",
    targetType: "installation",
    targetId: id,
    metadata: { fields: Object.keys(patch) },
  });
  return toInstallationSummary(updated);
}
