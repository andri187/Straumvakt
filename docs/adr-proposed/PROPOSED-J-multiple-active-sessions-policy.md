# PROPOSED J — Allow multiple active sessions; nominate a primary

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** product
**Register:** D-10 · **Related:** P0-D

## Context

Multiple concurrent sessions are supported end to end: `getDriverActiveSessions`
returns an array ordered `startedAt desc`; `/sessions/current` returns
`{ sessions: [...] }`; `stop-session` requires an explicit `sessionId` and
enforces ownership in the query predicate, so stopping is already deterministic.
`ae5db26` tracks a selected session across multiple rows.

Nothing prohibits it and nothing designs for it. **Silence therefore ships the
permissive behaviour.**

## Options

1. Prohibit — reject a second start with `409 already_charging`.
2. Allow, require explicit selection in the UI.
3. Allow, nominate a primary with a deterministic rule.

## Recommended

**Option 3**, on Option 2's contract. The array stays authoritative;
`primarySessionId` is a hint clients may follow.

Option 1 is rejected on failure-mode grounds: its worst case is that a stale
in-progress row prevents a driver from starting a charge at all, which is worse
than any N>1 UI awkwardness, and it depends on session cleanup being perfect.

## Consequences

Notifications and deep links get a single deterministic target. Primary
selection must be computed from a stable server-side ordering, not client state,
or it will flap between polls.

## Migration

None — current behaviour is a strict subset.

## Unresolved

Whether a household or fleet account is expected to charge two cars at once, or
whether N>1 only ever indicates a fault. That is a product fact, not a technical
one, and it changes the framing more than the mechanics.
