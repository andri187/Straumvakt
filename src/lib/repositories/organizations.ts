/**
 * Organizations repository — platform-admin only.
 *
 * Org rows ARE the tenant boundary every other table is scoped to. They
 * cannot themselves be `withOrgContext`-scoped — creating an Org IS the
 * one operation that crosses the tenant boundary by definition. Reads /
 * updates / archives are platform-admin actions too: only Straumvakt
 * staff lists "all orgs"; an Org's own admins use Org-scoped queries
 * elsewhere (Property / Site / etc.).
 *
 * This module is the only place outside `_context` where `prisma()` is
 * called directly. All other repositories must go through
 * `withOrgContext`.
 */
import type { OrgStatus } from "@prisma/client";
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
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

function toSummary(row: {
  id: string;
  slug: string;
  displayName: string;
  countryCode: string;
  status: OrgStatus;
  createdAt: Date;
  updatedAt: Date;
}): OrgSummary {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    countryCode: row.countryCode,
    status: row.status,
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
    },
  });
  // Audit row scoped to the new Org itself — chicken-and-egg solved by
  // writing the first audit action against the just-created id.
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
    data: patch,
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
