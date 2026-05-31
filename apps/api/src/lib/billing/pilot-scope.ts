/**
 * pilot-scope.ts — Pilot scope constants for the billing agreement module.
 *
 * When the first contractor / workplace / MDU tenant lands, this file is
 * where the gates flip. Each constant has a TODO listing the values to add.
 * Search-and-replace this filename to find all gates.
 *
 * Sprint 9 — Phase 1 Track D deliverable.
 * ADR 0019 §2026-05-31 addendum documents the flag pattern.
 */

export const PILOT_AGREEMENT_TYPES = ["service_cpo", "installation"] as const;
// TODO: when extending past pilot, add: "service_contractor", "service_workplace", "workplace"

export const PILOT_FACTOR_CODES = [
  "USRF",
  "INT",
  "DSO",
  "MTR",
  "ELE",
  "TRF_CHG",
  "TRF_IDLE",
  "TRF_PLUG",
] as const;
// TODO: when extending past pilot, add: "CNR", "RVN", "PRM", "AGN", "WRK", "RNT", "IDL", "NET", "SRF"

export const PILOT_COMPUTE_RULE_KINDS = [
  "flat_per_kwh",
  "flat_per_session",
] as const;
// TODO: when extending past pilot, add: "tou", "subscription", "tiered_per_kwh"

// ─── Type helpers ────────────────────────────────────────────────────────────

export type PilotAgreementType = (typeof PILOT_AGREEMENT_TYPES)[number];
export type PilotFactorCode = (typeof PILOT_FACTOR_CODES)[number];
export type PilotComputeRuleKind = (typeof PILOT_COMPUTE_RULE_KINDS)[number];

// ─── Runtime guards — return 400 at the route level if not in pilot scope ────

/** Returns true if the given string is a valid pilot-scope agreement type. */
export function isPilotAgreementType(t: string): t is PilotAgreementType {
  return (PILOT_AGREEMENT_TYPES as readonly string[]).includes(t);
}

/** Returns true if the given string is a valid pilot-scope cost factor code. */
export function isPilotFactorCode(c: string): c is PilotFactorCode {
  return (PILOT_FACTOR_CODES as readonly string[]).includes(c);
}

/** Returns true if the given string is a valid pilot-scope compute rule kind. */
export function isPilotComputeRuleKind(k: string): k is PilotComputeRuleKind {
  return (PILOT_COMPUTE_RULE_KINDS as readonly string[]).includes(k);
}

/** Regex pattern a valid cost-factor code must match (preserved from Track A). */
export const COST_FACTOR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,11}$/;
