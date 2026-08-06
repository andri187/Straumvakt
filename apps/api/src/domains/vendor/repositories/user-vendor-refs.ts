// UserVendorRef repository — closure item 1 paperwork from sprint-03
// retro. Gives the previously-orphan identity.user_vendor_refs table
// a write path so the table is no longer schema-only.
//
// Real callers land in Sprint 4+ when the user-import sync engine
// connects Straumvakt User rows to vendor-side identifiers (Zaptec
// UUIDs, Easee customer IDs, OCPI-partner subjects). Today the table
// stays empty for manually-created users — they have no vendor-side
// counterpart.
//
// Kept minimal on purpose: create + listForUser. Sprint 4 can extend
// when the import engine ships.
//
// Moved from src/repositories/user-vendor-refs.ts and ported from Prisma in
// the same commit. It lives under `vendor` because that is where the
// dependency rules already classified it, and because a row here exists
// only to name something on a vendor's side — the table's placement in the
// `identity` Postgres schema predates the domain split.

import { asc, eq } from "drizzle-orm";
import type {
  UserVendorRefSummary,
  VendorRefStatus,
} from "@straumvakt/shared/domain/users";
import type { Db } from "../../../lib/drizzle";
import { userVendorRefs } from "@straumvakt/shared/db/identity";

interface UserVendorRefRow {
  id: string;
  userId: string;
  vendorSlug: string;
  vendorUserId: string;
  vendorEmail: string | null;
  vendorRoleHint: string | null;
  scopeInstallationId: string | null;
  status: VendorRefStatus;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(row: UserVendorRefRow): UserVendorRefSummary {
  return {
    id: row.id,
    userId: row.userId,
    vendorSlug: row.vendorSlug,
    vendorUserId: row.vendorUserId,
    vendorEmail: row.vendorEmail,
    vendorRoleHint: row.vendorRoleHint,
    scopeInstallationId: row.scopeInstallationId,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const COLUMNS = {
  id: userVendorRefs.id,
  userId: userVendorRefs.userId,
  vendorSlug: userVendorRefs.vendorSlug,
  vendorUserId: userVendorRefs.vendorUserId,
  vendorEmail: userVendorRefs.vendorEmail,
  vendorRoleHint: userVendorRefs.vendorRoleHint,
  scopeInstallationId: userVendorRefs.scopeInstallationId,
  status: userVendorRefs.status,
  lastSyncedAt: userVendorRefs.lastSyncedAt,
  createdAt: userVendorRefs.createdAt,
  updatedAt: userVendorRefs.updatedAt,
} as const;

export async function createUserVendorRef(
  db: Db,
  input: {
    userId: string;
    vendorSlug: string;
    vendorUserId: string;
    vendorEmail?: string;
    vendorRoleHint?: string;
    scopeInstallationId?: string;
    status?: VendorRefStatus;
  },
): Promise<UserVendorRefSummary> {
  const [row] = await db
    .insert(userVendorRefs)
    .values({
      userId: input.userId,
      vendorSlug: input.vendorSlug,
      vendorUserId: input.vendorUserId,
      vendorEmail: input.vendorEmail ?? null,
      vendorRoleHint: input.vendorRoleHint ?? null,
      scopeInstallationId: input.scopeInstallationId ?? null,
      status: input.status ?? "active",
      // last_synced_at is NOT NULL with a database default of now(); a row
      // created here has by definition just been synced.
    })
    .returning(COLUMNS);
  return toSummary(row as UserVendorRefRow);
}

export async function listUserVendorRefsForUser(
  db: Db,
  userId: string,
): Promise<UserVendorRefSummary[]> {
  const rows = await db
    .select(COLUMNS)
    .from(userVendorRefs)
    .where(eq(userVendorRefs.userId, userId))
    .orderBy(asc(userVendorRefs.createdAt));
  return (rows as UserVendorRefRow[]).map(toSummary);
}
