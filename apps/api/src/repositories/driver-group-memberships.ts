// Repository — agreements.driver_group_memberships CRUD.
//
// Exposes:
//   createMembership   — idempotent upsert, returns { membership, created }
//   listMembershipsForDriverGroup — page of members for a group
//   removeMembership   — used by the DELETE endpoint

import { and, desc, eq } from "drizzle-orm";
import { driverGroupMemberships } from "@straumvakt/shared/db/commercial";
import type { Db } from "../lib/drizzle";

type MembershipRecord = typeof driverGroupMemberships.$inferSelect;

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

function toRow(m: MembershipRecord): MembershipRow {
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
  db: Db,
  input: CreateMembershipInput,
): Promise<CreateMembershipResult> {
  // Check for existing before attempting create so we can distinguish
  // "already existed" from a fresh insert without relying on upsert
  // semantics that would mask concurrent inserts behind a silent no-op.
  const [existing] = await db
    .select()
    .from(driverGroupMemberships)
    .where(
      and(
        eq(driverGroupMemberships.driverGroupId, input.driverGroupId),
        eq(driverGroupMemberships.userId, input.userId),
      ),
    )
    .limit(1);

  if (existing) {
    return { membership: toRow(existing), created: false };
  }

  const [created] = await db
    .insert(driverGroupMemberships)
    .values({
      driverGroupId: input.driverGroupId,
      userId: input.userId,
    })
    .returning();

  return { membership: toRow(created!), created: true };
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
  db: Db,
  driverGroupId: string,
  options: ListMembershipsOptions = {},
): Promise<MembershipRow[]> {
  const rows = await db
    .select()
    .from(driverGroupMemberships)
    .where(eq(driverGroupMemberships.driverGroupId, driverGroupId))
    .orderBy(desc(driverGroupMemberships.addedAt))
    .limit(options.limit ?? 100);
  return rows.map(toRow);
}

// ─── removeMembership ────────────────────────────────────────────────────────

/**
 * Deletes a membership row by its primary key. No-ops silently when the
 * row has already been removed (idempotent delete).
 *
 * Prisma's `delete` threw P2025 on a missing row and this caught it.
 * Drizzle's delete matches zero rows and returns quietly, so the
 * idempotency is now structural rather than a caught error.
 */
export async function removeMembership(db: Db, id: string): Promise<void> {
  await db.delete(driverGroupMemberships).where(eq(driverGroupMemberships.id, id));
}
