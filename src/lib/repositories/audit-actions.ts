import type { ActorKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * audit.actions writer — actor-did-what log distinct from events.event_log
 * (which is what-happened). Every admin mutation should emit one.
 *
 * Called directly with `prisma()` (not `withOrgContext`) so it can be
 * invoked from organizations.ts (which itself is platform-admin only and
 * cannot use withOrgContext for the create path). Repositories that DO
 * use withOrgContext can still call this — it tags the row with the
 * caller-supplied orgId.
 */
export interface AuditActionInput {
  orgId: string;
  actorUserId: string | null;
  actorKind: ActorKind;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAuditAction(input: AuditActionInput): Promise<void> {
  const db = prisma();
  await db.auditAction.create({
    data: {
      orgId: input.orgId,
      actorUserId: input.actorUserId ?? null,
      actorKind: input.actorKind,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? {}) as object,
    },
  });
}
