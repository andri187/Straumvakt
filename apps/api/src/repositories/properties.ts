import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { PropertySummary } from "@straumvakt/shared/domain/properties";
import type {
  PropertyCreateInput,
  PropertyUpdateInput,
} from "@straumvakt/shared/inputs/properties";

type Row = {
  id: string;
  orgId: string;
  organization: { displayName: string };
  displayName: string;
  locationType: string | null;
  address: unknown;
  latitude: { toString(): string } | null;
  longitude: { toString(): string } | null;
  provisioningStatus: string;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(r: Row): PropertySummary {
  return {
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    displayName: r.displayName,
    locationType: r.locationType,
    address: r.address,
    latitude: r.latitude?.toString() ?? null,
    longitude: r.longitude?.toString() ?? null,
    provisioningStatus: r.provisioningStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const include = { organization: { select: { displayName: true } } } as const;

export async function listAllProperties(db: PrismaClient): Promise<PropertySummary[]> {
  const rows = await db.property.findMany({ orderBy: [{ updatedAt: "desc" }], include });
  return rows.map(toSummary);
}

export async function listPropertiesByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<PropertySummary[]> {
  const rows = await db.property.findMany({
    where: { orgId },
    orderBy: [{ displayName: "asc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function getPropertyById(
  db: PrismaClient,
  id: string,
): Promise<PropertySummary | null> {
  const r = await db.property.findUnique({ where: { id }, include });
  return r ? toSummary(r) : null;
}

export async function createProperty(
  db: PrismaClient,
  input: PropertyCreateInput,
): Promise<PropertySummary> {
  const address =
    input.street || input.city || input.postalCode
      ? {
          street: input.street,
          city: input.city,
          postal_code: input.postalCode,
          country: input.countryCode,
        }
      : {};
  const created = await db.property.create({
    data: {
      orgId: input.orgId,
      displayName: input.displayName,
      locationType: input.locationType,
      address: address as Prisma.InputJsonValue,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    include,
  });
  return toSummary(created);
}

export async function updateProperty(
  db: PrismaClient,
  id: string,
  patch: PropertyUpdateInput,
): Promise<PropertySummary> {
  const data: Record<string, unknown> = {};
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.locationType !== undefined) data.locationType = patch.locationType;
  if (patch.latitude !== undefined) data.latitude = patch.latitude;
  if (patch.longitude !== undefined) data.longitude = patch.longitude;
  if (patch.street !== undefined || patch.city !== undefined || patch.postalCode !== undefined || patch.countryCode !== undefined) {
    data.address = {
      street: patch.street,
      city: patch.city,
      postal_code: patch.postalCode,
      country: patch.countryCode,
    } as Prisma.InputJsonValue;
  }
  const updated = await db.property.update({ where: { id }, data, include });
  return toSummary(updated);
}

/**
 * Cascade-delete a property and everything physically under it. Schema
 * cascades take care of:
 *   - Property → Site (Cascade)
 *   - Site → Installation (Cascade)
 *   - Site → Circuit (Cascade)
 *   - SiteAsset → ChargingStation (Cascade)
 *   - ChargingStation → EVSE / Connector / OcppIdentity (Cascade)
 * The schema gap is Site → SiteAsset (no auto-cascade), so we drop
 * SiteAssets explicitly first — same trick as deleteSite. Then the
 * remaining cascades fire when we delete the property row itself.
 *
 * This is the operator's "undo a Zaptec import" hammer: removes the
 * property + all sites + installations + circuits + chargers + OCPP
 * identities created by that import in one transaction.
 */
export async function deleteProperty(db: PrismaClient, id: string): Promise<void> {
  await db.$transaction(
    async (tx) => {
      // Find every site under this property and drop SiteAssets across
      // all of them in one query — cleaner than N round-trips.
      const sites = await tx.site.findMany({
        where: { propertyId: id },
        select: { id: true },
      });
      const siteIds = sites.map((s) => s.id);
      if (siteIds.length > 0) {
        await tx.siteAsset.deleteMany({ where: { siteId: { in: siteIds } } });
      }
      await tx.property.delete({ where: { id } });
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}
