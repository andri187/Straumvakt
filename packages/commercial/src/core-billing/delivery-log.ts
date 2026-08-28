// Billing document delivery — the attempt ledger.
//
// WHY THIS EXISTS
//
// Straumvakt sends email from 11 call sites and records the outcome at
// none of them. lib/email.ts returns the provider id on success and a
// reason on failure, and every caller drops it; routes/admin/org-invites.ts
// is the closest to a record and it only echoes the id in an HTTP response
// body that nobody stores. Worse, two call sites in driver-access-requests
// do not even assign the result — they hang a `.catch()` off a function
// that never throws, so `{ ok: false, reason: "send_failed" }` is discarded
// by construction.
//
// That is survivable for an invite. It is not survivable for a billing
// statement, where "did the customer receive the July statement?" has to
// have an answer that is not "probably". The asymmetry is the point of
// this module: email.ts FAILS OPEN when RESEND_API_KEY is missing, logging
// a warning and returning ok:false. For an invite, fail-open is right — a
// missing invite gets resent. For a statement it is exactly wrong, because
// a period that closed and "delivered" with no provider configured looks
// identical to one that reached the customer.
//
// This module is pure: it decides what an attempt MEANS and what happens
// next. It performs no I/O and holds no schedule. The persistence shape it
// is designed for is the one already proven in lib/dispatcher.ts — atomic
// single-statement claim, three-way outcome, terminal writer storing the
// provider response — because that is a working delivery ledger in this
// codebase and a second design would be a second thing to get wrong.

/** Where a statement went. `download` is operator-pull, not a send. */
export type DeliveryChannel = "email" | "download" | "webhook";

/**
 * Attempt-level outcome. Mirrors DispatchResult in lib/dispatch-targets.ts
 * (ack / retriable / permanent) with one addition: `not_configured`, which
 * that module never needed because a charger target is either registered
 * or absent, whereas an email binding can be silently missing at runtime.
 */
export type SendOutcomeKind = "ack" | "retriable" | "permanent" | "not_configured";

export type SendOutcome =
  | { kind: "ack"; providerId: string }
  | { kind: "retriable"; error: string; status?: number }
  | { kind: "permanent"; error: string; status?: number }
  | { kind: "not_configured"; error: string };

/**
 * The shape lib/email.ts actually returns. Reproduced structurally rather
 * than imported: this package is pure and must not depend on apps/api.
 */
export interface EmailSendResult {
  ok: boolean;
  id?: string;
  reason?: "binding_missing" | "send_failed";
  status?: number;
  error?: string;
}

export type DeliveryState =
  /** Recorded as owed, not yet attempted. */
  | "pending"
  /** Attempt in flight; claimed, outcome unknown. */
  | "sending"
  /** Provider accepted it and returned an id. */
  | "sent"
  /** Attempt failed and another is due. */
  | "retrying"
  /** Out of attempts, or a permanent rejection. Needs a human. */
  | "failed"
  /** A human stopped trying. Terminal and deliberate. */
  | "abandoned";

export const DELIVERY_TERMINAL_STATES: readonly DeliveryState[] = [
  "sent",
  "failed",
  "abandoned",
];

/** Default ceiling. Five attempts over ~2h of backoff before a human. */
export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Exponential backoff with a floor and a ceiling, in ms. Attempt 1 has
 * already happened when this is asked, so `attempt` is 1-based.
 * 1→1m, 2→5m, 3→25m, 4→2h5m, then held at 2h.
 */
export const DELIVERY_BACKOFF_BASE_MS = 60_000;
export const DELIVERY_BACKOFF_MAX_MS = 7_200_000;

export function nextAttemptDelayMs(
  attempt: number,
  baseMs = DELIVERY_BACKOFF_BASE_MS,
  maxMs = DELIVERY_BACKOFF_MAX_MS,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`attempt_must_be_positive_integer: ${attempt}`);
  }
  const raw = baseMs * Math.pow(5, attempt - 1);
  return Math.min(raw, maxMs);
}

/**
 * Read an email-send result as a delivery outcome.
 *
 * The mapping that matters: `binding_missing` is NOT a send failure. It
 * means no attempt ever left the building. Calling it `permanent` would
 * be defensible for an invite and dangerous for a statement, so it gets
 * its own kind and `isDeliverable` refuses to let it look like either
 * success or an ordinary retry.
 */
export function classifyEmailResult(result: EmailSendResult): SendOutcome {
  if (result.ok) {
    if (!result.id) {
      return { kind: "permanent", error: "provider_ack_without_id" };
    }
    return { kind: "ack", providerId: result.id };
  }

  // An acknowledged-but-unidentifiable send, arriving the way lib/email.ts
  // actually reports it.
  //
  // This branch is the fix for a real defect in the original module. The
  // check above assumed email.ts would surface such a send as ok:false with
  // no id. It does not: email.ts:91-99 returns
  // { ok:false, reason:"send_failed", status:<2xx>, error:"missing_response_id" }.
  // That fell past the 429 test and the 4xx test and landed on `retriable`,
  // so a send the provider ACCEPTED but could not identify was retried five
  // times — mailing the customer five copies of their statement, which is
  // precisely what the comment above says must never happen.
  //
  // A 2xx is an acknowledgement. Retrying it is the one thing we must not do.
  if (result.status !== undefined && result.status >= 200 && result.status < 300) {
    return { kind: "permanent", error: result.error ?? "provider_ack_without_id" };
  }

  if (result.reason === "binding_missing") {
    return { kind: "not_configured", error: "RESEND_API_KEY missing" };
  }

  const status = result.status;
  const error = result.error ?? "send_failed";

  // 0 is email.ts's marker for a network throw — always worth retrying.
  if (status === undefined || status === 0) return { kind: "retriable", error, status };
  // 4xx is the provider rejecting the message itself: bad address, blocked
  // recipient, malformed payload. Retrying sends the same thing again.
  // 429 is the exception — that is backpressure, not rejection.
  if (status === 429) return { kind: "retriable", error, status };
  if (status >= 400 && status < 500) return { kind: "permanent", error, status };
  return { kind: "retriable", error, status };
}

export interface DeliveryAttemptInput {
  state: DeliveryState;
  /** Attempts already made, including the one being reported. */
  attempts: number;
  outcome: SendOutcome;
  maxAttempts?: number;
}

export interface DeliveryDecision {
  nextState: DeliveryState;
  /** null when no further attempt is due. */
  retryInMs: number | null;
  /** True when a person has to look at this. */
  requiresOperatorAction: boolean;
  reason: string;
}

/**
 * What happens after an attempt. Total over the outcome kinds.
 */
export function applyDeliveryAttempt(input: DeliveryAttemptInput): DeliveryDecision {
  const { state, attempts, outcome } = input;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_DELIVERY_ATTEMPTS;

  if (DELIVERY_TERMINAL_STATES.includes(state)) {
    throw new Error(`delivery_already_terminal: ${state}`);
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`attempts_must_be_positive_integer: ${attempts}`);
  }

  if (outcome.kind === "ack") {
    return {
      nextState: "sent",
      retryInMs: null,
      requiresOperatorAction: false,
      reason: `accepted by provider as ${outcome.providerId}`,
    };
  }

  if (outcome.kind === "not_configured") {
    // Never retried on a timer. A missing binding is an operator fact, and
    // burning the attempt budget against it would turn a fixable
    // misconfiguration into an abandoned statement.
    return {
      nextState: "failed",
      retryInMs: null,
      requiresOperatorAction: true,
      reason: "no delivery provider configured — nothing was sent",
    };
  }

  if (outcome.kind === "permanent") {
    return {
      nextState: "failed",
      retryInMs: null,
      requiresOperatorAction: true,
      reason: `provider rejected the message: ${outcome.error}`,
    };
  }

  if (attempts >= maxAttempts) {
    return {
      nextState: "failed",
      retryInMs: null,
      requiresOperatorAction: true,
      reason: `gave up after ${attempts} attempts: ${outcome.error}`,
    };
  }

  return {
    nextState: "retrying",
    retryInMs: nextAttemptDelayMs(attempts),
    requiresOperatorAction: false,
    reason: `attempt ${attempts} of ${maxAttempts} failed: ${outcome.error}`,
  };
}

/**
 * Did this reach the customer? Only a provider acknowledgement counts.
 *
 * "sent" is deliberately the strongest claim this module makes. Resend
 * accepting a message is not proof of inbox arrival, and without webhook
 * ingestion there is no honest way to assert delivery. Anything stronger
 * would be a claim the system cannot support.
 */
export function isDelivered(state: DeliveryState): boolean {
  return state === "sent";
}

export function isTerminal(state: DeliveryState): boolean {
  return DELIVERY_TERMINAL_STATES.includes(state);
}

export function requiresOperatorAction(state: DeliveryState): boolean {
  return state === "failed";
}

/**
 * The close-side question: may a period be reported as delivered?
 *
 * A period is only fully delivered when every statement in it reached the
 * provider. This returns the outstanding ones rather than a boolean, so
 * the operator sees WHICH customer did not get their statement.
 */
export interface StatementDeliveryRow {
  statementId: string;
  recipient: string;
  state: DeliveryState;
}

export interface PeriodDeliveryReport {
  total: number;
  delivered: number;
  outstanding: StatementDeliveryRow[];
  needingOperatorAction: StatementDeliveryRow[];
  fullyDelivered: boolean;
}

export function reportPeriodDelivery(
  rows: readonly StatementDeliveryRow[],
): PeriodDeliveryReport {
  const outstanding = rows.filter((r) => !isDelivered(r.state));
  return {
    total: rows.length,
    delivered: rows.length - outstanding.length,
    outstanding,
    needingOperatorAction: rows.filter((r) => requiresOperatorAction(r.state)),
    fullyDelivered: outstanding.length === 0,
  };
}

/**
 * Whether this document may be sent at all.
 *
 * A statement is delivered FROM a closed period. Sending one from an open
 * period puts a figure in a customer's hands that the system may still
 * change underneath them — the same failure that makes regenerating a
 * closed statement wrong, pointed the other way.
 */
export function canDeliverStatement(periodState: "open" | "closing" | "closed"): {
  allowed: boolean;
  reason: string;
} {
  if (periodState === "closed") {
    return { allowed: true, reason: "period is closed; the figure is final" };
  }
  return {
    allowed: false,
    reason:
      periodState === "closing"
        ? "period close is still in flight"
        : "period is open — the total can still change after the customer reads it",
  };
}
