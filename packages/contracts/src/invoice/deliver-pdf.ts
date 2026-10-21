// Rendering a PDF and moving the delivery log, fail-closed.
//
// ── THE RULE THIS FILE ENFORCES ─────────────────────────────────────────
//
// SERVICES.md records that email currently FAILS OPEN — a missing API key
// logs and continues. Right for a notice, wrong for an invoice: "a silently
// unsent invoice is indistinguishable from a sent one."
//
// delivery.ts already models the three outcomes (delivered / unknown /
// failed) and forbids `unknown` from auto-retrying. This is the piece that
// connects a rendered document to those states without anyone having to
// remember the rule at the call site.
//
// ── ORDER MATTERS, AND IT IS NOT THE OBVIOUS ONE ────────────────────────
//
// Render BEFORE recording an attempt. A document that cannot render must not
// produce a delivery attempt at all — otherwise the log grows a "failed"
// entry for something that was never a delivery problem, and an operator
// chasing a delivery failure finds a header defect instead.
//
// ── WHAT A PROVIDER IS ALLOWED TO SAY ───────────────────────────────────
//
// Three answers, and only three: yes, no, and "I do not know". Providers that
// throw, time out, or return a 5xx are the third — and the third is the whole
// reason this module exists.

import type { DeliveryChannel, DeliveryLogEntry, DeliveryState } from "./delivery";
import { isDelivered, isTerminal } from "./delivery";
import type { InvoiceDocument } from "./document";
import { renderInvoicePdf } from "./pdf";

/** What a send attempt can report. Deliberately not a boolean. */
export type SendOutcome =
  | { kind: "confirmed"; providerRef?: string }
  | { kind: "rejected"; reason: string }
  | { kind: "unknown"; reason: string };

export interface PdfDeliveryPort {
  /**
   * Attempt delivery. Implementations MUST return `unknown` — not `rejected`
   * — for a timeout, a dropped connection, or any 5xx, because those are
   * cases where the provider may still deliver.
   */
  send(bytes: Uint8Array, entry: DeliveryLogEntry): Promise<SendOutcome>;
}

export interface DeliveryAttemptResult {
  entry: DeliveryLogEntry;
  /** True only when this call actually sent something. */
  attempted: boolean;
  /** Why nothing was attempted, when nothing was. */
  skipped:
    | null
    | "already-delivered"
    | "terminal"
    | "unknown-requires-operator"
    | "render-refused";
  /** Human-readable render refusal. Never a delivery failure. */
  renderError: string | null;
  /**
   * The stable refusal code, when the thrown error carries one.
   *
   * Both are kept: the message is what an operator reads, the code is what a
   * caller branches on. Collapsing them means one of those two audiences gets
   * a string it cannot use.
   */
  renderErrorCode: string | null;
}

function appended(
  entry: DeliveryLogEntry,
  state: DeliveryState,
  at: string,
  detail?: string,
): DeliveryLogEntry {
  return {
    ...entry,
    state,
    attempts: [
      ...entry.attempts,
      { attempt: entry.attempts.length + 1, state, at, ...(detail ? { detail } : {}) },
    ],
    // Set once, on the transition into delivered. Never overwritten.
    deliveredAt: state === "delivered" ? (entry.deliveredAt ?? at) : entry.deliveredAt,
  };
}

/**
 * Render the document and attempt delivery, moving the log honestly.
 *
 * `now` is passed in rather than read from a clock so the whole path is
 * testable and deterministic.
 */
export async function deliverInvoicePdf(
  doc: InvoiceDocument,
  entry: DeliveryLogEntry,
  port: PdfDeliveryPort,
  now: string,
): Promise<DeliveryAttemptResult> {
  // ── guard 1: never send twice.
  if (isDelivered(entry.state)) {
    return { entry, attempted: false, skipped: "already-delivered", renderError: null, renderErrorCode: null };
  }
  // ── guard 2: `unknown` is the duplicate-delivery guard. It never
  // auto-retries — a human or out-of-band evidence resolves it.
  if (entry.state === "unknown") {
    return { entry, attempted: false, skipped: "unknown-requires-operator", renderError: null, renderErrorCode: null };
  }
  if (isTerminal(entry.state)) {
    return { entry, attempted: false, skipped: "terminal", renderError: null, renderErrorCode: null };
  }

  // ── guard 3: render first. A document that cannot render is not a delivery
  // failure and must not be logged as one.
  let bytes: Uint8Array;
  try {
    bytes = renderInvoicePdf(doc);
  } catch (e) {
    return {
      entry,
      attempted: false,
      skipped: "render-refused",
      renderError: (e as Error).message,
      renderErrorCode: (e as { code?: string }).code ?? null,
    };
  }

  const attempting = appended(entry, "attempting", now);

  let outcome: SendOutcome;
  try {
    outcome = await port.send(bytes, attempting);
  } catch (e) {
    // A thrown provider is the ambiguous case, always. It is NOT a rejection:
    // the request may have been written before the connection died.
    outcome = { kind: "unknown", reason: (e as Error).message };
  }

  switch (outcome.kind) {
    case "confirmed":
      return {
        entry: appended(attempting, "delivered", now, outcome.providerRef),
        attempted: true,
        skipped: null,
        renderError: null,
        renderErrorCode: null,
      };
    case "rejected":
      return {
        entry: appended(attempting, "failed_permanent", now, outcome.reason),
        attempted: true,
        skipped: null,
        renderError: null,
        renderErrorCode: null,
      };
    case "unknown":
      return {
        entry: appended(attempting, "unknown", now, outcome.reason),
        attempted: true,
        skipped: null,
        renderError: null,
        renderErrorCode: null,
      };
  }
}

/** A fresh log entry for a document on a channel. */
export function newDeliveryEntry(
  orgId: string,
  documentNumber: string,
  channel: DeliveryChannel,
): DeliveryLogEntry {
  return { orgId, documentNumber, channel, state: "pending", attempts: [], deliveredAt: null };
}
