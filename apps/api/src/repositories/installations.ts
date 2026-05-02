import type { PrismaClient } from "../generated/prisma/client";
import type { InstallationSummary } from "@straumvakt/shared/domain/installations";
import type {
  InstallationCreateInput,
  InstallationUpdateInput,
} from "@straumvakt/shared/inputs/installations";

const include = {
  organization: { select: { displayName: true } },
  site: { select: { displayName: true } },
  vendor: { select: { slug: true, displayName: true } },
} as const;

type Row = {
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
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(r: Row): InstallationSummary {
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
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listAllInstallations(db: PrismaClient): Promise<InstallationSummary[]> {
  const rows = await db.installation.findMany({ orderBy: [{ updatedAt: "desc" }], include });
  return rows.map(toSummary);
}

export async function listInstallationsBySite(
  db: PrismaClient,
  siteId: string,
): Promise<{ id: string; displayName: string }[]> {
  return db.installation.findMany({
    where: { siteId },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
}

export async function listInstallationsByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<InstallationSummary[]> {
  const rows = await db.installation.findMany({
    where: { orgId },
    orderBy: [{ displayName: "asc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function getInstallationById(
  db: PrismaClient,
  id: string,
): Promise<InstallationSummary | null> {
  const r = await db.installation.findUnique({ where: { id }, include });
  return r ? toSummary(r) : null;
}

export async function listVendors(
  db: PrismaClient,
): Promise<{ id: string; slug: string; displayName: string }[]> {
  return db.hardwareVendor.findMany({
    where: { status: "active" },
    select: { id: true, slug: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
}

export async function createInstallation(
  db: PrismaClient,
  input: InstallationCreateInput,
): Promise<InstallationSummary> {
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
    include,
  });
  return toSummary(created);
}

export async function updateInstallation(
  db: PrismaClient,
  id: string,
  patch: InstallationUpdateInput,
): Promise<InstallationSummary> {
  const updated = await db.installation.update({ where: { id }, data: patch, include });
  return toSummary(updated);
}

/**
 * Cascade-delete an installation:
 *   - Chargers under it (ChargingStation.installationId = id)
 *   - Circuits under it (Circuit.installationId = id)
 *   - The installation row itself
 * Chargers go through SiteAsset deletion so the existing schema
 * cascade reaches EVSE/Connector/OcppIdentity. Circuits do not have
 * cascade onDelete from Installation in the schema (set-null), so we
 * delete them explicitly here.
 */
export async function deleteInstallation(db: PrismaClient, id: string): Promise<void> {
  await db.$transaction(
    async (tx) => {
      const stations = await tx.chargingStation.findMany({
        where: { installationId: id },
        select: { siteAssetId: true },
      });
      const siteAssetIds = stations.map((s) => s.siteAssetId);
      if (siteAssetIds.length > 0) {
        await tx.siteAsset.deleteMany({ where: { id: { in: siteAssetIds } } });
      }
      await tx.circuit.deleteMany({ where: { installationId: id } });
      await tx.installation.delete({ where: { id } });
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}
