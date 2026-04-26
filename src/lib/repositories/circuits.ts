import { prisma } from "@/lib/prisma";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { CircuitCreateInput } from "@/lib/repositories/_inputs/circuits";

export interface CircuitSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  siteId: string;
  siteDisplayName: string;
  installationId: string | null;
  installationDisplayName: string | null;
  displayName: string;
  ampereCeiling: number | null;
  phaseCount: number;
  vendorCircuitRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listAllCircuits(): Promise<CircuitSummary[]> {
  const db = prisma();
  const rows = await db.circuit.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      installation: { select: { displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    siteId: r.siteId,
    siteDisplayName: r.site.displayName,
    installationId: r.installationId,
    installationDisplayName: r.installation?.displayName ?? null,
    displayName: r.displayName,
    ampereCeiling: r.ampereCeiling,
    phaseCount: r.phaseCount,
    vendorCircuitRef: r.vendorCircuitRef,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function listInstallationsBySite(
  siteId: string,
): Promise<{ id: string; displayName: string }[]> {
  const db = prisma();
  return db.installation.findMany({
    where: { siteId },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
}

export async function createCircuit(
  input: CircuitCreateInput,
  actorUserId: string | null,
): Promise<CircuitSummary> {
  const db = prisma();
  const created = await db.circuit.create({
    data: {
      orgId: input.orgId,
      siteId: input.siteId,
      installationId: input.installationId,
      displayName: input.displayName,
      ampereCeiling: input.ampereCeiling,
      phaseCount: input.phaseCount,
      vendorCircuitRef: input.vendorCircuitRef,
    },
    include: {
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      installation: { select: { displayName: true } },
    },
  });
  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "circuit.create",
    targetType: "circuit",
    targetId: created.id,
    metadata: { displayName: created.displayName },
  });
  return {
    id: created.id,
    orgId: created.orgId,
    orgDisplayName: created.organization.displayName,
    siteId: created.siteId,
    siteDisplayName: created.site.displayName,
    installationId: created.installationId,
    installationDisplayName: created.installation?.displayName ?? null,
    displayName: created.displayName,
    ampereCeiling: created.ampereCeiling,
    phaseCount: created.phaseCount,
    vendorCircuitRef: created.vendorCircuitRef,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}
