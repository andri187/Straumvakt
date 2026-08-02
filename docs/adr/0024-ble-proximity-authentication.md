# ADR 0024 — BLE-proximity authentication

**Status:** Direction set — see **Addendum 2026-06-07** (tap-to-start
architecture: NFC-tap primary, BLE discovery + anti-spoof cross-check,
Autocharge for hands-free regulars). Full threat-model formality + build
milestones tracked there. Original body below preserved for context.
**Created:** 2026-05-13
**Triggered by:** "lets implement BLE auth now" conversation (2026-05-13
~01:30 UTC). Caught at design stage because of Rule 5 stop on access-
grant changes. ADR written to preserve context; implementation lands
in a focused session, not at 01:30.

## What exists today

Mobile app (`apps/mobile/lib/ble/scanner.dart`, `nearby_card.dart`,
`home.dart`):

- Continuous BLE scanning while foregrounded
- Matches `bleAdvertisingId` from `/api/driver/chargers` response
  against discovered devices
- RSSI → distance via log-distance model, Zaptec-tuned (Sprint 9.X)
- "Tap" threshold = < 5 cm
- Twin-pole / multi-charger disambiguation via picker sheet

Schema + API:

- `ChargingStation.ble_advertising_id` + `ble_advertising_kind`
  (`zaptec_serial` / `ibeacon_uuid` / `mac`)
- Driver API returns these so the app knows what to scan for
- Dalvegur chargers have IDs provisioned (per
  `apps/api/scripts/probe-dalvegur-tap-readiness.ts`)

**No server-side BLE attestation today**. The mobile-detected tap is a
UX shortcut for "which charger should I tap on the list", not an auth
gate. Session-start trust model is purely: driver session token →
User → Agreement → DriverGroup → Membership.

## Threat models to choose between

The right implementation depends entirely on which threat we're
defending against. List, weakest threat first:

1. **Accidental remote start** — driver opens app, taps a charger from
   the list while not actually there, session starts at a remote
   location. Possible today; harmless because they'd see no power
   flowing and stop. Mostly a UX failure.

2. **Bad-faith remote start by authenticated driver** — driver
   intentionally starts a session at someone else's charger they have
   access to, to e.g. trigger an alert that's not theirs. Same vector
   as (1), different intent.

3. **Token replay** — attacker captures a driver's session token and
   starts a session remotely. Defeated by session-token expiry
   (existing), but BLE could be a second-factor.

4. **Spoofed BLE proximity** — adversary fakes BLE attestation from a
   distance to make it look like they tapped. Requires breaking
   whichever attestation scheme we pick.

5. **Compromised mobile device** — rooted phone with attacker tooling
   can sign anything the legit app can sign. Fundamentally outside
   what BLE auth can defend against; needs hardware attestation
   (Android Keystore / iOS Secure Enclave attestation API), which is
   a separate workstream.

For pilot scale (~20-50 trusted drivers at one customer), threats 1-3
matter, 4-5 are overkill.

## Design options

### A. Mobile-signed attestation

```
On BLE tap, mobile captures:
  { deviceId, rssi, mobileTime, nonce }
  signs with HMAC using a key derived from the driver session token
  POSTs as X-Tap-Attestation header alongside POST /api/driver/sessions/start
Server validates:
  signature, mobileTime freshness (< 60s window), deviceId matches
  charger.ble_advertising_id, nonce not seen recently.
```

**Defends against:** (1), (2), (3) — server requires fresh proof the
mobile app was at the charger.
**Doesn't defend against:** (4), (5) — rooted phone can spoof everything.
**Implementation cost:** ~1 day (mobile signing helper, server endpoint
validation, replay-protection store).
**Trust shape:** "the mobile app says we tapped, signed under the
driver's session-token-derived key."

### B. Server-driven nonce via OCPP DataTransfer

```
1. Server pushes nonce to charger via OCPP DataTransfer
2. Charger broadcasts nonce in BLE advertising packet
3. Mobile detects nonce, sends back to server with session start
4. Server validates nonce, single-use
```

**Defends against:** (1), (2), (3), (4) — real proximity proof from a
trusted charger.
**Doesn't defend against:** (5) — rooted phone could still inject the
nonce remotely if intercepted.
**Implementation cost:** Multi-week investigation. Zaptec firmware
support for dynamic BLE-nonce broadcasting is unverified; might need a
vendor DataTransfer extension. Possibly impossible without firmware
changes we don't control.
**Trust shape:** "the charger and the mobile both attest the nonce."

### C. Audit-only metadata (no auth)

```
Mobile attaches tap_metadata = {deviceId, rssi, ts} to session start.
Server stores as JSONB on ChargeSession.tap_metadata.
No enforcement — purely forensic.
```

**Defends against:** Nothing in real-time. But provides post-hoc
detection: query for "session started but no tap metadata" or "tap
timestamp diverges from session start by > 5 min".
**Implementation cost:** ~4 hours (schema column + mobile change +
backfill column nullable).
**Trust shape:** "we record what happened, don't enforce."

### D. ISO 15118 Plug & Charge

```
Car presents a contract certificate via PLC; charger verifies via
its own PKI; CSMS gets the verified UserId.
```

**Defends against:** Everything BLE could, at the protocol level.
**Doesn't defend against:** Cars that don't support PnC (most older
EVs), chargers without firmware support.
**Implementation cost:** Months — requires CertSubCA, vehicle-side
support audit, OCPP 2.0.1 (we're on 1.6 + OCMF), Zaptec PnC firmware
verification.
**Trust shape:** Industry-standard, hardware-rooted.

## Decision matrix

| Threat covered | Option A | Option B | Option C | Option D |
|---|---|---|---|---|
| (1) Accidental remote start | ✓ | ✓ | partial (audit) | ✓ |
| (2) Bad-faith remote start | ✓ | ✓ | partial | ✓ |
| (3) Token replay | ✓ | ✓ | — | ✓ |
| (4) Spoofed proximity | ✗ | ✓ | — | ✓ |
| (5) Compromised device | ✗ | ✗ | — | partial |

## Open questions before implementation

1. **What threat model are we actually defending?**
   Realistic pilot answer: (1), (2), (3). Recommends Option A.

2. **What's the failure mode of a missing/invalid attestation?**
   - Hard fail: reject session-start (better security, worse UX)
   - Soft fail: allow session-start but log + alert (better UX, weaker)
   - Gradual rollout: hard fail at staging, soft at pilot, hard at
     production after soak

3. **What key does the mobile sign with?**
   - Key derived from driver session token via HKDF — simple,
     rotates with session
   - Hardware-attested key from Android Keystore / iOS Secure Enclave
     — stronger but more code
   - Decision affects implementation cost

4. **Replay protection**
   - Server-side cache of recent nonces (Cloudflare KV / Durable Object)
   - 60s freshness window + single-use nonce
   - Cache size bounded by active driver count

5. **What happens on BLE-disabled phones / OS denies BLE permission?**
   - Soft path: fall back to no-attestation, allow session-start with
     audit warning. Else: lock out users who refuse permission.

6. **iOS vs Android quirks**
   - iOS background BLE scanning is significantly restricted
   - Android needs Bluetooth + Location permission
   - Both add UX friction

## Out of scope for this ADR

- Hardware attestation (Android Keystore / iOS Secure Enclave) —
  separate Sprint after Option A ships if needed.
- Plug & Charge (Option D) — industry-standard but multi-month, gated
  on hardware support audit.
- BLE-based passive presence detection (no active tap, just "you're
  near a charger") — different UX, deferred.

## Sketch of Option A implementation (when we're ready)

```
1. Schema: add `tap_attestations` table with TTL 60s
   (cloudflare-queue + DO for replay protection; not Postgres)

2. Mobile (apps/mobile/lib/ble/tap-attestation.dart):
   - On tap event with rssi within threshold + driver session active
   - HKDF(session_access_token) → 32-byte HMAC key
   - body = {deviceId, rssi, ts, nonce: randomUUID()}
   - sig = HMAC-SHA256(body, key)
   - attach as X-Tap-Attestation: base64(body+sig) header on session-start

3. Server (apps/api/src/routes/public/driver-sessions.ts):
   - Parse X-Tap-Attestation header
   - Derive HMAC key from session token
   - Verify signature
   - Verify ts within 60s of now
   - Verify deviceId matches the charger's bleAdvertisingId
   - Verify nonce not seen recently (DO check)
   - Reject session-start on any failure (or log+allow during rollout)

4. Tests: unit (sig verification edge cases), integration (mobile +
   API round-trip in dev fixture).

5. Rollout: staging hard-fail, pilot soft-fail with audit, prod hard-
   fail after 30 days of clean staging.
```

## Decision

**Not made.** Implementation deferred to a fresh session where the
threat model can be discussed without late-night fatigue. ADR
preserves context.

When re-opened, decide:
- Threat model (1-5 above)
- Option (A / B / C / D)
- Failure-mode semantics (hard / soft / gradual)
- Mobile key shape (session-derived vs hardware-attested)

---

# Addendum — 2026-06-07 — Tap-to-start architecture (decision + field test)

Re-opened on hardware. Goal restated by operator: **driver brings the phone
into proximity of a charger and a charge starts, with a "tap" feel, on both
iOS and Android.** This addendum records (a) what we measured on real
hardware, (b) the cross-platform feasibility walls, and (c) the chosen
architecture. **Best practice and decided. No QR.**

## A. Field test — Zaptec ZPR074002 (Dalvegur), Samsung A21s / Android 12

Tested with the real driver app (`apps/mobile`, pkg
`is.straumvakt.straumvakt_app`) reading the charger's live BLE advertisement.

**Confirmed:**
- The Zaptec **advertises its serial in the BLE localName** — `ZPR074002 2305`
  (serial + a trailing rev suffix). MAC `60:15:92:40:0E:62`.
- **100 % serial capture** — 37/37 advertisements over a 5 s window carried the
  serial; **0 nameless**. So serial-by-name matching is reliable and
  cross-platform (iOS sees localName too).
- **RSSI ↔ distance calibration** (this unit; varies per model/orientation):

  | Phone position | RSSI |
  |---|---|
  | On it / touching | ~-29 to -31 (noisy, ±8 dB while moving) |
  | 10 cm | -29 (stable) |
  | 30 cm | -40 |
  | 1 m | -49 |

- **The first ~10 cm is flat** (0/2/10 cm all read -29 — near-field
  saturation). So **BLE-RSSI cannot resolve sub-10 cm**; combined with ±8 dB
  jitter, the reliable BLE proximity floor is **~10-15 cm**, not <5 cm.

**Bugs found + fixed in `apps/mobile/lib/ble/scanner.dart`:**
1. `_requestPermissions()` required `locationWhenInUse`, which on API 31+
   resolves to "no manifest entry" (location is capped `maxSdkVersion=30`,
   `BLUETOOTH_SCAN` is `neverForLocation`) → scan silently never started.
   Fixed: gate on `bluetoothScan`.
2. `startScan(timeout: Duration(seconds: 0))` was read as "scan 0 s" →
   stopped instantly → zero results, no error. Fixed: no timeout +
   `continuousUpdates: true`.
3. Default low-power scan batched delivery (one burst then silence). Fixed:
   `androidScanMode: AndroidScanMode.lowLatency`.
4. **Still open:** Android stops long-running scans after ~60 s — needs a
   **scan keep-alive watchdog** (restart-on-stale). This is the remaining
   real bug for any BLE-driven feature.

## B. Cross-platform feasibility walls (the hard constraints)

- **BLE proximity floor ≈ 10-15 cm** (measured) — cannot be the <5 cm gate.
- **NFC is ~4 cm by physics, deterministic** (no jitter, no smoothing) — it is
  the precise/reliable proximity signal, but it requires an NFC **target** the
  phone can read; the Zaptec is a card *reader*, not a tag, so a **passive NFC
  tag must be added per charger**.
- **The "locked, screen-off, no-app" Apple-Pay tap = card emulation only.**
  iOS reserves it for Wallet; **third-party HCE is blocked on iOS**. So
  "locked + not-a-card + cross-platform" is **impossible**.
- **iOS NFC tag reading** works background/no-app on **iPhone XS+ (iOS 13+)**
  but only while **unlocked**; NDEF **URL/Universal Link** auto-launches the
  app (no scan sheet).
- **Background BLE wake** (closed app, on approach): iOS filters by **service
  UUID only** (not name); Android needs a foreground service or a
  `PendingIntent` scan. Coarse (metres), not <5 cm.

## C. Decision — the architecture

**Primary, cross-platform — NFC-tag tap (best practice):**
- One **on-metal NFC tag per charger** (NTAG21x; metal detunes standard tags).
- NDEF payload = **Universal Link / App Link URL carrying the serial**:
  `https://straumvakt.org/c/<serial>` (URL form so the OS auto-launches the
  app; back it with an **App Clip / Instant App** so it works even without the
  full app installed).
- Flow: **unlocked** phone, app closed → move to tag (<4 cm) → OS launches the
  app from the tag → app resolves serial → **RemoteStart** (existing
  `/api/driver/start-session` path; no new IdToken kind). Haptic + visual
  confirm for the "tap registered" feel.

**Discovery + anti-spoof — BLE:**
- Recognize **any Zaptec generically by its 3-letter serial prefix** in the
  localName; match the serial against the **driver's known chargers** (already
  loaded from `/api/driver/chargers`). **No per-charger BLE provisioning, no
  `bleAdvertisingId` to maintain.**
- **Cross-check at start:** a charge starts only if the NFC-tapped serial is
  *also* live-broadcasting over BLE at strong RSSI nearby. A cloned/relocated
  tag fails the BLE check; a relayed BLE signal fails the NFC touch. This
  covers ADR 0024 threats (1)-(4) without server-side attestation crypto.
- BLE may also pre-warm/notify "you're at ZPR…" on approach (optional; iOS
  needs the one Zaptec service UUID for a closed-app wake — single fleet-wide
  filter).

**Hands-free for regulars — Autocharge (EVCCID):**
- Plug in → car identifies via EVCCID → auto-authorize. No phone, no tap. Uses
  existing `IdTokenKind.evccid` / ADR 0036. Per-car enrollment; complements
  (doesn't replace) the tap path, which covers any car / guest / fleet.

**Android-only variant (documented, not default) — HCE:**
- Phone presents the driver's `IdToken` to the Zaptec's existing RFID reader →
  true **locked, screen-off, no-app** tap. Best feel, **Android only** (iOS
  blocks HCE). Offered per-platform if the locked-tap feel is wanted; the phone
  acts as a card (operator previously preferred not to — kept as a variant).

**Explicitly rejected:**
- **QR** — a *scan*, not a *tap*; dropped per operator.
- **BLE-RSSI as the <5 cm gate** — too coarse (≥10-15 cm) and flaky (jitter +
  scan death). BLE is discovery only.
- **Cross-platform locked/Express-Mode tap** — Apple-gated; not achievable for
  a third-party charging app.

## D. Build milestones

1. **Scanner (`scanner.dart`)** — switch matching to **prefix + driver's known
   serials** (drop `bleAdvertisingId` dependency); add the **keep-alive
   watchdog** (fix bug #4); demote the debug-only diagnostics. *(Permission /
   continuous-scan / low-latency fixes already landed during the field test.)*
2. **NFC** — on-metal tag spec + NDEF Universal Link; iOS associated-domains +
   App Clip; Android intent-filter + Instant App; launch→handler.
3. **Backend** — `serial → charger → install → driver-access` resolver; enforce
   the **BLE×NFC cross-check** on start (Rule 5 — start-path change, reviewed
   before code). No new IdToken kind (reuses app-start).
4. **Fleet rollout** — encode/apply one tag per charger; URL carries the serial;
   keep tag serial == DB serial == advertised serial.
5. **Optional** — Android HCE variant; Autocharge/EVCCID enrollment (ADR 0036,
   separate track).

## E. Status & guardrails

Direction **decided** (this addendum). Each step that alters session-start /
access-grant (cross-check enforcement, HCE idTag, Autocharge auth) is a **Rule 5
stop-and-summarise before code**. The scanner discovery changes (milestone 1)
are not on the auth path and can proceed. Threat models (1)-(4) addressed by the
BLE×NFC cross-check; rooted-device (5) remains out of scope.
