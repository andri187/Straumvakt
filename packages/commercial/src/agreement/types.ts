// Sprint 9 / ADR 0019 — agreement-architecture types.
//
// Domain types mirroring the agreements.* Prisma models, but stripped to
// the fields the resolver actually walks. Keeping the resolver decoupled
// from Prisma generated types lets the UI consume the same module without
// pulling in a Cloudflare-runtime client.

import { z } from "zod";

// ── Bearer + scope + audience ────────────────────────────────────────

export const BEARER_CODES = ["org", "usr", "wrk", "trd"] as const;
export type BearerCode = (typeof BEARER_CODES)[number];

export const RULE_SCOPES = ["site", "installation", "circuit", "charger"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export const RULE_AUDIENCES = ["driver_group", "user"] as const;
export type RuleAudience = (typeof RULE_AUDIENCES)[number];

/**
 * What a rate is charged per.
 *
 * `per_connector` added 2026-08-08 for the flat platform fee (Straumvakt→host,
 * principal). It is deliberately NOT session-derived: its quantity is a count
 * of connectors on an org at a point in time, which no SessionContext carries
 * and no CDR implies. See `basisQuantityFor` in resolve.ts — resolving one
 * through the session path throws rather than guessing.
 *
 * The alternative considered and rejected was reusing `per_day` with
 * connector-days. It needs no new enum value and makes every invoice line
 * misstate its unit, permanently, to someone who will eventually read it.
 *
 * NOTE — the Postgres enum `agreements."RateBasis"` does NOT yet carry this
 * value. Until that migration runs, a rate reference cannot be STORED with
 * this basis; the union is ahead of the column on purpose, so the resolver
 * and its tests can be settled before the schema moves.
 */
export const RATE_BASES = [
  "per_kwh",
  "per_minute",
  "per_day",
  "per_session",
  "per_connector",
] as const;
export type RateBasis = (typeof RATE_BASES)[number];

export const BILLING_LINE_KINDS = ["passthrough", "markup"] as const;
export type BillingLineKind = (typeof BILLING_LINE_KINDS)[number];

// ── Allocation (JSONB) ───────────────────────────────────────────────

/**
 * Bearer codes inside allocation_json are case-normalised on read.
 *
 * ADR 0019 §Allocation writes its JSON examples in UPPERCASE ("USR"), and
 * `migrate-to-agreements.ts` seeded every clause from those examples. The
 * Postgres enum `agreements."BearerType"` and `BEARER_CODES` are lowercase,
 * so `allocation_json` — being JSONB, and therefore unconstrained by the
 * enum — is the one place the two halves of the ADR were free to disagree.
 * They did, and nothing caught it: the resolver rejected every clause it was
 * ever handed, but no session was attributable enough to reach the resolver
 * until 2026-08-07.
 *
 * "USR" and "usr" name the same bearer, so accepting both is not a semantic
 * change. It is also what lets already-seeded rows resolve without a data
 * migration against staging. New writes are lowercase — see the seeder.
 */
const bearerCode = z.preprocess(
  (v) => (typeof v === "string" ? v.toLowerCase() : v),
  z.enum(BEARER_CODES)
);

export const allocationSplitSchema = z.object({
  bearer_type: bearerCode,
  share_pct: z.number().min(0).max(100),
  bearer_ref: z.string().uuid().nullish(),
});

export const allocationMarkupSchema = z.object({
  basis: z.enum(["percent", "fixed_per_kwh", "fixed_per_minute", "fixed_per_session"]),
  value: z.number(),
  payer_type: bearerCode,
  payer_ref: z.string().uuid().nullish(),
  recipient_type: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase() : v),
    z.enum(["org", "wrk"])
  ),
});

export const allocationSchema = z.object({
  passthrough: z.object({
    splits: z.array(allocationSplitSchema).min(1),
  }),
  markup: allocationMarkupSchema.nullable(),
});

export type AllocationSplit = z.infer<typeof allocationSplitSchema>;
export type AllocationMarkup = z.infer<typeof allocationMarkupSchema>;
export type Allocation = z.infer<typeof allocationSchema>;

// ── Resolver inputs ──────────────────────────────────────────────────

// Per-factor default carried by an Agreement.
export type ClauseInput = {
  costFactorId: string;
  costFactorCode: string;
  defaultBearerType: BearerCode;
  defaultBearerRef: string | null;
  defaultRateRefCode: string | null;
  allocation: Allocation;
};

// A BearerRule diff. Each override field is independently nullable —
// `null` means inherit from the next walk step.
export type RuleInput = {
  id: string;
  costFactorId: string;
  scopeType: RuleScope | null;
  scopeId: string | null;
  audienceType: RuleAudience | null;
  audienceId: string | null;
  bearerType: BearerCode | null;
  bearerRef: string | null;
  rateRefCode: string | null;
  allocation: Allocation | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
};

// A row from the versioned rate book.
export type RateRefInput = {
  id: string;
  code: string;
  costFactorId: string;
  basis: RateBasis;
  priceMinor: bigint;
  vatRatePct: number;
  currency: string;
  supplierOrgId: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
};

// Everything the resolver needs about a session. Pure inputs — no I/O,
// no Prisma. The caller (a route handler / cron) loads these once and
// hands them in.
export type SessionContext = {
  agreementId: string;
  cpoOrgId: string;          // counterparty of the CPO Agreement; recipient for ORG-bearer lines

  user: { id: string };
  driverGroup: { id: string; ownerOrgId: string } | null; // resolves WRK bearer

  // Asset path walked from the Charger up. circuitId / installationId may
  // be null for assets that haven't been placed.
  chargerId: string;
  circuitId: string | null;
  installationId: string | null;
  siteId: string;

  // Session timing + meter readings.
  startedAt: Date;
  endedAt: Date;
  energyKwh: number;
  durationMinutes: number;
  durationDays: number;

  // Catalog tables loaded once per session resolution.
  clauses: ClauseInput[];
  rules: RuleInput[];
  rateReferences: RateRefInput[];
};

// ── Resolver outputs ─────────────────────────────────────────────────

export type ResolvedFactor = {
  factorCode: string;
  bearerType: BearerCode;
  bearerRef: string | null;
  rateRef: RateRefInput | null;
  allocation: Allocation;
  // Audit trail — which rule won each attribute, or null if it cascaded
  // all the way down to the agreement clause default.
  cascadeSource: {
    bearer: string | null;
    rate: string | null;
    allocation: string | null;
  };
};

export type BillingLineDraft = {
  factorCode: string;
  kind: BillingLineKind;
  basisType: RateBasis;
  basisQuantity: number;
  unitPriceMinor: bigint;
  amountExVatMinor: bigint;
  vatRatePct: number;
  vatAmountMinor: bigint;
  amountIncVatMinor: bigint;
  currency: string;
  bearerType: BearerCode;
  bearerRef: string | null;
  recipientOrgId: string | null;
  recipientUserId: string | null;
  rateRefId: string | null;
  ruleId: string | null;
  computationDetail: Record<string, unknown>;
};
