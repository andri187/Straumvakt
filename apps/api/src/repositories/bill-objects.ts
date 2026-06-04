// ADR 0029 — BillObject (billing-home) repository.
//
// The BILLING spine: who pays for a driver's charging. A BillObject is a
// unit/apartment/stall (multi-dwelling) or company/department/cost-center
// (company host), owned by exactly one owner of record (user XOR org).
// Drivers are attached via history-preserving BillObjectMember rows.
//
// Org-scoped (Rule 7): orgId (= host org) is the first argument on every
// function. The owner at-most-one rule is enforced by a DB CHECK
// (bill_objects_owner_at_most_one); routes validate the shape up front.

import type { PrismaClient } from "../generated/prisma/client";
import type {
  BillObjectKind,
  BillObjectMemberSummary,
  BillObjectOwner,
  BillObjectSummary,
} from "@straumvakt/shared/domain/bill-objects";

export interface CreateBillObjectInput {
  kind: BillObjectKind;
  label: string;
  installationId?: string | null;
  parentId?: string | null;
  ownerUserId?: string | null;
  ownerOrgId?: string | null;
}

interface BillObjectRow {
  id: string;
  orgId: string;
  installationId: string | null;
  kind: BillObjectKind;
  label: string;
  parentId: string | null;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

interface BillObjectMemberRow {
  id: string;
  billObjectId: string;
  userId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

function ownerOf(row: BillObjectRow): BillObjectOwner {
  if (row.ownerUserId) return { kind: "user", userId: row.ownerUserId };
  if (row.ownerOrgId) return { kind: "org", orgId: row.ownerOrgId };
  return { kind: "none" };
}

function toSummary(row: BillObjectRow): BillObjectSummary {
  return {
    id: row.id,
    orgId: row.orgId,
    installationId: row.installationId,
    kind: row.kind,
    label: row.label,
    parentId: row.parentId,
    owner: ownerOf(row),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMemberSummary(row: BillObjectMemberRow): BillObjectMemberSummary {
  return {
    id: row.id,
    billObjectId: row.billObjectId,
    userId: row.userId,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
  };
}

export async function createBillObject(
  db: PrismaClient,
  orgId: string,
  input: CreateBillObjectInput,
): Promise<BillObjectSummary> {
  const row = (await db.billObject.create({
    data: {
      orgId,
      installationId: input.installationId ?? null,
      kind: input.kind,
      label: input.label,
      parentId: input.parentId ?? null,
      ownerUserId: input.ownerUserId ?? null,
      ownerOrgId: input.ownerOrgId ?? null,
    },
  })) as BillObjectRow;
  return toSummary(row);
}

export async function listBillObjectsForOrg(
  db: PrismaClient,
  orgId: string,
  options: { installationId?: string } = {},
): Promise<BillObjectSummary[]> {
  const rows = (await db.billObject.findMany({
    where: {
      orgId,
      ...(options.installationId
        ? { installationId: options.installationId }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  })) as BillObjectRow[];
  return rows.map(toSummary);
}

export async function getBillObject(
  db: PrismaClient,
  orgId: string,
  id: string,
): Promise<BillObjectSummary | null> {
  const row = (await db.billObject.findUnique({
    where: { id },
  })) as BillObjectRow | null;
  // Tenant guard: never leak another host's bill object.
  if (!row || row.orgId !== orgId) return null;
  return toSummary(row);
}

export interface AssignDriverResult {
  member: BillObjectMemberSummary;
  created: boolean;
  closedPrevious: number;
}

/**
 * Attach a driver to a billing home, enforcing ADR 0029 §5 — at most one
 * ACTIVE billing home per host. If the driver already has an active
 * membership in a *different* BillObject of this org, it is closed
 * (effectiveTo = now) and a new one opened. Idempotent when the driver is
 * already active in this BillObject. Caller (route) verifies the
 * BillObject belongs to orgId and the user is an active driver.
 */
export async function assignDriverToBillObject(
  db: PrismaClient,
  orgId: string,
  billObjectId: string,
  userId: string,
): Promise<AssignDriverResult> {
  return db.$transaction(async (tx) => {
    const active = (await tx.billObjectMember.findMany({
      where: { userId, effectiveTo: null, billObject: { orgId } },
      select: {
        id: true,
        billObjectId: true,
        userId: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    })) as BillObjectMemberRow[];

    const existing = active.find((m) => m.billObjectId === billObjectId);
    if (existing) {
      return { member: toMemberSummary(existing), created: false, closedPrevious: 0 };
    }

    let closedPrevious = 0;
    if (active.length > 0) {
      const res = await tx.billObjectMember.updateMany({
        where: { id: { in: active.map((m) => m.id) } },
        data: { effectiveTo: new Date() },
      });
      closedPrevious = res.count;
    }

    const row = (await tx.billObjectMember.create({
      data: { billObjectId, userId },
    })) as BillObjectMemberRow;

    return { member: toMemberSummary(row), created: true, closedPrevious };
  });
}

export async function listBillObjectMembers(
  db: PrismaClient,
  billObjectId: string,
  options: { includeEnded?: boolean } = {},
): Promise<BillObjectMemberSummary[]> {
  const rows = (await db.billObjectMember.findMany({
    where: {
      billObjectId,
      ...(options.includeEnded ? {} : { effectiveTo: null }),
    },
    orderBy: { effectiveFrom: "desc" },
  })) as BillObjectMemberRow[];
  return rows.map(toMemberSummary);
}
