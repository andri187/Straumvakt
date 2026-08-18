# PROPOSED K — Contractors are a role with scoped assignments, not a new organisation kind

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** product + security
**Register:** D-9 · **Related:** ADR 0014

## Context

`MEMBERSHIP_ROLE_PERMISSIONS` maps `contractor` to `TECHNICIAN_BUNDLE`, which
includes `charger.config`, `charger.remote_start` and `charger.remote_stop`.
That mapping is labelled a **pre-ADR-0014 compatibility shim** — the comment
says contractors historically had remote start/stop access. It is not a designed
contractor model.

**No contractor surface exists today.** The role grants permissions; nothing
consumes them.

## Options

1. Keep the compatibility mapping.
2. Define a real contractor bundle plus scoped assignments (per installation or
   per work order) with an expiry.
3. Model a contractor company as its own organisation kind with cross-org grants.

## Recommended

**Option 2.** Option 1 is a deprecated role silently granting remote control.
Option 3 is heavier than the current tenancy model needs and duplicates the
membership concept that already exists.

Shape: a contractor is a member of the **contractor company** organisation and
receives time-bounded, revocable assignments to specific installations owned by
other organisations. Permissions derive from the assignment, not from global
role membership.

## Security / tenancy

Contractor access is the first legitimate **cross-tenant** grant in the system.
Every existing tenancy predicate assumes membership implies the org owns the
object; an assignment model breaks that assumption and every driver/operator
predicate should be re-read against it before it ships.

## Consequences

Requires assignment lifecycle, expiry, revocation, and audit. Also determines
whether BLE service credentials (PROPOSED-I) are grantable and to whom.

## Unresolved

Whether a separate contractor app is justified, or role-aware existing surfaces
are safer initially — see the contractor role model document. Current evidence
favours role-aware surfaces, because a separate app duplicates the auth surface
before the role model is settled.
