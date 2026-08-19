# Onboarding an org to invoiceable — the walk, the gaps, the operator script

Written 2026-08-19 by `claude-b`. TASKS.md task 12 (admin-onboard customer 1)
and task 13 (self-serve), walked against source rather than intent.

Basis labels: `[repo]` verified in this tree with a citation · `[inferred]`
with reasoning · `[confirm:]`.

---

## The answer, first

**Can an org be walked from nothing to invoiceable today without hand-editing
the database?**

# No.

Four of the five steps have a working API surface. **The fifth — setting the
flat-fee agreement — has no write surface at all.** `apps/api/src/repositories/agreements.ts`
exports exactly three functions and every one of them reads:
`listAgreementMembershipsForUser`, `listAgreements`, `getAgreementDetail`
`[repo]`. `GET /api/admin/orgs/:orgId/agreements` is the only agreement route
on the org, and it is a GET `[repo: apps/api/src/routes/admin/orgs.ts:284]`.
No application code anywhere calls `agreement.create` — the only matches in
the tree are docstrings inside the generated Prisma client `[repo]`.

Round 1 recorded the agreement routes as GET-only. **That still holds**, and
it is now the single thing standing between an operator and a first invoice.

---

## Phase 2 — the admin-onboarding path, step by step

The FOCUS.md workstream shape, with what actually exists at each step.

### Step 1 — org created, roles set

| | |
|---|---|
| **Surface** | `POST /api/admin/orgs` `[repo: apps/api/src/routes/admin/orgs.ts:68]` |
| **Guard** | `requirePermission("platform.tenant.write")` `[repo: :70]` |
| **Input** | `OrgInputs.OrgCreateInput` `[repo: :73]` — carries `displayName`, `countryCode`, `roles`, `kennitala`, `legalName`, `vskNr`, addresses, contacts |
| **Repository** | `createOrg` `[repo: apps/api/src/repositories/orgs.ts:133]` |
| **Verdict** | **WORKS** |

Roles are set in the same call (`roles: [...]`), so the "roles set by
Straumvakt admin" step needs no second request.

### Step 2 — invite / enrol users

| | |
|---|---|
| **Surface** | `POST /api/admin/orgs/:orgId/memberships` `[repo: apps/api/src/routes/admin/orgs.ts:394]`; list at `:384` |
| **Input** | `MembershipCreateInput` `[repo: :3 import]` |
| **Repository** | `addMembership` `[repo: apps/api/src/domains/identity/repositories/users.ts]` |
| **Driver invites** | `POST /api/admin/orgs/:orgId/driver-invites` `[repo: :241]`, `createDriverInvite` |
| **Verdict** | **WORKS** |

### Step 3 — attach existing chargers

| | |
|---|---|
| **Surface** | `POST /api/admin/chargers` `[repo: apps/api/src/routes/admin/chargers.ts:63]` |
| **Guard** | `requirePermission("charger.write")` — **no `orgIdParam`** `[repo: :63]` |
| **Repository** | `createCharger` `[repo: apps/api/src/repositories/chargers.ts:507]` |
| **Verdict** | **WORKS, with two findings below** |

**What identifies a charger:** `identityString` — the OCPP identity the
charger presents on connect `[repo: chargers.ts:507ff]`.

**What binds it to an org:** `input.orgId`, supplied in the request body and
written onto `siteAssets`, `chargingStations`, `evses` and `ocppIdentities`
`[repo: chargers.ts:520-545]`.

**What creates the connectors:** the same transaction. `createCharger` inserts
siteAsset → chargingStation → EVSE → connector → ocppIdentity and deletes the
pending discovery, in six round trips `[repo: chargers.ts:519-560]`. **The
asset chain is created for you** — this step is better built than expected,
and the readiness signal's `no_connector_in_asset_chain` hold should therefore
rarely fire in practice.

#### Finding 3a — the org is taken from the body and never checked against the caller

`requirePermission("charger.write")` is called **without** `orgIdParam`. Per
the middleware's own contract, *"When omitted, the verb is treated as
platform-only — the resolver runs without a Membership lookup"*
`[repo: apps/api/src/lib/auth/require-permission.ts:27-31]`.

**So charger creation is platform-staff-only, and this is NOT a tenant
escalation.** A customer host admin cannot reach this route at all. Stated
plainly because the shape — an unvalidated `orgId` in a request body — looks
like the invite-code class at first glance and is not.

What it *is*: **an operator-error surface with no safety net.** A mistyped
`orgId` silently attaches a charger, its EVSE, its connectors and its OCPP
identity to the wrong tenant, and nothing complains.

#### Finding 3b — the same charger identity can exist in two orgs, and the auth lookup picks one arbitrarily

**This one lands on money.**

1. `ocppIdentities` is unique on **`(orgId, identityString)`**, not on
   `identityString` alone `[repo: packages/shared/src/db/protocol.ts:66]`.
   Cross-org duplicates are therefore permitted by the schema.
2. `createCharger` performs **no existence check** on the identity string
   before inserting `[repo: chargers.ts:507-560]`.
3. The gateway's auth lookup is:

   ```sql
   SELECT id, org_id, auth_secret_hash, status FROM ocpp_identities
   WHERE lower(identity_string) = lower($1)
   LIMIT 1
   ```

   `[repo: apps/api/src/routes/internal/ocpp-auth.ts:82-91]` — **no org
   scope, `LIMIT 1`, and no `ORDER BY`.**

So when two rows match, the winner is **whichever row the query plan reaches
first**, which is not stable across vacuum, index state or plan changes
`[inferred: a LIMIT without ORDER BY has no defined row order in Postgres]`.

**The consequence:** `identity.orgId` from that lookup is what the session,
the CDR and ultimately the invoice line are attributed to. A duplicated
identity silently routes one org's energy onto another org's invoice.

**And the trigger is an ordinary business event, not an attack.** A charger
moving between orgs — a site changing hands, a host re-onboarded — is exactly
the case that produces a second row. `deleteCharger` exists
`[repo: chargers.ts:752]`, so the intended flow is presumably delete-then-create,
but nothing enforces it and nothing warns.

**Reported as an access-grant finding, per the dispatch.** It is not the
invite-code hijack — it is not reachable by a customer — but it is the same
*class*: a permissive grant that lets one tenant's resource land under
another tenant, silently. **FOCUS.md Rule 5 applies (access-grant resolution
→ design approval before any fix), so nothing was changed here.**

**Recommended fix, for the record, not applied:** a partial unique index on
`lower(identity_string)` where `status = 'active'`, plus an explicit
pre-check in `createCharger` returning a named conflict, plus `ORDER BY` on
the auth lookup so that even a legacy duplicate resolves deterministically.
The index is a migration and `apps/api/drizzle/**` is A's lane.

### Step 4 — set the flat-fee agreement

| | |
|---|---|
| **Surface** | **NONE** |
| **Read** | `GET /api/admin/orgs/:orgId/agreements` `[repo: orgs.ts:284]` |
| **Repository** | `agreements.ts` exports three functions, all reads `[repo]` |
| **Cost factors** | `POST`/`PATCH` **exist** `[repo: apps/api/src/routes/admin/billing-cost-factors.ts]` |
| **Rate references** | `POST`/`PATCH` **exist** `[repo: apps/api/src/routes/admin/billing-rate-references.ts]` |
| **Verdict** | **MISSING — this is the blocker** |

The pieces *below* the agreement have write surfaces; the agreement itself,
its parties and its clauses do not. So an operator can create the rate
reference the flat fee needs and then has nowhere to hang it.

`agreements-debug.ts` has a `POST`, but it is `/debug-resolve` — a resolver
probe, not a write `[repo: apps/api/src/routes/admin/agreements-debug.ts:89]`.

### Step 5 — the org is invoiceable

Nothing asked this question before this round. `assessOrgReadiness` now does
`[repo: packages/contracts/src/onboarding/org-readiness.ts]`.

---

## The gap table

| Step | Status | Evidence |
|---|---|---|
| Create org, set roles | **works** | `orgs.ts:68`, `createOrg` at `repositories/orgs.ts:133` |
| Capture host kennitala | **works** — and now validated | `inputs/orgs.ts` `kennitalaField`; `repositories/orgs.ts:142` |
| Enrol users / memberships | **works** | `orgs.ts:394`, `addMembership` |
| Driver invites | **works** | `orgs.ts:241`, `createDriverInvite` |
| Attach charger + asset chain | **works** | `chargers.ts:63` → `createCharger` builds siteAsset→station→EVSE→connector→identity |
| Charger org binding | **unsafe (operator error)** | body-supplied `orgId`, never checked against caller — `chargers.ts:63` |
| Charger identity uniqueness | **unsafe (cross-org misrouting)** | `(orgId, identityString)` unique + `LIMIT 1` unscoped lookup |
| **Set flat-fee agreement** | **MISSING** | `agreements.ts` is read-only; no `agreement.create` in any application file |
| Cost factor / rate reference writes | **works** | `billing-cost-factors.ts`, `billing-rate-references.ts` |
| Know whether an org is invoiceable | **works (new this round)** | `org-readiness.ts` |

---

## The operator script

The ordered sequence an admin actually performs. **Step 5 is the one that
cannot be done through the API today.**

```
 1. CREATE THE ORG
      POST /api/admin/orgs
      { displayName, countryCode: "IS", roles: ["site_host"],
        legalName, kennitala, vskNr, defaultCurrency: "ISK" }
    VERIFY: 201, and GET /api/admin/orgs/:orgId returns the kennitala.
    NOTE:   a malformed kennitala is now rejected with kennitala_<reason>.
            If the host has not supplied one yet, omit it — do NOT invent
            one. The readiness check in step 6 will hold on it.

 2. ENROL THE FIRST USER
      POST /api/admin/orgs/:orgId/memberships
    VERIFY: GET /api/admin/orgs/:orgId/memberships lists them.

 3. CREATE THE SITE / INSTALLATION the charger will hang from
      (sites and installations routes, orgs.ts:127 / :139 to read back)
    VERIFY: GET /api/admin/orgs/:orgId/sites returns it.

 4. ATTACH THE CHARGER
      POST /api/admin/chargers
      { orgId, siteId, installationId, circuitId, identityString, ... }
    ⛔ STOP — CHECK THE orgId IN THE BODY CHARACTER BY CHARACTER.
       Nothing validates it. A wrong value silently attaches the charger,
       its connectors and its OCPP identity to another tenant.
    ⛔ STOP — CHECK THE IDENTITY IS NOT ALREADY REGISTERED ELSEWHERE.
       Nothing checks. A duplicate makes charger authentication ambiguous
       and routes sessions to an arbitrary one of the two orgs.
       If this charger is moving between orgs, DELETE the old row first.
    VERIFY: GET /api/admin/orgs/:orgId/chargers shows it, with connectors.
    KEEP:   the returned OCPP password — it is not retrievable again.

 5. SET THE FLAT-FEE AGREEMENT
      ⛔ NO API SURFACE EXISTS. This step requires a direct database write
         today: the agreement, its party rows and a clause carrying the
         per_connector cost factor and its rate reference.
      The cost factor and rate reference themselves CAN be created through
      the API (billing-cost-factors, billing-rate-references) — only the
      agreement that binds them to the org cannot.
    VERIFY: GET /api/admin/orgs/:orgId/agreements returns it, in force for
            the period, carrying a per-connector rate.

 6. CONFIRM THE ORG IS INVOICEABLE
      Run the readiness assessment. Every hold names its own remedy.
      npx tsx scripts/dry-run-onboard-org.mts --case happy
    VERIFY: "INVOICEABLE — every precondition the billing pipeline
             requires is satisfied."
```

---

## Phase 3 — task 13 self-serve gaps, re-enumerated

The 2026-08-08 note recorded three defects on the invite path. All three are
now verified against current source.

| Defect (2026-08-08) | Status today | Evidence |
|---|---|---|
| **Invite codes are bearer-only** — any driver could redeem another's code | **FIXED** | ADR 0053 `[repo: docs/adr/0053-driver-invites-are-identity-bound.md]`. `redeem-invite` compares `row.userId !== userId` and rejects **before** claiming, so a rejected attempt leaves `usedAt` null and the real recipient can still redeem `[repo: apps/api/src/routes/public/driver.ts:1158ff]`. The distinct reason is audited, not returned — no oracle. |
| **The invitee is locked out of redeeming their own invite** | **FIXED** | A two-step flow now exists: `POST /api/driver/claim-invite` `[repo: driver.ts:991, :1030]` lets a fresh invitee bootstrap a credential, bounded by *"the bound user must NOT already have a credential"* so a leaked code is a bootstrap and not an account takeover `[repo: driver.ts:1005-1015]`. The token is deliberately not consumed by the claim — *"Claiming is not redeeming"* — and `/redeem-invite` still grants the membership once, afterwards. |
| **The placeholder user carries no idToken** | **FIXED** | `createDriver` now inserts a `virtual_rfid` idToken in the same path, commented as *"The invariant the other four paths were missing. A driver without this cannot be presented to a charge point at all."* `[repo: apps/api/src/repositories/create-driver.ts:203-211]` |

### The current task-13 gap list

| # | Gap | Severity | Blocking self-serve? |
|---|---|---|---|
| 1 | **No agreement write surface** — a self-enrolled org still cannot reach a flat-fee agreement without a database write | **blocking** | **Yes.** This is the same blocker as task 12's step 5, and it blocks both paths. |
| 2 | Charger attach is platform-staff-only (`charger.write` with no `orgIdParam`) | **blocking for self-serve specifically** | **Yes** — "attach existing chargers" cannot be done by the org itself. Correct for task 12; fatal for task 13. |
| 3 | Charger identity cross-org duplication (finding 3b) | high | No — but it becomes materially more dangerous the moment orgs can attach their own chargers. |
| 4 | Org self-enrolment endpoint | `[confirm:]` — `public/register.ts` and `public/host-applications.ts` exist; whether they produce an org or only an application was not traced this round | unknown |

### On the `[BLOCKER]` in TASKS.md

TASKS.md task 13 reads `[BLOCKER: invite codes are bearer-only]`.

**That blocker should be lifted — it is fixed, with an ADR and identity-bound
redemption.** But task 13 is **not** thereby unblocked: it should be restated.

**Proposed restatement:**

> `[BLOCKER: no agreement write surface; charger attach is platform-only]`

Both are structural, neither is a safety defect, and both are shared with
task 12 — which is exactly why task 12 was the right thing to attack first.
