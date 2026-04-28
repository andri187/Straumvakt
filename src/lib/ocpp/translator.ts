/**
 * OCPP 1.6J → domain event translator.
 *
 * This module is the ONLY place OCPP vocabulary lives in the Straumvakt
 * codebase (V3 architecture §5, principle 4). Everything downstream
 * consumes domain events — `charger.booted`, `session.started`, etc. —
 * not raw OCPP message names.
 *
 * Translation is a pure function: given an OCPP action string, a parsed
 * payload, and a `TranslationContext` with pre-resolved UUIDs, return
 * an `IngestEvent` envelope ready for the main-app webhook. Retention
 * classes are assigned per the table in ADR 0004 / Architecture §8.
 *
 * UUID resolution (connector index → connector UUID, identity string →
 * identity UUID, transactionId → session UUID) is NOT this module's
 * job. The gateway's Durable Object (Sprint 1.4) owns that lookup and
 * passes the results in via `TranslationContext`.
 *
 * Unknown actions produce a catchall `ocpp.unknown_message` domain
 * event in `raw_protocol` retention. That way a real charger sending
 * something we don't model yet gets visible in the event log instead
 * of silently dropping.
 */
import { z } from "zod";
import type { RetentionClass } from "@/generated/prisma/client";
import type { IngestEvent } from "./event-envelope";

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas — OCPP 1.6J payload shapes
// ─────────────────────────────────────────────────────────────────────────────

const IsoString = z.string().refine((s) => Number.isFinite(Date.parse(s)), {
  message: "not a valid ISO-8601 timestamp",
});

const BootNotificationReq = z.object({
  chargePointVendor: z.string(),
  chargePointModel: z.string(),
  chargePointSerialNumber: z.string().optional(),
  chargeBoxSerialNumber: z.string().optional(),
  firmwareVersion: z.string().optional(),
  iccid: z.string().optional(),
  imsi: z.string().optional(),
  meterType: z.string().optional(),
  meterSerialNumber: z.string().optional(),
});

const HeartbeatReq = z.object({}).passthrough();

const StatusNotificationReq = z.object({
  connectorId: z.number().int().nonnegative(),
  errorCode: z.string(),
  status: z.string(),
  info: z.string().optional(),
  timestamp: IsoString.optional(),
  vendorId: z.string().optional(),
  vendorErrorCode: z.string().optional(),
});

const AuthorizeReq = z.object({
  idTag: z.string().max(20),
});

const StartTransactionReq = z.object({
  connectorId: z.number().int().positive(),
  idTag: z.string().max(20),
  meterStart: z.number().int().nonnegative(),
  timestamp: IsoString,
  reservationId: z.number().int().optional(),
});

const SampledValue = z.object({
  value: z.string(),
  context: z.string().optional(),
  format: z.string().optional(),
  measurand: z.string().optional(),
  phase: z.string().optional(),
  location: z.string().optional(),
  unit: z.string().optional(),
});

const MeterValue = z.object({
  timestamp: IsoString,
  sampledValue: z.array(SampledValue),
});

const MeterValuesReq = z.object({
  connectorId: z.number().int().nonnegative(),
  transactionId: z.number().int().optional(),
  meterValue: z.array(MeterValue),
});

const StopTransactionReq = z.object({
  idTag: z.string().max(20).optional(),
  meterStop: z.number().int().nonnegative(),
  timestamp: IsoString,
  transactionId: z.number().int(),
  reason: z.string().optional(),
  // transactionData (nested meter values) intentionally omitted — we
  // rely on prior MeterValues for the session's running readings.
});

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export const OCPP_ACTIONS = [
  "BootNotification",
  "Heartbeat",
  "StatusNotification",
  "Authorize",
  "StartTransaction",
  "MeterValues",
  "StopTransaction",
] as const;

export type OcppAction = (typeof OCPP_ACTIONS)[number];

export interface TranslationContext {
  /** Tenant. */
  orgId: string;
  /** Stable, deterministic id for idempotency — the gateway DO mints this once per incoming OCPP message and re-uses on retry. */
  eventId: string;
  /** Trace id that follows this OCPP message across services. */
  correlationId: string;
  /** The OCPP identity UUID (resolved from the WebSocket auth context). */
  ocppIdentityId: string;
  /** Pre-resolved connector UUID — required for StatusNotification (>0), StartTransaction, MeterValues, StopTransaction. */
  connectorId?: string;
  /** Pre-resolved session UUID — required for StartTransaction (new, minted by DO), MeterValues, StopTransaction. */
  chargeSessionId?: string;
}

export type TranslationResult =
  | { ok: true; event: IngestEvent }
  | { ok: false; error: string };

/**
 * Translate an OCPP 1.6J action + payload into a domain event envelope.
 * Pure function — no side effects, no I/O.
 */
export function translate(
  action: string,
  rawPayload: unknown,
  ctx: TranslationContext,
): TranslationResult {
  switch (action) {
    case "BootNotification":
      return translateBoot(rawPayload, ctx);
    case "Heartbeat":
      return translateHeartbeat(rawPayload, ctx);
    case "StatusNotification":
      return translateStatus(rawPayload, ctx);
    case "Authorize":
      return translateAuthorize(rawPayload, ctx);
    case "StartTransaction":
      return translateStart(rawPayload, ctx);
    case "MeterValues":
      return translateMeterValues(rawPayload, ctx);
    case "StopTransaction":
      return translateStop(rawPayload, ctx);
    default:
      return translateUnknown(action, rawPayload, ctx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-action translators
// ─────────────────────────────────────────────────────────────────────────────

function translateBoot(raw: unknown, ctx: TranslationContext): TranslationResult {
  const parsed = BootNotificationReq.safeParse(raw);
  if (!parsed.success) return zodFail("BootNotification", parsed.error);
  return makeEvent(ctx, {
    eventType: "charger.booted",
    aggregateType: "ocpp_identity",
    aggregateId: ctx.ocppIdentityId,
    retentionClass: "operational",
    payload: parsed.data,
    occurredAt: new Date().toISOString(),
  });
}

function translateHeartbeat(raw: unknown, ctx: TranslationContext): TranslationResult {
  const parsed = HeartbeatReq.safeParse(raw);
  if (!parsed.success) return zodFail("Heartbeat", parsed.error);
  return makeEvent(ctx, {
    eventType: "charger.heartbeat",
    aggregateType: "ocpp_identity",
    aggregateId: ctx.ocppIdentityId,
    retentionClass: "raw_protocol",
    payload: {},
    occurredAt: new Date().toISOString(),
  });
}

function translateStatus(raw: unknown, ctx: TranslationContext): TranslationResult {
  const parsed = StatusNotificationReq.safeParse(raw);
  if (!parsed.success) return zodFail("StatusNotification", parsed.error);
  const d = parsed.data;
  // connectorId=0 refers to the charger itself per OCPP 1.6; >0 is a specific connector.
  const chargerLevel = d.connectorId === 0;
  if (!chargerLevel && !ctx.connectorId) {
    return { ok: false, error: "StatusNotification for connector>0 requires ctx.connectorId" };
  }
  return makeEvent(ctx, {
    eventType: chargerLevel ? "charger.status_updated" : "connector.status_updated",
    aggregateType: chargerLevel ? "ocpp_identity" : "connector",
    aggregateId: chargerLevel ? ctx.ocppIdentityId : ctx.connectorId!,
    retentionClass: "operational",
    payload: {
      status: d.status,
      errorCode: d.errorCode,
      info: d.info,
      vendorId: d.vendorId,
      vendorErrorCode: d.vendorErrorCode,
    },
    occurredAt: d.timestamp ?? new Date().toISOString(),
  });
}

function translateAuthorize(raw: unknown, ctx: TranslationContext): TranslationResult {
  const parsed = AuthorizeReq.safeParse(raw);
  if (!parsed.success) return zodFail("Authorize", parsed.error);
  return makeEvent(ctx, {
    eventType: "card.authorize_requested",
    aggregateType: "ocpp_identity",
    aggregateId: ctx.ocppIdentityId,
    retentionClass: "operational",
    payload: { idTag: parsed.data.idTag },
    occurredAt: new Date().toISOString(),
  });
}

function translateStart(raw: unknown, ctx: TranslationContext): TranslationResult {
  const parsed = StartTransactionReq.safeParse(raw);
  if (!parsed.success) return zodFail("StartTransaction", parsed.error);
  if (!ctx.connectorId) return { ok: false, error: "StartTransaction requires ctx.connectorId" };
  if (!ctx.chargeSessionId) return { ok: false, error: "StartTransaction requires ctx.chargeSessionId" };
  const d = parsed.data;
  return makeEvent(ctx, {
    eventType: "session.started",
    aggregateType: "charge_session",
    aggregateId: ctx.chargeSessionId,
    retentionClass: "financial",
    payload: {
      connectorId: ctx.connectorId,
      idTag: d.idTag,
      meterStartWh: d.meterStart,
      reservationId: d.reservationId,
    },
    occurredAt: d.timestamp,
  });
}

function translateMeterValues(raw: unknown, ctx: TranslationContext): TranslationResult {
  const parsed = MeterValuesReq.safeParse(raw);
  if (!parsed.success) return zodFail("MeterValues", parsed.error);
  if (!ctx.connectorId) return { ok: false, error: "MeterValues requires ctx.connectorId" };
  if (!ctx.chargeSessionId) return { ok: false, error: "MeterValues requires ctx.chargeSessionId" };
  return makeEvent(ctx, {
    eventType: "session.meter_value_recorded",
    aggregateType: "charge_session",
    aggregateId: ctx.chargeSessionId,
    retentionClass: "raw_protocol",
    payload: {
      connectorId: ctx.connectorId,
      meterValues: parsed.data.meterValue,
    },
    // Use the latest sampled timestamp as the event time (or now if empty).
    occurredAt:
      parsed.data.meterValue.at(-1)?.timestamp ?? new Date().toISOString(),
  });
}

function translateStop(raw: unknown, ctx: TranslationContext): TranslationResult {
  const parsed = StopTransactionReq.safeParse(raw);
  if (!parsed.success) return zodFail("StopTransaction", parsed.error);
  if (!ctx.chargeSessionId) return { ok: false, error: "StopTransaction requires ctx.chargeSessionId" };
  const d = parsed.data;
  return makeEvent(ctx, {
    eventType: "session.stopped",
    aggregateType: "charge_session",
    aggregateId: ctx.chargeSessionId,
    retentionClass: "financial",
    payload: {
      meterStopWh: d.meterStop,
      stopReason: d.reason,
      idTag: d.idTag,
    },
    occurredAt: d.timestamp,
  });
}

function translateUnknown(
  action: string,
  raw: unknown,
  ctx: TranslationContext,
): TranslationResult {
  return makeEvent(ctx, {
    eventType: "ocpp.unknown_message",
    aggregateType: "ocpp_identity",
    aggregateId: ctx.ocppIdentityId,
    retentionClass: "raw_protocol",
    payload: {
      action,
      raw: isJsonObject(raw) ? raw : { raw: String(raw) },
    },
    occurredAt: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeEvent(
  ctx: TranslationContext,
  parts: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    retentionClass: RetentionClass;
    payload: Record<string, unknown>;
    occurredAt: string;
  },
): TranslationResult {
  return {
    ok: true,
    event: {
      eventId: ctx.eventId,
      orgId: ctx.orgId,
      correlationId: ctx.correlationId,
      aggregateType: parts.aggregateType,
      aggregateId: parts.aggregateId,
      eventType: parts.eventType,
      retentionClass: parts.retentionClass,
      payload: parts.payload,
      occurredAt: parts.occurredAt,
    },
  };
}

function zodFail(action: string, err: z.ZodError): { ok: false; error: string } {
  const issue = err.issues[0];
  const path = issue?.path?.join(".") ?? "";
  return {
    ok: false,
    error: `${action}: ${issue?.message ?? "invalid"}${path ? ` at ${path}` : ""}`,
  };
}

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
