// The delivery-log CONTRACT.
//
// ── OWNERSHIP / HANDOVER ────────────────────────────────────────────────
//
// Claude A owns the implementation at
//   packages/commercial/src/core-billing/delivery-log.ts
// (worktree E:\Claude\Straumvakt-core-billing, branch
// scratch/claude-a-core-billing-2026-08-10).
//
// THIS FILE IS THE CONTRACT THAT IMPLEMENTATION MUST SATISFY, and the
// fixtures in fixtures.ts are the cases it must pass. Nothing here imports
// anything from packages/commercial — the contract must be checkable without
// the implementation existing.
//
// HANDOVER TARGET: `packages/commercial/src/core-billing/delivery-log.ts`.
// The transition table below is the authority; if the implementation and this
// file disagree, this file is wrong or the implementation is — but they must
// not silently differ, so the shared fixtures exist to make a difference fail
// a test rather than reach a customer.
//
// ── WHY FAIL-CLOSED, IN ONE PARAGRAPH ───────────────────────────────────
//
// SERVICES.md:33-37 records that email currently FAILS OPEN: a missing
// RESEND_API_KEY logs and continues rather than blocking. That is right for a
// host-application notice and wrong for an invoice, because "a silently unsent
// invoice is indistinguishable from a sent one." The fix is not more retries.
// It is admitting a third outcome.
//
// ── THE THIRD OUTCOME ───────────────────────────────────────────────────
//
// Most delivery code models two states, sent and failed, and quietly files
// everything ambiguous under one of them. There are three:
//
//   delivered — the channel positively confirmed acceptance.
//   failed    — the channel positively confirmed rejection.
//   unknown   — the attempt produced neither. A timeout. A dropped
//               connection after the request was written. A 5xx from a
//               provider that may or may not have queued the message.
//
// `unknown` is the state that matters, because it is the one that is
// dangerous in BOTH directions: treat it as delivered and the host never gets
// an invoice nobody knows is missing; auto-retry it and the host gets the same
// invoice twice, which for a claim is not a cosmetic problem.
//
// Therefore: UNKNOWN NEVER AUTO-TRANSITIONS. Not to delivered, not to a
// retry. It waits for a human or for out-of-band evidence.

export const DELIVERY_STATES = [
  /** Queued. No attempt yet. */
  "pending",
  /** An attempt is in flight. */
  "attempting",
  /** Positive confirmation from the channel. TERMINAL, good. */
  "delivered",
  /** Attempt completed with no usable answer. Requires a human. NOT terminal, NOT retryable. */
  "unknown",
  /** Negative confirmation, and the cause may clear on its own. Retryable. */
  "failed_retryable",
  /** Negative confirmation that will not clear by retrying. TERMINAL, bad. */
  "failed_permanent",
  /** Retry budget exhausted. TERMINAL, bad. Requires a human. */
  "abandoned",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const TERMINAL_STATES: readonly DeliveryState[] = [
  "delivered",
  "failed_permanent",
  "abandoned",
] as const;

/**
 * The states that mean "an operator must look at this".
 *
 * `unknown` is included and `failed_retryable` is not: the retryable one is
 * the machine's problem until the budget runs out.
 */
export const OPERATOR_ATTENTION_STATES: readonly DeliveryState[] = [
  "unknown",
  "failed_permanent",
  "abandoned",
] as const;

/**
 * Allowed transitions. Anything not listed is a bug, not an edge case.
 *
 * Read the `unknown` row carefully — it is the whole point of the file:
 * `unknown` can only be resolved by an explicitly operator-driven transition,
 * and there is no arrow from `unknown` to `attempting`.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<DeliveryState, readonly DeliveryState[]>> = {
  pending: ["attempting"],
  attempting: ["delivered", "unknown", "failed_retryable", "failed_permanent"],
  // Retry goes back through pending so the backoff schedule is visible in the
  // log rather than hidden inside a loop.
  failed_retryable: ["pending", "abandoned", "failed_permanent"],
  // Operator-only exits. `delivered` here means someone has out-of-band proof
  // (a reply, a bank confirmation, the host saying "I have it").
  unknown: ["delivered", "failed_permanent", "abandoned"],
  delivered: [],
  failed_permanent: [],
  abandoned: [],
} as const;

/**
 * Transitions that a machine may take on its own.
 *
 * Everything reachable from `unknown` is excluded. This is the fail-closed
 * guarantee expressed as data, so a test can assert it rather than trusting a
 * comment.
 */
export const AUTOMATIC_TRANSITIONS: Readonly<Record<DeliveryState, readonly DeliveryState[]>> = {
  pending: ["attempting"],
  attempting: ["delivered", "unknown", "failed_retryable", "failed_permanent"],
  failed_retryable: ["pending", "abandoned"],
  unknown: [],
  delivered: [],
  failed_permanent: [],
  abandoned: [],
} as const;

export function isTerminal(s: DeliveryState): boolean {
  return TERMINAL_STATES.includes(s);
}

/**
 * The fail-closed predicate.
 *
 * The ONLY state that counts as delivered. Deliberately not
 * `!isFailed(state)`: writing it as a negation is how "unknown" ends up
 * counting as success.
 */
export function isDelivered(s: DeliveryState): boolean {
  return s === "delivered";
}

export function requiresOperator(s: DeliveryState): boolean {
  return OPERATOR_ATTENTION_STATES.includes(s);
}

export function canTransition(from: DeliveryState, to: DeliveryState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function canTransitionAutomatically(from: DeliveryState, to: DeliveryState): boolean {
  return (AUTOMATIC_TRANSITIONS[from] ?? []).includes(to);
}

// ── retry policy ────────────────────────────────────────────────────────

export interface RetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number;
  /** First backoff, seconds. */
  baseDelaySeconds: number;
  /** Multiplier per attempt. */
  factor: number;
  /** Ceiling, seconds. */
  maxDelaySeconds: number;
}

/**
 * The default policy.
 *
 * Deliberately slow and short. An invoice is not a page load: five attempts
 * over roughly two hours is ample for a transient provider fault, and beyond
 * that the correct action is to tell a human, not to keep trying for a day.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelaySeconds: 60,
  factor: 3,
  maxDelaySeconds: 3600,
};

/** Deterministic — no jitter. A reproducible schedule is testable; jitter is not. */
export function backoffSeconds(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  if (attempt < 1) return 0;
  const raw = policy.baseDelaySeconds * Math.pow(policy.factor, attempt - 1);
  return Math.min(raw, policy.maxDelaySeconds);
}

export interface DeliveryAttempt {
  attempt: number;
  state: DeliveryState;
  /** ISO 8601. */
  at: string;
  /** Channel-specific, non-sensitive. Never a payload, never a key. */
  detail?: string;
}

export interface DeliveryLogEntry {
  /** Tenant scope. FOCUS.md rule 5. */
  orgId: string;
  /** The document being delivered. */
  documentNumber: string;
  /** Which channel. One entry per channel — a document may have several. */
  channel: DeliveryChannel;
  state: DeliveryState;
  attempts: readonly DeliveryAttempt[];
  /** Set once, on the transition into `delivered`. Never overwritten. */
  deliveredAt: string | null;
}

export const DELIVERY_CHANNELS = ["email_pdf", "peppol", "bank_claim", "manual"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/**
 * Whether another automatic attempt is allowed.
 *
 * Returns false for `unknown` regardless of the attempt count — that is the
 * duplicate-delivery guard, and it is why this is not just
 * `attempts < maxAttempts`.
 */
export function mayAttemptAgain(
  entry: Pick<DeliveryLogEntry, "state" | "attempts">,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): boolean {
  if (entry.state === "unknown") return false;
  if (isTerminal(entry.state)) return false;
  if (entry.state !== "failed_retryable" && entry.state !== "pending") return false;
  return entry.attempts.length < policy.maxAttempts;
}

/**
 * Roll-up across channels for one document.
 *
 * A document is delivered only if at least one channel positively confirmed
 * it. With no channels at all the answer is "unknown", never "delivered" —
 * an invoice nobody tried to send is not a sent invoice.
 */
export function documentDeliveryState(
  entries: readonly DeliveryLogEntry[],
): DeliveryState {
  if (entries.length === 0) return "unknown";
  if (entries.some((e) => isDelivered(e.state))) return "delivered";
  if (entries.some((e) => e.state === "unknown")) return "unknown";
  if (entries.every((e) => isTerminal(e.state))) {
    return entries.some((e) => e.state === "abandoned") ? "abandoned" : "failed_permanent";
  }
  const inFlight = entries.find((e) => !isTerminal(e.state));
  return inFlight ? inFlight.state : "unknown";
}
