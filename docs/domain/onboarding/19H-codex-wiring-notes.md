# Appendix 19H — Codex and frontend wiring notes

**18 notes**, `CW-01`–`CW-18`. The brief asked for 10.

## Read this first

**Straumvakt.org frontend visual work is a separate lane and is not blocked by
anything in this packet.** Visuals for Straumvakt Admin, Organisation/CPO,
Driver and the future Contractor Service UI proceed today, with demo data.
Backend's obligation is to supply wiring contracts for later, not to gate
iteration.

Only two notes touch visual work at all — `CW-07` (the charger visibility
toggle must not be drawn, even greyed) and `CW-17` (a not-found / org-picker
path that does not exist yet). Both are one-line constraints, not blocks. Every
other note constrains **copy and behaviour** once a surface is wired.

## Lanes

| Lane | Meaning |
|---|---|
| **visual-only** | build it now, demo data, no backend dependency |
| **wire-now** | the endpoint exists and is permission-gated; connect it |
| **disabled-until** | the control belongs in the design; render it greyed with copy |
| **hidden** | no backend and none coming — do not render it at all |
| **read-only** | the endpoint exists; there is no write surface |
| **mutation-after** | safe to connect once the named packages land |

**Disabled is not hidden.** Disabled says "this is coming"; hidden says nothing.
Rendering a permanently-rejected feature as disabled is a roadmap commitment
nobody made — which is why charger visibility is *hidden*, not disabled.

**`CW-03` is the one that must reach Codex before the support-context guard
ships.** `403 support_context_required` is a new error *class*, not a permission
failure. Rendered with the generic forbidden copy, staff will read "you don't
have access" when the truth is "open a support context first", and will
conclude their permissions are broken.

---

## Appendix 19H — Codex and frontend wiring notes

**18 notes.** Every path below was read on branch `docs/singular-onboarding-domain-packet`
at tip `fc071b3`. Nothing was executed: no build, no test run, no server start, no
database connection, no network call. No file in the worktree was modified.

Lanes used throughout:

| Lane | Meaning |
|---|---|
| `visual-only` | design, layout, copy — no endpoint involved, never blocked by backend |
| `wire-now` | endpoint exists today and is permission-gated; wire it |
| `disabled-until` | control belongs in the design, backend absent — render greyed with copy |
| `hidden` | no backend and none planned — do not render at all, not even disabled |
| `read-only` | endpoint exists, no write surface exists |
| `mutation-after` | write UI is safe to build only once a named package lands |

The distinction between `disabled-until` and `hidden` is a promise. Disabled says
"this will exist". Hidden says nothing. Rendering a rejected feature as disabled is a
roadmap commitment nobody made — see CW-07.

---

### CW-01 — The Straumvakt.org visual lane is not gated by backend hardening
**Lane** visual-only · **Blocks visual work** no · **Backend prerequisite** none

Andri's clarification, stated so it cannot be misread: **frontend visuals for
Straumvakt Admin, Organisation/CPO, Driver and the future Contractor Service UI are a
separate lane and are NOT blocked by any backend package in this packet.** Backend's
job here is to supply future wiring contracts, not to stop visual iteration. Nothing in
19H — not the support-context gap, not the greenfield agreement write surface, not the
missing test harness — is a reason to pause layout, typography, component structure,
navigation, empty states, responsive behaviour or brand work on `src/app/page.tsx`,
`src/app/staff/overview/page.tsx`, `src/app/org/[slug]/page.tsx`,
`src/app/org/[slug]/org-shell.tsx` or any new route. Every other note in this appendix
constrains **what a control is allowed to claim**, not whether it may be drawn.

Practical read: if a note says `disabled-until` or `hidden`, that is a statement about
the control's *behaviour and copy*. The surrounding page can be fully designed today.
The only hard rule that touches visuals is CW-07 (a rejected feature is not drawn at
all) and CW-09 (fixture-backed surfaces carry a visible marker).

- **Contract:** none. This note exists to remove a gate, not to add one.
- **Copy:** none.
- **Codex should test:** nothing — visual work needs no test to proceed. · **Codex must NOT test:** do not write a test that asserts a screen is "blocked" or "pending backend"; that encodes a gate that does not exist and will have to be deleted.

---

### CW-02 — There is no `src/app/api` — every `/api/admin/*` call is cross-origin, and local dev 404s
**Lane** wire-now · **Blocks visual work** no · **Backend prerequisite** none (config only)

The web app has **zero** Next.js route handlers: `src/app/api/` does not exist and
`find src -name route.ts` returns nothing. Every `/api/*` path the UI names is served by
the Hono Worker in `apps/api` — `app.route("/api/admin", adminAuth)` at
`apps/api/src/index.ts:125`, `/api/admin/orgs` :128, `/api/admin/me` :139. Three
consequences Codex must hold simultaneously:

1. `src/lib/api-auth.ts` (`requireAdmin`, `requireStraumvaktStaff`, `unauthorized`,
   `apiError`) has **zero importers** anywhere in `src/`. It is dead code that looks
   like an auth seam. Do not import it, and do not "restore" it to make a screen work —
   it returns `NextResponse` objects for handlers that do not exist.
2. `PUBLIC_PATHS = new Set(["/api/admin/login"])` in `src/middleware.ts:12` exempts a
   path this app never serves. It is inert, not protective.
3. `resolveBaseUrl()` in `src/lib/api-client.ts` falls through to `""` when
   `window.location.hostname` is not in `HOSTNAME_TO_API` and
   `NEXT_PUBLIC_API_BASE_URL` is empty. Root `wrangler.jsonc:22` sets that var to `""`
   for production, and local dev has no value either. So `apiFetch("/api/admin/login")`
   from `src/app/page.tsx` (RootPage `onSubmit`) and from
   `src/app/staff/staff-login-form.tsx` resolves relative and **404s** — and both forms
   then render "Wrong email or password.", which is a lie about a routing failure.

Server components take a different path: `apiFetchServer` in
`src/lib/api-client-server.ts` derives the base from the `Host` header when the env var
is empty, and forwards the **entire** cookie jar cross-origin, not just the session
cookie.

- **Contract:** local dev must set `NEXT_PUBLIC_API_BASE_URL` to the running `apps/api` origin, or add the dev hostname to `HOSTNAME_TO_API` in **both** `src/lib/api-client.ts` and `src/lib/api-client-server.ts` — the map is duplicated, not shared. A non-2xx login must be distinguished by status: 404 means "no API reachable", 401 means bad credentials.
- **Copy:** on a 404 or network failure, "Could not reach the login service." (the string already exists in `src/app/page.tsx`); reserve "Wrong email or password." for a real 401.
- **Codex should test:** that a 404 from the login POST renders the reachability copy, not the credentials copy. · **Codex must NOT test:** do not add a Next route handler under `src/app/api/` to make a test pass — that invents a second backend and the real one stops being exercised.

---

### CW-03 — `403 support_context_required` is a NEW error class, not a permission failure
**Lane** disabled-until · **Blocks visual work** no · **Backend prerequisite** C01, C02, C04 (then C05–C09)

This is the note most likely to be got wrong, and the failure is silent. Today
`apps/api/src/lib/auth/require-permission.ts` returns exactly two 403 bodies:
`{ error: "forbidden", reason: "session_missing_user_id" }` (:55-59 path, when a
multi-user session carries no `userId`) and
`{ error: "forbidden", reason: "permission_missing", required: <verb> }` (:75-84).
`assertPermission` (:115-117, :125-131) mirrors both. There is no third shape, and
`support_context_required` appears nowhere in source — grep confirms it exists only in
`docs/domain/onboarding/17-ultra-backend-market-runway.md:128,190` and 18A C04.

C04 introduces it as a **distinct code**: the staff actor's permissions are fine; what
is missing is an *open support context* for that org. If the frontend routes it into
the generic forbidden branch, a staff member sees "you don't have access" when the truth
is "open a support context first", concludes their grants are broken, and escalates.
That is a support-load bug created entirely in the UI layer.

Codex should build the branch **now**, behind the same flag as the banner (CW-05), so
that when C02/C04 land the frontend already discriminates. Until then the branch is
unreachable and must be provably unreachable — not stubbed.

- **Contract:** on HTTP 403, read `body.error`. `"support_context_required"` renders the context-entry affordance and, once C07 exists, offers `POST /api/admin/support-contexts` with a required `reason`. `"forbidden"` with `reason: "permission_missing"` renders the ordinary denial and should surface `required` (the verb) in a details line for support. Any other 403 falls back to the generic denial. Discriminate on `error`, never on the HTTP status alone.
- **Copy:** support-context case — "This organisation needs an open support context. Every action you take will be recorded and visible to the organisation." with a primary action "Open support context". Permission case — the existing generic denial. Never show the support-context copy for `permission_missing`, and never the reverse.
- **Codex should test:** that a synthetic 403 body with `error: "support_context_required"` selects the context-entry copy and a 403 with `error: "forbidden"` selects the denial copy — a pure rendering test over a body shape, no endpoint involved. · **Codex must NOT test:** do not stub `POST /api/admin/support-contexts` or `GET /api/admin/support-contexts/current` and assert a context opens. Those routes do not exist (`support_contexts` and `SupportContext` return zero hits outside `docs/`), and a green test against that stub is a claim that support mode works.

---

### CW-04 — `apiFetchJson` destroys the error code CW-03 depends on
**Lane** wire-now · **Blocks visual work** no · **Backend prerequisite** none

`apiFetchJson` in `src/lib/api-client.ts:72-84` flattens every non-ok response to a
single `Error(msg)`, where `msg` is the joined zod issues, else `e.error`, else
`HTTP <status>`. The status is discarded and the body is discarded. `src/app/org/[slug]/page.tsx`
consumes it that way — its `catch` stores `e instanceof Error ? e.message : String(e)`
into `err` and renders it raw in `<div className="org-error">`. So a 403 today renders
the literal word "forbidden" to an org admin, and after C04 it would render
"support_context_required" as body text.

`src/app/staff/overview/page.tsx` has the better shape already: `load<T>` (:118-131)
returns `{ ok: false, reason, status }` and keeps `status` separate precisely so 401 can
be told apart from everything else — but it still never parses the error body, so the
code is lost there too.

This is a prerequisite for CW-03 being implementable at all, and it is a pure frontend
change with no backend dependency.

- **Contract:** introduce a typed failure that preserves `status` and the parsed body, e.g. extend the existing `ApiError` type (`src/lib/api-client.ts:67-70`, currently `{ error: string; issues?: … }`) and throw an error object carrying `status` plus `code = body.error`. Callers switch on `code`; raw `error` strings are never rendered to users.
- **Copy:** no machine code (`forbidden`, `validation`, `not_found`, `support_context_required`) may reach the screen as user-visible text.
- **Codex should test:** that a 403 JSON body survives to the caller with `status` and `code` intact, and that no rendered string equals a machine code. · **Codex must NOT test:** do not assert specific server-side error *messages* — only codes are contractual; the message text in `apps/api` is not.

---

### CW-05 — Support-mode banner: build the component, keep it unreachable
**Lane** disabled-until · **Blocks visual work** no · **Backend prerequisite** C02, C05–C09, C13

Doc 17 §2.5 fixes the banner contract: persistent, non-dismissible while a context is
open, never behind a menu, exit always one click, and — the operative rule — **when
`expiresAt` passes the UI must stop offering mutations rather than letting the server
reject them one by one**. Nothing of this exists: there is no support-mode state in
`src/`, no `SupportContext` object anywhere, and `platform.support.action` has zero
enforcement call sites in `apps/api` even though it sits in the `platform_admin` bundle
at `apps/api/src/lib/auth/permissions.ts:260-264`.

Codex can build the banner component and its expiry behaviour entirely against a local
prop, with no fetch. The component is honest as long as nothing constructs a live
context from a fake endpoint.

- **Contract:** the banner takes `{ organisationName, staffEmail, reason, expiresAt }` and an `onExit` handler. Once C08 exists it is fed by `GET /api/admin/support-contexts/current`, returning that object or 404. On `Date.now() >= expiresAt` the surrounding page disables every mutation control locally — it does not wait for a 403.
- **Copy:** "Support mode — acting on {Organisation}. Signed in as {staff email}. Every action is recorded and visible to the organisation. Reason: {reason}. Ends at {time}." with "Exit support mode". Until C02–C09 land, the entry point reads "Support mode isn't available yet."
- **Codex should test:** with a prop whose `expiresAt` is in the past, every mutation control renders disabled; the banner cannot be dismissed. Fixture actor `staff-carol@example.test`, target `org_alpha`. · **Codex must NOT test:** do not stub `/api/admin/support-contexts/current` to return an open context. That endpoint has no implementation, no table and no migration; a passing test would assert that Straumvakt has staff-action accountability it does not have.

---

### CW-06 — Onboarding progress: "This isn't tracked yet", never derived
**Lane** disabled-until · **Blocks visual work** no · **Backend prerequisite** G01–G09 (greenfield)

The organisation onboarding aggregate does not exist. `onboarding_workflow` and
`onboarding_step` return zero hits outside `docs/`, in Drizzle
(`packages/shared/src/db/`), in both Prisma schema folders and in every `.ts`/`.dart`
file. The only thing mounted at `/api/admin/onboarding` is
`apps/api/src/routes/admin/onboarding.ts` — 29 lines, a single
`POST /chains` guarded by `requirePermission("charger.write")`, backed by
`createOnboardingChain`. It is a one-shot create with no state, no steps, no read side.
There is no `GET` to poll.

The trap is derivation: an implementer with an org that has 3 installations and 0
chargers is one line away from rendering "onboarding 40% complete". That number would be
invented in the browser and would then be quoted back by a customer.

- **Contract:** no progress endpoint exists. Render the section as disabled. When G lands, the read shape is `OnboardingSummary` (scenario 111) and only then may a percentage appear. `POST /api/admin/onboarding/chains` is a create, not a progress source.
- **Copy:** "This isn't tracked yet."
- **Codex should test:** that no progress indicator, step counter or percentage appears in the DOM for an org with mixed installation/charger counts. · **Codex must NOT test:** do not stub an onboarding-workflow endpoint and assert step transitions. Twelve of scenarios 99–110 describe a state machine with no table behind it; testing it would encode a fake backend at its most convincing.

---

### CW-07 — Charger visibility: hidden and REJECTED, not a disabled roadmap promise
**Lane** hidden · **Blocks visual work** yes (it removes a control from the design) · **Backend prerequisite** none — and none is coming

Doc 17 §5 lists the visibility toggle under **Rejected** for CPO admin, and 18E marks it
"Hidden — rejected". This is the one place where a *disabled* control would be actively
wrong: disabled communicates "coming soon", and nothing is coming. Access is decided by
driver-group membership and nothing else.

Source agrees. `grep -rn "visibility" src/` returns only three hits, all in
`src/lib/reference/teltonika-info.ts` (router fleet-management prose, unrelated).
`grep -rn "visibility" apps/api/src` returns two: a CSS string in
`apps/api/src/lib/email-templates/common.ts:50` and a comment in
`apps/api/src/lib/ocpp/projections.ts:481`. There is no visibility column, no toggle
route, no DTO.

The real mechanism is `apps/api/src/routes/admin/driver-group-memberships.ts` —
`POST /:orgId/driver-group-memberships` (:46) and `GET /:orgId/driver-group-memberships`
(:154, requires a `driverGroupId` query param), both gated by
`requirePermission("member.write", { orgIdParam: "orgId" })`. Point users there.

- **Contract:** no toggle, no switch, no greyed switch, no tooltip promising one. If the concept needs acknowledging at all, it is a one-line explanatory string next to the driver-groups link.
- **Copy:** "Managed through driver groups."
- **Codex should test:** assert the string is present on the CPO charger surface **and** that no toggle/switch input exists in the DOM for it. · **Codex must NOT test:** do not write a test for a disabled visibility toggle. A disabled-state test is how a rejected feature gets re-litigated into existence — the test becomes the spec.

---

### CW-08 — Cost factors and agreement editing: hidden until Group K/L
**Lane** hidden · **Blocks visual work** no · **Backend prerequisite** K01–K05, L01–L02 (greenfield)

There is **no agreement write surface** in `apps/api/src`. `apps/api/src/repositories/agreements.ts:1-2`
declares itself "read-only repository for the operator UI list + detail pages", and only
two agreement routes are mounted: `adminAgreementsDebug` at `/api/admin/agreements`
(`apps/api/src/index.ts:178`) and `adminAgreementsResolve` at
`/api/admin/agreements/sessions` (:184). The only writer in the repo is a one-off
script. `contract.write` and `tariff.write` are declared and bundled but guard **zero**
routes. There is also no Postgres exclusion constraint for agreement overlap — no
`btree_gist` and no `tstzrange` anywhere in `prisma/migrations/`; overlap is handled at
read time in the resolver's `persist.ts:143-165` with a `console.warn` plus deterministic
ordering.

The web app already carries an "Agreements" card: `DEFAULT_SECTIONS` in
`src/lib/org-tenant.ts` includes `agreements`, `orgSectionLabel` gives it a title and
blurb ("The agreements and pricing that govern the network"), and because
`BUILT_SECTIONS` is only `{ overview, profile }` it renders with the `org-tag-soon`
badge reading "soon" (`src/app/org/[slug]/page.tsx:289-320`). That is acceptable for a
*link*, but no editor, draft form, activate button or cost-factor field may be rendered.

- **Contract:** no write endpoint exists. Do not render create/edit/activate/retire controls. Read surfaces are covered by CW-13.
- **Copy:** the section link keeps "soon"; any cost-factor control is absent, not greyed. Never present a cost as final — three separate pricing implementations exist (the legacy `lib/tariff` path via `ocpp/projections.ts`, the agreements resolver which has priced 0 sessions, and the `driver-pricing.ts` summarisers which ignore BearerRule overrides), so any figure shown must read "Estimated."
- **Codex should test:** that no agreement mutation control appears in the DOM for `org_alpha`. · **Codex must NOT test:** do not stub agreement create/activate and assert scenarios 137–143. Scenario 139 in particular asserts a database exclusion constraint that does not exist — a UI test cannot produce that guarantee and would falsely retire it.

---

### CW-09 — Demo mode: the kill switch is unimplemented, so the visible marker is the only safeguard
**Lane** wire-now · **Blocks visual work** no · **Backend prerequisite** none (frontend + CI only)

`NEXT_PUBLIC_DEMO_MODE` appears **nowhere** in the repo outside `docs/` — a repo-wide
grep across `.ts`, `.tsx`, `.mjs`, `.json`, `.jsonc` and `.dart` returns nothing.
`next.config.mjs` has an `env` block (`APP_VERSION`, `BUILD_TIME`) and a `redirects()`
block and no demo guard of any kind. So O02's acceptance ("build fails if set against
beta/prod") and scenario 153 have **no hook to attach to**: the kill switch does not
exist, it is not merely off.

Until the build-time guard is written, the only thing standing between a fixture
screenshot and a false customer claim is the visible marker. That makes the marker
non-negotiable and not a decoration.

- **Contract:** two separate pieces. (a) A build-time check — natural home is `next.config.mjs`, which already reads `package.json` at config time — that throws when `NEXT_PUBLIC_DEMO_MODE` is truthy while `NEXT_PUBLIC_APP_ENV`/`NEXT_PUBLIC_API_BASE_URL` point at beta or production. Root `wrangler.jsonc:17-22` sets `NEXT_PUBLIC_APP_ENV: "production"` with an empty API base, so the check must treat "empty base plus production env" as production, not as unknown. (b) Every fixture-backed surface renders the marker unconditionally, not behind a hover or an info icon.
- **Copy:** "Demo data — not connected to a live system."
- **Codex should test:** that every surface rendering fixture data (`org_alpha`, `driver-anna@example.test`, code `ALFA-1111`) also renders the marker string; and a unit test over the guard function that it throws for a beta/prod config and passes for local. · **Codex must NOT test:** do not assert `NEXT_PUBLIC_DEMO_MODE` "defaults off" by reading `process.env` today — it is undefined because nothing defines it, and the passing test would look like the guard exists.

---

### CW-10 — There is not one test file under `src/`: O04 and scenario 154 need a harness built from nothing
**Lane** wire-now · **Blocks visual work** no · **Backend prerequisite** P01, P11 for CI; the harness itself has none

`vitest.config.ts:20-24` already includes `src/**/*.test.ts`, but
`find src -name "*.test.ts*"` is empty. Web coverage is zero. O04 ("absent endpoint →
assert disabled state") and scenario 154 therefore have nothing to extend — a web test
surface has to be **created**, not amended, and that is the first task in the Codex
lane, before any disabled-state assertion in CW-03/05/06/07/08 can be written.

Two structural facts shape it. First, `environment: "node"` at `vitest.config.ts:16` —
rendering React components needs a DOM environment, so either a per-file
`// @vitest-environment` pragma or a project-level split is required; adding a global
jsdom default would change the environment for `apps/api` and `packages` suites that
currently run in node. Second, **no test runs in CI at all**:
`.github/workflows/check.yml` has three steps (`npm install`, `npm run db:generate`,
`npm run check`) and `scripts/check-all.mjs` lists nine offline checks, none of them
vitest. So a new web suite is green-by-absence until a CI step is added — writing the
tests does not make them run.

A useful side-effect: `src/components/language-provider.tsx:20` sets
`FORCED_LANGUAGE = "en"` and `:26` declares `initialLanguage` without using it, so every
`language === "is"` branch — including all Icelandic strings in `TENANT_REGISTRY` and in
`orgSectionLabel` — is unreachable. Copy tests only need the English branch today.

- **Contract:** first web test file establishes the pattern: component-level, no network, DOM environment declared per file. Assertions are over rendered output and over pure functions such as `slugForOrgName` and `orgSectionLabel` in `src/lib/org-tenant.ts`.
- **Copy:** none.
- **Codex should test:** the pure helpers in `src/lib/org-tenant.ts` and `src/lib/org-context.ts` (`pickMembership` is exercisable with a hand-built `AdminMe`), plus every disabled-state assertion named elsewhere in this appendix. · **Codex must NOT test:** do not introduce a fetch-mocking layer as part of the harness. A shared mock server is exactly the machinery that lets a later test stub an endpoint that does not exist; keep the first harness incapable of it.

---

### CW-11 — Invite redemption stays unsafe for real users until Group A ships
**Lane** disabled-until · **Blocks visual work** no · **Backend prerequisite** A01–A04 (S2)

`POST /api/public/invites/consume` (`apps/api/src/routes/public/invites.ts:86`) is
bearer-only and sets a password by **`upsert`** at :142-146 — possession of the token
overwrites an existing credential. There is no `already_claimed` 409. The guard that
should be there already exists two files away: `apps/api/src/routes/public/driver.ts:1089`
does the credential-existence check for `claim-invite`. Until that pattern is ported
(A01), any invite-redemption UI pointed at a real account is a credential-overwrite
vector, which is why 18E tiers it Unsafe and O09 gates it to disposable tenants.

- **Contract:** the redemption form may exist but must be reachable only under demo mode (CW-09) against `*@example.test` identities. Once A01 lands, the new terminal states are `409 already_claimed` (distinct from the existing `410 already_used` and `410 expired`) and the UI must not offer a retry for `already_claimed` — it routes to password reset instead.
- **Copy:** while gated, "Temporarily unavailable." Once A01 ships, for `already_claimed`: "This account already has a password. Sign in, or reset it." Never echo the token; passwords are always `<redacted>` in any log or test fixture.
- **Codex should test:** with demo mode off, the redemption control is unavailable; the `409 already_claimed` body maps to the reset copy, not to a generic failure. · **Codex must NOT test:** do not stub a successful redemption that creates a credential for a non-fixture identity, and do not assert scenarios 1–8 from the UI — those are database-level invariants (`[D]`) about hash immutability and concurrency that a browser test cannot observe.

---

### CW-12 — The web invite body must be `{ token, password }` — do NOT copy the mobile client
**Lane** mutation-after · **Blocks visual work** no · **Backend prerequisite** A10/A11 decision

`ConsumeBody` at `apps/api/src/routes/public/invites.ts:36-39` is a non-strict
`z.object` with exactly `token` and `password`. `apps/mobile/lib/api/client.dart:101-105`
(`consumeInvite`) posts a **third** field, `kennitala`, which the non-strict schema
strips silently. So the mobile contract as shipped is "kennitala is collected, sent, and
discarded". Making the schema `.strict()` — which A10 contemplates and scenario 13
asserts — would turn **every** mobile invite redemption into a 400. That is scenario 20
failing, not passing.

Consequence for the web lane: a new web redemption form must send only `token` and
`password`. If it mirrors the Dart client it will work today and break on the same day
strictness lands. Related: `_inviteErrorMessage` (`client.dart:122-137`) has branches for
`not_found`, `already_used`, `expired`, `validation`, `malformed_metadata` and **no
branch for `already_claimed`** — when A01 lands, mobile shows "Could not redeem invite
(already_claimed)". The web client must not inherit that gap.

- **Contract:** web sends `{ token, password }` only. Handle `404 not_found`, `410 already_used`, `410 expired`, `400 validation`, and — after A01 — `409 already_claimed`, each with its own copy. Do not send `kennitala` from the web.
- **Copy:** one distinct user-facing string per code; no `Could not … (<code>)` fallback that leaks the machine code (see CW-04).
- **Codex should test:** that the outgoing request body has exactly two keys. · **Codex must NOT test:** do not write a web test asserting that `kennitala` is accepted. It is accepted only because the schema is non-strict; encoding it would make the strictness fix look like a regression.

---

### CW-13 — Read-only surfaces that are real today and safe to wire
**Lane** read-only · **Blocks visual work** no · **Backend prerequisite** none

These endpoints exist, are mounted, and are permission-gated. They are the honest
material for a data-bearing UI right now:

- Org landing already calls three of them in `src/app/org/[slug]/page.tsx:88-98` —
  `GET /api/admin/orgs/:orgId/chargers`, `/installations`, `/sessions`.
- Staff overview calls six in `src/app/staff/overview/page.tsx:302-312` —
  `/api/admin/host-applications?status=new`, `/api/admin/pending-discoveries`,
  `/api/admin/active-sessions`, `/api/admin/orgs`, `/api/admin/installations`,
  `/api/admin/chargers`.
- Agreements list/detail via the read-only repository (`apps/api/src/repositories/agreements.ts`),
  which filters to the pilot types `service_cpo` and `installation` at the repo layer —
  the UI will therefore never see `service_contractor`, `service_workplace` or
  `workplace` rows, and must not present its list as complete.
- `GET /api/admin/orgs/:orgId/driver-group-memberships` (requires `?driverGroupId`).
- `GET /api/admin/access-requests` (`apps/api/src/routes/admin/access-requests.ts:76`).

- **Contract:** all are GETs returning JSON envelopes (`{ chargers: [...] }`, `{ installations: [...] }`, `{ summary: {...} }`). Errors follow CW-04. The staff `load<T>` helper's `{ ok, reason, status }` shape is the right pattern; the org page's raw-message rendering is not.
- **Copy:** empty results render an empty state, never "This isn't tracked yet" — that string is reserved for the absent onboarding aggregate (CW-06). An agreements list carries a note that only CPO-service and installation agreements are shown.
- **Codex should test:** empty-array responses render the empty state and not an error; a 403 renders per CW-03. · **Codex must NOT test:** do not assert the agreements list contains every agreement type — the pilot filter is a deliberate repo-layer restriction, and a test asserting completeness would be asserting a bug.

---

### CW-14 — Mutation surfaces that exist today, and why a 200 is not proof of org authority
**Lane** wire-now · **Blocks visual work** no · **Backend prerequisite** none to wire; D02/D-group for the *claim*

Three mutations are real and gated and can be wired now:
`POST /api/admin/orgs/:orgId/driver-group-memberships`
(`apps/api/src/routes/admin/driver-group-memberships.ts:46`, `member.write`),
`PATCH /api/admin/access-requests/:id`
(`apps/api/src/routes/admin/access-requests.ts:114`), and charger remote start at
`apps/api/src/routes/admin/chargers.ts:369` (`/:ocppIdentityId/remote-start`).

The caveat is about what the UI may *say*, not whether it may call. Two authorisation
facts change the meaning of a 200:

1. `requirePermission` has a god-mode early return: `isBootstrapSession(session)` →
   `next()` with no DB check (`require-permission.ts:55-59`, mirrored in
   `assertPermission` :115-117). A bootstrap admin session — `sub === "admin"`, no
   `userId` — passes every verb.
2. `sales_cs` holds `platform.tenant.write`
   (`apps/api/src/lib/auth/permissions.ts:266-270`), which `expandPlatformTenantVerbs`
   expands into `member.remove`, `charger.remote_start`/`stop`, `billing.write`,
   `org.write` and more, **in every org**. The source comment on that line says
   "column-restricted in repo layer (org notes/tags only)" — that restriction **is not
   implemented**.

So a successful mutation does not establish that the actor was an org member acting
within their org.

- **Contract:** call the endpoints; render the outcome. Do not render provenance claims like "changed by an administrator of this organisation" or "only your organisation can do this" — the frontend cannot know that. Attribution copy is CW-16's problem.
- **Copy:** neutral outcome strings ("Driver added to group.", "Request approved."), no authority claim.
- **Codex should test:** happy path plus 403 per CW-03 for each of the three. · **Codex must NOT test:** do not test that a platform-scoped actor is *refused* an org mutation. They are not refused today — `sales_cs` is expanded into org verbs everywhere — and a passing refusal test would mean the test is stubbing the permission resolver, not exercising it.

---

### CW-15 — Agreement write UI is mutation-after Group K, and Group K is greenfield
**Lane** mutation-after · **Blocks visual work** no · **Backend prerequisite** K01–K14, L01–L12

Distinct from CW-08 (which says *hide the control*): this note is about sequencing when
the control eventually arrives. Group K is not hardening an existing surface, it is
building one from nothing — see CW-08 for the evidence. That means the write contract
does not exist yet in any form Codex can code against, and any draft/activate UI written
now would be written against an imagined shape.

Two facts will shape it and are worth designing around in the visual lane: activation is
org-admin-only, not staff (scenario 141 — staff activating is a 403), and overlap is not
enforced by the database (no exclusion constraint; the resolver warns and orders
deterministically in `persist.ts:143-165`). So the eventual UI must treat overlap as a
server-reported condition with a real error path, not as something the database will
guarantee away.

- **Contract:** unknown — do not guess. When K lands, expect distinct codes for draft-edit-allowed vs active-edit-refused (scenarios 137, 138) and an activation audit carrying a pricing snapshot (142). Until then, no write client.
- **Copy:** none yet. Pricing figures displayed anywhere before K/L land read "Estimated." (see CW-08).
- **Codex should test:** nothing on the write path. · **Codex must NOT test:** do not write an agreement-editor test with a mocked create/activate. There is no endpoint and no error taxonomy; the mock would *become* the de-facto spec and the backend would then be measured against an invented contract.

---

### CW-16 — Attribution display: never name a person the backend did not attribute
**Lane** hidden · **Blocks visual work** no · **Backend prerequisite** Group E (E01–E05), Group F

O10 and 18E's driver-app row both say the UI must never name a person for a session
whose attribution is `installation` or `unknown`. The backing structures do not exist:
`session_attribution` and `IdToken.tokenClass` return zero hits anywhere outside
`docs/` — not in the Drizzle declarations (`packages/shared/src/db/`), not in
`prisma/schema/`, not in `apps/api/prisma/schema/`. There is no attribution field to
read, which means the only safe rendering today is one that never claims a person.

The pressure comes from adjacency: a session row carries an idTag, an idTag often maps to
a user, and joining those two in the browser produces a name. That join is exactly the
lie E-group exists to prevent — scenario 120 says session identity uses
station/EVSE/connector, never the idTag.

- **Contract:** until an explicit attribution field ships, session rows show station, connector, time and energy. No driver name, no email, no derived owner. When Group E lands, only `attribution === "driver"` (or equivalent) may render a person; `installation` and `unknown` render the site or nothing.
- **Copy:** for a non-driver-attributed session, name the location, not a person — e.g. the installation display name alone. Never "Unknown driver" next to a real person's data.
- **Codex should test:** a session fixture with no attribution renders no personal identifier (assert `driver-anna@example.test` and her display name are absent from the DOM). · **Codex must NOT test:** do not stub an attribution field and assert the driver-attributed branch. The field does not exist in any schema; the test would ratify a shape the backend has not chosen.

---

### CW-17 — The org slug fallback silently renders a different tenant
**Lane** wire-now · **Blocks visual work** yes (it constrains what the org header may assert) · **Backend prerequisite** none

`pickMembership` in `src/lib/org-context.ts:104-117` returns `hostAdminOrgs[0]` whenever
the requested slug matches nothing. `requireOrgContext` (:131-151) then compares
`slug !== tenant.slug` and redirects to the canonical URL. Tenant *isolation* is
genuinely sound — only orgs returned by `GET /api/admin/me` can resolve, so a foreign
org cannot be rendered — but a multi-org `host_admin` who types an unknown slug is shown
their **first** org and the address bar is rewritten to match. There is no "that
organisation was not found" path at all.

Compounding it: `src/middleware.ts` has no `/org/[slug]` rule. `staffRouteResponse`
(:58-77) handles the `/staff` prefix and everything else falls through to the catch-all,
so an unauthenticated `/org/<slug>` is redirected to `/` by default — an inherited
behaviour, not a chosen one. Also note the three stale source comments asserting
middleware never executes (`src/middleware.ts:45-54`,
`src/app/staff/page.tsx:27-34`, `src/app/staff/overview/page.tsx:221-231`); commit
`14c1ce2` moved the file into `src/` and it is live. Anyone reasoning from those comments
reasons from a false premise.

- **Contract:** an unmatched slug for a multi-org caller should produce an explicit not-found or org-picker, not a silent substitution. Single-org callers are unaffected and the current behaviour is fine for them. Any redirect must be visible in the UI, not only in the URL.
- **Copy:** "That organisation isn't one of yours." plus a list of the caller's orgs, when `me.orgs` has more than one `host_admin` entry.
- **Codex should test:** `pickMembership` with a two-org `AdminMe` (`org_alpha`, `org_beta`) and slug `org_gamma` — assert the multi-org case is distinguishable from a match. This is a pure function; no network. · **Codex must NOT test:** do not assert that a foreign slug renders a foreign org's data to prove isolation — `fetchMe` bounds the set, so the test would pass for the wrong reason and would not detect a later widening of that bound.

---

### CW-18 — Section gating, route typing and copy mechanics the disabled states run on
**Lane** visual-only · **Blocks visual work** no · **Backend prerequisite** O01 (copy library) only

Mechanics that every other note depends on, all frontend-owned:

- **The only "is this shipped" switch is `BUILT_SECTIONS`** in `src/lib/org-tenant.ts:204-207`,
  currently `{ overview, profile }`. `DEFAULT_SECTIONS` lists seven keys (overview,
  profile, chargers, drivers, invite, sessions, agreements), so five render as unlinked
  cards with an `org-tag-soon` badge in `src/app/org/[slug]/page.tsx:289-320`.
- **"soon" is not the doc-17 copy.** The literal strings today are `"soon"` / `"væntanlegt"`
  plus the `.soon` classes in `src/app/org/org-landing.css:182,470,474`. O01's library
  distinguishes five cases — "Not available yet." (not built), "This isn't tracked yet."
  (no backing data), "Managed through driver groups." (no such control),
  "Temporarily unavailable." (pending a fix), "Demo data — not connected to a live
  system." (fixture-backed) — and a single "soon" collapses all five into one
  undifferentiated promise. Replacing it is the concrete shape of O01.
- **`typedRoutes: true`** (`next.config.mjs:15`) means every new href must satisfy the
  generated `Route` type; the org page already casts (`` `/org/${tenant.slug}${section.path}` as Route ``).
  Adding a section to `BUILT_SECTIONS` without creating the page is a type error, which
  is a useful guard — keep it.
- **`next.config.mjs:19-32` permanently redirects `/tenants*` → `/accounts*` and
  `/accounts` does not exist** (the whole `(app)` console lives under
  `archive/straumvakt-org-console-2026-08-08/`). It is `permanent: true`, so browsers
  cache a redirect into a 404.
- **Only the English copy branch is reachable** — `FORCED_LANGUAGE = "en"`
  (`src/components/language-provider.tsx:20`), and `initialLanguage` is declared at :26
  and never read despite `src/app/layout.tsx` computing and passing it.

- **Contract:** the copy library is a frontend module keyed by reason (`not-built`, `no-data`, `no-such-control`, `temporarily-unavailable`, `fixture`), each returning one exact string. Section gating stays in `BUILT_SECTIONS`; do not add a second gate.
- **Copy:** the five strings above, verbatim from doc 17 §4 / 18E.
- **Codex should test:** each reason key returns its exact string, and no surface renders the bare word "soon" once the library lands. · **Codex must NOT test:** do not add an Icelandic-branch assertion. `FORCED_LANGUAGE` makes `language === "is"` unreachable, so an `is` test either fails or passes by mocking the provider — and mocking it asserts a bilingual mode the app does not currently have.
