# Claude A — Core Billing Integration and Blocker Burn-Down

**Completion artifact.** Prompt:
`docs/agent-prompts/2026-08-18/2026-08-18-1415-claude-a-core-billing-integration-and-blocker-burn-down.md`

---

## TL;DR

Core billing is on `dev/core-billing-integration`, **merged with zero
conflicts**, and all twenty gates in §11 are met.

The three launch blockers are closed: money now leaves the API in aurar under a
name that says aurar; a CDR is attributed only to a driver the host actually
has; and generation decides what to write by natural key instead of by counting
rows. The flat-fee feeder is built and refuses rather than inventing a count.

**Four written claims were false and are corrected** — including the census's
own description of the cross-tenant hole, which named a mechanism the schema
makes unreachable while the real one needed no coincidence at all.

**Canonical `dev/straumvakt-org-relaunch` is red on `npm run typecheck` right
now**, for a reason this branch did not cause and has fixed in one line.

---

## Run facts

| | |
|---|---|
| Agent | `claude-a` |
| Status | complete — all 20 gates met |
| Start (UTC) | 2026-08-18T14:27:40Z |
| End (UTC) | 2026-08-18T15:25:00Z |
| Wall clock | **57 minutes** |
| Time target | **none this round** — the prompt is deliverable-gated |
| Worktree | `E:\Claude\Straumvakt-core-billing` |
| Branch created | `dev/core-billing-integration` (local only) |
| Start tip | `a615a52` on `scratch/claude-a-core-billing-2026-08-10` |
| End tip | `686f5af` |
| Dirty at close | **0** |
| Commits | 8 (1 merge + 7 own) |
| Files changed by own commits | 33 (+4,573 / −144) |
| Tests | 1,185 → **1,303 passing**, 1 skipped (+118) |

Reported without comparison because no target was set. The number is what it
is: the work was bounded by what can be done without a database, and every
phase that needed one produced a contract and a refusal instead of a guess.

---

## What landed, by phase

### Phase 1 — the merge

Branched from canonical `82c63ac` explicitly, merged
`scratch/claude-a-core-billing-2026-08-10`. `git merge-tree` was run first as a
dry run so a conflicted merge could be planned rather than fought; it was not
needed. **Zero conflicts** — the canonical commit is additions only
(`docs/OpenADR/**`, `tools/zaptec-test/**`) and collides with nothing.

- 185 files changed, +52,967 / −397.
- **Zero CRLF-only changes**: 185 files in `git diff --numstat`, 185 in
  `git diff -w --numstat`. Every commit was checked the same way before it was
  made.
- Journal coherent: `0002` present exactly once, no renumbering.
- Topology: 0 behind, 86 ahead of canonical.

**Finding — canonical is red on its own gate.** `82c63ac` added
`tools/zaptec-test`, a standalone Next app with its own tsconfig whose `@/*`
maps into its own `src/`. It is not an npm workspace, so
`npm run typecheck --workspaces` never checks it; but the root tsconfig
included `**/*.ts(x)` and excluded every other standalone tree *except*
`tools/**`. Result: 118 errors, **118 of 118 under `tools/`**. Proven not to be
merge damage — `git diff 82c63ac..HEAD` is empty for both `tsconfig.json` and
`tools/`. Fixed with the one line that list was always missing. **The fix
belongs on canonical too.**

### Phase 2 — the money-unit boundary

`docs/notes/2026-08-18-money-unit-boundary.md`.

The engine has computed in aurar since `compute-session-cost.ts`; a 649.88 kr
session is stored as `64988`. Three driver DTOs emitted that number in a field
called `costIsk`, and three readers each guessed differently.

**The fix is a rename, not a division.** Dividing on the server would have
fixed the number and broken the client that was already compensating —
silently, producing amounts 100× too small that still look like money. A client
reading `costIsk` now gets `null` and renders the "Not priced" state it already
implements. A missing field is visible on the first screen; a wrong number is
visible on the first dispute.

New `lib/billing/money-wire.ts` states the rule once and is the only door money
leaves through. It refuses non-integers and amounts beyond 2^53 rather than
shipping a plausible wrong one.

### Phase 3 — cross-tenant CDR attribution

`docs/notes/2026-08-18-cdr-tenant-attribution.md`. Call path traced as 15
file:symbol steps.

New pure `lib/billing/cdr-driver-resolution.ts`. A CDR is attributed only when
every matching candidate resolves to the same user, the token is usable
(*active* **and** not past `expires_at` — independent columns with nothing
keeping them in step), and that user is a member of the charger's org.
Otherwise: unattributed, with a named reason, carried out through the sync
report. A missing `chargerOrgId` throws, because that means the repository is
broken rather than the session being unattributable, and an operator's report
must not make those look alike.

### Phase 4 — double-billing

New pure `lib/billing/generation-idempotency.ts`. `requireIdempotencyKey`
throws on a missing, blank or whitespace-only key rather than generating one:
`?? crypto.randomUUID()` would make every retry a fresh generation, an
idempotency mechanism that guarantees the thing it was added to prevent.

`planGeneration` replaces `if (count > 0) skip-everything` with per-key
absence, and `persist.ts` now uses it.

**Every key the prompt named is present in `0002`**, and
`session_settlements.session_id` is a PRIMARY KEY — stronger than described,
not weaker.

### Phase 5 — tenant scoping

`docs/notes/2026-08-18-tenant-scoping-burn-down.md`. All 105 census rows mapped
into the prompt's five buckets, **nothing unclassified**; the eight `unknown`
rows were resolved by reading the source.

Three fixes, each with a test that fails when the scope is removed. The
mechanism throughout is a **required field**, not a convention: omitting
`restrictToOrgIds` is a compile error, which is what forced every existing
caller and test to state its tenancy.

The two mutually-deferring files are resolved: **the repository enforces**,
because it is the side that can be made impossible to forget. The route-side
rule was already written down once and was still not followed for four months.

### Phase 6 — the flat-fee feeder

`packages/commercial/src/core-billing/flat-fee.ts`. Prices come from rate
references resolved with `pickActiveRate` — the same window selection the
session resolver uses — so this is a second feeder into one engine, not a
fourth billing generation. `subscription.ts` still owns the cap arithmetic.

`per_connector` verified present in all four declarations and in migration
`0001`. No drift.

### Phase 7 — the preflight pack

`docs/notes/2026-08-18-migration-0002-preflight.md`, all eight required
sections plus a ninth. Nothing was executed and no database was connected to.

---

## Gates — §11, row by row

| # | gate | status |
|---|---|---|
| 1 | integration branch with the merge landed | **met** — zero conflicts, `686f5af` |
| 2 | boundary table covers every crossing site; rule stated once in source | **met** — 8 driver-facing + 12 operator-facing + 2 engine sites; rule in `money-wire.ts` |
| 3 | the passing test that pinned the aurar defect named and corrected | **met** — `driver-sessions.test.ts:246` |
| 4 | mobile patch as a diff + deploy hazard recorded | **met** — §5.2–5.5 of the money note |
| 5 | ≥ 8 money-value regression tests | **met** — 17 in `money-wire.test.ts`, 10 more through the endpoint |
| 6 | CDR path traced; org-scoped lookup **or** fail-closed guard | **met** — 15 steps; fail-closed guard (org-scoped lookup is impossible, see corrections) |
| 7 | ≥ 7 CDR tenancy tests incl. pre-Authorize | **met** — 16 pure + 6 through the importer |
| 8 | count-then-insert writers enumerated; idempotency implemented and tested | **met** |
| 9 | ≥ 5 double-billing tests | **met** — 6 scenario tests + 15 supporting |
| 10 | every census row in one of five buckets, none unclassified | **met** — 105/105 |
| 11 | ≥ 3 tenant-scoping fixes, each failing-when-removed | **met** — 3, plus the Phase 3 guard |
| 12 | mutually-deferring files resolved; lying header corrected | **met** — 3 headers + 1 stale comment |
| 13 | flat-fee generator against the agreements resolver | **met** — via `pickActiveRate` |
| 14 | ≥ 9 cap-arithmetic tests | **met** — 13 |
| 15 | rate lock-in proven; no-silent-zero proven | **met** |
| 16 | active connector/driver source decided; derived or contracted with a refusing endpoint | **met** — connectors derived, drivers refuse |
| 17 | plug-time contract and rejection defined | **met** |
| 18 | preflight pack, all eight sections | **met** — eight plus a ninth |
| 19 | ≥ 5 fool tests, each proving a real test fails | **met** — 7 run, 6 caught; the 7th is a finding |
| 20 | completion `.md` and `.json` at the header paths | **met** — this file and its sidecar |

---

## Checks

| check | baseline (`a615a52`) | close (`686f5af`) |
|---|---|---|
| `npx tsc --noEmit -p apps/api` | pass | pass |
| `npm test` | 68 files, 1,185 pass, 1 skip | **74 files, 1,303 pass, 1 skip** |
| `npm run typecheck` (6 workspaces) | pass | pass |
| `npm run check` | 11 / 12 | 11 / 12 |
| `check:orgid-param` | pass (75) | pass (75) |
| `check:work-view` | **FAIL — not mine** | FAIL — not mine |

**`check:work-view` proof it predates this branch:** none of the 77 scratch
commits touches any of its four inputs
(`git log dev/straumvakt-org-relaunch..HEAD -- TASKS.md WORKSPACE.md "src/app/(app)/admin/work/page.tsx" scripts/gen-work-view.mjs`
→ empty), and canonical has not touched them since the merge base either
(`git diff --stat 10c292b dev/straumvakt-org-relaunch -- <same>` → empty). All
four inputs are byte-identical to `10c292b` on both sides, so it fails
identically there. Left alone per the Phase 0 gate.

### Fool tests — 7 run

| # | sabotage | caught by |
|---|---|---|
| 1 | `toWireAurar` divides by 100 — the "fix the value, keep the name" mistake | **23 tests, 2 files** |
| 2 | drop the org term from the CDR membership check | **2 tests** |
| 3 | drop `orgId` from the importer's `membership.findMany` | **0 — by design; see below** |
| 4 | `planGeneration` ignores existing keys | **5 tests** |
| 5 | disable `restrictToOrgIds` in `buildLedgerWhere` | **5 of 18** |
| 6 | `tenantWhere` always returns `{}` | **6 of 7** |
| 7 | cap boundary `>` → `>=` | **5 tests, 2 files** |

**Fool test 3 is the informative one and it is reported as a non-catch on
purpose.** The SQL narrowing is *not* the guard — the pure resolver re-checks
membership against `chargerOrgId`, so removing the SQL term changes how many
rows are fetched, not who gets billed. That is the intended shape: the decision
lives where it cannot be forgotten by someone editing a query. The term stays
because FOCUS rule 5 says `org_id` in every query.

---

## Important corrections to earlier assumptions

### 1. The cross-tenant CDR hole is not a token collision

The 2026-08-11 census recorded it as *"a token collision across tenants bills a
foreign driver."* Measured against the schema:
`identity.id_tokens.value` is **globally `@unique`**, so two orgs cannot hold
the same value and that collision is **unreachable**. The table also has **no
`org_id` column at all**, so "add the missing org filter" does not describe an
available fix.

The reachable failure is worse because it needs no coincidence: the lookup
never asked whether the driver had *any* relationship with the host, so an
ordinary visiting driver from another org was attributed on this org's ledger
row. The fix is therefore a membership check, not a column filter.

### 2. The Flutter client was not uniformly compensating

The prompt states the client divides `costIsk` by 100. True of
`DriverHistorySession`; **false of `ActiveSession`**
(`active_session.dart:208,290`), which renders the same server field with
`toStringAsFixed(0)` and no division. The client was inconsistent with itself,
and the in-flight cost is **100× too large in production today** even with the
new history screens applied. That improves the deploy sequencing: the rename
makes that screen show nothing rather than something false.

### 3. `per_connector` is not ahead of the column

`packages/commercial/src/agreement/types.ts` still said the Postgres enum *"does
NOT yet carry this value... the union is ahead of the column on purpose."* That
stopped being true in `19bb4ef`, the very commit that added it — deliberately
atomic across all four declarations, shipping
`0001_regular_talos.sql` (`ALTER TYPE "agreements"."RateBasis" ADD VALUE
'per_connector';`) with it.

### 4. A subscription line cannot be stored as a settlement component

The prompt asks the flat-fee feeder to produce *settlement components and*
statement lines. Statement lines are fine — `StatementLineKind` carries
`subscription_connector`, `subscription_driver` and `cap_relief`. Components
are not: `RateComponentKind` is only `dso | retailer | cpo_addon`, and
`settlement_components.session_id` is `NOT NULL` while the flat fee has no
session. `settlement_holds.session_id` is `NOT NULL` too, so a **period-level
hold has no row to be**. Recorded as deltas 9.2–9.4 of the preflight pack; the
generator's hold reasons are deliberately a flat-fee union and not
`ReviewReason`, because only `manual_hold` could receive them and writing that
for a machine refusal would be a lie of exactly the kind this codebase has been
paying for.

### 5. My own errors, three

- **`planGeneration`'s ambiguity check could never fire.** The first
  `cdr-driver-resolution` implementation keyed matched tokens into a
  `Map<string, CdrTokenRow>`, so two rows sharing a value collapsed and the
  ambiguity case silently resolved to one user. Caught by my own test, fixed to
  `Map<string, CdrTokenRow[]>`. `value` being `UNIQUE` today would have hidden
  it in production indefinitely.
- **I used PowerShell to rewrite a source file** and double-encoded its UTF-8,
  which is the exact failure my own standing note warns against. Caught
  immediately, file rewritten with the proper tool, encoding verified clean
  across all touched files before committing.
- **A `−0` in a test** modelling Dart's `num.round()` in JS. Not a money bug —
  Dart ints have no negative zero — but the test asserted an artefact of my
  model rather than a property of the code, and now says so.

---

## Deliverables not completed

None from §11. Deliberately deferred, each recorded in a note:

- **Census row 104 (`billing-enrichment.ts`)** — mechanically identical to the
  summary fix and safe, but a fourth surface in a commit that already changed
  three. Bucket now recorded as "safe to fix now" rather than "unknown".
- **The 22 remaining `missing-orgIdParam` gates** — the allowlist and its
  checker exist so these are worked down deliberately.
- **The fallback queue (§12)** was not reached. §11 consumed the run.

---

## External state

**Nothing changed outside this worktree.**

No push. No deploy. **No migration applied to any database** — `0002` remains
generated and unapplied. No SQL executed against any environment. No Cloudflare,
Neon or GitHub mutation. No charger command, no BLE/NFC, no hardware. No branch
or tag deleted; `scratch/claude-a-core-billing-2026-08-10` still points at
`a615a52` and `dev/straumvakt-org-relaunch` at `82c63ac`. No `git clean`, reset,
rebase, amend or force. No new top-level folder under `E:\Claude`. No secret,
token value, idTag or connection string was printed, logged or committed; every
token value in every fixture is synthetic.

**The only branch created is the local `dev/core-billing-integration`.** The
only files written into the canonical checkout are this artifact and its JSON
sidecar.

---

## Cleanup candidates created

None. Seven commits on one new local branch, worktree clean.

---

## Next recommended action

**Three things, in this order.**

1. **Carry the `tools/**` tsconfig fix to canonical.** `npm run check` is red
   on the mainline right now and nothing in the billing lane caused it.
2. **Decide the mobile patch.** The Phase 2 API change must not reach an
   environment the Flutter app talks to until §5.2–5.4 of the money-unit note
   lands. The patch is written as a diff and needs an owner.
3. **Read §9.6 of the preflight pack before authorising the apply.** Applying
   `0002` does not make an invoice possible — it makes the tables exist.
   `reports.connector_activity_month` and `driver_activity_month` are created by
   it and have **zero writers**, so the flat-fee feeder has no count source and
   every period holds. That gap, not the migration, is what stands between here
   and customer 1's first invoice.

And one decision that is only Andri's: **what makes a driver "active".** The
locked definition is "charging **or reporting** activity", and reporting
activity has no persisted event of any kind. `deriveActiveDrivers` refuses
rather than returning the charging-only count, because at 50 kr per driver per
month the shortfall would be invisible on the invoice that omits it. Narrowing
the definition to charging activity is a one-line change here and a commercial
decision there.
