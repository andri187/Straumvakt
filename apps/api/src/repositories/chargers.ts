// Chargers repository — ported from src/lib/repositories/chargers.ts.
//
// "Charger" here is the operator-facing aggregate spanning ChargingStation
// + EVSE + Connector + OcppIdentity. Create lands all four rows in one
// transaction; list/detail joins them back into a single object.
//
// ── DRIZZLE, ported 2026-08-07 ─────────────────────────────────────────
//
// This backs /chargers, the page that matters most, and it was the hardest
// file in the port: 21 queries, 3 transactions, and a six-level nested
// `include` with `take: 1` sub-selects.
//
// Two shape decisions worth knowing before editing:
//
//  1. **The 1:1 relations are joined; the 1:N relations are separate
//     queries.** organization / siteAsset→site / installation / circuit are
//     each at most one row per station, so they join without fanning out.
//     evses, connectors and ocppIdentities are 1:N, and Prisma's
//     `take: 1, orderBy: …` means "first child per parent" — which is
//     `DISTINCT ON` in Postgres, not a join. Joining them instead would
//     multiply the station rows and silently change the result.
//
//  2. **Numerics go through normaliseDecimalString.** Postgres returns
//     `numeric` as a string with its scale intact ("7.40"); Prisma's Decimal
//     prints "7.4". Without normalising, every max-power value in the API
//     response would gain a trailing zero. See lib/decimal.ts.

import { and, asc, desc, eq, gte, inArray, max } from "drizzle-orm";
import type {
  ChargerSummary,
  ChargerDetail,
  ChargerCreateResult,
} from "@straumvakt/shared/domain/chargers";
import type {
  ChargerCreateInput,
  ChargerUpdateInput,
} from "@straumvakt/shared/inputs/chargers";
import {
  chargingStations,
  circuits,
  connectors,
  evses,
  installations,
  siteAssets,
  sites,
} from "@straumvakt/shared/db/assets";
import { ocppIdentities, pendingDiscoveries } from "@straumvakt/shared/db/protocol";
import { eventLog, protocolLog } from "@straumvakt/shared/db/platform";
import { organizations } from "@straumvakt/shared/db/identity";
import type { Db } from "../lib/drizzle";
import { normaliseDecimalString } from "../lib/decimal";
import type { OrgScope } from "../lib/auth/org-scope";
import { sha256Hex } from "../lib/sha256";
import { recordAuditAction } from "../lib/audit";
import { listChargers as zaptecListChargers } from "../lib/zaptec";
import { unsealAndAuth } from "./credential-management";

/** Anything that can run a statement: the client or a transaction handle. */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Prisma accepted a JS `number` for a Decimal column and converted it.
 * Drizzle's `numeric` maps to string in both directions, so writing a number
 * is a type error going in and — where a `Record<string, unknown>` patch
 * bypasses the checker — a silent wrong-type going out. Every write to
 * max_power_kw goes through here.
 */
function toNumeric(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : String(v);
}

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
  db: Db,
  kek: string,
): Promise<Set<string> | null> {
  const { vendorCredentials } = await import("@straumvakt/shared/db/vendor");
  const { vendors } = await import("@straumvakt/shared/db/catalog");
  const credentials = await db
    .select({ id: vendorCredentials.id })
    .from(vendorCredentials)
    .innerJoin(vendors, eq(vendors.id, vendorCredentials.vendorId))
    .where(and(eq(vendorCredentials.status, "active"), eq(vendors.slug, "zaptec")));
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

/**
 * First EVSE per station, with its first connector — the Drizzle
 * equivalent of Prisma's nested `take: 1, orderBy: { …Index: "asc" }`.
 *
 * DISTINCT ON requires the ORDER BY to lead with the distinct expression,
 * which is why the sort reads station-then-index rather than just index.
 */
async function firstEvsePerStation(db: Db, stationIds: string[]) {
  if (stationIds.length === 0) return new Map<string, { evseId: string; connectorId: string; connectorType: string | null }>();

  const evseRows = await db
    .selectDistinctOn([evses.chargingStationId], {
      id: evses.id,
      chargingStationId: evses.chargingStationId,
    })
    .from(evses)
    .where(inArray(evses.chargingStationId, stationIds))
    .orderBy(evses.chargingStationId, asc(evses.evseIndex));

  const evseIds = evseRows.map((e) => e.id);
  const connectorRows = evseIds.length
    ? await db
        .selectDistinctOn([connectors.evseId], {
          id: connectors.id,
          evseId: connectors.evseId,
          type: connectors.type,
        })
        .from(connectors)
        .where(inArray(connectors.evseId, evseIds))
        .orderBy(connectors.evseId, asc(connectors.connectorIndex))
    : [];

  const byEvse = new Map(connectorRows.map((c) => [c.evseId, c]));
  return new Map(
    evseRows.map((e) => {
      const c = byEvse.get(e.id);
      return [
        e.chargingStationId,
        { evseId: e.id, connectorId: c?.id ?? "", connectorType: c?.type ?? null },
      ];
    }),
  );
}

/** First OcppIdentity per station, oldest first — Prisma's `take: 1, orderBy createdAt asc`. */
async function firstIdentityPerStation(db: Db, stationIds: string[]) {
  if (stationIds.length === 0) return new Map<string, typeof ocppIdentities.$inferSelect>();
  const rows = await db
    .selectDistinctOn([ocppIdentities.chargingStationId])
    .from(ocppIdentities)
    .where(inArray(ocppIdentities.chargingStationId, stationIds))
    .orderBy(ocppIdentities.chargingStationId, asc(ocppIdentities.createdAt));
  return new Map(rows.map((r) => [r.chargingStationId, r]));
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
  db: Db,
  options: ListChargersOptions = {},
): Promise<ChargerSummary[]> {
  const scope = options.orgScope;
  const scopeFilter =
    scope && scope.all === false ? inArray(chargingStations.orgId, scope.orgIds) : undefined;

  const rows = await db
    .select({
      siteAssetId: chargingStations.siteAssetId,
      orgId: chargingStations.orgId,
      vendor: chargingStations.vendor,
      model: chargingStations.model,
      serialNumber: chargingStations.serialNumber,
      createdAt: chargingStations.createdAt,
      firmwareVersion: chargingStations.firmwareVersion,
      mainboardSwVersion: chargingStations.mainboardSwVersion,
      smartBootloaderVersion: chargingStations.smartBootloaderVersion,
      hardwareVersion: chargingStations.hardwareVersion,
      lifetimeKwhCached: chargingStations.lifetimeKwhCached,
      onlineSinceAt: chargingStations.onlineSinceAt,
      vendorAuthRequired: chargingStations.vendorAuthRequired,
      vendorAuthenticationType: chargingStations.vendorAuthenticationType,
      vendorAuthSeenAt: chargingStations.vendorAuthSeenAt,
      commMode: chargingStations.commMode,
      signalDbm: chargingStations.signalDbm,
      orgDisplayName: organizations.displayName,
      siteDisplayName: sites.displayName,
      installationId: installations.id,
      installationDisplayName: installations.displayName,
      // enforceAuthorize moves to ChargingStation per ADR 0047 D1; until
      // that migration runs it still lives on the installation.
      enforceAuthorize: installations.enforceAuthorize,
      circuitId: circuits.id,
      circuitDisplayName: circuits.displayName,
    })
    .from(chargingStations)
    .innerJoin(organizations, eq(organizations.id, chargingStations.orgId))
    .innerJoin(siteAssets, eq(siteAssets.id, chargingStations.siteAssetId))
    .innerJoin(sites, eq(sites.id, siteAssets.siteId))
    .leftJoin(installations, eq(installations.id, chargingStations.installationId))
    .leftJoin(circuits, eq(circuits.id, chargingStations.circuitId))
    .where(scopeFilter)
    .orderBy(desc(chargingStations.updatedAt));

  const stationIds = rows.map((r) => r.siteAssetId);
  const [evseByStation, identityByStation] = await Promise.all([
    firstEvsePerStation(db, stationIds),
    firstIdentityPerStation(db, stationIds),
  ]);

  // Newest genuine OCPP frame per identity — the other half of the
  // liveness picture. `OcppIdentity.lastSeenAt` is written by the Zaptec
  // status sync, so it reports the vendor poll rather than the protocol
  // connection; the two diverged for three months without anything
  // noticing (13 May → 4 Aug 2026). The fleet view must show both.
  //
  // Frames are split across two tables by retention class (ADR 0039):
  // heartbeats land in events.protocol_log, everything else in
  // events.event_log. Newest wins across both.
  const identityIds = [...identityByStation.values()]
    .map((i) => i.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const ocppLastSeen = new Map<string, Date>();
  if (identityIds.length > 0) {
    // Bounded lookback: anything older than this is offline by any
    // definition, and the bound keeps the scan off the older partitions.
    const since = new Date(Date.now() - OCPP_LOOKBACK_MS);
    const noteNewest = (rowsIn: { aggregateId: string; newest: Date | null }[]) => {
      for (const g of rowsIn) {
        const at = g.newest;
        if (!at) continue;
        const prev = ocppLastSeen.get(g.aggregateId);
        if (!prev || at > prev) ocppLastSeen.set(g.aggregateId, at);
      }
    };
    const [fromEvents, fromProtocol] = await Promise.all([
      db
        .select({ aggregateId: eventLog.aggregateId, newest: max(eventLog.occurredAt) })
        .from(eventLog)
        .where(and(inArray(eventLog.aggregateId, identityIds), gte(eventLog.occurredAt, since)))
        .groupBy(eventLog.aggregateId),
      db
        .select({ aggregateId: protocolLog.aggregateId, newest: max(protocolLog.occurredAt) })
        .from(protocolLog)
        .where(and(inArray(protocolLog.aggregateId, identityIds), gte(protocolLog.occurredAt, since)))
        .groupBy(protocolLog.aggregateId),
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
  const activeIds = options.kek ? await getActiveVendorResourceIds(db, options.kek) : null;

  const now = Date.now();
  const mapped = rows.map((r) => {
    const identity = identityByStation.get(r.siteAssetId);
    const evse = evseByStation.get(r.siteAssetId);
    const lastSeen = identity?.lastSeenAt ?? null;
    const within = lastSeen != null && now - lastSeen.getTime() < ONLINE_WINDOW_MS;
    const online = within && identity?.status !== "offline";
    const ocppSeen = identity?.id ? (ocppLastSeen.get(identity.id) ?? null) : null;
    return {
      chargingStationId: r.siteAssetId,
      evseId: evse?.evseId ?? "",
      connectorId: evse?.connectorId ?? "",
      ocppIdentityId: identity?.id ?? "",
      identityString: identity?.identityString ?? "—",
      orgDisplayName: r.orgDisplayName,
      siteDisplayName: r.siteDisplayName,
      vendor: r.vendor,
      model: r.model,
      serialNumber: r.serialNumber,
      connectorType: evse?.connectorType ?? "—",
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
      enforceAuthorize: r.enforceAuthorize ?? null,
      vendorAuthRequired: r.vendorAuthRequired ?? null,
      vendorAuthenticationType: r.vendorAuthenticationType ?? null,
      vendorAuthSeenAt: r.vendorAuthSeenAt ? r.vendorAuthSeenAt.toISOString() : null,
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
      installationId: r.installationId ?? null,
      installationDisplayName: r.installationDisplayName ?? null,
      circuitId: r.circuitId ?? null,
      circuitDisplayName: r.circuitDisplayName ?? null,
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
  db: Db,
  siteId: string,
): Promise<{ id: string; displayName: string }[]> {
  return db
    .select({ id: circuits.id, displayName: circuits.displayName })
    .from(circuits)
    .where(eq(circuits.siteId, siteId))
    .orderBy(asc(circuits.displayName));
}

export async function getChargerById(
  db: Db,
  chargingStationId: string,
  orgScope?: OrgScope,
): Promise<ChargerDetail | null> {
  const [r] = await db
    .select({
      siteAssetId: chargingStations.siteAssetId,
      orgId: chargingStations.orgId,
      installationId: chargingStations.installationId,
      circuitId: chargingStations.circuitId,
      vendor: chargingStations.vendor,
      model: chargingStations.model,
      serialNumber: chargingStations.serialNumber,
      firmwareVersion: chargingStations.firmwareVersion,
      warrantyExpires: chargingStations.warrantyExpires,
      chargeBoxSerialNumber: chargingStations.chargeBoxSerialNumber,
      meterType: chargingStations.meterType,
      meterSerialNumber: chargingStations.meterSerialNumber,
      iccid: chargingStations.iccid,
      imsi: chargingStations.imsi,
      locationNote: chargingStations.locationNote,
      mountingType: chargingStations.mountingType,
      photoUrl: chargingStations.photoUrl,
      ipRating: chargingStations.ipRating,
      breakerAmps: chargingStations.breakerAmps,
      orgDisplayName: organizations.displayName,
      siteId: siteAssets.siteId,
      siteDisplayName: sites.displayName,
      installationDisplayName: installations.displayName,
      circuitDisplayName: circuits.displayName,
    })
    .from(chargingStations)
    .innerJoin(organizations, eq(organizations.id, chargingStations.orgId))
    .innerJoin(siteAssets, eq(siteAssets.id, chargingStations.siteAssetId))
    .innerJoin(sites, eq(sites.id, siteAssets.siteId))
    .leftJoin(installations, eq(installations.id, chargingStations.installationId))
    .leftJoin(circuits, eq(circuits.id, chargingStations.circuitId))
    .where(eq(chargingStations.siteAssetId, chargingStationId))
    .limit(1);

  if (!r) return null;
  // Row-scope guard: a scoped caller (e.g. host_admin) only sees chargers
  // in their orgs. Treated as not-found to avoid leaking existence.
  if (orgScope && orgScope.all === false && !orgScope.orgIds.includes(r.orgId)) {
    return null;
  }

  // Detail view takes ALL evses/connectors/identities, not just the first.
  const evseRows = await db
    .select()
    .from(evses)
    .where(eq(evses.chargingStationId, chargingStationId))
    .orderBy(asc(evses.evseIndex));
  const connectorRows = evseRows.length
    ? await db
        .select()
        .from(connectors)
        .where(inArray(connectors.evseId, evseRows.map((e) => e.id)))
        .orderBy(asc(connectors.connectorIndex))
    : [];
  const identityRows = await db
    .select({
      id: ocppIdentities.id,
      identityString: ocppIdentities.identityString,
      ocppVersion: ocppIdentities.ocppVersion,
    })
    .from(ocppIdentities)
    .where(eq(ocppIdentities.chargingStationId, chargingStationId))
    .orderBy(asc(ocppIdentities.createdAt));

  return {
    chargingStationId: r.siteAssetId,
    orgId: r.orgId,
    orgDisplayName: r.orgDisplayName,
    siteId: r.siteId,
    siteDisplayName: r.siteDisplayName,
    installationId: r.installationId,
    installationDisplayName: r.installationDisplayName ?? null,
    circuitId: r.circuitId,
    circuitDisplayName: r.circuitDisplayName ?? null,
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
    evses: evseRows.map((e) => ({
      id: e.id,
      evseIndex: e.evseIndex,
      maxPowerKw: normaliseDecimalString(e.maxPowerKw),
      phaseCount: e.phaseCount,
      connectors: connectorRows
        .filter((c) => c.evseId === e.id)
        .map((c) => ({
          id: c.id,
          connectorIndex: c.connectorIndex,
          type: c.type,
          maxPowerKw: normaliseDecimalString(c.maxPowerKw),
          status: c.status,
          errorCode: c.errorCode,
          vendorErrorCode: c.vendorErrorCode,
          statusUpdatedAt: c.statusUpdatedAt?.toISOString() ?? null,
        })),
    })),
    ocppIdentities: identityRows.map((i) => ({
      id: i.id,
      identityString: i.identityString,
      ocppVersion: i.ocppVersion,
    })),
  };
}

export async function createCharger(
  db: Db,
  input: ChargerCreateInput,
  actorUserId: string | null,
): Promise<ChargerCreateResult> {
  const password = generatePassword();
  const authSecretHash = await sha256Hex(password);

  // 6 round trips inside the tx (siteAsset, chargingStation, eVSE,
  // connector, ocppIdentity, pendingDiscovery delete). Prisma's explicit
  // timeout/maxWait options have no Drizzle equivalent — node-postgres
  // holds a real connection for the duration, so the wait Prisma was
  // guarding against does not arise.
  const result = await db.transaction(async (tx) => {
    const [siteAsset] = await tx
      .insert(siteAssets)
      .values({
        orgId: input.orgId,
        siteId: input.siteId,
        kind: "charger",
        displayName: input.identityString,
      })
      .returning({ id: siteAssets.id });

    await tx.insert(chargingStations).values({
      siteAssetId: siteAsset!.id,
      orgId: input.orgId,
      installationId: input.installationId,
      circuitId: input.circuitId,
      vendor: input.stationVendor,
      model: input.stationModel,
      serialNumber: input.stationSerialNumber,
      firmwareVersion: input.stationFirmwareVersion,
    });

    const [evse] = await tx
      .insert(evses)
      .values({
        orgId: input.orgId,
        chargingStationId: siteAsset!.id,
        evseIndex: input.evseIndex,
        maxPowerKw: toNumeric(input.evseMaxPowerKw),
        phaseCount: input.evsePhaseCount,
      })
      .returning({ id: evses.id });

    const [connector] = await tx
      .insert(connectors)
      .values({
        orgId: input.orgId,
        evseId: evse!.id,
        connectorIndex: input.connectorIndex,
        type: input.connectorType,
        maxPowerKw: toNumeric(input.connectorMaxPowerKw),
      })
      .returning({ id: connectors.id });

    const [identity] = await tx
      .insert(ocppIdentities)
      .values({
        orgId: input.orgId,
        chargingStationId: siteAsset!.id,
        identityString: input.identityString,
        authSecretHash,
        ocppVersion: input.ocppVersion,
        assetClass: input.assetClass,
      })
      .returning({ id: ocppIdentities.id });

    // Closes the pending-discoveries loop: if the gateway recorded
    // failed auth attempts for this identityString before provision,
    // remove the row in the same transaction. No-op when nothing matches.
    await tx
      .delete(pendingDiscoveries)
      .where(eq(pendingDiscoveries.identityString, input.identityString));

    return {
      chargingStationId: siteAsset!.id,
      evseId: evse!.id,
      connectorId: connector!.id,
      ocppIdentityId: identity!.id,
    };
  });

  await recordAuditAction(db, {
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "charger.create",
    targetType: "charging_station",
    targetId: result.chargingStationId,
    metadata: {
      identityString: input.identityString,
      vendor: input.stationVendor,
      model: input.stationModel,
    },
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
    vendorAuthRequired: null,
    vendorAuthenticationType: null,
    vendorAuthSeenAt: null,
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
  db: Db,
  chargingStationId: string,
  patch: ChargerUpdateInput,
  actorUserId: string | null,
): Promise<ChargerDetail> {
  await db.transaction(async (tx) => {
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
      await tx
        .update(chargingStations)
        .set(stationData)
        .where(eq(chargingStations.siteAssetId, chargingStationId));
    }
    if (patch.evseId) {
      const evseData: Record<string, unknown> = {};
      if (patch.evseMaxPowerKw !== undefined) evseData.maxPowerKw = toNumeric(patch.evseMaxPowerKw);
      if (patch.evsePhaseCount !== undefined) evseData.phaseCount = patch.evsePhaseCount;
      if (Object.keys(evseData).length > 0) {
        await tx.update(evses).set(evseData).where(eq(evses.id, patch.evseId));
      }
    }
    if (patch.connectorId) {
      const connData: Record<string, unknown> = {};
      if (patch.connectorType !== undefined) connData.type = patch.connectorType;
      if (patch.connectorMaxPowerKw !== undefined) connData.maxPowerKw = toNumeric(patch.connectorMaxPowerKw);
      if (Object.keys(connData).length > 0) {
        await tx.update(connectors).set(connData).where(eq(connectors.id, patch.connectorId));
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
  db: Db,
  ocppIdentityId: string,
): Promise<{ id: string; orgId: string; chargingStationId: string } | null> {
  const [row] = await db
    .select({
      id: ocppIdentities.id,
      orgId: ocppIdentities.orgId,
      chargingStationId: ocppIdentities.chargingStationId,
    })
    .from(ocppIdentities)
    .where(eq(ocppIdentities.id, ocppIdentityId))
    .limit(1);
  return row ?? null;
}

export async function findConnectorOnStation(
  db: Db,
  connectorId: string,
  chargingStationId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: connectors.id })
    .from(connectors)
    .innerJoin(evses, eq(evses.id, connectors.evseId))
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(evses.chargingStationId, chargingStationId),
      ),
    )
    .limit(1);
  return row ?? null;
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
export async function deleteCharger(db: Db, chargingStationId: string): Promise<void> {
  await db.delete(siteAssets).where(eq(siteAssets.id, chargingStationId));
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
 * must match `vendor`. All of this runs inside a single transaction.
 * Audit log is written AFTER the transaction commits (outside the tx so a
 * failed audit write doesn't roll back the attach).
 */
export async function attachVendorToOcppIdentity(
  db: Db,
  chargingStationId: string,
  input: {
    vendor: string;
    vendorResourceId: string;
    credentialId: string;
  },
  actorUserId: string | null,
): Promise<AttachVendorResult> {
  const { vendorCredentials } = await import("@straumvakt/shared/db/vendor");
  const { vendors } = await import("@straumvakt/shared/db/catalog");

  const result = await db.transaction(async (tx) => {
    // 1. Load the ChargingStation → first OcppIdentity.
    const [station] = await tx
      .select({ siteAssetId: chargingStations.siteAssetId, orgId: chargingStations.orgId })
      .from(chargingStations)
      .where(eq(chargingStations.siteAssetId, chargingStationId))
      .limit(1);

    if (!station) {
      throw new AttachVendorError(
        "charging_station_not_found",
        `ChargingStation ${chargingStationId} not found`,
      );
    }

    const [identity] = await tx
      .select({
        id: ocppIdentities.id,
        orgId: ocppIdentities.orgId,
        vendor: ocppIdentities.vendor,
        vendorResourceId: ocppIdentities.vendorResourceId,
        credentialsRef: ocppIdentities.credentialsRef,
      })
      .from(ocppIdentities)
      .where(eq(ocppIdentities.chargingStationId, chargingStationId))
      .orderBy(asc(ocppIdentities.createdAt))
      .limit(1);

    if (!identity) {
      throw new AttachVendorError(
        "no_ocpp_identity",
        `ChargingStation ${chargingStationId} has no OcppIdentity`,
      );
    }

    // 2. Validate the credential row.
    const [credential] = await tx
      .select({
        id: vendorCredentials.id,
        status: vendorCredentials.status,
        vendorSlug: vendors.slug,
      })
      .from(vendorCredentials)
      .innerJoin(vendors, eq(vendors.id, vendorCredentials.vendorId))
      .where(eq(vendorCredentials.id, input.credentialId))
      .limit(1);

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
    if (credential.vendorSlug !== input.vendor) {
      throw new AttachVendorError(
        "vendor_mismatch",
        `Credential vendor slug "${credential.vendorSlug}" does not match requested vendor "${input.vendor}"`,
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
    await tx
      .update(ocppIdentities)
      .set({
        vendor: input.vendor,
        vendorResourceId: input.vendorResourceId,
        credentialsRef: input.credentialId,
      })
      .where(eq(ocppIdentities.id, identity.id));

    return {
      ocppIdentityId: identity.id,
      orgId: station.orgId,
      vendor: input.vendor,
      vendorResourceId: input.vendorResourceId,
      credentialsRef: input.credentialId,
    };
  });

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

export type { DbOrTx };
