// Pulls live Zaptec telemetry for a single charger. Joins:
//   ChargingStation → OcppIdentity (vendorResourceId = Zaptec UUID)
//   OcppIdentity.credentialsRef → VendorCredential
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
//
// Sprint 9 (PROBE-1) — credentials_ref-direct lookup. Previously this
// repo joined VendorCredential by `ownerOrgId = charger.org_id`, which
// silently dropped every cross-tenant charger (e.g. zpr074002, owned by
// N1 ehf, managed by Straumvakt's master credential). The lookup is now
// authoritative on OcppIdentity.credentialsRef — the org of the charger
// is irrelevant to which credential reads its telemetry. The repo
// surfaces a `linkStatus` discriminator the page renders as a badge so
// the operator immediately sees WHY the panel is empty (not linked /
// credential unhealthy / no vendor id / vendor API failed).

import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type {
  ChargerTechnicalRead,
  ChargerTechnicalReadLinkStatus,
  ChargerInstallationSnapshot,
  LocalAuthRoster,
  LocalAuthRosterEntry,
  LocalAuthEffectiveVerdict,
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
  ChargerCurrentUserUuid: 722,
  RejectedUserUuid: 725,
  EnabledNfcTechnologies: 752,
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
// 8.4.10 — Zaptec /api/chargers/{id} detail.DeviceType enum.
const DEVICE_TYPE_LABELS: Record<number, string> = {
  0: "Unknown",
  1: "Smart",
  2: "Portable",
  3: "HomeApm",
  4: "Apollo",
  5: "OtherApm",
  6: "GenericApm",
  7: "HanApm",
  8: "TicApm",
};

/**
 * Build the CSMS-side local auth roster for a charger.
 *
 * Returns the IdTokens that scope to this charger's installation (or are
 * globally scoped) plus a per-entry verdict that mirrors the rules in
 * routes/internal/ocpp-authorize.ts: status checks, expiry, and the
 * installation-type Agreement / DriverGroupMembership contract gate
 * (ADR 0019). The verdict is read-only — this function never mutates
 * anything.
 *
 * Half A scope: roster surfacing only. Edits and SendLocalList
 * propagation are out of scope and explicitly noted in the UI.
 */
async function getLocalAuthRosterForInstallation(
  db: PrismaClient,
  installationId: string | null,
  authenticationType: number | null,
  chargerListVersion: number | null,
): Promise<LocalAuthRoster> {
  if (!installationId) {
    return {
      installationId: null,
      note: "no_installation",
      count: 0,
      effectiveCount: 0,
      chargerListVersion,
      pushedListVersion: null,
      entries: [],
    };
  }
  // AuthenticationType is Zaptec's INTEGRATION PATH, not an auth policy —
  // their OpenAPI gives 0=Native, 1=WebHooks, 2=Ocpp, 3=OcppNative. The
  // branch below is still correct: 0 (Native) means Zaptec's own cloud
  // holds the authorization list, so our IdToken table is not the source
  // of truth for that install. The reasoning was right; the label on it
  // ("0 = Zaptec Portal owns the list") described a field that also got
  // documented differently again in lib/zaptec.ts. Both corrected
  // 2026-08-05 — driver auth lives in IsAuthorizationRequired.
  if (authenticationType === 0) {
    return {
      installationId,
      note: "native_zaptec_managed",
      count: 0,
      effectiveCount: 0,
      chargerListVersion,
      pushedListVersion: null,
      entries: [],
    };
  }

  const tokens = await db.idToken.findMany({
    where: {
      OR: [
        { scopeInstallationId: installationId },
        { scopeInstallationId: null },
      ],
    },
    select: {
      id: true,
      value: true,
      kind: true,
      label: true,
      status: true,
      expiresAt: true,
      lastUsedAt: true,
      scopeInstallationId: true,
      userId: true,
      user: { select: { displayName: true, email: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  // Contract gate (ADR 0019) — match the same rule used by
  // resolveAuthorize in ocpp-authorize.ts. One bulk findMany keyed off
  // userIds keeps this O(1) round-trips regardless of roster size.
  const userIds = Array.from(new Set(tokens.map((t) => t.userId)));
  const now = new Date();
  const contractedUsers = new Set<string>();
  if (userIds.length > 0) {
    const memberships = await db.driverGroupMembership.findMany({
      where: {
        userId: { in: userIds },
        driverGroup: {
          agreement: {
            agreementType: "installation",
            installationId,
            status: "active",
            effectiveFrom: { lte: now },
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
          },
        },
      },
      select: { userId: true },
    });
    for (const m of memberships) contractedUsers.add(m.userId);
  }

  const entries: LocalAuthRosterEntry[] = tokens.map((t) => {
    const verdict = decideVerdict(
      t.status,
      t.expiresAt,
      contractedUsers.has(t.userId),
    );
    return {
      id: t.id,
      value: t.value,
      kind: t.kind,
      label: t.label,
      status: t.status,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      scope: t.scopeInstallationId ? "installation" : "global",
      userId: t.userId,
      userDisplay: t.user.displayName ?? t.user.email,
      effectiveVerdict: verdict,
    };
  });

  return {
    installationId,
    note: "show_csms_roster",
    count: entries.length,
    effectiveCount: entries.filter((e) => e.effectiveVerdict === "would_authorize").length,
    chargerListVersion,
    pushedListVersion: null,
    entries,
  };
}

function decideVerdict(
  status: string,
  expiresAt: Date | null,
  hasContract: boolean,
): LocalAuthEffectiveVerdict {
  if (status === "revoked") return "blocked_revoked";
  if (status === "suspended") return "blocked_suspended";
  if (status === "expired") return "expired";
  if (expiresAt && expiresAt.getTime() <= Date.now()) return "expired";
  if (!hasContract) return "blocked_no_contract";
  return "would_authorize";
}

function emptyRoster(): LocalAuthRoster {
  return {
    installationId: null,
    note: "no_installation",
    count: 0,
    effectiveCount: 0,
    chargerListVersion: null,
    pushedListVersion: null,
    entries: [],
  };
}

function emptyRead(
  cachedAt: string | null = null,
  linkStatus: ChargerTechnicalReadLinkStatus = "no_credential",
  linkStatusReason: string | null = null,
): ChargerTechnicalRead {
  return {
    fresh: false,
    fetchedAt: new Date().toISOString(),
    cachedAt,
    linkStatus,
    linkStatusReason,
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
    currentUserUuid: null,
    lastRejectedUserUuid: null,
    enabledNfcTechnologies: null,
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
    deviceTypeLabel: null,
    installation: null,
    warningsBitmask: null,
    localAuthRoster: emptyRoster(),
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
  // 1) Resolve the Zaptec UUID + cache via the charger's OcppIdentity.
  // OcppIdentity.credentialsRef is the authoritative link to which
  // vendor credential reads this charger's telemetry. The charger's
  // own org is irrelevant — Straumvakt-held credentials may legitimately
  // manage chargers across tenants.
  const station = await db.chargingStation.findUnique({
    where: { siteAssetId: chargingStationId },
    select: {
      orgId: true,
      installationId: true,
      // Fallback rung 2 — see the resolution chain below.
      installation: { select: { credentialsRef: true } },
      lastTelemetryRead: true,
      lastTelemetryAt: true,
      ocppIdentities: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: {
          vendorResourceId: true,
          vendor: true,
          credentialsRef: true,
        },
      },
    },
  });
  if (!station) return emptyRead(null, "no_credential", "charger not found");

  // Helper: hydrate cached read with fresh=false + cachedAt set.
  // Used at every failure-return site below. When no cache exists,
  // returns the all-null empty read with no cachedAt.
  // Note: localAuthRoster is filled in after this returns (it's a fresh
  // DB read on every call regardless of vendor cache hit, since the
  // roster changes independently of vendor telemetry).
  const fromCache = (
    linkStatus: ChargerTechnicalReadLinkStatus,
    reason: string | null = null,
  ): ChargerTechnicalRead => {
    if (
      station.lastTelemetryRead &&
      typeof station.lastTelemetryRead === "object" &&
      station.lastTelemetryAt
    ) {
      const cached = station.lastTelemetryRead as Partial<ChargerTechnicalRead>;
      return {
        ...emptyRead(station.lastTelemetryAt.toISOString(), linkStatus, reason),
        ...cached,
        // Force these even if the cached object had them set — cache
        // payload predates linkStatus so always overlay the current
        // diagnostic, not whatever the cached blob carried.
        fresh: false,
        fetchedAt: new Date().toISOString(),
        cachedAt: station.lastTelemetryAt.toISOString(),
        linkStatus,
        linkStatusReason: reason,
      };
    }
    return emptyRead(null, linkStatus, reason);
  };

  // Pre-fetch the CSMS roster — independent of Zaptec reachability so
  // it renders even when the vendor call fails. authenticationType is
  // unknown at this point; pass null and let the roster builder hit
  // the IdToken table normally. We refine when liveRead lands and we
  // know the install's AuthType (the readout there overrides).
  let roster: LocalAuthRoster = await getLocalAuthRosterForInstallation(
    db,
    station.installationId,
    null,
    null,
  );
  const withRoster = (read: ChargerTechnicalRead): ChargerTechnicalRead => ({
    ...read,
    localAuthRoster: {
      ...roster,
      chargerListVersion: read.authListVersion,
    },
  });

  // Three distinct failure modes, three distinct badges. They were
  // collapsed into `no_credential`, which told the operator to onboard a
  // credential they already had — while the real cause (a charger that
  // arrived OCPP-first and never got its vendor UUID) was buried in the
  // hint text.
  const identity = station.ocppIdentities[0];
  if (!identity) {
    return withRoster(
      fromCache("no_credential", "charger has no OcppIdentity row"),
    );
  }
  // Case-insensitive: the importer writes "Zaptec"
  // (zaptec-import.ts:273,302) but attachVendor writes whatever the route
  // validated, which is lowercase "zaptec" (routes/admin/chargers.ts:317
  // → repositories/chargers.ts:643). A strict compare meant the
  // documented repair path — run attach-vendor — left the badge unchanged.
  if (identity.vendor?.toLowerCase() !== "zaptec") {
    return withRoster(
      fromCache(
        "vendor_not_linked",
        identity.vendor
          ? `OcppIdentity.vendor="${identity.vendor}" is not Zaptec`
          : "OcppIdentity.vendor is NULL — charger arrived via OCPP discovery and was never linked to its Zaptec UUID. Attach it via the credential's discover tree, not /onboard/zaptec.",
      ),
    );
  }

  // 2) credentials_ref-direct lookup. NULL ⇒ this charger was never
  //    linked to a credential (onboarding incomplete / imported from a
  //    pre-credential-vault era). Surface that as a distinct badge so
  //    the operator knows the fix is /onboard/zaptec, NOT "wait for
  //    Zaptec to come back up".
  // Resolution chain. `OcppIdentity.credentials_ref` is authoritative
  // when set, but it is written ONLY by attachVendor
  // (repositories/chargers.ts:645) — the Zaptec importer never populates
  // it. Hard-failing on NULL therefore reported "no credential" for every
  // imported charger, including ones actively serving telemetry.
  //
  // Rungs 2 and 3 restore the pre-rewrite behaviour without restoring the
  // bug that motivated the rewrite: the failure there was *guessing* a
  // credential, so rung 3 resolves only when the answer is unambiguous.
  // Crossing tenants is fine and intended (see the header) — picking one
  // of several candidates is not.
  let credentialsRef = identity.credentialsRef;
  let credentialSource: "identity" | "installation" | "sole_active" = "identity";

  if (!credentialsRef && station.installation?.credentialsRef) {
    credentialsRef = station.installation.credentialsRef;
    credentialSource = "installation";
  }

  if (!credentialsRef) {
    const candidates = await db.vendorCredential.findMany({
      where: { vendor: { slug: "zaptec" }, status: "active" },
      select: { id: true },
      take: 2, // 2 is enough to detect ambiguity
    });
    if (candidates.length === 1) {
      credentialsRef = candidates[0].id;
      credentialSource = "sole_active";
    } else {
      return withRoster(
        emptyRead(
          null,
          "no_credential",
          candidates.length === 0
            ? "no active Zaptec credential exists — onboard one via /onboard/zaptec"
            : `credentials_ref is NULL and ${candidates.length}+ active Zaptec credentials exist — link this charger explicitly rather than guessing`,
        ),
      );
    }
  }

  // vendor_resource_id NULL ⇒ we have a credential but no Zaptec UUID
  // to query against. Distinct badge so the diagnostic is unambiguous.
  const vendorResourceId = identity.vendorResourceId ?? null;
  if (!vendorResourceId) {
    return withRoster(
      emptyRead(
        null,
        "no_vendor_resource_id",
        "OcppIdentity.vendor_resource_id is NULL — re-run charger discovery to populate the Zaptec UUID",
      ),
    );
  }

  // 3) Walk OcppIdentity.credentials_ref → VendorCredential.
  //    The column is a free-form TEXT with no FK constraint; historical
  //    writes use either the VendorCredential.id (UUID) or the
  //    credential's username string. Match either shape so legacy data
  //    keeps working without a migration.
  //    No org filter — cross-tenant credentials are the whole point of
  //    this rewrite (Straumvakt master credential managing N1 ehf
  //    chargers, etc.).
  const credential = await db.vendorCredential.findFirst({
    where: {
      vendor: { slug: "zaptec" },
      OR: [{ id: credentialsRef }, { username: credentialsRef }],
    },
    select: {
      id: true,
      ownerOrgId: true,
      username: true,
      passwordCipher: true,
      passwordIv: true,
      status: true,
    },
  });

  if (!credential) {
    return withRoster(
      emptyRead(
        null,
        "credential_unhealthy",
        `no VendorCredential matches credentials_ref=${credentialsRef} (resolved via ${credentialSource})`,
      ),
    );
  }

  if (credential.status !== "active") {
    return withRoster(
      fromCache(
        "credential_unhealthy",
        `credential status=${credential.status}`,
      ),
    );
  }

  if (!credential.passwordCipher || !credential.passwordIv) {
    return withRoster(
      fromCache(
        "credential_unhealthy",
        "credential has no stored password — re-enter via credential manager",
      ),
    );
  }

  // 4) Unseal the password (credential_unhealthy on failure — the
  //    credential row exists but its sealed blob is corrupt / KEK
  //    mismatch / etc.), then fetch an access token. Token failures
  //    split: invalid_credentials = credential_unhealthy (operator
  //    must rotate); everything else = vendor_api_failed (transient).
  let password: string;
  try {
    password = await openPassword(kek, {
      cipher: credential.passwordCipher,
      iv: credential.passwordIv,
    });
  } catch (err) {
    return withRoster(
      fromCache(
        "credential_unhealthy",
        `credential unseal failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  try {
    let accessToken: string;
    {
      const tokenResult = await getZaptecAccessToken(credential.username, password);
      if (!tokenResult.ok) {
        const reason =
          tokenResult.error.kind === "invalid_credentials"
            ? "Zaptec rejected credentials (invalid_credentials)"
            : tokenResult.error.kind === "unreachable"
              ? "Zaptec OAuth endpoint unreachable"
              : tokenResult.error.kind === "no_token"
                ? "Zaptec returned no access_token"
                : `Zaptec OAuth status=${tokenResult.error.status}`;
        // invalid_credentials specifically = credential is broken, not
        // a transient vendor outage. Surface as credential_unhealthy so
        // the operator knows to rotate the password rather than retry.
        const status: ChargerTechnicalReadLinkStatus =
          tokenResult.error.kind === "invalid_credentials"
            ? "credential_unhealthy"
            : "vendor_api_failed";
        return withRoster(fromCache(status, reason));
      }
      accessToken = tokenResult.value;
    }

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
      return withRoster(
        fromCache(
          "vendor_api_failed",
          "Zaptec /api/chargers/:id and /state both returned empty",
        ),
      );
    }

    const liveRead: ChargerTechnicalRead = {
      fresh: true,
      fetchedAt: new Date().toISOString(),
      cachedAt: null,
      linkStatus: "ok",
      linkStatusReason: null,
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
      currentUserUuid: pickState(state, STATE_IDS.ChargerCurrentUserUuid),
      lastRejectedUserUuid: pickState(state, STATE_IDS.RejectedUserUuid),
      enabledNfcTechnologies: pickState(state, STATE_IDS.EnabledNfcTechnologies),
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
      deviceTypeLabel:
        typeof d.DeviceType === "number"
          ? DEVICE_TYPE_LABELS[d.DeviceType] ?? `Unknown (${d.DeviceType})`
          : null,
      installation: installationSnapshot,
      warningsBitmask: warnings ?? notifications,
      // Filled in by withRoster() at the return site. Stays as the
      // empty placeholder here so the cached payload doesn't carry a
      // potentially-stale roster around (the roster is a fresh DB
      // read every call, regardless of vendor cache hit).
      localAuthRoster: emptyRoster(),
    };

    // Refine the roster now that we know the install's AuthenticationType.
    // For AuthType=0 (Native) the Zaptec Portal owns the list, so the
    // CSMS roster surface flips to native_zaptec_managed regardless of
    // what's in our IdToken table.
    if (liveRead.authenticationType === 0) {
      roster = await getLocalAuthRosterForInstallation(
        db,
        station.installationId,
        0,
        liveRead.authListVersion,
      );
    }

    // Sprint 8.4.3 — write-through cache. Best-effort; failure is
    // non-blocking (we still return liveRead). Don't await; the page
    // is already rendering. We don't store `installation` since
    // installation-level data is its own thing and varies less.
    // Note: localAuthRoster is intentionally not part of the cached
    // payload — it's a fresh DB read on every call (cheap, local) and
    // changes independently of vendor telemetry.
    const liveReadForCache: ChargerTechnicalRead = {
      ...liveRead,
      localAuthRoster: emptyRoster(),
    };
    void db.chargingStation
      .update({
        where: { siteAssetId: chargingStationId },
        data: {
          lastTelemetryRead: liveReadForCache as unknown as Prisma.InputJsonValue,
          lastTelemetryAt: new Date(),
        },
      })
      .catch((err: unknown) => {
        console.warn("[charger-technical-read] cache write failed", {
          chargingStationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return withRoster(liveRead);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[charger-technical-read] zaptec fetch failed", {
      chargingStationId,
      vendorResourceId,
      error: reason,
    });
    return withRoster(fromCache("vendor_api_failed", reason));
  }
}
