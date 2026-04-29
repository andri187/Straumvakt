// Chargers repository — ported from src/lib/repositories/chargers.ts.
//
// "Charger" here is the operator-facing aggregate spanning ChargingStation
// + EVSE + Connector + OcppIdentity. Create lands all four rows in one
// transaction; list/detail joins them back into a single object.

import type { PrismaClient } from "../generated/prisma/client";
import type {
  ChargerSummary,
  ChargerDetail,
  ChargerCreateResult,
} from "@straumvakt/shared/domain/chargers";
import type {
  ChargerCreateInput,
  ChargerUpdateInput,
} from "@straumvakt/shared/inputs/chargers";
import { sha256Hex } from "../lib/sha256";
import { recordAuditAction } from "../lib/audit";

function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export async function listAllChargers(db: PrismaClient): Promise<ChargerSummary[]> {
  const rows = await db.chargingStation.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      siteAsset: { select: { site: { select: { displayName: true } } } },
      evses: {
        take: 1,
        orderBy: { evseIndex: "asc" },
        include: { connectors: { take: 1, orderBy: { connectorIndex: "asc" } } },
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
  db: PrismaClient,
  siteId: string,
): Promise<{ id: string; displayName: string }[]> {
  return db.circuit.findMany({
    where: { siteId },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
}

export async function getChargerById(
  db: PrismaClient,
  chargingStationId: string,
): Promise<ChargerDetail | null> {
  const r = await db.chargingStation.findUnique({
    where: { siteAssetId: chargingStationId },
    include: {
      organization: { select: { displayName: true } },
      siteAsset: { select: { siteId: true, site: { select: { displayName: true } } } },
      installation: { select: { displayName: true } },
      circuit: { select: { displayName: true } },
      evses: {
        orderBy: { evseIndex: "asc" },
        include: { connectors: { orderBy: { connectorIndex: "asc" } } },
      },
      ocppIdentities: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!r) return null;
  return {
    chargingStationId: r.siteAssetId,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    siteId: r.siteAsset.siteId,
    siteDisplayName: r.siteAsset.site.displayName,
    installationId: r.installationId,
    installationDisplayName: r.installation?.displayName ?? null,
    circuitId: r.circuitId,
    circuitDisplayName: r.circuit?.displayName ?? null,
    vendor: r.vendor,
    model: r.model,
    serialNumber: r.serialNumber,
    firmwareVersion: r.firmwareVersion,
    evses: r.evses.map((e) => ({
      id: e.id,
      evseIndex: e.evseIndex,
      maxPowerKw: e.maxPowerKw?.toString() ?? null,
      phaseCount: e.phaseCount,
      connectors: e.connectors.map((c) => ({
        id: c.id,
        connectorIndex: c.connectorIndex,
        type: c.type,
        maxPowerKw: c.maxPowerKw?.toString() ?? null,
      })),
    })),
    ocppIdentities: r.ocppIdentities.map((i) => ({
      id: i.id,
      identityString: i.identityString,
      ocppVersion: i.ocppVersion,
    })),
  };
}

export async function createCharger(
  db: PrismaClient,
  input: ChargerCreateInput,
  actorUserId: string | null,
): Promise<ChargerCreateResult> {
  const password = generatePassword();
  const authSecretHash = await sha256Hex(password);

  const result = await db.$transaction(async (tx) => {
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

    // Closes the pending-discoveries loop: if the gateway recorded
    // failed auth attempts for this identityString before provision,
    // remove the row in the same transaction. deleteMany is no-op
    // when no row matches.
    await tx.pendingDiscovery.deleteMany({
      where: { identityString: input.identityString },
    });

    return {
      chargingStationId: siteAsset.id,
      evseId: evse.id,
      connectorId: connector.id,
      ocppIdentityId: identity.id,
    };
  });

  await recordAuditAction(db, {
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

export async function updateCharger(
  db: PrismaClient,
  chargingStationId: string,
  patch: ChargerUpdateInput,
  actorUserId: string | null,
): Promise<ChargerDetail> {
  await db.$transaction(async (tx) => {
    const stationData: Record<string, unknown> = {};
    if (patch.stationVendor !== undefined) stationData.vendor = patch.stationVendor;
    if (patch.stationModel !== undefined) stationData.model = patch.stationModel;
    if (patch.stationSerialNumber !== undefined) stationData.serialNumber = patch.stationSerialNumber;
    if (patch.stationFirmwareVersion !== undefined) stationData.firmwareVersion = patch.stationFirmwareVersion;
    if (patch.installationId !== undefined) stationData.installationId = patch.installationId;
    if (patch.circuitId !== undefined) stationData.circuitId = patch.circuitId;
    if (Object.keys(stationData).length > 0) {
      await tx.chargingStation.update({ where: { siteAssetId: chargingStationId }, data: stationData });
    }
    if (patch.evseId) {
      const evseData: Record<string, unknown> = {};
      if (patch.evseMaxPowerKw !== undefined) evseData.maxPowerKw = patch.evseMaxPowerKw;
      if (patch.evsePhaseCount !== undefined) evseData.phaseCount = patch.evsePhaseCount;
      if (Object.keys(evseData).length > 0) {
        await tx.eVSE.update({ where: { id: patch.evseId }, data: evseData });
      }
    }
    if (patch.connectorId) {
      const connData: Record<string, unknown> = {};
      if (patch.connectorType !== undefined) connData.type = patch.connectorType;
      if (patch.connectorMaxPowerKw !== undefined) connData.maxPowerKw = patch.connectorMaxPowerKw;
      if (Object.keys(connData).length > 0) {
        await tx.connector.update({ where: { id: patch.connectorId }, data: connData });
      }
    }
  });
  const result = await getChargerById(db, chargingStationId);
  if (!result) throw new Error("charger not found after update");
  await recordAuditAction(db, {
    orgId: result.orgId,
    actorUserId,
    actorKind: "user",
    action: "charger.update",
    targetType: "charging_station",
    targetId: chargingStationId,
    metadata: { fields: Object.keys(patch) },
  });
  return result;
}

export async function findOcppIdentity(
  db: PrismaClient,
  ocppIdentityId: string,
): Promise<{ id: string; orgId: string; chargingStationId: string } | null> {
  return db.ocppIdentity.findUnique({
    where: { id: ocppIdentityId },
    select: { id: true, orgId: true, chargingStationId: true },
  });
}

export async function findConnectorOnStation(
  db: PrismaClient,
  connectorId: string,
  chargingStationId: string,
): Promise<{ id: string } | null> {
  return db.connector.findFirst({
    where: { id: connectorId, evse: { chargingStationId } },
    select: { id: true },
  });
}
