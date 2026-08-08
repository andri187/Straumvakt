# ADR 0033 — Driver web portal (management surface; charging stays mobile)

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Accepted (2026-06-05)
**Amends:** [ADR 0026 §5](./0026-host-managed-driver-enrollment-and-billing-model.md)
(which made the mobile app the *only* driver surface).
**Related:** [ADR 0028](./0028-driver-invite-mechanism.md) (invite redemption),
[ADR 0031](./0031-cost-model-and-money-flow.md) (driver cost views),
[ADR 0032](./0032-neighbour-helper-and-issue-engine-go-live.md) (issues/helper).

## Context

ADR 0026 §5 said the **mobile app is the only driver surface** and the web flow
ends at "install the app." That was correct for the *transactional* path
(starting a charge needs BLE/RFID at the charger). But going-public adds a real
need for a driver **self-service management** surface that is far better on the
web: reviewing cost/invoices, managing family/dependents, seeing access across
hosts, redeeming invites, requesting workplace billing, and raising/cancelling
issues. The driver-portal concept already designed these.

This ADR carves out a **driver web portal** for management only.

## Decision

1. **A driver web portal exists** at the brand domain, scoped to the
   authenticated driver (audience=`driver`), reusing the driver identity/session.
2. **Charging stays mobile.** Starting/stopping a session requires the app
   (BLE/RFID at the charger). The web portal may *monitor* a live session and
   *stop* it, but **cannot start** one — same safety rule as the concept.
3. **Web portal scope (management):**
   - Charging history + cost/invoices (read), incl. company-paid badges.
   - Access view (which hosts/installations, billing-home), read.
   - Family/dependents management (ADR 0026 §10A carve-out).
   - Invite redemption + workplace-billing requests (ADR 0028/0031).
   - Issues: raise/track/escalate; helper availability (ADR 0032) — actuation
     still gated to host-designated helpers.
   - Profile (email/phone editable; name/kennitala host-managed, read).
4. **Same data scoping as the app** — every view filters by the authenticated
   driver's `userId` and their DriverGroup memberships (cross-host union,
   per-host slice), per the tenant-isolation audit.

## Consequences

- **Enabled:** a proper driver self-service surface without weakening the
  charging-safety rule; consistent with the existing driver token + `/api/driver/*`
  scoping (already audited sound).
- **Cost:** a second driver client to keep in parity with the app for the
  management features; mitigated by sharing the same API + identity.
- **Unchanged:** the app remains the only redemption/charging-initiation path
  that matters in the field; the "empty-state → install the app" funnel for a
  brand-new driver still applies on the public web.

## Rejected

- **No driver web at all** (strict ADR 0026 §5) — rejected; management tasks are
  painful on mobile and hosts/drivers asked for them.
- **Allow web-initiated charging** — rejected; BLE/RFID proximity is the safety
  boundary.
