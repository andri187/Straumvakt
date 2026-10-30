// OCPP 1.6J payload validation and wire responses for the exercised actions
// (Checkpoint B).
//
// Scope is exactly the actions the generic engine implements today:
//   BootNotification, Heartbeat, StatusNotification, Authorize,
//   StartTransaction, StopTransaction, MeterValues.
// Everything else is answered NotImplemented (see ACTION_MATRIX). This file
// makes NO claim of OCPP certification or whole-protocol conformance.
//
// EVIDENCE STATUS (be honest about it): the field lists, enumerations and
// length limits below follow the published OCPP 1.6 JSON schemas and the 1.6
// edition 2 specification as known to the author. They were NOT re-verified
// against the Open Charge Alliance documents in this session (no network
// retrieval of the specification was performed). Each constraint is
// intentionally a single, named line so a reviewer can check it against the
// OCA schema files one by one. Where a limit is a judgement rather than the
// schema, it is marked IMPLEMENTATION and never presented as protocol.

import { z } from "zod";

export type ExercisedAction =
  | "BootNotification"
  | "Heartbeat"
  | "StatusNotification"
  | "Authorize"
  | "StartTransaction"
  | "StopTransaction"
  | "MeterValues";

/** supported = validated and handled; deferred = known, answered NotImplemented until built. */
export const ACTION_MATRIX: Record<string, "supported" | "deferred"> = {
  BootNotification: "supported",
  Heartbeat: "supported",
  StatusNotification: "supported",
  Authorize: "supported",
  StartTransaction: "supported",
  StopTransaction: "supported",
  MeterValues: "supported",
  // Known 1.6 charge-point-initiated actions we do not yet handle. Not "unsupported
  // forever": each is a deliberate, listed gap.
  DataTransfer: "deferred",
  DiagnosticsStatusNotification: "deferred",
  FirmwareStatusNotification: "deferred",
};

/** OCPP 1.6 CALLERROR codes. NB: the 1.6 specification spells "Occurence" with one r. */
export type CallErrorCode =
  | "NotImplemented"
  | "NotSupported"
  | "InternalError"
  | "ProtocolError"
  | "SecurityError"
  | "FormationViolation"
  | "PropertyConstraintViolation"
  | "OccurenceConstraintViolation"
  | "TypeConstraintViolation"
  | "GenericError";

export type ProtocolRejection = { code: CallErrorCode; description: string };

const ci = (max: number) => z.string().min(1).max(max).regex(/^[\x20-\x7e]*$/, "printable ASCII only");
const int = z.number().int();
// date-time per RFC 3339; the charger's clock is evidence, never trusted for tenancy.
const dateTime = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)), "date-time");

const ERROR_CODES = [
  "ConnectorLockFailure", "EVCommunicationError", "GroundFailure", "HighTemperature", "InternalError", "LocalListConflict",
  "NoError", "OtherError", "OverCurrentFailure", "PowerMeterFailure", "PowerSwitchFailure", "ReaderFailure", "ResetFailure",
  "UnderVoltage", "OverVoltage", "WeakSignal",
] as const;
const CHARGE_POINT_STATUS = ["Available", "Preparing", "Charging", "SuspendedEVSE", "SuspendedEV", "Finishing", "Reserved", "Unavailable", "Faulted"] as const;
const STOP_REASONS = ["EmergencyStop", "EVDisconnected", "HardReset", "Local", "Other", "PowerLoss", "Reboot", "Remote", "SoftReset", "UnlockCommand", "DeAuthorized"] as const;

const sampledValue = z
  .object({
    value: z.string().min(1).max(64), // IMPLEMENTATION: schema has no cap; unbounded strings are not accepted
    context: z.enum(["Interruption.Begin", "Interruption.End", "Sample.Clock", "Sample.Periodic", "Transaction.Begin", "Transaction.End", "Trigger", "Other"]).optional(),
    format: z.enum(["Raw", "SignedData"]).optional(),
    measurand: z.string().max(64).optional(),
    phase: z.string().max(8).optional(),
    location: z.enum(["Cable", "EV", "Inlet", "Outlet", "Body"]).optional(),
    unit: z.string().max(16).optional(),
  })
  .strict();

const meterValue = z.object({ timestamp: dateTime, sampledValue: z.array(sampledValue).min(1).max(40) }).strict(); // IMPLEMENTATION: max 40 samples

export const SCHEMAS = {
  BootNotification: z
    .object({
      chargePointVendor: ci(20),
      chargePointModel: ci(20),
      chargePointSerialNumber: ci(25).optional(),
      chargeBoxSerialNumber: ci(25).optional(),
      firmwareVersion: ci(50).optional(),
      iccid: ci(20).optional(),
      imsi: ci(20).optional(),
      meterType: ci(25).optional(),
      meterSerialNumber: ci(25).optional(),
    })
    .strict(),
  Heartbeat: z.object({}).strict(),
  StatusNotification: z
    .object({
      connectorId: int.min(0),
      errorCode: z.enum(ERROR_CODES),
      info: ci(50).optional(),
      status: z.enum(CHARGE_POINT_STATUS),
      timestamp: dateTime.optional(),
      vendorId: ci(255).optional(),
      vendorErrorCode: ci(50).optional(),
    })
    .strict(),
  Authorize: z.object({ idTag: ci(20) }).strict(),
  StartTransaction: z
    .object({
      connectorId: int.min(1), // connector 0 is the charge point as a whole and cannot start a transaction
      idTag: ci(20),
      meterStart: int.min(0), // negative registers are not valid Wh; kept as evidence by refusing, not by guessing
      reservationId: int.optional(),
      timestamp: dateTime,
    })
    .strict(),
  StopTransaction: z
    .object({
      idTag: ci(20).optional(),
      meterStop: int.min(0),
      timestamp: dateTime,
      transactionId: int,
      reason: z.enum(STOP_REASONS).optional(),
      transactionData: z.array(meterValue).max(200).optional(), // IMPLEMENTATION: max 200 entries
    })
    .strict(),
  MeterValues: z
    .object({
      connectorId: int.min(0),
      transactionId: int.optional(),
      meterValue: z.array(meterValue).min(1).max(200), // IMPLEMENTATION: max 200 entries per frame
    })
    .strict(),
} as const satisfies Record<ExercisedAction, z.ZodType>;

export type Payload<A extends ExercisedAction> = z.infer<(typeof SCHEMAS)[A]>;

export function isExercised(action: string): action is ExercisedAction {
  return Object.prototype.hasOwnProperty.call(SCHEMAS, action);
}

/** Maps a zod failure to the closest 1.6 CALLERROR without inventing finer distinctions. */
function valueAt(root: unknown, path: PropertyKey[]): unknown {
  let cur = root;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[k];
  }
  return cur;
}

function classify(issues: z.ZodIssue[], payload: unknown): ProtocolRejection {
  const first = issues[0]!;
  const path = first.path.join(".") || "(root)";
  if (first.code === "unrecognized_keys") return { code: "FormationViolation", description: `unknown property at ${path}` };
  // Missing is judged from the payload itself, not from the validator's wording.
  if (first.code === "invalid_type" && first.path.length > 0 && valueAt(payload, first.path) === undefined) {
    return { code: "OccurenceConstraintViolation", description: `missing required ${path}` };
  }
  if (first.code === "invalid_type") return { code: "TypeConstraintViolation", description: `wrong type at ${path}` };
  return { code: "PropertyConstraintViolation", description: `invalid ${path}` };
}

export function validatePayload<A extends ExercisedAction>(action: A, payload: unknown): { ok: true; value: Payload<A> } | { ok: false; error: ProtocolRejection } {
  const r = (SCHEMAS[action] as z.ZodType).safeParse(payload);
  if (r.success) return { ok: true, value: r.data as Payload<A> };
  return { ok: false, error: classify(r.error.issues, payload) };
}

export function rejectionForUnknownAction(action: string): ProtocolRejection {
  return ACTION_MATRIX[action] === "deferred"
    ? { code: "NotImplemented", description: `${action} is recognised but not yet handled` }
    : { code: "NotImplemented", description: `${action} is not supported` };
}

// ── Responses ────────────────────────────────────────────────────────────
export type IdTagInfo = { status: "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx" };

export function bootResponse(now: Date, intervalSeconds: number, status: "Accepted" | "Pending" | "Rejected" = "Accepted") {
  return { status, currentTime: now.toISOString(), interval: intervalSeconds };
}

/** 1.6 transactionId is a 32-bit signed integer on the wire. */
export const MAX_TRANSACTION_ID = 2_147_483_647;
