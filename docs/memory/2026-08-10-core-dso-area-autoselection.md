# Core DSO Area Auto-Selection

Date: 2026-08-10

Status: Core planning decision

Straumvakt Core includes automatic DSO suggestion from official Icelandic address/location data.

## Decision

Use official HMS address coordinates and the Raforkudreifing DSO service-area dataset to suggest the DSO and tariff area for a site/charger address.

`	ext
HMS Stadfangaskra address
-> coordinates
-> Raforkudreifing polygon match
-> suggested DSO + tariff area
-> admin confirm/override
-> versioned DSO rate in billing config
`

Postal code is fallback/bootstrap only, not the preferred authority.

## Why

DSO boundaries do not necessarily follow postal-code boundaries. Gardabaer is a known warning example because Veitur and HS Veitur split the area north/south. Raforkudreifing is spatial and reflects DSO service areas; it also captures RARIK and Orkubu Vestfjarda rural/urban tariff divisions.

## Source Findings

| Item | Finding |
|---|---|
| Dataset | Raforkudreifing |
| Likely authority | Orkustofnun / Raforkueftirlitid |
| Catalogue | Lysigagnagatt / geonetwork |
| DSO coverage | Veitur, Orkubu Vestfjarda, HS Veitur, Nordurorka, RARIK |
| Tariff relevance | RARIK and Orkubu Vestfjarda split into rural, urban and settlement-core areas |
| Address source | HMS Stadfangaskra |

## Core Requirements

1. Import HMS Stadfangaskra locally.
2. Import Raforkudreifing polygons locally.
3. Add point-in-polygon DSO suggestion.
4. Store confirmed DSO/tariff area on site billing config.
5. Allow admin override with audit reason.
6. Version mapping/rate decisions for historical billing.
7. Keep postal-code mapping as fallback only.

## Open Work

- Fetch and store the Raforkudreifing dataset locally.
- Confirm license/update cadence.
- Define polygon import format and PostGIS strategy.
- Build DSO suggestion endpoint.
- Add UI state: suggested, confirmed, overridden, unknown.
- Add audit log for override.
