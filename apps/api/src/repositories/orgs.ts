// Organizations repository — platform-admin only.
//
// Org rows ARE the tenant boundary every other table is scoped to. They
// cannot themselves be `withOrgContext`-scoped — creating an Org IS the
// one operation that crosses the tenant boundary by definition.
//
// Ported from the monolith's src/lib/repositories/organizations.ts.
// Identical contract; the only structural difference is the function
// signatures take an explicit `prisma` client so the route handler
// passes its per-request client through.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { OrgSummary, OrganizationRole, OrgStatus } from "@straumvakt/shared/domain/orgs";
import type { OrgCreateInput, OrgUpdateInput } from "@straumvakt/shared/inputs/orgs";

type Row = {
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
};

function toSummary(row: Row): OrgSummary {
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

export async function listOrgs(
  db: PrismaClient,
  opts?: { includeArchived?: boolean },
): Promise<OrgSummary[]> {
  const rows = await db.organization.findMany({
    where: opts?.includeArchived ? undefined : { status: { not: "archived" } },
    orderBy: [{ status: "asc" }, { displayName: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getOrgById(
  db: PrismaClient,
  orgId: string,
): Promise<OrgSummary | null> {
  const row = await db.organization.findUnique({ where: { id: orgId } });
  return row ? toSummary(row) : null;
}

export async function createOrg(
  db: PrismaClient,
  input: OrgCreateInput,
): Promise<OrgSummary> {
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
      addresses: input.addresses as Prisma.InputJsonValue,
      contacts: input.contacts as Prisma.InputJsonValue,
      branding: input.branding as Prisma.InputJsonValue,
    },
  });
  return toSummary(created);
}

export async function updateOrg(
  db: PrismaClient,
  orgId: string,
  patch: OrgUpdateInput,
): Promise<OrgSummary> {
  const { addresses, contacts, branding, ...rest } = patch;
  const updated = await db.organization.update({
    where: { id: orgId },
    data: {
      ...rest,
      ...(addresses !== undefined ? { addresses: addresses as Prisma.InputJsonValue } : {}),
      ...(contacts !== undefined ? { contacts: contacts as Prisma.InputJsonValue } : {}),
      ...(branding !== undefined ? { branding: branding as Prisma.InputJsonValue } : {}),
    },
  });
  return toSummary(updated);
}
