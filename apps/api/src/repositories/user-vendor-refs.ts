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

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type {
  UserVendorRefSummary,
  VendorRefStatus,
} from "@straumvakt/shared/domain/users";

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

export async function createUserVendorRef(
  db: PrismaClient,
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
  const data: Prisma.UserVendorRefUncheckedCreateInput = {
    userId: input.userId,
    vendorSlug: input.vendorSlug,
    vendorUserId: input.vendorUserId,
    vendorEmail: input.vendorEmail ?? null,
    vendorRoleHint: input.vendorRoleHint ?? null,
    scopeInstallationId: input.scopeInstallationId ?? null,
    status: input.status ?? "active",
  };
  const row = (await db.userVendorRef.create({ data })) as UserVendorRefRow;
  return toSummary(row);
}

export async function listUserVendorRefsForUser(
  db: PrismaClient,
  userId: string,
): Promise<UserVendorRefSummary[]> {
  const rows = (await db.userVendorRef.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
  })) as UserVendorRefRow[];
  return rows.map(toSummary);
}
