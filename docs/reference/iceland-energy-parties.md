# Iceland energy parties — reference catalogue

**Status:** reference data, not schema. Not loaded by code.
**Last verified:** 2026-04-25 (manual scrape of public sources).
**Primary use:** seed data for a future `energy.parties` / `energy.tariff_catalogue` model. Until that model lands, this doc is the canonical list of Icelandic electricity-market counterparties Straumvakt needs to know about.

## Companion artifacts

| File | Purpose |
|---|---|
| [`iceland-energy-parties.md`](iceland-energy-parties.md) | This doc — human-edited source of truth. |
| [`iceland-energy-parties.json`](iceland-energy-parties.json) | Machine-readable seed payload. Snake_case throughout, ready to ingest when `energy.parties` + `energy.tariff_catalogue` land. **21 parties · 168 tariff items · 8 active CPOs · 5 charger-rental operators.** |
| [`iceland-energy-parties.html`](iceland-energy-parties.html) | Themed mockup served from `docs/reference/` via `py -m http.server`. Filter by role, toggle EV-only, search by kennitala. |
| [`logos/`](logos/) | **Local PNG logos** for ON, Orkusalan, HS Orka, Straumlind, N1 (used by both N1 Rafmagn + N1 charging), Orkubú Vestfjarða, Orka heimilanna. Stored locally so the catalogue does not depend on third-party CDNs at render time. Path referenced via `branding.logo_url` in the JSON (relative to `docs/reference/`). |

When prices change, edit this `.md` first (it's authoritative), then regenerate the `.json` to match. The `.html` mockup carries an inline copy of the same data for offline preview — refresh it when the JSON is re-emitted. **When a brand updates its logo, replace the file in `logos/` keeping the same filename — no JSON / HTML edit needed.**

---

## 1. Why this exists

Straumvakt's `tenancy.Organization` represents the **SaaS tenant** (the CPO operating Straumvakt). It does **not** model external counterparties — electricity retailers (söluaðilar), distribution system operators (DSOs / dreifiveitur), or the transmission system operator (TSO / Landsnet).

For tariff resolution, billing-side cost calculation, OCPI counterparty bookkeeping, and driver-facing tariff comparison views, we will eventually need a model that:

- carries the retailer/DSO identity (kennitala, VSK, addresses, contacts, roles),
- carries each party's published tariff items (codes, prices, validity, units, VAT rate),
- distinguishes EV-relevant items from items that exist on the same tariff schedule but should be hidden from EV-context UIs by default.

This document captures all three so the work is ready when the schema model lands. It should be edited by hand whenever a tariff changes.

---

## 2. Conventions

### 2.1 Relevance labels (`ev_category`)

Every tariff line gets exactly one:

| Value | Meaning |
|---|---|
| `public_ev` | Tariff applies to public/destination/curbside chargers (almenningshleðsla — DC fast, public AC). Customer-facing. |
| `workplace_ev` | Tariff applies to workplace / MDU / fleet AC charging (fyrirtækjahleðsla, employer subsidy products). |
| `home_ev` | Tariff applies to home charging products (heimahleðsla, night rates marketed for EV owners). |
| `general_supply` | Generic household or business electricity supply that is the *baseline* a home/workplace EV plugs into. Affects cost math even if not "EV-marketed." |
| `not_ev` | Distribution-side, heating, street lighting, industrial afltaxti, connection fees, admin fees, transmission-only items. Kept for completeness. |

### 2.2 Visibility model (`default_visible`)

Two-state. UIs that compare EV charging cost should default to showing items where `default_visible = true` and offer a toggle to reveal hidden items.

- `true` — `public_ev`, `workplace_ev`, `home_ev`, and `general_supply` (the baseline a household EV runs on)
- `false` — `not_ev`. Still in the catalogue for auditability and so internal billing/reconciliation tools can see the full schedule.

### 2.3 Money

All prices reproduced verbatim from the source. ISK throughout. VAT rates noted per line — Iceland applies 24% to general electricity and 11% to separately-metered electric heating (rafhitun). Landsnet quotes wholesale (no VAT). Stórnotandi (large-consumer) Landsnet rates are quoted in USD by Landsnet — preserved as such.

### 2.4 Recommended row schema

For a future `energy.tariff_items` table:

```
id                  uuid
party_id            uuid -> energy.parties
code                text          -- "AD1", "T3LD", etc., where the source uses a code
display_name        text
applies_to          text          -- free text from source; structured filters layered on top
unit                text          -- kr/kWh, kr/dag, kr/ár, kr/kW/ár, kr/kVARh
price_minor_no_vat  bigint        -- aurar (1 kr = 100 aurar) — null if source only quotes with-VAT
price_minor_with_vat bigint
vat_pct             numeric(4,2)  -- 24.00, 11.00, 0.00
currency            text          -- "ISK" or "USD" for Landsnet stórnotendur
valid_from          date
valid_until         date          -- nullable
ev_category         enum          -- see 2.1
default_visible     boolean       -- see 2.2
source_url          text
source_verified_at  timestamptz
notes               text
```

Identity / contact columns belong on `energy.parties`, listed in §3 below.

---

## 3. Recommended `parties` column set

| Column | Notes |
|---|---|
| `id` | uuid |
| `slug` | `on`, `orkusalan`, `veitur`, ... |
| `legal_name` | "Orka náttúrunnar ohf." |
| `trade_name` | "ON" |
| `legal_form` | `ohf` / `hf` / `ehf` / `municipal` |
| `kennitala` | `DDMMYY-XXXX` |
| `vsk_nr` | nullable; pull from invoice when available |
| `lei_code` | nullable |
| `country_code` | ISO 3166-1 alpha-2 (`IS`) |
| `roles[]` | multi: `retailer`, `dso`, `tso`, `producer` |
| `status` | `active` / `exited` / `merged_into` |
| `merged_into_id` | self-FK |
| `service_area` | jsonb — postnúmer list for DSOs, "national" for retailers |
| `regulator_licence_no` | Orkustofnun licence |
| `registered_address` | structured (street/postal/municipality/country) |
| `operational_address` | structured |
| `phone_main`, `phone_emergency_24h` | |
| `email_main`, `email_billing`, `email_ops` | |
| `website`, `customer_portal_url` | |
| `bank_iban`, `bank_account_is`, `e_invoice_address` | |
| `invoice_currency`, `payment_terms_days` | |
| `ocpi_party_id`, `ocpi_country_code` | nullable |
| `logo_url`, `brand_primary_hex`, `brand_secondary_hex` | |
| `data_source`, `source_verified_at` | provenance |
| `notes` | |
| `created_at`, `updated_at` | |

---

## 4. Retailers (söluaðilar)

### 4.1 Orka náttúrunnar (ON)

| Field | Value |
|---|---|
| Legal name | Orka náttúrunnar ohf. |
| Kennitala | 521213-0190 |
| Address | Bæjarháls 1, 110 Reykjavík |
| Phone | 591 2700 |
| Email | on@on.is |
| Website | https://www.on.is |
| Roles | retailer, producer, public charging operator |
| Status | active |
| Tariff URL | https://www.on.is/verdskrar |

#### Tariff items — household supply

| Code | Name | Applies to | Unit | No VAT | With VAT | VAT | Valid from | ev_category | visible |
|---|---|---|---|---|---|---|---|---|---|
| | General electricity | Heimili | kr/kWh | 9.20 | 11.41 | 24% | 2026-01-01 | general_supply | ✓ |
| | Energy Guide — winter night | Heimili | kr/kWh | 5.16 | 6.40 | 24% | 2026-01-01 | home_ev | ✓ |
| | Winter rate | Heimili | kr/kWh | 10.12 | 12.55 | 24% | 2026-01-01 | general_supply | ✓ |
| | Summer night | Heimili | kr/kWh | 4.77 | 5.91 | 24% | 2026-01-01 | home_ev | ✓ |
| | Summer rate | Heimili | kr/kWh | 9.35 | 11.59 | 24% | 2026-01-01 | general_supply | ✓ |
| | Origin guarantee (upprunaábyrgð) | Heimili add-on | kr/kWh | 0.40 | 0.50 | 24% | 2026-01-01 | general_supply | ✓ |

#### Tariff items — public EV charging

| Code | Name | Applies to | Unit | With VAT | VAT | Valid from | ev_category | visible |
|---|---|---|---|---|---|---|---|---|
| | Neighbourhood AC | Public AC | kr/kWh | 33 | 24% | 2026-01-01 | public_ev | ✓ |
| | Neighbourhood AC — loyalty | Public AC | kr/kWh | 27 | 24% | 2026-01-01 | public_ev | ✓ |
| | Travel AC | Public AC | kr/kWh | 48 | 24% | 2026-01-01 | public_ev | ✓ |
| | Travel AC — loyalty | Public AC | kr/kWh | 39 | 24% | 2026-01-01 | public_ev | ✓ |
| | Fast DC (temporary reduction) | Public DC | kr/kWh | 62 | 24% | 2026-01-01 | public_ev | ✓ |
| | Fast DC — loyalty | Public DC | kr/kWh | 55 | 24% | 2026-01-01 | public_ev | ✓ |

#### Tariff items — home & workplace charging subscriptions

| Name | Applies to | Unit | With VAT | No VAT | Valid from | ev_category | visible |
|---|---|---|---|---|---|---|---|
| Heimahleðsla — detached, charger included | Heimili | kr/mán | 2,900 | — | 2026-01-01 | home_ev | ✓ |
| Heimahleðsla — apartment, charger included | Heimili | kr/mán | 4,400 | — | 2026-01-01 | home_ev | ✓ |
| Heimahleðsla — own charger | Heimili | kr/mán | 1,190 | — | 2026-01-01 | home_ev | ✓ |
| Fyrirtækjahleðsla — charger included | Fyrirtæki | kr/mán | 4,400 | 3,548 | 2026-01-01 | workplace_ev | ✓ |
| Fyrirtækjahleðsla — own charger | Fyrirtæki | kr/mán | 1,190 | 960 | 2026-01-01 | workplace_ev | ✓ |
| Subscription+ | Fyrirtæki | kr/mán | 5,500 | 4,435 | 2026-01-01 | workplace_ev | ✓ |
| Subscription+ own charger | Fyrirtæki | kr/mán | 2,290 | 1,847 | 2026-01-01 | workplace_ev | ✓ |
| Home charging for employees | Fyrirtæki | kr/mán | 4,400 | 3,548 | 2026-01-01 | workplace_ev | ✓ |

ON also republishes the daily DSO meter charges under their tariff page; those numbers are authoritative under each DSO's section, not here.

---

### 4.2 Orkusalan

| Field | Value |
|---|---|
| Legal name | Orkusalan ehf. |
| Kennitala | 560306-1130 |
| Address | Dvergshöfði 2, 110 Reykjavík (þjónustuver Urðarhvarf 8, 203 Kópavogur) |
| Phone | 422 1000 |
| Email | orkusalan@orkusalan.is |
| Website | https://www.orkusalan.is |
| Roles | retailer, public charging operator |
| Status | active |
| Tariff URL | https://www.orkusalan.is/verdskra |
| Notes | Owns RARIK; Fallorka customers were directed here. |

#### Supply tariffs

| Code | Name | Applies to | Unit | No VAT | With VAT | VAT | Valid from | ev_category | visible |
|---|---|---|---|---|---|---|---|---|---|
| | SparOrka | General | kr/kWh | 7.94 | 9.85 | 24% | 2025-05-01 | general_supply | ✓ |
| | HleðsluOrka | EV-marketed | kr/kWh | 8.36 | 10.38 | 24% | 2025-05-01 | home_ev | ✓ |
| | NæturOrka — daytime | General | kr/kWh | 10.46 | 12.97 | 24% | 2025-05-01 | general_supply | ✓ |
| | NæturOrka — night 00:00–06:00 | General | kr/kWh | 5.23 | 6.49 | 24% | 2025-05-01 | home_ev | ✓ |
| | GrænOrka | General | kr/kWh | 12.40 | 15.38 | 24% | 2025-05-01 | general_supply | ✓ |
| | No plan (default) | General | kr/kWh | 10.46 | 12.97 | 24% | 2025-05-01 | general_supply | ✓ |

#### Heating supply (rafhitun)

| Name | Unit | With VAT (11%) | Valid from | ev_category | visible |
|---|---|---|---|---|---|
| SparOrka — rafhitun | kr/kWh | 8.82 | 2025-05-01 | not_ev | ✗ |
| HleðsluOrka — rafhitun | kr/kWh | 9.28 | 2025-05-01 | not_ev | ✗ |
| NæturOrka day — rafhitun | kr/kWh | 11.61 | 2025-05-01 | not_ev | ✗ |
| NæturOrka night — rafhitun | kr/kWh | 5.80 | 2025-05-01 | not_ev | ✗ |
| GrænOrka — rafhitun | kr/kWh | 13.77 | 2025-05-01 | not_ev | ✗ |

#### Home chargers (subscription)

| Name | Unit | Price | Valid from | ev_category | visible |
|---|---|---|---|---|---|
| Amina | kr/mán | 990 | 2025-05-01 | home_ev | ✓ |
| Qudo | kr/mán | 1,990 | 2025-05-01 | home_ev | ✓ |
| Easee Charge | kr/mán | 3,410 | 2025-05-01 | home_ev | ✓ |
| Installation (one-time) | kr | 119,990 | 2025-05-01 | home_ev | ✓ |
| Modification fee (one-time) | kr | 5,900 | 2025-05-01 | home_ev | ✓ |

#### Public charging (Orkusalan stations)

CCS-2: 59 / 47 / 35 kr/kWh (tier-banded). CHAdeMO: 44 / 35 / 26 kr/kWh. AC Type 2 22 kW: 30 / 24 / 18 kr/kWh. *Re-scrape needed for tier definitions; Orkusalan ran a "40% afsláttur í mars" promotion that may now be expired.* All `public_ev`, all `default_visible = ✓`.

---

### 4.3 HS Orka

| Field | Value |
|---|---|
| Legal name | HS Orka hf. |
| Kennitala | 680475-0169 |
| Address | Orkubraut 3, Svartsengi, 241 Grindavík |
| Phone | 520 9300 |
| Email | hsorka@hsorka.is |
| Website | https://www.hsorka.is |
| Roles | retailer, producer (geothermal), home_charging |
| Status | active |
| Tariff URL | https://www.hsorka.is/rafmagn/ |

| Code | Name | Applies to | Unit | No VAT | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|---|---|
| | Almenn verðskrá — einstaklingar | Heimili | kr/kWh | 9.82 | 12.18 | 24% | general_supply | ✓ |
| | Almenn verðskrá — fyrirtæki | Fyrirtæki | kr/kWh | 11.09 | 13.74 | 24% | general_supply | ✓ |
| | Upprunaábyrgð | add-on | kr/kWh | 12.27 | 15.21 | 24% | general_supply | ✓ |
| | Ódýrara rafmagn á nóttunni — 01:00–06:00 | Rafbíll | kr/kWh | 0.00 | 0.00 | 24% | home_ev | ✓ |
| | 22 kW AC Compact — charger subscription | Heimili / Fjölbýli / Fyrirtæki | kr/mán | — | 2,490 | 24% | home_ev | ✓ |
| | 22 kW AC Wallbox — charger subscription | Heimili / Fjölbýli / Fyrirtæki | kr/mán | — | 4,490 | 24% | home_ev | ✓ |

Validity not stated on the page. Daytime rate when on the night-rate plan is the standard 12.18 kr/kWh. Charger subscriptions include maintenance with 1-month cancellation; customer arranges electrician for installation.

---

### 4.4 Straumlind

| Field | Value |
|---|---|
| Legal name | Straumlind ehf. |
| Kennitala | 480920-0150 |
| Address | Bjargargötu 1, 102 Reykjavík |
| Email | info@straumlind.is |
| Website | https://straumlind.is |
| Roles | retailer |
| Status | active |
| Tariff URL | https://straumlind.is/samningur |
| Notes | Orkan (N1's parent's competitor at fuel) holds an investment stake. |

| Name | Applies to | Unit | No VAT | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|---|
| General price | Heimili | kr/kWh | 8.50 | 10.54 | 24% | general_supply | ✓ |
| Electric heating | Húshitun | kr/kWh | 8.50 | 9.44 | 11% | not_ev | ✗ |
| Day rate (07:00–23:00) | Heimili | kr/kWh | 8.50 | 10.54 | 24% | general_supply | ✓ |
| Night rate (23:00–07:00) | Heimili | kr/kWh | 5.67 | 7.03 | 24% | home_ev | ✓ |
| Prepaid electricity | Heimili | kr/kWh | 7.94 | 9.85 | 24% | general_supply | ✓ |
| General price | Fyrirtæki | kr/kWh | 9.20 | 11.41 | 24% | general_supply | ✓ |
| Origin certification | add-on | kr/kWh | 0.50 | 0.62 | 24% | general_supply | ✓ |
| Bank transfer fee | per transaction | kr | 100 | 124 | 24% | not_ev | ✗ |
| Credit card payment | per transaction | kr | 0 | 0 | — | not_ev | ✗ |

Prepaid packages: 1,000 / 2,500 / 5,000 / 10,000 kWh annual.

---

### 4.5 N1 Rafmagn

| Field | Value |
|---|---|
| Legal name | N1 Rafmagn ehf. (formerly Íslensk Orkumiðlun ehf., renamed 2021-12) |
| Kennitala | 471216-1190 |
| VSK nr | 133198 |
| Address | Dalvegi 10–14, 201 Kópavogur |
| Phone | 440 1000 |
| Email | rafmagn@n1.is |
| Website | https://rafmagn.n1.is |
| Roles | retailer (parent: Festi hf. kt 540206-2010, which also owns N1 fuel) |
| Status | active |
| Tariff URL | https://rafmagn.n1.is/heimili |
| Sibling | Public fast-charging at N1 fuel stations is operated by **N1 ehf.** (kt 411003-3370), a separate legal entity under the same Festi parent — see §6.4 below |

| Name | Applies to | Unit | No VAT | With VAT | VAT | Valid from | ev_category | visible |
|---|---|---|---|---|---|---|---|---|
| Almenn notkun | Heimili | kr/kWh | 8.83 | 10.95 | 24% | 2025-01-03 | general_supply | ✓ |
| Rafhitun | Húshitun | kr/kWh | 8.83 | 9.80 | 11% | 2025-01-03 | not_ev | ✗ |
| Upprunaábyrgð | add-on | kr/kWh | 0.50 | 0.62 | 24% | 2025-01-03 | general_supply | ✓ |
| 33% night discount (02:00–06:00) | Smart-meter homes | discount | — | — | — | — | home_ev | ✓ |
| 3% N1 Points cashback | Customer-card holders | rebate | — | — | — | — | general_supply | ✓ |

Business and rafbíll-specific tariffs are not currently displayed on the public pricing page; surface from invoices when onboarding business customers.

---

### 4.6 Orkubú Vestfjarða — sales (söluhluti)

| Field | Value |
|---|---|
| Legal name | Orkubú Vestfjarða ohf. |
| Kennitala | 660877-0299 |
| Address | Stakkanes 1, 400 Ísafjörður |
| Phone | 450 3211 |
| Email | orkubu@ov.is |
| Website | https://www.ov.is |
| Roles | retailer, dso, public_charging (same legal entity carries all three — distribution side at §5.4) |
| Status | active |
| Tariff URL | https://www.ov.is/orkubuid/gogn/skrar-og-skjol |
| Tariff source | https://www.ov.is/asset/4571/verdskra-raforkusala-01.01.2025-01.02.2025.pdf |
| Public charging | 16 stations across the Westfjords (Hólmavík, Patreksfjörður, Bjarkalundur, Reykjanes, Flókalundur, Ísafjörður, Þingeyri, Hvítanes, Djúpavík, Laugarhóll, Drangsnes, Reykhólar, Tálknafjörður, Bíldudalur, Mjólkárvirkjun) — operated on the e1 platform |

Source PDF "Gildir frá 01.01.2025." The 01.01.2025–01.02.2025 PDF is the most recent published; OV publishes new PDFs roughly per quarter.

| Code | Name | Applies to | Unit | No VAT | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|---|---|
| A10S | Heimili / Einstaklingar — orkugjald | Heimili | kr/kWh | 6.85 | 8.49 | 24% | general_supply | ✓ |
| A40S | Heimili — blandaður (15% almenn / 85% hiti) | Heimili | kr/kWh | 6.85 | 8.49 (24%) / 7.60 (11%) | mixed | not_ev | ✗ |
| C10S | Heimili — rafhitun | Húshitun | kr/kWh | 6.85 | 7.60 | 11% | not_ev | ✗ |
| A15S | Fyrirtæki / Lögaðilar — orkugjald | Fyrirtæki | kr/kWh | 7.86 | 9.75 | 24% | general_supply | ✓ |
| A30S | Útilýsing — aflgjald | Götulýsing | kr/kW/ár | 28,770 | 35,675 | 24% | not_ev | ✗ |
| V10S | Ómæld smánotkun — aflgjald | Smáheimtaug | kr/kW/ár | 68,854 | 85,379 | 24% | not_ev | ✗ |
| | Upprunaábyrgðir | add-on | kr/kWh | 1.31 | 1.62 | 24% | general_supply | ✓ |

---

### 4.7 Orka heimilanna

| Field | Value |
|---|---|
| Legal name | Orka heimilanna ehf. |
| Kennitala | 420218-2060 |
| VSK nr | 130508 |
| Address | Mánagötu 11, 105 Reykjavík |
| Phone | 546 0033 |
| Email | orkaheimilanna@orkaheimilanna.is |
| Website | https://orkaheimilanna.is |
| Roles | retailer (group-buying / aggregator model) |
| Status | active |
| Tariff URL | https://orkaheimilanna.is/verdskra/ |
| Notes | Started 2018 as a competition-driving aggregator. |

| Name | Applies to | Unit | With VAT | VAT | Valid from | ev_category | visible |
|---|---|---|---|---|---|---|---|
| Óvottað rafmagn — almenn notkun | Heimili | kr/kWh | 9.83 | 24% | 2025-04-01 | general_supply | ✓ |
| Umhverfisvottað rafmagn — almenn notkun | Heimili | kr/kWh | 10.55 | 24% | 2025-04-01 | general_supply | ✓ |
| Óvottað — húshitun | Húshitun | kr/kWh | 8.80 | 11% | 2025-04-01 | not_ev | ✗ |
| Umhverfisvottað — húshitun | Húshitun | kr/kWh | 9.45 | 11% | 2025-04-01 | not_ev | ✗ |

---

### 4.8 Fallorka *(exited retail)*

| Field | Value |
|---|---|
| Legal name | Fallorka ehf. |
| Kennitala | 600302-4180 |
| Address | Rangárvöllum, 603 Akureyri |
| Phone | 460 1300 (Norðurorka switchboard) |
| Email | fallorka@fallorka.is |
| Website | https://www.fallorka.is |
| Roles | producer (4 hydro plants); previously retailer |
| Status | exited (retail business closed; customers redirected to Orkusalan) |
| Tariff URL | https://www.fallorka.is/is/komdu-i-vidskipti/gjaldskra |
| Notes | Subsidiary of Norðurorka. Last published rate was 11.94 kr/kWh. Keep entry for historical session reconciliation only. |

---

## 5. DSOs (dreifiveitur)

### 5.1 Veitur

| Field | Value |
|---|---|
| Legal name | Veitur ohf. |
| Kennitala | 501213-1870 |
| Address | Bæjarháls 1, 110 Reykjavík |
| Phone | 516 6000 |
| Email | veitur@veitur.is |
| Website | https://www.veitur.is |
| Roles | dso (also hot water, cold water, wastewater) |
| Status | active |
| Service area | Reykjavík, Kópavogur, Mosfellsbær, Akranes, Garðabær, Seltjarnarnes |
| Tariff URL | https://www.veitur.is/verdskrar |
| Tariff PDF (electricity) | https://eu-assets.contentstack.com/v3/assets/blt5bf0023ca96cf071/bltcce3e85ce7599431/69ccf086610d0a141b7bcd2f/LAV-250-Verðskrá_fyrir_raforkudreifingu_á_veitusvæði_Veitna-01-04-26.pdf (effective 2026-04-01) |
| Tariff change notice | https://www.veitur.is/verdbreytingar |

#### Inline summary (full schedule needs PDF re-extract — Veitur PDF resisted plain-text extraction)

| Item | Unit | Price | Valid from | ev_category | visible |
|---|---|---|---|---|---|
| Distribution charge (apartments, summary figure) | kr/kWh (with VAT) | 11.52 | 2026-01-01 | general_supply | ✓ |
| Equalization fee (jöfnunargjald) | — | up 27% YoY | 2026-01-01 | not_ev | ✗ |
| Transmission portion collected on behalf of Landsnet | — | down 6.67% | 2026-01-01 | not_ev | ✗ |

ON's tariff page also publishes the daily Veitur meter fixed charge at **46.52 kr/dag (no VAT)** for fyrirtæki.

> **TODO:** when this catalogue migrates to a real model, re-fetch the LAV-250 PDF via a parser that handles compressed PDF streams and populate full A/B/C/D tariff codes, fastagjöld and varstærðir as we have for HS Veitur and OV.

---

### 5.2 RARIK

| Field | Value |
|---|---|
| Legal name | RARIK ohf. (Rafmagnsveitur ríkisins) |
| Kennitala | 520269-2669 |
| Address | Dvergshöfði 2, 110 Reykjavík |
| Phone | 528 9000 |
| Email | rarik@rarik.is |
| Website | https://www.rarik.is |
| Roles | dso (electricity) + heating utility |
| Status | active |
| Service area | Most of rural Iceland + many towns outside capital region, Westfjords, and Akureyri. Two pricing zones (þéttbýli vs dreifbýli). |
| Tariff URL | https://www.rarik.is/gjaldskrar/gjaldskrar |

#### 2026 changes (from RARIK news 2026-01)

- Landsnet's transmission component dropped 8.5% — passed through as overall RARIK schedule decrease.
- Three new urban-zone areas added: Bifröst, Borg í Grímsnesi, Tjarnabyggð.
- Equalization fee (jöfnunargjald) raised: 0.41 → 0.52 kr/kWh (guaranteed energy); 0.13 → 0.17 kr/kWh (interruptible). Same numbers we see in OV and Norðurorka 2026 schedules.

ON's tariff page surfaces RARIK daily meter fixed charges (without VAT, fyrirtæki):

| Zone & varstærð | kr/dag (no VAT) |
|---|---|
| Urban 0–80A | 88.36 |
| Rural 0–80A | 123.63 |

> **TODO:** RARIK does not publish a single tariff PDF that we could reach in this pass. Pull each subpage (`gjaldskra-fyrir-dreifingu-og-flutning-raforku`, `verdskra-fyrir-tengigjold-rafmagns`) and re-tabulate. RARIK's full schedule is more complex than HS Veitur's because of the urban/rural duality.

---

### 5.3 HS Veitur — full 2025 schedule

| Field | Value |
|---|---|
| Legal name | HS Veitur hf. |
| Kennitala | 431208-0590 |
| LEI | 5493001WFODO2B8KWD84 |
| Address | Brekkustíg 36, 260 Reykjanesbær |
| Phone | 422 5200 |
| Email | hsveitur@hsveitur.is |
| Website | https://www.hsveitur.is |
| Roles | dso (electricity, hot water, cold water) |
| Status | active |
| Service area | Reykjanes, Vestmannaeyjar, Hafnarfjörður (part), Garðabær (part), Árborg |
| Tariff URL | https://www.hsveitur.is/thjonusta/verdskra/ |
| Tariff PDF (in use) | https://hsveitur.is/media/nm1jkpfr/33-verdskra-fyrir-dreifingu-og-flutning-raforku_01012025.pdf |

VAT: 24% on electricity, 11% on húshitun. Validity: from 2025-01-01.

#### A. Almennir taxtar (general)

For all four bands, energy charge breakdown is identical: Grunnur 4.83 + Dreifing 3.4000 + Flutningur 0.4100 + Jöfnun 0.0000 = **8.64 no VAT / 10.71 with VAT (24%) kr/kWh**. Daily fixed charge (no VAT, then with-VAT) varies by varstærð:

| Code | Varstærð | Fastagjald (no VAT) kr/dag | with VAT | Annual fastagjald (no VAT → with VAT) | ev_category | visible |
|---|---|---|---|---|---|---|
| AD1 | 0–80A | 45.19 | 56.03 | 16,493 → 20,451 kr/ár | general_supply | ✓ |
| AD2 | 81–199A | 170.28 | 211.15 | 62,153 → 77,070 | general_supply | ✓ |
| AD3 | 200–299A | 340.55 | 422.28 | 124,301 → 154,133 | general_supply | ✓ |
| AD4 | 300–500A | 510.82 | 633.42 | 186,451 → 231,199 | general_supply | ✓ |

#### B. Tvígjaldsmælar (two-tariff time-of-use)

Hágjald 09:00–21:00, lággjald 21:00–09:00.

| Code | Varstærð | Lág no VAT kr/kWh | Lág with VAT | Há no VAT | Há with VAT | ev_category | visible |
|---|---|---|---|---|---|---|---|
| ADT1 | 0–80A | 6.17 | 7.65 | 12.79 | 15.86 | home_ev | ✓ |
| ADT2 | 81–199A | 6.17 | 7.65 | 12.79 | 15.86 | home_ev | ✓ |
| ADT3 | 200–299A | 6.17 | 7.65 | 12.79 | 15.86 | workplace_ev | ✓ |
| ADT4 | 300–500A | 6.17 | 7.65 | 12.79 | 15.86 | workplace_ev | ✓ |

Daily fastagjöld and annual fastagjöld identical to AD1–AD4.

#### C. Þrígjaldsmælar (three-tariff)

| Code | Varstærð | Lággjald | Miðgjald | Hágjald | Fastagjald (with VAT) kr/dag | ev_category | visible |
|---|---|---|---|---|---|---|---|
| ADÞ2 | <300A | 6.08 / 7.54 | 8.64 / 10.71 | 18.20 / 22.57 | 596.92 → 554.57* | workplace_ev | ✓ |
| ADÞ4 | 300–500A | 6.08 / 7.54 | 8.64 / 10.71 | 18.20 / 22.57 | 732.50 → 680.51* | workplace_ev | ✓ |

(`x / y` = no VAT / with VAT 24%, kr/kWh.)
\*Annual: ADÞ2 217,876 → 270,166. ADÞ4 267,363 → 331,530. Time bands per HS Veitur PDF p.2.

#### D. Hitataxtar (heating)

`HD1`, `HD1N`, `AD1B`, `AD1BN`. Energy 8.64 no VAT / **9.59 with VAT (11%)** kr/kWh. HD1N and AD1BN are subsidised by 7.22 kr/kWh up to 40,000 kWh/year. AD1B and AD1BN carry the 45.19 kr/dag fastagjald at 24% VAT (= 56.03 with VAT). All `ev_category = not_ev`, `visible = ✗`.

#### E. Afltaxtar (industrial)

| Code | Spenna | Aflgjald (no VAT) kr/kW/ár | Orkugjald (no VAT) kr/kWh | Daily fastagjald (no VAT) | ev_category | visible |
|---|---|---|---|---|---|---|
| BD2 | 0.4 kV | 19,914 | 3.1477 | 499.59 | not_ev | ✗ |
| BD3 | 11 kV | 19,137 | 3.0353 | 1,295.51 | not_ev | ✗ |
| BD4 | 11 kV (seasonal) | 19,137 | 3.0353 | 1,295.51 | not_ev | ✗ |
| BD5 | 0.4 kV | 10,389 | 8.0315 | 499.59 | not_ev | ✗ |
| BD6 | 0.4 kV (≥2 MW) | 14,594 | 2.2341 | 15,651.28 | not_ev | ✗ |
| BD7 | 11 kV (≥2 MW) | 14,594 | 2.0060 | 15,651.28 | not_ev | ✗ |
| BD8 | 33 kV | 3,470 | 0.3795 | 14,627.36 | not_ev | ✗ |

#### G. Götulýsing (street lighting)

`VGD1` (afmæld) and `ADG` (orkumæld). All `ev_category = not_ev`, `visible = ✗`.

#### Ó. Ótryggð orka (interruptible)

`ÓD1`, `ÓD2`, `ÓD3`, `ÓD6`. Spans 4.0454–4.2025 kr/kWh no VAT. All `not_ev`, `visible = ✗` *but* relevant if Straumvakt ever offers interruptible-charging products.

#### Heimtaugar / connection fees

50A 3-fasa 177,332 → 219,892 kr ... 900A 3-fasa 2,804,089 → 3,477,070 kr. Bráðabirgðaheimtaug, smáheimtaug, stækkun, endurkomu — full schedule on PDF pages 5–6. All `not_ev`, `visible = ✗` (one-time, not part of cost-per-session math).

---

### 5.4 Orkubú Vestfjarða — distribution

Same legal entity as §4.6 — Kennitala 660877-0299. Tariff source: https://www.ov.is/asset/4594/verdskra-dreifing-og-flutningur-raforku-13.10.2025 (effective 2025-10-13).

#### 1.1 Þéttbýli (urban)

| Code | Name | Unit | No VAT | + Jöfnun | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|---|---|
| A40T/A41T | Almenn + hiti, ≤80A — fastagjald | kr/ár | 25,528 | | 31,655 | 24% | general_supply | ✓ |
| A40T/A41T | Almenn 15% / hiti 85% — orkugjald | kr/kWh | 9.18 | 9.59 | 11.89 (24%) / 10.64 (11%) | mixed | not_ev | ✗ |
| A10T/A15T | Almenn notkun ≤80A — fastagjald | kr/ár | 25,528 | | 31,655 | 24% | general_supply | ✓ |
| A10T/A15T | Almenn notkun ≤80A — orkugjald | kr/kWh | 9.18 | 9.59 | 11.89 | 24% | general_supply | ✓ |
| C10T/D10T | Hitanotkun ≤80A — fastagjald | kr/ár | 25,528 | | 28,336 | 11% | not_ev | ✗ |
| C10T/D10T | Hitanotkun ≤80A — orkugjald | kr/kWh | 9.18 | 9.59 | 10.64 | 11% | not_ev | ✗ |
| A21T | Almenn 81–150A — orkugjald | kr/kWh | 8.37 | 8.78 | 10.89 | 24% | workplace_ev | ✓ |
| A21T | Almenn 81–150A — fastagjald | kr/ár | 86,979 | | 107,854 | 24% | workplace_ev | ✓ |
| A22T | Almenn 151–300A — orkugjald | kr/kWh | 8.37 | 8.78 | 10.89 | 24% | workplace_ev | ✓ |
| A22T | Almenn 151–300A — fastagjald | kr/ár | 295,733 | | 366,709 | 24% | workplace_ev | ✓ |
| A23T | Almenn 301–500A — orkugjald | kr/kWh | 8.37 | 8.78 | 10.89 | 24% | workplace_ev | ✓ |
| A23T | Almenn 301–500A — fastagjald | kr/ár | 591,465 | | 733,417 | 24% | workplace_ev | ✓ |
| B50T/B10T | Aflmæling — orkugjald | kr/kWh | 3.77 | 4.18 | 5.18 | 24% | not_ev | ✗ |
| B50T/B10T | Aflmæling — aflgjald | kr/kW/ár | 17,415 | | 21,595 | 24% | not_ev | ✗ |
| B50T/B10T | Aflmæling — fasviksgjald | kr/kWst/stig | 1.83 | | 2.27 | 24% | not_ev | ✗ |
| V10T | Ómæld smánotkun | kr/kW/ár | 241,618 | 245,210 | 304,060 | 24% | not_ev | ✗ |
| A30T | Útilýsing | kr/kW/ár | 44,017 | 45,739 | 56,716 | 24% | not_ev | ✗ |

#### 1.2 Dreifbýli (rural — same names with `D` suffix)

Higher unsubsidised cost, but a `dreifbýlisframlag` of 32.95% subsidy is netted off. Final with-VAT 15.25 kr/kWh for almenn notkun ≤80A (after subsidy). Full table on OV PDF p.3 — codes A40D/A41D, A10D/A15D, A10DF (Flatey), C10D/D10D, A21D, A22D, D22D, A23D, B50D/B10D, V10D, A30D. Apply `general_supply ✓` to A10D family, `workplace_ev ✓` to A21D–A23D, `not_ev ✗` to D22D, V10D, A30D, B50D.

#### 1.3 Þéttbýli og dreifbýli — interruptible

D40/D48 (under 1 MW within peak), D41/D50 (over 1 MW outside peak, util>4500), D42/D49 (over 1 MW outside peak, util<4500). All `not_ev`, `visible = ✗`.

#### Service / admin / connection

Mælaleiga (AXX): 62,970 → 78,083 kr/ár. Veita opnuð eftir lokun: 17,054 / 34,106 (workhours / out-of-hours, no-VAT). Aukaálestur: 8,528. Útkall: 20,420 / 40,840. Tengigjöld þéttbýli (63A 266,418 with VAT → 315A 1,301,208) and dreifbýli (35A 462,389 → 315A 1,650,277). All `not_ev`, `visible = ✗`.

---

### 5.5 Norðurorka — full 2026 schedule

| Field | Value |
|---|---|
| Legal name | Norðurorka hf. |
| Kennitala | 550978-0169 |
| Address | Rangárvöllum 5, 603 Akureyri |
| Phone | 460 1300 |
| Email | nordurorka@no.is |
| Website | https://www.no.is |
| Roles | dso (electricity, hot water, cold water, wastewater) |
| Status | active |
| Service area | Akureyri |
| Tariff URL | https://www.no.is/is/thjonusta/verdskra/rafveita |
| Tariff PDF | https://www.no.is/static/files/2026/Verdskrar/RV/rafveita-gjaldskra-1.1.2026-lokautgafa.pdf |

VAT: 24% normal, 11% rafhitun. Validity from **2026-01-01**. Same schedule applies across the full Norðurorka territory.

#### Almenn orkunotkun

| Code | Name | Unit | No VAT (Stofn til vsk) | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|---|
| A1D | ≤100A — orkugjald | kr/kWh | 9.33 | 11.57 | 24% | general_supply | ✓ |
| A1D | ≤100A — fastagjald | kr/dag | 60.20 | 74.65 | 24% | general_supply | ✓ |
| A4D | 101–500A — orkugjald | kr/kWh | 8.87 | 11.00 | 24% | workplace_ev | ✓ |
| A4D | 101–500A — fastagjald | kr/dag | 429.40 | 532.46 | 24% | workplace_ev | ✓ |

Components on A1D: Grunnur 6.16 + Dreifing 2.65 + Flutningur 0.52 + Jöfnun 0.00 = 9.33 no VAT.

#### Rafhitun

| Code | Unit | No VAT | With VAT (11%) | ev_category | visible |
|---|---|---|---|---|---|
| C1D — orkugjald | kr/kWh | 9.33 | 10.36 | not_ev | ✗ |
| C1D — fastagjald | kr/dag | 60.20 | 66.82 | not_ev | ✗ |

#### Afl og orkunotkun (B-taxtar)

| Code | Component | Unit | No VAT | With VAT | ev_category | visible |
|---|---|---|---|---|---|---|
| B11D (lágspenna) | Orkugjald | kr/kWh | 3.61 | 4.48 | not_ev | ✗ |
| B11D | Aflgjald | kr/kW/dag | 46.61 | 57.80 | not_ev | ✗ |
| B11D | Fastagjald | kr/dag | 573.83 | 711.55 | not_ev | ✗ |
| B11D | Fasviksgjald | kr/kVARh | 1.85 | 2.29 | not_ev | ✗ |
| B22D (háspenna) | Orkugjald | kr/kWh | 3.53 | 4.38 | not_ev | ✗ |
| B22D | Aflgjald | kr/kW/dag | 45.21 | 56.06 | not_ev | ✗ |
| B22D | Fastagjald | kr/dag | 628.52 | 779.36 | not_ev | ✗ |
| B22D | Fasviksgjald | kr/kVARh | 1.85 | 2.29 | not_ev | ✗ |

Aflgjald reckoned on annual peak (Oct–Apr), minimum 25 kW.

#### Tímaháð orkunotkun — tvígjaldstaxti

| Code | Tier | Hours | Unit | No VAT | With VAT | ev_category | visible |
|---|---|---|---|---|---|---|---|
| T1D | Daggjald | 08:00–20:00 every day | kr/kWh | 11.87 | 14.72 | general_supply | ✓ |
| T1D | Næturgjald | 20:00–08:00 every day | kr/kWh | 4.63 | 5.74 | home_ev | ✓ |
| T1D | Fastagjald | — | kr/dag | 910.89 | 1,129.50 | general_supply | ✓ |

#### Tímaháð orkunotkun — þrígjaldstaxti

| Code | Tier | Unit | No VAT | With VAT | ev_category | visible |
|---|---|---|---|---|---|---|
| T3LD (lágspenna) | Lág | kr/kWh | 6.34 | 7.86 | workplace_ev | ✓ |
| T3LD | Mið | kr/kWh | 8.67 | 10.75 | workplace_ev | ✓ |
| T3LD | Há | kr/kWh | 17.47 | 21.66 | workplace_ev | ✓ |
| T3LD | Fastagjald | kr/dag | 1,116.53 | 1,384.50 | workplace_ev | ✓ |
| T3HD (háspenna) | Lág | kr/kWh | 5.84 | 7.24 | not_ev | ✗ |
| T3HD | Mið | kr/kWh | 7.72 | 9.57 | not_ev | ✗ |
| T3HD | Há | kr/kWh | 15.07 | 18.69 | not_ev | ✗ |
| T3HD | Fastagjald | kr/dag | 3,791.24 | 4,701.14 | not_ev | ✗ |

Lág: Oct/Apr 21:00–08:00 weekdays + weekends 24/7; May–Sep 24/7. Mið: Oct/Apr 08:00–21:00 weekdays; Nov–Mar 14:00–17:00 + 21:00–08:00 weekdays + weekends 24/7. Há: Nov–Mar 08:00–14:00 + 17:00–21:00 weekdays.

#### Skerðanlegur flutningur (interruptible)

D1D, D2D, D3D — by contract, on the way out per the PDF ("á útleið"). `not_ev ✗`.

---

### 5.6 Rafveita Reyðarfjarðar

| Field | Value |
|---|---|
| Legal name | Rafveita Reyðarfjarðar (operated by Fjarðabyggð) |
| Kennitala | 410272-2459 |
| Address | Hafnargötu 2, 730 Reyðarfirði |
| Phone | 470 9000 (Fjarðabyggð) |
| Email | fjardabyggd@fjardabyggd.is |
| Website | https://www.fjardabyggd.is |
| Roles | dso |
| Status | active |
| Service area | Reyðarfjörður |
| Tariff URL | none public — request from Fjarðabyggð directly |
| Notes | Founded 1930. Smallest of the six DSOs. No public tariff PDF; not currently scrapeable. |

---

## 6. CPOs and charger-rental operators

This section covers two related but distinct operator types:

- **Public charge point operators (CPOs)** — sit on top of the retailer + DSO + TSO stack, buy electricity wholesale (or operate as resellers) and bill drivers per kWh / per minute through their own apps. Pricing is surfaced through each operator's mobile app rather than a flat published schedule; where typical bands are well-known they're listed below, otherwise rows are marked `~` (approximate) or `see app`.
- **Charger-rental / charger-as-a-service** — sell or subscribe home / MDU / workplace hardware. Some are also retailers or CPOs; one (Amper) does only this. Use the **`home_charging` role** filter to see all of them at once.

### Charger-rental cross-reference (the "who rents a charger?" answer)

| Operator | Role(s) | Cheapest sub. (kr/mán, with VAT) | Top sub. | Notes |
|---|---|---|---|---|
| **Orkusalan** | retailer + CPO + rental | **990** (Amina) | 3,410 (Easee Charge) | Plus 119,990 kr install one-off; see §4.2 |
| **ON** | retailer + producer + CPO + rental | **1,190** (own charger) | 5,500 (Subscription+) | Multiple flavours for home + business; see §4.1 |
| **HS Orka** | retailer + producer + rental | **2,490** (22 kW AC Compact) | 4,490 (22 kW Wallbox) | 1-month cancellation; customer arranges installer; see §4.3 |
| **ON — Heimahleðsla** | (above) | **2,900** (detached, charger included) | 4,400 (apartment) | "Charger included" tier; see §4.1 |
| **Amper** | rental-only | **3,390** (charger only) | 4,380 (charger + infrastructure) | Pure subscription. No upfront cost. Optional purchase from 219,990 / 299,990 kr + 990 kr/mán service. Buys back existing installs. See §6.6 |
| **Ísorka** | CPO + rental | quote in app | quote in app | Heimahleðsla product; see §6.1 |

Pricing here is `home_ev` category by definition; everything is `default_visible: true` in EV-context UIs.

### 6.1 Ísorka

| Field | Value |
|---|---|
| Legal name | Ísorka ehf. |
| Kennitala | 450808-1560 |
| Address | Sævarhöfði 2, 110 Reykjavík |
| Phone | 568 7666 |
| Email | isorka@isorka.is |
| Website | https://isorka.is |
| Roles | public_charging, home_charging |
| Status | active |
| Service area | National — 3,000+ stations |
| Tariff URL | https://isorka.is/pages/hledslunet |
| Notes | Largest CPO in Iceland. Olís, ÓB, hotels and many municipal sites are hosted on the Ísorka network. Per-station pricing surfaces through the Hleðsluappið mobile app rather than a single published schedule. |

| Name | Applies to | Unit | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|
| AC public 22 kW (typical) | Public AC | kr/kWh | ~30 | 24% | public_ev | ✓ |
| DC fast 50 kW (typical) | Public DC | kr/kWh | ~45 | 24% | public_ev | ✓ |
| DC fast 150 kW (typical) | Public DC | kr/kWh | ~55 | 24% | public_ev | ✓ |
| DC ultra 300+ kW (typical) | Public DC | kr/kWh | ~65 | 24% | public_ev | ✓ |
| Idle / time fee (after grace) | Per minute | kr/min | varies | 24% | public_ev | ✓ |
| Hleðsluappið — app access | App | kr/mán | free | — | general_supply | ✓ |
| Heimahleðsla — home wallbox + service | Heimili | kr/mán | see app | 24% | home_ev | ✓ |

---

### 6.2 Bílorka (e1)

| Field | Value |
|---|---|
| Legal name | Íslensk Bílorka ehf. |
| Kennitala | 701277-0239 |
| VSK nr | 11650 |
| Address | Reykjavík |
| Phone | 515 7800 |
| Email | info@bilorka.is |
| Website | https://bilorka.is |
| Roles | public_charging |
| Status | active |
| Service area | Reykjavík, Hafnarfjörður, Reykjanesbær, Búðardalur, Reykhólar, Akureyri, Þórshöfn |
| Tariff URL | https://bilorka.is/hradhledslustodvar-kort |
| Notes | Brimborg-affiliated CPO. 17 DC fast-charging stations (DC30 → DC600). Pricing tiered by station capacity, surfaced through the eONE / e1 app. Operates Iceland's first 600 kW station in Reykjanesbær. |

| Name | Applies to | Unit | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|
| 30 kW DC — base rate | Public DC | kr/kWh | 29 | 24% | public_ev | ✓ |
| 150 kW DC — base rate | Public DC | kr/kWh | ~45 | 24% | public_ev | ✓ |
| 300–400 kW DC — base rate | Public DC | kr/kWh | 59 | 24% | public_ev | ✓ |
| 600 kW ultra DC | Public DC | kr/kWh | 59 | 24% | public_ev | ✓ |
| Brimborg-brand discount | Volvo / Polestar / Ford / Mazda / Citroën / Peugeot / Opel | rebate | rebate | — | public_ev | ✓ |
| Time fee — after 45 min | Per minute | kr/min | 55 | 24% | public_ev | ✓ |
| Connection fee — after 1.0 kWh | Per session | kr | see app | 24% | public_ev | ✓ |

---

### 6.3 Olís (charging)

| Field | Value |
|---|---|
| Legal name | Olíuverzlun Íslands hf. |
| Kennitala | 500269-2649 |
| Address | Skútuvogur 5, 104 Reykjavík |
| Phone | 515 1000 |
| Email | olis@olis.is |
| Website | https://www.olis.is |
| Roles | public_charging |
| Status | active |
| Service area | Olís + ÓB station network — nationwide |
| Tariff URL | https://www.olis.is/rafhledsla |
| Notes | Fuel-station chain. Public chargers at Olís and ÓB locations are operated **on the Ísorka network** and accessed via the Ísorka app — Olís is the location host, Ísorka is the technical CPO. Pricing below is from the 2021 launch announcement and is likely outdated; treat the Ísorka app as the source of truth. |

| Name | Applies to | Unit | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|
| AC 22 kW slow charging | Public AC | kr/kWh | 23 | 24% | public_ev | ✓ |
| DC 50 kW fast charging | Public DC | kr/kWh | 45 | 24% | public_ev | ✓ |
| Time fee — DC after 30 min | Per minute | kr/min | 10 | 24% | public_ev | ✓ |

---

### 6.4 N1 (charging)

| Field | Value |
|---|---|
| Legal name | N1 ehf. |
| Kennitala | 411003-3370 |
| Address | Dalvegur 10–14, 201 Kópavogur |
| Phone | 440 1000 |
| Email | n1@n1.is |
| Website | https://n1.is |
| Roles | public_charging |
| Status | active |
| Service area | Borgarnes, Staðarskáli (Borðeyri), Vík, Hvolsvöllur, Egilsstaðir, Sauðárkrókur, Ísafjörður, + additional N1 fuel sites |
| Tariff URL | https://www.n1.is/thjonusta/hledslulausnir/verdskra/ |
| Notes | Fuel-station chain (parent: Festi hf., kt 540206-2010). Distinct from N1 Rafmagn ehf — see §4.5. Public DC fast chargers live at major N1 fuel sites around the ring road; access and payment via the N1 app (card or N1 points). Per-kWh rates surface in the verðskrá page / app. |

| Name | Applies to | Unit | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|
| DC 50 kW (typical) | Public DC | kr/kWh | ~45 | 24% | public_ev | ✓ |
| DC 150 kW (typical) | Public DC | kr/kWh | ~55 | 24% | public_ev | ✓ |
| DC 300+ kW (typical) | Public DC | kr/kWh | ~65 | 24% | public_ev | ✓ |
| 3% N1 Points cashback per session | Card / app holders | rebate | rebate | — | public_ev | ✓ |
| Idle / time fee | Per minute | kr/min | see app | 24% | public_ev | ✓ |

---

### 6.5 Tesla Supercharger

| Field | Value |
|---|---|
| Legal name | Tesla, Inc. (Iceland operations) |
| Kennitala | — (foreign-operated; no Icelandic registration) |
| Roles | public_charging |
| Status | active |
| Service area | Keflavík, Vatnagardar (RVK), Álfabakki (RVK), Fossvogur (RVK), Akureyri, Höfn |
| Tariff URL | https://www.tesla.com/findus/list/superchargers/Iceland |
| Notes | 7 Supercharger locations across Iceland. Most sites are open to non-Tesla EVs via CCS adapters — non-Tesla rates are higher than the Tesla-owner rates listed below. Idle fees apply once the car is full and other vehicles are waiting. Billing routes through Tesla account, not local Icelandic invoicing. |

| Name | Applies to | Unit | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|
| Vatnagardar — off-peak (00:00–08:00, 23:00–00:00) | Tesla owners | kr/kWh | 29 | 24% | public_ev | ✓ |
| Vatnagardar — evening (19:00–23:00) | Tesla owners | kr/kWh | 50 | 24% | public_ev | ✓ |
| Vatnagardar — peak (08:00–19:00) | Tesla owners | kr/kWh | 54 | 24% | public_ev | ✓ |
| Akureyri — base rate | Tesla owners | kr/kWh | 36 | 24% | public_ev | ✓ |
| Keflavík — base rate | Tesla owners | kr/kWh | 38 | 24% | public_ev | ✓ |
| Non-Tesla CCS surcharge | Non-Tesla EV | multiplier | higher | 24% | public_ev | ✓ |
| Idle fee — when other cars wait | Per minute | kr/min | see app | 24% | public_ev | ✓ |

---

### 6.6 Amper *(charger rental — pure subscription)*

| Field | Value |
|---|---|
| Legal name | Amper Orka ehf. |
| Kennitala | 471123-0210 |
| VSK nr | 154494 |
| Address | Borgartún 25, 105 Reykjavík |
| Phone | 546 4200 |
| Email | amper@amper.is |
| Website | https://www.amper.is |
| Roles | home_charging |
| Status | active |
| Service area | National — home, MDU and workplace installations |
| Tariff URL | https://www.amper.is/ |
| Notes | Pure home / MDU / workplace charger-as-a-service. Pioneered Iceland's no-upfront-cost subscription model. Does **not** sell electricity directly — passes customers to a partner retailer at ~20.8 kr/kWh. Distinctive: will buy back an existing home charger when a customer switches (up to 100% reimbursement). |

| Name | Applies to | Unit | With VAT | VAT | ev_category | visible |
|---|---|---|---|---|---|---|
| Subscription — charger + infrastructure | Heimili / Fjölbýli | kr/mán | 4,380 | 24% | home_ev | ✓ |
| Subscription — charger only | Heimili / Fjölbýli | kr/mán | 3,390 | 24% | home_ev | ✓ |
| Purchase — charger + infrastructure | Heimili / Fjölbýli | kr | 299,990 | 24% | home_ev | ✓ |
| Purchase — charger only | Heimili / Fjölbýli | kr | 219,990 | 24% | home_ev | ✓ |
| Service fee (with purchase) | Owned install | kr/mán | 990 | 24% | home_ev | ✓ |
| Electricity supply — via partner | Heimili | kr/kWh | ~20.8 | 24% | general_supply | ✓ |
| Existing-install buyback | Existing install | rebate | up to 100% | — | home_ev | ✓ |

Subscription terms: month-to-month cancellation with one month's notice. Subscription rate is indexed to inflation but otherwise fixed during the contract. Purchase warranty: 5 years on the charger, 2 years on the infrastructure.

---

## 7. TSO

### 7.1 Landsnet — full Gjaldskrá nr. 20

| Field | Value |
|---|---|
| Legal name | Landsnet hf. |
| Roles | tso |
| Status | active |
| Tariff URL | https://www.landsnet.is/library?itemid=efb00f23-d1f2-4d51-aaaa-bf9043e0ea8a |
| Tariff document | Gjaldskrá nr. 20 — gildir frá 1. janúar 2016. Periodic numerical adjustments published as news items. |

VAT: not applicable (B2B between Landsnet and DSOs/stórnotendur). Stórnotandi tariffs in USD.

#### 4.1 Innmötun (production-side delivery)

| Item | Unit | Price |
|---|---|---|
| Afhendingargjald | kr/ár | 5,176,725 |

#### 4.1 Úttekt — dreifiveitur (DSO offtake)

| Item | Unit | Price | ev_category | visible |
|---|---|---|---|---|
| Afhendingargjald | kr/ár per delivery point | 5,176,725 | not_ev | ✗ |
| Aflgjald | kr/ársMW | 5,315,090 | not_ev | ✗ |
| Orkugjald | kr/MWst | 384.87 | not_ev | ✗ |

Per `4.4`: if utilisation > 4,500 hr/yr the orkugjald drops to **418.00 kr/MWst** flat; below 4,500 hr/yr it rises to **1,100.00 kr/MWst**. (These are post-2016 publishable adjustments inside the same gjaldskrá nr. 20 framework.)

#### 4.1 Úttekt — stórnotendur

| Item | Unit | Price (USD) |
|---|---|---|
| Afhendingargjald | USD/ár | 55,395 |
| Aflgjald | USD/ársMW | 32,268 |
| Orkugjald | USD/MWst | 1.632 |

#### 4.2 Kerfisþjónusta og flutningstöp

| Item | Unit | Price |
|---|---|---|
| Kerfisþjónusta | kr/MWst | 47.69 |
| Flutningstöp | kr/MWst | 98.41 |

#### Modifiers

- 5% rebate on aflgjald + orkugjald where delivered above 66 kV.
- 17% rebate on kerfisþjónusta for skerðanlegur flutningur.
- 40% rebate on afhendingargjald for 3.0–6.0 MW peak. 70% rebate for 1.0–3.0 MW.
- 2% jöfnunarorkumarkaðsgjald, charged to the balancing-responsible party.

All `ev_category = not_ev`, `visible = ✗` — Landsnet sits behind the DSO and is never directly billed to a charging session.

---

## 8. Maintenance plan

This is reference data and **will go stale**. To keep it useful:

1. Re-verify each tariff URL once a quarter — the URL itself is the most reliable field. PDFs change names; the index page persists.
2. Re-extract Veitur, RARIK PDFs once a parser handles compressed PDF streams in CI.
3. Treat `valid_from` dates as the trigger for re-fetching: if a row's `valid_from` is more than 18 months stale, the underlying number probably is too.
4. When the `energy.parties` and `energy.tariff_catalogue` models land, this doc becomes the seed data for the migration. The column set in §3 and the row schema in §2.4 are the contract.
5. **Don't put VSK numbers in this doc unless seen on an actual invoice** — the VSK-skrá at Skatturinn is authoritative; the search-engine snippets used elsewhere are not.
