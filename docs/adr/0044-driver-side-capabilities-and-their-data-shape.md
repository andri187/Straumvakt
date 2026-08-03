# ADR 0044 — Driver-side capabilities and the data they require

**Status:** Proposed — 2026-08-03.
**Relates to:** [ADR 0020](./0020-driver-access-via-driver-groups.md),
[ADR 0024](./0024-ble-proximity-authentication.md),
[ADR 0031](./0031-cost-model-and-money-flow.md),
[ADR 0036](./0036-autocharge-vehicle-identity.md),
[ADR 0038](./0038-read-serving-tier-and-state-propagation.md),
[ADR 0042](./0042-real-driver-identity-and-tap-attribution.md),
[ADR 0043](./0043-homeless-driver-and-join-paths.md).

---

## Context

The mobile app is introducing capabilities that the domain model does
not yet express. Recorded now, because each one becomes a schema
decision the moment it ships, and app-side improvisation is how a data
model acquires shapes nobody chose.

Operator, 2026-08-03:

- charger **settings** access is bound to charging access — a **PIN
  stored on the driver's device** per charger they can use; losing
  charging access loses settings access
- a driver must **not** reach settings on a charger with a connected
  vehicle and an ongoing session **unless the session is theirs**
- the **tap/auth method must be bound to the app user**, and **the
  authentication method must be logged on the CDR**
- the app will introduce a **driver vehicle with a registration number**

---

## Decision

### D1 — The device PIN is a convenience factor, never the authority

The PIN lives on the phone, which means **revocation cannot rely on
removing it** — by the time access is revoked the secret is already on a
device outside our control.

So: settings authority is **derived from the access grant at the moment
of use**, server-side. The PIN is a local unlock — it proves the phone's
holder is the phone's owner, nothing more. It never carries the grant
itself.

This is the same rule ADR 0043 applies to join codes and ADR 0038 applies
to pushed state: *the token is a hint, the server check is the truth.* A
cached capability that outlives its grant is the failure mode every one
of those decisions exists to avoid.

Concretely: losing the DriverGroupMembership must revoke settings access
**immediately and server-side**, whether or not the app ever deletes the
PIN. The app deleting it is hygiene, not enforcement.

#### D1b — Remote wipe is defence in depth, not the control

**Operator, 2026-08-03:** a self-destruct method for the stored PIN will
follow, for the case where a device goes rogue.

Right thing to build, and it must not be mistaken for the revocation
path. A remote wipe is **best-effort by construction**: the device may
be offline, may have network blocked, may be rooted with the wipe
disabled, or may simply never open the app again. Every one of those is
exactly the case where you most want the access gone.

So the two layers stack, and only one of them is load-bearing:

| layer | guarantees |
|---|---|
| server-side grant check (D1) | **access is gone immediately**, whatever the device does |
| remote wipe | the secret stops sitting on hardware you do not control |

The wipe reduces the blast radius of a stolen phone. It does not decide
whether charging or settings are permitted — that stays server-side, and
must keep working with the wipe never delivered.

**Prerequisites, both already on the roadmap and both unbuilt:** you
cannot wipe a device you do not know about, so this needs the **device
registry (ADR 0030, GOING_PUBLIC P6.3)**, and a delivery channel, which
is **FCM/APNs push (P6.2)**. Neither exists yet.

**Trigger set — wider than "stolen".** The obvious trigger is a driver or
support reporting a lost device. The one that matters more is automatic:
**revoking a DriverGroupMembership should enqueue a wipe for that
driver's devices.** A driver who leaves an org is the common case; a
stolen phone is the rare one. If the wipe is only ever manual, the common
case leaves PINs on devices indefinitely — harmless because of D1, but
needless.

*"No settings while someone else's session is active"* is **not** an
access-grant rule. It cannot live in a membership, because it depends on
who is charging **right now**.

It is a check against live connector and session state at request time:

```
settings_allowed = has_grant(driver, charger)
                   AND (no_active_session(charger)
                        OR active_session.driver == driver)
```

The second clause is Hot-tier data in [ADR 0038](./0038-read-serving-tier-and-state-propagation.md)'s
terms — the `IdentityDurableObject` already holds it at the moment it
changes. Reading it from Postgres would answer with whatever the last
projection wrote, and a settings gate that is seconds stale is a settings
gate that opens mid-session.

**Failure direction matters:** if live state is unavailable, **deny**.
An unreachable answer must not read as "no session in progress" — that
is precisely the case where someone else is plugged in and the system
cannot see it.

### D3 — Authentication method belongs on the session and the CDR

[ADR 0031 §15](./0031-cost-model-and-money-flow.md) settles metering
disputes on Straumvakt's logs. *"How was this session authorised"* is
squarely dispute-relevant — and today it is not recorded at all.

A typed enum on the session, carried into the CDR:

| value | source |
|---|---|
| `rfid` | physical card idTag |
| `app_remote` | RemoteStart from the app |
| `app_tap` | phone tap resolved via tap-intent |
| `ble_proximity` | ADR 0024 |
| `autocharge` | EVCCID / PLC MAC, ADR 0036 |
| `free_vend` | no authentication required |
| `unknown` | pre-dating this field, or unresolved |

Typed, not free text — this feeds dispute evidence and eventually
fraud analysis, and a string column becomes eight spellings of the same
thing within a year.

`unknown` is deliberate: the 46 existing sessions cannot be
retro-classified beyond "an idTag matched", and inventing a value for
them would be worse than admitting the gap.

**This is the field that makes ADR 0042's attribution work legible.**
Knowing a session belongs to a driver is half the answer; knowing *how
they proved it* is what a dispute actually turns on.

### D4 — Vehicle registration number joins technical to legal identity

A vehicle is already identified technically — EVCCID / PLC MAC via OCMF
(ADR 0036), with `/vehicles/[mac]` as the console surface. A
registration number is a **different kind of identifier**: the legal one,
tied to a keeper in the national registry.

Both are needed and they must stay distinguishable:

- **MAC / EVCCID** — what the charger observes. Reliable, meaningless to
  a human.
- **Registration number** — what the driver recognises. Human-entered,
  therefore unverified unless checked against a registry.

Treat the plate as **driver-asserted** until verified, exactly as
kennitala is treated in [ADR 0043 D3b](./0043-homeless-driver-and-join-paths.md).
Do not let a typed plate imply ownership.

**Privacy:** a registration number tied to a named person is personal
data. It should not appear in operator-facing views that do not need it,
and it must be covered by the same retention and erasure paths as the
driver record.

### D5 — App-introduced concepts land in the domain model first

The meta-decision, and the reason this ADR exists. Each capability above
implies schema — an enum, a column, a live-state read, a new entity.
When the app ships one first and the backend catches up, the model
inherits whatever shape was convenient in Dart.

`tap_intents` is the live example: it shipped with **zero foreign keys**
and an `org_id` that is written but never filtered on (schema audit,
finding 2). Not because anyone decided that — because it arrived from
the app side.

So: these land as schema and API first, app second.

---

## Consequences

**Positive.** Settings access cannot outlive charging access. The
settings gate cannot open during someone else's session. Disputes gain
the authentication method, which today is unrecoverable after the fact.
Vehicles gain a human-legible identity without conflating it with the
technical one.

**Negative.** D2 makes the settings gate depend on Hot-tier state that
does not exist yet — until ADR 0038's serving tier lands, the honest
implementation reads live state from the DO directly or denies.

**Sequencing.** D3 is the cheapest and most urgent: it is one enum plus
one column, it is additive, and **every session recorded without it is
permanently unclassifiable**. Every day it waits costs data that cannot
be reconstructed.

D1 and D2 gate the settings feature itself. D4 can follow the app.

**Rule 5.** D1 and D2 are access-grant resolution. D3 touches CDR
content, which is dispute evidence under ADR 0031 §15. All three want
stop-and-summarise before code.
