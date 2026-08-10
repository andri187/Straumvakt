// @straumvakt/commercial — the money engine.
//
// Phase 1 of the harvest: the PURE core only. `types.ts` (vocabulary + the
// zod allocation schemas) and `resolve.ts` (buildLadder, pickActiveRate,
// resolveFactor, computeBillingLines, and the money arithmetic) have no I/O,
// no ORM and no client, which is what made them movable byte-for-byte.
//
// Phase 2 — persist.ts and billing-tick.ts — is NOT here. Those carry 10
// Prisma calls and the candidate-selection predicate, and they move on their
// own gate.
//
// The old apps/api paths still work: they are re-export shims and stay until
// the last caller points here. Copy-then-strangle, FOCUS.md rule 1.

export * from "./agreement/types";
export * from "./agreement/resolve";

// Core billing — the locked Iceland Core frame (200/50/450 kr), plug-time
// occupancy, and rate-version window selection. Pure, no I/O, no ORM, in
// the same money conventions as the session-cost engine: BigInt minor
// units (1/100 króna) and half-up rounding.
//
// These are additions, not replacements. The session-cost engine still
// prices ENERGY per session; these price the SUBSCRIPTION per month, the
// OCCUPANCY per session, and decide which rate version applies when a
// session crosses a rate change — all three listed as out of scope in
// compute-session-cost.ts.
export * from "./core-billing/subscription";
export * from "./core-billing/plug-time";
export * from "./core-billing/rate-window";
