// Zod validation schemas for billing.cost_factors CRUD operations.
//
// Key invariants enforced here (not in DB):
//
//   1. `code` and `anchorTier` are immutable on an existing row.
//      The PATCH handler in the router checks for these keys before calling
//      the Zod parse, returning an explicit 422 immutable_field error.
//
//   2. `code` must match COST_FACTOR_CODE_PATTERN (3–12 chars, uppercase
//      alphanumeric + underscore, starts with a letter).
//
//   3. `defaultVatRatePct` is a non-negative number ≤ 100.
//
//   4. `defaultCurrency` is a 3-char ISO 4217 code (uppercase).
//
// Sprint 9 — Track A.

import { z } from "zod";
import { COST_FACTOR_CODE_PATTERN } from "./pilot-scope";

// ─────────────────────────────────────────────────────────────────────────────
// Shared field validators
// ─────────────────────────────────────────────────────────────────────────────

const codeSchema = z
  .string()
  .regex(
    COST_FACTOR_CODE_PATTERN,
    "Code must be 3–12 uppercase alphanumeric characters or underscores and start with a letter (e.g. DSO, TRF_CHG)",
  );

const displayNameSchema = z
  .string()
  .min(1, "Display name is required")
  .max(120, "Display name must be 120 characters or fewer");

const descriptionSchema = z
  .string()
  .max(500, "Description must be 500 characters or fewer")
  .nullable()
  .optional();

const vatRatePctSchema = z
  .number()
  .min(0, "VAT rate cannot be negative")
  .max(100, "VAT rate cannot exceed 100%");

const currencySchema = z
  .string()
  .length(3, "Currency must be a 3-character ISO 4217 code")
  .regex(/^[A-Z]{3}$/, "Currency must be 3 uppercase letters (e.g. ISK, EUR)");

const anchorTierSchema = z.enum([
  "org",
  "property",
  "site",
  "installation",
  "circuit",
  "charger",
  "driver_contract",
]);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/billing/cost-factors — create
// ─────────────────────────────────────────────────────────────────────────────

export const createCostFactorSchema = z.object({
  /** 3–12 char code, uppercase alphanumeric + underscore, starts with letter. */
  code: codeSchema,
  displayName: displayNameSchema,
  description: descriptionSchema,
  /**
   * Anchor tier is immutable once set. Determine the entity level this
   * factor is anchored to before creating.
   */
  anchorTier: anchorTierSchema,
  /** Non-negative decimal ≤ 100. Stored as Prisma Decimal. */
  defaultVatRatePct: vatRatePctSchema,
  defaultCurrency: currencySchema.default("ISK"),
  /** Defaults to 'active'. Use 'draft' to stage before activating. */
  status: z.enum(["draft", "active", "archived"]).default("active"),
});

export type CreateCostFactorInput = z.infer<typeof createCostFactorSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/billing/cost-factors/:id — edit
//
// code and anchorTier are intentionally ABSENT — they cannot be changed
// in place. The router checks for them before parsing and rejects with a
// clear immutable_field error rather than a Zod validation error.
// ─────────────────────────────────────────────────────────────────────────────

export const updateCostFactorSchema = z.object({
  displayName: displayNameSchema.optional(),
  description: descriptionSchema,
  defaultVatRatePct: vatRatePctSchema.optional(),
  defaultCurrency: currencySchema.optional(),
});

export type UpdateCostFactorInput = z.infer<typeof updateCostFactorSchema>;
