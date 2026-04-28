import type { Prisma } from "@prisma/client";
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
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

function toCircuitSummary(r: {
  id: string;
  orgId: string;
  organization: { displayName: string };
  siteId: string;
  site: { displayName: string };
  installationId: string | null;
  installation: { displayName: string } | null;
  displayName: string;
  ampereCeiling: number | null;
  phaseCount: number;
  vendorCircuitRef: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CircuitSummary {
  return {
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
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
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
  return rows.map(toCircuitSummary);
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
  return toCircuitSummary(created);
}

import type { CircuitUpdateInput } from "@/lib/repositories/_inputs/circuits";

export async function getCircuitById(id: string): Promise<CircuitSummary | null> {
  const db = prisma();
  const r = await db.circuit.findUnique({
    where: { id },
    include: {
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      installation: { select: { displayName: true } },
    },
  });
  if (!r) return null;
  return toCircuitSummary(r);
}

export async function updateCircuit(
  id: string,
  patch: CircuitUpdateInput,
  actorUserId: string | null,
): Promise<CircuitSummary> {
  const db = prisma();
  const { metadata, ...rest } = patch;
  const updated = await db.circuit.update({
    where: { id },
    data: {
      ...rest,
      ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {}),
    },
    include: {
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      installation: { select: { displayName: true } },
    },
  });
  await recordAuditAction({
    orgId: updated.orgId,
    actorUserId,
    actorKind: "user",
    action: "circuit.update",
    targetType: "circuit",
    targetId: id,
    metadata: { fields: Object.keys(patch) },
  });
  return toCircuitSummary(updated);
}
