/**
 * Properties repository — physical locations under an Org. Per Rule 7,
 * scoped by org_id; the platform-admin variant lists across all orgs
 * for the operator console index page.
 */
import { prisma } from "@/lib/prisma";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { PropertyCreateInput, PropertyUpdateInput } from "@/lib/repositories/_inputs/properties";

export interface PropertySummary {
  id: string;
  orgId: string;
  orgSlug: string;
  orgDisplayName: string;
  displayName: string;
  locationType: string | null;
  address: unknown;
  latitude: string | null;
  longitude: string | null;
  provisioningStatus: string;
  createdAt: string;
  updatedAt: string;
}

export async function listAllProperties(): Promise<PropertySummary[]> {
  const db = prisma();
  const rows = await db.property.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { organization: { select: { slug: true, displayName: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    orgSlug: r.organization.slug,
    orgDisplayName: r.organization.displayName,
    displayName: r.displayName,
    locationType: r.locationType,
    address: r.address,
    latitude: r.latitude?.toString() ?? null,
    longitude: r.longitude?.toString() ?? null,
    provisioningStatus: r.provisioningStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createProperty(
  input: PropertyCreateInput,
  actorUserId: string | null,
): Promise<PropertySummary> {
  const db = prisma();
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
      address: address as object,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    include: { organization: { select: { slug: true, displayName: true } } },
  });
  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "property.create",
    targetType: "property",
    targetId: created.id,
    metadata: { displayName: created.displayName },
  });
  return {
    id: created.id,
    orgId: created.orgId,
    orgSlug: created.organization.slug,
    orgDisplayName: created.organization.displayName,
    displayName: created.displayName,
    locationType: created.locationType,
    address: created.address,
    latitude: created.latitude?.toString() ?? null,
    longitude: created.longitude?.toString() ?? null,
    provisioningStatus: created.provisioningStatus,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function getPropertyById(id: string): Promise<PropertySummary | null> {
  const db = prisma();
  const r = await db.property.findUnique({
    where: { id },
    include: { organization: { select: { slug: true, displayName: true } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    orgId: r.orgId,
    orgSlug: r.organization.slug,
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

export async function updateProperty(
  id: string,
  patch: PropertyUpdateInput,
  actorUserId: string | null,
): Promise<PropertySummary> {
  const db = prisma();
  const data: Record<string, unknown> = {};
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.locationType !== undefined) data.locationType = patch.locationType;
  if (patch.latitude !== undefined) data.latitude = patch.latitude;
  if (patch.longitude !== undefined) data.longitude = patch.longitude;
  if (patch.street || patch.city || patch.postalCode || patch.countryCode) {
    const country = patch.countryCode ?? "IS";
    data.address = {
      street: patch.street,
      city: patch.city,
      postal_code: patch.postalCode,
      country,
    };
  }
  const updated = await db.property.update({
    where: { id },
    data,
    include: { organization: { select: { slug: true, displayName: true } } },
  });
  await recordAuditAction({
    orgId: updated.orgId,
    actorUserId,
    actorKind: "user",
    action: "property.update",
    targetType: "property",
    targetId: id,
    metadata: { fields: Object.keys(data) },
  });
  return {
    id: updated.id,
    orgId: updated.orgId,
    orgSlug: updated.organization.slug,
    orgDisplayName: updated.organization.displayName,
    displayName: updated.displayName,
    locationType: updated.locationType,
    address: updated.address,
    latitude: updated.latitude?.toString() ?? null,
    longitude: updated.longitude?.toString() ?? null,
    provisioningStatus: updated.provisioningStatus,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}
