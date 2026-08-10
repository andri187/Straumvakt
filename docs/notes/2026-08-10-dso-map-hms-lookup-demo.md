# DSO map + address lookup — local demo

Date: 2026-08-10
Worktree: `E:\Claude\Straumvakt-onboarding-web`
Branch: `codex/onboarding-web-experience`
Status: **local/dev demo only.** Not production, not deployed, not authenticated.

---

## 1. Route and access

| | |
| --- | --- |
| Route | `/local/dso-lookup` |
| Local URL | `http://localhost:3000/local/dso-lookup` |
| Required flag | `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1` |
| Demo credential | user `DSO`, password `map` |

```bash
cd E:\Claude\Straumvakt-onboarding-web
$env:STRAUMVAKT_LOCAL_PRODUCT_PREVIEW = "1"
npm run dev
# then open http://localhost:3000/local/dso-lookup
```

Without the flag the route returns 404 and the middleware redirects to `/`.

### Demo credential warning

`DSO` / `map` is **not authentication**. `checkDemoCredential` compares two
strings and returns a boolean that flips a React `useState` in the browser. It
mints no session, sets no cookie, writes no storage, signs no token and never
reaches a server. Nothing is behind it except a read-only fixture screen.

That is what makes it safe to ship, and the reasoning matters more than the
mechanism: **the environment flag is a runtime gate, not a build-time
exclusion.** This route, its fixtures and the literal string `"map"` are
compiled into a production build exactly as `/local/product-preview` and
`/visual` already are — the flag only prevents the page rendering. So the
defence is that there is no privilege behind the door, not that the door is
hidden. `demo-credential.ts` must never be imported by anything that issues a
session, and a guard test asserts the middleware does not import it.

---

## 2. What is real and what is a fixture

This is the most important section in this document. The screen is deliberately
asymmetric, and the UI says so on its face.

| Element | Status | Detail |
| --- | --- | --- |
| **DSO service-area overlay** | **REAL, live** | WMS 1.3.0 `GetMap` against `https://ogc.gis.is/geoserver/orkustofnun/ows`, layer `raforkudreifing`. Actually requested by the browser. |
| **Basemap** | **REAL, live** | OpenStreetMap raster tiles. |
| **DSO attribution per coordinate** | **REAL, sampled and frozen** | Every coordinate in `dso-service-areas.ts` is a recorded `GetFeatureInfo` response from the live layer on 2026-08-10. |
| **Address coordinates** | **REAL** | Each demo address sits on a coordinate that was actually probed, so every answer is reproducible against the source. |
| **Postal codes, municipality names** | **REAL** | |
| **Street names, house numbers, `hnitnum`** | **ILLUSTRATIVE** | Not real Staðfangaskrá records. Staðfangaskrá is a downloadable dataset, not a live API, and it has **not** been imported. |
| **Address search** | **FIXTURE** | Linear scan over 40 demo records. No backend call. |
| **Admin override** | **NOT IMPLEMENTED** | The reason field is rendered `disabled`. |

There is **no** HMS/Staðfangaskrá integration. A guard test asserts the UI never
claims one.

---

## 3. What the sampling actually found

The DSO half is evidence-backed because the authoritative layer was queried
directly. `raforkudreifing` is `queryable="1"` and serves
`INFO_FORMAT=application/json`, so point-in-polygon lookup is available today —
it returns `nafn` (operator), `stadur` (tariff area), `tegund` (urban/rural)
and a feature `id`.

Six findings, each of which corrected an assumption:

1. **Hveragerði and Þorlákshöfn are RARIK**, not HS Veitur — despite sitting
   between two HS Veitur areas. Geography-based guessing fails here.
2. **Dalvík, Húsavík and Siglufjörður are RARIK.** Norðurorka's distribution
   area is **Akureyri itself** and nothing else.
3. **Borgarnes and Stykkishólmur are RARIK**, not Veitur.
4. **Akranes is Veitur, but as its own tariff area** (`id` 9), separate from
   Stór-Reykjavíkursvæði (`id` 6). Same operator, different rate area — which
   is exactly why the tariff area must be stored, not just the operator.
5. **The Garðabær split is real and it is narrow.** At latitude 64.0900 the
   operator changes between longitude −21.930 (Veitur) and −21.935
   (HS Veitur) — about 250 m. The postal code does not change across it.
6. **The polygons do not tile the country.** They are drawn tightly around
   built-up areas. Patreksfjörður answers at 65.5960,−24.0080 and returns
   **nothing** 400 m away. Coverage gaps are normal, and an address that lands
   in one has no automatic answer at all.

Finding 5 is the case the Core DSO memo warns about, now confirmed against the
source. Finding 6 is the one that changes the design: **"no answer" must be a
first-class outcome**, not an error path.

### Data quality in the upstream layer

`tegund` is spelled **"Þéttbýli"** on some rows and **"Þéttbyli"** (missing
accent) on others; `stadur` carries typos too (`Hvólsvöllur`,
`Neskaupsstaður`). Raw values are stored verbatim and normalised in code —
never silently correct a source you do not own. `classifyAreaType` matches both
spellings explicitly rather than accent-folding, so a genuinely new value
surfaces as `null` instead of being swallowed.

---

## 4. Resolver contract

`resolveDso(point: LatLng)` returns:

```ts
{
  dso, serviceArea, areaClass,          // "urban" | "rural"
  areaId, confidence,                    // "exact" | "near-boundary" | "manual-review"
  source,                                // "polygon-derived-fixture" | "unresolved"
  billingApplicability,                  // always "requires-admin-confirmation"
  distanceM, contender, explanation, matchedSampleLabel
}
```

**Postal code is structurally excluded.** The function takes a coordinate and
nothing else, so no future edit can quietly start keying on postnúmer without
changing the signature. A test asserts two addresses sharing postal code 210
resolve to *different* operators.

`billingApplicability` is a literal, never computed. A suggestion from a frozen
sample set is evidence for a human decision, not a decision.

### How it resolves, and its honest limits

Nearest recorded sample — a Voronoi approximation of the polygons, **not**
point-in-polygon. Confidence grading:

- nearest sample > 20 km away → `manual-review`
- nearest sample recorded **no** polygon → `manual-review`
- nearest sample carrying a *different* operator is within 2 km → `near-boundary`
- otherwise → `exact`

The approximation is wrong near any boundary that was not sampled densely. That
is the reason the boundary margin is generous and the reason nothing here can
reach billing unattended.

---

## 5. Map without a mapping library

This worktree has no leaflet/maplibre/openlayers and no new dependency was
installed. The map is a stack of absolutely positioned `<img>` elements: OSM
tiles placed by slippy-tile maths, one WMS PNG covering the viewport, and a
CSS-positioned marker. All positioning maths lives in `web-mercator.ts` and is
unit-tested.

**The overlay is requested in EPSG:3857, not CRS:84, and that is load-bearing.**
OSM tiles are Web Mercator. Requesting the overlay in CRS:84 (plate carrée) and
stretching it over Mercator tiles misaligns everywhere except the centre line,
and at 64–66°N the error is severe. The local prototype at
`Documents/New project/maps/orkusparsvaedi-local-map-2026-08-10.html` has this
bug — it fetches CRS:84 and hands the image to `L.imageOverlay` with lat/lng
bounds. It looks approximately right and is not.

**Limitation:** with no DOM measurement available (no `useEffect`, so the SSR
output equals the client output and component tests would be meaningful), the
viewport is a fixed 820×520 logical size. On a narrow screen the map is cropped
symmetrically rather than reflowed. The result panel beside it carries the full
answer in text, so nothing is available only to someone who can see the map.

---

## 6. Files

All new, under `src/app/local/dso-lookup/`:

| File | Purpose |
| --- | --- |
| `page.tsx` | Server component; env-flag guard → `notFound()` |
| `dso-lookup-client.tsx` | Client workspace: unlock, search, map, result panel |
| `dso-map.tsx` | Presentational map — tiles + WMS overlay + marker |
| `web-mercator.ts` | Projection, tiling, viewport maths (pure) |
| `wms.ts` | GetMap / GetFeatureInfo / tile URL builders (pure) |
| `dso-service-areas.ts` | 38 sampled service areas + 8 recorded coverage gaps |
| `dso-resolve.ts` | Coordinate → DSO suggestion (pure) |
| `address-fixtures.ts` | 40 HMS-shaped demo addresses |
| `address-search.ts` | Icelandic-folding search (pure) |
| `demo-credential.ts` | The `DSO`/`map` literals + `checkDemoCredential` |

Plus six co-located `*.test.ts` files, and **one** edit to an existing file:
`src/middleware.ts` gains `pathname === "/local/dso-lookup"` in the
already-existing preview allowlist. No other existing file was touched.

---

## 7. Tests

**144 tests across 6 files, all passing.** `environment: "node"`, no network.

Note the constraint that shaped them: this worktree has **no DOM test
environment** (no jsdom/happy-dom/@testing-library) and the root include glob is
`src/**/*.test.ts`, which does not match `.tsx`. So there are no component
render tests — the logic was factored into pure modules so it could be tested at
all. (Related pre-existing issue: `src/components/product-state.test.tsx` is
never collected by `npm test` for exactly this glob reason — 10 assertions that
always "pass" by never running. Not fixed here; it is not this task's file.)

Coverage against the brief:

| Required | Where |
| --- | --- |
| guard blocks the route outside dev | `dso-lookup-guard.test.ts` |
| `DSO`/`map` works only in local/dev | guard test + `demo-credential.test.ts` |
| wrong credential rejected | `demo-credential.test.ts` (7 cases inc. non-string) |
| search returns expected fixtures | `address-search.test.ts` |
| selected address shows suggested DSO | `dso-resolve.test.ts` |
| boundary case → manual review | `dso-resolve.test.ts` |
| postal code not authoritative | `dso-resolve.test.ts` — the headline test |
| no claim of production HMS integration | `dso-lookup-guard.test.ts` |
| map controls need no network | `wms.test.ts` — URL building only |

### Fool tests

Each sabotage was applied, the suite run, and the file restored byte-identical:

| Sabotage | Caught |
| --- | --- |
| Remove the env guard from `page.tsx` | 2 failures |
| Make both Garðabær sides the same operator | 2 failures |
| Request the overlay in CRS:84 instead of EPSG:3857 | 1 failure |
| Accept any password | 1 failure |
| *Control:* harmless type-only refactor | **0** — still 144 passed |

The control matters: the suite distinguishes real breakage from noise.

---

## 8. Known pre-existing failure (not caused by this work)

`npm test` reports **1 failed test file** — `scripts/check-workspace-typecheck
.test.mjs`, `SyntaxError: Invalid or unexpected token`. Full suite otherwise:
**2357 passed, 1 skipped.** Root `tsc --noEmit` exits 0.

Isolated and proven unrelated:

- The file is **unmodified in git** (last touched 2026-08-09, `b667553`).
- It fails when run **alone**, a run that never loads any file from this task.
- The **identical file passes** in `E:\Claude\Straumvakt-release-candidate`
  (9 tests) against the same shared `node_modules`.
- The only byte-level difference is line endings: this worktree checked out
  **CRLF** (`git ls-files --eol` → `i/lf w/crlf`), release-candidate has LF.
- `node --check` and a direct `import()` **succeed on both forms**, so the file
  is valid JavaScript; only vitest's transform rejects the CRLF copy.

Conclusion: a vitest/vite transform issue triggered by the CRLF checkout in this
worktree. Fixable by normalising line endings (`.gitattributes` / `core.autocrlf`),
which is a repo-hygiene change and out of scope here.

---

## 9. Intended production architecture

The demo is shaped so each fixture is replaced independently.

```
HMS Staðfangaskrá (imported to Postgres)
  -> /addresses/search?q=            replaces address-fixtures + address-search
  -> official address id + WGS84 coordinates
       -> Raforkudreifing polygons (imported to PostGIS)
          -> /dso/resolve?lat=&lng=  replaces dso-service-areas + dso-resolve
             -> suggested DSO + tariff area + confidence
                -> admin confirm / override with audit reason
                   -> VERSIONED DSO rate record
                      -> billing reads the version, never the live map
```

### Backend endpoints needed (none exist today)

The census confirmed **no** address-search, geocode or DSO-resolve endpoint is
mounted anywhere in `apps/api`. What exists is `GET /api/admin/billing/dso`
(a cost-factor catalogue only) and the `properties` routes (the only address
write path).

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `GET /addresses/search?q=` | HMS autocomplete | Local Postgres; ~0 kr/lookup per the lookup-OPEX memo |
| `GET /dso/resolve?lat=&lng=` | Point-in-polygon | Must be able to return "no coverage" |
| `POST /organisations/:id/sites/:siteId/dso-confirmation` | Admin confirm/override | Needs an audit row |

### Work packages implied

1. Import Staðfangaskrá; store official address id + coordinates.
2. Import Raforkudreifing polygons to PostGIS; record dataset version and date.
3. `/dso/resolve` with a first-class "no coverage" outcome.
4. Store confirmed DSO **and tariff area** on site billing config — Akranes vs
   Stór-Reykjavíkursvæði proves the operator alone is insufficient.
5. Admin override with audit reason. **No confirmation/override pattern exists
   in the schema today** — the census found `audit.actions` is the only
   who-did-what ledger, so this is new modelling.
6. Version the DSO/rate decision so a dataset refresh cannot silently restate
   historical billing.
7. Map UI hardening: real pan/zoom needs either a mapping library or a DOM
   measurement pass, and either implies a dependency decision.

---

## 10. Evidence and cleanup

Evidence written **outside** `E:\Claude`, under
`C:\Users\Andri\Documents\New project\evidence\dso-map-2026-08-10\`:

| File | Size | Content |
| --- | --- | --- |
| `wms-getcapabilities.xml` | ~231 KB | Live GetCapabilities response |
| `getfeatureinfo-probe.json` | ~4 KB | First 12-point probe |
| `dso-ground-truth.json` | ~9 KB | 38-location harvest |

Cleanup state:

- **No new top-level folder under `E:\Claude`.** The route lives inside the
  existing `Straumvakt-onboarding-web` worktree.
- No `.next`, build output, screenshot or cache directory was created.
- No screenshots taken (no dev server was started).
- Nothing pushed, deployed, merged, or branch-deleted. No Cloudflare, Neon,
  DNS, GitHub-remote, OCPP, charger, BLE or NFC change. No DDL. No secret read.
- Network access was read-only GET against public OGC and nothing else.
- `map.is` was **not** used — OSM and the public Orkustofnun OGC service only.
