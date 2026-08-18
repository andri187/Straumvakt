# Product-to-market backend runway

The contract runway that lets Codex build a truthful market-facing product.
Continues [14-backend-readiness-ledger](14-backend-readiness-ledger.md).

Verified at start: mine `d0f4cc0`, RC `4b69d0f`, Codex web `d228f53` (6 dirty),
Codex mobile `75beb3c`, Claude B **`9fefff9`** (expected `31c0900` — moved).

Claude B's two new commits are documentation only — round-2 control-plane
evidence and an `E:\Claude` cleanup plan. **No `apps/api/src` or
`packages/shared/src` change**, so the readiness verdict in doc 14 stands
unaltered.

`docs/OCPP` is **untracked** in the canonical checkout (one of its 22 dirty
entries) — reference material, not source.

---

## 1. S2 — the password-overwrite fix, fully designed

### 1.1 What consume is actually for

`SOURCE-FACT` `invites.ts:99-176` does five things in one transaction: resolve
the token, claim it, **write a credential**, flip `Membership` to `active`, set
`emailVerifiedAt`, audit.

So it is currently **three jobs at once**: account activation, password
creation, and membership acceptance. The header comment
(`:17`) calls the credential write "defensive" for the case where a credential
already exists.

**Decision:** consume is *membership acceptance* plus *first-time password
creation*. It is **not** a password reset, and must never be one — a reset
requires proof of identity, which a bearer token is not.

### 1.2 Truth table

Dimensions: account exists · caller identity · token state · credential state.
`SOURCE-FACT` for "today"; `PROPOSED` for "should be".

| # | Token | Credential on bound user | Caller | Today | **Should be** |
|---|---|---|---|---|---|
| 1 | valid, unused | none | anonymous bearer | 200, creates credential, activates | **200** — unchanged; this is the intended path |
| 2 | valid, unused | **exists** | anonymous bearer | **200, OVERWRITES password** | **409 `already_claimed`**, hash untouched, token **unconsumed** |
| 3 | valid, unused | exists | authenticated **as bound user** | 200, overwrites | **200** — membership activated, credential **untouched** |
| 4 | valid, unused | exists | authenticated as **someone else** | 200, overwrites | **404 `not_found`** + audit `redemption_rejected` |
| 5 | valid, unused | none | authenticated as someone else | 200 | **404 `not_found`** + audit |
| 6 | already used | any | any | 410 `already_used` | unchanged |
| 7 | expired | any | any | 410 `expired` | unchanged |
| 8 | unknown/wrong kind | any | any | 404 `not_found` | unchanged |
| 9 | valid | none | authenticated as bound user | 200 | **200** |
| 10 | malformed metadata | any | any | 500 `malformed_metadata` | **400** — client error, not server |

**Row 2 is the Critical.** Row 4/5 are the bearer-membership grant. Rows 6–8
already behave correctly.

**Crucial ordering detail:** in row 2 the token must be left **unconsumed**.
Today the conditional claim (`:130-132`) runs *before* the credential write, so
a refusal after claiming would burn the invite and strand the real invitee —
exactly the ADR 0053 mistake, in the other file. **The credential check must
move above the claim.**

### 1.3 Staged behaviour

S2 fixes **row 2 only** — the Critical — and requires no client change:

- anonymous + no credential → unchanged (row 1)
- anonymous + credential exists → `409 already_claimed`

Rows 4/5 (identity binding) need an authenticated caller and therefore wait for
the adoption gate in doc 11 Part D. Splitting them this way means the Critical
closes **now** rather than behind an app release.

### 1.4 Compatibility

| Client | Effect of S2 |
|---|---|
| Codex mobile (`75beb3c`) | none — new invitees have no credential |
| Codex web (`d228f53`) | none, same reason |
| Archived web accept-form | none |
| **Any user re-consuming to reset a password** | **breaks — intended** |

Only the abuse case breaks. That is the point, and it is why D-01 must be
answered first.

### 1.5 Patch proposal

A minimal diff is provided as a **proposal file**, not applied:
`docs/analysis/s2-consume-no-overwrite.patch.md`. Runtime source is untouched in
this track.

### 1.6 Tests

`T-S2-1` credential exists + anonymous → 409, `passwordHash` byte-identical,
`usedAt` still null · `T-S2-2` no credential → 200 · `T-S2-3` refusal is audited
with `actorKind: "bearer"` · `T-S2-4` concurrent consume of one token → exactly
one winner · `T-S2-5` refused consume leaves the invite usable by the real
invitee afterwards (the anti-deadlock test).

### 1.7 Stop condition

Roll back if `already_claimed` appears for users who legitimately have no other
way in — i.e. if the field data shows consume *was* being used as a reset. That
is D-01, and it is answerable by Q-02 in minutes.

---

## 2. Charger visibility — recommendation: **reject the toggle, defer the concept**

### 2.1 What exists

`SOURCE-FACT` `driver.ts:238-260`: a driver sees chargers by
`DriverGroupMembership → driverGroup → agreement` where the installation
agreement is `active` and in its effective window. **Visibility is a consequence
of two existing controls: membership, and agreement validity.**

### 2.2 Use cases, and whether membership already covers them

| Use case | Covered today? |
|---|---|
| "This charger is for staff only" | **Yes** — a staff driver group |
| "Hide a charger while it is broken" | **No** — but this is *availability*, not visibility, and belongs to charger status |
| "Show a charger to the public" | **No** — but public charging is not in this beta's scope |
| "Temporarily stop new sessions" | **No** — again availability |
| "Different chargers for different tenants at one site" | **Yes** — separate driver groups |

Two of five are already solved by groups. The other three are **availability and
public charging**, which are different concepts wearing visibility's clothes.

### 2.3 Risks of adding a toggle

A visibility flag creates a **second access-control system** beside membership.
Two systems that both decide "can this person see this charger" will disagree,
and the disagreement will be discovered as either a leak (visible when it should
not be) or a support ticket (invisible when it should not be). It also invites
the belief that hiding is a security control, which it is not — a hidden charger
is still physically present and still authorizes.

### 2.4 Recommendation

**Reject an explicit visibility toggle for beta. Defer the concept.** Build
charger *availability status* (`operational | maintenance | retired`) when the
need is real — that is a different, honest control that answers three of the
five use cases without duplicating access logic.

### 2.5 What Codex should build instead

No visibility control in the CPO UI. Where a "hide this charger" affordance was
planned, use driver-group membership, with this language:

> **Who can see this charger**
> Drivers see a charger when they belong to a driver group with access to its
> installation. To change who sees this charger, change the driver group.
> *(There is no separate visibility setting.)*

That sentence is accurate today, requires no backend work, and does not promise
a control that does not exist.

---

## 3. Agreement and cost-factor write surface — the largest gap

`SOURCE-FACT` recap: every agreement/tariff/cost-factor route is a `GET`; the
only POSTs are `debug-resolve` and `sessions/:id/resolve`;
`repositories/agreements.ts` has **no** create/update/upsert/delete.

### 3.1 Minimum viable write model

Deliberately small. The commercial model already has four generations of pricing
logic; a fifth invented here would be the worst possible outcome.

**Commands** (all `PROPOSED`):

- `POST /api/admin/orgs/:orgId/agreements` — create a **draft** agreement
  `{ agreementType, counterpartyOrgId, installationId?, displayName, effectiveFrom, effectiveUntil? }`
- `PATCH …/agreements/:id` — edit **while draft only**
- `POST …/agreements/:id/activate` — draft → active; the only transition that
  affects pricing
- `POST …/agreements/:id/retire` — sets `effectiveUntil`; never deletes
- `POST …/agreements/:id/clauses` — attach a cost factor with a value and scope
- `DELETE …/clauses/:clauseId` — **draft only**

**Scope** for a clause: `organisation | driver_group | installation | charger`.
Not per-driver and not per-session for beta — per-driver pricing multiplies the
resolution matrix and there is no product demand evidenced in source.

### 3.2 Invariants

1. **Never mutate an active agreement's pricing.** Retire and supersede. This is
   what makes historical sessions re-resolvable.
2. **No overlapping active agreements** for the same `(type, counterparty,
   installation)` — enforce with an exclusion constraint on the effective range,
   not application code.
3. **Activation is the audited moment.** Draft edits are cheap; activation is
   the event with actor, reason and a pricing snapshot.
4. **Effective dating is required.** No open-ended "starts whenever".

### 3.3 Pricing preview before activation

`POST …/agreements/:id/preview` `{ sampleSessionKwh, at }` → resolved price
breakdown, using the **existing** resolver
(`POST /api/admin/agreements/debug-resolve` already exists and does this
`SOURCE-FACT`). Preview reuses it rather than duplicating the maths — the single
most important design choice here, because a second pricing implementation is
how the four generations happened.

### 3.4 Billing replay

Changing pricing never rewrites closed sessions. A correction is an explicit
re-resolve of named sessions
(`POST /api/admin/agreements/sessions/:sessionId/resolve` exists), producing a
correction record — never an in-place overwrite of a CDR.

### 3.5 Permissions

Create/edit draft: org admin or staff. **Activate: org admin only** — not staff
(doc 05 §4: an organisation must accept its own commercial terms). Retire: org
admin or staff with reason. Preview: anyone who can read agreements.

---

## 4. Codex UI enablement contract

The operative question: **what may Codex make interactive today without lying?**

### 4.1 Straumvakt admin UI

| Interactive now | Read-only | Hidden |
|---|---|---|
| Org create/edit; property/site/installation CRUD; membership admin; charger onboarding incl. OCPP password rotate/disable; remote start/stop; local-auth-list push | Agreements, tariffs, tariff-chain, billing sessions; audit views | Onboarding progress UI; cost-factor editing; visibility |

### 4.2 CPO / organisation admin UI

| Interactive now | Read-only | Hidden |
|---|---|---|
| Driver list; driver-group membership add/remove; charger list | Access requests (no proven caller yet); agreements; sessions | Pricing controls; visibility toggle; onboarding wizard |

### 4.3 Driver UI

| Interactive now | Read-only | Hidden |
|---|---|---|
| Login; charger list; start/stop; active session; invite redemption **on a disposable tenant only** | Session history; pending/rejected access states | Any claim about *who else* charged; cost breakdown presented as final |

### 4.4 Blocked-state wording

Exact copy, so three surfaces do not invent three explanations:

- Not built: **"Not available yet."** Never "coming soon" with a date.
- Backend absent: **"This isn't tracked yet."** (onboarding progress)
- No such control: **"Managed through driver groups."** (visibility)
- Unsafe pending fix: **"Temporarily unavailable."** (invite redemption for real
  users, until S2)

### 4.5 Fixtures

Local demos may use fixtures **only** behind an explicit `NEXT_PUBLIC_DEMO_MODE`
flag that is off by default, never in a build pointed at beta or production, and
every fixture value visibly marked (`Demo Org`, `demo-driver@example.test`). A
fixture that looks like real data in a screenshot is how a demo becomes a
false claim.

---

## 5. MVP recommendation

| | Straumvakt admin | CPO admin | Driver |
|---|---|---|---|
| **Before local demo** | org + charger CRUD | driver list, groups | login, chargers, start/stop |
| **Before beta** | **S2 shipped**; audit visible | membership admin | **S2**; honest pending/rejected states |
| **Before first real customer** | agreement write + activate; onboarding aggregate | cost-factor assignment; access-request approval proven end to end | **T2/A10 attribution**; truthful cost display |
| **Should-have** | support context; org-visible audit | pricing preview | multi-session chooser |
| **Later** | break-glass; retention tooling | charger availability status | Autocharge attribution |
| **Rejected** | — | **charger visibility toggle** (§2) | per-driver pricing (§3.1) |

**The single gate before any real customer is attribution.** Charging someone
based on a session the system may have attributed to the wrong person is the one
failure that is both invisible and unrecoverable.
