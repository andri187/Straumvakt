// Organizations repository — platform-admin only.
//
// Org rows ARE the tenant boundary every other table is scoped to. They
// cannot themselves be `withOrgContext`-scoped — creating an Org IS the
// one operation that crosses the tenant boundary by definition.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type {
  OrgSummary,
  OrgAddress,
  OrgMainContact,
} from "@straumvakt/shared/domain/orgs";
import type {
  OrgCreateInput,
  OrgUpdateInput,
} from "@straumvakt/shared/inputs/orgs";

const include = {
  mainContact: { select: { id: true, displayName: true, email: true } },
} as const;

type Row = Prisma.OrganizationGetPayload<{ include: typeof include }>;

function toAddress(value: unknown): OrgAddress | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.street === "string" &&
    typeof v.postalCode === "string" &&
    typeof v.city === "string"
  ) {
    return { street: v.street, postalCode: v.postalCode, city: v.city };
  }
  return null;
}

function toMainContact(row: Row): OrgMainContact | null {
  if (!row.mainContact) return null;
  return {
    id: row.mainContact.id,
    displayName: row.mainContact.displayName,
    email: row.mainContact.email,
  };
}

function toSummary(row: Row): OrgSummary {
  return {
    id: row.id,
    displayName: row.displayName,
    countryCode: row.countryCode,
    status: row.status,
    kennitala: row.kennitala,
    legalName: row.legalName,
    legalForm: row.legalForm,
    legalFormCode: row.legalFormCode,
    vskNr: row.vskNr,
    leiCode: row.leiCode,
    defaultCurrency: row.defaultCurrency,
    postalAddress: toAddress(row.postalAddress),
    legalAddress: toAddress(row.legalAddress),
    municipalityCode: row.municipalityCode,
    municipalityName: row.municipalityName,
    regulatorLicenceNo: row.regulatorLicenceNo,
    notes: row.notes,
    roles: row.roles,
    branding: row.branding,
    mainContactUserId: row.mainContactUserId,
    mainContact: toMainContact(row),
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
    include,
  });
  return rows.map(toSummary);
}

export async function getOrgById(
  db: PrismaClient,
  orgId: string,
): Promise<OrgSummary | null> {
  const row = await db.organization.findUnique({
    where: { id: orgId },
    include,
  });
  return row ? toSummary(row) : null;
}

export async function createOrg(
  db: PrismaClient,
  input: OrgCreateInput,
): Promise<OrgSummary> {
  const created = await db.organization.create({
    data: {
      displayName: input.displayName,
      countryCode: input.countryCode,
      kennitala: input.kennitala,
      legalName: input.legalName,
      legalForm: input.legalForm,
      legalFormCode: input.legalFormCode,
      vskNr: input.vskNr,
      leiCode: input.leiCode,
      defaultCurrency: input.defaultCurrency,
      municipalityCode: input.municipalityCode,
      municipalityName: input.municipalityName,
      regulatorLicenceNo: input.regulatorLicenceNo,
      notes: input.notes,
      roles: input.roles,
      postalAddress: (input.postalAddress ?? null) as Prisma.InputJsonValue,
      legalAddress: (input.legalAddress ?? null) as Prisma.InputJsonValue,
      branding: input.branding as Prisma.InputJsonValue,
      mainContactUserId: input.mainContactUserId ?? null,
    },
    include,
  });
  return toSummary(created);
}

export async function updateOrg(
  db: PrismaClient,
  orgId: string,
  patch: OrgUpdateInput,
): Promise<OrgSummary> {
  const { postalAddress, legalAddress, branding, ...rest } = patch;
  const updated = await db.organization.update({
    where: { id: orgId },
    data: {
      ...rest,
      ...(postalAddress !== undefined
        ? { postalAddress: (postalAddress ?? null) as Prisma.InputJsonValue }
        : {}),
      ...(legalAddress !== undefined
        ? { legalAddress: (legalAddress ?? null) as Prisma.InputJsonValue }
        : {}),
      ...(branding !== undefined
        ? { branding: branding as Prisma.InputJsonValue }
        : {}),
    },
    include,
  });
  return toSummary(updated);
}
