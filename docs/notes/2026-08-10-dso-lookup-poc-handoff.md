# DSO lookup POC — handoff

Date: 2026-08-10
Worktree: `E:\Claude\Straumvakt-onboarding-web`
Branch: `codex/onboarding-web-experience`, tip `104e0d8`
Status: **built and verified locally. NOT pushed, NOT deployed.**

---

## 1. Route and local use

| | |
| --- | --- |
| File | `public/dso-lookup.html` (+ `public/dso-lookup.mjs`) |
| Local URL | `http://localhost:3000/dso-lookup.html?key=YOUR_GOOGLE_KEY` |
| Intended public URL | `https://straumvakt.org/dso-lookup.html` |
| Gate | `DSO` / `map` |

It is a plain static page. It does not need `next dev` — any static server over
`public/` works, which is how it was smoke-tested:

```powershell
cd E:\Claude\Straumvakt-onboarding-web
npm run dev       # or serve public/ with anything
# http://localhost:3000/dso-lookup.html?key=YOUR_KEY
```

### Why `.html` and not `/dso-lookup`

The Next middleware matcher is `/((?!.*\..*).*)` — it deliberately skips any
path containing a dot. `/dso-lookup.html` is therefore never seen by the auth
middleware and is served straight from the assets binding. **That is what makes
this deployable with no change to any auth code.**

A clean `/dso-lookup` URL is possible later with one rewrite in
`next.config.mjs`; it is not required and was deliberately not done, because it
would drag the page into the middleware path.

---

## 2. Google API key

**No key is committed, and a test asserts no key-shaped literal exists in
either file.** The page reads one at runtime, in this order:

1. `?key=` in the URL — local testing only
2. `window.STRAUMVAKT_MAPS_KEY`, set by `public/dso-lookup-config.js`

`public/dso-lookup-config.js` is **git-ignored** (`.gitignore:106`). Create it
locally as:

```js
window.STRAUMVAKT_MAPS_KEY = "YOUR_KEY";
```

and add `<script src="./dso-lookup-config.js"></script>` before the module
script, or just use `?key=`.

For deployment, inject it from a Cloudflare secret at build time rather than
committing it. **Restrict the key by HTTP referrer to `straumvakt.org/*` in the
Google Cloud console before it is ever used on a public page** — a Maps
JavaScript key is necessarily visible to the client, so referrer restriction is
the only thing standing between it and someone else's bill.

If the key is missing the page says so explicitly and names the APIs required.

### Google APIs

| API | Needed? | Used for |
| --- | --- | --- |
| **Maps JavaScript API** | **Required** | The map shell |
| Places API | Optional | Address autocomplete. Absent → the page falls back to demo fixtures and says so |
| Geocoding API | Not used | Places returns the coordinate directly |

---

## 3. Where authority sits

This is the part worth being precise about.

| Concern | Source | Authoritative? |
| --- | --- | --- |
| Map tiles, pan/zoom, satellite | Google Maps JS | n/a — presentation |
| Address search → **coordinate** | Google Places (or demo fixtures) | **No.** Convenience only. Production should use HMS Staðfangaskrá |
| **Distribution operator** | Orkustofnun `raforkudreifing`, WFS vector | **Yes** |
| Service / tariff area | same | **Yes** |
| Postal code | shown as supporting data | **No, and structurally excluded** |

`resolveDso(lng, lat, featureCollection)` takes a coordinate and geometry.
There is nowhere to pass a postnúmer, so no later edit can quietly start
keying on one without changing the signature.

---

## 4. DSO data and how the answer is computed

- Endpoint `https://ogc.gis.is/geoserver/orkustofnun/ows`
- Layer `raforkudreifing` (comparison-only layer: `orkusparsvaedi`)
- **WFS** `GetFeature`, `outputFormat=application/json`, `srsName=EPSG:4326`
- 109 features, MultiPolygon, ~3.2 MB
- `Access-Control-Allow-Origin: *`, so the browser fetches it directly and
  **no copy of the dataset is committed**
- Resolution is **real point-in-polygon** (ray casting, with hole support),
  plus a distance-to-nearest-edge measurement for the confidence grade

The WMS raster overlay is drawn separately, tiled through
`google.maps.ImageMapType`, requested in **EPSG:3857** so it aligns with the
Google basemap. Requesting CRS:84 and stretching it over a Mercator basemap
looks approximately right and is wrong everywhere but the centre line; the
error is severe at Iceland's latitude.

### Verification: two independent paths agree

The vector point-in-polygon was checked against the **WMS `GetFeatureInfo`**
answers harvested earlier — a completely different access path (server-side
raster query vs client-side geometry) — across 17 known locations:

**17 of 17 agree**, including both sides of the Garðabær split, Akranes as a
separate Veitur tariff area, Norðurorka confined to Akureyri, and a known
coverage gap returning no area.

### What the vector data corrected

The earlier sampled work missed two things that only the full attribute set
shows:

1. **`Byggðakjarni`** — a *third* tariff class (settlement core) alongside
   `Þéttbýli` and `Dreifbýli`. The Core DSO memo did mention settlement-core
   areas; the sampling had not hit one.
2. **`Án skilgreiningar`** — 4 areas where the source names **no operator at
   all**. These now resolve to `manual-review` rather than being reported as an
   answer.

Area counts: RARIK 84, Orkubú Vestfjarða 14, HS Veitur 4, `Án skilgreiningar`
4, Veitur 2, Norðurorka 1.

---

## 5. Precision — stated, not overclaimed

Published coordinates carry **four decimal places**, which at 64°N is about
**5 m of longitude and 11 m of latitude**. Nothing tighter than roughly 15 m is
supportable from this data.

So `NEAR_BOUNDARY_M = 50`: any point within 50 m of an area edge is graded
`near-boundary` and is not safe to auto-accept. The page states it cannot
settle a metre-level boundary dispute.

Confidence values:

| Value | Meaning |
| --- | --- |
| `exact` | Inside exactly one operator's area, more than 50 m from its edge |
| `near-boundary` | Inside, but within 50 m of the edge — or inside overlapping areas naming different operators |
| `manual-review` | Inside an area whose operator the source leaves undefined |
| `no-area` | No polygon covers the coordinate |

Every result carries `billingApplicability: "requires-admin-confirmation"` as a
literal, never computed.

### Garðabær boundary panel

The sidebar renders 7 sample points (5 in Garðabær) and highlights any that are
not `exact`. Measured against the live geometry:

| Point | Operator | Distance to edge |
| --- | --- | --- |
| Garðatorg (−21.9224) | Veitur | 391 m |
| mid (−21.928) | Veitur | 255 m |
| near split E (−21.930) | Veitur | 167 m |
| **near split W (−21.935)** | **HS Veitur** | **36 m — flagged** |
| Hraunsholt (−21.940) | HS Veitur | 248 m |

The operator changes across roughly 250 m of longitude with **no postal-code
change**. That is the whole argument against keying on postnúmer.

---

## 6. Files changed

| File | Lines | Purpose |
| --- | --- | --- |
| `public/dso-lookup.html` | 560 | The page: gate, map, controls, result panel, boundary table |
| `public/dso-lookup.mjs` | 427 | Pure logic: credential, key resolution, tile/WFS URLs, point-in-polygon, distance, resolution, fixtures |
| `scripts/dso-poc.test.mjs` | 394 | 52 tests |
| `.gitignore` | +12 | Ignores the local key config |

Nothing else was touched. No existing file was modified except `.gitignore`.

---

## 7. Tests and checks

**52 tests, all passing.** They run under the existing `scripts/**/*.test.mjs`
glob, so **no vitest config change was needed**. Offline — the geometry tests
use small synthetic polygons; agreement with the real 109-area dataset was
verified separately against live WFS (§4).

Against the brief:

| Required check | Status |
| --- | --- |
| credential accepts `DSO`/`map` | ✅ incl. case and whitespace |
| wrong credential rejected | ✅ incl. non-string and truthy-coercion cases |
| missing Google key shows error | ✅ `resolveMapsKey` returns null; page renders an explicit panel |
| map/WMS URL builders are safe | ✅ layer allowlist; injection attempts throw |
| postal code not passed as authority | ✅ structural + source assertion |
| resolver returns expected DSO | ✅ synthetic + 17/17 live agreement |
| Garðabær split stays distinct | ✅ |
| no tenant/admin API call | ✅ asserted in both files |
| no hardcoded API key | ✅ asserted in both files |

Other checks: `tsc --noEmit` exit 0; full suite **2425 passed / 1 skipped**;
local HTTP smoke check serves both files at 200 with correct content types.

### Fool tests

Seven sabotages applied, suite run, file restored each time — **all seven
caught**: wrong projection, always-true gate, dropping the near-boundary flag,
auto-billing, dropping the misspelled `Þéttbyli` variant, allowing search
indexing, and committing a key-shaped literal.

### Not verified

- **The Google map itself has never been rendered.** I have no key and no
  browser here. Everything up to and including the tile URLs is tested; that
  Google draws them is not.
- Places autocomplete is untested for the same reason. The fixture fallback is
  tested.
- The live WFS fetch works (verified by direct request) but has not been
  exercised from a browser.

---

## 8. Deployment recommendation

**Do not deploy this branch.** `codex/onboarding-web-experience` is **184
commits and 956 files ahead** of `origin/staging`, which is what Cloudflare
deploys to `straumvakt.org` via the `hlada-staging` Worker. Deploying from here
would replace the entire live site.

The POC was built to avoid that. Its diff against `staging` is **purely
additive**:

```
 .gitignore               |  12 +
 public/dso-lookup.html   | 560 +
 public/dso-lookup.mjs    | 427 +
 scripts/dso-poc.test.mjs | 394 +
 4 files changed, 1393 insertions(+)
```

Zero deletions, zero modifications to existing code.

### Recommended sequence (needs Andri's approval at step 4)

```bash
git fetch origin
git switch -c poc/dso-lookup origin/staging
git checkout 104e0d8 -- public/dso-lookup.html public/dso-lookup.mjs scripts/dso-poc.test.mjs
# re-apply the .gitignore line by hand (staging's .gitignore differs)
git commit -m "feat(poc): standalone DSO lookup page"
npx vitest run scripts/dso-poc.test.mjs      # confirm green on staging's tree
git push -u origin poc/dso-lookup            # ← needs approval
```

Then either merge `poc/dso-lookup` into `staging` (Cloudflare git integration
deploys it), or deploy the branch directly.

**Two cautions for whoever runs it:**

1. `staging`'s build differs from this branch — it has a Prisma-CF compile step
   (`scripts/compile-cf-prisma.sh`, `post-opennext-cf-prisma.sh`). Use
   staging's own `deploy:staging` script, not this branch's.
2. Restrict the Google key by HTTP referrer **before** the page is public.

### Reachability on staging — checked

`origin/staging` keeps its middleware at the repo **root** (`middleware.ts`),
not `src/middleware.ts`, while its app lives in `src/app`. On Next 16 that root
file is not compiled, so it does not execute at all there. And even if it did,
its matcher `/((?!.*\..*).*)` excludes any path containing a dot. Either way
`/dso-lookup.html` is served straight from assets. No auth change is needed.

---

## 9. Honest limits

- The gate is **not authentication**. It is a client-side comparison over a
  page whose contents are already in the downloaded bundle. It is acceptable
  here only because everything behind it is public reference data.
- Address records in the fixture fallback are **not Staðfangaskrá**. Street
  names are illustrative; coordinates are real.
- The page depends on `ogc.gis.is` being reachable from the browser. If the WFS
  call fails there is **no operator answer** and the page says so rather than
  guessing.
- 3.2 MB is fetched on first use. Fine for an internal tool, not for a
  high-traffic public page. If it ever needs to scale, resolve server-side.
- `noindex, nofollow` is set, but that is a request to crawlers, not access
  control.

## 10. Evidence

Outside `E:\Claude`, in
`C:\Users\Andri\Documents\New project\evidence\dso-poc-2026-08-10\`:

- `raforkudreifing-4326.geojson` — 3.18 MB, the full vector dataset as fetched
