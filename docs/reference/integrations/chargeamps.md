# Charge Amps — CPMS integration reference

**Status:** documentation-derived; no production adapter wired yet.
**Research date:** 2026-05-02.
**V3 schema class:** `Hardware / Chargers` — `HardwareVendorKind = charger_ac`, `HardwareModel.kind = charger_ac`. Extends `assets.site_assets` via `assets.chargers`.
**V3 credential scope:** `installation` — Charge Amps has a partner-issued **EAPI key** + service-account email/password that authorise against an installation-level resource. The OCPP path (primary realtime) is `none`-scope; the EAPI is the side-channel for fleet metadata, historical sessions, and remote start/stop fallback.
**Companion file:** `chargeamps-openapi.json` — Charge Amps publishes a Swagger UI at `https://eapi.charge.space/swagger` which can be exported as an OpenAPI document and committed alongside this doc once a partner agreement is in place.

> [!IMPORTANT]
> Charge Amps is the **easiest of the Nordic AC vendors to onboard** to a third-party CSMS, for two reasons:
> 1. The EAPI is real, public-Swagger-documented (`eapi.charge.space/swagger`), and the data model is clean.
> 2. The partner portal can flip a charger's OCPP backend URL **OTA** — Iceland customers can move from Charge Amps Cloud to Straumvakt without an installer site visit.
>
> Use OCPP 1.6J as the realtime path; use the EAPI as a side-channel for fleet/admin operations.

---

## 1. Vendor profile

| Field | Value |
|---|---|
| Legal name | Charge Amps AB |
| Country / HQ | Sweden — Solna / Stockholm region |
| Founded | 2012 by Fredrik Jonsson (started "from a kitchen table in Sollentuna") |
| First product | Charge Amps Spark — portable charging cable |
| Cloud service since | 2016 |
| Hardware tier | Residential + light commercial AC (no DC product line) |
| Geographic focus | Nordics + EU; sales across ~15 markets, ~120 employees in 7 countries |
| Ownership | Acquired (or to be acquired) by **NaaS Technology Inc.** announced August 2023 |
| Distinctive features | Made-in-Sweden positioning · recycled-aluminium enclosures · industrial design by Joachim Nordwall (ex-Koenigsegg) · Halo's Schuko-plus-Type-2 dual-socket config |
| Connector standard | Type 2 only (AC), with a Schuko auxiliary outlet on Halo |
| Cold-climate suitability | Halo cable rated to -25 °C (some marketing claims -35 °C); Aura operating range -30 °C to +45 °C — fine for Iceland outdoor installs |

---

## 2. Models in scope

All current units are AC-only Type 2, OCPP-capable since the 2024 migration off the proprietary CAPI protocol.

### 2.1 Charge Amps Halo (residential flagship)

| Field | Value |
|---|---|
| Power | 3.7 kW (1P 16 A) / 7.4 kW (1P 32 A) / 11 kW (3P 16 A) |
| Voltage / current | 230 V (1P) / 400 V (3P), 6–32 A |
| Connector | Fixed Type 2 cable, 5.5 m or 7.5 m |
| Schuko outlet | Subordinate auxiliary — usable only when EV charging is not active and consumption < 10 A. In load-balanced groups the outlet is enabled with 10 A reserved |
| Metering | Per-phase voltage / current / power |
| MID | unverified — public docs do not explicitly call Halo MID |
| RFID | MIFARE Type A 13.56 MHz |
| Connectivity | Wi-Fi (built-in), 4G (optional add-on module from Charge Amps), LAN (unverified for Halo specifically) |
| OCPP | 1.6J (after OCPP migration) |
| IP / IK | IP66 / IK10 |

> **Schuko + OCPP behaviour.** The Schuko outlet on Halo is **not** exposed as a separate OCPP `connectorId` — it is local-logic only. Practical reports show MeterValues glitches when Schuko is drawing while the Type 2 connector is suspended. **Plan integration assuming one OCPP connector per Halo, and do not bill Schuko energy via OCPP CDRs.**

### 2.2 Charge Amps Aura (commercial dual wallbox)

| Field | Value |
|---|---|
| Power | 2 × 22 kW (3P 32 A per socket), full simultaneous |
| Voltage / current | 230 / 400 V, 6–32 A 1P or 3P **per socket** |
| Connectors | 2 × Type 2 socket (no fixed cable; users bring their own) |
| Metering | **Certified MID meter per socket** |
| RFID | MIFARE Type A 13.56 MHz, 31 dBm output, ISO/IEC 14443 Type A |
| Connectivity | Wi-Fi, LAN, optional LTE/4G variant |
| Protections | Type A RCD with integrated DC fault protection per socket; overcurrent breaker per socket |
| OCPP | 1.6J |
| OCPP connector indexing | `connectorId` 1 and 2 (one per socket) |
| Operating temp | -30 °C to +45 °C |
| Mounting | Wall, or on Charge Amps pole/pillar accessory |

> **Aura early-firmware caveat.** Some early-firmware reports of `connectorId 2` not transacting correctly. Require a recent firmware before commissioning.

### 2.3 Charge Amps Dawn (commercial pillar / floor-mount)

| Field | Value |
|---|---|
| Power | Up to 22 kW (3P 32 A), single socket |
| Voltage / current | 230 / 400 V, 6–32 A, 1P or 3P |
| Connector | Type 2 socket |
| Metering | Certified MID meter |
| RCD | Built-in **RCD Type B** (full DC fault detection — distinctive vs Aura's Type A + DC residual) |
| OCPP | 1.6J |
| Connectivity | Wi-Fi, 4G, LAN (unverified) |
| IP / IK | IP54 / IK10 |
| Dimensions | 250 × 145 × 378 mm (W × D × H) |
| Mounting | Wall **or free-standing column** |
| Eichrecht variant | **Charge Amps Dawn Professional DE** is fully Eichrecht-certified (German calibration law) — implies signed meter values / OCMF on this SKU. Transport of signed values (OCPP `MeterValues` extension vs out-of-band) unverified |

### 2.4 Legacy / emerging

- **Alpha** — older model. Not part of the OCPP-migration list of Halo/Aura/Dawn. Treat as unsupported for new Straumvakt integration unless a customer explicitly arrives with one.
- **Luna** — newer; surfaces in OCPP community discussions and an evcc support thread. Sensors not yet fully populated by integrators. Treat as emerging.

---

## 3. Cloud surfaces

| Surface | Audience | URL |
|---|---|---|
| **Charge Amps Cloud — end user** | Drivers / charger owners | `https://my.charge.space/` |
| **Charge Amps Cloud — admin** | Site / fleet admins | `https://my.charge.space/admin/` |
| **Charge Amps Cloud — partner** | CPO / installer (CPMS integrators) | `https://my.charge.space/partner/` (login at `/partner/login/`) |
| Marketing / overview | Public | `https://www.chargeamps.com/cloud/` |
| Knowledge base | Public | `https://support-se.zendesk.com/hc/en-us/` |
| Mobile apps | Drivers + admins | "Charge Amps" / "My Charge Space" (iOS + Android) |
| Become a Partner | Prospective integrators | `https://www.chargeamps.com/become-a-partner/` |

**Three roles:** End User → Admin → Partner (CPO/installer).
**Partner self-signup is allowed.** Approval can take up to 24 working hours. The EAPI `apiKey` is granted separately by Charge Amps Support.

---

## 4. REST API surface — the EAPI

This is the strongest part of Charge Amps' integrator story. The REST API is real, public-Swagger-documented, and stable at v5.

### 4.1 Endpoint base

| Aspect | Value |
|---|---|
| Base | `https://eapi.charge.space` |
| Path prefix | `/api/v5/...` (current; v4 paths exist historically) |
| Swagger UI | `https://eapi.charge.space/swagger` |
| Internal name | "External API" / "EAPI" |

### 4.2 Authentication — three secrets

Custom flow — **not** standard OAuth2 client-credentials. Three secrets:

1. **`apiKey`** — issued by Charge Amps to a partner; sent as a request **header** on every call (including login).
2. **email / password** — a Charge Amps user account, typically a service account inside the partner organisation.

Login flow (verified from `kirei/python-chargeamps` source against the live v5 API):

```
POST /api/v5/auth/login
  Headers: apiKey: <partner-api-key>
  Body:    { "email": "...", "password": "..." }
  Returns: { "token": "<JWT>", "refreshToken": "..." }
```

- `token` is a JWT, **valid 120 minutes** (decoded client-side without verification — `exp` only).
- All subsequent requests use `Authorization: Bearer <token>`.
- On `401`, clear the token and **re-login from scratch** (not just refresh).

Refresh:

```
POST /api/v5/auth/refreshToken
  Headers: apiKey: <partner-api-key>
  Body:    { "token": "<current-token>", "refreshToken": "<refresh>" }
```

Refresh proactively, ~30 s before `exp` (skew buffer).

> **Note.** The "OAuth2" label some docs use is loose — there is no `/authorize` redirect, no client_id/client_secret form, no scopes. It is a flat token-exchange endpoint protected by an `apiKey` header.

### 4.3 Verified v5 endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v5/auth/login` | Initial login |
| `POST` | `/api/v5/auth/refreshToken` | Refresh JWT |
| `GET` | `/api/v5/chargepoints/owned` | List all chargepoints owned by the authenticated principal |
| `GET` | `/api/v5/chargepoints/{id}/status` | Real-time status of a chargepoint and its connectors |
| `GET` | `/api/v5/chargepoints/{id}/settings` | Chargepoint-level settings (dimmer, downlight) |
| `PUT` | `/api/v5/chargepoints/{id}/settings` | Update chargepoint-level settings |
| `GET` | `/api/v5/chargepoints/{id}/connectors/{connectorId}/settings` | Connector-level settings (mode, RFID lock, cable lock, max current) |
| `PUT` | `/api/v5/chargepoints/{id}/connectors/{connectorId}/settings` | Update connector settings |
| `PUT` | `/api/v5/chargepoints/{id}/connectors/{connectorId}/remotestart` | Remote start (with optional `StartAuth` body) |
| `PUT` | `/api/v5/chargepoints/{id}/connectors/{connectorId}/remotestop` | Remote stop |
| `GET` | `/api/v5/chargepoints/{id}/chargingsessions` | Sessions list, supports `startTime` / `endTime` query parameters |
| `GET` | `/api/v5/chargepoints/{id}/chargingsessions/{sessionId}` | Single session detail |
| `PUT` | `/api/v5/chargepoints/{id}/reboot` | Reboot the charge point |

### 4.4 Reference data model

```ts
// Mirrors the v5 API JSON via camelCase. From kirei/python-chargeamps Pydantic shapes.

interface ChargePoint {
  id: string;
  name: string;
  password: string;            // OCPP basic-auth password lives on the resource
  type: string;                // "Halo" | "Aura" | "Dawn" | ...
  isLoadbalanced: boolean;
  firmwareVersion: string;
  hardwareVersion: string;
  connectors: ChargePointConnector[];
}

interface ChargePointConnector {
  chargePointId: string;
  connectorId: number;         // 1, 2, ...
  type: string;                // "Type2" | "Schuko" | ...
}

interface ChargePointStatus {
  id: string;
  status: string;
  connectorStatuses: ChargePointConnectorStatus[];
}

interface ChargePointConnectorStatus {
  chargePointId: string;
  connectorId: number;
  totalConsumptionKwh: number;
  status: string;              // connector state machine
  measurements: ChargePointMeasurement[] | null;
  startTime: string | null;    // ISO8601
  endTime: string | null;
  sessionId: number | null;
}

interface ChargePointMeasurement {
  phase: "L1" | "L2" | "L3";
  current: number;             // A
  voltage: number;             // V
}

interface ChargePointSettings {
  id: string;
  dimmer: string;              // LED dimming
  downLight: boolean | null;
}

interface ChargePointConnectorSettings {
  chargePointId: string;
  connectorId: number;
  mode: string;                // operating mode
  rfidLock: boolean;
  cableLock: boolean;
  maxCurrent: number | null;
}

interface ChargingSession {
  id: number;                  // integer session id (not a UUID)
  chargePointId: string;
  connectorId: number;
  sessionType: string;
  totalConsumptionKwh: number;
  startTime: string | null;
  endTime: string | null;
}

interface StartAuth {            // body for remotestart with RFID context
  rfidLength: number;
  rfidFormat: string;
  rfid: string;
  externalTransactionId: string; // caller-supplied — useful for matching CPMS sessions
}
```

> **Integrator-relevant detail.** A `ChargePoint` resource carries a `password` field — this is the **OCPP basic-auth password** for that charger. If a partner orchestrates the OCPP migration via the EAPI, they need this value to give the charger to the third-party CSMS.

---

## 5. OCPP support

| Aspect | Value |
|---|---|
| Version | **OCPP 1.6J** confirmed across all current models. **No OCPP 2.0.1 yet** |
| Migration | During 2024 Charge Amps moved its fleet from proprietary "CAPI" to OCPP 1.6J via firmware OTA. CAPI-only chargers must be upgraded by Charge Amps Support before they can speak OCPP |
| Configurable backend URL | **Yes**, two paths: (a) local web UI on Wi-Fi hotspot at `192.168.250.1` with the supplied PIN, or (b) **partner portal OTA** at `my.charge.space/partner/` — the differentiator |
| Charger ID | OCPP `chargePointId` = device serial |
| Authorization key | OCPP `AuthorizationKey` = the per-charger `password` exposed in the EAPI `ChargePoint.password` field |
| Firmware floor | OCPP support requires **firmware ≥ 158** (per eCarUp guide); **184+** is recommended on Halo (connection watchdog, ISO15118 BCB wakeup) |
| Validated CSMS list | Charge Amps publishes a list of "validated" third-party CPMS (Monta, eCarUp, ChargePanel, E-Flux, …). Whether Straumvakt would need formal validation to be configurable in the partner portal is unverified — `wss://` URL fields are typically free-form |

> **CAPI vs OCPP mutual exclusion.** The Halo "cannot maintain simultaneous Cloud and OCPP connections" — once OCPP is enabled, the Charge Amps Cloud (CAPI) connection drops. **Customers will lose the Charge Amps app's live-control features in exchange for Straumvakt control.** Document this clearly in onboarding.

See [`ocpp-1.6j.md`](ocpp-1.6j.md) for the shared 1.6J vocabulary.

---

## 6. Real-time push

- **EAPI does NOT publish a webhook, SignalR hub, or WebSocket subscription endpoint.** Public docs and the kirei Python client expose **only polling** of `/api/v5/chargepoints/{id}/status` and `/chargingsessions`.
- Charge Amps' own apps almost certainly use a SignalR/WebSocket channel internally — the cloud is .NET-stack and their UIs update live — **but no such endpoint is documented in public Swagger.**
- **Therefore for Straumvakt:** **do not integrate via the EAPI for live operations.** Use the EAPI only for fleet/admin tasks — listing chargers, reading historical sessions, remote start during manual support. The realtime path is **OCPP** — same model as Easee/Zaptec when you hand off to OCPP.

---

## 7. Onboarding — partner cloud → Straumvakt (zero-touch OTA)

This is Charge Amps' best feature for a CPMS like Straumvakt.

### 7.1 Standard flow

1. **Partner registration**
   - Partner self-registers at `my.charge.space/partner/` ("Become a Partner" link from `chargeamps.com/become-a-partner/`).
   - Approval up to 24 working hours.
   - **Apply separately** for an EAPI `apiKey` via Charge Amps Support if Straumvakt wants to programmatically read fleet metadata.
2. **Charger provisioning by installer**
   - Installer commissions the unit, joins it to customer Wi-Fi or 4G, and registers it under an Admin organisation in Charge Amps Cloud.
3. **Bulk import (optional)**
   - Admins can upload a CSV of chargers in the Admin interface to create many devices at once.
4. **OCPP cutover (the OTA part)**
   - Partner / Admin opens the charger in `my.charge.space`, enables OCPP, and pastes the **Straumvakt CSMS URL** (`wss://...`) and any OCPP password into the partner portal.
   - Charge Amps pushes the configuration OTA; the charger reboots and reconnects to Straumvakt.
   - Charger goes offline briefly and reappears automatically — **no on-site visit required**.
5. **Ongoing firmware updates**
   - Partners can trigger firmware upgrades via the Partner Portal without contacting Charge Amps Support — useful for keeping a Straumvakt-managed fleet on a current OCPP-stable build (e.g., Halo fw184+).

> **Implication.** Because the OCPP URL is settable remotely from the partner portal, **Straumvakt onboarding for Charge Amps fleets is effectively zero-touch** — the customer signs up, hands their Charge Amps Cloud admin login (or partner ownership) to the integrator, and the OCPP URL flips. Closer to Zaptec's "claim it in Zaptec Portal" model than Easee's per-device dance.

---

## 8. End-user authentication at the charger

| Mode | Status |
|---|---|
| RFID | Built-in on Halo, Aura, Dawn. **ISO/IEC 14443 Type A (MIFARE), 13.56 MHz**. Aura RF reader 31 dBm |
| Cards/tags managed via | Charge Amps Cloud (Admin UI) when on CAPI; CSMS (Straumvakt) when on OCPP — `idTag` flows in `Authorize` / `StartTransaction` |
| Mobile app start/stop | "Charge Amps" / "My Charge Space" — becomes a viewer once a third-party CPMS is in front of the charger via OCPP |
| Plug & Charge / Autocharge | Halo fw184 added ISO 15118 BCB-wakeup; full ISO 15118 PnC unverified (1.6J doesn't carry it natively) |
| App-based start without RFID | Yes via Charge Amps Cloud or via the EAPI `remotestart` endpoint (accepts a `StartAuth` body to inject an RFID-equivalent identifier for traceability) |

---

## 9. Local interface

| Interface | Status |
|---|---|
| Local web UI | Wi-Fi hotspot mode (`HALO-<serial>` SSID) → browser to `192.168.250.1` → PIN from supplied letter. Used for first-time Wi-Fi join and OCPP URL config |
| Modbus TCP | unverified — no public Modbus register map. evcc lists Charge Amps via Cloud REST API, not Modbus TCP |
| Service / installer | Same local web UI + partner portal. No separate installer-only port like Alfen's service connector |
| Sidecar — Amp Guard / Power Guard | Charge Amps sells a separate dynamic-load-management module that pairs with the charger to do household current limiting. Configured through Charge Amps Cloud — relevant if customers want DLM that survives the OCPP cutover |

---

## 10. OCMF / signed metering / Eichrecht

| Model | MID | OCMF / Eichrecht |
|---|---|---|
| Halo | unverified (not explicitly on public product page) | No |
| Aura | **Yes — MID per socket** | No |
| Dawn (standard) | Yes — MID | No |
| **Dawn Professional DE** | Yes — MID | **Fully Eichrecht-certified** — implies OCMF, transport unverified |

For Iceland: Eichrecht is not a regulatory requirement. Standard Aura/Dawn MID metering should be sufficient for billing CDRs. Document MID + per-phase MeterValues over OCPP as the metering source.

If a customer brings a Dawn Professional DE, contact Charge Amps Support for the Eichrecht integration spec — the transport (OCPP `MeterValues` extension vs out-of-band channel to a transparency tool) is not in public docs.

---

## 11. Live findings

*(empty — first probe of a real Charge Amps charger fills this section.)*

After commissioning the first Charge Amps charger to Straumvakt's gateway, capture:

- BootNotification payload (firmware version, model, serial, ICCID).
- Full `GetConfiguration` response → which Charge Amps-extended keys exist.
- StatusNotification payloads on plug events → `errorCode` strings used.
- MeterValues during a test session → measurands, sampling cadence; for Dawn Professional DE, OCMF presence.
- Aura connector-2 transaction sanity check (early-firmware caveat).
- Halo Schuko-vs-Type 2 metering glitches (don't bill Schuko via OCPP).
- Reset semantics → `Reset(Hard)` reconnect cleanliness.

---

## 12. Companion docs

- [`README.md`](README.md) — vendor catalogue index
- [`ocpp-1.6j.md`](ocpp-1.6j.md) — shared OCPP 1.6J protocol reference
- [`ocmf.md`](ocmf.md) — OCMF format (relevant for Dawn Professional DE)
- [`zaptec.md`](zaptec.md) — sister AC vendor with full Cloud API + live integration
- [`easee.md`](easee.md) — sister AC vendor with REST API + SignalR push
- [`alfen.md`](alfen.md) — sister AC vendor that is OCPP-primary (no public Cloud API)

External:

- [Charge Amps EAPI Swagger](https://eapi.charge.space/swagger) — live OpenAPI definition
- [`kirei/python-chargeamps`](https://github.com/kirei/python-chargeamps) — reference Python client; mirror its auth flow + Pydantic models
- [`kirei/hass-chargeamps`](https://github.com/kirei/hass-chargeamps) — Home Assistant integration

---

## 13. Pricing / commercial

| Aspect | What's known |
|---|---|
| EAPI access | **Partner-gated** — `apiKey` issued by Charge Amps Support after a partner agreement. No public price list — unverified whether free or tiered |
| OCPP feature gating | No paid OCPP add-on — flipping a charger to a third-party OCPP backend through the partner portal does not appear to incur a license fee in public materials |
| Cloud subscription | Basic features bundled with hardware; advanced features (load balancing, dynamic pricing, partner-portal admin tools) are tier-gated; specific pricing unverified |
| Hardware list price (EU retail snapshot) | Halo 11 kW T2+Schuko OCPP ≈ €700–900 · Aura 2×22 kW ≈ €1,800–2,200 · Dawn 22 kW ≈ €1,500–1,800 — verify with Iceland reseller |

---

## 14. Quirks / known issues an integrator must know

1. **CAPI vs OCPP mutual exclusion.** Once moved to OCPP, the Charge Amps Cloud (CAPI) connection no longer works simultaneously. Customers lose the Charge Amps app's live-control features in exchange for Straumvakt control. Document this clearly in onboarding.
2. **Halo Schuko outlet is NOT a second OCPP connector.** Local-logic only; yields to Type 2 when an EV is plugged in. **Don't bill Schuko energy via OCPP CDRs.**
3. **Aura connector indexing.** `connectorId` 1 and 2 under OCPP. Some early-firmware reports of `connectorId 2` not transacting correctly — require recent firmware.
4. **Halo OCPP connection stability historically weak.** Community testing reported Halo dropping the OCPP socket every ~2 minutes on older firmware; **fw184 added a connection watchdog**. Insist on fw184+ for Halo deployments.
5. **Remote start with RFID-lock enabled.** If `rfidLock=true` on the connector and OCPP RemoteStartTransaction is sent without a matching idTag, charging is "accepted but paused." Either disable RFID lock pre-OCPP, or always include a valid `idTag` in the start request. Decide a Straumvakt policy: own the RFID list (recommended) or always send the driver's idTag.
6. **Stop transaction quirks.** Some integrations report that stopping via CSMS doesn't always cleanly halt the session and "Charging control" reverts. Workaround: `ChangeConfiguration` to set max current to 0 A, or fall back to the EAPI's `remotestop`. **Build a stop-with-fallback path.**
7. **EAPI token lifetime.** JWT is **120 minutes**; refresh proactively (kirei lib uses a 30 s skew). On `401`, full re-login (not just refresh) is the correct recovery.
8. **JWT decoded without signature verification on the client.** Treat the token as opaque; trust transport-layer security; decode only for `exp`. Mirror that pattern in the Straumvakt repository.
9. **Pagination.** Public Swagger v5 endpoints don't expose explicit paging keys in the kirei client. Likely uses `startTime` / `endTime` window filtering rather than cursor pagination. **For large historical pulls, page by time window.**
10. **No separate sandbox.** Public docs do not list a staging/sandbox EAPI. Partners test against production with their own apiKey + a test charger or virtual charge point.
11. **NaaS Technology ownership change (2023).** Roadmap stewardship has shifted; check that the OCPP 1.6J → 2.0.1 roadmap and partner portal stability remain priorities at contract time.

---

## 15. Production-adapter checklist (when Straumvakt builds one)

| Concern | Action |
|---|---|
| Vendor row | `hardware.vendors`: `slug=chargeamps`, `kind=charger_ac` |
| Credential scope | `installation` for the EAPI key; OCPP path is `none`-scope |
| Models | Seed `hardware.models` rows for Halo, Aura, Dawn (+ Dawn Professional DE for Eichrecht customers) |
| OCPP gateway | Reuse `straumvakt-ocpp` worker |
| Auth | EAPI = `apiKey` header + email/password login → JWT (120 min) + refreshToken; refresh ~30 s before `exp`; full re-login on 401 |
| Token storage | Treat JWT as opaque; decode only for `exp` |
| Push channel | None — EAPI polls `chargepoints/{id}/status` (don't); OCPP push is the realtime mechanism |
| Pagination | Time-window via `startTime`/`endTime` for `chargingsessions` |
| Stop fallback | OCPP `RemoteStopTransaction` → if not honoured, `ChangeConfiguration` MaxCurrent=0 → if not honoured, EAPI `remotestop` |
| Halo policy | Don't bill Schuko; require fw184+ |
| Aura policy | Require recent firmware; both connector IDs validated |
| Live findings | Update §11 after first commissioning probe |

---

## 16. Sources

REST API surface and auth flow (verified from live Swagger and source code):

- [Charge Amps EAPI Swagger UI](https://eapi.charge.space/swagger)
- [`kirei/python-chargeamps`](https://github.com/kirei/python-chargeamps) — Apache, well-maintained
- [`chargeamps/external.py`](https://raw.githubusercontent.com/kirei/python-chargeamps/main/chargeamps/external.py)
- [`chargeamps/base.py`](https://raw.githubusercontent.com/kirei/python-chargeamps/main/chargeamps/base.py)
- [`chargeamps/models.py`](https://raw.githubusercontent.com/kirei/python-chargeamps/main/chargeamps/models.py)
- [`kirei/hass-chargeamps`](https://github.com/kirei/hass-chargeamps)
- [PyPI `chargeamps` package](https://pypi.org/project/chargeamps/)

Charge Amps Cloud and partner portal:

- [Charge Amps Cloud overview](https://www.chargeamps.com/cloud/)
- [My Charge Space (end-user)](https://my.charge.space/)
- [My Charge Space (admin)](https://my.charge.space/admin/)
- [My Charge Space (partner)](https://my.charge.space/partner/)
- [Become a Partner](https://www.chargeamps.com/become-a-partner/)
- [New Partner account](https://support-se.zendesk.com/hc/en-us/articles/10777333198748-New-Partner-account-how-to-create)
- [OCPP log states (Charge Amps support)](https://support-se.zendesk.com/hc/en-us/articles/12473740617116-OCPP-log-states-Charge-Amps-chargers)
- [Aura LED status under OCPP](https://support-se.zendesk.com/hc/en-us/articles/12537595245084-LED-status-and-lights-for-OCPP-Charge-Amps-Aura)
- [Firmware updates page](https://www.chargeamps.com/firmware-updates/)
- [Firmware upgrade article](https://support-se.zendesk.com/hc/en-us/articles/10374372710044-Firmware-upgrade-FW)

OCPP migration:

- [Migration to OCPP — article](https://www.chargeamps.com/article/migration-to-ocpp/)
- [Migration to OCPP — support article](https://support-se.zendesk.com/hc/en-us/articles/15615916601756-Migration-to-OCPP)
- [OCPP migration PDF (Aug 2024)](https://wwwchargeampscom.cdn.triggerfish.cloud/uploads/2024/08/ChargeAmps_OCPP-Migration_V3_Admins-Users-20240829.pdf)
- [Halo fw184 release notes](https://wwwchargeampscom.cdn.triggerfish.cloud/uploads/2025/02/Charge-Amps-Halo-fw184-release-notes.pdf)

Product pages and datasheets:

- [Halo](https://www.chargeamps.com/product/charge-amps-halo/)
- [Aura](https://www.chargeamps.com/product/charge-amps-aura/)
- [Dawn](https://www.chargeamps.com/product/charge-amps-dawn/)
- [Dawn Professional](https://www.chargeamps.com/product/charge-amps-dawn-professional/)
- [Dawn Professional DE Eichrecht press release](https://www.chargeamps.com/press/charge-amps-dawn-professional-de-now-fully-eichrecht-certified/)
- [4G connectivity module](https://www.chargeamps.com/product/4g-connectivity/)
- [Products overview](https://www.chargeamps.com/products/)

Third-party CPMS integration guides:

- [Monta — Charge Amps OCPP install guide](https://monta.com/en/help-center/charge-amps-installation-guide-ocpp/)
- [Monta — Aura OCPP](https://monta.com/en/supported-charge-points/charge-amps-aura-ocpp/)
- [Monta — Dawn OCPP](https://monta.com/en/supported-charge-points/charge-amps-dawn/)
- [eCarUp / Smart-me wiki — Charge Amps OCPP](https://sites.google.com/smart-me.com/wiki-english/ocpp/charge-amps)
- [E-Flux — Charge Amps manual](https://help.e-flux.io/en/articles/8455510-manual-charge-amps)
- [ChargePanel vendor page](https://www.chargepanel.com/vendors/charge-amps/)

Community / OCPP testing reports:

- [`lbbrhzn/ocpp` Discussion #816](https://github.com/lbbrhzn/ocpp/discussions/816)
- [evcc Halo discussion](https://github.com/evcc-io/evcc/discussions/3624)
- [evcc Halo timeout issue](https://github.com/evcc-io/evcc/issues/15943)
- [Home Assistant community thread](https://community.home-assistant.io/t/support-for-chargeamps-my-charge-space/167695)

Standards context:

- [OCA — Signed Meter Values (Eichrecht) paper](https://openchargealliance.org/ocpp-info-whitepapers/signed-meter-values-eichrecht-paper/)
- [OCMF specification](https://github.com/SAFE-eV/OCMF-Open-Charge-Metering-Format/blob/master/OCMF-en.md)
