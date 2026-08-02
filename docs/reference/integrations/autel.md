# Autel Energy — CPMS integration reference

**Status:** documentation-derived; no production adapter wired yet.
**Research date:** 2026-05-02.
**V3 schema class:** `Hardware / Chargers` — `HardwareVendorKind = charger_ac` for the MaxiCharger AC line and `charger_dc` for the DC HiPower / DH480 line. Both extend `assets.site_assets` via `assets.chargers`.
**V3 credential scope:** `none` for OCPP-only operation. Autel has no public, self-serve REST API for CPO partners — a partner agreement is required and the surface is undocumented in public material.
**Companion file:** none yet — when a production adapter lands and a partner agreement is in place, an `autel-openapi.json` (if Autel publishes one under NDA) drops in here.

> [!IMPORTANT]
> Autel is a tier-one diagnostic-tool vendor that branched into EV charging in 2021. Their hardware ladder spans residential AC up to 480 kW DC HiPower, with one of the strongest formal-certification stories in the catalogue (DNV OCPP 2.0.1 cert on DH480, OCA OCPP 2.0.1 cert on the CSMS, Hubject Plug & Charge ecosystem). The integration path Straumvakt should commit to is **OCPP-direct** — there is no documented Autel cloud REST API for third-party CPMS, and the only OTA OCPP-URL change requires the **Autel Config app over BLE** with a phone in physical proximity to the charger.

---

## 1. Vendor profile

| Field | Value |
|---|---|
| Parent | Autel Intelligent Technology Corp., Ltd. — founded 2004, HQ Shenzhen, China |
| EV branch | Autel Digital Power / "Autel Energy" — launched 2021 |
| Operating EU entity | Autel Energy Europe (HQ Munich, Landsberger Straße 408) |
| US factory | Greensboro, NC — acquired May 2023, ~5,000 DC fast units/year |
| Hardware tier | Full ladder — residential AC, commercial AC, DC fast, DC HiPower (480 kW per dispenser, 640 kW system) |
| Geographic focus | NA + EU + APAC + LATAM (genuine multi-region) |
| OCPP versions | 1.6J standard line-wide; 2.0.1 cert on DH480 + CSMS; 2.0.1 firmware-dependent on AC line |
| ISO 15118 PnC | Hubject EVSE CHECK certified (Feb 2024, starting with DC Compact) |
| Distinctive features | 80 A / 19.2 kW single-port AC · 2×19.2 kW dual-port AC Ultra · Energy Cube load algorithm on HiPower · CCS1 + NACS dual-cable on US HiPower · LCD touchscreens with ad-revenue capability |

> **Security history.** Multiple buffer-overflow + BLE auth-bypass CVEs disclosed at Pwn2Own Automotive 2024 (CVE-2024-23957/-23958/-23959/-23967). Autel patched in firmware ≥ v1.35. The BLE commissioning path was the attack surface — verify firmware ≥ v1.35 at every onboarding.

---

## 2. Models in scope

### 2.1 AC line

| Model | Region | Max power | Phases | Connector | OCPP | MID | ISO 15118 PnC | Notes |
|---|---|---|---|---|---|---|---|---|
| **MaxiCharger AC Lite** (Home) | NA | 12 kW | 1-ph 6–50 A | J1772 / NACS (separate SKUs) | 1.6J | unverified | unverified | Wi-Fi/BT/Ethernet, 25 ft cable, Energy Star, 3-yr warranty |
| **MaxiCharger AC Compact** | EU | 7.4 / 11 / 22 kW | 1-ph or 3-ph | Type 2 socket (cable optional) | 1.6J (2.0.1 upgradeable) | **Yes — MID Class B ±1% (LCD variants)** | unverified | RCD Type AC 30 mA + DC 6 mA built-in; IP65 |
| **MaxiCharger AC Wallbox** | EU | 7 / 11 / 22 kW | 1-ph or 3-ph | Type 2 socket / 5 m tethered | 1.6J (2.0.1 newer FW) | unverified | unverified | Wi-Fi/BT/Ethernet/4G; 8-unit shared-energy group; PV Hybrid; -40 to +55 °C |
| **MaxiCharger AC Pro** | NA + global | 19.2 kW (80 A) | 1-ph 240 V | J1772 | 1.6J + 2.0.1 | unverified | **Yes** | NEMA 4X, IK10, 7" touchscreen, RFID, in-body cable holster |
| **MaxiCharger AC Ultra** | NA | 2 × 19.2 kW | 1-ph 208/240 V | 2 × J1772 | 1.6 + 2.0.1 | unverified | **Yes** | 8" HD ad-capable screen, NEMA 3R, BT/Wi-Fi/Ethernet/4G |
| **MaxiCharger AC Single (Nayax)** | NA (rolling 2025-2026) | 19.2 kW | 1-ph | J1772 / NACS | 1.6 + 2.0.1 | unverified | Yes | Nayax payment terminal integrated; 100k unit rollout announced Jan 2026 |
| **MaxiCharger AC Elite Home** | NA | 12 kW (50 A) | 1-ph | J1772 | 1.6J | unverified | unverified | Hardwired wallbox with cable holster |

### 2.2 DC line

| Model | Power | Connectors | OCPP | ISO 15118 PnC | Notes |
|---|---|---|---|---|---|
| **MaxiCharger DC Compact** | 40 kW (NA) / up to 47 kW (EU) | 2×CCS1, or CCS1+CHAdeMO, or CCS1 (NA); CCS2 (EU) | 1.6J (2.0.1 upgradeable) | **Yes — first Hubject EVSE CHECK cert (Feb 2024)** | 21.5" LCD, 4G/Wi-Fi/Ethernet, 3-ph 480 V, pedestal or mobile |
| **MaxiCharger DC Fast** | 60 / 120 / 180 / 240 kW | 2 × CCS1 (NA) or 2 × CCS2 (EU) | 1.6J + 2.0.1 | Yes | NA built at Greensboro plant |
| **MaxiCharger DC HiPower / DH480** | 320 kW base, **480 kW per dispenser**, 640 kW system | CCS1 + NACS (NA); CCS2 (EU); 650 A liquid-cooled | **1.6J + 2.0.1 — DNV cert OCA.0201.0069.CS (Core + Advanced Security)** | Yes | Energy Cube load algorithm; 4-8 vehicles simultaneously; site-level network hot backup |

> **OCPP rule of thumb.** Every shipping Autel charger has 1.6J as standard. **2.0.1 is certified at the CSMS layer (OCA cert June 2024) and at the charger layer only on DH480 (DNV cert).** Other 2.0.1 claims are firmware-dependent — confirm per shipping unit. Treat AC Lite as 1.6J only until proven otherwise.

---

## 3. Cloud surfaces

| Surface | Audience | URL |
|---|---|---|
| Autel Charge Cloud — EU operator portal | CPO / fleet operators (EU) | `https://eucloud.autelenergy.com/` |
| Autel Charge Cloud — US operator portal | CPO / fleet operators (NA) | `https://uscloud.autelenergy.com/login` |
| Autel Charge Cloud — APAC | CPO operators (APAC) | unverified — likely a separate cn/asia subdomain |
| **Autel Charge** mobile app | End users (drivers) | iOS app id `1578454464` + Android equivalent |
| **Autel Config** mobile app | Installers (BLE commissioning) | iOS app id `1607007731` + Android equivalent |
| Operator registration (NA) | New CPO partners | `https://autelenergy.us/pages/register` |
| Operator registration (EU) | New CPO partners | `https://autelenergy.eu/pages/register-for-an-autel-charge-cloud-account` |

After approval, Autel emails credentials, instructional videos, and a CSMS user manual. **There is no self-serve developer portal** — a partner agreement is required before any cloud-side access is granted.

---

## 4. REST API surface — partner-gated, undocumented

> **This is the single biggest gap in Autel's integrator story.**

- No publicly-hosted Swagger / OpenAPI page for the Autel cloud.
- No published rate limits, no published auth scheme.
- The `github.com/AutelSDK/Autel-Cloud-API` repo is for **Autel Robotics drones**, not chargers. Don't confuse the two.
- Autel publishes **integration partnerships** rather than a public API: ChargeLab (CA), AMPECO (EU, OCPP 2.0.1 certified DH480), Monta, EVmatch, Last Mile Solutions, Hubject (Plug & Charge).
- Partners typically integrate at the **OCPP layer** (charger ↔ third-party CSMS), not via an Autel cloud REST API. Whatever cloud REST surface exists is gated behind a partner agreement and not registerable for self-serve.

| Aspect | Detail |
|---|---|
| Base URL | unverified |
| Auth | unverified (operator portal is web-form email + password — partner API surface unverified) |
| Push channel | none documented |
| Webhooks | none documented |
| Partner contact | `EVSales@Autel.com` + "Become A Partner" CTA on `autelenergy.us` |

**Recommendation for Straumvakt.** Plan integration as **OCPP-direct from the Autel charger to Straumvakt**, not via Autel cloud REST. If a customer requires CSMS-to-CSMS data exchange, the realistic path is **OCPI via Hubject** once Hubject's 2025 OCPI rollout becomes available — Autel is involved via Plug & Charge, not via a published OCPI 2.2/2.3 endpoint of their own.

---

## 5. OCPP support

### 5.1 Versions and certification

| Surface | Version | Certification |
|---|---|---|
| Charger ↔ CSMS (DH480) | OCPP 2.0.1 | **DNV cert OCA.0201.0069.CS** — Edition 3 FINAL 2024-05-06 + Errata 2024-11 |
| Charger ↔ CSMS (DH480) | OCPP 1.6J | Standard fallback |
| Autel CSMS itself | OCPP 2.0.1 | **OCA cert June 2024** — Core + Advanced Security profiles |
| Charger ↔ CSMS (AC Pro / Ultra / Single, DC Compact, DC Fast) | OCPP 2.0.1 | "Compliant" / "upgradeable" — firmware-dependent, no per-charger cert |
| Charger ↔ CSMS (AC Lite, AC Compact, AC Wallbox) | OCPP 1.6J | Standard |

AMPECO publicly completed full 2.0.1 integration testing on DH480 in 2025.

### 5.2 Configurable backend URL — yes (BLE-proximity required)

- **Method:** Operator opens **Autel Config** on a phone, connects to the charger over **Bluetooth (BLE)**, navigates to *Settings → OCPP Server*, enters URL/IP/port (`ws://host:port/path` or `wss://...`), reboots.
- **Default backend:** Autel Charge Cloud (regional `eucloud` / `uscloud` subdomains).
- **Constraint:** Phone must be in BLE range of the charger. **There is no documented over-the-internet OCPP-URL change** for Autel chargers — the Autel cloud will not push the URL change for you. This is a hard structural difference vs Charge Amps and NexBlue.

### 5.3 Known OCPP integration quirks

(Sourced from `lbbrhzn/ocpp` issues + `evcc-io/evcc` discussions.)

- Some firmware revisions ignore `ChangeConfiguration` for current-limit values (lbbrhzn/ocpp#1019). Workaround: use `SetChargingProfile` instead of raw config keys.
- Some EU Wallbox FW reports a hardcoded `MeterValueSampleInterval`. Plan around it; don't expect the standard config key to take effect.
- BLE-based commissioning is mandatory for OCPP URL changes — there is **no web UI on AC models**.
- Pwn2Own 2024 CVEs (CVE-2024-23957/-23958/-23959/-23967) require firmware ≥ v1.35.

See [`ocpp-1.6j.md`](ocpp-1.6j.md) for the shared 1.6J vocabulary.

---

## 6. Real-time push

| From | To | Mechanism |
|---|---|---|
| Charger | CSMS | OCPP WebSocket (1.6J / 2.0.1) — primary path |
| Autel Charge Cloud | Third-party systems | none documented |
| Autel Charge Cloud | Its own apps | internal, not exposed |

There is no documented "Autel events webhook" to subscribe to. Once the charger is repointed at Straumvakt's gateway, OCPP push is the realtime mechanism.

---

## 7. Onboarding to a third-party CPMS

The flow is **on-site BLE-only** for the URL change. There is no remote takeover path.

1. Power up the charger and complete electrical commissioning.
2. Install **Autel Config** (the installer app — separate from Autel Charge end-user app).
3. Scan the QR on the unit (or enter serial + PIN from the install-manual sticker).
4. Connect via BLE; configure Wi-Fi or Ethernet for backhaul.
5. *Settings → OCPP Server* → enter Straumvakt's `wss://` URL + auth credentials.
6. Reboot. Charger boots straight into Straumvakt.
7. Once moved off Autel Charge Cloud, the end-user **Autel Charge app stops working for that unit** — drivers must use Straumvakt's app/RFID instead.

> **Implication.** Field installer must be on-site with a phone running Autel Config. Plan a non-zero installer cost into every Autel onboarding quote — this is **not** the OTA flow Charge Amps and NexBlue offer.

---

## 8. End-user authentication at the charger

| Mode | Status |
|---|---|
| RFID (ISO/IEC 14443) | Yes — built-in on Wallbox, AC Pro, AC Ultra, AC Single, all DC. DES challenge-response. Local whitelist of 5 cards on Autel cloud; under OCPP delegated to CSMS via `Authorize` |
| Autel Charge app start/stop | Yes when on Autel cloud — gone once moved to Straumvakt |
| ISO 15118-2 Plug & Charge | Yes — Hubject EVSE CHECK certified (DC Compact, DC Fast, DH480, AC Pro, AC Ultra, AC Single). AC Lite home unverified (likely no) |
| Nayax credit-card terminal | Yes on AC Single (Jan 2026 NA rollout); fallback for app-free payments |
| Free-vend / no-auth | unverified |

---

## 9. Local interface

| Interface | Status |
|---|---|
| Modbus TCP — DC Compact, DC Fast | **Yes**, configurable via local service portal |
| Modbus RTU (RS-485) — DC Compact, DC Fast | **Yes** |
| Modbus TCP — AC Ultra | **Yes**, via maintenance menu |
| Modbus — AC Wallbox / Compact / Lite | unverified — public docs do not document Modbus on residential AC |
| Local web UI — DC line | Partial — service portal / maintenance menu on LCD or via service connection |
| Local web UI — AC line | None published — config only via Autel Config / BLE |
| Service installer | Autel Config app over BLE (canonical service interface line-wide) |
| Backhaul options | Ethernet, Wi-Fi, optional 4G (SIM, APN settable in Autel Config) |
| Firmware update paths | Autel Config (BLE), Autel Charge Cloud (OTA), OCPP `UpdateFirmware` once on third-party CSMS |

---

## 10. OCMF / signed metering / Eichrecht

| Aspect | Status |
|---|---|
| MID meter | Confirmed on **MaxiCharger AC Compact (LCD variants)** — ±1% Class B. Other EU AC models unverified per-SKU |
| Eichrecht / OCMF signed values | **No public claim by Autel** — not on Eichrecht-certified vendor lists. Treat as **absent** until Autel publishes a per-model conformity certificate |

For Iceland this is acceptable. For DE/AT resale plus OCPI-CDR with legal-for-trade billing, **request an Eichrecht conformity certificate per model + firmware before quoting**.

---

## 11. DC fast-charger specifics — DH480

- **Cleanest Autel charger to integrate today.** Formally certified at both ends of the OCPP stack.
- **Connectors:** NA — CCS1 + NACS (SAE J3400) dual-cable per dispenser, designed for the CCS1→NACS transition. EU — CCS2 (assumed; not explicitly verified per dispenser SKU).
- **Architecture:** Power cabinet + 1–4 dispensers, up to 8 simultaneous vehicles. Air-cooled dispensers ≤ 240 kW; liquid-cooled (650 A) ≤ 480 kW; system total ≤ 640 kW; expandable in 320 kW base steps.
- **Plug & Charge:** ISO 15118-2 over OCPP. Hubject ecosystem member.

---

## 12. Live findings

*(empty — first probe of a real Autel charger fills this section.)*

After commissioning the first Autel charger to Straumvakt's gateway, capture:

- BootNotification payload (firmware version string, model, serial, ICCID).
- Full `GetConfiguration` response → which Autel-extended keys exist; which standard keys are read-only or hardcoded.
- StatusNotification `errorCode` strings actually emitted on plug events.
- MeterValues during a test session → measurands, sampling cadence, MID meter source labels.
- Reset semantics → does `Reset(Hard)` survive 4G reconnect cleanly?
- For DH480 specifically: 2.0.1-only message flows (`TransactionEvent`, `NotifyReport`, `StatusNotification` v2.0.1) and the `DataTransfer` patterns Autel uses for vendor extensions.

---

## 13. Companion docs

- [`README.md`](README.md) — vendor catalogue index
- [`ocpp-1.6j.md`](ocpp-1.6j.md) — shared OCPP 1.6J protocol reference
- [`ocmf.md`](ocmf.md) — OCMF format (pertinent if a future Autel SKU adds Eichrecht)
- [`alfen.md`](alfen.md) — sister AC vendor that is also OCPP-primary
- [`zaptec.md`](zaptec.md) — sister AC vendor with full Cloud API + live integration

---

## 14. Pricing / commercial

| Aspect | What's known |
|---|---|
| Autel Charge Cloud (NA, US/Canada) | 1-year subscription license cards (Lite / Silver / Pro tiers) — entry around **$29.99 USD/year/charger**; full breakdown not public |
| Autel Charge Cloud (EU) | Account-based after partner registration — no public price list |
| OCPP feature gating | No paid OCPP add-on — OCPP is included in firmware. The paid product is the cloud, not the protocol |
| Hardware list price (NA retail snapshot) | AC Lite 50 A J1772 ≈ $455–569 · AC Ultra dual-port commercial in the high four figures · DC line dealer-quoted |
| OCPI version | Not published. Plan to roam via Hubject |

---

## 15. Production-adapter checklist (when Straumvakt builds one)

| Concern | Action |
|---|---|
| Vendor row | `hardware.vendors`: `slug=autel`, `kind=charger_ac` (and a separate `slug=autel-dc` for the DC line, or `kind=multi`) |
| Credential scope | `none` for OCPP-only |
| Models | Seed `hardware.models` rows for the AC line (Compact, Wallbox, Pro, Ultra, Single, Elite Home) and the DC line (Compact, Fast, DH480) |
| OCPP gateway | Reuse `straumvakt-ocpp` worker. For DH480 sites, ensure 2.0.1 path is exercised |
| Onboarding UX | Surface a **printable** wss:// URL + ChargePoint identity + OCPP auth key + the Autel Config BLE-pairing instructions. Include the firmware-floor warning (≥ v1.35 for the Pwn2Own CVE patches) |
| Firmware floor | Refuse onboarding below v1.35 — Pwn2Own CVE class. Document this in the wizard |
| Live findings | Update §12 after first commissioning probe |
| Plug & Charge | Hubject EVSE CHECK is per-vendor — for any P&C scope, confirm Hubject pool membership covers the customer's brand |

---

## 16. Open questions to confirm with Autel directly before integrating

1. **Per-SKU OCPP 2.0.1 firmware availability** — confirm with serial number and shipping firmware version. Don't assume 2.0.1 on AC Lite or older Wallbox stock.
2. **Eichrecht / OCMF status** — no public claim. If selling into DE/AT, request a conformity certificate per model and FW.
3. **Existence and scope of any partner REST API** — not in public docs. Apply via `EVSales@Autel.com` before counting on it.
4. **Webhook / outbound push from Autel Charge Cloud** — not documented. Plan for OCPP-direct ingest, not cloud-to-cloud.
5. **OCPI version supported by Autel** — not published. Use Hubject as the roaming bridge.
6. **BLE-proximity OCPP URL change is mandatory** — first-time Straumvakt onboarding requires installer on-site with the Autel Config app. There is no remote takeover path.
7. **Pwn2Own 2024 CVEs** — require firmware ≥ v1.35. Verify firmware is patched at onboarding.

---

## 17. Sources

Vendor pages:

- [Autel Energy global landing](https://autelenergy.com/)
- [Autel Energy NA](https://autelenergy.us/)
- [Autel Energy EU](https://autelenergy.eu/)
- [Full product lineup (NA)](https://autelenergy.us/pages/autel-energy-full-product-lineup)
- [MaxiCharger AC Pro (NA)](https://autelenergy.us/pages/maxicharger-ac-pro)
- [MaxiCharger AC Ultra (NA)](https://autelenergy.us/pages/maxicharger-ac-ultra)
- [MaxiCharger DC Compact (NA)](https://autelenergy.us/pages/maxicharger-dc-compact-pedestal)
- [MaxiCharger DC HiPower (NA)](https://autelenergy.us/pages/maxicharger-dc-hipower)
- [MaxiCharger DH480 (NA)](https://autelenergy.us/pages/maxicharger-dh480)
- [DC HiPower (global)](https://autelenergy.com/global/product/dc-hipower)
- [AC Compact (EU)](https://autelenergy.com/en-EU/product/ac-compact)
- [AC Wallbox (EU)](https://autelenergy.com/en-EU/product/ac-wallbox)
- [Software overview](https://autelenergy.com/global/product/software)

Cloud / portals / apps:

- [EU operator portal login](https://eucloud.autelenergy.com/)
- [US operator portal login](https://uscloud.autelenergy.com/login)
- [Autel Charge end-user app (iOS)](https://apps.apple.com/us/app/autel-charge/id1578454464)
- [Autel Config installer app (iOS)](https://apps.apple.com/us/app/autel-config/id1607007731)

OCPP / standards / certification:

- [DH480 OCPP 2.0.1 DNV cert PDF](https://www.intelliev.uk/wp-content/uploads/2025/09/MaxiCharger-DH480-OCPP-2.0.1-Certification.pdf)
- [Autel CSMS OCA OCPP 2.0.1 cert (BusinessWire press)](https://www.businesswire.com/news/home/20240607053291/en/Autel-Energys-Charging-Station-Management-System-CSMS-Achieves-OCPP-2.0.1-Certification-Advancing-EV-Charging-Interoperability-and-Security)
- [AMPECO + Autel OCPP 2.0.1 integration](https://www.ampeco.com/blog/ampeco-and-autel-europe-strengthen-ev-charging-infrastructure-with-successful-ocpp-2-0-1-integration/)
- [Hubject Plug & Charge ecosystem inclusion](https://www.hubject.com/blog-posts/autels-maxicharger-becomes-the-newest-member-of-hubjects-plug-charge-ecosystem)
- [ChargeLab — Autel commissioning guide](https://chargelab.zendesk.com/hc/en-us/articles/37654970734747-Autel-Charger-Commissioning-Guide)
- [ChargeLab — AC Lite configuration guide](https://chargelab.zendesk.com/hc/en-us/articles/42340494306203-Autel-AC-Lite-Maxi-Charge-Configuration-Guide)
- [Monta — Autel installation guide](https://monta.com/en/help-center/autel-installation-guide/)
- [Eniris — Modbus references for Autel](https://docs.eniris.io/en/Controller/Devices/EV-charging-station/Autel)
- [`lbbrhzn/ocpp` Autel integration issues](https://github.com/lbbrhzn/ocpp/issues/1019)

Manuals / spec sheets:

- [AC / AC Pro install manual (ACDI Energy mirror)](https://20922716.fs1.hubspotusercontent-na1.net/hubfs/20922716/ACDI%20Energy%20Services%20-%20AC%26AC%20Pro_Installation%20and%20Operation%20Manual-compressed%20(1).pdf)
- [AC Wallbox install manual EU v3.1 (Amaranzero mirror)](https://amaranzero.it/content/documents/400-124_11.pdf)
- [DC Compact 40 kW spec install (ASTSBC mirror)](https://astsbc.org/wp-content/uploads/2024/04/MH-Autel-40kW-Specs-Install.pdf)
- [DH480 brochure](https://www.elfor.org/wp-content/uploads/2024/09/MaxiCharger-DH480_camion.pdf)
- [Cloud platform brochure](https://breez-ev.com/wp-content/uploads/2025/03/Autel-Cloud-Platform-Brochure.pdf)
- [EV Cloud operator manual](https://breez-ev.com/wp-content/uploads/2025/03/Autel_EV_Cloud_Operator_Manual-101822.pdf)

Security disclosures:

- [Pwn2Own Automotive 2024 — Autel MaxiCharger writeup (Sector7)](https://sector7.computest.nl/post/2024-08-pwn2own-automotive-autel-maxicharger/)
- [ZDI — More Autel MaxiCharger vulnerabilities](https://www.zerodayinitiative.com/blog/2024/10/2/from-pwn2own-automotive-more-autel-maxicharger-vulnerabilities)
- [VicOne — security takeaways](https://vicone.com/blog/security-takeaways-from-autel-maxicharger-vulnerabilities-discovered-at-pwn2own-automotive-2024)
