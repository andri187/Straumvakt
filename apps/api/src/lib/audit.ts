// audit.actions writer — ported from src/lib/repositories/audit-actions.ts.
//
// Every admin mutation that materially changes a row should call this so the
// "who did what" log stays continuous after the cutover.
//
// ── DUAL-CLIENT, DELIBERATELY (2026-08-07) ──────────────────────────────
//
// This is called from 15 files. If it took only a Prisma client, every one
// of those 15 would have to move to Drizzle in the same commit as the first
// one — a big-bang the port cannot afford. If it took only a Drizzle client,
// the same problem in reverse.
//
// So it takes either, and picks at runtime. That is what makes the rest of
// the migration incremental: a repository can port to Drizzle on its own
// schedule and keep writing audit rows, and the ones still on Prisma keep
// working untouched.
//
// This shim is temporary. When the last Prisma caller is gone, delete the
// branch and the `AuditPrismaDb` type with it.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { ActorKind } from "../generated/prisma/enums";
import type { Db } from "./drizzle";
import { actions } from "@straumvakt/shared/db/platform";

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
type AuditPrismaDb =
  | PrismaClient
  | Pick<PrismaClient, "auditAction">
  | Prisma.TransactionClient;

/** A Drizzle client or a Drizzle transaction handle. */
export type AuditDrizzleDb = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type AuditDb = AuditPrismaDb | AuditDrizzleDb;

/**
 * Drizzle exposes `.insert()`; Prisma does not. Prisma exposes model
 * accessors like `.auditAction`. Testing for the method rather than for
 * `.auditAction` means a Prisma *transaction* handle — which carries the
 * model accessors but not much else — still takes the Prisma branch.
 */
function isDrizzle(db: AuditDb): db is AuditDrizzleDb {
  return typeof (db as Partial<Db>).insert === "function";
}

export async function recordAuditAction(
  db: AuditDb,
  input: AuditActionInput,
): Promise<void> {
  if (isDrizzle(db)) {
    await db.insert(actions).values({
      orgId: input.orgId,
      actorUserId: input.actorUserId ?? null,
      actorKind: input.actorKind,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
    });
    return;
  }

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
