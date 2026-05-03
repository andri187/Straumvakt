/**
 * Projection handlers for OCPP-derived domain events.
 *
 * Each handler runs inside the same Postgres transaction as the event
 * log write (see `./events-repository`). A projection failure rolls
 * back the log row too — by design. Operational tables must stay
 * faithful derivations of the log; a silent projection failure would
 * break that invariant.
 *
 * Event type → handler map is registered via `registerAllProjections`
 * below, which the API Worker route calls at module load.
 *
 * Handlers pull org-scoped UUIDs from the event envelope. They may
 * query helper tables (e.g. `ocpp.connectors` → `ocpp.ocpp_identities`
 * → `assets.chargers` → `properties.sites`) to resolve extra FK
 * columns the projection target requires. These lookups use the
 * transaction client (`tx`) so they are consistent with the write.
 *
 * Ported from src/lib/ocpp/projections.ts to apps/api per Sprint S1
 * (gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md). Logic
 * unchanged byte-for-byte; only the Prisma client import path and the
 * events-repository path differ.
 */
import type { Prisma } from "../../generated/prisma/client";
import {
  registerProjection,
  type IngestResult as _IngestResult,
} from "./events-repository";
import type { IngestEvent } from "./event-envelope";
import { computeSessionCost } from "../tariff/compute-session-cost";
import {
  resolveTariffChainForSession,
  TariffResolutionError,
} from "../tariff/resolve-tariff-chain";

// Re-export the handler type so other modules can declare their own
// without depending on the internals of the events repository.
export type ProjectionHandler = (
  tx: Prisma.TransactionClient,
  event: IngestEvent,
) => Promise<void>;

// Silence unused-import lint (type re-export is intentional for consumers).
export type { _IngestResult };

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * charger.booted — upsert lifecycle state onto the OCPP identity AND
 * mirror BootNotification profile fields onto the ChargingStation row
 * (OCPP 1.6 §6.2 / 2.0.1 §1.4). Operator detail page renders these
 * read-only — the source of truth is the charger itself, surfaced on
 * each boot.
 *
 * Walks identity → station so we can update both rows in the same tx.
 * If the OcppIdentity has no chargingStation (shouldn't happen for
 * provisioned identities, but defensive), the station update is
 * skipped.
 */
const onChargerBooted: ProjectionHandler = async (tx, event) => {
  const now = new Date();
  const identity = await tx.ocppIdentity.update({
    where: { id: event.aggregateId },
    data: { status: "online", lastSeenAt: now },
    select: { chargingStationId: true },
  });

  // BootNotification payload field names per OCPP 1.6 spec.
  // Treat all as optional — vendors omit per-firmware-version.
  const stationData: Record<string, string | undefined> = {};
  const setIfPresent = (column: string, key: string) => {
    const v = stringField(event.payload, key);
    if (v !== undefined) stationData[column] = v;
  };
  setIfPresent("vendor", "chargePointVendor");
  setIfPresent("model", "chargePointModel");
  setIfPresent("serialNumber", "chargePointSerialNumber");
  setIfPresent("chargeBoxSerialNumber", "chargeBoxSerialNumber");
  setIfPresent("firmwareVersion", "firmwareVersion");
  setIfPresent("meterType", "meterType");
  setIfPresent("meterSerialNumber", "meterSerialNumber");
  setIfPresent("iccid", "iccid");
  setIfPresent("imsi", "imsi");

  if (identity.chargingStationId && Object.keys(stationData).length > 0) {
    await tx.chargingStation.update({
      where: { siteAssetId: identity.chargingStationId },
      data: stationData,
    });
  }
};

/**
 * charger.heartbeat — bump last_seen_at only. Status unchanged.
 */
const onChargerHeartbeat: ProjectionHandler = async (tx, event) => {
  await tx.ocppIdentity.update({
    where: { id: event.aggregateId },
    data: { lastSeenAt: new Date() },
  });
};

/**
 * charger.status_updated — connectorId=0 StatusNotification. Mirrors
 * to the OCPP identity row.
 */
const onChargerStatusUpdated: ProjectionHandler = async (tx, event) => {
  const status = stringField(event.payload, "status");
  if (!status) return;
  await tx.ocppIdentity.update({
    where: { id: event.aggregateId },
    data: { status, lastSeenAt: new Date() },
  });
};

/**
 * connector.status_updated — writes the latest status to the connector
 * row along with the authoritative OCPP timestamp + the StatusNotification
 * error fields (OCPP 1.6 §4.9). vendorErrorCode is rare but useful for
 * vendor-specific diagnostics; errorCode of "NoError" is normalised to
 * null so the operator UI can branch on `errorCode != null` cleanly.
 */
const onConnectorStatusUpdated: ProjectionHandler = async (tx, event) => {
  const status = stringField(event.payload, "status");
  if (!status) return;
  const rawErrorCode = stringField(event.payload, "errorCode");
  const errorCode =
    rawErrorCode === undefined || rawErrorCode === "NoError" ? null : rawErrorCode;
  const vendorErrorCode = stringField(event.payload, "vendorErrorCode") ?? null;

  await tx.connector.update({
    where: { id: event.aggregateId },
    data: {
      status,
      statusUpdatedAt: new Date(event.occurredAt),
      errorCode,
      vendorErrorCode,
    },
  });
};

/**
 * session.started — insert a new ChargeSession row. Resolves
 * chargerId + siteId by walking Connector → OcppIdentity → Charger →
 * SiteAsset → Site.
 */
const onSessionStarted: ProjectionHandler = async (tx, event) => {
  const connectorId = stringField(event.payload, "connectorId");
  const idTag = stringField(event.payload, "idTag");
  const meterStartWh = numberField(event.payload, "meterStartWh");
  if (!connectorId) throw new Error("session.started payload missing connectorId");

  // ADR 0012: connector anchors on EVSE; resolve station + identity via
  // EVSE -> ChargingStation chain and look up the OCPP identity that
  // posted this event by station.
  const connector = await tx.connector.findUnique({
    where: { id: connectorId },
    select: {
      orgId: true,
      evseId: true,
      evse: {
        select: {
          chargingStationId: true,
          chargingStation: {
            select: {
              siteAsset: { select: { siteId: true } },
              ocppIdentities: { select: { id: true }, take: 1 },
            },
          },
        },
      },
    },
  });
  if (!connector) throw new Error(`session.started: connector ${connectorId} not found`);

  const siteId = connector.evse.chargingStation.siteAsset.siteId;
  const chargingStationId = connector.evse.chargingStationId;
  const ocppIdentityId =
    connector.evse.chargingStation.ocppIdentities[0]?.id ?? null;

  await tx.chargeSession.create({
    data: {
      id: event.aggregateId,
      orgId: event.orgId,
      siteId,
      chargingStationId,
      evseId: connector.evseId,
      ocppIdentityId,
      connectorId,
      idTag: idTag ?? null,
      startedAt: new Date(event.occurredAt),
      energyWh: meterStartWh !== undefined ? BigInt(meterStartWh) : null,
      status: "in_progress",
    },
  });
};

/**
 * session.meter_value_recorded — inserts one row per sampled value
 * into `charging.meter_values`. The running `energyWh` on the session
 * is updated to the max energy reading seen so far.
 */
const onSessionMeterValueRecorded: ProjectionHandler = async (tx, event) => {
  const meterValues = arrayField(event.payload, "meterValues");
  if (!meterValues) return;

  type MV = {
    timestamp?: string;
    sampledValue?: Array<{
      value?: string;
      measurand?: string;
      unit?: string;
    }>;
  };

  let maxEnergyWh: bigint | null = null;

  for (const mv of meterValues as MV[]) {
    const ts = mv.timestamp ? new Date(mv.timestamp) : new Date(event.occurredAt);
    for (const sv of mv.sampledValue ?? []) {
      const energyWh = parseEnergyWh(sv.value, sv.measurand, sv.unit);
      const powerW = parsePowerW(sv.value, sv.measurand, sv.unit);
      await tx.meterValue.create({
        data: {
          orgId: event.orgId,
          sessionId: event.aggregateId,
          measuredAt: ts,
          energyWh: energyWh,
          powerW: powerW,
        },
      });
      if (energyWh !== null && (maxEnergyWh === null || energyWh > maxEnergyWh)) {
        maxEnergyWh = energyWh;
      }
    }
  }

  if (maxEnergyWh !== null) {
    await tx.chargeSession.update({
      where: { id: event.aggregateId },
      data: { energyWh: maxEnergyWh },
    });
  }
};

/**
 * ocpp.command_result — the gateway emits this after it receives a
 * CallResult or CallError matching one of our outbound commands.
 *
 * Resolves the outbox row by `aggregateId` (= the outbound_commands.id
 * the dispatcher minted) and reflects the charger's actual response
 * back into the row:
 *
 *   • Gateway-level outcome "rejected" (CallError frame from charger)
 *     → status = 'failed'.
 *   • Gateway-level outcome "accepted" but the OCPP CallResult payload
 *     carries a `status` field that isn't "Accepted" / "RebootRequired"
 *     (e.g. RemoteStartTransaction returning {status: "Rejected"})
 *     → status = 'failed'. The dispatch made it; the charger refused.
 *   • Otherwise → status = 'acked'.
 *
 * The `result` JSON column is overwritten with the full event payload
 * (commandId, action, outcome, charger response, latencyMs) so the
 * operator console can render exactly what the charger said.
 *
 * Note: the dispatcher already marks the row 'acked' when the gateway
 * returns 202 from /dispatch — that was a "we sent it" ack, not a
 * "charger accepted" ack. This projection promotes that to the real
 * truth or downgrades to 'failed', whichever applies.
 */
const onCommandResult: ProjectionHandler = async (tx, event) => {
  const outcome = stringField(event.payload, "outcome");
  if (outcome !== "accepted" && outcome !== "rejected") return;

  const result = (event.payload as { result?: unknown }).result;
  const chargerStatus =
    result && typeof result === "object"
      ? stringField(result as Record<string, unknown>, "status")
      : undefined;

  // OCPP responses where status is informational-only or non-rejection.
  // RebootRequired / NotSupported can be treated as 'acked' from the
  // outbox's perspective — the command was processed, just not the way
  // we hoped. Operator can drill in via the result payload.
  const isChargerRejected =
    outcome === "rejected" ||
    (chargerStatus !== undefined &&
      chargerStatus !== "Accepted" &&
      chargerStatus !== "RebootRequired" &&
      chargerStatus !== "NotSupported");

  await tx.outboundCommand.update({
    where: { id: event.aggregateId },
    data: {
      status: isChargerRejected ? "failed" : "acked",
      result: event.payload as Prisma.InputJsonValue,
    },
  });
};

/**
 * session.stopped — closes out the ChargeSession row with stop reason
 * and final energy. Sprint 8.5: ALSO computes the session's cost via
 * the pure-function tariff engine and writes a row to
 * reports.session_ledger so the operator-side billing dashboard
 * has data to render.
 *
 * Atomicity: the ledger write rides the same Prisma transaction as
 * the ChargeSession update. Tariff-resolution failures throw the
 * whole projection — the session.stopped event_log row rolls back
 * too, and the queue consumer retries via CF Queues. Operator-side
 * fix is to populate Site.dsoTariffId / Installation.retailerTariffId
 * via the operator console; the DLQ replay then catches up.
 *
 * Cost is COMPUTED ONCE on stop. The ledger row is immutable by
 * cost_isk_minor — operator-side disputes (e.g. wrong tariff applied
 * because the operator misconfigured) are resolved via a separate
 * credit-memo / refund workflow, not by editing the ledger row in
 * place. That workflow lands post-pilot per ADR 0005.
 */
const onSessionStopped: ProjectionHandler = async (tx, event) => {
  const meterStopWh = numberField(event.payload, "meterStopWh");
  const stopReason = stringField(event.payload, "stopReason");

  // Step 1: close the ChargeSession (existing behaviour, unchanged).
  const updated = await tx.chargeSession.update({
    where: { id: event.aggregateId },
    data: {
      endedAt: new Date(event.occurredAt),
      stopReason: stopReason ?? null,
      status: "completed",
      energyWh: meterStopWh !== undefined ? BigInt(meterStopWh) : undefined,
    },
    select: {
      id: true,
      orgId: true,
      siteId: true,
      chargingStationId: true,
      ocppIdentityId: true,
      idTag: true,
      startedAt: true,
      endedAt: true,
      energyWh: true,
    },
  });

  // Step 2: resolve the TariffChain that applies to this session's
  // location. Throws if Site.dsoTariffId or Installation.retailerTariffId
  // is unconfigured — see resolve-tariff-chain.ts for the full
  // matrix of TariffResolutionError codes. The throw rolls back the
  // tx; CF Queues redelivers; operator fixes the misconfig.
  if (!updated.siteId || !updated.chargingStationId) {
    // Defensive — session.started should have populated both. Skip
    // ledger write rather than throw on legacy rows missing them.
    console.warn("[projections] session.stopped: missing siteId/chargingStationId, skipping ledger", {
      sessionId: updated.id,
      siteId: updated.siteId,
      chargingStationId: updated.chargingStationId,
    });
    return;
  }
  const chain = await resolveTariffChainForSession(tx, {
    siteId: updated.siteId,
    chargingStationId: updated.chargingStationId,
  });

  // Step 3: compute the cost.
  const energyKwh =
    updated.energyWh !== null ? Number(updated.energyWh) / 1000 : 0;
  const stoppedAt = updated.endedAt ?? new Date(event.occurredAt);
  const startedAt = updated.startedAt;
  const durationSec = Math.max(
    0,
    Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000),
  );

  const breakdown = computeSessionCost(
    {
      startedAt,
      stoppedAt,
      energyKwh,
    },
    chain,
  );

  // Resolve driver via idTag → IdToken → userId. Drivers see their
  // own ledger entries via this column (Sprint 8.4 read scope).
  // Best-effort: a missing IdToken row leaves driver_user_id NULL,
  // and the session is still recorded — operator can backfill or
  // the ledger row stays driver-anonymous (e.g. roaming sessions).
  let driverUserId: string | null = null;
  if (updated.idTag) {
    const idTokenRow = await tx.idToken.findFirst({
      where: {
        value: updated.idTag,
        status: "active",
      },
      select: { userId: true },
    });
    driverUserId = idTokenRow?.userId ?? null;
  }

  // Step 4: upsert the ledger row. Upsert (not insert) so a session
  // that gets a duplicate session.stopped event (replay through
  // idempotency cache miss → projection rerun) doesn't crash on PK
  // collision. The idempotency_keys cache normally catches replays
  // upstream of projections; this is belt-and-braces.
  await tx.sessionLedger.upsert({
    where: { sessionId: updated.id },
    create: {
      sessionId: updated.id,
      orgId: updated.orgId,
      siteId: updated.siteId,
      chargingStationId: updated.chargingStationId,
      driverUserId,
      driverIdTag: updated.idTag ?? null,
      startedAt: updated.startedAt,
      stoppedAt,
      durationSec,
      energyKwh: energyKwh.toFixed(3),
      costIskMinor: breakdown.totalIncVatMinor,
      tariffDefinitionId: null, // chain has 2 tariffs; can't pick one. Future schema change to add JSONB breakdown.
    },
    update: {
      // No-op on conflict — once the row exists with its computed
      // cost, we trust the original write. Replays at the projection
      // level are unexpected (idempotency catches upstream); if we
      // do see one, prefer not to overwrite a settled cost.
      stoppedAt: stoppedAt,
    },
  });

  console.log("[ledger] session_cost_recorded", {
    sessionId: updated.id,
    orgId: updated.orgId,
    siteId: updated.siteId,
    energyKwh,
    durationSec,
    subtotalExVatMinor: String(breakdown.subtotalExVatMinor),
    vatMinor: String(breakdown.vatMinor),
    totalIncVatMinor: String(breakdown.totalIncVatMinor),
    components: breakdown.lineItems
      .filter((l) => l.kind !== "vat")
      .map((l) => ({ kind: l.kind, code: l.code, amountMinor: String(l.amountMinor) })),
  });
};

// Re-export so callers can catch the resolver's typed errors at
// the queue-consumer boundary if they want.
export { TariffResolutionError };

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

let registered = false;

/**
 * Idempotent — safe to call from multiple module-load paths. Called
 * from `src/lib/ocpp/bootstrap.ts` so the route handler and tests
 * share one registration point.
 */
export function registerAllProjections(): void {
  if (registered) return;
  registered = true;
  registerProjection("charger.booted", onChargerBooted);
  registerProjection("charger.heartbeat", onChargerHeartbeat);
  registerProjection("charger.status_updated", onChargerStatusUpdated);
  registerProjection("connector.status_updated", onConnectorStatusUpdated);
  registerProjection("session.started", onSessionStarted);
  registerProjection("session.meter_value_recorded", onSessionMeterValueRecorded);
  registerProjection("session.stopped", onSessionStopped);
  registerProjection("ocpp.command_result", onCommandResult);
  // card.authorize_requested intentionally has no projection handler —
  // Sprint 2 wires it through the OCPI token resolver.
  // ocpp.unknown_message intentionally has no projection — logged only.
}

/** Test-only hook. */
export function __resetRegistrationForTests(): void {
  registered = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload accessors — keep projection handlers free of unknown-cast churn.
// ─────────────────────────────────────────────────────────────────────────────

function stringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function numberField(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

function arrayField(obj: unknown, key: string): unknown[] | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : undefined;
}

/**
 * Energy values in OCPP come as strings, sometimes with units. We only
 * persist energy in Wh. If `measurand` is explicit, use it; otherwise
 * assume cumulative energy (the OCPP default for an omitted measurand).
 */
function parseEnergyWh(
  value: string | undefined,
  measurand: string | undefined,
  unit: string | undefined,
): bigint | null {
  if (value === undefined) return null;
  const isEnergyMeasurand =
    measurand === undefined ||
    measurand === "Energy.Active.Import.Register" ||
    measurand === "Energy.Reactive.Import.Register";
  if (!isEnergyMeasurand) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const wh = unit === "kWh" ? n * 1000 : n; // default unit is Wh per OCPP 1.6
  return BigInt(Math.round(wh));
}

function parsePowerW(
  value: string | undefined,
  measurand: string | undefined,
  unit: string | undefined,
): number | null {
  if (value === undefined) return null;
  if (measurand !== "Power.Active.Import") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const w = unit === "kW" ? n * 1000 : n;
  return Math.round(w);
}
