// Zod validation schemas for TariffDefinition management endpoints.
//
// TariffDefinition is load-bearing for session-stop cost resolution (Rule 5).
// The key Rule 5 invariant enforced here:
//
//   NEVER allow mutation of compute_rule, currency, vat_rate_pct,
//   cost_factor_id, or valid_from on a tariff whose status = 'active'.
//   Those are resolution fields. Changing them would silently corrupt
//   session cost calculations. Only display_name (and notes, if present)
//   are mutable on an active tariff.
//
// Lifecycle:
//   draft → active  (publish endpoint, dedicated schema)
//   active → retired (retire endpoint, dedicated schema)
//   draft → retired  (discard, via retire endpoint)
//   active → draft   NOT ALLOWED — clone instead
//
// Pilot-scope compute rule kinds: flat_per_kwh, flat_per_session.
// If Track D creates apps/api/src/lib/billing/pilot-scope.ts with
// PILOT_COMPUTE_RULE_KINDS, import from there instead of inlining here.
// TODO: import from pilot-scope.ts once Track D lands (ADR integration).
const PILOT_COMPUTE_RULE_KINDS = ["flat_per_kwh", "flat_per_session"] as const;
export type PilotComputeRuleKind = (typeof PILOT_COMPUTE_RULE_KINDS)[number];

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Compute rule sub-schemas (pilot scope only)
// ─────────────────────────────────────────────────────────────────────────────

const FlatPerKwhRuleSchema = z.object({
  kind: z.literal("flat_per_kwh"),
  /** Price in ISK aurar (minor units). Transport as string for BigInt safety. */
  pricePerKwhMinor: z
    .string()
    .regex(/^\d+$/, "Must be a non-negative integer string (minor units)"),
});

const FlatPerSessionRuleSchema = z.object({
  kind: z.literal("flat_per_session"),
  /** Price in ISK aurar (minor units). Transport as string for BigInt safety. */
  priceMinor: z
    .string()
    .regex(/^\d+$/, "Must be a non-negative integer string (minor units)"),
});

export const ComputeRuleSchema = z.discriminatedUnion("kind", [
  FlatPerKwhRuleSchema,
  FlatPerSessionRuleSchema,
]);

export type ComputeRuleInput = z.infer<typeof ComputeRuleSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Create — new draft TariffDefinition
// ─────────────────────────────────────────────────────────────────────────────

export const CreateTariffSchema = z.object({
  /** UUID of the Organization that owns this tariff. */
  orgId: z.string().uuid(),

  /** UUID of billing.cost_factors row that anchors this tariff. */
  costFactorId: z.string().uuid(),

  /** Human-readable name, e.g. "Veitur AD1" or "N1 N1_RAFMAGN-REPF-01". */
  displayName: z.string().min(1).max(255),

  /** ISO currency code. Default: ISK. */
  currency: z.string().length(3).default("ISK"),

  /** VAT rate percentage, e.g. "24.00" for Iceland standard. */
  vatRatePct: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Decimal string, max 2dp")
    .default("24.00"),

  /** Compute rule JSONB. Only pilot-scope kinds accepted. */
  computeRule: ComputeRuleSchema,
});

export type CreateTariffInput = z.infer<typeof CreateTariffSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Patch — edit an existing TariffDefinition
//
// Rule 5: compute_rule, currency, vat_rate_pct, cost_factor_id, valid_from
// are NOT patchable here. The route handler additionally enforces that
// active tariffs may only receive display_name changes.
// Retired tariffs reject all patches.
// ─────────────────────────────────────────────────────────────────────────────

export const PatchTariffSchema = z
  .object({
    /** Mutable on draft AND active. */
    displayName: z.string().min(1).max(255).optional(),

    //
    // Draft-only fields (route rejects these if status = 'active').
    //

    /** UUID of billing.cost_factors row. Draft only. */
    costFactorId: z.string().uuid().optional(),

    /** ISO currency code. Draft only. */
    currency: z.string().length(3).optional(),

    /** VAT rate percentage. Draft only. */
    vatRatePct: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Decimal string, max 2dp")
      .optional(),

    /** Compute rule. Draft only. */
    computeRule: ComputeRuleSchema.optional(),

    /** ISO-8601 date-time string for effective date. Draft only. */
    validFrom: z
      .string()
      .datetime({ offset: true })
      .optional(),

    /** ISO-8601 date-time string. Null = open-ended. Draft only. */
    validUntil: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Patch body must include at least one field",
  });

export type PatchTariffInput = z.infer<typeof PatchTariffSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Active-tariff whitelist
//
// These are the ONLY fields that may be patched on an active tariff.
// Anything else → 400 { error: "active_immutable", suggestion: "clone_then_edit" }
// ─────────────────────────────────────────────────────────────────────────────

export const ACTIVE_TARIFF_MUTABLE_FIELDS = new Set<keyof PatchTariffInput>([
  "displayName",
]);
