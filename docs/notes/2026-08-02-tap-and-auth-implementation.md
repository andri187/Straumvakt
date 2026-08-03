# Tap & Auth tap-to-charge — bench findings + implementation plan

**Date:** 2026-08-02
**Hardware:** Zaptec Pro `ZPR074002` (Zaptec name "2305", id `9c3f3855-7877-4d47-91c6-72a09f540139`,
installation "Andri Þór Arnarsson" `06294736-…`), Samsung Galaxy S25 Ultra `SM-S938B`
(Android 16 / SDK 36), Fluke FEV300 EV simulator.
**Supersedes the HCE assumptions in** ADR 0024 addendum (2026-06-07).

---

## 1. What was measured

Everything below is from the bench, not from documentation.

### 1.1 A phone tap is anonymous, always

Nine taps produced nine distinct idTags:

```
085ACDF6  0831541B  084E1600  08C03B19  0860D1D9
080CD5C4  085C2D5D  080E4E80  086884C6
```

All begin `08`. ISO/IEC 14443-3 reserves a leading `0x08` for randomly generated
single-size UIDs; NXP MIFARE products begin `0x04`. Both Android and iOS card
emulation regenerate the UID on every activation, and **no API on either platform
can set it**.

The charger's own signed OCMF record confirms the read type:

```
"IT":"ISO14443","ID":"085ACDF6"
```

**Consequence: a phone can never present a stable identity to a charger's reader.**
Enrolling a phone as an `IdToken` is impossible. The tap is a presence event and
nothing more.

### 1.2 The charger's reader is UID-only

Activation-to-deactivation was **10–13 ms** across every tap. A `HostApduService`
was built and installed (`TapProbeService`, registered for the NFC Forum NDEF AID
`D2760000850101`, PPSE and PSE, `requireDeviceUnlock=false`) and **never fired** —
no `SERVICE_CREATED`, no `APDU_IN`. The reader completes anticollision, takes the
UID, and drops the link without sending a SELECT.

There is therefore no APDU channel to carry a credential, on any platform.

### 1.3 The phone cannot detect its own tap (Android)

Three hooks, all closed:

| hook | result |
|---|---|
| HCE service with registered AIDs | never invoked — no SELECT AID sent |
| Observe mode / `processPollingFrames` | `mIsObserveModeSupported=false` on SM-S938B |
| `RF_FIELD_ON_DETECTED` broadcast | privileged, unavailable to normal apps |

So "trigger a BLE read from the tap" is not implementable app-side. **The tap can
only be observed by the charger.**

### 1.4 A tap requires a connected vehicle

Taps into CP state A produced nothing anywhere. With the Fluke presenting a cable
(state B, PP 13 A) every tap registered. `710 ChargerOperationMode` must be ≥ 2.

### 1.5 Zaptec's own app does NOT tap

Under `AuthenticationType=2 (Ocpp)` our gateway was accepting everything, which
made phone taps look like they worked. Switching the installation to **Native**
made the mechanism visible:

```
17:26:33  722 → "nfc-08B5CC4E"     phone tap #1 → cleared 6s later, DENIED (red)
17:26:46  722 → "nfc-08DA2C4F"     phone tap #2 → cleared 6s later, DENIED
17:27:09  722 → "ble-72277cdb-…"   in-app button → session in 2s, charging in 4s
```

The charger namespaces the source: `nfc-` for a card read, `ble-` for the app path.
The Zaptec app holds **no `android.permission.NFC`** and registers **no HCE
service** — it cannot use NFC in any mode. Its "tap" is BLE identification plus a
button press, and no GATT connection to the charger appears during the authorize,
so proximity is asserted by the client and taken on trust by the cloud.

Also worth knowing: the BLE-authorized session's `CompletedSession` carries
`"AuthenticationCode": null` and the OCMF has no `IT`/`ID` fields at all. **Zaptec's
own app path produces a legally-relevant meter record with no identity in it.**

### 1.6 The idTag reaches our resolver, live

All nine taps landed in `charging.sessions` with the raw UID as `id_tag`, station
`2440557c-d1f4-41d0-972e-c7b94707fd85`, **8–38 s after the tap**, with **no
`imported_cdr_refs` row** — so via `lib/ocpp/projections.ts`, the live OCPP path,
not the Zaptec importer. `user_id` is NULL on all nine.

This is the finding the whole design rests on.

### 1.7 iOS is untested and the docs are silent

Apple documents `CardSession` (entitlement-gated, ISO 7816 / AID-based) and reader
mode. It documents **nothing** about what an iPhone presents to an unrecognised
reader. The developer-forum thread asking exactly this has zero replies. Apple's
ECP research is third-party reverse engineering.

One documented data point: [kormax/apple-device-as-access-card](https://github.com/kormax/apple-device-as-access-card)
shows that with a **China T-Union transit card** set as the Wallet default, an
iPhone "stops randomizing the UID on each tap" and "begins responding to all NFC
readers as if they were express-transit enabled". So the hardware is capable; the
gate is Apple policy, and the switch that disables it is not something a product
can require of users.

**Open test:** hold any iPhone against `ZPR074002` and watch observation `722`.
`nfc-…` appears → the design is cross-platform. Nothing → Android-only.

---

## 2. Architecture

**The tap is proof of presence. The app is proof of identity. The server joins them.**

```
1. app  : BLE sees charger serial at tap-strength RSSI, sustained
2. app  → POST /api/driver/tap-intent { serial, rssi, deviceHandle }
          server resolves serial → station, checks driver access, stores intent (TTL 120s)
3. driver taps phone on the charger's RFID reader
4. charger → OCPP Authorize(idTag=08XXXXXX) on its OWN connection
5. server: idTag looks like a random UID → find live intents for THIS station
          exactly one → consume it, authorise as that driver
          zero or more than one → no match, fall through / deny
```

Why this is sound:

- **Identity** comes from the bearer token, server-side. The phone never claims a
  driver id.
- **Which charger** comes from the OCPP connection the Authorize arrived on. Not a
  client claim.
- **Physical presence** comes from the charger's own reader. A phone cannot forge
  a charger's report.

**Scale.** The join is keyed on station, never on device. With 10 000 drivers the
lookup still returns 0–1 rows, because the question is "who is standing at this one
charger right now". Fleet size never enters it.

**Vendor generality.** `Authorize.req` is OCPP 1.6 core, so any OCPP charger with an
RFID reader participates with no per-vendor work. BLE is used only to name the
charger in the app; it is not on the authorisation path. Other brands are assumed
to behave the same and remain to be tested.

**iOS.** Until the iPhone test is run, iPhone users get the in-app button — which is
exactly what Zaptec gives *every* user today. NFC tags on chargers remain the
fallback if iPhones turn out not to present anything, but they are **not** required
to ship.

---

## 3. What is built

| file | status |
|---|---|
| `apps/api/src/lib/tap-intent/random-uid.ts` | **new** — `08`-prefix classifier, pure/testable |
| `apps/api/src/repositories/tap-intents.ts` | **new** — arm/refresh/cancel/match+consume, access resolver |
| `apps/api/src/routes/public/driver-tap-intent.ts` | **new** — POST / GET / DELETE |
| `apps/api/src/routes/public/driver.ts` | edited — `requireDriver` exported |
| `apps/api/src/index.ts` | edited — mount before the `/api/driver` catch-all |
| `prisma/schema.prisma`, `apps/api/prisma/schema.prisma` | **new model** `TapIntent` |
| `prisma/migrations/20260802190000_tap_intents/` | **written, NOT applied** |
| `mobile-app-driver/lib/tap_intent.dart` | **new** — arm/refresh/disarm lifecycle |
| `mobile-app-driver/lib/api.dart` | edited — `armTapIntent` / `disarmTapIntent` |

`npx tsc --noEmit` clean; `flutter analyze` clean on both Dart files.

Nothing built so far is on the access-grant path. Arming grants nothing.

---

## 4. Rule 5 stop — the resolver hook (NOT written, needs approval)

This is the one change that alters access-grant resolution.

**What it does.** In `resolveAuthorize` (`routes/internal/ocpp-authorize.ts`),
before the `IdToken` lookup:

```ts
if (isRandomEmulatedUid(input.idTag) && installationId) {
  const match = await matchAndConsumeTapIntent(db, chargingStationId, input.idTag);
  if (match.kind === "matched") {
    return { verdict: "Accepted", reason: "tap_intent", userId: match.userId, enforceAuthorize };
  }
  if (match.kind === "ambiguous") {
    return { verdict: "Blocked", reason: "tap_intent_ambiguous", enforceAuthorize };
  }
  // "none" falls through to the normal IdToken path
}
```

Needs `chargingStationId` added to the existing identity lookup — it is already
joined for `installationId`, so no extra query.

**What breaks.** Nothing, under `enforceAuthorize=false`: the gateway ignores the
verdict and replies Accepted regardless, so behaviour at every installation is
unchanged until an operator opts in. New `AuthorizeReason` values need adding to
the union.

**Why it is correct.** The intent is created only after the same access check the
resolver applies (`resolveDriverStationBySerial` mirrors ADR 0019 A.11 exactly), so
an intent can never authorise a charger the driver couldn't already use — it cannot
become a privilege-escalation path. Consumption is a conditional `UPDATE` guarded on
`consumed_at IS NULL`, so a concurrent race yields one winner and the loser fails
closed. Ambiguity fails closed. The `08` heuristic is safe in the false-positive
direction: a real card matching it merely triggers a lookup that finds nothing and
falls through.

**Residual risk.** An attacker who arms at a charger they are not at can capture the
next legitimate tap there. Bounded by the 120 s TTL, single-use consumption, the
server-side RSSI gate, and prompt disarm on BLE loss. Not eliminated. Mitigation if
it matters: require a fresh in-app confirmation for the first tap at a charger the
driver has never used.

**Decisions needed:** (a) approve the hook, (b) TTL — 120 s proposed, (c) whether
ambiguity should Block or fall through silently, (d) whether to flip
`enforceAuthorize` on the bench installation.

---

## 5. Remaining work

1. Resolver hook (above) — gated on approval.
2. Apply the migration — staging branch `br-tiny-river-abgpqq37` first.
3. Wire `TapIntentController` into the driver app UI (`bind()` to the existing
   `BleTapScanner.hits`, show armed state, haptic on session start).
4. Unit tests: `random-uid.ts` (the nine observed UIDs + real 4-byte and 7-byte card
   UIDs as negatives), `tap-intents.ts` (ambiguity, expiry, double-consume race).
5. Remove `TapProbeService` from the driver app, or keep it to probe other brands.
6. `enforceAuthorize` is still **false** on installation `06294736-…` — that
   installation currently accepts anything tapped at it.

---

## 6. Hardening test plan

Runs against the bench charger with the Fluke supplying CP state B.

### 6.1 Multi-driver, multi-device (the attribution suite)

Two Android devices, two **different cloud driver accounts**, both with access to
the same installation.

| # | setup | expect |
|---|---|---|
| H1 | Driver A armed, A taps | session attributed to **A** |
| H2 | Driver A armed, **B taps** | session attributed to **A** — proves the tap carries no identity, and is why the arming window must be short |
| H3 | A and B both armed at same charger, either taps | **ambiguous → denied**, both fall back to the button |
| H4 | A armed at charger X, taps at charger Y | no match at Y (intent is station-scoped) |
| H5 | A armed, walks out of BLE range, then taps | disarmed on BLE loss → no match |
| H6 | A armed, waits > TTL, taps | expired → no match |
| H7 | A armed, taps twice in quick succession | first consumes, second finds nothing |
| H8 | A armed, B armed at a *different* charger, both tap | each attributed correctly |

H2 is the one that matters most: it demonstrates the residual hijack risk
concretely, and its blast radius is exactly the TTL.

### 6.2 Device diversity

Repeat H1 across at least three Android devices of different vendors and OS
versions (the fleet will not all be S25 Ultras). Record for each: does the charger
log an `nfc-08…`, how long does activation take, does the UID always start `08`.
A device that presents a **stable** UID would be a finding worth knowing about.

### 6.3 Access control

- Driver with no membership at the installation arms → **403 no_access**.
- Membership revoked *after* arming, then taps → resolver must still deny (the
  agreement gate runs at authorize time, not arm time).
- Arm with `rssi = -70` → **409 too_far**.
- Arm for an unknown serial → **404**.

### 6.4 Concurrency

Fire two simultaneous authorize requests against one live intent (two chargers on
the same station, or a scripted double-call). Exactly one must win.

### 6.5 iOS

Any iPhone, tap on `ZPR074002`, watch `722`. Record: does anything appear, is Face
ID required, is the UID `08`-prefixed, does it change between taps.

---

## 7. Tools used (reusable)

Scratchpad scripts from the session — worth keeping if this is revisited:

- `zaptec-watch.mjs` — polls `/api/chargers/{id}/state` every 2 s, prints only
  changes, flags the tap-relevant observation ids. This is what made every finding
  above visible.
- `zaptec-recent.mjs` — one-shot state dump sorted by observation age.
- `zaptec-probe2.mjs` — charger detail + decoded observation names.

Relevant observation ids: `722` ChargerCurrentUserUuid, `721` SessionIdentifier,
`710` ChargerOperationMode, `750` NewChargeCard, `725` RejectedUserUuid,
`751` AuthenticationListVersion, `752` EnabledNfcTechnologies.

---

# Addendum — 2026-08-03 — Charger settings over local BLE

Built in `apps/mobile` (the single canonical Flutter tree). Live against
hardware, not a preview: every value is read from the charger, nothing is
hardcoded, and a characteristic the firmware does not expose is hidden
rather than greyed.

## Credential model — the PIN belongs to the access right

The driver **never knows, sees or types the PIN**. It is an attribute of
the access grant, not of the person or the device:

| step | behaviour |
|---|---|
| Driver gains access to a charger | backend releases that charger's PIN to the **device** |
| Storage | `flutter_secure_storage` — Android EncryptedSharedPreferences under a non-exportable **Keystore** key; iOS **Keychain** (`first_unlock_this_device`) |
| Use | `ChargerPinStore.use(serial, action)` hands it to a callback — it never enters a widget, a log, or an error message |
| Access revoked | `reconcile(accessibleSerials)` drops the PIN on the next charger-list sync |
| Device offline | `kPinCacheTtl` (7 days) is the backstop revocation cannot reach |

**Why this needs more care than a normal credential:** the Zaptec PIN is
factory-set, printed on the box, and **cannot be rotated**. Caching it is
therefore a permanent grant — no rotation story exists, and the only true
remedy is replacing hardware. Hence: bind to the grant, reconcile on sync,
TTL as backstop, and never expose it upward.

## Access rules implemented

- **No settings on a charger someone else is using.** `preparing`,
  `charging`, `suspendedEv/Evse`, `finishing` all count as in use;
  allowed only when the running session's connector is the driver's own.
  **Fails closed** on any uncertainty — unreachable API, charger not in
  the driver's list, unparseable state.
- **Advanced settings are locked by default** and require approval from a
  host-admin or the CPO. Network re-provisioning, current limits, PLC keys
  and MID test mode can strand a charger; they are not a driver
  capability. The grant check returns `locked` for anything it cannot
  determine, and when locked the app **does not even read** the
  characteristics.
- **Restart is the only top-level action**, since that is what a driver at
  a dead charger came for. Everything else sits behind the collapsed
  Advanced section.

## Not built — backend, Rule 5

Both of these are access-grant resolution and need the stop-and-summarise
pass before code:

1. `GET /api/driver/chargers/{serial}/ble-pin` — privilege-gated release,
   audited per fetch. Until it exists the client falls back to a
   **kDebugMode-only** bench entry, which must be deleted when it lands.
2. `GET|POST /api/driver/chargers/{serial}/advanced-grant` — the approval
   a host-admin or CPO gives, and the driver's request for it.

Until both exist the client-side guards are UX, not security: a device
already holding a cached PIN is bounded only by reconcile-on-sync and the
TTL. Recorded deliberately, not overlooked.

## Owed

- **Self-destruct on inactivity** (operator, 2026-08-03): expire a
  driver's charger rights — and with them the PIN — after a period of
  disuse, independent of explicit revocation.
- Delete the `kDebugMode` PIN entry branch when the release endpoint ships.

## Scope decision, 2026-08-03: iOS is parked

Android only until the operator says otherwise. Nothing about the iOS path
is to be designed, built, or raised as a blocker in the meantime.

This is a scope decision, not a technical conclusion — the constraint that
prompted it still stands and will still be there when iOS comes back:
an iPhone emits nothing to a plain UID reader without an Apple-approved
entitlement, so an iOS trigger has to be BLE proximity plus a confirm
rather than a tap.

The server-side model is unaffected either way. Arming an intent and
resolving it in the OCPP `Authorize` path is trigger-agnostic — a tap, a
BLE confirm or anything else just arms the same intent. So parking iOS
costs nothing structurally.
