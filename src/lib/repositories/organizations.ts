/**
 * Organizations repository — platform-admin only.
 *
 * Org rows ARE the tenant boundary every other table is scoped to. They
 * cannot themselves be `withOrgContext`-scoped — creating an Org IS the
 * one operation that crosses the tenant boundary by definition.
 */
import type { OrgStatus, OrganizationRole } from "straumvakt-prisma-cf-client/client";
import { prisma } from "@/lib/prisma";
import {
  OrgCreateInput,
  OrgUpdateInput,
} from "@/lib/repositories/_inputs/orgs";
import { recordAuditAction } from "@/lib/repositories/audit-actions";

export interface OrgSummary {
  id: string;
  slug: string;
  displayName: string;
  countryCode: string;
  status: OrgStatus;
  kennitala: string | null;
  legalName: string | null;
  legalForm: string | null;
  vskNr: string | null;
  leiCode: string | null;
  defaultCurrency: string;
  regulatorLicenceNo: string | null;
  notes: string | null;
  roles: OrganizationRole[];
  addresses: unknown;
  contacts: unknown;
  branding: unknown;
  createdAt: string;
  updatedAt: string;
}

function toSummary(row: {
  id: string;
  slug: string;
  displayName: string;
  countryCode: string;
  status: OrgStatus;
  kennitala: string | null;
  legalName: string | null;
  legalForm: string | null;
  vskNr: string | null;
  leiCode: string | null;
  defaultCurrency: string;
  regulatorLicenceNo: string | null;
  notes: string | null;
  roles: OrganizationRole[];
  addresses: unknown;
  contacts: unknown;
  branding: unknown;
  createdAt: Date;
  updatedAt: Date;
}): OrgSummary {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    countryCode: row.countryCode,
    status: row.status,
    kennitala: row.kennitala,
    legalName: row.legalName,
    legalForm: row.legalForm,
    vskNr: row.vskNr,
    leiCode: row.leiCode,
    defaultCurrency: row.defaultCurrency,
    regulatorLicenceNo: row.regulatorLicenceNo,
    notes: row.notes,
    roles: row.roles,
    addresses: row.addresses,
    contacts: row.contacts,
    branding: row.branding,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listOrgs(opts?: {
  includeArchived?: boolean;
}): Promise<OrgSummary[]> {
  const db = prisma();
  const rows = await db.organization.findMany({
    where: opts?.includeArchived ? undefined : { status: { not: "archived" } },
    orderBy: [{ status: "asc" }, { displayName: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getOrgById(orgId: string): Promise<OrgSummary | null> {
  const db = prisma();
  const row = await db.organization.findUnique({ where: { id: orgId } });
  return row ? toSummary(row) : null;
}

export async function getOrgBySlug(slug: string): Promise<OrgSummary | null> {
  const db = prisma();
  const row = await db.organization.findUnique({ where: { slug } });
  return row ? toSummary(row) : null;
}

export async function createOrg(
  input: OrgCreateInput,
  actorUserId: string | null,
): Promise<OrgSummary> {
  const db = prisma();
  const created = await db.organization.create({
    data: {
      slug: input.slug,
      displayName: input.displayName,
      countryCode: input.countryCode,
      kennitala: input.kennitala,
      legalName: input.legalName,
      legalForm: input.legalForm,
      vskNr: input.vskNr,
      leiCode: input.leiCode,
      defaultCurrency: input.defaultCurrency,
      regulatorLicenceNo: input.regulatorLicenceNo,
      notes: input.notes,
      roles: input.roles,
      addresses: input.addresses as object,
      contacts: input.contacts as object,
      branding: input.branding as object,
    },
  });
  await recordAuditAction({
    orgId: created.id,
    actorUserId,
    actorKind: "user",
    action: "org.create",
    targetType: "organization",
    targetId: created.id,
    metadata: { slug: created.slug, displayName: created.displayName },
  });
  return toSummary(created);
}

export async function updateOrg(
  orgId: string,
  patch: OrgUpdateInput,
  actorUserId: string | null,
): Promise<OrgSummary> {
  const db = prisma();
  const updated = await db.organization.update({
    where: { id: orgId },
    data: {
      ...patch,
      addresses: patch.addresses as object | undefined,
      contacts: patch.contacts as object | undefined,
      branding: patch.branding as object | undefined,
    },
  });
  await recordAuditAction({
    orgId,
    actorUserId,
    actorKind: "user",
    action: "org.update",
    targetType: "organization",
    targetId: orgId,
    metadata: { fields: Object.keys(patch) },
  });
  return toSummary(updated);
}

export async function archiveOrg(
  orgId: string,
  actorUserId: string | null,
): Promise<OrgSummary> {
  const db = prisma();
  const updated = await db.organization.update({
    where: { id: orgId },
    data: { status: "archived" },
  });
  await recordAuditAction({
    orgId,
    actorUserId,
    actorKind: "user",
    action: "org.archive",
    targetType: "organization",
    targetId: orgId,
    metadata: {},
  });
  return toSummary(updated);
}
