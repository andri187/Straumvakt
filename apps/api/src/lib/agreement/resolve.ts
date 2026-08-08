// HARVESTED to @straumvakt/commercial (2026-08-08) — Phase 1.
//
// Re-export shim. The implementation moved byte-for-byte into
// packages/commercial/src/agreement/resolve.ts; this file exists so persist.ts,
// billing-tick.ts, the admin routes and the scripts keep working untouched.
//
// COPY-THEN-STRANGLE (FOCUS.md rule 1): the old path keeps running until the
// clean path has parity, and this file goes when the last caller imports
// "@straumvakt/commercial/agreement/resolve" directly — not before.
//
// Both forms are required: `export *` carries the runtime values (the zod
// schemas, the resolver functions), `export type *` carries the types that
// isolatedModules will not re-export through a value export.
export * from "@straumvakt/commercial/agreement/resolve";
export type * from "@straumvakt/commercial/agreement/resolve";
