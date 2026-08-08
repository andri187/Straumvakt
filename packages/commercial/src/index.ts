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
