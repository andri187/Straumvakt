import { prisma } from "@/lib/prisma";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { DriverContractCreateInput } from "@/lib/repositories/_inputs/driver-contracts";

export interface DriverContractSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  userId: string;
  userEmail: string | null;
  ownerType: string;
  ownerId: string;
  displayName: string;
  status: string;
  wrkpfTariffId: string | null;
  validFrom: string;
  validUntil: string | null;
}

export async function listAllDriverContracts(): Promise<DriverContractSummary[]> {
  const db = prisma();
  const rows = await db.driverContract.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      user: { select: { email: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    userId: r.userId,
    userEmail: r.user?.email ?? null,
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    displayName: r.displayName,
    status: r.status,
    wrkpfTariffId: r.wrkpfTariffId,
    validFrom: r.validFrom.toISOString(),
    validUntil: r.validUntil?.toISOString() ?? null,
  }));
}

export async function listUsersForOrg(orgId: string): Promise<{ id: string; label: string }[]> {
  const db = prisma();
  const rows = await db.membership.findMany({
    where: { orgId },
    select: { user: { select: { id: true, email: true, displayName: true } } },
    orderBy: { user: { displayName: "asc" } },
  });
  return rows.map((m) => ({
    id: m.user.id,
    label: `${m.user.displayName ?? "—"} <${m.user.email ?? "no-email"}>`,
  }));
}

export async function createDriverContract(
  input: DriverContractCreateInput,
  actorUserId: string | null,
): Promise<DriverContractSummary> {
  const db = prisma();
  const created = await db.driverContract.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      wrkpfTariffId: input.wrkpfTariffId,
      displayName: input.displayName,
      status: input.status,
      validFrom: new Date(input.validFrom),
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    },
    include: {
      organization: { select: { displayName: true } },
      user: { select: { email: true } },
    },
  });
  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "driver-contract.create",
    targetType: "driver_contract",
    targetId: created.id,
    metadata: { ownerType: created.ownerType, displayName: created.displayName },
  });
  return {
    id: created.id,
    orgId: created.orgId,
    orgDisplayName: created.organization.displayName,
    userId: created.userId,
    userEmail: created.user?.email ?? null,
    ownerType: created.ownerType,
    ownerId: created.ownerId,
    displayName: created.displayName,
    status: created.status,
    wrkpfTariffId: created.wrkpfTariffId,
    validFrom: created.validFrom.toISOString(),
    validUntil: created.validUntil?.toISOString() ?? null,
  };
}
