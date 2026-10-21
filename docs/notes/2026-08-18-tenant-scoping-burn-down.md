# Tenant-scoping burn-down — every census row classified

**2026-08-18 · Claude A · branch `dev/core-billing-integration`**

Phase 5 of the 2026-08-18 Claude A prompt. Source: the 105 classified gate rows
in `docs/notes/2026-08-11-core-billing-tenant-scoping.md`, re-read against
current source rather than against their own prior labels.

---

## 1. The eight `unknown` rows are gone

The 2026-08-11 census left eight rows labelled `unknown`, most of them
`"not opened line-by-line for this census"`. A residual unknown bucket in a
tenancy audit is the same thing as an unaudited surface, so each was opened.

| # | file | what it is | resolved to |
|---|---|---|---|
| 98 | `repositories/zaptec-session-sync.ts` | CDR→session ±60 s overlay predicate | **safe to fix now — FIXED**, see §3 |
| 105 | `repositories/zaptec-session-sync.ts` | `syncZaptecSessions`, the reconciliation writer | **safe to fix now — FIXED**, see §3 and Phase 3 |
| 99 | `repositories/agreements.ts` | `listAgreements` / `getAgreementDetail` | **needs product decision** |
| 100 | `repositories/driver-group-memberships.ts` | `createMembership` | **blocked by route shape** |
| 101 | `routes/admin/billing-rate-references.ts` | rate-reference CRUD | **global by design** |
| 102 | `routes/admin/billing-tariff-mgmt.ts` | publish / retire tariff versions | **needs platform support context** |
| 103 | `routes/admin/billing-cost-factors.ts` | cost-factor CRUD | **global by design** |
| 104 | `routes/admin/billing-enrichment.ts` | enrichment read | **safe to fix now** — not yet fixed, see §5 |

Reasoning for the four that are not simply "fix it":

- **99 — `agreements.ts`.** An agreement has *two* org columns, `ownerOrgId`
  and `counterpartyOrgId`. Scoping needs an answer to "may a counterparty read
  the agreement it is party to?", which is a commercial question, not a code
  one. Guessing either way is worse than naming it. Note the trap the census
  found: a **second, different** `listAgreements` exists in
  `billing-contracts.ts` and *does* take an `orgId` — so an author checking
  "does listAgreements scope?" can get either answer depending on which import
  they follow.
- **100 — `driver-group-memberships.ts`.** No org term anywhere in the file.
  Membership is keyed `(driverGroupId, userId)`; the org lives on the group.
  Scoping means changing the repository signature to carry the group's owner
  org, which is a route-shape change, not a WHERE clause.
- **101 / 103 — rate references and cost factors.** These are Icelandic market
  reference data — Veitur, N1 — shared by every tenant. They are global on
  purpose and reading them across orgs discloses nothing tenant-specific.
- **102 — tariff publish/retire.** Same data, but `billing.write`. Who may
  publish a tariff that prices every tenant's sessions is a platform-role
  question, and platform support context is exactly the thing the census
  reported as having three shadow implementations and zero enforcement.

---

## 2. All 105 rows, in the prompt's five buckets

| bucket | rows | how it maps to the 2026-08-11 labels |
|---|---:|---|
| **safe to fix now** | **26** | 23 `missing-orgIdParam` + 98, 104, 105 |
| **blocked by route shape** | **21** | the 21 `global-accidentally` rows, plus 100 (which replaces one of them — see below) |
| **global by design** | **21** | 19 `global-by-design` + 101 + 103 |
| **needs platform support context** | **1** | 102 |
| **needs product decision** | **1** | 99 |
| *(no gap — already correct)* | **35** | 34 `tenant-scoped-correctly` + the row promoted by this run's fixes |
| | **105** | **no residual unclassified bucket** |

**Why `global-accidentally` maps to "blocked by route shape" and not to "safe
to fix now".** These are reads that *happen* to return every tenant's rows
because the repository function has no tenant parameter at all. Adding a WHERE
clause is not the fix — the caller has no org to pass, so every one of them
needs its route to acquire and thread a tenant first. That is a route-shape
change by definition, and calling it "safe to fix now" would have produced a
sequence of one-line commits that each look complete and none of which enforce
anything.

**Why the 23 `missing-orgIdParam` rows ARE safe.** Those gates already sit on a
route that knows its tenant; the parameter is simply not passed to
`requirePermission`. The mechanical fix is available, and `check:orgid-param`
already fails on the 76th so the set cannot grow while the existing 75 are
worked down.

---

## 3. The three fixes implemented this run

Each has a test that fails when the scope is removed. All three were verified
by deliberately removing the scope and watching the suite go red — see §6.

### Fix 1 — the ledger list and its totals tile

`GET /api/admin/billing/sessions`. `scopeFromQuery` trusted every query
parameter and returned `{ kind: "admin" }` — **no tenant filter** — when none
were supplied. `requireAdmin` only verifies that an admin session cookie is
valid; it does not restrict to platform staff. **Any org member holding
`billing.read` could read every tenant's billing ledger by sending an empty
query string.**

- New pure decision in `lib/billing/ledger-scope.ts`.
- `listSessionLedger` / `totalSessionLedger` now take `LedgerAccess`, whose
  `restrictToOrgIds` is **required**. `null` is the explicit platform-wide
  choice. Omitting it is a compile error — which is how the four in-repo
  callers and every test were forced to state their tenancy.
- The two copies of the WHERE-building switch became one shared
  `buildLedgerWhere`. A totals tile confined differently from the list beneath
  it is worse than either being wrong alone, because the total is the number an
  operator believes.
- Tests: 7 in `session-ledger.test.ts`, 8 in `ledger-scope.test.ts`.

### Fix 2 — the billing overview dashboard

`GET /api/admin/billing/summary`. Four of its five repository functions read
`reports.session_ledger` with no tenant term. `getProjectedOrgRevenue` returns
**the top ten orgs by monthly revenue, ordered by size** — a league table of
every tenant's revenue, served to any caller with `billing.read`.

All four now take a required `restrictToOrgIds`; the route derives it from
`resolveOrgScope`. `getTariffCoverage` is deliberately *not* scoped and is no
longer claimed to be — it counts platform tariff configuration. Tests: 7 in the
new `billing-summary.test.ts`, including that `getCostHealthMetric` confines
**both** of its aggregates, since confining a numerator and not its denominator
produces a percentage that is nonsense without any single query being wrong.

### Fix 3 — the CDR reconciliation predicate

`zaptec-session-sync.ts`'s ±60 s overlay match ran on `chargingStationId` and a
time window with no `orgId`. A station belongs to one org, so this selects the
same row today — the term is added because the next reader should not have to
re-derive that, and because a station re-parented between orgs would otherwise
let one tenant's CDR overlay the other's session row. Census rows 98 and 105
are closed by this plus the Phase 3 attribution guard.

**A fourth, larger fix landed in Phase 3**: the CDR driver attribution now
requires the driver to be a member of the charger's org.
See `2026-08-18-cdr-tenant-attribution.md`.

---

## 4. The two files that each named the other

Resolved. **The repository enforces.**

| file | what it said | what it says now |
|---|---|---|
| `repositories/session-ledger.ts:16-18` | *"Scope authorisation is the CALLER's job — the route handler validates... This repo trusts the scope it receives."* | Corrected: this repository enforces, via a required `restrictToOrgIds`. The old sentence described an arrangement that did not exist. |
| `routes/admin/billing.ts:49-56` | *"refining further... is layered on top via assertPermission once Sprint 8 Track C lands per-resource checks. For Sprint 8.4 ship the admin-scope happy path."* | Rewritten: the route supplies identity and nothing else; the decision is in `ledger-scope.ts` and the enforcement in the repository. |

The repository was chosen as the enforcement point for one reason: it is the
side that can be made **impossible to forget**. A route can omit a call; a
required field cannot be omitted from a function signature without the build
failing. The route-side rule was already written down once and was still not
followed for four months.

### A third lying header, corrected

`repositories/billing-summary.ts:5-6` claimed *"All functions take orgId =
undefined for platform-admin (no filter) or a specific orgId for tenant-scoped
reads."* **None of the five had an orgId parameter.** The claim is true now
because the parameter exists — not because it was written down. The header also
now states explicitly that `getTariffCoverage` is *not* scoped, so the absence
of a parameter reads as a decision instead of an oversight.

---

## 5. Deliberately not fixed, and why

- **Census row 104, `billing-enrichment.ts`** — mechanically identical to
  Fix 2 and safe, but it is a fourth surface in a commit that already changes
  three. Left as the next one to take, with its bucket now recorded as "safe to
  fix now" rather than "unknown".
- **The remaining 22 `missing-orgIdParam` gates** — the allowlist and its
  checker exist precisely so these are worked down deliberately rather than in
  a sweep nobody can review.
- **`check:work-view`** — red before this branch existed, proven in
  `2026-08-18-core-billing-integration-merge.md` §5.

---

## 6. Bootstrap and operator workflows

**Nothing platform-side moves.** `resolveOrgScope` returns `{ all: true }` for a
bootstrap session and for a `platform.tenant.read` grant, which maps to
`restrictToOrgIds: null` — the behaviour that exists today, now written out
explicitly instead of arrived at by falling through a switch. Asserted directly
in `ledger-scope.test.ts` ("leaves platform staff exactly as they were").

**The org-member path is widened, not narrowed.** The confinement is applied
*alongside* the requested scope rather than instead of it, so an org member's
per-charger, per-site and per-driver views keep answering — intersected with
their own orgs. That is the alternative path for the six UI surfaces that
consume the ledger, and it is tested in both files.

**One behaviour genuinely changes:** a caller with no memberships and no
platform grant used to receive the admin scope, i.e. every row. They now get an
empty allow-list, which matches nothing, and a `403` with a named reason on the
list route. 403 rather than an empty 200 — a caller who asked for another org's
rows and got zero back would reasonably conclude that org has no sessions,
which is itself a disclosure.

### Fool tests

| # | sabotage | result |
|---|---|---|
| 5 | disable the `restrictToOrgIds` branch in `buildLedgerWhere` | **5 of 18 tests failed.** Restored. |
| 6 | make `tenantWhere` always return `{}` in `billing-summary.ts` | **6 of 7 tests failed.** Restored. |

---

## 7. `check:orgid-param` allowlist

The allowlist did not shrink and should not have: both fixed routes still carry
`requirePermission("billing.read")` with no `orgIdParam`, and for
`/billing/sessions` an `orgIdParam` would be the wrong mechanism — the tenant
comes from the caller's memberships, not from a path parameter.

What changed is that two entries stopped asserting something false. Both read
`"billing.read — unscoped when this guard was introduced, 2026-08-11"`; they now
name the repository-level enforcement and the tests that hold it. An allowlist
whose reasons have gone stale is a list of 75 sentences nobody can trust, which
is the same failure as the file headers above.

`check:orgid-param` still passes at 75 allowlisted.
