/**
 * Memberships repository — `tenancy.memberships` per `withOrgContext`.
 *
 * Composite primary key (orgId, userId). Role drives nav restrictions
 * post-pilot; in pilot all roles are inert beyond audit-trail
 * categorisation per ADR 0006.
 */
import type { MembershipRole } from "@prisma/client";
import { withOrgContext } from "./_context";
import {
  MembershipCreateInput,
  MembershipUpdateInput,
} from "@/lib/repositories/_inputs/memberships";
import { recordAuditAction } from "@/lib/repositories/audit-actions";

export interface MembershipSummary {
  orgId: string;
  userId: string;
  role: MembershipRole;
  createdAt: string;
  user: {
    email: string;
    displayName: string | null;
    status: string;
  };
}

export async function listMembershipsForOrg(
  orgId: string,
): Promise<MembershipSummary[]> {
  return withOrgContext(orgId, async ({ db, requireOrg }) => {
    const rows = await db.membership.findMany({
      where: requireOrg({}),
      include: {
        user: {
          select: { email: true, displayName: true, status: true },
        },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((m) => ({
      orgId: m.orgId,
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      user: {
        email: m.user.email,
        displayName: m.user.displayName,
        status: m.user.status,
      },
    }));
  });
}

export async function addMembership(
  orgId: string,
  input: MembershipCreateInput,
  actorUserId: string | null,
): Promise<MembershipSummary> {
  return withOrgContext(orgId, async ({ db, requireOrg, orgId: tenant }) => {
    const created = await db.membership.create({
      data: {
        ...requireOrg({}),
        userId: input.userId,
        role: input.role,
      },
      include: {
        user: { select: { email: true, displayName: true, status: true } },
      },
    });
    await recordAuditAction({
      orgId: tenant,
      actorUserId,
      actorKind: "user",
      action: "membership.create",
      targetType: "membership",
      targetId: input.userId,
      metadata: { role: input.role, userEmail: created.user.email },
    });
    return {
      orgId: created.orgId,
      userId: created.userId,
      role: created.role,
      createdAt: created.createdAt.toISOString(),
      user: {
        email: created.user.email,
        displayName: created.user.displayName,
        status: created.user.status,
      },
    };
  });
}

export async function updateMembershipRole(
  orgId: string,
  userId: string,
  patch: MembershipUpdateInput,
  actorUserId: string | null,
): Promise<MembershipSummary> {
  return withOrgContext(orgId, async ({ db, requireOrg, orgId: tenant }) => {
    const result = await db.membership.updateMany({
      where: requireOrg({ userId }),
      data: { role: patch.role },
    });
    if (result.count === 0) {
      throw new Error(
        `Membership for user ${userId} in org ${tenant} not found.`,
      );
    }
    const updated = await db.membership.findFirstOrThrow({
      where: requireOrg({ userId }),
      include: {
        user: { select: { email: true, displayName: true, status: true } },
      },
    });
    await recordAuditAction({
      orgId: tenant,
      actorUserId,
      actorKind: "user",
      action: "membership.update",
      targetType: "membership",
      targetId: userId,
      metadata: { role: patch.role },
    });
    return {
      orgId: updated.orgId,
      userId: updated.userId,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      user: {
        email: updated.user.email,
        displayName: updated.user.displayName,
        status: updated.user.status,
      },
    };
  });
}

export async function removeMembership(
  orgId: string,
  userId: string,
  actorUserId: string | null,
): Promise<void> {
  return withOrgContext(orgId, async ({ db, requireOrg, orgId: tenant }) => {
    const result = await db.membership.deleteMany({
      where: requireOrg({ userId }),
    });
    if (result.count === 0) {
      throw new Error(
        `Membership for user ${userId} in org ${tenant} not found.`,
      );
    }
    await recordAuditAction({
      orgId: tenant,
      actorUserId,
      actorKind: "user",
      action: "membership.remove",
      targetType: "membership",
      targetId: userId,
      metadata: {},
    });
  });
}
