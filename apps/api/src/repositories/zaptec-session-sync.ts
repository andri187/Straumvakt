// API-only writeback — Sprint 8.7.
//
// Writes synthetic ChargeSession + ImportedCdrRef + session_ledger
// rows for Zaptec sessions that have no OCPP-side counterpart. The
// case the operator hits when a Zaptec installation has its
// Authentication Type set to "Zaptec" (not "OCPP") — chargers don't
// ship StartTransaction/StopTransaction over our gateway, so the
// vendor API is the only source of truth for billable sessions.
//
// Idempotency is anchored on charging.imported_cdr_refs's unique
// (sourceKind, sourceCdrId) index. The probe (zaptec-session-probe.ts)
// is read-only and gives the diff; this module is the writer that
// closes the gap.
//
// Same tariff chain as the OCPP-first path: Site.dsoTariffId +
// Installation.retailerTariffId, resolved via shared
// resolveTariffChainForSession + computeSessionCost. By construction
// the two paths cannot bill differently for the same session.

import type { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  listZaptecChargeHistory,
  type ZaptecChargeHistoryEntry,
} from "../lib/zaptec";
import {
  resolveTariffChainForSession,
  TariffResolutionError,
} from "../lib/tariff/resolve-tariff-chain";
import { computeSessionCost } from "../lib/tariff/compute-session-cost";

export interface ZaptecSyncOptions {
  accessToken: string;
  installationId?: string;
  chargerId?: string;
  /** ISO-8601; default = 30 days ago */
  from?: string;
  /** ISO-8601; default = now */
  to?: string;
}

export interface ZaptecSyncImported {
  zaptecId: string;
  ourSessionId: string;
  energyKwh: number;
  costIskMinor: string;
}

export interface ZaptecSyncSkip {
  zaptecId: string;
  reason:
    | "already_imported"
    | "session_open"
    | "no_station_mapped"
    | "no_evse_under_station"
    | "no_site_for_station";
}

export interface ZaptecSyncError {
  zaptecId: string;
  code:
    | TariffResolutionError["code"]
    | "tx_failed"
    | "unknown";
  detail: string;
}

export interface ZaptecSyncReport {
  zaptecCount: number;
  imported: ZaptecSyncImported[];
  skipped: ZaptecSyncSkip[];
  errors: ZaptecSyncError[];
}

export async function syncZaptecSessions(
  db: PrismaClient,
  options: ZaptecSyncOptions,
): Promise<ZaptecSyncReport> {
  const fromIso =
    options.from ?? new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  const toIso = options.to ?? new Date().toISOString();

  const resp = await listZaptecChargeHistory(options.accessToken, {
    installationId: options.installationId,
    chargerId: options.chargerId,
    from: fromIso,
    to: toIso,
    pageSize: 500,
  });
  if (!resp.ok) {
    throw new Error(
      `zaptec_chargehistory_fetch_failed: ${JSON.stringify(resp.error)}`,
    );
  }

  const report: ZaptecSyncReport = {
    zaptecCount: resp.value.length,
    imported: [],
    skipped: [],
    errors: [],
  };

  for (const z of resp.value) {
    if (!z.Id) continue;
    if (!z.EndDateTime || !z.StartDateTime) {
      report.skipped.push({ zaptecId: z.Id, reason: "session_open" });
      continue;
    }
    if (!z.ChargerId) {
      report.skipped.push({ zaptecId: z.Id, reason: "no_station_mapped" });
      continue;
    }

    try {
      const outcome = await db.$transaction(async (tx) => importOne(tx, z));
      if (outcome.kind === "imported") {
        report.imported.push(outcome.row);
      } else {
        report.skipped.push({ zaptecId: z.Id, reason: outcome.reason });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const code =
        err instanceof TariffResolutionError ? err.code : ("tx_failed" as const);
      report.errors.push({ zaptecId: z.Id, code, detail });
    }
  }

  return report;
}

type ImportOutcome =
  | { kind: "imported"; row: ZaptecSyncImported }
  | { kind: "skipped"; reason: ZaptecSyncSkip["reason"] };

async function importOne(
  tx: Prisma.TransactionClient,
  z: ZaptecChargeHistoryEntry,
): Promise<ImportOutcome> {
  // Idempotency: skip if we already imported this Zaptec session.
  const existing = await tx.importedCdrRef.findUnique({
    where: {
      sourceKind_sourceCdrId: { sourceKind: "zaptec", sourceCdrId: z.Id! },
    },
    select: { id: true },
  });
  if (existing) return { kind: "skipped", reason: "already_imported" };

  // Map Zaptec ChargerId to our station via OcppIdentity.
  const identity = await tx.ocppIdentity.findFirst({
    where: { vendor: "Zaptec", vendorResourceId: z.ChargerId! },
    select: { id: true, orgId: true, chargingStationId: true },
  });
  if (!identity) return { kind: "skipped", reason: "no_station_mapped" };

  // Resolve siteId from SiteAsset (chargingStation shares pk with siteAsset).
  const siteAsset = await tx.siteAsset.findUnique({
    where: { id: identity.chargingStationId },
    select: { siteId: true },
  });
  if (!siteAsset) return { kind: "skipped", reason: "no_site_for_station" };

  // Pick the first EVSE under the station — synthetic sessions need a
  // non-null evseId. Multi-EVSE chargers are not yet common in this
  // pilot; deterministic order keeps re-runs stable.
  const evse = await tx.eVSE.findFirst({
    where: { chargingStationId: identity.chargingStationId },
    orderBy: { evseIndex: "asc" },
    select: { id: true },
  });
  if (!evse) return { kind: "skipped", reason: "no_evse_under_station" };

  // Best-effort driver match. Try every identifier Zaptec gives us
  // against IdToken.value. UserId (Zaptec UUID) is most stable;
  // TokenName (RFID label) is what we'd see in OCPP idTag flows;
  // UserUserName / UserEmail vary if the driver renames themselves.
  // If none hit we record an anonymous ledger row — better
  // unattributed than missed.
  const candidates = [
    z.UserId,
    z.TokenName,
    z.UserUserName,
    z.UserEmail,
  ].filter((v): v is string => Boolean(v));
  let driverUserId: string | null = null;
  if (candidates.length > 0) {
    const idToken = await tx.idToken.findFirst({
      where: { value: { in: candidates }, status: "active" },
      select: { userId: true },
    });
    driverUserId = idToken?.userId ?? null;
  }

  const startedAt = new Date(z.StartDateTime!);
  const stoppedAt = new Date(z.EndDateTime!);
  const energyKwh = z.Energy ?? 0;
  const energyWh = BigInt(Math.round(energyKwh * 1000));
  const durationSec = Math.max(
    0,
    Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000),
  );

  // Sprint 8.14.5 — driver label priority. Prefer a real human name
  // (UserFullName, or first+last), then TokenName (the RFID card
  // label like "John's black tag"), then username, then email.
  // Empty for Native-auth installations where Zaptec strips user
  // data — operator sees a blank Driver column rather than a UUID.
  const fullName =
    z.UserFullName ??
    ([z.UserFirstName, z.UserLastName].filter(Boolean).join(" ").trim() ||
      null);
  const driverLabel =
    fullName ||
    z.TokenName ||
    z.UserUserName ||
    z.UserEmail ||
    null;

  // Sprint 8.14.5 — stopReason normalisation. ExternallyEnded is the
  // norm for Native auth (Zaptec App initiates the stop) — DO NOT
  // surface this as anomalous. Map to "Completed" unless an explicit
  // OCPP-style StopReason is provided.
  const stopReason =
    z.StopReason ?? (z.ExternallyEnded === false ? "EVDisconnected" : "Completed");

  // Tariff chain — same resolver the OCPP-first path uses. Throws
  // typed TariffResolutionError on misconfig; surfaces in the
  // top-level errors[] for the operator to act on.
  const chain = await resolveTariffChainForSession(tx, {
    siteId: siteAsset.siteId,
    chargingStationId: identity.chargingStationId,
  });
  const breakdown = computeSessionCost(
    { startedAt, stoppedAt, energyKwh },
    chain,
  );

  // Synthesise the ChargeSession.
  const sessionId = crypto.randomUUID();
  await tx.chargeSession.create({
    data: {
      id: sessionId,
      orgId: identity.orgId,
      siteId: siteAsset.siteId,
      chargingStationId: identity.chargingStationId,
      evseId: evse.id,
      ocppIdentityId: identity.id,
      connectorId: null,
      userId: driverUserId,
      idTag: driverLabel,
      startedAt,
      endedAt: stoppedAt,
      energyWh,
      stopReason,
      status: "completed",
      // Sprint 8.14.3 — pre-populate the rolled-up cost columns
      // so the per-session UI doesn't need to join session_ledger
      // for the cost summary.
      costExVatMinor: breakdown.subtotalExVatMinor,
      costIncVatMinor: breakdown.totalIncVatMinor,
    },
  });

  // Sprint 8.14.3 — write-through enrichment to ChargingStation
  // when Zaptec gave us fresher profile fields. Best-effort; failures
  // don't block the import. Updates only when the new value differs
  // from what's persisted (so re-imports of old sessions don't
  // overwrite a newer firmware version recorded by a more recent run).
  const stationUpdates: Record<string, string> = {};
  if (z.DeviceId) stationUpdates.serialNumber = z.DeviceId.toUpperCase();
  // Sprint 8.14.5 — Zaptec returns ChargerFirmwareVersion as a
  // structured object, not a string (Swagger says string but live
  // responses we've inspected always return the object). Format as
  // "Major.Minor.Revision.Build" for the column.
  if (z.ChargerFirmwareVersion) {
    if (typeof z.ChargerFirmwareVersion === "string") {
      stationUpdates.firmwareVersion = z.ChargerFirmwareVersion;
    } else {
      const fw = z.ChargerFirmwareVersion;
      const parts = [fw.Major, fw.Minor, fw.Revision, fw.Build].filter(
        (n): n is number => typeof n === "number",
      );
      if (parts.length > 0) {
        stationUpdates.firmwareVersion = parts.join(".");
      }
    }
  }
  if (Object.keys(stationUpdates).length > 0) {
    await tx.chargingStation
      .update({
        where: { siteAssetId: identity.chargingStationId },
        data: stationUpdates,
      })
      .catch(() => undefined);
  }

  // Sprint 8.14.3 — write-through human-readable charger name to
  // SiteAsset.displayName when Zaptec gives us one and the asset
  // is still using its default UUID-shaped name. Operator-edited
  // names are preserved (heuristic: skip if already set to a
  // meaningful label).
  if (z.DeviceName) {
    const asset = await tx.siteAsset.findUnique({
      where: { id: identity.chargingStationId },
      select: { displayName: true },
    });
    const shouldUpdate =
      asset &&
      (!asset.displayName ||
        /^[0-9a-f-]{36}$/i.test(asset.displayName) ||
        asset.displayName === z.ChargerId);
    if (shouldUpdate) {
      await tx.siteAsset
        .update({
          where: { id: identity.chargingStationId },
          data: { displayName: z.DeviceName },
        })
        .catch(() => undefined);
    }
  }

  // Imprint the vendor-id pointer so re-runs are idempotent.
  await tx.importedCdrRef.create({
    data: {
      orgId: identity.orgId,
      sessionId,
      sourceKind: "zaptec",
      sourceCdrId: z.Id!,
      importedAt: new Date(),
      rawPayload: z as unknown as Prisma.InputJsonValue,
    },
  });

  // Ledger upsert — same shape the OCPP path writes. driverIdTag
  // gets the human label (name > username > email) so the operator
  // sees who charged at a glance instead of a UUID.
  await tx.sessionLedger.upsert({
    where: { sessionId },
    create: {
      sessionId,
      orgId: identity.orgId,
      siteId: siteAsset.siteId,
      chargingStationId: identity.chargingStationId,
      driverUserId,
      driverIdTag: driverLabel,
      startedAt,
      stoppedAt,
      durationSec,
      energyKwh: energyKwh.toFixed(3),
      costIskMinor: breakdown.totalIncVatMinor,
      tariffDefinitionId: null,
    },
    update: {},
  });

  return {
    kind: "imported",
    row: {
      zaptecId: z.Id!,
      ourSessionId: sessionId,
      energyKwh,
      costIskMinor: String(breakdown.totalIncVatMinor),
    },
  };
}

export { TariffResolutionError };
