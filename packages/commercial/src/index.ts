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
// occupancy, rate-version window selection, meter-energy resolution, CDR
// provenance and billing-period close. Pure, no I/O, no ORM, in the same
// money conventions as the session-cost engine: BigInt minor units
// (1/100 króna) and half-up rounding.
//
// These are additions, not replacements. The session-cost engine still
// prices ENERGY per session; these price the SUBSCRIPTION per month and the
// OCCUPANCY per session, decide which rate version applies when a session
// crosses a rate change, resolve what a meter reading actually means, and
// govern what a ledger row may claim about where its figure came from.
export * from "./core-billing/cdr-provenance";
export * from "./core-billing/delivery-log";
export * from "./core-billing/money";
export * from "./core-billing/settlement";
export * from "./core-billing/statement";
export * from "./core-billing/provenance-state";
export * from "./core-billing/meter-energy";
export * from "./core-billing/period-close";
export * from "./core-billing/subscription";
// The flat-fee feeder — the market line. Uses subscription.ts for the cap
// arithmetic and pickActiveRate for the rate window, so it is a second feeder
// into one engine rather than a second engine.
export * from "./core-billing/flat-fee";
// The activity source the flat-fee feeder consumes. Closes preflight gap 9.6:
// reports.connector_activity_month and driver_activity_month had zero writers.
export * from "./core-billing/activity-month";
// The port between the feeder and the activity tables. Keeps flat-fee.ts pure
// and lets the first-invoice dry run exercise the whole path with no database.
export * from "./core-billing/activity-source";
// The period lifecycle. Delta 9.8: activityJobHasRun stops being a parameter
// a caller hands in and becomes a derived property of the period's state.
export * from "./core-billing/period-lifecycle";
export * from "./core-billing/plug-time";
export * from "./core-billing/rate-window";
