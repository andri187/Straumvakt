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
  resolveTariffChainWithIdsForSession,
  TariffResolutionError,
} from "../tariff/resolve-tariff-chain";
import { parseOcmf } from "../ocmf";
import { lookupOuiVendor, formatMac } from "../oui/lookup";

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

  // Step 1: close the ChargeSession (existing behaviour, unchanged
  // for canonical fields). ENRICH-1 also mirrors the OCPP figure
  // onto `ocppEnergyKwh` / `ocppStoppedAt` so a later CDR / AMQP
  // overlay can't silently erase what OCPP saw. The kWh mirror is
  // computed from Wh in the same expression — keeps the two columns
  // arithmetically consistent at write-time.
  const ocppStoppedAt = new Date(event.occurredAt);
  const ocppEnergyKwh =
    meterStopWh !== undefined ? (meterStopWh / 1000).toFixed(4) : undefined;
  const updated = await tx.chargeSession.update({
    where: { id: event.aggregateId },
    data: {
      endedAt: ocppStoppedAt,
      stopReason: stopReason ?? null,
      status: "completed",
      energyWh: meterStopWh !== undefined ? BigInt(meterStopWh) : undefined,
      // ENRICH-1 — per-source mirror, never overwritten by later feeds.
      ...(ocppEnergyKwh !== undefined ? { ocppEnergyKwh } : {}),
      ocppStoppedAt,
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
  const resolved = await resolveTariffChainWithIdsForSession(tx, {
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
    resolved.chain,
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
      // Sprint 9 FIX-1 — audit-trail FK. Chain has 2 tariffs
      // (DSO + retailer); we record the DSO id because DSO is the
      // primary anchor per ADR 0008. TODO post-pilot: when schema
      // supports both, also persist retailerTariffDefinitionId
      // (resolved.retailerTariffDefinitionId) as a JSONB breakdown
      // or sibling FK column.
      tariffDefinitionId: resolved.dsoTariffDefinitionId,
      // ENRICH-1 — provenance. OCPP is the first writer; ledger is
      // "pending" until the CDR / AMQP feed confirms (or diverges).
      // Documents current billing reality, not a new flip.
      verifiedSource: "ocpp",
      enrichmentStatus: "pending",
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

/**
 * ocpp.raw.MeterValues — Sprint 9 / ADR 0036 Autocharge Step C.
 *
 * MeterValues frames can carry OCMF blobs in their `signedMeterData`
 * field (OCPP 1.6 SignedMeterValue extension; format="SignedData").
 * The blob is byte-for-byte identical to what AMQP StateId 723
 * delivers post-session, but MeterValues fires DURING the session at
 * the configured sample interval — earlier visibility, plus a
 * transport-symmetric capture path (closes the gap I flagged in
 * ADR 0036 §4).
 *
 * Resolution strategy: the gateway sets aggregateId = identity_id on
 * every raw frame. We find the in-progress ChargeSession for that
 * identity and write the OCMF block onto it.
 *
 * Idempotent: if the session already has ocmf_signed_session
 * populated (e.g. AMQP 723 fired first, or a prior MeterValues frame
 * already projected), we skip. First-arrival wins. Both paths carry
 * the same byte-for-byte OCMF so this is a safe heuristic.
 *
 * When the parsed OCMF identity has type=EVCCID, we ALSO populate
 * ev_plc_mac + ev_plc_mac_oui_vendor (the link-layer columns from
 * ADR 0036 §2). EVCCID per OCMF spec is the EV's PLC modem MAC.
 *
 * Note: the gateway DO emits ocpp.raw.X (raw protocol frame name) —
 * not the translated session.X / charger.X domain event names that
 * the older projection handlers register against. Per ADR 0036 §4
 * we register on the raw name directly, which is the live wire format
 * Dalvegur produces.
 */
const onOcppRawMeterValues: ProjectionHandler = async (tx, event) => {
  // Pull the array of meterValue groups from the OCPP 1.6 payload.
  // Shape: { transactionId?, connectorId?, meterValue: [{timestamp, sampledValue: [{value, format, measurand, ...}]}] }
  const request = (event.payload as { request?: unknown }).request;
  if (!request || typeof request !== "object") return;
  const meterValueArr = arrayField(request, "meterValue");
  if (!meterValueArr) return;

  // Hunt for an OCMF-bearing signedMeterData entry. Vendors emit zero
  // or one per MeterValues frame typically; scan all to be safe.
  let ocmfBlob: string | null = null;
  for (const mv of meterValueArr) {
    if (!mv || typeof mv !== "object") continue;
    const sampledValue = arrayField(mv as Record<string, unknown>, "sampledValue");
    if (!sampledValue) continue;
    for (const sv of sampledValue) {
      if (!sv || typeof sv !== "object") continue;
      const svObj = sv as Record<string, unknown>;
      const format = stringField(svObj, "format");
      const value = stringField(svObj, "value");
      if (format === "SignedData" && value && value.startsWith("OCMF|")) {
        ocmfBlob = value;
        break;
      }
    }
    if (ocmfBlob) break;
  }
  if (!ocmfBlob) return;

  // Parse the OCMF envelope.
  const parsed = parseOcmf(ocmfBlob);
  if (!parsed) return;

  // Resolve the in-progress session for this charger. aggregateId is
  // the identity_id (gateway sets it on every raw frame). If no
  // in-progress session is found, log + skip — MeterValues outside an
  // active session is a vendor quirk we don't need to project.
  const session = await tx.chargeSession.findFirst({
    where: {
      ocppIdentityId: event.aggregateId,
      status: "in_progress",
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      ocmfSignedSession: true,
    },
  });
  if (!session) {
    console.warn("[ocpp.raw.MeterValues] no in-progress session for identity, skipping OCMF projection", {
      identityId: event.aggregateId,
    });
    return;
  }

  // Idempotent: if OCMF blob is already on the session, skip. Both
  // AMQP 723 and OCPP MeterValues carry byte-for-byte identical OCMF
  // so first-arrival wins; we don't overwrite.
  if (session.ocmfSignedSession) return;

  // Derive link-layer fields when OCMF identity is EVCCID — per OCMF
  // spec EVCCID is the EV's PLC modem MAC.
  let evPlcMac: string | null = null;
  let evPlcMacOuiVendor: string | null = null;
  if (parsed.identity?.idType === "EVCCID" && parsed.identity.idValue) {
    const formatted = formatMac(parsed.identity.idValue);
    if (formatted) {
      evPlcMac = formatted;
      const oui = lookupOuiVendor(formatted);
      evPlcMacOuiVendor = oui.vendor;
    }
  }

  await tx.chargeSession.update({
    where: { id: session.id },
    data: {
      // OCMF gateway block
      ocmfSignedSession: ocmfBlob,
      ocmfFormatVersion: parsed.formatVersion,
      ocmfGatewayId: parsed.gatewayId,
      ocmfGatewaySerial: parsed.gatewaySerial,
      ocmfGatewayVersion: parsed.gatewayVersion,
      // first/last/signed kWh derived from OCMF readings
      ocmfFirstReadingKwh:
        parsed.readings[0]?.cumulativeKwh != null
          ? parsed.readings[0].cumulativeKwh.toFixed(4)
          : null,
      ocmfLastReadingKwh:
        parsed.readings[parsed.readings.length - 1]?.cumulativeKwh != null
          ? parsed.readings[parsed.readings.length - 1]!.cumulativeKwh.toFixed(4)
          : null,
      ocmfSignedSessionKwh:
        parsed.readings.length >= 2
          ? (
              parsed.readings[parsed.readings.length - 1]!.cumulativeKwh -
              parsed.readings[0]!.cumulativeKwh
            ).toFixed(4)
          : null,
      // OCMF identity block
      authIdStatus: parsed.identity?.identified ?? null,
      authIdLevel: parsed.identity?.level ?? null,
      authIdType: parsed.identity?.idType ?? null,
      authIdValue: parsed.identity?.idValue ?? null,
      authIdFlags: parsed.identity?.flags ?? [],
      // Synthetic seen-at — distinguishable from AMQP 723 path because
      // completedSessionRawJson stays null (only the AMQP handler
      // writes that). The provenance discriminator on the page reads
      // raw_json IS NULL ? "backfilled or OCPP-projected" : "AMQP-live".
      completedSessionSeenAt: new Date(event.occurredAt),
      // Link-layer columns when identity is EVCCID
      evPlcMac,
      evPlcMacOuiVendor,
    },
  });

  console.log("[ocpp.raw.MeterValues] OCMF projected", {
    sessionId: session.id,
    identityId: event.aggregateId,
    gatewaySerial: parsed.gatewaySerial,
    identityType: parsed.identity?.idType ?? null,
    evPlcMacCaptured: evPlcMac !== null,
    vendor: evPlcMacOuiVendor,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Raw-frame handlers (Sprint 9 / 2026-05-11 — projection-gap fix)
//
// The gateway DO emits ocpp.raw.<Action> envelopes with the OCPP
// request payload nested under event.payload.request. The legacy
// domain-event handlers above (charger.booted, connector.status_updated,
// session.started, session.stopped) were never reached because no
// translator emits those domain events — only ocpp.raw.MeterValues
// had a raw handler before this commit.
//
// These four raw handlers close the gap directly: read from
// event.payload.request, resolve UUIDs via OcppIdentity → station
// chain, write the operational tables. Symptom that motivated the
// fix: 426 StatusNotification frames from Dalvegur on 2026-05-11
// landed in event_log but assets.connectors.status never moved.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a Connector row from the OCPP frame's integer connectorId.
 *
 * OCPP 1.6 addresses connectors as integers (1..N for actual connectors,
 * 0 for the charge-point itself). Our schema stores connectors with
 * UUIDs, indexed by `connector_index` int under an EVSE under a
 * ChargingStation.
 *
 * Lookup walks: OcppIdentity → ChargingStation → EVSE[] → Connector[]
 * and returns the first connector whose `connector_index` matches the
 * OCPP value. For single-EVSE single-connector hardware (Zaptec Pro,
 * the common case) this is unambiguous. For multi-EVSE hardware the
 * first match wins — acceptable until OCPP 2.0.1 evseId+connectorId
 * pair semantics land.
 *
 * Returns null when no match (charger sent a connectorId for hardware
 * we haven't provisioned yet — log + skip, don't throw).
 */
async function resolveConnectorByOcppIndex(
  tx: Prisma.TransactionClient,
  ocppIdentityId: string,
  connectorIndex: number,
): Promise<{
  connectorId: string;
  evseId: string;
  chargingStationId: string;
  siteId: string;
  orgId: string;
} | null> {
  const identity = await tx.ocppIdentity.findUnique({
    where: { id: ocppIdentityId },
    select: {
      orgId: true,
      chargingStation: {
        select: {
          siteAssetId: true,
          siteAsset: { select: { siteId: true } },
          evses: {
            select: {
              id: true,
              connectors: {
                where: { connectorIndex },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  });
  if (!identity?.chargingStation) return null;
  for (const evse of identity.chargingStation.evses) {
    const conn = evse.connectors[0];
    if (conn) {
      return {
        connectorId: conn.id,
        evseId: evse.id,
        chargingStationId: identity.chargingStation.siteAssetId,
        siteId: identity.chargingStation.siteAsset.siteId,
        orgId: identity.orgId,
      };
    }
  }
  return null;
}

/**
 * ocpp.raw.BootNotification — set the identity to 'online', mirror the
 * BootNotification profile fields (vendor, model, serial, firmware, etc.)
 * onto the ChargingStation. Mirrors the legacy `onChargerBooted` body
 * but reads from event.payload.request.
 */
const onOcppRawBootNotification: ProjectionHandler = async (tx, event) => {
  const request = (event.payload as { request?: unknown }).request;
  if (!request || typeof request !== "object") return;

  const now = new Date(event.occurredAt);
  const identity = await tx.ocppIdentity.update({
    where: { id: event.aggregateId },
    data: { status: "online", lastSeenAt: now },
    select: { chargingStationId: true },
  });

  const stationData: Record<string, string | undefined> = {};
  const setIfPresent = (column: string, key: string) => {
    const v = stringField(request, key);
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
 * ocpp.raw.StatusNotification — write the connector's per-connector
 * status (connectorId > 0) OR the charge-point-wide status
 * (connectorId === 0, mirrors to ocpp_identities.status).
 *
 * OCPP 1.6 §4.9 payload: { connectorId, status, errorCode,
 * vendorErrorCode?, info?, timestamp?, vendorId? }
 *
 * status is PascalCase per OCPP spec ("Available" / "Charging" /
 * "Preparing" / "Faulted" / etc.) — written verbatim. Driver/operator
 * UI normalises with mapConnectorStatus().
 */
const onOcppRawStatusNotification: ProjectionHandler = async (tx, event) => {
  const request = (event.payload as { request?: unknown }).request;
  if (!request || typeof request !== "object") return;
  const status = stringField(request, "status");
  if (!status) return;
  const connectorIndex = numberField(request, "connectorId");
  if (connectorIndex === undefined) return;

  const rawErrorCode = stringField(request, "errorCode");
  const errorCode =
    rawErrorCode === undefined || rawErrorCode === "NoError"
      ? null
      : rawErrorCode;
  const vendorErrorCode = stringField(request, "vendorErrorCode") ?? null;
  const occurredAt = new Date(event.occurredAt);

  // connectorId === 0 — charge-point-wide status; mirrors to identity.
  if (connectorIndex === 0) {
    await tx.ocppIdentity.update({
      where: { id: event.aggregateId },
      data: { status, lastSeenAt: occurredAt },
    });
    return;
  }

  // connectorId > 0 — per-connector status.
  const resolved = await resolveConnectorByOcppIndex(
    tx,
    event.aggregateId,
    connectorIndex,
  );
  if (!resolved) {
    console.warn("[ocpp.raw.StatusNotification] connector not found, skipping", {
      identityId: event.aggregateId,
      connectorIndex,
    });
    return;
  }
  await tx.connector.update({
    where: { id: resolved.connectorId },
    data: {
      status,
      statusUpdatedAt: occurredAt,
      errorCode,
      vendorErrorCode,
    },
  });
};

/**
 * ocpp.raw.StartTransaction — mint a new ChargeSession in
 * status='in_progress'. Resolves connector + EVSE + site + org from
 * the OCPP identity chain. idTag is captured; userId resolution
 * (idTag → IdToken → User) is deferred to session.stopped's ledger
 * pass — same as the legacy onSessionStopped path does today.
 *
 * Idempotency note: if a re-delivered event triggers a second insert,
 * the in-progress session for this identity won't have a unique
 * constraint to collide on. We accept the duplicate-session risk on
 * replay (queue-level idempotency via event_id is the first defence)
 * and rely on the StopTransaction handler picking the most recent
 * in-progress row to close.
 *
 * Note: OCPP transactionId (random int the gateway returned in the
 * CallResult) is NOT in the event log — the DO mints it after this
 * event is enqueued. StopTransaction handler closes by
 * (ocppIdentityId, status='in_progress') instead. Per OCPP spec a
 * connector has at most one in-progress transaction so this is
 * unambiguous for single-EVSE hardware.
 */
const onOcppRawStartTransaction: ProjectionHandler = async (tx, event) => {
  const request = (event.payload as { request?: unknown }).request;
  if (!request || typeof request !== "object") return;
  const connectorIndex = numberField(request, "connectorId");
  if (connectorIndex === undefined || connectorIndex === 0) return;
  const idTag = stringField(request, "idTag");
  const meterStartWh = numberField(request, "meterStart");
  const timestamp = stringField(request, "timestamp");

  const resolved = await resolveConnectorByOcppIndex(
    tx,
    event.aggregateId,
    connectorIndex,
  );
  if (!resolved) {
    console.warn("[ocpp.raw.StartTransaction] connector not found, skipping", {
      identityId: event.aggregateId,
      connectorIndex,
    });
    return;
  }

  const startedAt = timestamp ? new Date(timestamp) : new Date(event.occurredAt);

  await tx.chargeSession.create({
    data: {
      orgId: resolved.orgId,
      siteId: resolved.siteId,
      chargingStationId: resolved.chargingStationId,
      evseId: resolved.evseId,
      connectorId: resolved.connectorId,
      ocppIdentityId: event.aggregateId,
      idTag: idTag ?? null,
      startedAt,
      energyWh: meterStartWh !== undefined ? BigInt(meterStartWh) : null,
      status: "in_progress",
    },
  });
};

/**
 * ocpp.raw.StopTransaction — close out the in-progress session for
 * this identity (most recent one wins per the design note on Start).
 * Mirrors the legacy onSessionStopped body for the tariff resolution
 * + ledger write, just sourcing the session by identity lookup instead
 * of by event.aggregateId.
 *
 * Skip-on-miss is intentional: if no in-progress session is found
 * (e.g. StartTransaction predated this fix), warn and ack the event.
 * Operator can backfill via the Zaptec REST CDR path (which doesn't
 * depend on OCPP).
 */
const onOcppRawStopTransaction: ProjectionHandler = async (tx, event) => {
  const request = (event.payload as { request?: unknown }).request;
  if (!request || typeof request !== "object") return;
  const meterStopWh = numberField(request, "meterStop");
  const stopReason = stringField(request, "reason");
  const timestamp = stringField(request, "timestamp");
  const endedAt = timestamp ? new Date(timestamp) : new Date(event.occurredAt);

  // Find the most recent in-progress session for this identity.
  const session = await tx.chargeSession.findFirst({
    where: { ocppIdentityId: event.aggregateId, status: "in_progress" },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      orgId: true,
      siteId: true,
      chargingStationId: true,
      idTag: true,
      startedAt: true,
      energyWh: true,
    },
  });
  if (!session) {
    console.warn("[ocpp.raw.StopTransaction] no in-progress session, skipping", {
      identityId: event.aggregateId,
    });
    return;
  }

  // ENRICH-1 — mirror the OCPP figure onto `ocppEnergyKwh` /
  // `ocppStoppedAt` so the later CDR / AMQP overlay can't silently
  // erase what OCPP saw. Canonical `energy_wh` + `ended_at` stay
  // unchanged for back-compat billing reads.
  const ocppEnergyKwh =
    meterStopWh !== undefined ? (meterStopWh / 1000).toFixed(4) : undefined;
  const updated = await tx.chargeSession.update({
    where: { id: session.id },
    data: {
      endedAt,
      stopReason: stopReason ?? null,
      status: "completed",
      energyWh: meterStopWh !== undefined ? BigInt(meterStopWh) : undefined,
      ...(ocppEnergyKwh !== undefined ? { ocppEnergyKwh } : {}),
      ocppStoppedAt: endedAt,
    },
    select: {
      id: true,
      orgId: true,
      siteId: true,
      chargingStationId: true,
      idTag: true,
      startedAt: true,
      endedAt: true,
      energyWh: true,
    },
  });

  // Tariff resolution + ledger write — same path as legacy
  // onSessionStopped. Throws TariffResolutionError if Site.dsoTariffId
  // or Installation.retailerTariffId is unconfigured; CF Queues
  // retries; operator fix via reference catalogue + tariff console.
  if (!updated.siteId || !updated.chargingStationId) {
    console.warn("[ocpp.raw.StopTransaction] session missing siteId/chargingStationId, skipping ledger", {
      sessionId: updated.id,
    });
    return;
  }
  const resolved = await resolveTariffChainWithIdsForSession(tx, {
    siteId: updated.siteId,
    chargingStationId: updated.chargingStationId,
  });

  const energyKwh =
    updated.energyWh !== null ? Number(updated.energyWh) / 1000 : 0;
  const stoppedAt = updated.endedAt ?? endedAt;
  const durationSec = Math.max(
    0,
    Math.round((stoppedAt.getTime() - updated.startedAt.getTime()) / 1000),
  );
  const breakdown = computeSessionCost(
    { startedAt: updated.startedAt, stoppedAt, energyKwh },
    resolved.chain,
  );

  let driverUserId: string | null = null;
  if (updated.idTag) {
    const idTokenRow = await tx.idToken.findFirst({
      where: { value: updated.idTag, status: "active" },
      select: { userId: true },
    });
    driverUserId = idTokenRow?.userId ?? null;
  }

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
      // Sprint 9 FIX-1 — audit-trail FK (DSO; see legacy onSessionStopped
      // for full rationale + post-pilot TODO on retailer breakdown).
      tariffDefinitionId: resolved.dsoTariffDefinitionId,
      // ENRICH-1 — OCPP is the first writer; CDR / AMQP confirm later.
      verifiedSource: "ocpp",
      enrichmentStatus: "pending",
    },
    update: { stoppedAt },
  });

  console.log("[ledger] session_cost_recorded", {
    sessionId: updated.id,
    orgId: updated.orgId,
    siteId: updated.siteId,
    energyKwh,
    durationSec,
    totalIncVatMinor: String(breakdown.totalIncVatMinor),
    source: "ocpp.raw.StopTransaction",
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
  // ADR 0036 Autocharge Step C — projection on the raw MeterValues
  // frame to capture OCMF signedMeterData when the firmware embeds
  // it. Closes the OCPP-side OCMF capture gap (AMQP 723 was the only
  // path before this).
  registerProjection("ocpp.raw.MeterValues", onOcppRawMeterValues);
  // 2026-05-11 projection-gap fix — the four raw-frame handlers that
  // the legacy domain-event handlers above (charger.booted, charger.
  // status_updated, connector.status_updated, session.started,
  // session.stopped) never received because no translator emits the
  // domain events. Direct raw-handler pattern matches the precedent
  // set by onOcppRawMeterValues.
  registerProjection("ocpp.raw.BootNotification", onOcppRawBootNotification);
  registerProjection(
    "ocpp.raw.StatusNotification",
    onOcppRawStatusNotification,
  );
  registerProjection(
    "ocpp.raw.StartTransaction",
    onOcppRawStartTransaction,
  );
  registerProjection("ocpp.raw.StopTransaction", onOcppRawStopTransaction);
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
