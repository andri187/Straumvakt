// Pilot-scope cost-factor codes for Straumvakt Phase 1 (Sprint 9).
//
// The full cost-factor catalogue contains 15 codes (see ADR 0019
// 2026-05-08 addendum). Of those, only 7 are in scope for the pilot
// operator UI. The UI's "New cost factor" form surfaces these codes
// prominently in the code dropdown while still allowing any valid
// custom code.
//
// TODO: when extending past pilot, remove the PILOT_FACTOR_CODES
// filter from the cost-factor form's code-suggestion list in
// src/app/(app)/billing/cost-factors/new/page.tsx. The API and
// schema already support all 15+ codes — this is a UI narrowing only.

/** Factor codes surfaced as primary suggestions in the pilot operator UI. */
export const PILOT_FACTOR_CODES: readonly string[] = [
  "USRF",     // Notendagjald — per-user-on-installation fee
  "INT",      // Hleðslukerfagjald — per-installation fee
  "DSO",      // Dreifing — DSO grid fee
  "MTR",      // Mælagjald — e-meter daily fee
  "ELE",      // Rafmagn — retailer energy price
  "TRF_CHG",  // Hleðslutímagjald — charge-time fee (ISK/min while charging)
  "TRF_IDLE", // Biðtímagjald — idle-time fee (ISK/min plugged, not drawing)
] as const;

/** Regex pattern a valid cost-factor code must match. */
export const COST_FACTOR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,11}$/;
