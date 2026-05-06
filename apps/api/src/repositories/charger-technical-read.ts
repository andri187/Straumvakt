// Pulls live Zaptec telemetry for a single charger. Joins:
//   ChargingStation → OcppIdentity (vendorResourceId = Zaptec UUID)
//   ChargingStation → orgId → active Zaptec VendorCredential
// then unseals the credential, hits Zaptec /api/chargers/:id and
// /api/chargers/:id/state in parallel, and maps the raw response
// into the ChargerTechnicalRead shape.
//
// Sprint 8.4.3 — caches the last successful read on
// ChargingStation.lastTelemetryRead + lastTelemetryAt. When a fresh
// fetch fails (charger offline from Zaptec's cloud / rate limit /
// transient network), the cached read is returned with `fresh: false`
// and `cachedAt` set so the panel can render last-known values with
// a stale-marker badge instead of em-dashes.

import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type {
  ChargerTechnicalRead,
  ChargerInstallationSnapshot,
} from "@straumvakt/shared/domain/charger-technical-read";
import {
  getChargerDetail,
  getChargerState,
  getInstallationSummary,
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
  AuthenticationListVersion: 751,
  RoutingId: 801,
  InstallationId: 800,
  MainboardSwVersion: 908,
  SmartBootloaderVersion: 912,
  HardwareVersion: 913,
  Humidity: 270,
  LteRoamingDisabled: 753,
  LteImei: 963,
  LteMsisdn: 961,
  MacPlcGrid: 951,
  NewChargeCard: 750,
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
const AUTH_TYPE_LABELS: Record<number, string> = {
  0: "Zaptec (vendor app / portal RFID)",
  1: "Vendor app",
  2: "OCPP 1.6J cloud",
  3: "Native OCPP",
};

function emptyRead(cachedAt: string | null = null): ChargerTechnicalRead {
  return {
    fresh: false,
    fetchedAt: new Date().toISOString(),
    cachedAt,
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
    authenticationType: null,
    authenticationTypeLabel: null,
    ocppDefaultIdTag: null,
    ocppCloudUrlVersion: null,
    authListVersion: null,
    routingId: null,
    installationId: null,
    mainboardSwVersion: null,
    smartBootloaderVersion: null,
    hardwareVersion: null,
    internalTempBC: null,
    humidityPct: null,
    lifetimeEnergyKWh: null,
    lteRoamingDisabled: null,
    lteImei: null,
    lteMsisdn: null,
    macPlcGrid: null,
    lastChargeCard: null,
    pin: null,
    hasSessions: null,
    installation: null,
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
  // 1) Resolve the Zaptec UUID + orgId + cache via the charger's OcppIdentity.
  const station = await db.chargingStation.findUnique({
    where: { siteAssetId: chargingStationId },
    select: {
      orgId: true,
      lastTelemetryRead: true,
      lastTelemetryAt: true,
      ocppIdentities: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: { vendorResourceId: true, vendor: true },
      },
    },
  });
  if (!station) return emptyRead();

  // Helper: hydrate cached read with fresh=false + cachedAt set.
  // Used at every failure-return site below. When no cache exists,
  // returns the all-null empty read with no cachedAt.
  const fromCache = (): ChargerTechnicalRead => {
    if (
      station.lastTelemetryRead &&
      typeof station.lastTelemetryRead === "object" &&
      station.lastTelemetryAt
    ) {
      const cached = station.lastTelemetryRead as Partial<ChargerTechnicalRead>;
      return {
        ...emptyRead(station.lastTelemetryAt.toISOString()),
        ...cached,
        // Force these even if the cached object had them set
        fresh: false,
        fetchedAt: new Date().toISOString(),
        cachedAt: station.lastTelemetryAt.toISOString(),
      };
    }
    return emptyRead();
  };

  const identity = station.ocppIdentities[0];
  const vendorResourceId = identity?.vendorResourceId ?? null;
  if (!vendorResourceId || identity?.vendor !== "Zaptec") return fromCache();

  // 2) Find an active Zaptec credential that can see this charger.
  // Cross-org: credentials may manage chargers owned by a different org
  // than the credential's owning org (e.g. N1 hef chargers managed by
  // Straumvakt's master credential). Scoping the lookup to
  // station.orgId silently dropped every cross-org charger from
  // technical-read — A1/ZPR042645 was the canary (Sprint 8.13.3).
  // Same pattern site-tree.ts and runZaptecCronSync already follow.
  // Order: prefer credentials owned by the station's org if present;
  // otherwise any active Zaptec credential.
  const credentials = await db.vendorCredential.findMany({
    where: { status: "active", vendor: { slug: "zaptec" } },
    select: {
      ownerOrgId: true,
      username: true,
      passwordCipher: true,
      passwordIv: true,
    },
    orderBy: { lastUsedAt: "desc" },
  });
  if (credentials.length === 0) return fromCache();
  credentials.sort((a, b) => {
    const aOwn = a.ownerOrgId === station.orgId ? 0 : 1;
    const bOwn = b.ownerOrgId === station.orgId ? 0 : 1;
    return aOwn - bOwn;
  });

  // 3) Try each credential in order. First to authenticate wins; we
  //    use its token for detail/state/installation. Defensive try/catch
  //    inside — on any failure we return placeholders rather than
  //    500ing the operator's detail page.
  try {
    let accessToken: string | null = null;
    for (const cred of credentials) {
      if (!cred.passwordCipher || !cred.passwordIv) continue;
      try {
        const password = await openPassword(kek, {
          cipher: cred.passwordCipher,
          iv: cred.passwordIv,
        });
        const tokenResult = await getZaptecAccessToken(cred.username, password);
        if (tokenResult.ok) {
          accessToken = tokenResult.value;
          break;
        }
      } catch {
        // try next credential
      }
    }
    if (!accessToken) return fromCache();

    // Fetch detail + state first; we need detail.InstallationId to
    // know which installation to fetch. Then in parallel: installation
    // detail (for installation-level fields surfaced on the Technical
    // Read page).
    const [detailRes, stateRes] = await Promise.all([
      getChargerDetail(accessToken, vendorResourceId),
      getChargerState(accessToken, vendorResourceId),
    ]);

    const detail = detailRes.ok ? detailRes.value ?? {} : {};
    const state = stateRes.ok ? stateRes.value : [];

    let installationSnapshot: ChargerInstallationSnapshot | null = null;
    const installationIdRaw = (detail as Record<string, unknown>).InstallationId;
    if (typeof installationIdRaw === "string" && installationIdRaw.length > 0) {
      const instRes = await getInstallationSummary(accessToken, installationIdRaw);
      if (instRes.ok && instRes.value) {
        const i = instRes.value as Record<string, unknown>;
        installationSnapshot = {
          name: typeof i.Name === "string" ? i.Name : null,
          address: typeof i.Address === "string" ? i.Address : null,
          city: typeof i.City === "string" ? i.City : null,
          zipCode: typeof i.ZipCode === "string" ? i.ZipCode : null,
          countryId: typeof i.CountryId === "string" ? i.CountryId : null,
          timeZoneIanaName:
            typeof i.TimeZoneIanaName === "string" ? i.TimeZoneIanaName : null,
          activeChargerCount:
            typeof i.ActiveChargerCount === "number" ? i.ActiveChargerCount : null,
          maxCurrent: typeof i.MaxCurrent === "number" ? i.MaxCurrent : null,
          availableCurrent:
            typeof i.AvailableCurrent === "number" ? i.AvailableCurrent : null,
          useLoadBalancing:
            typeof i.UseLoadBalancing === "boolean" ? i.UseLoadBalancing : null,
          isRequiredAuthentication:
            typeof i.IsRequiredAuthentication === "boolean"
              ? i.IsRequiredAuthentication
              : null,
          ocppCloudUrl: typeof i.OcppCloudUrl === "string" ? i.OcppCloudUrl : null,
          ocppCloudUrlVersion:
            typeof i.OcppCloudUrlVersion === "number" ? i.OcppCloudUrlVersion : null,
          routingId: typeof i.RoutingId === "string" ? i.RoutingId : null,
          messagingEnabled:
            typeof i.MessagingEnabled === "boolean" ? i.MessagingEnabled : null,
          active: typeof i.Active === "boolean" ? i.Active : null,
          createdOnDate:
            typeof i.CreatedOnDate === "string" ? i.CreatedOnDate : null,
        };
      }
    }

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

    // Sprint 8.4.4 — don't discard the detail call's payload just
    // because /state was empty. /state goes empty when the charger is
    // offline (Zaptec can't reach it for live observations), but
    // /api/chargers/{id} (detail) still returns hardware identity,
    // OCPP config, AuthenticationType, firmware version, and
    // SignedMeterValueKwh from Zaptec's own DB.
    //
    // Render whatever Zaptec gave us. The panel em-dashes individual
    // null fields, so a partial response is rendered correctly. Only
    // fall back to the cache when BOTH calls returned nothing — that's
    // the "vendor truly unreachable" state.
    const detailHasData = detailRes.ok && Object.keys(d).length > 0;
    const stateHasData = stateRes.ok && state.length > 0;
    if (!detailHasData && !stateHasData) {
      return fromCache();
    }

    const liveRead: ChargerTechnicalRead = {
      fresh: true,
      fetchedAt: new Date().toISOString(),
      cachedAt: null,
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
      // 8.4.8 — /state StateId 982 not exposed by some firmwares;
      // fall back to detail.MID which Zaptec returns regardless.
      mid:
        pickState(state, STATE_IDS.MidCalibrationID) ??
        (typeof d.MID === "string" ? (d.MID as string) : null),
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
      authenticationType:
        typeof d.AuthenticationType === "number" ? d.AuthenticationType : null,
      authenticationTypeLabel:
        typeof d.AuthenticationType === "number"
          ? AUTH_TYPE_LABELS[d.AuthenticationType] ?? `Unknown (${d.AuthenticationType})`
          : null,
      ocppDefaultIdTag:
        typeof d.PropertyOcppDefaultIdTag === "string" ? d.PropertyOcppDefaultIdTag : null,
      // OcppCloudUrlVersion lives on the installation, not the charger
      // — surface from state if the charger reports it, else null. The
      // installation-level value is fetched separately by the operator
      // if needed.
      ocppCloudUrlVersion: null,
      authListVersion: pickStateNumber(state, STATE_IDS.AuthenticationListVersion),
      routingId: pickState(state, STATE_IDS.RoutingId),
      installationId: pickState(state, STATE_IDS.InstallationId),
      mainboardSwVersion: pickState(state, STATE_IDS.MainboardSwVersion),
      smartBootloaderVersion: pickState(state, STATE_IDS.SmartBootloaderVersion),
      hardwareVersion: pickState(state, STATE_IDS.HardwareVersion),
      internalTempBC: pickStateNumber(state, STATE_IDS.InternalTempB),
      humidityPct: pickStateNumber(state, STATE_IDS.Humidity),
      lifetimeEnergyKWh:
        typeof d.SignedMeterValueKwh === "number" ? d.SignedMeterValueKwh : null,
      lteRoamingDisabled: pickStateBool(state, STATE_IDS.LteRoamingDisabled),
      lteImei: pickState(state, STATE_IDS.LteImei),
      lteMsisdn: pickState(state, STATE_IDS.LteMsisdn),
      macPlcGrid: pickState(state, STATE_IDS.MacPlcGrid),
      lastChargeCard: pickState(state, STATE_IDS.NewChargeCard),
      pin: typeof d.Pin === "string" ? d.Pin : null,
      hasSessions: typeof d.HasSessions === "boolean" ? d.HasSessions : null,
      installation: installationSnapshot,
      warningsBitmask: warnings ?? notifications,
    };

    // Sprint 8.4.3 — write-through cache. Best-effort; failure is
    // non-blocking (we still return liveRead). Don't await; the page
    // is already rendering. We don't store `installation` since
    // installation-level data is its own thing and varies less.
    void db.chargingStation
      .update({
        where: { siteAssetId: chargingStationId },
        data: {
          lastTelemetryRead: liveRead as unknown as Prisma.InputJsonValue,
          lastTelemetryAt: new Date(),
        },
      })
      .catch((err: unknown) => {
        console.warn("[charger-technical-read] cache write failed", {
          chargingStationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return liveRead;
  } catch (err) {
    console.error("[charger-technical-read] zaptec fetch failed", {
      chargingStationId,
      vendorResourceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fromCache();
  }
}
