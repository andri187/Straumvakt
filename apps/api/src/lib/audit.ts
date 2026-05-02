// audit.actions writer — ported from src/lib/repositories/audit-actions.ts.
//
// Every admin mutation that materially changes a row should call this so the
// "who did what" log stays continuous after the cutover.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { ActorKind } from "../generated/prisma/enums";

export interface AuditActionInput {
  orgId: string;
  actorUserId: string | null;
  actorKind: ActorKind;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

// Accept either a PrismaClient or a Prisma.TransactionClient so callers
// inside db.$transaction can write the audit row in the same tx.
type AuditDb =
  | PrismaClient
  | Pick<PrismaClient, "auditAction">
  | Prisma.TransactionClient;

export async function recordAuditAction(
  db: AuditDb,
  input: AuditActionInput,
): Promise<void> {
  await db.auditAction.create({
    data: {
      orgId: input.orgId,
      actorUserId: input.actorUserId ?? null,
      actorKind: input.actorKind,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
