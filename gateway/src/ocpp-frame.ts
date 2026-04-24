/**
 * OCPP 1.6J wire framing.
 *
 * Every OCPP 1.6J WebSocket frame is a JSON array of one of three shapes:
 *
 *   [2, "<unique-id>", "<Action>", <Payload>]         // Call    (request)
 *   [3, "<unique-id>", <Payload>]                      // CallResult
 *   [4, "<unique-id>", "<errorCode>", "<desc>", {}]    // CallError
 *
 * The gateway receives Call frames from the charger, translates the
 * action + payload to a domain event (via the main-app translator),
 * POSTs to main app ingest, and replies with a CallResult per OCPP
 * semantics.
 *
 * Outbound commands flow the other way: main app → gateway dispatch
 * endpoint → DO → Call frame on the socket → charger replies with
 * CallResult → gateway resolves the promise → main app sees ack.
 */

export const enum MessageTypeId {
  Call = 2,
  CallResult = 3,
  CallError = 4,
}

export interface OcppCall {
  kind: "call";
  uniqueId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface OcppCallResult {
  kind: "call_result";
  uniqueId: string;
  payload: Record<string, unknown>;
}

export interface OcppCallError {
  kind: "call_error";
  uniqueId: string;
  errorCode: string;
  errorDescription: string;
  errorDetails: Record<string, unknown>;
}

export type OcppFrame = OcppCall | OcppCallResult | OcppCallError;

export type ParseResult =
  | { ok: true; frame: OcppFrame }
  | { ok: false; error: string };

/**
 * Parse a raw WebSocket text frame as an OCPP 1.6J message. Returns a
 * structured discriminated union on success, terse error string on
 * failure. Errors are safe to log but NOT safe to echo on the wire —
 * OCPP has its own error codes.
 */
export function parseFrame(raw: string): ParseResult {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return { ok: false, error: "frame is not valid JSON" };
  }
  if (!Array.isArray(arr) || arr.length < 3) {
    return { ok: false, error: "frame is not an array with ≥3 elements" };
  }
  const typeId = arr[0];
  const uniqueId = arr[1];
  if (typeof typeId !== "number") return { ok: false, error: "typeId not number" };
  if (typeof uniqueId !== "string" || uniqueId.length === 0)
    return { ok: false, error: "uniqueId not non-empty string" };

  switch (typeId) {
    case MessageTypeId.Call: {
      if (arr.length !== 4) return { ok: false, error: "Call frame must have 4 elements" };
      const action = arr[2];
      const payload = arr[3];
      if (typeof action !== "string" || action.length === 0)
        return { ok: false, error: "Call action not non-empty string" };
      if (!isJsonObject(payload))
        return { ok: false, error: "Call payload not object" };
      return { ok: true, frame: { kind: "call", uniqueId, action, payload } };
    }
    case MessageTypeId.CallResult: {
      if (arr.length !== 3) return { ok: false, error: "CallResult frame must have 3 elements" };
      const payload = arr[2];
      if (!isJsonObject(payload))
        return { ok: false, error: "CallResult payload not object" };
      return { ok: true, frame: { kind: "call_result", uniqueId, payload } };
    }
    case MessageTypeId.CallError: {
      if (arr.length !== 5) return { ok: false, error: "CallError frame must have 5 elements" };
      const errorCode = arr[2];
      const errorDescription = arr[3];
      const errorDetails = arr[4];
      if (typeof errorCode !== "string")
        return { ok: false, error: "CallError errorCode not string" };
      if (typeof errorDescription !== "string")
        return { ok: false, error: "CallError errorDescription not string" };
      if (!isJsonObject(errorDetails))
        return { ok: false, error: "CallError errorDetails not object" };
      return {
        ok: true,
        frame: { kind: "call_error", uniqueId, errorCode, errorDescription, errorDetails },
      };
    }
    default:
      return { ok: false, error: `unknown messageTypeId: ${typeId}` };
  }
}

/** Serialize a CallResult for sending back to the charger. */
export function serializeCallResult(
  uniqueId: string,
  payload: Record<string, unknown>,
): string {
  return JSON.stringify([MessageTypeId.CallResult, uniqueId, payload]);
}

/** Serialize a Call (main-app-initiated, e.g. RemoteStartTransaction). */
export function serializeCall(
  uniqueId: string,
  action: string,
  payload: Record<string, unknown>,
): string {
  return JSON.stringify([MessageTypeId.Call, uniqueId, action, payload]);
}

/** Serialize a CallError reply. */
export function serializeCallError(
  uniqueId: string,
  errorCode: string,
  errorDescription: string,
  errorDetails: Record<string, unknown> = {},
): string {
  return JSON.stringify([
    MessageTypeId.CallError,
    uniqueId,
    errorCode,
    errorDescription,
    errorDetails,
  ]);
}

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
