# PROPOSED F — Absence is null; money carries its unit; zero means zero

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** backend owner
**Related:** P0-A, P0-E

## Context

`driver-sessions.ts` emits `powerKw: 0` (hardcoded, never measured) and
collapses null energy and null cost to `0`. One numeric `0` therefore means four
things: measured zero, not measured, not yet priced, and free.

Separately the cost columns are aurar (1/100 króna) per
`compute-session-cost.ts:13-21` and `formatIskMinor`, but are emitted undivided
under the field name `costIsk`. Clients compensate by dividing by 100. Two
mismatches cancel; correcting either alone breaks the product by 100x.

## Options

1. `null` for absence; keep scalar money fields.
2. `null` for absence plus a `cost` object with `amountMinor`, `currency`,
   `exponent`, `state`.
3. Status quo with per-client workarounds.

## Recommended

**Option 2.** Option 1 cannot distinguish free from not-yet-priced — the
distinction the current client workaround already loses, since it renders a
genuinely free session as "Pending". Option 3 makes every future client
re-derive an undocumented convention.

## Consequences

A transitional release carrying both shapes, a client migration, then a removal
release. In exchange the field name stops carrying semantics.

## Security / tenancy

None directly; a misreported charge is a trust and billing-dispute problem.

## Rollout

Additive, then client migration, then removal. Never change `minorToIsk`'s
returned value while keeping the field name in the same release.

## Observability

Counter for fields that would have been `0` under the old rule, by client, for
one release.

## Unresolved

Whether live power is sourced at all. This ADR does not decide that.
