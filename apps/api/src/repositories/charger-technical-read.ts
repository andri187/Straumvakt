// Pulls live Zaptec telemetry for a single charger. Joins:
//   ChargingStation → OcppIdentity (vendorResourceId = Zaptec UUID)
//   ChargingStation → orgId → active Zaptec VendorCredential
// then unseals the credential, hits Zaptec /api/chargers/:id and
// /api/chargers/:id/state in parallel, and maps the raw response
// into the ChargerTechnicalRead shape.
//
// Returns `{ fresh: false, ... }` with all fields null when Zaptec is
// unreachable, the credential is missing, or this charger isn't a
// Zaptec asset. Never throws — callers always render the panel,
// just with placeholder values.

import type { PrismaClient } from "../generated/prisma/client";
import type { ChargerTechnicalRead } from "@straumvakt/shared/domain/charger-technical-read";
import {
  getChargerDetail,
  getChargerState,
  getZaptecAccessToken,
  type ZaptecStateEntry,
} from "../lib/zaptec";
import { openPassword } from "../lib/credential-crypto";

const STATE_IDS = {
  IsOnline: -2,
  IsOcppConnected: -3,
  CommunicationMode: 150,
  InternalTempA: 201,
  InternalTempB: 202,
  TotalChargePower: 513,
  VoltagePhase1: 501, VoltagePhase2: 502, VoltagePhase3: 503,
  CurrentPhase1: 507, CurrentPhase2: 508, CurrentPhase3: 509,
  ChargerMaxCurrent: 510,
  ChargeCurrentSet: 708,
  TotalChargePowerSession: 553,
  ChargerOperationMode: 710,
  IsEnabled: 711,
  NetworkType: 715,
  Notifications: 803,
  Warnings: 804,
  CommunicationSignalStrength: 809,
  UptimeVariscite: 820,
  FirmwareVersion: 911,
  MacMain: 950,
  MacWifi: 952,
  LteIccid: 962,
  LteImsi: 960,
  MidCalibrationID: 982,
} as const;

const OPERATION_MODES: Record<string, string> = {
  "0": "Unknown",
  "1": "Disconnected",
  "2": "Connected (Requesting)",
  "3": "Charging",
  "5": "Connected (Finished)",
  "6": "Connected (Limited)",
};
const NETWORK_TYPES: Record<string, string> = {
  "0": "Unknown",
  "1": "IT 1-phase",
  "2": "IT 3-phase",
  "3": "TN 1-phase",
  "4": "TN 3-phase",
};
const COMM_MODES: Record<string, string> = {
  "0": "None",
  "1": "Wi-Fi",
  "2": "LTE",
  "3": "PLC",
  "4": "Ethernet",
};

function emptyRead(): ChargerTechnicalRead {
  return {
    fresh: false,
    fetchedAt: new Date().toISOString(),
    signalDbm: null,
    communicationMode: null,
    ocppConnected: null,
    firmwareVersion: null,
    networkType: null,
    internalTemperatureC: null,
    chargerOperationMode: null,
    isOnline: null,
    isEnabled: null,
    totalChargePowerW: null,
    totalChargeEnergySessionKWh: null,
    phases: [
      { voltageV: null, currentA: null },
      { voltageV: null, currentA: null },
      { voltageV: null, currentA: null },
    ],
    chargerMaxCurrentA: null,
    chargeCurrentSetA: null,
    serialNo: null,
    deviceId: null,
    mid: null,
    macMain: null,
    macWifi: null,
    lteIccid: null,
    lteImsi: null,
    uptimeHours: null,
    propertyOcppUrl: null,
    propertyAuthenticationDisabled: null,
    isAuthorizationRequired: null,
    warningsBitmask: null,
  };
}

function pickState(state: ZaptecStateEntry[], id: number): string | null {
  const e = state.find((s) => s.StateId === id);
  if (!e) return null;
  if (typeof e.ValueAsString !== "string") return null;
  return e.ValueAsString;
}
function pickStateNumber(state: ZaptecStateEntry[], id: number): number | null {
  const v = pickState(state, id);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pickStateBool(state: ZaptecStateEntry[], id: number): boolean | null {
  const v = pickState(state, id);
  if (v == null) return null;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}
/** CommunicationMode (150) returns either a numeric code or the literal label — accept both. */
function decodeCommMode(state: ZaptecStateEntry[]): string | null {
  const v = pickState(state, STATE_IDS.CommunicationMode);
  if (v == null) return null;
  if (v in COMM_MODES) return COMM_MODES[v];
  return v; // already a label like "PLC"
}

export async function getChargerTechnicalRead(
  db: PrismaClient,
  chargingStationId: string,
  kek: string,
): Promise<ChargerTechnicalRead> {
  // 1) Resolve the Zaptec UUID + orgId via the charger's OcppIdentity.
  const station = await db.chargingStation.findUnique({
    where: { siteAssetId: chargingStationId },
    select: {
      orgId: true,
      ocppIdentities: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: { vendorResourceId: true, vendor: true },
      },
    },
  });
  if (!station) return emptyRead();

  const identity = station.ocppIdentities[0];
  const vendorResourceId = identity?.vendorResourceId ?? null;
  if (!vendorResourceId || identity?.vendor !== "Zaptec") return emptyRead();

  // 2) Find the org's active Zaptec credential.
  const credential = await db.vendorCredential.findFirst({
    where: {
      ownerOrgId: station.orgId,
      status: "active",
      vendor: { slug: "zaptec" },
    },
    select: { username: true, passwordCipher: true, passwordIv: true },
    orderBy: { lastUsedAt: "desc" },
  });
  if (!credential || !credential.passwordCipher || !credential.passwordIv) return emptyRead();

  // 3) Unseal + auth Zaptec. Defensive try/catch — on any failure
  //    we return placeholders rather than 500ing the operator's
  //    detail page.
  try {
    const password = await openPassword(kek, {
      cipher: credential.passwordCipher,
      iv: credential.passwordIv,
    });
    const tokenResult = await getZaptecAccessToken(credential.username, password);
    if (!tokenResult.ok) return emptyRead();

    const [detailRes, stateRes] = await Promise.all([
      getChargerDetail(tokenResult.value, vendorResourceId),
      getChargerState(tokenResult.value, vendorResourceId),
    ]);

    const detail = detailRes.ok ? detailRes.value ?? {} : {};
    const state = stateRes.ok ? stateRes.value : [];

    const tempA = pickStateNumber(state, STATE_IDS.InternalTempA);
    const tempB = pickStateNumber(state, STATE_IDS.InternalTempB);

    const phaseV1 = pickStateNumber(state, STATE_IDS.VoltagePhase1);
    const phaseV2 = pickStateNumber(state, STATE_IDS.VoltagePhase2);
    const phaseV3 = pickStateNumber(state, STATE_IDS.VoltagePhase3);
    const phaseI1 = pickStateNumber(state, STATE_IDS.CurrentPhase1);
    const phaseI2 = pickStateNumber(state, STATE_IDS.CurrentPhase2);
    const phaseI3 = pickStateNumber(state, STATE_IDS.CurrentPhase3);

    const opModeRaw = pickState(state, STATE_IDS.ChargerOperationMode);
    const networkRaw = pickState(state, STATE_IDS.NetworkType);
    const totalEnergyWh = pickStateNumber(state, STATE_IDS.TotalChargePowerSession);
    const notifications = pickStateNumber(state, STATE_IDS.Notifications);
    const warnings = pickStateNumber(state, STATE_IDS.Warnings);

    const d = detail as Record<string, unknown>;

    return {
      fresh: true,
      fetchedAt: new Date().toISOString(),
      signalDbm: pickStateNumber(state, STATE_IDS.CommunicationSignalStrength),
      communicationMode: decodeCommMode(state),
      ocppConnected: pickStateBool(state, STATE_IDS.IsOcppConnected),
      firmwareVersion:
        pickState(state, STATE_IDS.FirmwareVersion) ??
        (typeof d.SmartComputerSoftwareApplicationVersion === "string"
          ? (d.SmartComputerSoftwareApplicationVersion as string)
          : null),
      networkType: networkRaw != null ? (NETWORK_TYPES[networkRaw] ?? networkRaw) : null,
      internalTemperatureC: tempA ?? tempB,
      chargerOperationMode: opModeRaw != null ? (OPERATION_MODES[opModeRaw] ?? opModeRaw) : null,
      isOnline: pickStateBool(state, STATE_IDS.IsOnline),
      isEnabled: pickStateBool(state, STATE_IDS.IsEnabled),
      totalChargePowerW: pickStateNumber(state, STATE_IDS.TotalChargePower),
      totalChargeEnergySessionKWh: totalEnergyWh != null ? totalEnergyWh / 1000 : null,
      phases: [
        { voltageV: phaseV1, currentA: phaseI1 },
        { voltageV: phaseV2, currentA: phaseI2 },
        { voltageV: phaseV3, currentA: phaseI3 },
      ],
      chargerMaxCurrentA: pickStateNumber(state, STATE_IDS.ChargerMaxCurrent),
      chargeCurrentSetA: pickStateNumber(state, STATE_IDS.ChargeCurrentSet),
      serialNo: typeof d.SerialNo === "string" ? d.SerialNo : null,
      deviceId: typeof d.DeviceId === "string" ? d.DeviceId : null,
      mid: pickState(state, STATE_IDS.MidCalibrationID),
      macMain: pickState(state, STATE_IDS.MacMain),
      macWifi: pickState(state, STATE_IDS.MacWifi),
      lteIccid: pickState(state, STATE_IDS.LteIccid),
      lteImsi: pickState(state, STATE_IDS.LteImsi),
      uptimeHours: pickStateNumber(state, STATE_IDS.UptimeVariscite),
      propertyOcppUrl: typeof d.PropertyOcppUrl === "string" ? d.PropertyOcppUrl : null,
      propertyAuthenticationDisabled:
        typeof d.PropertyAuthenticationDisabled === "boolean"
          ? d.PropertyAuthenticationDisabled
          : null,
      isAuthorizationRequired:
        typeof d.IsAuthorizationRequired === "boolean" ? d.IsAuthorizationRequired : null,
      warningsBitmask: warnings ?? notifications,
    };
  } catch (err) {
    console.error("[charger-technical-read] zaptec fetch failed", {
      chargingStationId,
      vendorResourceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return emptyRead();
  }
}
