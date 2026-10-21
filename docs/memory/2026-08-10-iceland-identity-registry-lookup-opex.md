# Iceland Identity, Registry And Lookup OPEX Memory

Date: 2026-08-10

This table is a memory note for Straumvakt Core/product-to-market cost modelling. It is **not Cloudflare/Neon connector OPEX**. It is a separate external verification, registry, identity, and lookup OPEX layer that may affect onboarding, driver verification, organisation validation, billing trust, and future premium/vehicle features.

Working product implication:

- Use eID for identity proofing and sensitive actions, not every normal login.
- Prefer official Icelandic source-of-truth data where possible.
- Prefer HMS local address data over paid address APIs for Core.
- Keep person address, vehicle lookup, and vehicle ownership lookups out of Core unless legally/product-required.
- Track lookup/auth counts separately from connector cloud OPEX.

| Need | Recommended source | API / access | Setup estimate | Monthly estimate | Per lookup / auth | Alternative | Alternative cost | Official source-of-truth? |
|---|---|---|---:|---:|---:|---|---:|---|
| **Icelandic eID** | **Kenni -> Audkenni** | OIDC / web auth | **0 kr** | **500 kr** Sproti or **5,000 kr** subscription | **26 kr/auth** Sproti or **10.4 kr/auth** subscription | Audkenni direct | 108,000 setup + 17,000/mo + certificate renewal | Yes, underlying identity is Audkenni |
| **Icelandic eID - direct** | **Audkenni** | Direct integration | **108,000 kr** | **17,000 kr** | first 100 status queries free; then **10.4 kr/query**, decreasing with volume | Kenni | See above | Yes |
| **Organisation by kennitala** | **Skatturinn Company Registry API v2.1** | REST + API credentials | Probably minimal | **No published API price found** | **TBC** | Ja Gagnatorg | 2,350/mo + **14 kr/lookup** | Yes, Skatturinn is source |
| **Valid Icelandic address / autocomplete** | **HMS Stadfangaskra** | Download dataset -> own DB/API | Dev time only | **approx 0 kr** + DB hosting | **0 kr** | Google Places Autocomplete | first 10k requests/mo free; then **$2.83/1,000** | Yes, HMS only |
| **Address validation / correction** | **HMS + own search** | Local/Postgres search | Dev time only | approx 0 | **0 kr** | **Google Address Validation API** | first 5k/mo free; then **$17/1,000** | No, Google is not registry authority |
| **Person's registered address** | **Thjodskra** | Restricted/licensed | Contract dependent | Contract dependent | Contract dependent | **Ja Gagnatorg** | 2,350/mo; **14 kr base + 21 kr additional data** | Yes, underlying Thjodskra |
| **Vehicle by plate/VIN** | **Samgongustofa / authorized processor** | Registry/XML arrangement | **Quote required** | Contract dependent | Current price needs confirmation | Generic VIN API | Often cheap/free, but **not Icelandic registration data** | Yes, Samgongustofa |
| **Vehicles owned by person** | **Samgongustofa** | Restricted; authorization required | **Quote required** | Contract dependent | Current price needs confirmation | None equivalent | - | Yes |

## Roadmap Notes

Add this as a separate cost bucket in product-to-market planning:

```text
Identity / registry / lookup OPEX
```

Suggested metrics to instrument later:

| Metric | Why |
|---|---|
| eID auth attempts per driver/month | Direct paid auth cost |
| successful eID verifications | Onboarding/security cost |
| organisation registry lookups | Org onboarding cost |
| HMS address lookups | Should remain local/free |
| paid fallback lookups | External lookup OPEX |
| vehicle lookups | Future/premium cost |
| vehicle ownership checks | Future/legal-heavy cost |

Core launch recommendation:

1. Manual organisation/admin onboarding where possible.
2. Kenni/Audkenni only for identity proofing or sensitive flows.
3. HMS local address dataset for address validation/autocomplete.
4. Avoid Thjodskra person-address and Samgongustofa ownership lookups in Core unless required.
5. Treat vehicle lookup/ownership as premium/future until proven necessary.

## Web UI GBT Cost Notes

These notes came from the Web UI GBT follow-up and should be kept with the lookup/OPEX memory.

### Audkenni vs Kenni

Audkenni direct is expensive at low/medium volume compared with Kenni.

Audkenni March 2026 tariff notes:

| Item | Cost |
|---|---:|
| Startup | 108,000 kr |
| Monthly fee | 17,000 kr/month |
| One-year equipment certificate | 44,800 kr |
| Status queries | first 100 free, then 10.4 kr/query, falling to 3.6 kr at very high volume |

Important nuance: Audkenni charges per **status query**, which is not necessarily the same as one completed login.

Kenni remains attractive for Straumvakt:

| Kenni tier | Monthly | Per eID auth |
|---|---:|---:|
| Entry / Sproti | 500 kr/month | 26 kr/auth |
| Subscription | 5,000 kr/month | 10.4 kr/auth |

Product implication: use eID for identity proofing and sensitive flows, not repeated normal login.

### Fyrirtaekjaskra / Company Registry

Skatturinn lists Company Registry Public API v2.1 as a public REST API with registered access/API credentials. No public price was found for the API product, so cost remains **TBC**.

Ja fallback pricing:

| Ja option | Cost |
|---|---:|
| Basic access | 2,350 kr/month |
| Basic Thjodskra/Fyrirtaekjaskra lookup | 14 kr/lookup |
| Additional Thjodskra information | 21 kr |
| Full registry access | 15,600 kr/month, no per-lookup fee |

### Google Address UX vs HMS Authority

Google can improve address UX but should not replace HMS as the canonical address source.

Google notes:

| Google API | Free monthly cap | Paid tier |
|---|---:|---:|
| Places Autocomplete | 10,000 requests | $2.83 / 1,000 |
| Geocoding | 10,000 requests | $5 / 1,000 |
| Address Validation Pro | 5,000 requests | $17 / 1,000 |

Two viable designs:

| Architecture | User types | Validation | Canonical stored address | Cost |
|---|---|---|---|---:|
| Cheapest | Straumvakt HMS autocomplete | HMS | HMS | approx 0 kr/request |
| Best UX | Google Places | Google + HMS cross-check | HMS | very low at normal Icelandic scale |

Recommendation remains: use HMS Stadfangaskra locally in PostgreSQL/PostGIS and expose a Straumvakt `/addresses/search` endpoint. It is cheaper and more authoritative.

### Vehicles / Samgongustofa

Samgongustofa / Okutaekjaskra is the difficult and likely expensive part.

Access is controlled around ownership information. Lookups by fastanumer, registration number, and VIN are possible through approved electronic/XML arrangements. Ownership-by-kennitala is more restricted and likely requires proper authorization/legal basis.

Historical 2015 tariff indication, **not safe as 2026 pricing without confirmation**:

| Historical tariff item | Published amount |
|---|---:|
| Electronic registry access setup | 309,996 kr |
| Vehicle / fastanumer lookup | 23 kr |
| Kennitala ownership lookup | 657 kr |
| Vehicle history lookup | 82 kr |

Interpretation: ownership-by-person has historically been much more expensive than ordinary vehicle lookup.

### Suggested Internal API Mapping

| Internal endpoint | Backend source | Expected marginal cost |
|---|---|---:|
| `POST /auth/eid` | Kenni -> Audkenni | 10.4-26 kr/auth |
| `GET /companies/{kennitala}` | Skatturinn | likely very low / TBC |
| `GET /addresses?q=` | Local HMS Stadfangaskra | approx 0 kr |
| `GET /person/{kt}/address` | Ja / Thjodskra, only when required | approx 14-35 kr |
| `GET /vehicles/{plate}` | Samgongustofa | TBC |
| `GET /me/vehicles` | Samgongustofa + authenticated kennitala | TBC / restricted |

Google cannot solve eID, kennitala/company authority, or Icelandic vehicle ownership. It can solve address autocomplete, normalization, geocoding, and validation, but HMS local remains preferred for Core.

### Next Unknowns To Investigate

1. Actual 2026 Samgongustofa commercial/API tariff.
2. Skatturinn Company Registry Public API v2.1 quota/pricing.

## Core Addition: DSO Auto-Selection From HMS Address + Raforkudreifing

Decision date: 2026-08-10

This is now part of Straumvakt Core planning.

Core requirement:

```text
When an organisation/site/charger address is selected, Straumvakt should suggest the correct DSO and tariff area automatically.
```

Target source chain:

```text
HMS Stadfangaskra address
-> HMS coordinates
-> point-in-polygon against Raforkudreifing DSO service areas
-> suggested DSO + tariff area
-> admin confirm/override
-> versioned DSO rate used for billing
```

Postal code is useful for search/display and may be a fallback, but it is not the preferred authority because DSO boundaries do not necessarily follow postal-code boundaries. Gardabaer north/south split is the obvious warning case.

Raforkudreifing source finding:

| Item | Finding |
|---|---|
| Dataset name | Raforkudreifing |
| Likely authority | Orkustofnun / Raforkueftirlitid |
| Catalogue surface | Lysigagnagatt / geonetwork |
| Coverage | Electricity distribution areas for Veitur, Orkubu Vestfjarda, HS Veitur, Nordurorka, RARIK |
| Important detail | RARIK and Orkubu Vestfjarda are split into rural, urban, and settlement-core areas reflecting tariff divisions |
| Core use | DSO auto-selection and default DSO tariff/rate setup from site address |

Core implementation notes:

1. Import HMS Stadfangaskra locally and store official address identifiers plus coordinates.
2. Import Raforkudreifing polygons locally.
3. Use point-in-polygon to suggest DSO and tariff area.
4. Store the selected/confirmed DSO and tariff area on the site/charger billing configuration.
5. Allow admin override with audit reason.
6. Version the DSO mapping/rate so historical billing is not silently changed if datasets update.
7. Keep postal-code-to-DSO mapping only as fallback/bootstrap.

Sources to retrieve/verify later:

- Orkustofnun / Raforkueftirlitid service-area information.
- Raforkudreifing dataset from Lysigagnagatt/geonetwork.
- HMS Stadfangaskra CSV/WFS source for coordinates.
