/**
 * zod-common.ts — Shared Zod validation primitives for the billing module.
 *
 * Tracks A, B, and C import from this file. Do not add domain-specific
 * validators here — those belong in the per-domain files under billing/
 * that import from this one.
 *
 * Sprint 9 — Phase 1 Track D deliverable.
 */
import { z } from "zod";
import {
  PILOT_AGREEMENT_TYPES,
  PILOT_FACTOR_CODES,
} from "./pilot-scope";

// ─── Identifiers ─────────────────────────────────────────────────────────────

/** UUIDv4/v7 — used for org_id and other FK references. */
export const orgIdSchema = z
  .string()
  .uuid({ message: "org_id must be a valid UUID" });

/**
 * Cost factor code — uppercase, 3–12 chars, starts with a letter.
 * Examples: USRF, TRF_CHG, ELE
 */
export const costFactorCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,11}$/, {
    message:
      "Cost factor code must match /^[A-Z][A-Z0-9_]{2,11}$/ — uppercase, 3–12 chars, starts with a letter",
  });

// ─── Money / currency ────────────────────────────────────────────────────────

/**
 * BigInt expressed as a decimal string — used for BIGINT minor-unit columns.
 * Must be non-negative (no negative prices at the factor level).
 */
export const bigIntStringSchema = z
  .string()
  .regex(/^\d+$/, { message: "Must be a non-negative integer string" })
  .refine((s) => BigInt(s) >= 0n, { message: "Value must be non-negative" });

/**
 * ISO 4217 currency code.
 * Pilot restriction: ISK only.
 * TODO: when extending past pilot, add EUR, USD, SEK, NOK, DKK etc.
 */
export const currencyCodeSchema = z.enum(["ISK"], {
  message: "Only ISK is supported in the pilot. Extend currencyCodeSchema when going multi-currency.",
});

/**
 * VAT rate as a decimal string in [0, 100].
 * Stored as string to avoid float rounding when serialising to/from JSON.
 * Examples: "0", "24", "24.5"
 */
export const vatRatePctSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, { message: "VAT rate must be a decimal number string" })
  .refine(
    (s) => {
      const n = parseFloat(s);
      return n >= 0 && n <= 100;
    },
    { message: "VAT rate must be in [0, 100]" },
  );

// ─── Dates ───────────────────────────────────────────────────────────────────

/**
 * Effective date range — effectiveFrom is required; effectiveUntil is
 * optional (null = open-ended). When effectiveUntil is set it must be
 * strictly after effectiveFrom.
 */
export const effectiveDateRangeSchema = z
  .object({
    effectiveFrom: z.coerce.date(),
    effectiveUntil: z.coerce.date().nullable(),
  })
  .refine(
    ({ effectiveFrom, effectiveUntil }) => {
      if (effectiveUntil === null) return true;
      return effectiveUntil > effectiveFrom;
    },
    {
      message: "effectiveUntil must be strictly after effectiveFrom",
      path: ["effectiveUntil"],
    },
  );

// ─── Pilot-scope enums ───────────────────────────────────────────────────────

/**
 * Agreement type restricted to pilot scope.
 * TODO: extend past pilot — add "service_contractor", "service_workplace", "workplace"
 */
export const pilotAgreementTypeSchema = z.enum(
  PILOT_AGREEMENT_TYPES as unknown as [string, ...string[]],
  {
    message: `Agreement type must be one of: ${PILOT_AGREEMENT_TYPES.join(", ")}`,
  },
);

/**
 * Cost factor code restricted to pilot scope.
 * TODO: extend past pilot — add CNR, RVN, PRM, AGN, WRK, RNT, IDL, NET, SRF
 */
export const pilotFactorCodeSchema = z.enum(
  PILOT_FACTOR_CODES as unknown as [string, ...string[]],
  {
    message: `Factor code must be one of the pilot codes: ${PILOT_FACTOR_CODES.join(", ")}`,
  },
);
