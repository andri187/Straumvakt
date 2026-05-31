// Zod validation schemas for RateReference API endpoints.
//
// RateReference is load-bearing for session-stop cost resolution (ADR 0019,
// Rule 5). The key constraint:
//
//   NEVER mutate price_minor, effective_from, or effective_until on a row
//   whose effective_from <= now() < effective_until (the currently-active
//   row). Those are resolution fields — changing them would silently corrupt
//   historical replay. Only display_name / notes / supplier metadata are
//   mutable on an active row. Anything that changes resolution = stage a
//   new row (POST).
//
// Phase 4 will add a pattern_json editor (OCPI 2.2.1 TariffRestrictions
// shape) for ToD restrictions. For now pattern_json is not exposed.

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Create — stage a new version
// ─────────────────────────────────────────────────────────────────────────────

export const CreateRateReferenceSchema = z.object({
  /** Stable identifier shared across versions, e.g. "veitur-dso-c". */
  code: z.string().min(1).max(120),

  /** UUID of agreements.cost_factors row (e.g. DSO, ELE factor). */
  costFactorId: z.string().uuid(),

  /** UUID of organizations row for the supplier. Null = no external supplier. */
  supplierOrgId: z.string().uuid().nullable().default(null),

  /** Rate basis. per_kwh for energy, per_minute for time, per_day / per_session for standing. */
  basis: z.enum(["per_kwh", "per_minute", "per_day", "per_session"]),

  /** Price in currency-minor units (ISK aurar). BigInt-safe: transport as string. */
  priceMinorStr: z
    .string()
    .regex(/^\d+$/, "Must be a non-negative integer string (minor units)")
    .describe("Price in minor units (ISK aurar). E.g. '86400' = 864.00 kr"),

  /** ISO currency code. Default: ISK. */
  currency: z.string().length(3).default("ISK"),

  /** VAT rate percentage, e.g. 24.00 for Iceland standard. */
  vatRatePct: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Decimal string, max 2dp")
    .default("24.00"),

  /** ISO-8601 date string (YYYY-MM-DD) for when this version becomes active. */
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),

  /** ISO-8601 date string (YYYY-MM-DD) when this version expires. Null = open-ended. */
  effectiveUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .nullable()
    .default(null),

  /** Free-text operator notes. */
  notes: z.string().max(2000).nullable().default(null),
});

export type CreateRateReferenceInput = z.infer<typeof CreateRateReferenceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Patch — edit notes / supplierOrgId on any row;
//          or effectiveUntil ONLY on staged (future) rows.
//
// Rule 5 enforcement: priceMinorStr, effectiveFrom, basis, costFactorId,
// currency, vatRatePct are NOT patchable via this schema. The route handler
// additionally rejects effectiveUntil changes on currently-active rows.
// ─────────────────────────────────────────────────────────────────────────────

export const PatchRateReferenceSchema = z
  .object({
    notes: z.string().max(2000).nullable().optional(),
    supplierOrgId: z.string().uuid().nullable().optional(),

    // effectiveUntil is patchable only when the row is "staged" (effective_from > now()).
    // The route handler checks row status before applying this field.
    effectiveUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field required" });

export type PatchRateReferenceInput = z.infer<typeof PatchRateReferenceSchema>;
