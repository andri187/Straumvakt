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
  vendorSlug: string | null;
  vendorDisplayName: string | null;
  vendorInstallationRef: string | null;
  onboardingStatus: string;
  createdAt: string;
  updatedAt: string;
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
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    siteId: r.siteId,
    siteDisplayName: r.site.displayName,
    displayName: r.displayName,
    vendorSlug: r.vendor?.slug ?? null,
    vendorDisplayName: r.vendor?.displayName ?? null,
    vendorInstallationRef: r.vendorInstallationRef,
    onboardingStatus: r.onboardingStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
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
  return {
    id: created.id,
    orgId: created.orgId,
    orgDisplayName: created.organization.displayName,
    siteId: created.siteId,
    siteDisplayName: created.site.displayName,
    displayName: created.displayName,
    vendorSlug: created.vendor?.slug ?? null,
    vendorDisplayName: created.vendor?.displayName ?? null,
    vendorInstallationRef: created.vendorInstallationRef,
    onboardingStatus: created.onboardingStatus,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}
