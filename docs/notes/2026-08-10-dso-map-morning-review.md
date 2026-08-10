# Morning review — DSO map demo

Five minutes to inspect. Full detail in
[2026-08-10-dso-map-hms-lookup-demo.md](./2026-08-10-dso-map-hms-lookup-demo.md).

## Start it

```powershell
cd E:\Claude\Straumvakt-onboarding-web
$env:STRAUMVAKT_LOCAL_PRODUCT_PREVIEW = "1"
npm run dev
```

**URL:** http://localhost:3000/local/dso-lookup
**Login:** `DSO` / `map`

Without the env var the route 404s. That is intended.

## What to click, in order

1. **Search `gardatorg`** — no accents. It finds Garðatorg 7, 210 Garðabær.
   Select it. Suggested operator: **Veitur**, flagged **near-boundary**.
2. **Search `210`** and pick **Hraunsholtsbraut 14** — *same postal code*.
   Suggested operator: **HS Veitur**.
   → This pair is the argument against using postnúmer. 860 m apart, same
   postcode, different operator. Confirmed against the live Orkustofnun layer.
3. **Search `Sjávargata`** (Patreksfjörður) — resolves to **manual-review**,
   no operator. Then search `Aðalstræti 63`, 400 m away: resolves cleanly to
   Orkubú Vestfjarða. The polygons hug built-up areas and genuinely have gaps.
4. **Toggle to Orkuspársvæði** — an amber warning appears saying it is a
   *forecast* layer and does not define distribution operators.
5. **Click Iceland / Southwest** to change view. Toggle the overlay off and on.
6. Note the result panel: postal code is labelled *"Supportive only — never
   decides the operator"*, and the amber block says an admin must confirm
   before billing. The override reason field is deliberately `disabled`.

## What is real, what is fake

**Real and live:** the map. OSM basemap plus the actual Raforkudreifing WMS
overlay from Orkustofnun.

**Real but frozen:** the DSO answers. Every coordinate was queried against the
live layer on 2026-08-10 and the response recorded, so each answer is
reproducible against the source.

**Fake:** street names, house numbers and address ids. **Staðfangaskrá has not
been imported** and there is no address API — the search is a scan over 40 demo
records. The UI says so on screen.

**Not authentication:** `DSO`/`map` flips a React boolean. No session, no
cookie, no server call. The env flag is a *runtime* gate — the route still
compiles into a production build, exactly like `/local/product-preview`. That is
why the credential is designed to grant nothing.

## Things worth knowing that the sampling turned up

- **Norðurorka is Akureyri only.** Dalvík, Húsavík and Siglufjörður are RARIK.
- **Hveragerði and Þorlákshöfn are RARIK**, not HS Veitur.
- **Akranes is Veitur but a separate tariff area** from Reykjavík. Storing the
  operator alone is not enough — the tariff area has to be stored too.
- The upstream data has spelling inconsistencies (`Þéttbýli` vs `Þéttbyli`).
  Kept verbatim, normalised in code.

## Decisions that remain

1. **Import Staðfangaskrá?** Costs dev time, then ~0 kr/lookup. The lookup-OPEX
   memo already recommends it over paid address APIs.
2. **PostGIS for the polygons**, or precomputed municipality→DSO with a
   boundary-exception list? Garðabær shows the exception list is not optional.
3. **How to model admin confirmation.** There is no confirmation/override
   pattern in the schema at all today; `audit.actions` is the only ledger. New
   modelling either way.
4. **Rate versioning.** A dataset refresh must not silently restate history.
5. **Map UI**: real pan/zoom needs a mapping library or a DOM measurement pass.
   Today's map is a fixed-size, library-free approximation.

## Can this become Core?

The *decision logic* — yes, and it is already shaped for it: `resolveDso` takes
a coordinate, returns confidence, and cannot see a postal code. Swapping the
sampled fixture for a PostGIS point-in-polygon query is a one-function change;
nothing in the UI or the contract moves.

The *screen* — no, not as-is. It is a fixed-size demo map with a fake login and
fixture addresses. Core needs items 1–4 above first, and the real blocker is
number 3: nothing can reach billing until admin confirmation and rate
versioning exist.

## Health

- 144 new tests, all passing. Fool-tested: four deliberate sabotages each
  caught, a harmless control still green.
- Root `tsc --noEmit` clean. Full suite 2357 passed / 1 skipped.
- **One pre-existing failure**, `scripts/check-workspace-typecheck.test.mjs`,
  proven unrelated: unmodified in git, passes in the release-candidate worktree
  with identical content, and only differs by CRLF line endings from this
  worktree's checkout. Node parses it fine; only vitest's transform rejects it.
- Nothing pushed, deployed or mutated. No new top-level `E:\Claude` folder.
