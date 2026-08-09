# Local post-login visual routes

Status: local visual review only. No production login, API, database, cloud, charger, billing, or hardware behaviour is connected.

## Routes

- `/login-demo` - local role selector with no password form or authentication request.
- `/app/admin` - redirects within the demo to the Admin operations overview.
- `/app/admin/<screen>` - eight Admin application views.
- `/app/org` - redirects within the demo to the Organisation/CPO overview.
- `/app/org/<screen>` - nine Organisation/CPO application views.
- `/app/driver` - redirects within the demo to the registered-but-unaffiliated Driver state.
- `/app/driver/<screen>` - nine Driver application views.
- `/visual?family=service` - future Service concept remains outside launch routes.

All routes return not found unless `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1`. Middleware uses the same condition, and the production Wrangler configuration does not define that variable.

## Open locally

```powershell
$env:STRAUMVAKT_LOCAL_PRODUCT_PREVIEW='1'
npm run dev -- --webpack --port 3012
```

Then open `http://localhost:3012/login-demo`.

## What is visual-only

- Role choice does not create or verify a session.
- Every identity uses a reserved `.test` address.
- Counts, organisations, chargers, sessions, money, and timestamps are fixtures.
- Every page-level action is disabled and points to the visual boundary explanation.
- Organisation invitation and Driver installation-code completion remain unavailable.
- Agreement and cost-factor assignment is read-only.
- Staff support context has no persistence or audit-read contract.
- Service remains a future concept and has no post-login route.

## What to review

1. Whether the role selector is a credible future doorway without looking like a live login.
2. Whether Admin clearly communicates global context and attributed support boundaries.
3. Whether Organisation/CPO feels tenant-specific and keeps platform controls absent.
4. Whether the Driver journey from no access to charging and history feels coherent.
5. Whether disabled actions are understandable without overwhelming operational work.
6. Whether the application density is appropriate on desktop, tablet, and a 390 px phone.

## Decisions preserved

- No charger visibility toggle is rendered.
- Available chargers display `Not charging`, never `0 kW` as measured power.
- Money-like values are marked demo/read-only at the point of display.
- Unsafe invitation submission and fake installation-code success are not represented.
- `/local/product-preview` remains a QA aid, not the market UI.

## Verification

- 124 focused visual and route-contract tests pass.
- TypeScript passes with a clean generated-route view.
- Fifteen screenshot groups cover login, Admin, Organisation/CPO, and Driver on desktop, portrait tablet, and true 390 x 844 mobile.
- Browser checks confirm no document overflow at 390, 768, or 1280 px after moving the navigation-drawer breakpoint to 860 px.
- Evidence is stored at `C:\Users\Andri\Documents\New project\evidence\post-login-visual-routes-2026-08-09`.

## Do not wire yet

Do not connect these routes to production authentication or replace fixtures until persona, tenancy, invitation, installation-access, support-context, billing, and error-envelope contracts are approved. Do not infer that a visually complete page means its mutation is safe to expose.
