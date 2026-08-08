# ADR 0046 — Local charger control over BLE, and the deferred approval model

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

> **Renumbered 2026-08-04.** This ADR was written as 0044 and collided with
> [ADR 0044 — Driver-side capabilities](./0044-driver-side-capabilities-and-their-data-shape.md)
> (both dated 2026-08-03). That one keeps 0044 because three call sites cite
> its decision numbers (`sidebar.tsx` D4, handoff §7 D6, driivz note D3);
> this one had only two bare prose references. Older references to "ADR 0044"
> in a BLE/PIN context mean this document.

**Status:** Partially implemented — 2026-08-03. Client built and verified
against hardware; **the two backend grant endpoints are deliberately
deferred** (§4).
**Relates to:** [zaptec-ble-protocol.md](../reference/integrations/zaptec-ble-protocol.md)
(the verified protocol), [charger-settings-ui-guide.md](../app/charger-settings-ui-guide.md)
(the UI contract), [ADR 0038](./0038-read-serving-tier-and-state-propagation.md)
(read tiering — local BLE is a fourth transport neither tier covers).

---

## The one-paragraph version

A Zaptec Pro that loses its IP lease drops off the network, and **no cloud
API can reach it** — which is exactly when a driver needs it restarted.
Zaptec solves this over BLE and documents it as a user feature; doing the
same removes the last reason for a Straumvakt user to install a vendor
app. The protocol was extracted from the vendor APK and verified on
hardware (service UUID by enumeration, PIN auth, and a charger actually
rebooted). The client is built. **What is deliberately not built is the
authorisation around it**, because releasing an unrotatable credential and
granting charger-configuration rights are both access-grant decisions and
belong behind a Rule 5 pass, not behind a late-night build.

---

## Context

### Why local control at all

The cloud path (`POST /api/chargers/{id}/sendCommand/102`) requires the
charger to be online. For the failure being addressed — a lost IP lease —
that is definitionally unavailable. BLE is the only channel left, and it
reaches further than restart: `WifiSSID`, `WifiPSK` and `NetworkStatus`
have **no cloud equivalent**, so BLE can re-provision the network rather
than merely power-cycling it.

### The credential problem

The Zaptec PIN is **factory-set, printed on the box, and cannot be
rotated**. That makes it unlike every other permission in the system:

- Releasing it to a device is effectively **permanent**. Revoking a
  driver's access does not un-teach a PIN their device already holds.
- There is no rotation story. The only true remedy is replacing hardware.
- It is short (4 digits) and brute-force-protected charger-side, so a
  wrong-PIN storm disables the BLE interface — on an already-offline
  charger, that removes the last channel to it.

---

## Decision

### D1 — The PIN is an attribute of the access right, held by the device

The driver **never knows, sees or types it**. Implemented in
`apps/mobile/lib/charger_settings/pin_store.dart`:

| concern | decision |
|---|---|
| Storage | Keystore-backed `EncryptedSharedPreferences` (Android) / Keychain `first_unlock_this_device` (iOS) — the part of the device the user cannot reach |
| Exposure | `use(serial, action)` hands it to a callback; it never enters a widget, a log, or an error string |
| Revocation | `reconcile(accessibleSerials)` drops PINs for chargers no longer in the driver's list, on every charger-list sync |
| Offline backstop | 7-day TTL, for the device revocation cannot reach |

Rejected: prompting the driver. Asking a user to type a credential the
model says they must never know defeats the model.

### D2 — Restart is the only unprivileged action

It is what a driver at a dead charger came for. It is bounded, reversible,
and cannot misconfigure anything. Everything else — network, current
limits, phases, PLC keys, MID test mode — sits behind Advanced.

### D3 — Advanced requires an explicit grant, and fails closed

Advanced can strand a charger. It is not a driver capability. The client
treats **anything it cannot positively determine as locked**: missing
endpoint, network failure, unparseable body. When locked it does not even
read the characteristics.

### D4 — No settings on a charger someone else is using

`preparing`, `charging`, `suspendedEv/Evse` and `finishing` all count as
in use — a session is underway even when no current flows. Allowed only
when the running session belongs to the requesting driver. Fails closed on
uncertainty: a driver wrongly refused is inconvenienced, a driver wrongly
allowed interrupts a stranger's charge.

### D5 — Vendor seam is the capability descriptor, not the screen

Screens render `CapabilityGroup`s; `kZaptecCapabilities` is one
descriptor behind one transport client. **The UI renders from what the
device actually exposes** — this firmware presents 34 of the 52
characteristics the vendor app knows, and a hardcoded screen would show
dead controls on half a fleet.

---

## 4. Deferred — the approval model

**Both backend endpoints are unbuilt, by decision rather than omission:**

1. `GET /api/driver/chargers/{serial}/ble-pin` — privilege-gated release,
   audited per fetch.
2. `GET|POST /api/driver/chargers/{serial}/advanced-grant` — the approval
   a host-admin or CPO gives, and the driver's request for it.

Both are access-grant resolution (Rule 5) and need the stop-and-summarise
pass. The open questions they must answer:

- **Who may approve** — host-admin only, CPO only, or either?
- **Scope** — per charger, per installation, or per org?
- **Duration** — permanent, time-boxed, or per-session? Given the PIN
  cannot be rotated, a permanent grant is closer to irreversible than it
  looks.
- **Audit** — what the record captures, and whether the driver is told.
- **Self-destruct on inactivity** (operator, 2026-08-03) — expire rights,
  and with them the PIN, after a period of disuse, independent of
  explicit revocation.

**Consequence of deferring:** the client-side guards are UX, not security.
A device already holding a cached PIN is bounded only by reconcile-on-sync
and the TTL. Stated here so it is not later mistaken for an oversight.

**Debug-only stand-ins**, both to be deleted when the endpoints land:
a `kDebugMode` PIN entry, and a `kDebugMode` Advanced unlock that renders
a visible "debug build" banner. Deliberately **not** keyed to an account —
an identity-based bypass compiled into the client would ship to every
device, could not be revoked, and would make the gate a fiction. Which
account holds a grant is backend data, not app code.

---

## 5. Scope limit — this is Zaptec-shaped

Everything verified here is one vendor, one model, one firmware
(`ZPR074002`, 3.3.4.5). The capability descriptor and transport client are
designed to be replaced per brand, but two things may not generalise and
should be re-opened with a second unit in hand:

- **The credential model itself.** Another manufacturer may have no local
  credential, or a rotatable one — which changes the storage and
  revocation rules, not merely the mapping.
- **Whether local control exists at all.** It is undocumented on Zaptec
  and may simply be absent elsewhere.

The protocol is also **undocumented by the vendor** and can change in any
firmware release. Every path must degrade to "settings unavailable" rather
than an error state, and the cloud path must be preferred whenever the
charger is online.
