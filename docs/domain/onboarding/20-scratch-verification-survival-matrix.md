# 20 — Scratch verification: what survived the compiler

The verification pass doc 19 §10 asked for. Twelve slices applied on a local
scratch branch, each type-checked and tested, most fool-tested. Eleven commits,
none pushed.

**Branch:** `scratch/claude-a-backend-verification-2026-08-09`, forked from
`e66a10c`. **Nothing was pushed, deployed or run against a database.**

## The baseline nobody had measured

Doc 19 said "no test suite runs in CI" and treated wiring one up as a
prerequisite of unknown cost. Measured on a clean `npm install` of this tree:

| | |
|---|---|
| `npx vitest run` | **49 files, 658 tests, 1 skipped — all green, 9.5s**, no DB, no network, no bindings |
| `npm run check` | **8 of 9 pass**; `work-view` **fails** |
| `npx tsc --noEmit -p apps/api` | clean |

Two things follow that the docs could only guess at.

**Adoption cost of the CI step is zero.** The suite is already green, so there is
no backlog of red tests to clear first. It is one line of YAML and ten seconds.

**But CI is already red, and has been.** `check:work-view` compares
`src/app/(app)/admin/work/page.tsx`, and that file **does not exist** — the whole
`(app)` console moved to `archive/straumvakt-org-console-2026-08-08/`. Verified
red at `e66a10c` too, so this predates every change here. Adding the test step
does not turn CI red; **CI is red already, and a red gate nobody looks at is not
a gate**. Resolving `work-view` is the real precondition, and it is a product
call — left untaken.

## Survival matrix

`Compile` = `tsc --noEmit -p apps/api` (and `npm run typecheck` across the
workspace where the change spanned packages). `Fool` = the guard was
deliberately broken to prove the test catches it.

| # | Slice | Files | Compile | Tests | Fool | Verdict | Cherry-pick |
|---|---|---|---|---|---|---|---|
| 1 | RFID: exclude reserved `08` prefix | `id-tokens.ts` +test | clean | 14 ✓ | ✓ | **apply-now** | yes |
| 2 | Additive permission provenance | `effective-permissions.ts` +test | clean | 72 ✓ | ✓ | **apply-now** | yes |
| 3 | S2 invite guard + status map + first test file | `invites.ts` +new test | clean | 680 ✓ | ✓ | **apply-now** | yes |
| 4 | No platform grant confers member admin | `effective-permissions.ts` +test | clean | 682 ✓ | n/a | **apply-now, with §"Reachability"** | yes |
| 5 | Support-context observation, both seams | `require-permission.ts` +test | clean | 686 ✓ | n/a | **apply-now** (shadow only) | yes |
| 6 | `npm test` in CI | `check.yml` | n/a | n/a | n/a | **apply after work-view** | yes |
| 7 | Converge `resolveOrgScope` + first tests | `org-scope.ts` +new test | clean | 695 ✓ | n/a | **apply-now** | yes |
| 8 | Derive exhaustive role lists | `permissions.test.ts` | clean | 45 ✓ | n/a | **apply-now** | yes |
| 9 | `IdToken.userId` nullable — ripple probe | 3 files | **clean** | 696 ✓ | control ✓ | **measurement only — reverted** | no |
| 10 | Static guard on invite ordering | new script, `check-all.mjs`, `package.json` | n/a | check ✓ | ✓ | **apply-now** | yes |
| 11 | Record password-route reachability change | `admin-users.ts` | clean | 696 ✓ | n/a | **apply-now** (comment only) | yes |
| 12 | Agreement / onboarding greenfield | — | n/a | n/a | n/a | **design-only, confirmed** | n/a |

Final state: **51 test files, 696 tests, 1 skipped, all green. tsc clean.
`npm run check` 9 of 10 — `work-view` still the only failure, unchanged.**

Net new tests: **658 → 696 (+38)**, across two files that had never had one
(`invites.ts`, `org-scope.ts`).

## Assumptions the compiler corrected

Ten. Four of them were mine, from doc 19.

**A1 — ND-2 was wrong.** Doc 19 claimed a minted `08`-prefixed RFID "can never
authorise", locking out ~1 in 256 drivers. It authorises fine:
`ocpp-authorize.ts:208-210` has `case "none": case "not_a_tap": break;` and falls
through to the IdToken lookup. The source comment at `random-uid.ts:62-66` said
so and was right. The real defect is narrower and different: because
`matchAndConsumeTapIntent` keys on **station and liveness, never the idTag**
(`tap-intents.ts:286-297`), such a card presented where another driver has armed
an intent **consumes it and misattributes the session**; with two live intents it
returns `ambiguous` and the charge is Blocked. Same fix, much lower severity.
**Severity downgraded from lockout to misattribution.**

**A2 — the E04 "type ripple" does not exist.** Doc 19 CS-24 said making
`IdToken.userId` nullable "breaks IdTokenRow/toSummary, IdTokenSummary.userId,
PrismaLike.idToken.findUnique and local-auth-list-push.ts:167 — not a one-file
change". Made nullable at **all three** layers (DTO, repository row type, and the
Drizzle column) and ran the full workspace typecheck: **zero errors**, and 696
tests still pass. Positive control run to prove the measurement was real —
`strict: true`, and a deliberate `string | null → string` assignment does fail.
So the code surface tolerates it completely. **The migration is still the
blocker; the refactor is not.**

**A3 — the predicted ordering breakage did not happen.** Doc 19 §3.6 flagged
`permissions.test.ts:211-250` as the merge gate, since it asserts on arrays and
the new resolver unions two independently-expanded lists. It passed untouched:
those tests drive the **pure** `effectivePermissions`, not the resolver.

**A4 — "three mocks" was overstated; one broke, and only on the second step.**
Adding the provenance function broke nothing. Adding an **import of it to
`require-permission.ts`** broke exactly one mock, loudly:
`No "resolvePermissionsWithProvenance" export is defined on the mock`, four tests
403 → 500. The two parity mocks were never touched because they stub
`resolveEffectivePermissions`, whose signature is unchanged — which was the point
of the additive design.

**A5 — "create, not upsert" is wrong as written.** `password_hash` is **nullable**
(`identity.ts:215`) and `clearUserPasswordHash` (`users.ts:381-386`) nulls it
while keeping the row. `create` would raise a unique violation on exactly that
row, turning an admin-initiated password clear into a 500. **The guard is the
control, not the write verb** — and the guard must test the column, not row
existence, or clearing a password becomes a permanent lockout.

**A6 — ND-1 is worse than reported.** Doc 19 framed it as a PII read. The same
file, same missing `orgIdParam`, also carries `PUT /:id/password` and
`DELETE /:id/password` on `member.write` — **an account-takeover primitive**, and
`sales_cs` reached `member.write` through the `.write` sweep in the expansion.
Not a disclosure bug; a full identity-compromise path.

**A7 — `assertPermission` has zero test coverage.** It was left calling a symbol
I had removed from the imports; **686 tests passed** while it was broken. Only
`tsc` caught it.

**A8 — vitest does not typecheck.** Twice: a test file passed vitest and failed
`tsc` on an untyped `globalThis.crypto`. `npm run check` (which runs tsc) would
have caught it; `npm test` would not. **The two gates catch disjoint failures**,
which is the real argument for wiring both — stronger than "more tests good".

**A9 — CI is red, not merely incomplete** (above). Materially changes the
sequencing of `IT-CI-01`.

**A10 — the `host_admin` omission was a coverage hole, not a masked bug.**
Deriving the role lists from the maps covers it and everything still passes.
Recorded as such rather than dressed up.

## Rollback and guard proofs run locally

Six, all reversible, all reversed.

| Proof | Method | Result |
|---|---|---|
| RFID guard | disabled the re-roll loop | 2 tests red → restored → green |
| Provenance predicate | rewrote as `viaPlatform.includes(verb)` | **exactly 1** test red — the both-membership-and-grant fixture, empirically confirming doc 19 §3.8 that every other fixture is blind to this bug |
| S2 ordering | moved the guard below the claim | 409 test **stayed green**, both ordering tests failed — a status-code-only suite would have shipped the deadlock |
| Static invite check | swapped claim above guard | check failed with the consequence spelled out; restored |
| E04 probe | 3 files changed, measured, `git checkout --` | tree clean, nothing committed |
| Stash incident | see below | fully reversed, nothing lost |

## One mistake, and how it was reversed

Checking whether `work-view` was red before my changes, I ran `git stash -u` →
`git checkout e66a10c` → back → `git stash pop`. My working tree was **clean**
(everything committed), so `git stash -u` created **no stash** — and the
subsequent `git stash pop` popped a **pre-existing stash belonging to
`feat/agreement-architecture`**, producing merge conflicts in three files and
scattering unrelated changes across the tree.

Reversed in full. A conflicted `pop` does **not** drop the stash, so both
pre-existing stashes (`post-enrichment-deploy-wip`, `wip-pre-staging-merge`)
survived intact — verified before touching anything. `git reset --hard HEAD`
restored the tree; all commits were already safe.

The lesson worth keeping: **`git stash` with a clean tree is a no-op that makes
the next `pop` operate on someone else's work.** Use a worktree or an explicit
`git stash push -- <paths>` instead. The check itself was worth running — it is
what established that `work-view` is red at `e66a10c` too.

## What must remain design-only

**Agreement and cost-factor writes.** Re-confirmed independently:
`.agreement.create|update|delete|upsert`, `agreementClause.*` and
`db.insert(agreements…)` return **zero matches** across `apps/api/src`. Building
this is a feature, not a fix, and it needs the two-cost-factor-tables decision
(`billing.cost_factors` vs `agreements.cost_factors`) resolved first.

**The onboarding aggregate.** `onboarding_workflow`, `onboarding_step`,
`support_contexts`, `session_attribution` and `tokenClass` return **zero
matches** across all `.ts`, `.prisma` and `.sql` outside `docs/`. Confirmed
greenfield.

**Support-context enforcement.** Shipped here as observation only, and it could
not be more: there is no `support_contexts` table to open a context in, and no
feature-flag store anywhere to gate the switch. Both are prerequisites.

**`IdToken.userId` nullable.** The code tolerates it (A2), but the DB migration
is one-way in effect and changes what a technical token means. Design decision,
not a refactor.

## Apply-now shortlist

In dependency order. Every one is green on this branch.

1. **Slice 1** (RFID) — isolated, no decision needed.
2. **Slice 8** (derived role lists) — pure test hygiene.
3. **Slice 2** (provenance) — additive, nothing consumes it yet.
4. **Slice 3 + 10** (S2 guard + its static check) — the Critical, plus the guard
   that keeps it fixed.
5. **Slice 7** (org-scope convergence + first tests).
6. **Slice 5** (support-context observation) — shadow only; produces the
   measurement that decides the rollout mode.
7. **Slice 4 + 11** (member-admin carve-out + the reachability note) — **needs
   the password-route decision first**; it closes an account-takeover path and
   denies a route real operators may still need.
8. **Slice 6** (`npm test` in CI) — **after** `work-view` is resolved.

## Reverting this branch

Nothing here is on `docs/singular-onboarding-domain-packet` except this file.
The scratch branch is local and has no upstream.

```
# inspect
git -C E:\Claude\Straumvakt-onboarding-domain log --oneline e66a10c..scratch/claude-a-backend-verification-2026-08-09

# take one slice
git cherry-pick <sha>

# discard everything
git branch -D scratch/claude-a-backend-verification-2026-08-09
```

The branch is **clean** — no uncommitted work. `node_modules/`,
`package-lock.json` and the generated Prisma clients were created by
`npm install` + `npm run db:generate`; all are gitignored, and deleting them
costs only a reinstall.

**Do not** `git stash pop` in this worktree: two stashes belonging to
`feat/agreement-architecture` sit at the top of the stack.
