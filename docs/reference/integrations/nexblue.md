# NexBlue — CPMS integration reference

**Status:** documentation-derived; no production adapter wired yet.
**Research date:** 2026-05-02 (refreshed against live OpenAPI 0.1.0).
**V3 schema class:** `Hardware / Chargers` — `HardwareVendorKind = charger_ac`, `HardwareModel.kind = charger_ac`, asset extends `assets.site_assets` via `assets.chargers`.
**V3 credential scope:** `installation` once a partner OAuth2 client is provisioned; `none` for OCPP-only operation.
**Companion file:** [`nexblue-openapi.json`](nexblue-openapi.json) — captured 2026-05-02 from `https://prod-management.nexblue.com/swagger/dist/openapi_gen.json`. Regenerate from the same source rather than hand-editing.
**Live Swagger UI:** `https://prod-management.nexblue.com/swagger/dist/index.html`

> [!IMPORTANT]
> NexBlue's OpenAPI is **public** (despite earlier research suggesting otherwise) and reachable at the URL above. **However:** the surface is shaped for the **end-user / installer / owner** access model (one principal, one or many chargers they control), **not** the partner-CPMS model. There is no endpoint to create a Place, register a user, manage RFID groups, or push the OCPP backend URL — those are app-driven. The integration path Straumvakt should commit to remains **OCPP 1.6J / 2.0.1**, with the public REST as a side-channel for chargelog ingest and energy reconciliation when the customer grants installer credentials.

---

## 1. Vendor profile

| Field | Value |
|---|---|
| Brand | NexBlue |
| Legal entities | NexBlue AS (Sandnes, Norway) · NexBlue AB (Stockholm) · NexBlue Ltd (London) · office in Eindhoven, NL |
| Founded | 2021 (per company marketing — unverified against registry) |
| Hardware tier | Residential + light commercial / destination AC |
| Geographic focus | UK, Norway, Sweden, Netherlands (regional storefronts under `/en-uk/`, `/en-no/`, `/en-dk/`, `/lv/`, …) |
| Iceland presence | None observed — would import via Norway or UK channel |
| OCPP versions | 1.6J **and** 2.0.1 (one of few residential-tier vendors shipping 2.0.1) |
| Cloud platform | NexBlue Cloud — Partner Portal (installer), myNexBlue App (end-user) |
| Distinctive features | "Local OCPP" architecture · always-on connectivity (Ethernet + Wi-Fi + 4G eSIM) · iF Design Award 2024 · ISO 15118 hardware-readiness on Edge 2 / Edge Max / Delta / Delta Max |

**"Local OCPP"** is NexBlue's marketing term for *the OCPP client runs on the charger firmware and dials the operator's CSMS directly* — there is no NexBlue-side OCPP proxy in the data path. Architecturally identical to Alfen's OCPP-primary stance, but with a working remote-configuration channel via the NexBlue cloud (which Alfen lacks).

---

## 2. Models in scope

All current models are **Type 2 AC**. NexBlue does not produce DC chargers.

| Model | Phase / Power | MID meter | OCMF | ISO 15118 / V2G | Notes |
|---|---|---|---|---|---|
| **Point** | 1-phase, ≤ 7.4 kW | unverified | unverified | No | Residential, UK focus (legacy) |
| **Point 2** | 1-phase, ≤ 7.4 kW | Yes (MID, "legally accurate") | unverified | "Ready" | IP54, IK10, PEN fault detection, RDC-DD 6 mA DC |
| **Edge** | 1- or 3-phase, ≤ 22 kW | No | No | No | Entry tier, no Ethernet on the original Edge |
| **Edge 2** | 1- or 3-phase, ≤ 22 kW | No | No | "Hardware ready" | Adds Ethernet RJ45; remote 1p↔3p phase switch via cloud API |
| **Edge Max** | 1- or 3-phase, ≤ 22 kW | **Yes — MID Class B ±1%** | unverified | "Ready (V2G + PnC)" | OLED display; small-site billing-grade tier |
| **Delta** | 1- or 3-phase, ≤ 22 kW | unverified | unverified | "V2G ready" | |
| **Delta Max** | 1- or 3-phase, 1.4–22 kW | **Yes — MID Class B** | unverified | "Ready (V2G + PnC)" | Display, premium tier |
| **Infinity / Infinity Max / Infinity Pro** | unverified | unverified | unverified | unverified | Three SKUs declared in the live OpenAPI `ChargerProductName` enum but not on the public storefront — newer / region-restricted line |
| **Point Max / Point Max (UK)** | unverified | unverified | unverified | unverified | Declared in OpenAPI; presumably mid-tier between Point 2 and Edge |

The full `ChargerProductName` enum (17 SKUs) lives in [`nexblue-openapi.json`](nexblue-openapi.json) §`components.schemas.ChargerProductName` — re-export from the live spec when it changes, do not hand-edit. Most SKUs ship in both global and UK-regulated variants (suffix `_uk`).

Common platform: Ethernet 10/100, Wi-Fi 2.4 GHz 802.11 b/g/n, 4G LTE Cat 1 eSIM, BLE 4.2, "Nexus RF" sub-GHz (proprietary, possibly cluster load-balancing — undocumented).

> **OCMF caveat.** MID certification (Measuring Instruments Directive) is an accuracy-class statement. It is **not** the same as German Eichrecht-grade signed metering with OCMF blobs in `transactionData.meterValueSignature`. NexBlue does not advertise OCMF / Chargy-Transparenzsoftware compatibility anywhere public. Treat OCMF as **absent** until proven otherwise; for Iceland this is acceptable, but flag for any OCPI-CDR roaming push.

---

## 3. Cloud surfaces

| Surface | Audience | URL |
|---|---|---|
| NexBlue Partner Portal | Installers, fleet operators | `partner.nexblue.com` |
| NexBlue Partner App | Installers (BLE/Wi-Fi commissioning) | iOS app id `1663398619`, Android equivalent |
| myNexBlue App | End users | iOS app id `6444075862`, Android equivalent |
| NexBlue User Portal | End users (web) | linked from `nexblue.com/pages/nexblue-user-portal` (subdomain unverified) |
| Help Center | All | `nexblue.com/apps/hc/...` |
| Integration guides | Operators / installers | `nexblue.com/pages/integration-guide` |

Public **developer / API** docs URL: **none indexed**.

---

## 4. REST API surface — public OpenAPI 3.0.2

NexBlue publishes a Swagger UI at `https://prod-management.nexblue.com/swagger/dist/index.html` backed by the OpenAPI document at `https://prod-management.nexblue.com/swagger/dist/openapi_gen.json`. The companion artifact [`nexblue-openapi.json`](nexblue-openapi.json) in this folder is a snapshot taken 2026-05-02.

### 4.1 Service shape

| Aspect | Value |
|---|---|
| OpenAPI version | 3.0.2 · NexBlue OpenAPI v0.1.0 |
| Base URL (prod) | `https://api.nexblue.com/third_party` |
| All paths prefixed | `/openapi/...` (so e.g. `https://api.nexblue.com/third_party/openapi/chargers`) |
| Tags | `oauth2_endpoint`, `account`, `charger`, `charger commands`, `charger sessions`, `energy reporting` |
| Endpoint count | 14 |

### 4.2 Authentication — two flows

NexBlue exposes **both** an OAuth2 authorization-code flow (for partner integrations / authorized third-party apps) and a direct **username + password login** (for installer / owner principals).

**OAuth2 (formal):**

| Endpoint | Purpose |
|---|---|
| `GET  /openapi/oauth2/authorize` | Authorize URL · authorization_code flow · **no PKCE** |
| `POST /openapi/oauth2/token` | Token exchange · grant types: `authorization_code`, `refresh_token`, `client_credentials` |

The OpenAPI declares two security schemes:

```json
"oauth2": {
  "type": "oauth2",
  "flows": {
    "authorizationCode": {
      "authorizationUrl": "https://api.nexblue.com/third_party/openapi/oauth2/authorize",
      "tokenUrl": "https://api.nexblue.com/third_party/openapi/oauth2/token",
      "scopes": {}
    }
  }
},
"api_key": {
  "type": "apiKey",
  "in": "header",
  "name": "Authorization"
}
```

**Username + password (account flow):**

```
POST /openapi/account/login
Body: {
  "username": "<email>",
  "password": "<password>",
  "account_type": 0   // 0 = end_user, 1 = installer
}
Returns: {
  "access_token": "<bearer>",
  "refresh_token": "<refresh>",   // 30-day lifetime
  "expires_in": 3600,             // seconds
  "token_type": "Bearer"
}
```

```
POST /openapi/account/refresh_token
```

Subsequent calls send `Authorization: <access_token>` as an apiKey header (the OpenAPI declares this as `apiKey` not `bearer` — case-sensitive).

### 4.3 Endpoint catalogue

| Method | Path | Tag | Purpose |
|---|---|---|---|
| `GET`    | `/openapi/oauth2/authorize` | `oauth2_endpoint` | OAuth2 authorize endpoint (no PKCE) |
| `POST`   | `/openapi/oauth2/token` | `oauth2_endpoint` | OAuth2 token endpoint — auth_code / refresh / client_credentials |
| `POST`   | `/openapi/account/login` | `account` | Username/password login (end_user or installer) |
| `POST`   | `/openapi/account/refresh_token` | `account` | Refresh access token |
| `GET`    | `/openapi/chargers` | `charger` | List chargers the principal can use |
| `GET`    | `/openapi/chargers/{charger_id}` | `charger` | Charger detail — serial, role, place, circuit, online, product, OCPP data |
| `GET`    | `/openapi/chargers/{charger_id}/cmd/status` | `charger commands` | Current status + configuration |
| `POST`   | `/openapi/chargers/{charger_id}/cmd/start_charging` | `charger commands` | Start a charging session as the current user |
| `POST`   | `/openapi/chargers/{charger_id}/cmd/stop_charging` | `charger commands` | Stop the charging session as the current user |
| `POST`   | `/openapi/chargers/{charger_id}/cmd/set_current_limit` | `charger commands` | Set the current limit |
| `GET`    | `/openapi/chargers/{charger_id}/cmd/schedule` | `charger commands` | Get schedule details |
| `PUT`    | `/openapi/chargers/{charger_id}/cmd/schedule` | `charger commands` | Add / update a schedule item |
| `DELETE` | `/openapi/chargers/{charger_id}/cmd/schedule` | `charger commands` | Delete a schedule item |
| `PUT`    | `/openapi/chargers/{charger_id}/cmd/schedule/config` | `charger commands` | Update schedule configuration |
| `GET`    | `/openapi/sessions/charger/{charger_id}` | `charger sessions` | **Chargelogs** — Installer + Owner get all sessions; Invited users see only their own |
| `GET`    | `/openapi/measurement/chargers/{charger_id}` | `energy reporting` | Aggregated kWh consumption (hourly / daily granularity) |

### 4.4 Key data shapes

**`ChargerSession`** (the chargelog row Straumvakt would consume for billing):

```ts
interface ChargerSession {
  start_timestamp: number;     // unix
  end_timestamp: number;
  consumption: number;         // kWh
  start_reason: "Local" | "Remote" | "Admin" | "Schedule" | "None" | "ErrorRecover" | "PlugAndCharge";
  stop_reason:
    | "EmergencyStop" | "EVDisconnected" | "HardReset" | "Local" | "Other"
    | "PowerLoss" | "Reboot" | "Remote" | "SoftReset" | "UnlockCommand"
    | "DeAuthorized" | "Admin" | "Schedule" | "None" | "LB_Required" | "Complete";
  operator_type: 0 | 1 | 2 | 3;  // NexBlue / Enegic / NexBlueZen / OCPP
}
```

**`ChargerDetail`** (returned by `GET /openapi/chargers/{charger_id}`):

```ts
interface ChargerDetail {
  serial_number: string;
  pin_code?: string;             // owner / installer only
  role?: -1 | 0 | 1 | 2;         // installer / owner / user / admin (end_user only)
  place_data: PlaceData;         // address, currency, country, timezone, fuse, grid type
  circuit_data: CircuitData;     // place_id, circuit_id, name, fuse, charger serials
  online: boolean;
  product_name: ChargerProductName;  // 17-SKU enum (see §2)
  device_operator_type: 0 | 1 | 2 | 3;  // NexBlue / Enegic / NexBlueZen / OCPP
  ocpp_data?: { endpoint_url: string; password: string };  // populated when device_operator_type=3
}
```

> **Read OCPP URL via API, not write.** `ChargerDetail.ocpp_data.endpoint_url` is exposed when the charger is in OCPP mode (`device_operator_type=3`). **There is no endpoint to set this URL** — that remains a Partner App / myNexBlue App action. The API is the audit channel, not the cutover channel.

**`ChargerStatus`** enum (returned by `/cmd/status`):

```
0 = idle
1 = connected
2 = charging
3 = finished
4 = error
5 = lb_waiting
6 = delay_waiting
7 = ev_waiting
```

**`PlaceData.operator_type`** enum (33 known partner CPMSs):

```
NexBlue, Enegic, NexBlueZen, Monta, CustomOCPP, Wevo, Electriease, Fuuse,
Drivee, Current, ClenergyEV, Flexibility, TapElectric, Sintio, Eosvolt,
Karnfull, Voltshare, eOne, Chargespot, PowerFuel, ElectricMiles, EFlux,
Spirii, EVchargingcloud, ev_energy, VanMosselEnergieNL, VanMosselEnergyBE,
Stark, reev, enkel, eMabler, Virta
```

A new partner CPMS is presumably appended to this enum via NexBlue support; **`CustomOCPP` (=4)** is the catch-all for partners not formally enumerated. Straumvakt would land under either a new dedicated value or `CustomOCPP` initially.

**`PlaceData.currency`** enum confirms Iceland support — `ISK` is one of 12 supported currencies (alongside EUR, DKK, NOK, GBP, SEK, CHF, USD, AUD, ILS, PLN, TRY).

### 4.5 What's *not* in the public OpenAPI

These are the gaps Straumvakt has to bridge through OCPP or app-driven flows:

| Missing capability | What this means |
|---|---|
| `POST /openapi/places` | No way to create a Place via API — must be done through Partner App on-site commissioning |
| `POST /openapi/circuits` | Same — circuit topology is set during commissioning |
| User invitation / role assignment | No `POST /users` or `/places/{id}/users`. Owner adds users via the Partner Portal / app |
| RFID list management | Not in the OpenAPI. RFID is managed in the app; under OCPP, delegated to CSMS via `Authorize` |
| Set OCPP backend URL | Not exposed as a write endpoint — readable via `ChargerDetail.ocpp_data` only |
| Webhook subscription | None. Clients poll `/cmd/status` and `/sessions/charger/{id}` |
| Fleet metrics across chargers | Energy reporting is per-charger only — Straumvakt aggregates client-side |

> **Bottom-line implication.** The public OpenAPI is shaped for **end-user / installer / owner** access, not partner CPMS. For Straumvakt this is fine as a chargelog + energy reconciliation channel **once a customer hands their installer credentials over** (or registers an OAuth2 client_credentials grant), but onboarding (places, users, RFID groups) still flows through the Partner App. OCPP remains the live channel.

---

## 5. OCPP support — primary path

This is the integration shape Straumvakt should commit to.

### 5.1 Versions and architecture

| Aspect | Value |
|---|---|
| OCPP versions | 1.6J **and** 2.0.1 (both shipping in firmware ≥ 1.1.2) |
| Transport | WebSocket (WS / WSS) |
| Topology | Charger → operator CSMS direct, no NexBlue gateway in path ("Local OCPP") |
| Backend URL configurability | **Yes, OTA** via myNexBlue App or Partner App |
| OCPP auth | Basic-Auth username + password (key) — exact field names unverified |

### 5.2 Firmware / app prerequisites

Per NexBlue's "Install OCPP on the NexBlue charger" guide:

- Charger firmware ≥ 1.1.2
- NexBlue Partner App ≥ 3.3.1
- myNexBlue App ≥ 3.2.0

Once activated, the charger's app screen reads **"Customized OCPP platform"** and the connection is established directly to the operator's `wss://` URL.

### 5.3 What's known about the OCPP profile

The OCPP profile is the standard 1.6J vocabulary (28 messages: BootNotification, Heartbeat, StatusNotification, MeterValues, StartTransaction, StopTransaction, ChangeConfiguration, ChangeAvailability, RemoteStart/StopTransaction, Reset, GetConfiguration, etc.). NexBlue-specific config keys, MeterValueSampledData defaults, and any vendor-extended `DataTransfer` patterns are **unverified** — capture them on first BootNotification + GetConfiguration probe and append a §5.4 once observed.

See [`ocpp-1.6j.md`](ocpp-1.6j.md) for the shared vocabulary that applies to every AC vendor in this catalogue.

---

## 6. Real-time push

| From | To | Mechanism |
|---|---|---|
| Charger | Operator CSMS | OCPP over `wss://` (primary path Straumvakt terminates) |
| NexBlue Cloud | Third-party systems | **none** — OpenAPI does not expose webhooks, SSE, or WebSocket subscription. Clients poll `/cmd/status` + `/sessions/charger/{id}` |
| NexBlue Cloud | Its own apps | internal, not exposed |

For chargelog ingest at billing-grade latency, **wire OCPP `StopTransaction` from Straumvakt's gateway as primary** and use `GET /openapi/sessions/charger/{charger_id}` for periodic reconciliation (every few hours) — not as the live channel.

---

## 7. Onboarding

NexBlue chargers cannot be aimed at a third-party CSMS straight from the factory. The two-step flow:

### Step 1 — initial commissioning (on-site, NexBlue tooling)

1. Trained installer scans the QR / enters PIN from the install manual using the **Partner App**.
2. Installer pairs over BLE / Wi-Fi.
3. Installer attaches the charger to a customer Wi-Fi (or defers to the eSIM).
4. Installer sets phase rotation.
5. Charger registers in the **Partner Portal** under the customer's location.

A *pre-stage in Portal* path is referenced by NexBlue (*"NexBlue Products must be installed by trained Installers using the Partner App or be pre-configured using the tool in the Portal"*) but the procedural detail is unverified.

### Step 2 — point at Straumvakt's CSMS (OTA, no on-site revisit)

Done by either:
- the installer in the **Partner App** ("Install OCPP" → enter Straumvakt's `wss://` URL + ChargePoint identity + auth key); or
- the end-user in **myNexBlue** ("Customized OCPP platform" → same fields).

Once saved the charger reconnects to Straumvakt's gateway within seconds. **No electrician revisit required.**

> **Implication.** Straumvakt's NexBlue onboarding flow does not need a vendor-cloud credential exchange — it needs to surface the operator's OCPP wss URL, identity, and password to the customer or installer in a copy-pasteable form, and walk them through the four-screen sequence in NexBlue's own app.

---

## 8. End-user authentication at the charger

| Mode | Status |
|---|---|
| RFID (ISO/IEC 14443) | Yes — admin and guest card classes, one card shipped per unit |
| Mobile NFC | Yes (compatible 14443 emulation) |
| myNexBlue app start/stop | Yes (cloud-relayed) |
| Plug-and-Charge (ISO 15118-2) | "Hardware ready" on Edge 2 / Edge Max / Delta / Delta Max — Monta claims it works on Edge today; treat as "validate per firmware" |
| ISO 15118-20 (V2G) | Marketed as future capability, not certified |
| Free-vend / no-auth | unverified, probably configurable in commissioning |

---

## 9. Local interface

| Interface | Status |
|---|---|
| Modbus TCP | unverified — no public Nexblue Modbus document surfaced |
| Modbus RTU | unverified |
| Local web UI | unverified — no screenshots indexed |
| Service tech BLE | Yes — via Partner App (also pulls PIN from Portal if lost) |
| External CT clamp | Yes — for load balancing on the mains feed |
| Smart-meter input | Pairs with **Zen Smart Meter P1** (Dutch P1 port) — proprietary EMS signal, not Modbus |
| Nexus RF (sub-GHz) | proprietary, undocumented; possibly cluster load-balancing |

**The preferred local-energy-management path on NexBlue is CT clamp + P1 smart meter, not third-party Modbus.** This matters when designing site-level load management — Straumvakt should not assume Modbus is the integration surface here.

---

## 10. Live findings

*(empty — first probe of a real NexBlue charger fills this section, mirroring the §10 pattern in `zaptec.md` and `easee.md`.)*

After commissioning the first NexBlue charger to Straumvakt's gateway, capture:

- BootNotification payload (firmware version string, model, serial, ICCID).
- Full GetConfiguration response → vendor-extended keys, defaults.
- StatusNotification payloads on plug events → `errorCode` strings used.
- MeterValues during a test session → which `measurand` values are emitted, sampling cadence, OCMF presence/absence in `transactionData`.
- Reset semantics → does `Reset(Hard)` survive BLE/Wi-Fi reconnect cleanly?

---

## 11. Companion docs

- [`nexblue-openapi.json`](nexblue-openapi.json) — full OpenAPI 3.0.2 snapshot (captured 2026-05-02). Regenerate from `https://prod-management.nexblue.com/swagger/dist/openapi_gen.json` rather than hand-editing
- [`README.md`](README.md) — vendor catalogue index
- [`ocpp-1.6j.md`](ocpp-1.6j.md) — OCPP 1.6J shared protocol reference
- [`zaptec.md`](zaptec.md) — sister AC vendor with full Cloud API + live integration
- [`alfen.md`](alfen.md) — sister AC vendor that is similarly OCPP-primary (no public Cloud API)
- [`chargeamps.md`](chargeamps.md) — sister AC vendor with the cleanest OTA OCPP-URL channel + a documented EAPI

External:
- [Live Swagger UI](https://prod-management.nexblue.com/swagger/dist/index.html) — re-fetch when NexBlue ships endpoints (the OpenAPI document version is currently 0.1.0, so expect churn)
- [`AndrewBarber/nexblue_hass`](https://github.com/AndrewBarber/nexblue_hass) — Home Assistant integration. Its `docs/api/` directory bundles the same OpenAPI; uses a username/password login flow against `/openapi/account/login`
- [`evcc-io/evcc#27975`](https://github.com/evcc-io/evcc/issues/27975) — confirms the cloud API plus phase-switching behaviour on Edge 2 (note: phase switch is **not** in the public OpenAPI — likely a private endpoint or a `/cmd/set_current_limit` derivative)

---

## 12. Pricing / commercial considerations

| Aspect | What's known |
|---|---|
| Hardware purchase channel | Direct from `nexblue.com` regional storefronts + resellers (Yesss UK, Phase Renewables, Skårebo, Bronlux, …) |
| OCPP feature gating | Not publicly priced; **"approved OCPP or API connection"** in T&C suggests partner approval, possibly fee-based per CPMS partner — confirm with NexBlue Partner support before public launch |
| Cloud subscription | unverified — no paid tier surfaced for myNexBlue |
| 4G eSIM data plan | unverified lifetime / inclusion terms |
| Partner Portal fee | Free for certified installers (per FAQ) |

---

## 13. Production-adapter checklist (when Straumvakt builds one)

| Concern | Action |
|---|---|
| Vendor row | `hardware.vendors` entry: `slug=nexblue`, `kind=charger_ac` |
| Credential scope | `installation` once a partner OAuth2 client (`client_credentials` grant) is provisioned. Falls back to per-customer installer username/password via `/openapi/account/login` (`account_type=1`) for tenants who don't go through partner registration |
| Models | Seed `hardware.models` rows for the 17 SKUs in `ChargerProductName` — re-export from [`nexblue-openapi.json`](nexblue-openapi.json) on every spec refresh |
| OCPP gateway | Reuse `straumvakt-ocpp` worker — no new transport |
| OpenAPI spec | Already committed as [`nexblue-openapi.json`](nexblue-openapi.json) — regenerate from `https://prod-management.nexblue.com/swagger/dist/openapi_gen.json` rather than hand-editing |
| Auth flow | Prefer OAuth2 `client_credentials` (partner-issued) for fleet-level access; fall back to `/openapi/account/login` with installer credentials for ad-hoc tenant onboarding |
| Token lifetime | `access_token` 3600 s default · `refresh_token` 30 d. Refresh proactively |
| Onboarding UX | Surface `wss://` URL + ChargePoint identity + OCPP auth key as a copy block; link to NexBlue's "Install OCPP" guide. **Do NOT promise programmatic OCPP-URL flip** — the OpenAPI exposes only a read of `ChargerDetail.ocpp_data`, not a write |
| Chargelog ingest | OCPP `StopTransaction` primary; `GET /openapi/sessions/charger/{id}` periodic reconciliation (every few hours) |
| Energy aggregation | `GET /openapi/measurement/chargers/{id}` for hourly/daily kWh roll-ups feeding billing dashboards |
| Place / circuit topology | Read-only via `ChargerDetail.place_data` + `circuit_data`. Mirror to Straumvakt's `properties.installations` + `properties.circuits` on first sync |
| Push channel | None — REST poll `/cmd/status` and `/sessions/charger/{id}`; OCPP push is the real push |
| Operator-tag self-id | Once registered, NexBlue assigns either a dedicated `OperatorTag` value or `CustomOCPP` (=4). Capture this and store on `installations.metadata.nexblue_operator_tag` |
| Error envelope | `ErrorRes` schema in OpenAPI — capture and map to Straumvakt's normalized error model on first probe |
| Observability | OCPP-primary, REST-aux — alarms ride OCPP `StatusNotification.errorCode`, not REST |
| Live findings | Update §10 after the first commissioning probe |

---

## 14. Sources

**Live API surface:**

- [Live Swagger UI](https://prod-management.nexblue.com/swagger/dist/index.html) — `https://prod-management.nexblue.com/swagger/dist/index.html`
- [Live OpenAPI JSON](https://prod-management.nexblue.com/swagger/dist/openapi_gen.json) — used to populate this doc and the [`nexblue-openapi.json`](nexblue-openapi.json) snapshot
- [`nexblue-openapi.json`](nexblue-openapi.json) — committed snapshot (2026-05-02)

NexBlue corporate / product:

- [NexBlue homepage](https://nexblue.com/)
- [Edge product page](https://nexblue.com/products/nexblueedge)
- [Edge 2 product page](https://nexblue.com/products/nexblue-edge2)
- [Edge Max product page](https://nexblue.com/products/nexblue-edge-max)
- [Delta product page](https://nexblue.com/products/nexblue-delta)
- [Delta Max product page](https://nexblue.com/products/nexblue-delta-max)
- [Point 2 (UK)](https://nexblue.com/en-uk/products/nexblue-point2-uk)

NexBlue integration / OCPP:

- [Install OCPP on the NexBlue charger](https://nexblue.com/blogs/integration-guide/install-ocpp-on-the-nexblue-charger)
- [Local OCPP — what is it, where is it going](https://nexblue.com/blogs/news/local-ocpp-what-is-it-and-where-is-it-going)
- [Integration guide index](https://nexblue.com/pages/integration-guide)
- [Software & Partner Portal](https://nexblue.com/pages/software-partner-portal)
- [How to commission a NexBlue Charge Point](https://nexblue.com/apps/hc/installation/how-to-commission-a-nexblue-charge-point)
- [Managing RFID cards](https://nexblue.com/apps/hc/charging/managing-rfid-cards)
- [Terms and conditions (UK)](https://nexblue.com/en-uk/pages/nexblue-terms-and-conditions-15-01-2026)
- [NexBlue Partner Portal](https://partner.nexblue.com/)

Third-party validation:

- [Monta — Edge profile](https://monta.com/en/supported-charge-points/nexblue-edge/)
- [Monta — Edge 2 profile](https://monta.com/en/supported-charge-points/nexblue-edge-2/)
- [Tap Electric — NexBlue onboarding guide](https://docs.tapelectric.app/en/articles/11419270-nexblue-onboarding-guide)
- [`AndrewBarber/nexblue_hass`](https://github.com/AndrewBarber/nexblue_hass)
- [`evcc-io/evcc#27975`](https://github.com/evcc-io/evcc/issues/27975)
