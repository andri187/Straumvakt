# Alfen — API + OCPP integration reference

**Status:** reference data, not schema. **No live charger probes yet** — content is from Alfen's public knowledge base, the NG9xx Backoffice Configuration Keys PDF, the Smart Charging Implementation Guide PDF, and unofficial community Modbus libraries. Mark anywhere this file states a value as *(unverified)* before relying on it operationally.
**Last verified:** 2026-04-28 against Alfen knowledge.alfen.com / aceservice.alfen.com docs.
**Primary use:**
1. Reference for onboarding Alfen chargers into Straumvakt — especially the **non-trivial onboarding constraints** that differ from Zaptec / Easee. The onboarding sequence appears in §1, ahead of everything else, because Alfen onboarding decisions are made before any code runs.
2. Reference for the future Alfen adapter (V3 hardware-catalog `credential_scope = none` — Alfen has no Cloud API for operators, OCPP is the only integration path).
3. Cross-vendor parity check against [`zaptec.md`](zaptec.md) and [`easee.md`](easee.md). Alfen is the structural odd-one-out among AC vendors.

> [!IMPORTANT]
> Alfen does **not** publish a public Cloud REST API for third-party CPOs the way Zaptec and Easee do. Every operator-relevant integration goes through OCPP. Modbus TCP is available as an on-prem alternative but requires a paid license. Onboarding therefore has hard constraints — see §1 before anything else.

---

## 1. Onboarding routes — read this first

Onboarding an Alfen charger is materially different from Zaptec or Easee. The matrix below is the first decision point of every Alfen sales motion.

### 1.1 Decision matrix

| Scenario | OTA possible? | Path | Lead time |
|---|---|---|---|
| **Factory-fresh charger, no prior backoffice** | ❌ No | On-site ACE Service Installer | Hours + scheduling |
| **Factory-fresh + customer VPN to charger LAN** | ✅ Yes (no travel) | Remote ACE Service Installer over VPN | ~30 min per charger |
| **Migration from another CPO, outgoing op cooperates** | ✅ Yes | Outgoing op pushes `ChangeConfiguration` over OCPP | Hours-to-days (their schedule) |
| **Migration from another CPO, no cooperation, no VPN** | ❌ No | On-site ACE Service Installer | Field tech visit |
| **Migration from another CPO, no cooperation, with VPN** | ✅ Yes (no travel) | Remote ACE Service Installer over VPN | ~30 min per charger |
| **Currently on Alfen ICU Connect** | ✅ Yes | Asset owner asks Alfen to redirect via ICU Connect | Days (Alfen support flow) |

The rule of thumb: **first contact with an Alfen charger is always local-network**, unless someone with control hands you remote authority (outgoing CPO via OCPP, Alfen via ICU Connect, or VPN bridging from the asset owner).

### 1.2 Why it differs from Zaptec / Easee

Zaptec and Easee both maintain a *manufacturer-cloud channel* parallel to OCPP. Their cloud is always reachable, and changing the OCPP URL is a portal click. Alfen has no such channel — the operator's CSMS (whoever that is) is the only remote authority over the charger. The price of that operator independence is that nobody (including Alfen) can remotely push a URL change unless they already hold a control path.

### 1.3 Required authority

Before any onboarding path is viable:

- [ ] **Asset owner consent in writing.** The asset owner is the entity that bought the charger, not the operator. They hold the contractual key.
- [ ] **Termination notice / migration order** if currently operated by another CPO. Some EU jurisdictions require notice periods.
- [ ] **Installer password.** Set at commissioning, documented in the commissioning report. Asset owner should hold it. If lost, Alfen can reset via service ticket — multi-day lead time.

### 1.4 Pre-flight inventory (per charger)

For every charger to be migrated, capture:

- [ ] Serial number + ICCID (cellular SIM) — for Straumvakt-side recognition
- [ ] Model + hardware platform (NG9xx vs AHP)
- [ ] Firmware version — confirms OCPP version support (1.6J always; 2.0.1 needs ≥ 6.0.x)
- [ ] Multi-socket? Eve Double / Twin 4XL has two physical connectors under one network identity but two OCPP `connectorId`s
- [ ] ALB (Active Load Balancing) license status — paid; doesn't auto-transfer; affects whether Modbus TCP works post-migration
- [ ] Plug & Charge / V2X support — only if the customer cares
- [ ] Network details: LAN/WAN/4G, IP address, SIM operator, current firmware-update URL

### 1.5 Pre-stage Straumvakt's side (always required)

Before touching any charger — works the same regardless of which onboarding path you use:

- [ ] **Provision OCPP identities** in `straumvakt-ocpp`. One identity per network device (single-socket = 1 identity / 1 connectorId; multi-socket = 1 identity / 2 connectorIds).
- [ ] **Generate Basic-Auth secrets** per identity. Hashed in `ocpp.ocpp_identities.auth_secret_hash`.
- [ ] **Verify endpoint reachability** from a clean network: `wscat -c wss://straumvakt-ocpp.straumvakt.workers.dev/ocpp/<identity> -H "Authorization: Basic <b64>"` should accept the WS upgrade and stay open.
- [ ] **Pre-stage Local Auth List** if RFID continuity matters. Pull active cards from the asset owner.
- [ ] **Pre-stage charging profiles** if the prior operator was using SmartCharging.

### 1.6 Cutover playbook — Path A: ACE Service Installer (on-site or VPN)

1. Connect ACE Service Installer (Windows-only) to the charger's LAN — physical or VPN.
2. Authenticate with the installer password.
3. **Snapshot the current configuration** to a `.dat` file. Rollback insurance.
4. **Wait for an idle moment** — confirm `Available` status; reboot during a session kills it.
5. Update OCPP settings:
   - `BackofficeUrl` → `wss://straumvakt-ocpp.straumvakt.workers.dev/ocpp/<identity>`
   - `BackofficeUrlIdentity` → `<identity>` (the OCPP charge-box id)
   - `BackofficeUrlPassword` → `<basic-auth secret>`
   - `OcppVersion` → `1.6J` (or `2.0.1` if both ends agree; default to 1.6J for first onboarding)
6. Save and apply. ACE warns reboot required.
7. Reboot the charger via ACE or front-panel power-cycle.
8. Within ~60 seconds the charger dials Straumvakt. Verify `BootNotification(Accepted)` arrives.

### 1.7 Cutover playbook — Path B: Outgoing operator cooperates (OTA)

Send to the outgoing operator (e.g. Virta) a migration order with these four OCPP commands to send to each charger:

```
[2, "<callId>", "ChangeConfiguration",
   { "key": "BackofficeUrl",
     "value": "wss://straumvakt-ocpp.straumvakt.workers.dev/ocpp/<id>" }]

[2, "<callId>", "ChangeConfiguration",
   { "key": "BackofficeUrlIdentity",
     "value": "<id>" }]

[2, "<callId>", "ChangeConfiguration",
   { "key": "BackofficeUrlPassword",
     "value": "<basic-auth>" }]

[2, "<callId>", "Reset",
   { "type": "Hard" }]
```

Each `ChangeConfiguration` returns `{ status: "RebootRequired" }` (or `Accepted` then queues for next reboot). The `Reset(Hard)` triggers the reboot. Charger then dials Straumvakt directly. **Zero on-site work, zero VPN required.** Conversion only depends on the outgoing operator's willingness to act per their contract.

### 1.8 Verify (every path)

- [ ] `BootNotification` accepted (firmware version, model, serial, ICCID match §1.4 inventory)
- [ ] `Heartbeat` arriving on cadence (~ every 300 s default)
- [ ] `StatusNotification` per connector: `Available` + `errorCode = NoError`
- [ ] `MeterValues` streaming during a test session — `RemoteStartTransaction`, verify `Energy.Active.Import.Register` accumulates, `RemoteStopTransaction`, verify `StopTransaction.transactionData` arrives with the OCMF receipt (Eichrecht-certified models) or plain meter reading
- [ ] `Authorize` round-trip works — present a test RFID card
- [ ] Multi-socket: repeat the session test on connector 2
- [ ] Local Auth List version visible on the charger matches what `straumvakt-ocpp` last pushed
- [ ] Modbus TCP still reads (if ALB license is active) — port 502, slave addresses 200/201

### 1.9 Decommission outgoing operator

After 24–72 hours of confirmed-quiet operation on Straumvakt:

- [ ] Asset owner removes the charger from the outgoing operator's portal — revokes their authority retroactively (charger is already off them, but cleanup prevents any later attempt to re-push a URL change).
- [ ] Confirm firmware-update URL still points at Alfen's CDN (not at outgoing-op-controlled URL). Switch via ACE if it was redirected.
- [ ] Notify asset owner that migration is complete and the outgoing operator contract can be terminated per the agreed timeline.
- [ ] Keep §1.6.3 rollback snapshot for 30 days minimum.

### 1.10 What CAN'T happen (the safety net)

- Asset owner hasn't authorized → no path exists. Every onboarding requires their cooperation.
- Charger firmware predates the writable URL key (NG9xx ≤ 4.x has limitations) → on-site firmware update first.
- Charger is bricked / hardware fault → on-site service before migration.
- SIM operator firewalls outbound to Cloudflare → coordinate with SIM operator to whitelist `straumvakt-ocpp.straumvakt.workers.dev`.

---

## 2. Vendor profile

| Field | Value |
|---|---|
| Vendor | Alfen NV (Dutch — Almere) |
| Hardware tier | AC chargers, mostly commercial / multi-socket |
| Models in scope | Eve Single S-line, Eve Single Pro-line, Eve Double Pro-line, Twin 4XL |
| Hardware platform | NG9xx (current); AHP (Alfen Hardware Platform — successor track) |
| Firmware track | NG9xx 7.x (7.3.0 latest as of 2026-04) |
| OCPP versions | 1.5J, **1.6J**, **2.0.1** — Alfen is one of the few AC vendors shipping 2.0.1 in production firmware |
| Cloud backend | None for third parties — Alfen runs ICU Connect as a customer-facing subscription, not a developer API |
| `credential_scope` (per V3 §10) | **`none`** — OCPP-only adapter, no vendor API credentials to store |
| Multi-socket per device | **Yes** — Eve Double Pro-line and Twin 4XL present two physical connectors under one network device |
| Distinctive features | Active Load Balancing license (paid); Modbus TCP (paid, requires ALB); V2X; Plug & Charge; Solar Charging integration; Eichrecht-certified models with OCMF |

---

## 3. Integration model — OCPP-primary

Alfen integration paths (in order of operator relevance):

### 3.1 OCPP 1.6J / 2.0.1 over WebSocket — the primary path

The charger talks OCPP directly to the operator's CSMS. There is no vendor cloud in the middle for observability or commands. **The operator's CSMS *is* the API surface.**

This is exactly the V3 architecture's `credential_scope = none` model (per §5.2 of `STRAUMVAKT_ARCHITECTURE_V3.md`). The hardware-catalog row carries `credentialScope: none`; no `properties.installations.credentials_ref` to manage.

### 3.2 ICU Connect — Alfen's own backoffice subscription

A subscription portal Alfen sells to end customers who don't have their own backoffice. Three subscription tiers; not a developer API. Chargers operated by a third-party CPO are by definition **not** on ICU Connect — the customer chose the third-party.

### 3.3 Modbus TCP — local-network access

On-prem alternative for sites that want grid-side load balancing without Cloud dependency. **Paid:** "Active Load Balancing" license required, not in the base SKU. Default port 502. NG9xx firmware 4.2.0+ minimum (6.4.0+ recommended). See §6.

### 3.4 ACE Service Installer — commissioning tool

Windows-only desktop tool. Used at commissioning and for occasional reconfiguration (CSMS URL, OCPP version, network settings, license activation). Not an API; not scriptable. See §1.6 for cutover usage.

---

## 4. Authentication

Not applicable for the operator integration path — there is no vendor Cloud API to authenticate against.

The relevant authentication boundaries are:

| Boundary | Who | Mechanism |
|---|---|---|
| ACE Service Installer ↔ charger LAN | Field tech / asset owner | Installer password (set at commissioning) |
| Charger ↔ CSMS (OCPP) | Operator | Basic-Auth in WebSocket upgrade (per OCPP 1.6 Security Profile 1) |
| ICU Connect customer portal | Asset owner | Email + password (Alfen-managed) |
| Modbus TCP | Local-network client | None at protocol level — secure the LAN |

---

## 5. REST API surface

Empty for third-party operators — Alfen does not publish a Cloud API.

The absence is structural and worth noting explicitly so adapter implementers don't waste time looking:

- No OAuth endpoint
- No `/api/installations` or `/api/sites`
- No charger-state read endpoint (state arrives via OCPP only)
- No command endpoint (commands sent via OCPP only)
- No firmware-status endpoint (firmware notifications arrive via OCPP `FirmwareStatusNotification`)
- No real-time push channel (OCPP itself is the push)

What exists:

| Surface | Purpose | Audience |
|---|---|---|
| `knowledge.alfen.com` | Public knowledge base — PDFs, configuration key lists, release notes | Implementers, integrators |
| `aceservice.alfen.com` | Service portal — firmware downloads, troubleshooting articles | Asset owners, installers |
| ICU Connect web portal | Customer-facing backoffice | ICU Connect subscribers only |

---

## 6. Modbus TCP — the closest thing to a local API

### 6.1 Activation requirements

| Requirement | Notes |
|---|---|
| Active Load Balancing license | **Paid feature** — must be purchased from Alfen. Tied to charger serial, not transferable. |
| Firmware ≥ 4.2.0 | Modbus TCP support introduced |
| Firmware ≥ 6.4.0 | Recommended baseline (more registers, better stability) |
| Modbus enabled in ACE Service Installer | "Active balancing → Data source: Energy Management System" |
| Local network reachable | Default port 502 |

### 6.2 Register layout (per-socket)

| Slave address | What |
|---|---|
| 200 | Socket 1 |
| 201 | Socket 2 (multi-socket models only) |

Per-socket registers cover (read):

- Identity: meter state, meter type, reading age
- Voltages: L1-N, L2-N, L3-N, L1-L2, L2-L3, L3-L1
- Currents: L1, L2, L3, N, sum
- Power factor: per-phase + sum
- Frequency
- Real / apparent / reactive power: per phase + sum (W, VA, VAr)
- Real energy delivered / consumed: per phase + sum (Wh)
- Apparent / reactive energy: per phase + sum (VAh, VArh)
- Derived: car connected, charging state, session Wh, session duration

Writable (write):

- `Socket {1,2} max current` — sets dynamic current cap (A)
- `Socket {1,2} max current valid time` — TTL on the cap (analog to Easee's `dynamic_current.timeToLive`)
- `Phase mode` — 1-phase vs 3-phase

### 6.3 Station-wide registers (no slave address — root)

- Name, manufacturer, modbus table version, firmware version, platform type, serial
- Current time, last boot time
- Actual max current, board temperature
- Backoffice connected (bool — useful for "is OCPP up")
- Number of sockets

### 6.4 Polling guidance

- 30 s scan interval is the recommended community default
- 10 s is achievable on healthy hardware
- Sub-second polling is unsupported; the chargers will hang
- Multi-socket chargers expose two slave addresses — poll both independently

### 6.5 Authoritative reference

The canonical doc is *"Modbus Slave TCP/IP — Implementation of Modbus Slave TCP/IP for Alfen NG9xx platform"* — downloadable from knowledge.alfen.com. **Specific holding-register addresses are not embedded here** because they vary across firmware tracks and Alfen revises them; pull the current PDF for the production firmware version of the fleet.

### 6.6 Decision: when to wire Modbus

Wire it if:
- Asset owner has the ALB license and uses on-prem load balancing
- Site needs continued operation during cloud outages (Modbus stays up even when OCPP CSMS is unreachable)
- Operator wants real-time DLB at sub-OCPP latencies

Skip it if:
- ALB license is not purchased
- No on-site VPN / network bridge to the charger LAN from the operator side
- OCPP MeterValues at ≤ 60 s cadence is sufficient (it usually is)

---

## 7. OCPP integration — the canonical surface

Alfen's OCPP support is unusually broad. Most of this builds on the shared [`ocpp-1.6j.md`](ocpp-1.6j.md) reference; this section captures Alfen-specific deltas.

### 7.1 Versions

| OCPP version | Alfen support | Notes |
|---|---|---|
| 1.5J | Yes | Legacy; rarely used now |
| **1.6J** | **Default** | Production-ready across all firmware ≥ 4.x |
| **2.0.1** | **Yes** | Available on NG9xx ≥ 6.0.x; one of few AC vendors with 2.0.1 in production |

Set via `OcppVersion` in ACE Service Installer at commissioning, or via `ChangeConfiguration` over OCPP at runtime.

### 7.2 Identity convention

| Field | Pattern |
|---|---|
| `chargePointId` (URL path tail) | Charger serial number |
| Basic-Auth username | Same as `chargePointId` |
| Basic-Auth password | Generated by operator, stored on charger via ACE or `ChangeConfiguration` |

Multi-socket chargers (Eve Double, Twin 4XL): **one chargePointId** for the device, **two `connectorId` values** (1 and 2) inside `StatusNotification` / `StartTransaction` / `MeterValues`. The V3 schema accommodates this via `(ocpp_identity_id, connector_index)` unique key on `ocpp.connectors`.

### 7.3 Configuration keys — Alfen-specific

The full list is in *ACE NG9 Backoffice Configuration Keys* (PDF, knowledge.alfen.com). Alfen-relevant keys beyond the OCPP 1.6 standard set:

| Key | Type | RW | Description |
|---|---|---|---|
| `BackofficeUrl` | string | RW (RebootRequired) | The CSMS WebSocket URL the charger dials |
| `BackofficeUrlIdentity` | string | RW (RebootRequired) | Basic-Auth username (typically equals `chargePointId`) |
| `BackofficeUrlPassword` | string | RW (RebootRequired) | Basic-Auth password — write-only on read-back |
| `OcppVersion` | string | RW (RebootRequired) | `1.6J` / `1.5J` / `2.0.1` |
| `OcppMeasurands` | CSL | RW | Measurands sent in MeterValues (vendor extension over `MeterValuesSampledData`) |
| `WebSocketPingInterval` | integer (s) | RW | Default 60 |
| `MaxCurrentSocket1` | integer (A) | RW | Per-socket hardware ceiling |
| `MaxCurrentSocket2` | integer (A) | RW | Per-socket hardware ceiling (multi-socket only) |
| `ActiveLoadBalancingLicense` | string | RO | `Activated` / `NotActivated` — affects Modbus TCP availability |
| `MeterReadingFrequency` | integer (s) | RW | How often the internal meter is read (independent of MeterValuesSampleInterval) |
| `PlugAndChargeEnabled` | boolean | RW | Plug & Charge support (when firmware allows) |
| `RandomDelayMaxSeconds` | integer (s) | RW | Smart-charging anti-correlation jitter |
| `BootBackoffMin` / `BootBackoffMax` | integer (s) | RW | Reconnect backoff after CSMS loss |
| `LocalListVersion` | integer | RO | Mirror of OCPP `LocalAuthListVersion` |

The standard OCPP 1.6 Appendix B keys (the 38 in [`ocpp-1.6j.md`](ocpp-1.6j.md) §5.1) are all supported with conventional defaults.

### 7.4 Vendor `DataTransfer` payloads

`vendorId: "ALF.AlfenEve"` — used for:
- ALB-coordination payloads (master-charger broadcasts available current per phase)
- Plug & Charge negotiation extensions
- EVCC quirks for certain car models

These are pass-through in the V3 translator (raw_protocol retention class) — Straumvakt does not interpret Alfen-specific DataTransfer beyond logging it.

### 7.5 Local Auth List

Standard OCPP 1.6 LocalAuthListManagement profile. Synced via `SendLocalList`. Supports 256–1024 entries (varies by firmware). Default `LocalAuthListEnabled = true`, `LocalAuthorizeOffline = true`, `LocalPreAuthorize = false`, `AllowOfflineTxForUnknownId = false` — see [`ocpp-1.6j.md`](ocpp-1.6j.md) §5.2 / §9 for the full semantics.

### 7.6 Smart Charging

`SetChargingProfile` / `ClearChargingProfile` / `GetCompositeSchedule` all supported on NG9xx 6.x+. `chargingRateUnit = A` is preferred (the charger's native unit); `W` is supported but converts via assumed voltage.

### 7.7 OCMF (signed metering)

Eichrecht-certified Alfen models embed OCMF in `MeterValues.sampledValue.format = "SignedData"` and in `StopTransaction.transactionData`. See [`ocmf.md`](ocmf.md) for parsing + verification. Non-Eichrecht models emit plain `Energy.Active.Import.Register` values without signatures.

---

## 8. Real-time push

**None separate from OCPP.** Alfen does not have a SignalR / Service Bus / WebSocket-out-of-band channel. OCPP itself is the push:

| Purpose | OCPP message | Frequency |
|---|---|---|
| Periodic health | `Heartbeat` | every `HeartbeatInterval` (default 300 s) |
| Status changes | `StatusNotification` | on every `errorCode` or `status` change |
| Live electrical | `MeterValues` (Sample.Periodic) | every `MeterValueSampleInterval` (typical 60 s) |
| Session start | `StartTransaction` | once per session |
| Session end | `StopTransaction` | once per session, with full `transactionData` |
| Auth attempts | `Authorize` | on every RFID tap (not cached locally) |
| Firmware lifecycle | `FirmwareStatusNotification` | on download / install state changes |
| Diagnostics upload | `DiagnosticsStatusNotification` | on log-upload state changes |

This means **the operator's CSMS reliability bar is higher** for Alfen than for Zaptec or Easee — there is no parallel REST mirror to recover from a dropped frame. See §10.

---

## 9. Commands

Alfen has no REST command surface. Every command is OCPP from the CSMS. Map to the V3 unified action catalog:

| Action (V3) | Alfen path | Notes |
|---|---|---|
| Start a session | OCPP `RemoteStartTransaction` | Standard |
| Stop a session | OCPP `RemoteStopTransaction` | Standard |
| Reboot | OCPP `Reset({"type": "Hard"})` | Standard |
| Soft reset | OCPP `Reset({"type": "Soft"})` | Restarts OCPP stack only |
| Take charger offline | OCPP `ChangeAvailability({"type": "Inoperative"})` | Per connector or whole CP |
| Bring charger online | OCPP `ChangeAvailability({"type": "Operative"})` | Standard |
| Unlock connector | OCPP `UnlockConnector(connectorId)` | Refuses while energized — stop tx first |
| Trigger status update | OCPP `TriggerMessage("StatusNotification")` | Standard |
| Trigger meter values | OCPP `TriggerMessage("MeterValues")` | Standard |
| Read configuration | OCPP `GetConfiguration([])` | Returns full key list incl. Alfen extensions |
| Write configuration | OCPP `ChangeConfiguration({key, value})` | Some keys require reboot |
| Clear authorization cache | OCPP `ClearCache()` | Standard |
| Update firmware | OCPP `UpdateFirmware({location, retrieveDate})` | Location must be reachable from charger |
| Set charging profile | OCPP `SetChargingProfile(connectorId, csChargingProfiles)` | NG9xx 6.x+ |
| Clear charging profile | OCPP `ClearChargingProfile({...})` | Standard |
| Send local auth list | OCPP `SendLocalList({listVersion, updateType, localAuthorizationList})` | Differential or full |

The unified `ActionsPanel` in `zaptec-test/` (and the production equivalent) treats Alfen as **OCPP-only transport** — no API fallback exists. Buttons either light up (OCPP gateway connected) or grey out with reason "OCPP gateway disconnected".

---

## 10. Live findings — none yet

This section will be populated after the first Alfen probe. Until then, expect deltas in:

- Exact writable-vs-readonly status of `BackofficeUrl` and friends across NG9xx vs AHP firmware
- Whether `MeterValues` arrives reliably at the configured cadence under load
- Multi-socket `connectorId` indexing (1-based per spec; some firmware quirks reported)
- Vendor `DataTransfer` payload shapes
- Plug & Charge handshake details
- OCMF availability per Eichrecht-certified vs base SKU

---

## 11. Companion docs

This file references two shared protocol docs in this folder:

- [`ocpp-1.6j.md`](ocpp-1.6j.md) — full OCPP 1.6J protocol reference (28 messages, 38 standard config keys, state machine, security profiles, local-auth-list sync). The bedrock for Alfen integration since OCPP is the primary path.
- [`ocmf.md`](ocmf.md) — OCMF signed-meter envelope reference. Required when working with Eichrecht-certified Alfen models that embed signed receipts in `StopTransaction.transactionData`.

For OCPP 2.0.1 specifics, see the planned `ocpp-2.0.1.md` (not written yet — Alfen is one of the forcing functions for that doc).

---

## 12. Cross-vendor comparison

| Concern | Zaptec | Easee | **Alfen** |
|---|---|---|---|
| Public Cloud REST API | ✅ `api.zaptec.com` | ✅ `api.easee.com` | **❌ none** |
| Auth | OAuth password grant | JWT login + refresh | n/a |
| Real-time push channel | Azure Service Bus AMQP | Microsoft SignalR | none — OCPP is the only push |
| Vendor portal | Zaptec Portal | Easee Portal | ICU Connect (subscription) |
| Local network API | none | none | ✅ **Modbus TCP (paid license)** |
| Configuration tool | portal-based | portal-based | **ACE Service Installer (Windows-only)** |
| OCPP versions | 1.6J | 1.6J | 1.5/1.6/**2.0.1** — only one shipping 2.0.1 broadly |
| Multi-socket per device | no | no | **yes** — Eve Double, Twin 4XL |
| Per-pin connector temperatures | no | yes | partial (board-level) |
| OCMF signed metering | yes (StateId 554) | add-on license | **yes — Eichrecht-certified models** |
| V3 `credential_scope` | `installation` | `installation` | **`none`** — OCPP-only adapter |
| Onboarding OTA-by-default | ✅ yes (portal flips URL) | ✅ yes (operator commissioning API) | **❌ no — see §1** |
| Onboarding cost (greenfield) | minutes, software-only | minutes, software-only | hours + LAN/VPN access OR field tech |
| Onboarding cost (migration) | minutes, software-only | minutes, software-only | depends on outgoing op cooperation; otherwise as greenfield |

The structural takeaway: **Alfen is the easiest vendor to integrate AND the most demanding to integrate well — at the same time.**

Easy because:
- No OAuth wrangling, no vendor-API enum mirror to maintain, no Service Bus / SignalR client to write
- Maps directly to V3's `credential_scope = none` model
- OCPP 2.0.1 readiness means future-proofing is partly free

Demanding because:
- Every operator-relevant observation flows through the OCPP gateway. No REST fallback.
- No backfill mechanism — if the gateway drops a `StopTransaction`, the only recovery is `GetDiagnostics` log-upload (slow, brittle).
- Multi-socket strict-`connectorIndex` discipline.
- Onboarding cost is structurally higher.

---

## 13. Production-adapter checklist

### 13.1 OCPP gateway reliability bar

- [ ] **At-least-once delivery from `straumvakt-ocpp` to the event log is mandatory** for Alfen — there is no REST mirror to recover from a dropped frame.
- [ ] **Persist every CALL before responding.** If the worker crashes between receiving a `StopTransaction` and committing it to the event log, that session is lost.
- [ ] **Alarm on `MeterValues` gaps.** If the configured cadence is 60 s and 5 minutes pass without one, page on-call.
- [ ] **`HeartbeatInterval` should be ≤ 300 s.** Larger values increase blast radius on outages.

### 13.2 Multi-socket discipline

- [ ] `ocpp.connectors` table must track `(ocpp_identity_id, connector_index)` distinctly. Eve Double Pro-line is the canonical case.
- [ ] `StatusNotification` must be applied per `connectorId` — connector 0 is the whole-CP status, 1 and 2 are per-socket.
- [ ] `RemoteStartTransaction` requires explicit `connectorId` for multi-socket; defaulting can authorize the wrong port.
- [ ] `UnlockConnector` is per-`connectorId` only.

### 13.3 Smart Charging

- [ ] When applying `SetChargingProfile`, prefer `chargingRateUnit = A` (Alfen's native unit). `W` conversion assumes nominal voltage and is less precise.
- [ ] `RandomDelayMaxSeconds` should be set to a nonzero value at multi-charger sites to avoid demand-correlation spikes.
- [ ] `MaxChargingProfilesInstalled` tells you the limit per `connectorId` — plan accordingly.

### 13.4 OCMF (Eichrecht-certified models)

- [ ] Verify every `SignedData` envelope against the charger's MID public key.
- [ ] **Cache the public key per-charger** in `assets.charger.metadata`. Re-fetch on firmware update.
- [ ] Never bill against an unsigned reading on Eichrecht models — write to event log and escalate.

### 13.5 Idempotency

- [ ] All OCPP commands are not idempotent. Use the V3 outbox pattern (`vendor:alfen:ocpp` scope, key `<chargerId>:<action>:<correlation-id>`).
- [ ] OCPP `callId` (UUID) is the natural correlation-id; reuse on retransmit so the charger can deduplicate.

### 13.6 Onboarding

- [ ] **Pre-stage the OCPP identity in `straumvakt-ocpp` before the URL change.** Receiving an unknown `chargePointId` should trigger a warning, not silently accept.
- [ ] **Hold the rollback snapshot** from §1.6.3 for at least 30 days. Migration failures often surface days later (e.g. a charger that boots fine but fails Plug & Charge).
- [ ] **Keep the outgoing operator's portal access live** until §1.9 confirmed-quiet window passes. Premature revocation cuts off your fallback path.

### 13.7 Modbus TCP (when applicable)

- [ ] Wire as a **separate adapter**, not as part of the OCPP path. Modbus is a parallel data plane, not an alternative.
- [ ] Cloudflare Workers cannot speak raw Modbus TCP — needs a local relay (Tailscale + a small worker on a Pi, or similar). Treat as on-prem infrastructure.
- [ ] Poll cadence: 30 s default, 10 s if hardware proves stable. Sub-second is unsupported.
- [ ] Multi-socket: poll slave addresses 200 and 201 separately.

### 13.8 Observability

- [ ] Tag every Alfen-charger event with `vendor=alfen`, `model=<eve-…>`, `firmware=<version>`, `installation=<id>` for log grouping.
- [ ] Track `Heartbeat` cadence per charger as a freshness gauge.
- [ ] Track `MeterValues` interarrival time during sessions — anomalies indicate worker or gateway lag.
- [ ] On `BootNotification`, verify the `firmwareVersion` matches the inventory. Unexpected upgrades / downgrades warrant alerting.

---

## 14. Reference TypeScript shapes (lightweight — no Cloud API)

```ts
// ── Charger inventory (operator-side metadata) ──────────────────────────
export type AlfenChargerInventory = {
  // From §1.4 pre-flight
  serialNumber: string;
  iccid?: string;
  model:
    | "eve-single-s"
    | "eve-single-pro"
    | "eve-double-pro"
    | "twin-4xl"
    | "other";
  hardwarePlatform: "ng9xx" | "ahp";
  firmwareVersion: string;          // e.g. "7.3.0"
  ocppSupportedVersions: ("1.5J" | "1.6J" | "2.0.1")[];
  socketCount: 1 | 2;
  albLicenseActive: boolean;        // Modbus TCP availability
  plugAndChargeEnabled: boolean;
  v2xCapable: boolean;
  network: {
    medium: "lan" | "cellular-4g";
    simOperator?: string;
    publicIp?: string;
    firmwareUpdateUrl?: string;     // typically alfen.com — flag if redirected
  };
  installerPasswordHeldBy: "asset-owner" | "outgoing-cpo" | "alfen" | "lost";
};

// ── Pre-stage record (Straumvakt-side) ──────────────────────────────────
export type AlfenPreStage = {
  chargerInventoryId: string;
  ocppIdentity: string;             // becomes chargePointId path tail
  basicAuthSecretHash: string;      // bcrypt or similar
  preLoadedAuthList?: Array<{ idTag: string; status: "Accepted" | "Blocked" | "Expired" }>;
  preLoadedChargingProfiles?: unknown[];  // OCPP profile payloads
};

// ── Migration order to outgoing CPO (§1.7 Path B) ──────────────────────
export type MigrationOrder = {
  chargerSerial: string;
  newCsmsUrl: string;               // wss://straumvakt-ocpp.../ocpp/<id>
  newIdentity: string;
  newBasicAuthSecret: string;       // plaintext — sent via secure channel only
  effectiveAt: string;              // ISO 8601
  fallbackContact: { name: string; email: string; phone: string };
};

// ── Verification checklist state (§1.8) ────────────────────────────────
export type OnboardingVerification = {
  bootNotificationAccepted: boolean;
  heartbeatCadenceOk: boolean;
  statusAvailableEachConnector: boolean[];
  testSessionRoundTrip: { started: boolean; metered: boolean; stopped: boolean; ocmfReceived: boolean };
  authorizeRoundTripOk: boolean;
  localAuthListVersionMatches: boolean;
  modbusReadable?: boolean;         // only if ALB license active
  completedAt?: string;
};
```

---

## 15. Sources

- [Alfen Knowledge Base](https://knowledge.alfen.com/) — primary technical docs portal.
- [Alfen ACE Service Portal](https://aceservice.alfen.com/) — Service Installer + firmware release notes + OCPP article archive.
- [ACE NG9 Backoffice Configuration Keys (PDF)](https://knowledge.alfen.com/download/attachments/243466257/ACE%20NG9%20Backoffice%20Configuration%20Keys.pdf?download=true) — full OCPP config-key list including Alfen-specific extensions.
- [Smart Charging Implementation Guide (PDF)](https://knowledge.alfen.com/download/attachments/854327297/Smart_charging_implementation_guide_EN_web.pdf?download=true) — Modbus + OCPP smart-charging behaviour.
- [ICU Connect product page](https://knowledge.alfen.com/page/connect-ev) — Alfen's subscription backoffice.
- [Difference between ACE Service Installer and ICU Connect](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01090) — clarifies that ICU Connect is a portal product, not a developer API.
- [NG-Firmware 7.2.0 release notes](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01385) — 2.0.1 readiness, recent feature additions.
- [Alfen NG9xx 7.1 Release Notes (PDF)](https://info.alfen.com/hubfs/2-AlfenChargingEquipment-ACE/ACE-productmanagement/Attachments-release-notes/NG/Firmware%20Release%207.1/Release%20Notes%20NG9xx%207.1.pdf) — example release-notes shape.
- [Setting up external TCP/IP Modbus meter via ACE Service installer](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01277) — Modbus activation procedure.
- [Modbus for ACE — Alfen ICU implementation guide](https://eu-assets.contentstack.com/v3/assets/blt08d332658a89f766/blt64e1bba919b76c5e/IP%20for%20Alfen%20NG9xx%20platform) — Modbus on NG9xx.
- [Alfen Modbus integration (Home Assistant community component)](https://github.com/ThaStealth/alfen_modbus) — register-map reverse engineering.
- [`alfen-eve-modbus-tcp` Python library](https://pypi.org/project/alfen-eve-modbus-tcp/) — alternative community implementation.
- [Sintio Alfen integration guide](https://docs.sintio.app/integration/alfen) — typical operator-side OCPP setup.
- [Monta Alfen integration guide](https://monta.com/en/help-center/alfen-installation-guide/) — competitor backoffice's setup flow.
- [Wiki – Alfen (smart-me)](https://sites.google.com/smart-me.com/wiki-english/ocpp/alfen) — community OCPP notes.

---

## 16. Companion artifacts

None on disk yet — first probe will produce:

| File | Where (planned) | Purpose |
|---|---|---|
| `alfen-test/modbus-register-map.json` | scratch app (planned) | Verified Modbus register addresses + types for the firmware version under test |
| `alfen-test/ocpp-config-keys.json` | scratch app (planned) | Verified `GetConfiguration` response — actual writable/readonly status of each key |
| `alfen-test/src/lib/alfen.ts` | scratch app (planned) | Reference inventory + onboarding helpers (no Cloud API client) |

When the first scratch app exists, update §16 here and migrate any verified findings out of §10 (currently empty) and into §10 with concrete observations.
