// The billing operations port — everything an operator's request needs.
//
// ── WHY A PORT, AGAIN ───────────────────────────────────────────────────
//
// A2c's `ActivitySourcePort` proved the pattern: a fixture-backed adapter lets
// the whole path be exercised offline. Had the feeder called Drizzle directly,
// the only way to see an invoice before migration 0002 was applied would have
// been to apply 0002.
//
// The same reasoning applies with more force to the API surface, because a
// route is the layer people usually give up on testing without a database.
// Every handler under `routes/admin/billing/` depends on this interface; the
// tests drive a fixture adapter; the Drizzle adapter is written and never
// executed. Neither 0002 nor 0003 has been applied to anything.
//
// ── THE IDEMPOTENCY RULE ────────────────────────────────────────────────
//
// Every mutating operation carries a caller-supplied idempotency key, checked
// against `billing.mutation_receipts` — which 0002 created with
// `(org_id, scope, idempotency_key)` unique.
//
// A MISSING KEY IS A REFUSAL, never a generated one. Round 1 established why:
// `?? crypto.randomUUID()` makes every retry a fresh operation, which is an
// idempotency mechanism that guarantees the thing it was added to prevent.
//
// And a *different* key for the same logical operation is also a refusal, not
// a second execution. Two keys for one month's invoice is not two invoices; it
// is one invoice and one caller bug, and the second call must be told so
// rather than quietly consuming another document number.

import type {
  BillingPeriodRef,
  FlatFeeResult,
  PeriodEvent,
  PeriodLifecycleState,
} from "@straumvakt/commercial";

/** Tenant confinement, required. `null` is platform-wide and must be written. */
export interface BillingAccess {
  restrictToOrgIds: string[] | null;
}

/** A recorded mutation. The receipt is the idempotency mechanism. */
export interface MutationReceipt {
  orgId: string;
  /** What kind of operation. Matches `billing.mutation_receipts.scope`. */
  scope: string;
  idempotencyKey: string;
  /** A stable digest of the request, so a key reused with different inputs is
   *  detectable rather than silently returning the first answer. */
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

export type ReceiptLookup =
  | { kind: "fresh" }
  /** Same key, same request. Replay the stored answer; do not re-execute. */
  | { kind: "replay"; receipt: MutationReceipt }
  /** Same key, DIFFERENT request. A caller bug; refuse loudly. */
  | { kind: "key_reused_with_different_request"; receipt: MutationReceipt };

export interface StatementSummary {
  orgId: string;
  period: BillingPeriodRef;
  totalIsk: string;
  currency: string;
  documentNumber: string | null;
  lineCount: number;
}

export interface IssuedDocument {
  documentNumber: string;
  /** The rendered header + body, from the same renderer the dry run uses. */
  rendered: string;
  /** Never `delivered` from here — issuing is not delivering. */
  deliveryState: "pending";
}

/**
 * Everything the billing routes may do.
 *
 * Deliberately one interface rather than six: a handler needs the period's
 * state to decide almost everything, and splitting that across ports would
 * make every route assemble its own view of the same month.
 */
export interface BillingOperationsPort {
  // ── receipts ──────────────────────────────────────────────────────────
  lookupReceipt(
    orgId: string,
    scope: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ReceiptLookup>;
  recordReceipt(receipt: MutationReceipt): Promise<void>;

  // ── period lifecycle ──────────────────────────────────────────────────
  periodState(period: BillingPeriodRef): Promise<PeriodLifecycleState>;
  applyPeriodEvent(input: {
    period: BillingPeriodRef;
    event: PeriodEvent;
    actorUserId: string;
    asOf: Date;
    reason?: string | null;
  }): Promise<
    | { kind: "applied"; from: PeriodLifecycleState; to: PeriodLifecycleState }
    | { kind: "noop"; state: PeriodLifecycleState }
    | { kind: "refused"; state: PeriodLifecycleState; reason: string }
  >;

  // ── activity ──────────────────────────────────────────────────────────
  recordActivity(period: BillingPeriodRef): Promise<{ connectorRows: number; driverRows: number }>;

  // ── assertions ────────────────────────────────────────────────────────
  assertConnector(input: {
    period: BillingPeriodRef;
    connectorId: string;
    actorUserId: string;
    reason: string;
    evidenceNote?: string | null;
    assertedAt: Date;
  }): Promise<{ kind: "recorded" } | { kind: "refused"; reason: string }>;

  // ── pricing and issuing ───────────────────────────────────────────────
  price(period: BillingPeriodRef): Promise<FlatFeeResult>;
  listStatements(orgId: string): Promise<StatementSummary[]>;
  issueDocument(input: {
    period: BillingPeriodRef;
    idempotencyKey: string;
    actorUserId: string;
  }): Promise<
    | { kind: "issued"; document: IssuedDocument }
    | { kind: "refused"; reason: string }
  >;
  fetchDocument(period: BillingPeriodRef): Promise<IssuedDocument | null>;
}

/** Why a billing request was refused. Every one is named; none is a bare 400. */
export type BillingRefusal =
  | "idempotency_key_required"
  | "idempotency_key_reused_with_different_request"
  | "org_not_in_scope"
  | "period_not_open"
  | "period_closed"
  | "period_not_priced"
  | "count_unavailable"
  | "not_found";

/**
 * Require an idempotency key, or refuse.
 *
 * There is deliberately no fallback. See the header: a generated key is an
 * idempotency mechanism that guarantees duplicate work.
 */
export function requireIdempotencyKeyHeader(value: string | undefined | null): string {
  const key = value?.trim();
  if (!key) throw new BillingRequestError("idempotency_key_required", 400);
  return key;
}

export class BillingRequestError extends Error {
  readonly refusal: BillingRefusal;
  readonly status: number;
  constructor(refusal: BillingRefusal, status: number, message?: string) {
    super(message ?? refusal);
    this.name = "BillingRequestError";
    this.refusal = refusal;
    this.status = status;
  }
}

/**
 * A stable digest of a request body, for receipt comparison.
 *
 * Deliberately not a cryptographic hash — its only job is that the same
 * request yields the same string, so a key reused with different inputs is
 * detectable. Keys are sorted so that field order cannot make one request look
 * like two.
 */
export function requestHashOf(body: unknown): string {
  const canonical = JSON.stringify(body, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
  let h = 2166136261;
  for (let i = 0; i < (canonical ?? "").length; i++) {
    h ^= (canonical ?? "").charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Tenant guard shared by every billing route. */
export function assertOrgInScope(orgId: string, access: BillingAccess): void {
  if (access.restrictToOrgIds === null) return;
  if (!access.restrictToOrgIds.includes(orgId)) {
    // 404, not 403: telling a caller "that org exists but is not yours"
    // confirms the existence of another tenant.
    throw new BillingRequestError("org_not_in_scope", 404);
  }
}
