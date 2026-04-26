import { prisma } from "@/lib/prisma";
import { sha256Hex } from "@/lib/ocpp/internal-auth";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { ChargerCreateInput } from "@/lib/repositories/_inputs/chargers";

export interface ChargerSummary {
  chargingStationId: string;
  evseId: string;
  connectorId: string;
  ocppIdentityId: string;
  identityString: string;
  orgDisplayName: string;
  siteDisplayName: string;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  connectorType: string;
  ocppVersion: string;
  createdAt: string;
}

export interface ChargerCreateResult extends ChargerSummary {
  ocppPassword: string;
}

function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export async function listAllChargers(): Promise<ChargerSummary[]> {
  const db = prisma();
  const rows = await db.chargingStation.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      siteAsset: { select: { site: { select: { displayName: true } } } },
      evses: {
        take: 1,
        orderBy: { evseIndex: "asc" },
        include: {
          connectors: { take: 1, orderBy: { connectorIndex: "asc" } },
        },
      },
      ocppIdentities: { take: 1, orderBy: { createdAt: "asc" } },
    },
  });
  return rows.map((r) => ({
    chargingStationId: r.siteAssetId,
    evseId: r.evses[0]?.id ?? "",
    connectorId: r.evses[0]?.connectors[0]?.id ?? "",
    ocppIdentityId: r.ocppIdentities[0]?.id ?? "",
    identityString: r.ocppIdentities[0]?.identityString ?? "—",
    orgDisplayName: r.organization.displayName,
    siteDisplayName: r.siteAsset.site.displayName,
    vendor: r.vendor,
    model: r.model,
    serialNumber: r.serialNumber,
    connectorType: r.evses[0]?.connectors[0]?.type ?? "—",
    ocppVersion: r.ocppIdentities[0]?.ocppVersion ?? "—",
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listSiteCircuits(
  siteId: string,
): Promise<{ id: string; displayName: string }[]> {
  const db = prisma();
  return db.circuit.findMany({
    where: { siteId },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
}

export async function createCharger(
  input: ChargerCreateInput,
  actorUserId: string | null,
): Promise<ChargerCreateResult> {
  const password = generatePassword();
  const authSecretHash = await sha256Hex(password);

  const result = await prisma().$transaction(async (tx) => {
    const siteAsset = await tx.siteAsset.create({
      data: {
        orgId: input.orgId,
        siteId: input.siteId,
        kind: "charger",
        displayName: input.identityString,
      },
      select: { id: true },
    });

    await tx.chargingStation.create({
      data: {
        siteAssetId: siteAsset.id,
        orgId: input.orgId,
        installationId: input.installationId,
        circuitId: input.circuitId,
        vendor: input.stationVendor,
        model: input.stationModel,
        serialNumber: input.stationSerialNumber,
        firmwareVersion: input.stationFirmwareVersion,
      },
    });

    const evse = await tx.eVSE.create({
      data: {
        orgId: input.orgId,
        chargingStationId: siteAsset.id,
        evseIndex: input.evseIndex,
        maxPowerKw: input.evseMaxPowerKw,
        phaseCount: input.evsePhaseCount,
      },
      select: { id: true },
    });

    const connector = await tx.connector.create({
      data: {
        orgId: input.orgId,
        evseId: evse.id,
        connectorIndex: input.connectorIndex,
        type: input.connectorType,
        maxPowerKw: input.connectorMaxPowerKw,
      },
      select: { id: true },
    });

    const identity = await tx.ocppIdentity.create({
      data: {
        orgId: input.orgId,
        chargingStationId: siteAsset.id,
        identityString: input.identityString,
        authSecretHash,
        ocppVersion: input.ocppVersion,
        assetClass: input.assetClass,
      },
      select: { id: true },
    });

    return { chargingStationId: siteAsset.id, evseId: evse.id, connectorId: connector.id, ocppIdentityId: identity.id };
  });

  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "charger.create",
    targetType: "charging_station",
    targetId: result.chargingStationId,
    metadata: { identityString: input.identityString, vendor: input.stationVendor, model: input.stationModel },
  });

  return {
    ...result,
    identityString: input.identityString,
    orgDisplayName: "",
    siteDisplayName: "",
    vendor: input.stationVendor,
    model: input.stationModel,
    serialNumber: input.stationSerialNumber,
    connectorType: input.connectorType,
    ocppVersion: input.ocppVersion,
    createdAt: new Date().toISOString(),
    ocppPassword: password,
  };
}
