# PROPOSED I — Charger service settings are an installer capability, not a driver one

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** product + security
**Register:** D-8

## Context

`apps/mobile/lib/zaptec_ble_settings/` is roughly 3,800 lines — about 38% of the
mobile codebase, comparable to every driver screen combined. It configures grid
type, maximum current, phases, standalone mode, cable lock, Wi-Fi and PLC
credentials, brightness, grid test and firmware update, and decodes ~30 Zaptec
fault bits.

It is reached with a **driver-audience** bearer token via
`GET /api/driver/chargers/:serial/ble-pin` and
`POST /api/driver/chargers/:serial/advanced-grant`. PIN release is audit-logged
(`charger.ble_pin.released`) and the PIN is never shown to the user.

`session_guard.dart` states plainly that its check is client-side and **not the
security boundary**, and names the backend enforcement as not yet built.

The Zaptec PIN is factory-set, printed on the enclosure, and **cannot be
rotated**, so caching it is a permanent grant that cannot be revoked by rotation.

Codex removed the surface from driver navigation in `ae5db26`; the source is
preserved.

## Options

1. Keep it in the driver app behind a role check.
2. Move it to an installer/contractor surface.
3. Delete it.

## Recommended

**Option 2.** Option 3 discards genuinely valuable, bench-tested work. Option 1
leaves every driver carrying latent charger-configuration privilege and makes
the driver token a service credential.

Preconditions before it ships anywhere: server-side enforcement of PIN release
by role; a grant TTL; an explicit revocation story that does not depend on PIN
rotation; and audit review.

## Security / tenancy

Today the only enforcement between a driver token and a charger's configuration
is a client-side guard and an audit log. An audit log records misuse; it does
not prevent it.

## Unresolved

Whether contractors are a role inside the existing tenancy model or a separate
organisation kind — PROPOSED-K.
