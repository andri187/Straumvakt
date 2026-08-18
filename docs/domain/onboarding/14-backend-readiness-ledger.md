# Backend readiness ledger

Can the backend support real, testable admin / CPO / Driver onboarding
workflows today? Evidence-based verdict per workflow.

Source: `Straumvakt-onboarding-domain` @ `54c7155`, RC @ `4b69d0f`, Codex web @
`d228f53`, Codex mobile @ `75beb3c` — all verified, all clean.

## Verdict summary

| # | Workflow | Verdict |
| --- | --- | --- |
| 1 | Straumvakt admin onboards an organisation | **Partly ready** — records yes, workflow no |
| 2 | Admin/staff onboards chargers | **Ready** — the strongest surface in the system |
| 3 | Admin/staff onboards drivers | **Unsafe** — works, but through the Critical |
| 4 | Admin/staff controls charger visibility | **Blocked — no such control exists** |
| 5 | Admin/staff controls driver cost factors | **Blocked — no write surface at all** |
| 6 | Driver requests access → approval → charge with truthful attribution | **Partly ready / unsafe attribution** |

**Overall: partly ready, and unsafe in two places.** Two of six workflows have
no backend at all, one is only reachable through a Critical vulnerability, and
one produces attribution that may be false. Three of six can be tested today.

---

## 1. Organisation onboarding — Partly ready

**Exists** `SOURCE-FACT`: `POST /api/admin/orgs`, `PATCH /api/admin/orgs/:orgId`,
`GET /api/admin/orgs/:orgId` (console caller), plus properties, sites,
installations, memberships, users under the org. `POST /api/admin/onboarding/chains`
exists.

**Missing:** the *workflow* itself. There is no resumable aggregate, no step
status, no "what is outstanding", no skip-with-reason, no next-actor. An
organisation can be **created**; it cannot be **onboarded** in any trackable
sense.

**Testable today:** create an org, add a property/site/installation, add a
membership. That is a real end-to-end record chain.

**Not testable:** anything the UI would render as progress. Codex's
`OnboardingSummary` has no backing endpoint.

**Verdict: partly ready.** Backend supports the *records*; frontend must show
read-only or derive progress itself, which is exactly what Codex's contract says
it should not do.

## 2. Charger onboarding — Ready

**Exists** `SOURCE-FACT`: `POST /api/admin/chargers`, `PATCH/DELETE /:id`,
`POST /:id/attach-vendor`, `GET /:id/technical-read`,
`GET/POST /:id/zaptec-state`, `GET/PATCH /api/admin/installations/:id/ocpp-password`
plus `/rotate` and `/disable`, and the OCPP command surface
(`change-configuration`, `get-configuration`, `remote-start`, `remote-stop`,
`local-auth-list/push`, `GET /commands/:commandId`).

This is the most complete domain in the backend, including OCPP identity
provisioning and credential rotation.

**Verdict: ready and testable now.** The gap is UI, not backend.

**Caveat:** `enforceAuthorize` defaults false and the gateway replies `Accepted`
regardless (`ocpp-authorize.ts:23-24`), so onboarding a charger does **not** yet
mean authorization is enforced at it.

## 3. Driver onboarding — Unsafe

**Exists** `SOURCE-FACT`: `POST /api/admin/orgs/:orgId/driver-invites`,
`GET` the same, `POST /api/admin/orgs/:orgId/driver-group-memberships`,
`POST /api/public/invites/consume`, `POST /api/driver/claim-invite`,
`POST /api/driver/redeem-invite`, `POST /api/public/register`.

The surface is complete. **The problem is which path works.**

- The path the mobile app uses (`invites/consume`) carries the **Critical**
  password-overwrite and the bearer membership grant.
- The identity-bound path (`claim-invite` → login → `redeem-invite`) is correct
  and proven by the RC parity suite — but **`claim-invite` has no caller on any
  branch, ever**.

**Verdict: unsafe until the security fix.** A driver *can* be onboarded end to
end today; doing so exercises a Critical. Testing it is fine on a disposable
tenant; running it for real users is not.

## 4. Charger visibility — Blocked, no such control

`SOURCE-FACT` `driver.ts:238-260`: `/api/driver/chargers` returns chargers by
walking `DriverGroupMembership → driverGroup → agreement` where
`agreementType = "installation"`, `status = "active"`, and the effective-date
window contains now.

**Visibility is a derived consequence of membership and agreement validity. It
is not a control.** A grep for visibility/visible/public/discoverable/hidden
across the admin routes and the driver route returns nothing.

**Consequences:** an org admin cannot hide a charger from a driver who has group
membership; cannot expose one without granting membership; cannot mark a charger
private/maintenance/public. The only lever is membership itself, or expiring the
agreement — which affects every driver at once.

**Verdict: blocked by missing endpoint and missing model.** The frontend must
not offer a visibility toggle: there is nothing behind it.

## 5. Driver cost factors — Blocked, no write surface

`SOURCE-FACT`: every agreement/tariff/cost-factor route is a **GET**. The only
POSTs in that domain are `POST /api/admin/agreements/debug-resolve` (a debug
resolver) and `POST /api/admin/agreements/sessions/:sessionId/resolve` (resolve
an existing session). `POST /api/admin/orgs/:orgId/bill-objects` and
`.../members` exist, but bill objects are billing *grouping*, not pricing.

`SOURCE-FACT`: `apps/api/src/repositories/agreements.ts` contains **no**
`create`, `update`, `upsert` or `delete`. The repository is read-only.

**So agreements, clauses and cost factors cannot be created or changed through
the API at all** — presumably they arrive by seed or by hand.

**Verdict: blocked by missing endpoint *and* missing repository writes.** This
is the largest single gap in the readiness picture, and it is upstream of
billing correctness. `UNKNOWN` — how agreements are currently created in
staging; answerable by a database read, not by source.

## 6. Driver access → approval → charge with truthful attribution — Partly ready / unsafe attribution

**Access request:** `POST /api/driver/access-requests`,
`GET/PATCH /api/admin/access-requests/:id` exist. Pending/approve/reject is
representable. **No caller on any branch**, so the flow is unproven end to end.

**Charge:** `POST /api/driver/start-session`, `GET /sessions/current`,
`POST /stop-session` exist and are the paths the mobile app already uses.

**Truthful attribution: not achievable today.** `ocpp-authorize.ts:17-21`
returns `userId` alongside the verdict with no notion of token class, so a
shared installation technical token that resolves to a user attributes **every
session at that installation** to that person. There is no `attribution` field,
no `unknown` value, and no way to express "authorized but unidentified".

**Verdict: partly ready; attribution unsafe.** A driver can request, be
approved, and charge. What the system then *says about who charged* may be
false, and nothing distinguishes a true attribution from a false one.

---

## What the three UIs may honestly show

| Surface | Ready now | Read-only / disabled | Must not build yet |
| --- | --- | --- | --- |
| **Straumvakt admin** | org + property/site/installation CRUD; charger onboarding incl. OCPP credentials; membership admin | onboarding progress (derive nothing — say "not tracked"); agreements/tariffs (read) | cost-factor editing; charger visibility |
| **CPO / org admin** | drivers list; driver-group membership; charger list | access requests (until a caller proves the flow); agreements | visibility toggle; pricing controls; onboarding wizard |
| **Driver** | login; charger list; start/stop; active session | pending/rejected access states | anything claiming *who* charged, beyond the driver's own session |

**Do not let frontend optimism mask backend absence.** Two of these — visibility
and cost factors — would be pure fiction if rendered as controls today.

## Critical path to "all six testable"

1. **S2** — refuse credential overwrite. One line. Unblocks safe testing of W3.
2. **A10 + T2** — token class and `attribution` on the authorize contract. Makes
   W6's attribution truthful rather than confidently wrong.
3. **Agreement/cost-factor write surface** — the largest gap; W5 is blocked
   until it exists, and billing correctness depends on it.
4. **Charger visibility model** — decide whether it is a real product concept
   before building UI for it. It may be that membership *is* the intended
   control, in which case W4 should be struck from the workflow list rather
   than implemented.
5. **Onboarding workflow aggregate** — turns W1 from records into a process.

Items 1 and 2 are security. Items 3 and 4 are missing product. Item 5 is the
packet's main design.

`UNKNOWN` and worth resolving before planning: is W4 a real requirement, or an
assumption? Nothing in source suggests anyone ever intended charger visibility
to be separately controllable.
