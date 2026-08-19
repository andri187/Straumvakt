---
agent: claude-b
round: 3
lane: onboarding-an-org-to-invoiceable
status: complete
prompt: docs/agent-prompts/2026-08-18/2026-08-18-2055-claude-b-onboarding-an-org-to-invoiceable.md
follows: 2026-08-18/2026-08-18-1540-claude-b-production-definition-and-environment-path.md
start_utc: 2026-08-19T19:02:52Z
end_utc: 2026-08-19T19:30:26Z
wall_clock: 27m34s
target_wall_clock: none — deliverable-gated
target_met: null
worktree: E:\Claude\Straumvakt-relops-b
external_mutation: none
---

# Claude B — completion: onboarding an org to invoiceable

*Written incrementally and committed after each phase, per operating rule 8.*

## TL;DR

1. **An org cannot be walked from nothing to invoiceable without hand-editing
   the database.** Four of five steps work; **setting the flat-fee agreement
   has no write surface at all.**
2. **Kennitala capture already existed** — the dispatch's premise needed
   correcting. What was missing was *validation*: the field accepted any ten
   digits.
3. **Two charger findings**, one of which routes money to the wrong org.
4. **All three 2026-08-08 invite defects are fixed.** Task 13's `[BLOCKER]`
   should be lifted and restated.
5. **All 21 gates met, all 7 fallback items worked.** `npm run check` 14 green,
   **992 + 176 tests**.

---

## THE PLAIN STATEMENT THE DISPATCH ASKED FOR

> **Can an org today be walked from nothing to invoiceable without hand-editing
> the database?**

# No.

**Yes-with-these-manual-steps** is the honest long form:

| Step | Through the API? |
|---|---|
| Create org, set roles, capture kennitala | **yes** |
| Enrol a user | **yes** |
| Create site / installation | **yes** |
| Attach charger + full asset chain | **yes** |
| **Set the flat-fee agreement** | **NO — direct database write required** |

`apps/api/src/repositories/agreements.ts` exports three functions and all
three read. `GET /:orgId/agreements` is the only agreement route on an org. No
application file anywhere calls `agreement.create` — the only matches in the
tree are docstrings inside the generated Prisma client. The cost factor and
rate reference the flat fee needs **can** be created through the API; the
agreement that binds them to the org cannot.

---

## Phase 0 — start state

| | |
|---|---|
| Start / End UTC | `2026-08-19T19:02:52Z` → `2026-08-19T19:30:26Z` (**27 m 34 s**) |
| Branch | `scratch/claude-b-release-ops-2026-08-10` |
| Start tip → end tip | `a81860b` → **`da2d458`** (`36e28a1` was the last code commit; `da2d458` is this artifact) |
| `dev/market-rails` | `a81860b` → **`da2d458`** |
| Dirty start / end | 0 / 0 |
| `git diff` / `git diff -w` | empty / empty (both ends) |
| A's tip at my start | `dev/core-billing-integration` @ **`a84141e`** (moved to `e86718d` during the run; **not merged** — A owns that integration) |
| Diff across the run | **17 files, +2491 / −12** |

**Baseline before any edit:** `npm run check` **13 passed** · vitest root
**888 passed / 1 skipped** · gateway **176** · `tsc --noEmit` **0 errors**.

**CR-2: ABSENT.** The requests file does not exist in my worktree; on A's
branch it contains **only CR-1**, serviced in round 2. Nothing from A blocking.

---

## Gates — 21 of 21

| # | Gate | Result |
|---|---|---|
| 1 | CR-2 serviced or absence recorded | ✅ absence recorded, both locations checked |
| 2 | Baseline recorded before any edit | ✅ |
| 3 | Capture point decided and justified against invoice-time refusal | ✅ optional at creation, justified — a plausible wrong kennitala is worse than a null one |
| 4 | Storage contract: table, column, tenancy, read/write, list vs detail | ✅ |
| 5 | Validation with a named refusal | ✅ `kennitala_<problem>` codes |
| 6 | No valid kennitala in any fixture; positive-path approach documented | ✅ future-dated (2099-12-31), built at run time |
| 7 | Readiness naming what is missing, not a bare boolean | ✅ 13 named reasons, each with a remedy |
| 8 | ≥7 kennitala tests incl. cross-org read and list-vs-detail | ✅ **47 tests** |
| 9 | Surface walked per step with `file:symbol` citations | ✅ |
| 10 | Gap table with evidence | ✅ 10 rows |
| 11 | Charger attach analysed incl. already-owned case, reported as access-grant if permissive | ✅ **two findings**, one reported as access-grant class |
| 12 | Agreement write surface established or absence proven | ✅ **absence proven** |
| 13 | Operator script: ordered, exact action, verification per step | ✅ 6 steps, 2 hard stops |
| 14 | The two 2026-08-08 invite defects verified | ✅ **both fixed** (and the third, the hijack, also fixed) |
| 15 | Task 13 gap list with severity | ✅ 4 gaps, `[BLOCKER]` restatement proposed |
| 16 | Dry run offline, exit 0 on happy path | ✅ |
| 17 | ≥4 cases, non-happy exit non-zero with reason | ✅ **6 cases**, all verified |
| 18 | Readiness report printed in full in the artifact | ✅ below |
| 19 | Dry run asserts every precondition A's pipeline requires | ✅ **and goes further** — it constructs a real `InvoiceDocument` and renders its header |
| 20 | ≥4 fool-tests | ✅ **8 this round** |
| 21 | Completion `.md` + `.json`, committed incrementally | ✅ committed after each phase |

---

## The readiness report, in full

### Happy path — `npx tsx scripts/dry-run-onboard-org.mts --case happy` → exit 0

```
Case: happy — every onboarding step performed, in order

Org readiness — Dry Run Host

  OK    org exists
  OK    org is active
  OK    org roles set
  OK    legal name present
  OK    kennitala captured and valid
  OK    currency set
  OK    at least one user enrolled
  OK    at least one charger attached
  OK    connectors present in the asset chain
  OK    flat-fee agreement in force for the period

  INVOICEABLE — every precondition the billing pipeline requires is satisfied.

  Invoice contract check:
    ACCEPTED — document SV-2026-000001 constructed

    | Sölureikningur nr. SV-2026-000001
    |
    | KRÖFUHAFI
    | Straumvakt
    | Kt. FIXTURE-ID-STRAUMVAKT
    | VSK-númer kröfuhafa: FIXTURE-VSK-SV
    |
    | GREIÐANDI
    | Dry Run Host ehf.
    | Fixture Road 12
    | 200 Kopavogur
    | IS
    |
    | Tímabil: 2026-07-01 – 2026-07-31
    | Útgáfudagur: 2026-08-01  ·  Gjalddagi: 2026-08-15
```

### `--case no-kennitala` → exit 1

```
  OK    org exists · org is active · org roles set · legal name present
  OK    currency set · at least one user enrolled · at least one charger
  OK    connectors present · flat-fee agreement in force for the period
  HOLD  kennitala_missing
          no kennitala; the invoice header refuses to render without the
          claim holder's registered identity
          remedy: PATCH the org with kennitala — ask the host, it cannot be derived

  NOT INVOICEABLE — 1 hold(s).
```

**All six cases:** `happy` exit 0 · `no-kennitala` 1 · `invalid-kennitala` 1 ·
`no-chargers` 1 · `no-agreement` 1 · `no-user` 1. Self-test **6 of 6**.

---

## Findings

### 1. Kennitala capture already existed — the gap was validation

`tenancy.organizations.kennitala` is a real column
`[packages/shared/src/db/identity.ts:257]`; `OrgCreateInput`/`OrgUpdateInput`
already accepted it; `createOrg` persisted it `[repositories/orgs.ts:142]`.
**No migration was needed** — which mattered, because `apps/api/drizzle/**` is
A's lane.

**What was missing is worse than absence:** the field carried
`/^\d{6}-?\d{4}$/` and nothing else, which accepts **any ten digits**. A
transposed pair — the commonest typing error on a kennitala — was stored
silently and would surface months later as an invoice header naming nobody.
Round 2's `kennitalaProblems` existed and **nothing called it**. Now wired.

### 2. Charger attach — two findings

**3a — the `orgId` comes from the request body and is never checked against
the caller.** `requirePermission("charger.write")` is called with **no**
`orgIdParam`, which per the middleware's own contract makes it platform-only
`[lib/auth/require-permission.ts:27-31]`. **So this is NOT a tenant
escalation** — a host admin cannot reach the route. Stated plainly because the
shape looks like the invite-code class and is not. What it is: an
operator-error surface with no safety net.

**3b — the same charger identity can exist in two orgs, and the auth lookup
picks one arbitrarily. This one lands on money.**

- `ocppIdentities` is unique on **`(orgId, identityString)`**, not on
  `identityString` `[packages/shared/src/db/protocol.ts:66]`.
- `createCharger` does **no** existence check `[repositories/chargers.ts:507]`.
- The gateway auth lookup is `WHERE lower(identity_string) = lower($1) LIMIT 1`
  — **no org scope, no `ORDER BY`** `[routes/internal/ocpp-auth.ts:82-91]`.

The winning row's `orgId` is what the session, the CDR and the invoice line
are attributed to. **The trigger is an ordinary business event, not an
attack**: a charger moving between orgs. Reported as an access-grant finding
per the dispatch; **FOCUS Rule 5 applies, so nothing was changed.**

### 3. All three 2026-08-08 invite defects are fixed

Bearer-only hijack → ADR 0053, identity-bound, rejected *before* claiming so
the real recipient can still redeem. Invitee lockout → `POST
/api/driver/claim-invite` two-step, bounded by *"the bound user must NOT
already have a credential"*. Missing idToken → `createDriver` inserts a
`virtual_rfid`, *"the invariant the other four paths were missing"*.

**TASKS.md task 13's `[BLOCKER: invite codes are bearer-only]` should be
lifted** — but task 13 is not thereby unblocked. Proposed restatement:
`[BLOCKER: no agreement write surface; charger attach is platform-only]`.

### 4. A checksum-valid company kennitala is committed in this repo

`src/lib/org-tenant.ts` carries one 10-digit literal in the tenant registry.
Verified with this round's validator: **checksum-valid, company kind.** A
company kennitala is public business-register data — materially less sensitive
than a personal one — but it is a checksum-valid national id and the round's
rules name that category. **Reported by location; the digits are not
reproduced here, and nothing was changed** (it is load-bearing for tenant
matching).

### 5. WinAnsi is not Latin-1 — a real PDF bug, caught by reading the golden

The header's period line uses an EN DASH. Encoding the PDF as plain Latin-1
wrote byte `0x13`, a device control, into the invoice. WinAnsiEncoding puts
the en dash at `0x96`. Fixed; the sample PDF now contains `0x96` and no
`0x13`. **The argument for generating goldens rather than asserting them from
imagination.**

---

## Fallback queue — 7 of 7

| # | Item | Result |
|---|---|---|
| 1 | **PDF renderer** | ✅ dependency-free, deterministic, golden-tested, inherits every header refusal |
| 2 | **Wired into the delivery log** | ✅ fail-closed; render-before-attempt; a thrown provider is `unknown`, never `rejected` |
| 3 | Observability red-gate record | ✅ re-verified 9/3 unchanged; one delta — finding 3b now outranks OB18 |
| 4 | Re-verify the six CF facts | ✅ **all hold**; the seventh was already closed in round 2 |
| 5 | `ADMIN_PASSWORD` runbook | ✅ re-verified, **not performed**; scope is **three** Workers — `hlada-api` does not exist |
| 6 | `Straumvakt-core-security` | ✅ 0 dirty, 0 ahead, 0 unmerged; retirable; **not retired**; round-2 caveat now dropped |
| 7 | Round-3 release checklist | ✅ two new top blockers; the A-runbook seam made explicit |

---

## Checks

| Check | Result |
|---|---|
| `npm run check` | **all 14 passed** (was 13 — `onboarding` added) |
| `npx vitest run` (root) | **992 passed, 1 skipped, 63 files** (baseline 888) |
| gateway vitest | **176 passed** |
| `tsc --noEmit` | 0 errors |
| `check:onboarding` | 6 of 6 cases |
| observability gate | 9 errors, 3 warnings — unchanged |

**One correction to my own commit message:** `36e28a1` says "999 passed"; the
accurate figure is **992**. The number was written before the final run and
not re-checked. No code is affected.

---

## Commits — 3 slices

| SHA | Slice |
|---|---|
| `c7ad6f4` | kennitala validation + org readiness signal (Phase 1) |
| `b054bb5` | surface walk, task-13 re-enumeration, offline dry run (Phases 2–4) |
| `36e28a1` | PDF renderer + delivery wiring (fallback 1–2) |

---

## On the sensitivity — the handling specified

**No kennitala literal exists in any file I wrote.** The positive path needs a
value passing *both* checksum and date checks, and the format has no
well-formed-yet-unissuable slot — so any such value could belong to someone.
**The resolution is a future date:** `31/12/99` century `0` reads as
**2099-12-31**, valid and impossible to have been issued. Built at run time,
never printed, and asserted to appear in no output.

Specified handling: normalised on input (digits only); **never logged** —
validation issues are codes, not values; masked for display via
`maskKennitala` (`DDMMYY-****`); the readiness report and the tenant-violation
error both assert they carry no identifier; and the list projection masks it
while detail does not.

---

## External state confirmation

**No push. No deploy.** No DNS or domain binding. **No Cloudflare mutation —
every `wrangler` call read-only**, by verb: `deployments list`, `queues list`,
`r2 bucket list`. No `deploy`, `publish`, `put`, `create`, `delete`,
`rollback`, `versions upload`. **No Neon mutation. No migration. No SQL
against any environment.** No GitHub remote mutation. No charger, OCPP, BLE,
NFC or hardware action. **No account registered, no form submitted, no
application filed, no third party contacted.** **No real or checksum-valid
kennitala written anywhere.** No branch or tag deleted; no worktree retired.
**Nothing under A's owned paths touched** — `packages/commercial/**`,
`apps/api/src/lib/billing/**`, `apps/api/drizzle/**`,
`apps/api/src/routes/admin/billing/**` and `apps/api/src/routes/public/driver.ts`
were **read only**. Branches written to: `scratch/claude-b-release-ops-2026-08-10`
and `dev/market-rails`. **Neither pushed.**

Network: unauthenticated HTTPS GETs to public hostnames for `/health`.

---

## Next recommended actions

1. **Build the agreement write surface.** It is the single thing standing
   between an operator and a first invoice, and it blocks tasks 12 and 13
   equally.
2. **Decide the charger-identity uniqueness fix** — access-grant, so design
   approval first. A partial unique index on `lower(identity_string)` plus an
   `ORDER BY` on the auth lookup.
3. **Lift task 13's `[BLOCKER]` and restate it.**
4. **Wire `redactOrgIdentityForList` into `listOrgs`** — one line, already
   tested.
5. **Adopt `kennitalaProblems` in `inputs/orgs.ts`'s sibling schemas** —
   `register.ts` and `host-applications.ts` also take a kennitala and were not
   in this lane.
6. Answer Q1 from round 2 — it still decides the production option.
