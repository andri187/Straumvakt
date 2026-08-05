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
import type { OrgScope } from "../lib/auth/org-scope";
import { sha256Hex } from "../lib/sha256";
import { recordAuditAction } from "../lib/audit";
import { listChargers as zaptecListChargers } from "../lib/zaptec";
import { unsealAndAuth } from "./credential-management";

function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// 12-min online window — same as site-tree.ts. lastSeenAt is the
// gateway/vendor heartbeat freshness; outside that window the charger
// is considered offline regardless of what status field carries.
const ONLINE_WINDOW_MS = 12 * 60 * 1000;

// How far back to look for a genuine OCPP frame. Anything older is
// offline under any definition, and the bound keeps the grouped scan off
// the older daily partitions of events.protocol_log.
const OCPP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Sprint 9.7 — collect all vendor_resource_ids visible across every
 * active Zaptec credential's bulk listing. Anything in our DB whose
 * vendorResourceId is NOT in this set is decommissioned-by-omission
 * (Zaptec dropped it from the active fleet — Active=false / retired).
 * Mirrors the post-pass detection in site-tree.ts.
 *
 * Returns null when no credential succeeded — leaves rows ambiguous
 * rather than falsely marking everything decommissioned during a
 * Zaptec outage.
 */
async function getActiveVendorResourceIds(
  db: PrismaClient,
  kek: string,
): Promise<Set<string> | null> {
  const credentials = await db.vendorCredential.findMany({
    where: { status: "active", vendor: { slug: "zaptec" } },
    select: { id: true },
  });
  if (credentials.length === 0) return null;
  const seen = new Set<string>();
  let attemptedAtLeastOne = false;
  for (const cred of credentials) {
    try {
      const auth = await unsealAndAuth(db, kek, cred.id);
      const list = await zaptecListChargers(auth.accessToken);
      attemptedAtLeastOne = true;
      if (list.ok) {
        for (const c of list.value) {
          if (typeof c.Id === "string") seen.add(c.Id);
        }
      }
    } catch {
      // skip — try next credential
    }
  }
  return attemptedAtLeastOne ? seen : null;
}

export interface ListChargersOptions {
  /** Include rows where vendor side reports the charger as
   *  decommissioned (Active=false / dropped from listChargers).
   *  Defaults to false — the operator console hides retired hardware
   *  from the at-a-glance view. */
  includeDecommissioned?: boolean;
  /** KEK for the Zaptec OAuth round-trip used to determine the
   *  decommissioned set. When undefined we skip the live check and
   *  return all rows with decommissioned=null. */
  kek?: string;
  /** Tenant row-scope. When provided and not `all`, the result is
   *  filtered to the caller's orgs (defense-in-depth, Rule 7). Omitted
   *  (undefined) preserves the legacy unscoped behaviour. */
  orgScope?: OrgScope;
}

export async function listAllChargers(
  db: PrismaClient,
  options: ListChargersOptions = {},
): Promise<ChargerSummary[]> {
  const rows = await db.chargingStation.findMany({
    where:
      options.orgScope && options.orgScope.all === false
        ? { orgId: { in: options.orgScope.orgIds } }
        : undefined,
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      siteAsset: { select: { site: { select: { displayName: true } } } },
      installation: {
        select: { id: true, displayName: true, enforceAuthorize: true },
      },
      circuit: { select: { id: true, displayName: true } },
      evses: {
        take: 1,
        orderBy: { evseIndex: "asc" },
        include: { connectors: { take: 1, orderBy: { connectorIndex: "asc" } } },
      },
      ocppIdentities: { take: 1, orderBy: { createdAt: "asc" } },
    },
  });

  // Newest genuine OCPP frame per identity — the other half of the
  // liveness picture. `OcppIdentity.lastSeenAt` is written by the Zaptec
  // status sync, so it reports the vendor poll rather than the protocol
  // connection; the two diverged for three months without anything
  // noticing (13 May → 4 Aug 2026). The fleet view must show both.
  //
  // Frames are split across two tables by retention class (ADR 0039):
  // heartbeats land in events.protocol_log, everything else in
  // events.event_log. Newest wins across both.
  const identityIds = rows
    .map((r) => r.ocppIdentities[0]?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const ocppLastSeen = new Map<string, Date>();
  if (identityIds.length > 0) {
    // Bounded lookback: anything older than this is offline by any
    // definition, and the bound keeps the scan off the older partitions.
    const since = new Date(Date.now() - OCPP_LOOKBACK_MS);
    const noteNewest = (rowsIn: { aggregateId: string; _max: { occurredAt: Date | null } }[]) => {
      for (const g of rowsIn) {
        const at = g._max.occurredAt;
        if (!at) continue;
        const prev = ocppLastSeen.get(g.aggregateId);
        if (!prev || at > prev) ocppLastSeen.set(g.aggregateId, at);
      }
    };
    const [fromEvents, fromProtocol] = await Promise.all([
      db.eventLogEntry.groupBy({
        by: ["aggregateId"],
        where: { aggregateId: { in: identityIds }, occurredAt: { gte: since } },
        _max: { occurredAt: true },
      }),
      db.protocolLogEntry.groupBy({
        by: ["aggregateId"],
        where: { aggregateId: { in: identityIds }, occurredAt: { gte: since } },
        _max: { occurredAt: true },
      }),
    ]);
    noteNewest(fromEvents);
    noteNewest(fromProtocol);
  }

  // 9.8 — signalDbm + commMode now come from dedicated columns
  // populated by the */1 cron. JSONB-cache fallback removed since
  // every charger gets fresh values from the cron.

  // Sprint 9.7 — live decommissioned detection. One Zaptec listChargers
  // round-trip per active credential per request. Skips when KEK isn't
  // available (e.g. local dev) — falls back to decommissioned=null on
  // every row, equivalent to the pre-9.7 behaviour.
  const activeIds = options.kek
    ? await getActiveVendorResourceIds(db, options.kek)
    : null;

  const now = Date.now();
  const mapped = rows.map((r) => {
    const identity = r.ocppIdentities[0];
    const lastSeen = identity?.lastSeenAt ?? null;
    const within = lastSeen != null && now - lastSeen.getTime() < ONLINE_WINDOW_MS;
    const online = within && identity?.status !== "offline";
    const ocppSeen = identity?.id ? (ocppLastSeen.get(identity.id) ?? null) : null;
    return {
      chargingStationId: r.siteAssetId,
      evseId: r.evses[0]?.id ?? "",
      connectorId: r.evses[0]?.connectors[0]?.id ?? "",
      ocppIdentityId: identity?.id ?? "",
      identityString: identity?.identityString ?? "—",
      orgDisplayName: r.organization.displayName,
      siteDisplayName: r.siteAsset.site.displayName,
      vendor: r.vendor,
      model: r.model,
      serialNumber: r.serialNumber,
      connectorType: r.evses[0]?.connectors[0]?.type ?? "—",
      ocppVersion: identity?.ocppVersion ?? "—",
      createdAt: r.createdAt.toISOString(),
      // Sprint 8.4.7 — list-view enrichment.
      firmwareVersion: r.firmwareVersion,
      mainboardSwVersion: r.mainboardSwVersion,
      smartBootloaderVersion: r.smartBootloaderVersion,
      hardwareVersion: r.hardwareVersion,
      lifetimeKwh: r.lifetimeKwhCached != null ? Number(r.lifetimeKwhCached) : null,
      // Force "offline" badge when online=false (same semantic as
      // site-tree's row composition, 8.13.4) — a charger that's stuck
      // with status="charging" but lastSeenAt past 12 min should not
      // claim to be charging in the list.
      status: online ? (identity?.status ?? null) : "offline",
      online,
      onlineSinceAt: online && r.onlineSinceAt ? r.onlineSinceAt.toISOString() : null,
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
      // OCPP liveness — deliberately independent of `online` above.
      ocppLastSeenAt: ocppSeen ? ocppSeen.toISOString() : null,
      ocppOnline: ocppSeen != null && now - ocppSeen.getTime() < ONLINE_WINDOW_MS,
      enforceAuthorize: r.installation?.enforceAuthorize ?? null,
      // Sprint 9.7 — decommissioned-by-omission. null when we couldn't
      // verify with Zaptec; true when the charger's vendorResourceId
      // wasn't in any credential's listChargers; false when it was.
      decommissioned:
        activeIds == null
          ? null
          : identity?.vendorResourceId
            ? !activeIds.has(identity.vendorResourceId)
            : null,
      commMode: r.commMode,
      signalDbm: r.signalDbm,
      // 9.9 — installation + circuit for the /chargers grouped view.
      installationId: r.installation?.id ?? null,
      installationDisplayName: r.installation?.displayName ?? null,
      circuitId: r.circuit?.id ?? null,
      circuitDisplayName: r.circuit?.displayName ?? null,
    };
  });

  // Hide decommissioned by default. The flag is null when we
  // couldn't verify (Zaptec outage / no credentials) — keep those
  // visible so we don't accidentally drop rows during an outage.
  if (!options.includeDecommissioned) {
    return mapped.filter((c) => c.decommissioned !== true);
  }
  return mapped;
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
  orgScope?: OrgScope,
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
  // Row-scope guard: a scoped caller (e.g. host_admin) only sees chargers
  // in their orgs. Treated as not-found to avoid leaking existence.
  if (orgScope && orgScope.all === false && !orgScope.orgIds.includes(r.orgId)) {
    return null;
  }
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
    warrantyExpires: r.warrantyExpires ? r.warrantyExpires.toISOString().slice(0, 10) : null,
    chargeBoxSerialNumber: r.chargeBoxSerialNumber,
    meterType: r.meterType,
    meterSerialNumber: r.meterSerialNumber,
    iccid: r.iccid,
    imsi: r.imsi,
    locationNote: r.locationNote,
    mountingType: r.mountingType,
    photoUrl: r.photoUrl,
    ipRating: r.ipRating,
    breakerAmps: r.breakerAmps,
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
        status: c.status,
        errorCode: c.errorCode,
        vendorErrorCode: c.vendorErrorCode,
        statusUpdatedAt: c.statusUpdatedAt?.toISOString() ?? null,
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

  // 6 round trips inside the tx (siteAsset, chargingStation, eVSE,
  // connector, ocppIdentity, pendingDiscovery.deleteMany). 60s timeout
  // gives generous headroom over Hyperdrive's per-query latency.
  const result = await db.$transaction(
    async (tx) => {
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
    },
    { timeout: 60_000, maxWait: 30_000 },
  );

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
    // Sprint 8.4.7 — fresh charger has no /state observations yet;
    // these populate on the first cron tick.
    firmwareVersion: null,
    mainboardSwVersion: null,
    smartBootloaderVersion: null,
    hardwareVersion: null,
    lifetimeKwh: null,
    status: null,
    online: false,
    onlineSinceAt: null,
    lastSeenAt: null,
    // A charger that was created a moment ago has, by definition, never
    // sent a frame. enforceAuthorize is unknown until it is attached to
    // an installation, which is a separate step.
    ocppLastSeenAt: null,
    ocppOnline: false,
    enforceAuthorize: null,
    // 9.7/9.8 — fresh row; assume not decommissioned. Will be
    // re-evaluated on the next list-chargers fetch + cron tick.
    decommissioned: false,
    commMode: null,
    signalDbm: null,
    installationId: input.installationId ?? null,
    installationDisplayName: null,
    circuitId: input.circuitId ?? null,
    circuitDisplayName: null,
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
    // Operator-domain fields (Sprint 3 enrichment).
    if (patch.locationNote !== undefined) stationData.locationNote = patch.locationNote;
    if (patch.mountingType !== undefined) stationData.mountingType = patch.mountingType;
    if (patch.photoUrl !== undefined) stationData.photoUrl = patch.photoUrl;
    if (patch.ipRating !== undefined) stationData.ipRating = patch.ipRating;
    if (patch.breakerAmps !== undefined) stationData.breakerAmps = patch.breakerAmps;
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

/**
 * Delete a charger by its chargingStationId (= SiteAsset id). Deleting
 * the SiteAsset cascades through ChargingStation, EVSE, Connector,
 * OcppIdentity via existing schema FKs. The OcppIdentity going away
 * is what makes the charger "re-appear" in /chargers/pending the next
 * time it tries to connect with the same identity_string — the
 * gateway's auth call won't find a matching row and the auth-fail
 * branch upserts pending_discoveries.
 *
 * Idempotent — deleting a non-existent id is a no-op.
 */
export async function deleteCharger(db: PrismaClient, chargingStationId: string): Promise<void> {
  await db.siteAsset.deleteMany({ where: { id: chargingStationId } });
}

// ── Vendor-attach result ─────────────────────────────────────────────────────

export interface AttachVendorResult {
  ocppIdentityId: string;
  vendor: string;
  vendorResourceId: string;
  credentialsRef: string;
}

// Error codes for the attach path.
export type AttachVendorErrorCode =
  | "charging_station_not_found"  // no ChargingStation with that id
  | "no_ocpp_identity"            // ChargingStation exists but has no OcppIdentity row
  | "credential_not_found"        // credentialId doesn't exist
  | "credential_inactive"         // credential exists but status != 'active'
  | "vendor_mismatch"             // credential's vendor slug != body vendor
  | "conflict_vendor_resource_id" // identity already has a different vendorResourceId
  | "conflict_credentials_ref";   // identity already has a different credentialsRef

export class AttachVendorError extends Error {
  constructor(
    public readonly code: AttachVendorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachVendorError";
  }
}

/**
 * Wire a vendor identity (Zaptec UUID + credential row) onto an existing
 * OcppIdentity row whose vendor fields are currently NULL or match the
 * supplied values.
 *
 * Conflict rules:
 * - If `vendorResourceId` is already set AND differs → 409 (AttachVendorError)
 * - If `credentialsRef` is already set AND differs → 409 (AttachVendorError)
 * - If both are already set to the SAME values → idempotent no-op (returns existing)
 *
 * The credential row must exist and have status='active'; its vendor slug
 * must match `vendor`. All of this runs inside a single Prisma transaction.
 * Audit log is written AFTER the transaction commits (outside the tx so a
 * failed audit write doesn't roll back the attach).
 */
export async function attachVendorToOcppIdentity(
  db: PrismaClient,
  chargingStationId: string,
  input: {
    vendor: string;
    vendorResourceId: string;
    credentialId: string;
  },
  actorUserId: string | null,
): Promise<AttachVendorResult> {
  const result = await db.$transaction(
    async (tx) => {
      // 1. Load the ChargingStation → first OcppIdentity.
      const station = await tx.chargingStation.findUnique({
        where: { siteAssetId: chargingStationId },
        select: {
          siteAssetId: true,
          orgId: true,
          ocppIdentities: {
            take: 1,
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              orgId: true,
              vendor: true,
              vendorResourceId: true,
              credentialsRef: true,
            },
          },
        },
      });

      if (!station) {
        throw new AttachVendorError(
          "charging_station_not_found",
          `ChargingStation ${chargingStationId} not found`,
        );
      }

      const identity = station.ocppIdentities[0];
      if (!identity) {
        throw new AttachVendorError(
          "no_ocpp_identity",
          `ChargingStation ${chargingStationId} has no OcppIdentity`,
        );
      }

      // 2. Validate the credential row.
      const credential = await tx.vendorCredential.findUnique({
        where: { id: input.credentialId },
        select: {
          id: true,
          status: true,
          vendor: { select: { slug: true } },
        },
      });

      if (!credential) {
        throw new AttachVendorError(
          "credential_not_found",
          `VendorCredential ${input.credentialId} not found`,
        );
      }
      if (credential.status !== "active") {
        throw new AttachVendorError(
          "credential_inactive",
          `VendorCredential ${input.credentialId} is not active (status=${credential.status})`,
        );
      }
      if (credential.vendor.slug !== input.vendor) {
        throw new AttachVendorError(
          "vendor_mismatch",
          `Credential vendor slug "${credential.vendor.slug}" does not match requested vendor "${input.vendor}"`,
        );
      }

      // 3. Conflict checks — existing non-null values that differ.
      if (
        identity.vendorResourceId !== null &&
        identity.vendorResourceId !== undefined &&
        identity.vendorResourceId !== input.vendorResourceId
      ) {
        throw new AttachVendorError(
          "conflict_vendor_resource_id",
          `OcppIdentity ${identity.id} already has vendorResourceId="${identity.vendorResourceId}". Detach first.`,
        );
      }
      if (
        identity.credentialsRef !== null &&
        identity.credentialsRef !== undefined &&
        identity.credentialsRef !== input.credentialId
      ) {
        throw new AttachVendorError(
          "conflict_credentials_ref",
          `OcppIdentity ${identity.id} already has credentialsRef="${identity.credentialsRef}". Detach first.`,
        );
      }

      // 4. Update (idempotent — writing the same values is fine).
      await tx.ocppIdentity.update({
        where: { id: identity.id },
        data: {
          vendor: input.vendor,
          vendorResourceId: input.vendorResourceId,
          credentialsRef: input.credentialId,
        },
      });

      return {
        ocppIdentityId: identity.id,
        orgId: station.orgId,
        vendor: input.vendor,
        vendorResourceId: input.vendorResourceId,
        credentialsRef: input.credentialId,
      };
    },
    { timeout: 30_000, maxWait: 15_000 },
  );

  await recordAuditAction(db, {
    orgId: result.orgId,
    actorUserId,
    actorKind: "user",
    action: "charger.attach_vendor",
    targetType: "ocpp_identity",
    targetId: result.ocppIdentityId,
    metadata: {
      vendor: input.vendor,
      vendorResourceId: input.vendorResourceId,
      credentialId: input.credentialId,
    },
  });

  return {
    ocppIdentityId: result.ocppIdentityId,
    vendor: result.vendor,
    vendorResourceId: result.vendorResourceId,
    credentialsRef: result.credentialsRef,
  };
}
