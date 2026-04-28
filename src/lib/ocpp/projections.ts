/**
 * Projection handlers for OCPP-derived domain events.
 *
 * Each handler runs inside the same Postgres transaction as the event
 * log write (see `src/lib/repositories/events.ts`). A projection
 * failure rolls back the log row too — by design. Operational tables
 * must stay faithful derivations of the log; a silent projection
 * failure would break that invariant.
 *
 * Event type → handler map is registered via `registerAllProjections`
 * below, which the main-app route calls at module load.
 *
 * Handlers pull org-scoped UUIDs from the event envelope. They may
 * query helper tables (e.g. `ocpp.connectors` → `ocpp.ocpp_identities`
 * → `assets.chargers` → `properties.sites`) to resolve extra FK
 * columns the projection target requires. These lookups use the
 * transaction client (`tx`) so they are consistent with the write.
 */
import type { Prisma } from "@/generated/prisma/client";
import {
  registerProjection,
  type IngestResult as _IngestResult,
} from "@/lib/repositories/events";
import type { IngestEvent } from "./event-envelope";

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
 * charger.booted — upsert lifecycle state onto the OCPP identity.
 */
const onChargerBooted: ProjectionHandler = async (tx, event) => {
  const now = new Date();
  await tx.ocppIdentity.update({
    where: { id: event.aggregateId },
    data: { status: "online", lastSeenAt: now },
  });
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
 * row along with the authoritative OCPP timestamp.
 */
const onConnectorStatusUpdated: ProjectionHandler = async (tx, event) => {
  const status = stringField(event.payload, "status");
  if (!status) return;
  await tx.connector.update({
    where: { id: event.aggregateId },
    data: {
      status,
      statusUpdatedAt: new Date(event.occurredAt),
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
 * session.stopped — closes out the ChargeSession row with stop reason
 * and final energy.
 */
const onSessionStopped: ProjectionHandler = async (tx, event) => {
  const meterStopWh = numberField(event.payload, "meterStopWh");
  const stopReason = stringField(event.payload, "stopReason");

  await tx.chargeSession.update({
    where: { id: event.aggregateId },
    data: {
      endedAt: new Date(event.occurredAt),
      stopReason: stopReason ?? null,
      status: "completed",
      energyWh: meterStopWh !== undefined ? BigInt(meterStopWh) : undefined,
    },
  });
};

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
