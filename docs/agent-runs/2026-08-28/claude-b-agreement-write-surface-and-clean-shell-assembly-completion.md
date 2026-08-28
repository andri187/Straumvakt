---
agent: claude-b
round: 4
lane: agreement-write-surface-and-clean-shell-assembly
status: in-progress
prompt: docs/agent-prompts/2026-08-28/2026-08-28-1800-claude-b-agreement-write-surface-and-clean-shell-assembly.md
follows: 2026-08-18/2026-08-18-2055-claude-b-onboarding-an-org-to-invoiceable.md
start_utc: 2026-08-28T18:00:14Z
end_utc: TBD
worktree: E:\Claude\Straumvakt-relops-b
external_mutation: none
---

# Claude B — round 4: the agreement write surface and the clean shell

*Written incrementally and committed after every phase, per operating rule 7.*

---

## Phase 0 — start state

| | |
|---|---|
| Start UTC | `2026-08-28T18:00:14Z` |
| Branch | `scratch/claude-b-release-ops-2026-08-10` |
| Start tip | `7cc591e982985200c5e19b98fb318bdde5357e85` |
| `dev/market-rails` | `7cc591e` |
| Dirty | **0** |
| `git diff` / `git diff -w` | empty / empty |
| Drizzle migrations on branch | `0000_baseline.sql`, `0001_regular_talos.sql` — **as stated** |
| A's tip | `dev/core-billing-integration` @ **`8274256`** — the frozen commit, confirmed reachable from my repo |

### Baseline, before any edit — matches round 3's close exactly

| Check | Result |
|---|---|
| `npx tsc --noEmit -p apps/api` | **exit 0** |
| `npm run typecheck` | **0 errors** |
| `npm test` | **992 passed, 1 skipped** |
| gateway suite | **176 passed** |
| `npm run check` | **14 passed** |

**No deviation from round 3's close.** Nothing to report as a finding there.

### FINDING 0-A — the round's three governing documents are on no branch

The dispatch requires reading `docs/adr/0054-devices-placements-and-effective-dating.md`
in full, plus `docs/notes/2026-08-20-session-handover.md` §5/§6/§8 and
`docs/notes/2026-08-19-mdu-gap-check.md`.

**None of the three is committed anywhere.** Searched every local branch head
and A's frozen commit `8274256`: no ref contains `docs/adr/0054`. They exist
only as **untracked working-tree files in the canonical checkout**
`E:\Claude\Straumvakt`.

They were readable — that folder is read-only comparison, which permits
reading — so **this blocked nothing**. But an ADR that governs two lanes and
lives on no branch cannot be merged, reviewed or diffed, and the next agent to
look for it in git will not find it. Recorded so it can be committed.

### Phase 0 outputs

- `docs/notes/2026-08-28-round-4-schema-requests.md` created with a header and
  no entries, as required. Three entries appended during Phase 1.

---

## Phase 1 — the agreement write surface

**The blocker round 3 named is removed.** `agreements.ts` could read an
agreement and not make one; there are now thirteen operations that can.

### 1. Enumerated from the reads, before anything was built

Every operation is derived from a row interface that already exists, so the
write surface expresses exactly what the read surface shows and no more. The
mapping is exported as `OPERATION_PROVENANCE` and **asserted by a test** —
"we built what was already there" is only worth claiming if it can be checked.

| Operation | Derived from |
|---|---|
| `agreement.create` / `.amend` / `.terminate` | `AgreementDetail`, `.effectiveUntil` |
| `clause.add` / `.amend` / `.end` | `ClauseRow` |
| `driverGroup.create` / `.rename` / `.close` | `DriverGroupRow` |
| `membership.add` / `.remove` | `MemberRow` |
| `bearerRule.set` / `.change` | `BearerRuleRow` |

### 2. What "amend" means once a period has been priced

**A refusal with a named reason, never an update.** `amend_would_change_settled_period`
and `terminate_would_change_settled_period`. There is no force flag.

The remedy is **end-and-add** — close the clause at the next open instant and
add a new one from there — which is why `clause.end` and `clause.add` exist as
separate operations rather than being folded into `amend`. Tested both ways:
the refusal, and the remedy succeeding.

**And the guard refuses on `unavailable` too.** A settled watermark that cannot
be read is a reason to refuse, not a licence to proceed. That is ledger note 22
applied to a write path, where the cost of being wrong is an amended invoice
in someone else's books. Fool-test B removes exactly this.

### 3. Effective dating, and terminate-is-closing

Half-open `[from, until)` throughout. `until: null` is open-ended.
**Terminating closes an interval; nothing is ever deleted.** Membership
uniqueness is on the **interval**, not on `(group, user)` — which is the only
thing that makes move-out-then-move-in expressible, and it is tested.

Boundary semantics proven: the boundary instant belongs to the **later**
interval, so a move-out and a move-in at the same instant describe one
continuous tenancy with no overlap and no gap.

### 4. The bearer ladder — expressible in full, no wider

Not redesigned. `bearerRule.set` carries every field `BearerRuleRow` reads:
`factorCode`, `(scopeType, scopeId)`, `(audienceType, audienceId)`,
`bearerType`, `rateRefCode`, and the interval. `bearerRule.change`
**supersedes** — closes the old rung, opens a new one — because a rule that
priced a period is evidence of who owed what, and rewriting it changes history.

### 5. The default idTag is an ordinary group member

**No resolver branch, no nullable `userId`, no special case.** It is a token
registered as a user, put in a group under the installation agreement, with
that clause's bearer set to `org`.

**The proof is mechanical: `grep -i idtag packages/contracts/src/agreements/`
returns nothing.** The write surface expresses the case without a single
conditional naming it, which is what gate 7 asks for.

### 6–9. Ports, receipts, tenancy

Every write goes through `AgreementStorePort`. `FixtureAgreementStore` is the
test adapter; the Drizzle adapter is written at
`apps/api/src/repositories/agreements-write.ts` and **never executed**.

`mutation_receipts` on every mutating operation. **A missing idempotency key is
a refusal — one is never generated.** Generating a key defeats the mechanism
completely: the retry arrives with a fresh key and the write happens twice.
Fool-test A removes exactly this.

Tenancy on every operation. The cross-tenant test drives **all twelve
row-targeting operations from another tenant** and asserts every one refuses.

### The Drizzle adapter — and why it is a spec, not code

Two columns it needs do not exist. Rather than write an adapter that would not
compile, the file carries the exact parameterised SQL per operation plus a
`REQUIRED_SCHEMA` map naming what is missing, and every method throws with a
message pointing at the schema requests. **A partially working adapter invites
someone to wire it up and discover the missing columns at runtime against a
real database.**

Three schema requests filed, none blocking:

- **SR-1** — `agreements.clauses` needs `period tstzrange` + temporal key.
- **SR-2** — `driver_group_memberships` needs ADR 0054 item 5's interval.
- **SR-3** — `agreements.mutation_receipts` table.

### 10. The dry run now *proves* it, rather than asserting it

`scripts/dry-run-onboard-org.mts` no longer fabricates an agreement fact. Its
agreement step drives the **real `AgreementWriter`** over the fixture store and
derives readiness from the rows that surface actually produced. If the writer
refuses a clause, readiness holds — which is the behaviour worth proving.

**A real bug, caught by the dry run rather than by a test.** The first draft
used a floating promise chain on the assumption that a fixture store settles
synchronously. It does not: readiness read an agreement with **no clauses yet**
and reported `agreement_has_no_connector_rate`. Made properly async. Fool-test
D pins the failure mode so it cannot come back.

### Tests

**36 in `writer.test.ts`** (gate asked for 15), covering every case the
dispatch listed, plus **23** in the dry-run suite.

**Four fool-tests this phase:** generate an idempotency key; treat an
unavailable watermark as nothing-settled; delete a membership instead of
closing it; fire the agreement writes without awaiting them.

### Checks after Phase 1

`npm run check` **all 14 passed** · `npx vitest run` **1032 passed, 1 skipped**
(baseline 992, **+40**).

---

*Phases 2–6, §11 and §12 follow.*
