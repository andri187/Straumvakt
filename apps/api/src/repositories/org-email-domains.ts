// Repository — tenancy.org_email_domains CRUD (ADR 0022, 2026-05-31 addendum).
//
// Exposes:
//   listEmailDomainsForOrg     — all rules for an org, sorted by domain asc
//   createEmailDomain          — insert a new rule; caller handles UNIQUE conflict
//   updateEmailDomain          — partial update of policy / defaultDriverGroupId
//   deleteEmailDomain          — hard delete (no soft-delete on config rows)
//   findEmailDomainByDomain    — used by ENROLL-1's verify-email handler

import type { PrismaClient } from "../generated/prisma/client";

// ─── Output shapes ───────────────────────────────────────────────────────────

export type EmailDomainPolicy = "auto_join" | "request_approval" | "disabled";

export interface EmailDomainRow {
  id: string;
  orgId: string;
  domain: string;
  policy: EmailDomainPolicy;
  defaultDriverGroupId: string | null;
  defaultDriverGroupDisplayName: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ─── Internal include helper ──────────────────────────────────────────────────

const include = {
  defaultDriverGroup: {
    select: { id: true, displayName: true },
  },
} as const;

// ─── Mapper ──────────────────────────────────────────────────────────────────

function toRow(
  raw: {
    id: string;
    orgId: string;
    domain: string;
    policy: string;
    defaultDriverGroupId: string | null;
    createdAt: Date;
    updatedAt: Date;
    defaultDriverGroup: { id: string; displayName: string } | null;
  },
): EmailDomainRow {
  return {
    id: raw.id,
    orgId: raw.orgId,
    domain: raw.domain,
    policy: raw.policy as EmailDomainPolicy,
    defaultDriverGroupId: raw.defaultDriverGroupId,
    defaultDriverGroupDisplayName: raw.defaultDriverGroup?.displayName ?? null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
}

// ─── listEmailDomainsForOrg ───────────────────────────────────────────────────

export async function listEmailDomainsForOrg(
  db: PrismaClient,
  orgId: string,
): Promise<EmailDomainRow[]> {
  const rows = await db.orgEmailDomain.findMany({
    where: { orgId },
    include,
    orderBy: { domain: "asc" },
  });
  return rows.map(toRow);
}

// ─── createEmailDomain ───────────────────────────────────────────────────────

export interface CreateEmailDomainInput {
  orgId: string;
  domain: string;
  policy: EmailDomainPolicy;
  defaultDriverGroupId?: string | null;
}

export async function createEmailDomain(
  db: PrismaClient,
  input: CreateEmailDomainInput,
): Promise<EmailDomainRow> {
  const row = await db.orgEmailDomain.create({
    data: {
      orgId: input.orgId,
      domain: input.domain.toLowerCase(),
      policy: input.policy,
      defaultDriverGroupId: input.defaultDriverGroupId ?? null,
    },
    include,
  });
  return toRow(row);
}

// ─── updateEmailDomain ───────────────────────────────────────────────────────

export interface UpdateEmailDomainInput {
  policy?: EmailDomainPolicy;
  defaultDriverGroupId?: string | null;
}

export async function updateEmailDomain(
  db: PrismaClient,
  id: string,
  input: UpdateEmailDomainInput,
): Promise<EmailDomainRow | null> {
  try {
    const row = await db.orgEmailDomain.update({
      where: { id },
      data: {
        ...(input.policy !== undefined && { policy: input.policy }),
        ...(input.defaultDriverGroupId !== undefined && {
          defaultDriverGroupId: input.defaultDriverGroupId,
        }),
      },
      include,
    });
    return toRow(row);
  } catch (err: unknown) {
    // P2025 = "Record to update does not exist."
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: unknown }).code === "P2025"
    ) {
      return null;
    }
    throw err;
  }
}

// ─── deleteEmailDomain ───────────────────────────────────────────────────────

export async function deleteEmailDomain(
  db: PrismaClient,
  id: string,
): Promise<boolean> {
  try {
    await db.orgEmailDomain.delete({ where: { id } });
    return true;
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: unknown }).code === "P2025"
    ) {
      return false;
    }
    throw err;
  }
}

// ─── findEmailDomainByDomain ─────────────────────────────────────────────────
//
// Used by ENROLL-1's verify-email handler to look up the rule for a given
// email domain after a driver completes verification. Returns null when no
// matching rule exists (do nothing path).

export async function findEmailDomainByDomain(
  db: PrismaClient,
  domain: string,
): Promise<EmailDomainRow | null> {
  const row = await db.orgEmailDomain.findUnique({
    where: { domain: domain.toLowerCase() },
    include,
  });
  if (!row) return null;
  return toRow(row);
}
