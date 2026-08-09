# PROPOSED H — User-entered vehicle data is never observed identity

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** product
**Register:** D-7 · **Related:** ADR 0021, ADR 0024

## Context

The pre-`ae5db26` app asserted a Tesla Model Y, plate `N1 742`, battery, range,
model year, colour and charging identity with **no vehicle-account API behind
any of it**. Codex removed those claims: `my_vehicle.dart` now states that no
vehicle is connected and shows unavailable registration/Autocharge state, and
the hero plate overlay is gone. Twenty-four vehicle renders and the Iceland
plate widget are preserved as assets.

## Forces

- Autocharge identity (EVCCID / PLC MAC) is **observed** at the protocol layer.
- A plate or model a user types is **asserted**.
- Displaying them in one panel implies equal confidence, which is how the
  original prototype became misleading.

## Options

1. No vehicle surface until a vehicle-account API exists.
2. Minimal truthful surface: user-entered nickname and optional plate, clearly
   labelled unverified; Autocharge shown only as "not enrolled".
3. Full configurator with a backing API.

## Recommended

**Option 2 now** (which is what `ae5db26` implements), **Option 3 later**, with
an invariant carried into the contract:

> Every vehicle attribute carries a provenance discriminator —
> `asserted` (user-entered), `observed` (seen on the wire), or
> `verified` (observed and bound to an enrolment). The UI must render
> `asserted` differently from `observed`, and must never promote one to the
> other implicitly.

## Consequences

Option 3 requires an enrolment state machine, consent capture, revocation,
replacement-vehicle handling, multi-vehicle support, and a confidence model for
EVCCID — none of which exists.

## Security / tenancy

An EVCCID is a stable identifier that can correlate a vehicle across sites; it
is personal data by linkage. It must not be exposed to a driver-audience client
beyond what the driver already knows about their own car.

## Unresolved

Whether Zaptec currently supplies EVCCID at all, and where confidence would be
stored (ADR 0021 describes intent, not implementation).
