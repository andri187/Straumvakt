/**
 * statement-zod.ts — request/response contracts for the Core billing
 * period, settlement and statement surface.
 *
 * Sits beside tariff-zod.ts, rate-reference-zod.ts and cost-factor-zod.ts and
 * follows the same shape: schemas here, domain arithmetic in
 * packages/commercial, persistence nowhere near either.
 *
 * ── Why contracts land before routes ────────────────────────────────────
 *
 * None of these routes can be implemented yet: session_settlements,
 * billing_periods, statements, statement_lines and statement_delivery_attempts
 * do not exist as tables. Writing the handlers now would mean inventing
 * persistence, and a route that pretends to store something is worse than no
 * route.
 *
 * What CAN land safely is the contract: the exact request and response shape,
 * compile-checked and unit-tested, so the schema work has a fixed target and
 * the UI has something to build against. Every rule encoded here is one the
 * handler will not have to rediscover.
 *
 * ── Rules encoded, not just described ───────────────────────────────────
 *
 *  - orgId is REQUIRED on every request DTO. A billing request that does not
 *    name its tenant cannot be validated into existence, which is the
 *    contract-level half of the unscoped-gate problem.
 *  - Money crosses the wire as a decimal string, never a JS number: these are
 *    BigInt aurar and JSON numbers lose them above 2^53 and lie below it.
 *  - A billed line is whole ISK; an audit figure is aurar. The two are
 *    different fields with different names so a caller cannot confuse them —
 *    which is exactly how driver-sessions.ts came to render aurar as krónur.
 *  - Every mutating request carries an idempotency key. Generating or sending
 *    a statement twice is a customer-visible failure, not an internal one.
 */
import { z } from "zod";
import { orgIdSchema, bigIntStringSchema, currencyCodeSchema } from "./zod-common";

// ─── Shared primitives ───────────────────────────────────────────────────────

/**
 * Billing period. Year plus month, never a free date range: Core bills whole
 * calendar months in UTC (Iceland has no DST, so a month is unambiguous).
 */
export const billingPeriodSchema = z.object({
  orgId: orgIdSchema,
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});
export type BillingPeriodDto = z.infer<typeof billingPeriodSchema>;

/**
 * Idempotency key. Required on every mutation in this file.
 *
 * A retried "close period" or "send statement" must be recognisably the same
 * request, or a network blip double-charges or double-sends.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8, { message: "Idempotency-Key must be at least 8 characters" })
  .max(200);

/**
 * A signed aurar amount as a decimal string.
 *
 * bigIntStringSchema from zod-common is non-negative by design — correct for a
 * price, wrong for a correction line, which must be able to be a credit.
 */
export const signedAurarStringSchema = z
  .string()
  .regex(/^-?\d+$/, { message: "Must be an integer string in aurar (1/100 ISK)" });

/** A billed line amount: whole krónur, signed. */
export const iskStringSchema = z
  .string()
  .regex(/^-?\d+$/, { message: "Must be a whole-króna integer string" });

export const periodStateSchema = z.enum(["open", "closing", "closed"]);

export const settlementStatusSchema = z.enum(["settled", "billing_review_required"]);

export const reviewReasonSchema = z.enum([
  "no_rate_at_session_start",
  "meter_unresolvable",
  "cdr_mismatch_beyond_tolerance",
  "negative_or_impossible_energy",
  "missing_session_times",
  "unsupported_compute_rule",
  "manual_hold",
]);

export const deliveryChannelSchema = z.enum(["email", "download", "webhook"]);

export const deliveryStateSchema = z.enum([
  "pending",
  "sending",
  "sent",
  "retrying",
  "failed",
  "abandoned",
]);

// ─── 1. Generate period settlement preview ───────────────────────────────────
//
// Read-only. Answers "what would this month bill, and what is in the way".
// Deliberately separate from commit: checkPeriodClose reports EVERY blocker at
// once, and an operator should see that list before committing to anything.

export const settlementPreviewRequestSchema = billingPeriodSchema;
export type SettlementPreviewRequest = z.infer<typeof settlementPreviewRequestSchema>;

export const closeBlockerSchema = z.enum([
  "sessions_awaiting_reconciliation",
  "sessions_held_for_review",
  "sessions_still_estimated",
  "period_not_yet_ended",
]);

export const settlementPreviewResponseSchema = z.object({
  period: billingPeriodSchema,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  state: periodStateSchema,
  canClose: z.boolean(),
  blockers: z.array(closeBlockerSchema),
  explanation: z.string(),
  counts: z.object({
    billable: z.number().int().nonnegative(),
    estimated: z.number().int().nonnegative(),
    awaitingReconciliation: z.number().int().nonnegative(),
    heldForReview: z.number().int().nonnegative(),
  }),
  /** Sessions a human must resolve, named so they can be acted on. */
  heldSessionIds: z.array(z.string().uuid()),
  activeConnectors: z.number().int().nonnegative(),
  activeDrivers: z.number().int().nonnegative(),
  subscriptionSubtotalMinor: signedAurarStringSchema,
  currency: currencyCodeSchema,
});
export type SettlementPreviewResponse = z.infer<typeof settlementPreviewResponseSchema>;

// ─── 2. Commit period settlement snapshot ────────────────────────────────────

export const commitSettlementRequestSchema = billingPeriodSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  /**
   * The preview the operator actually looked at. If the period moved between
   * preview and commit, the commit is rejected rather than silently closing a
   * different month than the one on screen.
   */
  expectedBlockerCount: z.number().int().nonnegative(),
});
export type CommitSettlementRequest = z.infer<typeof commitSettlementRequestSchema>;

export const commitSettlementResponseSchema = z.object({
  period: billingPeriodSchema,
  state: periodStateSchema,
  closedAt: z.string().datetime().nullable(),
  closedBy: z.string().uuid().nullable(),
  settlementsWritten: z.number().int().nonnegative(),
  /** True when this call replayed an earlier identical commit. */
  idempotentReplay: z.boolean(),
});
export type CommitSettlementResponse = z.infer<typeof commitSettlementResponseSchema>;

// ─── 3. Create / retry statement delivery ────────────────────────────────────

export const deliverStatementRequestSchema = z.object({
  orgId: orgIdSchema,
  statementId: z.string().min(1),
  channel: deliveryChannelSchema.default("email"),
  idempotencyKey: idempotencyKeySchema,
  /**
   * A resend re-sends the STORED document. It never regenerates: the customer
   * must receive the same bytes twice, not a fresh render that may differ.
   */
  resend: z.boolean().default(false),
});
export type DeliverStatementRequest = z.infer<typeof deliverStatementRequestSchema>;

export const deliverStatementResponseSchema = z.object({
  statementId: z.string(),
  attemptNumber: z.number().int().positive(),
  state: deliveryStateSchema,
  /** Present only on an acknowledgement. Without it, "sent" is unprovable. */
  providerId: z.string().nullable(),
  retryInMs: z.number().int().nonnegative().nullable(),
  requiresOperatorAction: z.boolean(),
  reason: z.string(),
});
export type DeliverStatementResponse = z.infer<typeof deliverStatementResponseSchema>;

// ─── 4. List driver statements (org/admin context) ───────────────────────────

export const listDriverStatementsRequestSchema = z.object({
  orgId: orgIdSchema,
  year: z.number().int().min(2020).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  driverId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ListDriverStatementsRequest = z.infer<typeof listDriverStatementsRequestSchema>;

export const statementSummarySchema = z.object({
  statementId: z.string(),
  period: billingPeriodSchema,
  recipientKind: z.enum(["driver", "organisation"]),
  recipientId: z.string(),
  totalIsk: iskStringSchema,
  currency: currencyCodeSchema,
  lineCount: z.number().int().nonnegative(),
  excludedSessionCount: z.number().int().nonnegative(),
  issuedAt: z.string().datetime().nullable(),
  deliveryState: deliveryStateSchema.nullable(),
});
export type StatementSummary = z.infer<typeof statementSummarySchema>;

export const listDriverStatementsResponseSchema = z.object({
  statements: z.array(statementSummarySchema),
  nextCursor: z.string().nullable(),
});

// ─── 5. List own driver billing material ─────────────────────────────────────
//
// The driver-facing read. Note what is NOT here: no orgId in the request. The
// driver's own identity comes from the bearer token, and letting a driver name
// an org would be a cross-tenant hole dressed as a filter.

export const myBillingMaterialRequestSchema = z.object({
  year: z.number().int().min(2020).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  limit: z.number().int().min(1).max(60).default(12),
});
export type MyBillingMaterialRequest = z.infer<typeof myBillingMaterialRequestSchema>;

export const statementLineSchema = z.object({
  kind: z.enum([
    "session_energy",
    "plug_time",
    "subscription_connector",
    "subscription_driver",
    "cap_relief",
    "correction",
  ]),
  description: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  /** Audit figure, aurar. */
  amountMinor: signedAurarStringSchema,
  /** Billed figure, whole ISK. This is the one that sums to the total. */
  amountIsk: iskStringSchema,
  sessionId: z.string().uuid().optional(),
  reason: z.string().optional(),
});
export type StatementLineDto = z.infer<typeof statementLineSchema>;

export const myBillingMaterialResponseSchema = z.object({
  statements: z.array(
    statementSummarySchema.extend({ lines: z.array(statementLineSchema) }),
  ),
  /**
   * Said plainly on every driver-facing response: this is billing MATERIAL,
   * not an invoice, not a payment request, and not proof of payment.
   */
  disclaimer: z.literal(
    "Billing material for your reference. Not an invoice or a payment request.",
  ),
});

// ─── 6. Export org statement material ────────────────────────────────────────

export const exportFormatSchema = z.enum(["csv", "json"]);

export const exportStatementRequestSchema = billingPeriodSchema.extend({
  format: exportFormatSchema.default("csv"),
  /** Export the STORED document, never a re-render. */
  statementId: z.string().min(1).optional(),
});
export type ExportStatementRequest = z.infer<typeof exportStatementRequestSchema>;

// ─── 7. Mark settlement hold / review resolution ─────────────────────────────

export const resolveHoldRequestSchema = z.object({
  orgId: orgIdSchema,
  sessionId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema,
  resolution: z.enum(["accept_ocpp", "accept_cdr", "write_off", "keep_held"]),
  /**
   * Required, always. Resolving a hold is a money decision by a human, and a
   * decision with no recorded reason cannot be reviewed later.
   */
  note: z.string().trim().min(3).max(1000),
});
export type ResolveHoldRequest = z.infer<typeof resolveHoldRequestSchema>;

export const resolveHoldResponseSchema = z.object({
  sessionId: z.string().uuid(),
  status: settlementStatusSchema,
  reviewReasons: z.array(reviewReasonSchema),
  /**
   * Resolution never edits the original snapshot; it writes a new one linked
   * back to it. Immutability is the whole point of a snapshot.
   */
  newSettlementId: z.string().uuid().nullable(),
  correctsSettlementId: z.string().uuid().nullable(),
});

// ─── 8. Rate book effective-dated update ─────────────────────────────────────

export const rateBookUpdateRequestSchema = z
  .object({
    orgId: orgIdSchema,
    kind: z.enum(["dso", "retailer", "cpo_addon"]),
    code: z.string().trim().min(1).max(64),
    pricePerKwhMinor: bigIntStringSchema,
    effectiveFrom: z.coerce.date(),
    effectiveUntil: z.coerce.date().nullable().default(null),
    idempotencyKey: idempotencyKeySchema,
    /**
     * Backdating restates history for anything not yet snapshotted, so it is
     * possible but never accidental: it requires a reason that is audited.
     */
    backdateReason: z.string().trim().min(3).max(500).optional(),
  })
  .refine(
    ({ effectiveFrom, effectiveUntil }) =>
      effectiveUntil === null || effectiveUntil > effectiveFrom,
    { message: "effectiveUntil must be strictly after effectiveFrom", path: ["effectiveUntil"] },
  );
export type RateBookUpdateRequest = z.infer<typeof rateBookUpdateRequestSchema>;

/**
 * Is this rate write a backdate, and is it permitted?
 *
 * Pure, so the rule is testable without a route. `now` is passed rather than
 * read from a clock so the decision is reproducible.
 */
export function classifyRateWrite(
  effectiveFrom: Date,
  now: Date,
  backdateReason: string | undefined,
): { backdated: boolean; allowed: boolean; reason: string } {
  const backdated = effectiveFrom.getTime() < now.getTime();
  if (!backdated) {
    return { backdated: false, allowed: true, reason: "future or immediate effective date" };
  }
  if (!backdateReason || backdateReason.trim().length < 3) {
    return {
      backdated: true,
      allowed: false,
      reason: "backdating restates history and requires an audited reason",
    };
  }
  return { backdated: true, allowed: true, reason: "backdated with an audited reason" };
}

/**
 * Every route in this contract file, with the permission it must be gated on.
 *
 * Exported as data so a test can assert that no Core billing route is declared
 * without a tenant parameter — the contract-level guard against the unscoped
 * surfaces that already exist elsewhere in this codebase.
 */
export const CORE_BILLING_ROUTE_CONTRACTS = [
  { method: "GET", path: "/api/admin/orgs/:orgId/billing/periods/:year/:month/preflight", permission: "billing.read", orgIdParam: "orgId", idempotent: true, mutates: false },
  { method: "POST", path: "/api/admin/orgs/:orgId/billing/periods/:year/:month/close", permission: "billing.write", orgIdParam: "orgId", idempotent: true, mutates: true },
  { method: "POST", path: "/api/admin/orgs/:orgId/billing/statements/:id/deliver", permission: "billing.write", orgIdParam: "orgId", idempotent: true, mutates: true },
  { method: "GET", path: "/api/admin/orgs/:orgId/billing/statements", permission: "billing.read", orgIdParam: "orgId", idempotent: true, mutates: false },
  { method: "GET", path: "/api/driver/billing-material", permission: "driver.self", orgIdParam: null, idempotent: true, mutates: false },
  { method: "GET", path: "/api/admin/orgs/:orgId/billing/statements/:id/export", permission: "billing.export", orgIdParam: "orgId", idempotent: true, mutates: false },
  { method: "POST", path: "/api/admin/orgs/:orgId/billing/settlements/:sessionId/resolve", permission: "billing.write", orgIdParam: "orgId", idempotent: true, mutates: true },
  { method: "PUT", path: "/api/admin/orgs/:orgId/billing/rates", permission: "tariff.write", orgIdParam: "orgId", idempotent: true, mutates: true },
] as const;
