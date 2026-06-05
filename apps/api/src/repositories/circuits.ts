import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { OrgScope } from "../lib/auth/org-scope";
import type { CircuitSummary } from "@straumvakt/shared/domain/circuits";
import type {
  CircuitCreateInput,
  CircuitUpdateInput,
} from "@straumvakt/shared/inputs/circuits";

const include = {
  organization: { select: { displayName: true } },
  site: { select: { displayName: true } },
  installation: { select: { displayName: true } },
} as const;

type Row = {
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
};

function toSummary(r: Row): CircuitSummary {
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

export async function listAllCircuits(
  db: PrismaClient,
  orgScope?: OrgScope,
): Promise<CircuitSummary[]> {
  const rows = await db.circuit.findMany({
    where: orgScope && orgScope.all === false ? { orgId: { in: orgScope.orgIds } } : undefined,
    orderBy: [{ updatedAt: "desc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function listCircuitsBySite(
  db: PrismaClient,
  siteId: string,
): Promise<CircuitSummary[]> {
  const rows = await db.circuit.findMany({
    where: { siteId },
    orderBy: [{ displayName: "asc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function getCircuitById(
  db: PrismaClient,
  id: string,
  orgScope?: OrgScope,
): Promise<CircuitSummary | null> {
  const r = await db.circuit.findUnique({ where: { id }, include });
  if (!r) return null;
  if (orgScope && orgScope.all === false && !orgScope.orgIds.includes(r.orgId)) return null;
  return toSummary(r);
}

export async function createCircuit(
  db: PrismaClient,
  input: CircuitCreateInput,
): Promise<CircuitSummary> {
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
    include,
  });
  return toSummary(created);
}

export async function updateCircuit(
  db: PrismaClient,
  id: string,
  patch: CircuitUpdateInput,
): Promise<CircuitSummary> {
  const { metadata, ...rest } = patch;
  const updated = await db.circuit.update({
    where: { id },
    data: {
      ...rest,
      ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {}),
    },
    include,
  });
  return toSummary(updated);
}

/**
 * Cascade-delete a circuit and the chargers physically anchored on it
 * (ChargingStation.circuitId = id). Operator-confirmed semantics:
 * deleting a circuit removes the chargers under it. SiteAsset cascade
 * reaches EVSE/Connector/OcppIdentity.
 */
export async function deleteCircuit(db: PrismaClient, id: string): Promise<void> {
  await db.$transaction(
    async (tx) => {
      const stations = await tx.chargingStation.findMany({
        where: { circuitId: id },
        select: { siteAssetId: true },
      });
      const siteAssetIds = stations.map((s) => s.siteAssetId);
      if (siteAssetIds.length > 0) {
        await tx.siteAsset.deleteMany({ where: { id: { in: siteAssetIds } } });
      }
      await tx.circuit.delete({ where: { id } });
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}
