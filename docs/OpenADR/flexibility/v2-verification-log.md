# Verification log — Technical Report v1.0 → v2.0

Every factual claim in v1.0 that could be checked against a primary source, and what happened to it. Prepared 5 Aug 2026.

**Verdict key:** ✅ confirmed against primary source · ⚠️ correct but qualified · ❌ wrong, corrected · 🔍 could not verify · ➕ new material

---

## Landsnet

| Claim | Verdict | Evidence |
|---|---|---|
| Capacity charge = mean of four highest 60-min monthly peaks per delivery point | ✅ | Gjaldskrá nr. 20 gr. 4.5, verbatim: *"Aflgjald vegna úttektar er reiknað út frá meðaltali fjögurra hæstu 60 mínútna mánaðarafltoppa ársins fyrir sérhvern afhendingarstað"* |
| No capacity charge for curtailable transmission under B5 | ✅ | gr. 4.4, verbatim |
| Tariff rate ISK 9,786,291/MW "effective 1 April 2026" | 🔍 | Current Landsnet tariff PDF not publicly indexed. Verified 2016 figure is 5,315,090. Verified that DSO items fell **8.5%** on 1 Jan 2026 and the transmission component fell a further ~10% at Veitur on 1 Apr 2026. §11 rewritten parametrically. **Get the rate from Landsnet before circulating.** |
| Delivery charge 9,531,530; energy 708.64; system services 122.04; losses 65.52 | 🔍 | Same issue. 2016 verified: 5,176,725 / 384.87 / 47.69 / 98.41 |
| 2025 investment ≈ USD 118 m | ✅ | Ársreikningur 2025 |
| ≈ USD 22.4 m refunded after Supreme Court; revenue cap unchanged | ✅ | Ársreikningur 2025. (Checked against the USD 22.5 m dividend — separate figures, not conflated.) |
| Supreme Court 2024 ruled the in-feed charge unlawful | ✅ | Hæstiréttur case **2/2024**, judgment **5 June 2024**, Landsvirkjun v. Landsnet. Charge had taken effect 1 Apr 2022; 2011 amendment removed the enabling provision |
| — | ➕ | gr. 4.4 also grants **17% off system services** for curtailable transmission, expressly equal to Landsnet's reserve-power cost |
| — | ➕ | gr. 4.4 utilisation tiers: **418 ISK/MWh above 4,500 h**, **1,100 ISK/MWh below** — a 2.63× penalty on low-utilisation customers |
| — | ➕ | gr. 7.2: delivery charge already discounted by measured peak (40% at 3–6 MW, 70% at 1–3 MW, waivable below 1 MW) |
| — | ➕ | gr. 8.1: no DSO withdrawal charge on embedded generation **below 1.42 MW**; taper to 60% at 3.1 MW; 60% to 10 MW |
| — | ➕ | Landsnet runs its **own kerfisframlag terms** (Netmáli D2/D3, D3 v3.0, 2025), parallel to the DSOs' Netmáli 1.0 |

## RARIK

| Claim | Verdict | Evidence |
|---|---|---|
| Injection tariff edition 46, effective 1 Dec 2025 | ✅ | Primary tariff page |
| Fixed fees 105,930 / 141,240 / 200,090 / 294,250; capacity 837,638 ISK/MW | ✅ | All five figures exact. VAT-inclusive equivalents also published (131,353 / 175,138 / 248,112 / 364,870 / 1,038,671) |
| Applies above 16 A | ✅ | Below that, *örvirkjanir* fall under the standard distribution tariff |
| Generator classes are asynchronous/synchronous | ⚠️ | ISK figures verified; the class labels should be confirmed against the Icelandic original before publication |
| Reference URL `/gjaldskrar/gjaldskra-fyrir-innmotun-raforku` | ❌ | v1.0 URL path was wrong; corrected |
| Small-generator credit described as "payments … using four highest peaks" | ❌ | Conflates two mechanisms. Landsnet gr. 8.1 sets the MW thresholds; RARIK **art. 17.a** grants a **50% discount** on energy and capacity charges. Corrected in §4.1 |
| — | ➕ | **1 Dec 2025: RARIK abolished per-connection profitability assessment** for small generators; <140 kW (200 A) moved to the standard connection tariff; ISK 100,000 agreement fee above 100 kW, creditable and lapsing |
| — | ➕ | **44 generating plants, ≈74 MW** already embedded in RARIK's distribution network (12 kW–10 MW range) |
| — | ➕ | 1 Jan 2026: Landsnet items in RARIK's tariff **−8.5%**; jöfnunargjald 0.41→0.52 firm, 0.13→0.17 curtailable |

## The four DSOs v1.0 did not cover

| Finding | Verdict | Evidence |
|---|---|---|
| Iceland has exactly five DSOs: RARIK, Veitur, HS Veitur, Orkubú Vestfjarða, Norðurorka | ✅ | Raforkueftirlitið. Two split urban/rural revenue caps, three use a combined cap |
| **Veitur** replicates the four-peak rule | ➕ ✅ | *"Sölutoppur ársins reiknast síðan sem meðaltal fjögurra hæstu mánaðartoppanna"* |
| Veitur 2026 changes | ➕ | 1 Jan: distribution +1.11%, Landsnet component −6.67%, jöfnunargjald +27%. 1 Apr: distribution −3.23%; transmission component 2.80→2.50 ISK/kWh |
| **HS Veitur** replicates the four-peak rule | ➕ ✅ | Verðskrá nr. 35 (1 Jan 2026): *"Ársuppgjör afltoppa er miðað við meðaltal fjögurra hæstu mánaðar toppa ársins"*, with pro-rated partial-year variants |
| HS Veitur **BD4 weights summer peaks at 50%** (Apr–Sep), winter at 100% | ➕ | An existing seasonal flexibility product in an Icelandic DSO tariff |
| HS Veitur BD6/7/8 gated at **2 MW / 7,000 h / 14 GWh / 5-yr take-or-pay** | ➕ | Structurally excludes seasonal sites from the best tariffs |
| HS Veitur publishes *Ótryggð orka* classes ÓD1–ÓD6 | ➕ | Conditioned on ability to interrupt at short notice |
| HS Veitur ADÞ three-rate time-of-use with seasonal + hourly bands | ➕ | ToU distribution pricing already exists |
| HS Veitur standard connection fees to **900 A**, written offer above | ➕ | Bears on the "630 A" practitioner claim |
| **Orkubú Vestfjarða** replicates the four-peak rule, with a **15 kW floor** | ➕ ✅ | Verðskrá (1 Jul 2026) Skýring 2 |
| OV *Skerðanleg orka* classes D40–D50, split at **4,500 utilisation hours** | ➕ | 3.73 vs 5.10 ISK/kWh — 1.37× penalty; jöfnunargjald 0.34 vs 1.01 |
| OV written offer above **315 A**; dreifbýlisframlag 38.4% | ➕ | Threshold differs from HS Veitur's 900 A by 3× |
| **Norðurorka**: single tariff across service area; demand tariff mandatory above 500 A; effective 1 Jul 2026 | ➕ ⚠️ | Structure obtained; **rate figures not obtained** — noted as a limitation in §15.2 |
| All five adopted **Netmáli 1.0** (consultation to 14 Mar 2025, effective 15 May 2025) | ✅ ➕ | Precedent for a collective national method — recommended venue for the dynamic-access product |

## OpenADR

| Claim | Verdict | Evidence |
|---|---|---|
| "OpenADR 3.0" | ❌ | Current is **3.1.0** (Definitions Final, 7 Aug 2025; YAML 1 Aug 2025). **Not fully backwards compatible** with 3.0.1 |
| Bespoke `IS_*` application profile | ❌ | Standard enumerations already cover import/export limits, capacity request/offer, flexibility availability, activation, metered response, exception state, baseline settlement and storage/V2G state. Profile rewritten as a constraint document |
| KPI "event delivery **and acknowledgement** ≤5 s" | ❌ | **No application-level ACK exists in OpenADR 3.** Replaced with a report-POST-referencing-event-ID measurement plus the boundary meter |
| Fail-safe presented as a design choice | ❌ | Mechanism is standardised: `IMPORT_/EXPORT_CAPACITY_SUBSCRIPTION`. Only the value needs setting |
| Units | ➕ | Enum has `KW`, **no `MW`**. Profile must standardise on kW |
| Conflict resolution | ➕ | `event.priority` is an integer, lower = higher; **same-priority conflict behaviour is undefined** in the spec — must be an Icelandic profile item, and it is the DSO–TSO primacy rule in protocol form |
| Event cancellation | ➕ | No cancellation operation exists; profile must pick `PT0S`/`0001-01-01` or DELETE |
| `intervalPeriod.randomizeStart` | ➕ | Exists to prevent synchronised switching across many sites; added as a mandatory test case |
| "OpenADR is the DOE interface" | ⚠️ | **CSIP-AUS, the most mature DOE deployment, is IEEE 2030.5-based.** Conceded openly; OpenADR case rests on operational cost of ownership (no PKI), not technical superiority |
| Certification | ➕ | A **closed-system VTN built by a utility and not resold may certify against OpenADR 3 alone** — no 2.0b obligation. Useful in vendor conversations |
| Six documented defects in the published 3.1.0 documents | ➕ | Undefined `read_bl` scope; `/notifiers` scope contradiction; YAML default artifact; `oneOf` without discriminator; stale Figure 6; wrong auth verb |

## Statistics added

| Series | Source | Status |
|---|---|---|
| Registered vehicles by energy source, 1995–2024 (EV 521 → 25,238; PHEV, hybrid, petrol, diesel) | Hagstofa Íslands PxWeb **SAM30120** | ➕ Pulled directly from the API |
| Passenger cars (M1) and vans (N1) year-end 2015–2025; cars per 1,000 inhabitants | Hagstofa Íslands PxWeb **SAM03105** | ➕ Pulled directly from the API |
| Start-2026 snapshot: 294,245 vehicles; 254,550 passenger cars; 36,657 pure EV = 14.4%; 2025 new EV 6,755 = 41% (private 62%, company 57.4%, rental 9.1%); 2026 private >60% | Samgöngustofa | ➕ |
| Cross-validation: Hagstofa year-end-2025 M1 = 254,362 vs Samgöngustofa start-2026 = 254,550 → **+0.07%** | Both | ➕ Both series independently corroborated |
| 2026 energy balance: 21.42 TWh demand vs 20.24 TWh capability = **−1.18 TWh** | Landsvirkjun | ➕ Converts the "timing gap" into a present-tense deficit |
| Tourism 2025: ≈2.27 m foreign departures via KEF; August ≈311,000 (2024: 281,000); KEF total 8.1 m | Ferðamálastofa / Isavia | ⚠️ v1.0's August figure (312,964) is within 0.6%; re-extract the monthly workbook before publication |
| Orkuspá Íslands 2025–2050 | orkuspaislands.is | ➕ Newer national forecast, cited alongside Landsnet's Raforkuspá 2024–2050 |

## Other v1.0 defects

| Issue | Verdict |
|---|---|
| §16.1 recommendations numbered **7–16** instead of 1–10 | ❌ Renumbered 1–12 |
| "630 A" presented as a near-rule | ⚠️ No statutory basis found — and now contrasted with published thresholds that differ 3× between operators (OV 315 A, HS Veitur 900 A, RARIK 200 A for generators). The underlying point is strengthened, not weakened |

## Not obtained

| Gap | Why | Recommended action |
|---|---|---|
| **EV counts per postcode / municipality** | Samgöngustofa's portal is a client-rendered dashboard with no public data endpoint reachable without a browser session; Hagstofa's transport tables carry no geographic dimension | Data request to Samgöngustofa, or an interactive "Download data" export from the dashboard. Would materially sharpen the locational-value and pilot-site arguments |
| Landsnet's current tariff rates | Current PDF not publicly indexed | Request directly from Landsnet; substitute **C** in §11.1 and Appendix B |
| Norðurorka rate figures | Behind a PDF not surfaced in search | Fetch from no.is directly |
| Netmáli 1.0 clause-level text (50%/30%, 25 years) | Adoption and effect date confirmed; percentages not re-verified against the signed document | Re-check against the signed Netmáli 1.0 PDF |
