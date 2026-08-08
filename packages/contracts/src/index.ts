// @straumvakt/contracts — the canonical vocabulary.
//
// One home for the shapes apps/web, apps/api, the gateway and the driver app
// all have to agree on. Harvested out of @straumvakt/shared on 2026-08-08;
// shared re-exports every one of these so no existing import broke.
//
// WHAT BELONGS HERE: DTOs and UI types, input shapes, ids and enums, the
// vendor-adapter INTERFACE, the money-line shape.
//
// WHAT DOES NOT: the Drizzle schema (that is the db package's, and it is the
// source of truth for the database), any domain LOGIC, any vendor code, any
// billing math. Those are harvested into their own modules, later, and the
// money engine is Rule-5 gated.

// ── input shapes (zod schemas + their inferred types) ──
export * as ChargersInputs from "./inputs/chargers";
export * as CircuitsInputs from "./inputs/circuits";
export * as InstallationsInputs from "./inputs/installations";
export * as OnboardingChainsInputs from "./inputs/onboarding-chains";
export * as OrgsInputs from "./inputs/orgs";
export * as PropertiesInputs from "./inputs/properties";
export * as SitesInputs from "./inputs/sites";
export * as UsersInputs from "./inputs/users";
export * as VendorCredentialsInputs from "./inputs/vendor-credentials";
export * as ZaptecImportInputs from "./inputs/zaptec-import";

// ── DTO / UI vocabulary ──
export type * from "./domain/bill-objects";
export type * from "./domain/charger-technical-read";
export type * from "./domain/chargers";
export type * from "./domain/circuits";
export type * from "./domain/contracts";
export type * from "./domain/credential-management";
export type * from "./domain/family-groups";
export type * from "./domain/host-applications";
export type * from "./domain/installations";
export type * from "./domain/orgs";
export type * from "./domain/pending-discoveries";
export type * from "./domain/properties";
export type * from "./domain/site-tree";
export type * from "./domain/sites";
export type * from "./domain/users";
export type * from "./domain/vendor-credential-probe";
export type * from "./domain/vendor-credentials";
export type * from "./domain/vendor-user-groups";
export type * from "./domain/zaptec-import";

// ── the vendor edge (interface only) ──
export type * from "./vendor/adapter";

// ── money lines ──
export * from "./money/lines";
