// Repository — agreements.driver_group_memberships CRUD.
//
// Exposes:
//   createMembership   — idempotent upsert, returns { membership, created }
//   listMembershipsForDriverGroup — page of members for a group
//   removeMembership   — used by the DELETE endpoint

import type { PrismaClient } from "../generated/prisma/client";
import type { DriverGroupMembership } from "../generated/prisma/client";

// ─── Output shapes ───────────────────────────────────────────────────────────

export interface MembershipRow {
  id: string;
  driverGroupId: string;
  userId: string;
  addedAt: string; // ISO-8601
}

export interface CreateMembershipResult {
  membership: MembershipRow;
  created: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toRow(m: DriverGroupMembership): MembershipRow {
  return {
    id: m.id,
    driverGroupId: m.driverGroupId,
    userId: m.userId,
    addedAt: m.addedAt.toISOString(),
  };
}

// ─── createMembership ────────────────────────────────────────────────────────

export interface CreateMembershipInput {
  driverGroupId: string;
  userId: string;
}

/**
 * Idempotent create. If a membership for this (driverGroupId, userId) pair
 * already exists, returns it with created=false. Otherwise inserts and
 * returns with created=true. Callers never get a duplicate-key error.
 */
export async function createMembership(
  db: PrismaClient,
  input: CreateMembershipInput,
): Promise<CreateMembershipResult> {
  // Check for existing before attempting create so we can distinguish
  // "already existed" from a fresh insert without relying on upsert
  // semantics that would mask concurrent inserts behind a silent no-op.
  const existing = await db.driverGroupMembership.findUnique({
    where: {
      driverGroupId_userId: {
        driverGroupId: input.driverGroupId,
        userId: input.userId,
      },
    },
  });

  if (existing) {
    return { membership: toRow(existing), created: false };
  }

  const created = await db.driverGroupMembership.create({
    data: {
      driverGroupId: input.driverGroupId,
      userId: input.userId,
    },
  });

  return { membership: toRow(created), created: true };
}

// ─── listMembershipsForDriverGroup ───────────────────────────────────────────

export interface ListMembershipsOptions {
  limit?: number;
}

/**
 * Returns memberships for a single DriverGroup, ordered by addedAt desc.
 * Useful for the "members" tab on the group detail page.
 */
export async function listMembershipsForDriverGroup(
  db: PrismaClient,
  driverGroupId: string,
  options: ListMembershipsOptions = {},
): Promise<MembershipRow[]> {
  const rows = await db.driverGroupMembership.findMany({
    where: { driverGroupId },
    orderBy: { addedAt: "desc" },
    take: options.limit ?? 100,
  });
  return rows.map(toRow);
}

// ─── removeMembership ────────────────────────────────────────────────────────

/**
 * Deletes a membership row by its primary key. No-ops silently when the
 * row has already been removed (idempotent delete).
 */
export async function removeMembership(
  db: PrismaClient,
  id: string,
): Promise<void> {
  await db.driverGroupMembership.delete({ where: { id } }).catch((err: unknown) => {
    // P2025 = "Record to delete does not exist." — treat as success.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: unknown }).code === "P2025"
    ) {
      return;
    }
    throw err;
  });
}
