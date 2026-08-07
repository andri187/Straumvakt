// Repository — tenancy.org_email_domains CRUD (ADR 0022, 2026-05-31 addendum).
//
// Exposes:
//   listEmailDomainsForOrg     — all rules for an org, sorted by domain asc
//   createEmailDomain          — insert a new rule; caller handles UNIQUE conflict
//   updateEmailDomain          — partial update of policy / defaultDriverGroupId
//   deleteEmailDomain          — hard delete (no soft-delete on config rows)
//   findEmailDomainByDomain    — used by ENROLL-1's verify-email handler
//
// Prisma's `include: { defaultDriverGroup: ... }` is a left join here — the FK
// is nullable and a rule with no default group must still be returned.

import { asc, eq } from "drizzle-orm";
import { orgEmailDomains } from "@straumvakt/shared/db/identity";
import { driverGroups } from "@straumvakt/shared/db/commercial";
import type { Db } from "../lib/drizzle";

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

// ─── Selection + mapper ──────────────────────────────────────────────────────

const columns = {
  id: orgEmailDomains.id,
  orgId: orgEmailDomains.orgId,
  domain: orgEmailDomains.domain,
  policy: orgEmailDomains.policy,
  defaultDriverGroupId: orgEmailDomains.defaultDriverGroupId,
  createdAt: orgEmailDomains.createdAt,
  updatedAt: orgEmailDomains.updatedAt,
  defaultDriverGroupDisplayName: driverGroups.displayName,
};

function toRow(raw: {
  id: string;
  orgId: string;
  domain: string;
  policy: string;
  defaultDriverGroupId: string | null;
  createdAt: Date;
  updatedAt: Date;
  defaultDriverGroupDisplayName: string | null;
}): EmailDomainRow {
  return {
    id: raw.id,
    orgId: raw.orgId,
    domain: raw.domain,
    policy: raw.policy as EmailDomainPolicy,
    defaultDriverGroupId: raw.defaultDriverGroupId,
    defaultDriverGroupDisplayName: raw.defaultDriverGroupDisplayName ?? null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
}

/** The one join every read here shares. */
const withGroup = (db: Db) =>
  db
    .select(columns)
    .from(orgEmailDomains)
    .leftJoin(driverGroups, eq(driverGroups.id, orgEmailDomains.defaultDriverGroupId));

// ─── listEmailDomainsForOrg ───────────────────────────────────────────────────

export async function listEmailDomainsForOrg(
  db: Db,
  orgId: string,
): Promise<EmailDomainRow[]> {
  const rows = await withGroup(db)
    .where(eq(orgEmailDomains.orgId, orgId))
    .orderBy(asc(orgEmailDomains.domain));
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
  db: Db,
  input: CreateEmailDomainInput,
): Promise<EmailDomainRow> {
  // Insert then re-read through the join, because RETURNING cannot reach the
  // joined driver-group name. The UNIQUE conflict the caller handles still
  // surfaces from the insert.
  const [created] = await db
    .insert(orgEmailDomains)
    .values({
      orgId: input.orgId,
      domain: input.domain.toLowerCase(),
      policy: input.policy,
      defaultDriverGroupId: input.defaultDriverGroupId ?? null,
    })
    .returning({ id: orgEmailDomains.id });
  const [row] = await withGroup(db).where(eq(orgEmailDomains.id, created!.id)).limit(1);
  return toRow(row!);
}

// ─── updateEmailDomain ───────────────────────────────────────────────────────

export interface UpdateEmailDomainInput {
  policy?: EmailDomainPolicy;
  defaultDriverGroupId?: string | null;
}

export async function updateEmailDomain(
  db: Db,
  id: string,
  input: UpdateEmailDomainInput,
): Promise<EmailDomainRow | null> {
  const patch = {
    ...(input.policy !== undefined && { policy: input.policy }),
    ...(input.defaultDriverGroupId !== undefined && {
      defaultDriverGroupId: input.defaultDriverGroupId,
    }),
  };
  // Prisma threw P2025 on a missing row and this returned null. Drizzle
  // matches zero rows and returns an empty array, so "not found" is now the
  // absence of a RETURNING row rather than a caught error code.
  if (Object.keys(patch).length === 0) {
    const [unchanged] = await withGroup(db).where(eq(orgEmailDomains.id, id)).limit(1);
    return unchanged ? toRow(unchanged) : null;
  }
  const updated = await db
    .update(orgEmailDomains)
    .set(patch)
    .where(eq(orgEmailDomains.id, id))
    .returning({ id: orgEmailDomains.id });
  if (updated.length === 0) return null;
  const [row] = await withGroup(db).where(eq(orgEmailDomains.id, id)).limit(1);
  return row ? toRow(row) : null;
}

// ─── deleteEmailDomain ───────────────────────────────────────────────────────

export async function deleteEmailDomain(db: Db, id: string): Promise<boolean> {
  const deleted = await db
    .delete(orgEmailDomains)
    .where(eq(orgEmailDomains.id, id))
    .returning({ id: orgEmailDomains.id });
  return deleted.length > 0;
}

// ─── findEmailDomainByDomain ─────────────────────────────────────────────────
//
// Used by ENROLL-1's verify-email handler to look up the rule for a given
// email domain after a driver completes verification. Returns null when no
// matching rule exists (do nothing path).

export async function findEmailDomainByDomain(
  db: Db,
  domain: string,
): Promise<EmailDomainRow | null> {
  const [row] = await withGroup(db)
    .where(eq(orgEmailDomains.domain, domain.toLowerCase()))
    .limit(1);
  return row ? toRow(row) : null;
}
