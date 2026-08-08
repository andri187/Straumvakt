# ADR 0044 — Driver-side capabilities and the data they require

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Accepted in part — operator, 2026-08-03 (proposed 2026-08-03). D6/D7/D8 accepted; **D3 struck** (auth method IS recorded — see D6); D1/D2 deferred, they depend on ADR 0038's serving tier which does not exist yet.
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

---

## D6 — Correction: D3 was wrong, and the real gap is one column

**2026-08-03.** D3 above claims the authentication method is *"today
unrecoverable after the fact."* That is **incorrect**, and it was written
without reading the session table.

`charging.sessions` already carries the OCMF identification block:

```
auth_id_type    auth_id_value    auth_id_level
auth_id_status  auth_id_flags
```

These are OCMF's IT / ID / IL / IS / IF fields — the authentication
method, signed by the meter. For any session carrying OCMF the method is
not merely recorded, it is **cryptographic evidence**, which is stronger
than the enum D3 proposed to add.

`sessions.user_id` also already exists, so the owner is captured on the
session row rather than only resolvable by join. Two of the four
enrichments requested for the CDR were already present.

**D3 is therefore struck.** Do not add an authentication-method enum. The
remaining problem is coverage, not absence: sessions without OCMF have no
method recorded, and the answer there is the token reference below, not a
parallel enum.

### The actual gap

`charging.sessions` has **no `id_token_id`**. It holds `id_tag` — the
value as it arrived on the wire — and nothing pointing at the token row.
So the RFID **label** is reachable only by matching `id_tag` against
`id_tokens.value`, which breaks the moment a token is revoked, re-issued
or deleted. The CDR silently loses the label on exactly the historical
sessions a dispute would concern.

Driivz solves this by carrying **both**: `cardId` (row reference) and
`cardNumber` (value snapshot) on every transaction, with a `Card.status`
that includes `LOST` and `STOLEN` so a revoked card still resolves for
history. That is the pattern to copy.

**Decision:** add `charging.sessions.id_token_id → identity.id_tokens.id`,
nullable, **ON DELETE RESTRICT**. Restrict, not cascade — deleting a
token must never erase billing history. Keep `id_tag` alongside it as the
wire-value snapshot; the two answer different questions and neither
replaces the other.

With that one column the CDR resolves **label + hex + kind** by row
reference, and **name + kennitala** through `user_id`. All four
enrichments, one column.

**Not yet applied.** It is five parts — migration, backfill, both Prisma
schemas, and capture in `projections.ts` — and `projections.ts` is Rule 5
(CDR content is dispute evidence under ADR 0031 §15). The open question
inside it: resolve the token at **StartTransaction** (when the credential
was actually presented) or at **StopTransaction** (where a lookup already
happens). Start is correct.

### D7 — The creation-time vRFID is the app's identity, not its credential

**Operator, 2026-08-03:** *"the upon-creation RFID should be the
Straumvakt mobile app token, right?"*

Substantially yes, with one distinction that matters:

| | `virtual_rfid` | `app_jwt` |
|---|---|---|
| Wire | OCPP `idTag` | HTTPS `Authorization` |
| Length | ≤20 chars (CiString20Type) | hundreds |
| Lifetime | years — stable | hours — rotates |
| Answers | *who is charging* | *who is calling the API* |

A JWT **cannot** be an OCPP idTag; it does not fit in the field. So they
cannot be the same row.

But the intuition is right about what the vRFID is *for*. When a driver
starts a charge from the app, `RemoteStartTransaction` must carry an
idTag, and that idTag is **the driver's `virtual_rfid`**. The app
authenticates with the JWT, then acts as the vRFID. Authentication and
identification are separate steps, and the vRFID is the identification
half.

This is what makes D6 work: with `id_token_id` on the session, token
`kind` *is* the authentication method for non-OCMF sessions —
`virtual_rfid` means app-initiated, `rfid` means a physical card was
presented, `evccid` means Plug & Charge. No enum required, which is the
second reason D3 is struck.

It also means **every driver must have one**, including the four creation
paths that currently issue none (`invites.ts`, `host-invites.ts`,
`users.ts`, `admin-bootstrap.ts`). A driver without a vRFID cannot start
a charge from the app at all — there is nothing to put in the idTag.

### D8 — Token kind is the authentication method, in OCPP 2.0.1's vocabulary

**Operator, 2026-08-03.** The vRFID question is simpler than several
paragraphs above make it look, and the record should say so plainly:

> A driver needs a credential to hand the charger. The app's start button
> is the first one he has. Issue it at creation.

That is the entire justification. Every CPMS does this; it is not a
Straumvakt design question. The value is *"merely a hex string for
handshaking with the charger"* — its uniqueness is the only property that
matters, and `value @unique` already guarantees it.

**The `kind` carries the meaning: it identifies the authentication
method.** OCPP 2.0.1 standardised exactly this as `IdTokenEnumType`:

| OCPP 2.0.1 | Meaning | Straumvakt |
|---|---|---|
| `Central` | CSMS-authorised, no physical token — app remote start | `virtual_rfid` |
| `ISO14443` | MIFARE-class card | `rfid` |
| `ISO15693` | other RFID standard | — |
| `eMAID` | ISO 15118 Plug & Charge, contract certificate | **absent** |
| `MacAddress` | Autocharge, EV PLC MAC | **conflated into `evccid`** |
| `KeyCode` | PIN at the charger | — |
| `Local` | charger's local list | `manual` |
| `NoAuthorization` | free vend | — |

OCPP **1.6J has no equivalent** — `idTag` is an opaque CiString20. So the
classification must live on our side, and adopting 2.0.1's vocabulary now
costs nothing while inventing our own would cost a migration later. The
same reasoning applies to roaming: OCPI's `TokenType` (`RFID`,
`APP_USER`, `AD_HOC_USER`, `OTHER`) is the partner's classification and
must round-trip unchanged, so it belongs in a separate field on
`ocpi_token` rows rather than being folded into `kind`.

#### The decision: leave room for both, build neither yet

`evccid` today covers **both** Autocharge and Plug & Charge. They are not
the same authentication method:

- **Autocharge** matches the EV's PLC MAC address. No cryptography,
  spoofable, a convenience feature.
- **Plug & Charge** presents a signed ISO 15118 contract certificate.

On a disputed CDR under ADR 0031 §15 those carry very different
evidential weight, and right now they are indistinguishable after the
fact.

**Add both enum values now; implement neither.** Adding a value to a
Postgres enum is one additive line and is safe at any time. Renaming or
splitting one *after* sessions reference it is a data migration across
billing history. The cost asymmetry is the whole argument — this is
reserving the space, not building the feature.

`evccid` stays as a deprecated alias until its rows are reclassified;
nothing needs to happen to it on any deadline.

**Not in scope.** No ISO 15118 work, no certificate handling, no
Autocharge changes beyond what ADR 0036 already covers. Implementation is
deferred deliberately.

**Note the separate axis:** `charging.sessions.auth_id_type` already
carries OCMF's own IT field, signed by the meter. That is evidence of how
the *meter* saw the authentication; `id_tokens.kind` is what *we* issued.
They corroborate each other and neither replaces the other.

#### D8 amendment 2026-08-03 — OCPP 2.0.1 is the vocabulary, and detection already exists

**Operator: "we follow the OCPP 2.0.1."** `IdTokenEnumType` is therefore
the single naming authority. Everything else conforms to it rather than
translating between dialects.

`apps/api/src/lib/idtag-classifier.ts` was found *after* D8 was written
and already implements the distinction D8 proposed to reserve space for:

- `evccid_mac` — EV PLC modem MAC, 12 hex chars, with OUI vendor
  matching → OCPP `MacAddress` (Autocharge)
- `EMAID_PATTERN` — a real eMAID regex → OCPP `eMAID` (Plug & Charge)

It also carries a `Confidence` level (`high | medium | low`) that the
standard has no equivalent for, and which is genuinely useful: format
detection is a heuristic, and a low-confidence guess should not be stored
as though it were asserted.

**So the detection is built; only the persistence is missing.** The
earlier claim in D8 that Autocharge and Plug & Charge are "conflated"
holds at the enum layer only — the code distinguishes them today.

**Three vocabularies must be reconciled to one before any migration:**

| | Where | Role |
|---|---|---|
| `IdTagKind` | idtag-classifier.ts | what the code detects |
| `IdTokenKind` | both Prisma schemas | what gets stored |
| `IdTokenEnumType` | OCPP 2.0.1 | **the authority** |

Writing D8's enum values without reading the classifier would have
created a second competing taxonomy — the same three-generations pattern
seen in the billing layer, reproduced in miniature. Read the classifier
first; the migration follows from the mapping, not the other way round.

**Open, and to be settled by that reading:** where `zaptec_proxy` and
`ocpi_token` land. Neither is an OCPP authentication method — the first
is a vendor artifact, the second is a roaming provenance marker whose
OCPI `TokenType` must round-trip unchanged. Both may belong on a separate
axis from `kind` rather than as values within it.
