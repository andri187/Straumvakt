---
agent: claude-b
status: ready
round: 4
lane: agreement-write-surface-and-clean-shell-assembly
created_utc: 2026-08-28T18:00:00Z
worktree: E:\Claude\Straumvakt-relops-b
branch: scratch/claude-b-release-ops-2026-08-10
integration_branch: dev/market-rails
start_tip: 7cc591e
note_on_branches: the worktree is checked out on the scratch branch; both it and dev/market-rails are at 7cc591e. Commit where you committed in round 3 and integrate as you did then. Do not re-point the worktree.
follows: 2026-08-18\2026-08-18-2055-claude-b-onboarding-an-org-to-invoiceable.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-b-agreement-write-surface-and-clean-shell-assembly-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-b-agreement-write-surface-and-clean-shell-assembly-completion.json
target_wall_clock: none — deliverable-gated. This is a deliberately long round; §12 exists so the queue does not empty.
external_mutation_allowed: false
very_tldr: Build the agreement write surface that has never existed, make membership and identity resolution ask "valid when?" instead of "does it exist?", then assemble the money engine and the rails into one tree for the first time and run both dry runs there.
---

# Claude B Prompt — The Agreement Write Surface and the Clean Shell in One Tree

You are `claude-b`. Execute only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude B here.
Verify this header says `agent: claude-b` and `status: ready` first.

This is **round 4**. Round 3 completed 21 of 21 gates plus 7 of 7 fallback and
left the branch clean at **`7cc591e`**. Nothing is superseded.

---

## 0. Operating rules

1. Work only in `E:\Claude\Straumvakt-relops-b`. The worktree is checked out on
   **`scratch/claude-b-release-ops-2026-08-10`**, which is where round 3
   committed; **`dev/market-rails` is the integration branch** and both are at
   `7cc591e`. Keep that arrangement — commit on the scratch branch, integrate
   into `dev/market-rails` as you did in round 3, and add the assembly branch
   from Phase 4. Other `E:\Claude\Straumvakt*` folders are **read-only
   comparison**.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; DNS or domain binding; any
   Cloudflare, Neon or GitHub **mutation** — read-only `wrangler` verbs only;
   running any migration against any database; live SQL against any
   environment; production or staging personal rows; charger commands;
   BLE/NFC; hardware. **Registering, submitting to or contacting any third
   party — a bank, a vendor, the tax authority, Zaptec — is explicitly
   forbidden.**
4. **Permitted:** local commits, local branch creation, and local merges. **No
   push.**
5. No `git clean`, delete, prune, reset, rebase, amend, force, branch deletion,
   stash drop or worktree retirement.
6. **Line endings are settled.** `core.autocrlf` is `true` at system level.
   Propose nothing, run nothing, add no `.gitattributes`.
7. **Write the completion artifact incrementally and commit it after every
   phase, and after every fallback item.** Ledger note 16. Not optional.
8. **No wall-clock target — and this round is explicitly long-running.**
   Deliverable-gated by §10, then §11, then §12. **Do not stop when the gate
   table is full.** The run ends when §12 is exhausted or Andri stops you.
9. **If you are resumed after an interruption, do not restart.** Read your own
   completion artifact, find the last committed phase, and continue from the
   next unmet gate. Ledger notes 19–20.
10. **Never idle on a decision that is Andri's.** Every phase has an offline
    path. Where a decision is required, implement the option you argue for
    behind a named switch, document the fork, and continue.
11. Record start and end UTC and actual wall clock, with no target comparison.
12. **Kennitala handling.** This round touches agreements and national
    identifiers. No real or checksum-valid ten-digit value in any fixture, log,
    export, test or commit — a checksum-valid string is indistinguishable from
    a real person's national id. The convention your own `fixtures.ts`
    established stands.

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4**, and **read
`docs/adr/0054-devices-placements-and-effective-dating.md` in full before
Phase 2.** Its decisions 3, 4 and 5 govern half this round even though you
write no schema.

### The five framing corrections — these override older notes

From 2026-08-20:

1. **Fresh start. Nothing legacy is required. No backfill.**
2. **The restart exists because of database hardwiring, useless APIs, and
   multiple workflows for one purpose.** Phase 5 is the third of those, and it
   has already reproduced inside the clean shell.
3. **The dweller is the billable party. There is no apartment abstraction.**
   The MDU org holds the meter and pays the utility; Straumvakt bills dwellers
   on the org's behalf. Do not resurrect `BillObject` for the MDU line.
4. **Straumvakt never holds money.** The host is the kröfuhafi and Straumvakt
   operates their claims as agent — a per-host onboarding step, not a
   Straumvakt bank registration. No remittance ledger, no client account.
5. **Legacy data is reference data.** Never size a decision with a legacy
   figure, and **never reconstruct a fault from a data gap** — the May–August
   auth gap was a deliberate setting, not an outage.

Also withdrawn in place: §4.1 of `docs/notes/2026-08-19-mdu-gap-check.md`, the
apartment framing. The rest of that document stands.

### Lane boundary — round 4, by path

Claude A is working **ADR 0054 in the schema** in parallel, in
`E:\Claude\Straumvakt-core-billing`. The split is by path and it is strict.

| You own | A owns |
|---|---|
| `packages/contracts/**` | **`apps/api/drizzle/**` — every migration this round** |
| `apps/api/src/lib/zaptec.ts` and the vendor importer | **`packages/shared/src/db/**` — the Drizzle schema** |
| `apps/api/src/repositories/agreements*`, `onboarding*`, `zaptec-*` | `packages/commercial/**`, `apps/api/src/lib/billing/**` |
| `apps/api/src/routes/**` *except* `admin/billing/**` | `apps/api/src/repositories/activity-month*`, `chargers.ts` |
| `apps/api/src/routes/internal/ocpp-authorize.ts` | **new:** `repositories/devices.ts`, `placements.ts` |
| `gateway/**`, all `wrangler` configs | `scripts/dry-run-first-invoice.mts` |
| `scripts/analysis/**`, `scripts/dry-run-onboard-org.mts` | |

**You generate no migration this round.** `dev/market-rails` carries `0000` and
`0001` only; it has never seen `0002` or `0003`. A migration generated here
would be numbered `0002` and collide destructively at assembly. **This is not
negotiable and it is not a blocker** — every phase below is exercisable over a
port with a fixture adapter.

**The cross-lane channel.** When you need schema, append `SR-n` (schema
request) to a new file on your branch:

```
docs/notes/2026-08-28-round-4-schema-requests.md
```

One entry per request: what table or column, what constraint, why, which of
your phases is blocked, and whether a fixture lets you proceed meanwhile.
**Append, never rewrite an earlier SR.** A reads it at every phase boundary
with `git show dev/market-rails:docs/notes/2026-08-28-round-4-schema-requests.md`
and services or refuses it in writing. **Do not wait on an SR** — write the
fixture adapter and keep moving.

---

## 1. Where you left off — verified, not assumed

`dev/market-rails` at **`7cc591e`**, clean. Round 3: 21 of 21 gates plus 7 of
7 fallback, **992 root + 176 gateway tests, `npm run check` 14 green.**
Verified 2026-08-28 by the coordinator:

- `apps/api/src/repositories/agreements.ts` exports **three functions and all
  three read**: `listAgreementMembershipsForUser`, `listAgreements`,
  `getAgreementDetail`. Plus seven row/detail interfaces. **Nothing writes an
  agreement, a clause, a bearer rule, a driver group or a membership.**
- Your own round-3 artifact states it plainly, and it is the premise of
  Phase 1: *"An org cannot be walked from nothing to invoiceable without
  hand-editing the database: four of five steps have an API surface, but
  setting the flat-fee agreement has none — `agreements.ts` is read-only and
  nothing calls `agreement.create`."* Nobody is permitted to hand-edit the
  database, so that sentence is the whole blocker.
- Your other round-3 finding is now ADR 0054's problem statement: identities
  are unique per `(orgId, identityString)` while the auth lookup is an
  **unscoped `LIMIT 1` with no `ORDER BY`**, which routes a charger's energy to
  an arbitrary org. Phase 3 is the fix.
- `apps/api/src/routes/internal/ocpp-authorize.ts` exists with its test.
- `gateway/src/liveness-sweeper.ts` is **exactly 266 lines with 31 tests**, and
  nothing outside its own test imports it — confirmed by name search on your
  branch. Confirm it yourself before wiring anything.
- `scripts/dry-run-onboard-org.mts` is yours; `scripts/dry-run-first-invoice.mts`
  is A's. **Neither branch has ever contained both.**
- `apps/api/drizzle/` on your branch: `0000_baseline` and `0001_regular_talos`
  only.

---

## 2. Primary objective

**Two things that have never existed: a way to write an agreement, and the
clean shell in a single tree.**

Ordered:

1. The agreement write surface. The money engine refuses to price an org with
   no billable clause, correctly — and there is no way to give it one except by
   hand in SQL, which nobody may run.
2. Validity replaces existence. ADR 0054 items 8 and 9: identity and membership
   resolution ask *when*, not *whether*.
3. **Assembly.** A has the money engine and no PDF, delivery or onboarding; you
   have those and no `core-billing`. Nothing is provable end to end until they
   are in one tree.
4. The duplication verdict. Two delivery state machines, two document models,
   two active-connector derivations, ~3,500 LOC across 13 orphaned modules.
   **Pick one of each before the fresh schema is generated.**
5. The Dalvegur re-onboard rehearsal — offline, so the real one is a runbook
   and not a discovery exercise.

Ledger note 21: build over a port, test against a fixture, write the Drizzle
adapter and never execute it. Ledger note 22: absent rows are `unavailable`,
never zero — no method you add may express "I looked and found nothing" as a
`0` or a `false`.

---

## 3. Phase 0 — Start-state verification

- Branch, start tip, dirty state, `git status --porcelain` counts.
- `git diff --shortstat` and `git diff -w --shortstat`, both.
- Baseline **before any edit**: `npx tsc --noEmit -p apps/api`,
  `npm run typecheck`, `npm test`, `npm run check`, and the gateway suite.
  Record the numbers. **Any deviation from round 3's close is a finding.**
- Read ADR 0054 in full, and `docs/notes/2026-08-20-session-handover.md` §5,
  §6 and §8.
- Record A's tip (`8274256` at dispatch). **Confirm it before Phase 4** —
  Phase 4 merges the frozen commit `8274256`, **not** `dev/core-billing-integration`'s
  head, so A's round-4 work cannot land in your tree mid-run.
- Create `docs/notes/2026-08-28-round-4-schema-requests.md` with a header and
  no entries. A reads it whether or not it has content.

---

## 4. Phase 1 — The agreement write surface

An org reaches *invoiceable* only with an agreement in force carrying at least
one billable clause. `agreements.ts` can read one and cannot make one.

Required:

1. **Enumerate the write operations before writing any**, from the read
   interfaces that already exist: agreement create, amend, terminate; clause
   add, amend, end; driver group create, rename, close; membership add, remove;
   bearer rule set and change. For each, say what "amend" means when the
   agreement has already priced a closed period. **FOCUS rule 4: money is
   derived from the record and never rewritten**, so an amendment that would
   change a settled period is a refusal with a named reason, not an update.
2. **Effective dating is the model, per ADR 0054 decision 4.** A clause and a
   membership are dated. **Terminating is closing an interval, never a delete**
   (decision 13's principle, applied outside placements). Memberships are
   closed, never deleted, and the uniqueness is on the interval — which is what
   makes move-out then move-in expressible at all.
3. **The bearer ladder is not to be redesigned.** Whatever
   `docs/architecture/straumvakt-charge-to-invoice.svg` and the existing
   `BearerRuleRow` encode is the ladder; the write surface must be able to
   express every rung it already reads, and no more.
4. **The default idTag is an ordinary token, not a special case.** Register it,
   put it in a group under the installation agreement, set that clause's bearer
   to `org`. **No resolver branch, no nullable `userId`.** It counts as one
   active driver; excluding it is a group question. Prove the write surface can
   express exactly this without a single conditional naming it.
5. Over ports. Fixture adapter for tests; Drizzle adapter written and never
   executed. `mutation_receipts` on every mutating operation — a missing
   idempotency key is a **refusal**, never a generated one.
6. Tenancy on every operation, FOCUS rule 5.
7. **Extend `scripts/dry-run-onboard-org.mts`** so an org goes from nothing to
   *invoiceable* offline, including the agreement, in one run. This is the
   proof, not the tests.
8. Tests: at least fifteen. Create; create twice with the same key; amend a
   clause on an open period; amend a clause that priced a closed period
   (refused, named); terminate; terminate twice; a clause with no bearer; two
   clauses overlapping in time; a membership added mid-period; a membership
   removed mid-period; the default idTag as a group member; cross-tenant on
   every write.
9. Fool-tests: at least two, each proving a named test fails when a guard goes.

---

## 5. Phase 2 — Item 9: validity replaces existence

**ADR 0054 item 9: the membership check moves from existence to validity** —
`WHERE period @> session.started_at`. **Five other call sites share the shape.**

Required:

1. Find every call site. The handover says five besides the primary; report the
   real number — if it is not five, that is a finding, and correcting the
   coordinator's count is welcome.
2. Convert each, over this port. The signature is locked and appears verbatim
   in A's prompt:

```ts
export interface MembershipValidityPort {
  isMemberAt(groupId: string, userId: string, at: Date): Promise<Evidence<boolean>>;
  membershipsOverlapping(
    groupId: string,
    period: { from: Date; until: Date | null },
  ): Promise<Evidence<MembershipRow[]>>;
}
```

`Evidence` follows round 3's convention: absent is `unavailable`, **never
`false`**. A membership that cannot be resolved is not a non-membership, and on
an invoice those two look identical while only one is honest.

3. **A session is priced against the membership valid when it started**, never
   against the membership current at billing time. Decision 6: sessions are
   sealed.
4. Tests: at least ten, including a driver who left mid-period, a driver who
   joined mid-period, a driver who left and rejoined, a session exactly on the
   boundary instant (half-open: `[from, until)` — the boundary belongs to the
   later interval, prove it), and an unresolvable membership producing
   `unavailable` rather than a refusal to bill or a silent exclusion.
5. Fool-test: restore an existence check at one call site and prove a named
   test fails.

---

## 6. Phase 3 — Item 8: the resolution chain, and the auth switch

**Item 8: `ocpp-authorize.ts` resolves identity → open `device_identity` →
device → open `placement` → installation.** One more hop, **the same
verdicts.** The verdict set does not change in this round; if you believe it
must, that is an SR and a written argument, not a quiet edit.

The gateway resolves a connection today with
`WHERE lower(identity_string) = lower($1) LIMIT 1` — no org scope, no ordering.
Two orgs holding one serial makes the winner undefined, which routes a
charger's energy to an arbitrary host. That is what this hop fixes.

Required:

1. Implement over this port, locked and shared with A:

```ts
export interface PlacementResolverPort {
  resolveIdentity(
    identityString: string,
    at: Date,
  ): Promise<Evidence<{
    placementId: string;      // the stable public id — OCPI's EVSE.uid
    deviceId: string;
    orgId: string;
    installationId: string;
    circuitId: string | null;
    siteId: string;
  }>>;
}
```

An identity with no open placement is `unavailable`, **not** a rejection and
**not** an arbitrary pick.

2. **Ambiguity must be impossible to express, and if it arrives anyway it is a
   refusal.** Two open placements for one device cannot exist once A's temporal
   key lands; until it does, your adapter must refuse rather than take
   `LIMIT 1`. Test that explicitly.
3. **`enforceAuthorize` and the default idTag are one change.** The handover
   records that `enforceAuthorize` defaults false and the gateway replies
   `Accepted` regardless, and that it cannot be switched on until the default
   idTag is registered. **That is a handover finding, not a verified one** —
   the coordinator confirmed only that `enforceAuthorize` is an installation
   field read in `agreements.ts` and `chargers.ts`, one of which sets it `true`
   on a path. **Verify the default and the gateway's behaviour yourself before
   asserting either.** Two of the last three rounds contained a dispatch
   premise that turned out to be wrong; this is the candidate in this one.
   Then deliver the ordered,
   reversible sequence — register the token, place it in the group, set the
   bearer, then flip the flag — with the abort condition at each step and what
   an operator sees if it goes wrong. **Design and prove offline. Change no
   live setting, and issue no `updateChargerSettings` call.**
4. Tests: at least ten, including identity resolved at an instant inside a
   closed placement (resolves to the host who held it *then*), identity with no
   placement, identity present on two devices, the same identity reused at one
   site across a unit swap, and a device moved between orgs.

---

## 7. Phase 4 — Assembly: the clean shell in one tree

**The clean shell has never existed in one tree.** This is the phase that ends
that, and it is the highest-value thing in either lane.

Required:

1. Create `dev/clean-shell-assembly` **from `dev/market-rails` at `7cc591e`**.
   `dev/market-rails` itself is not to be moved by the merge.
2. Merge the **frozen commit `8274256`** — the literal SHA, never the branch
   head. A is committing to that branch throughout this round; merging its head
   makes your result unreproducible and imports half-finished schema work.
3. Expect it to be less painful than it looks: A's branch already contains your
   round-2 tip (`a81860b` was re-merged into core-billing at A2a). The genuine
   conflicts should be your round-3 work on top.
4. **Resolve every conflict in favour of the owning lane** per the round-3
   boundary, and record every resolution in the artifact — file, side taken,
   why. A resolution you cannot justify in one sentence is a finding.
5. Get the assembled tree green: typecheck, the full test suite, `npm run
   check`, the gateway suite. **Report the assembled totals** — they will not
   be the sum of the two branches, and the difference is information.
6. **Run both dry runs in one tree, in sequence:** `dry-run-onboard-org.mts`
   takes an org from nothing to invoiceable; `dry-run-first-invoice.mts` then
   issues against it. **This is the first end-to-end proof the project has
   ever had.** Print the result. If the handoff between them does not exist —
   if the onboarded org cannot feed the invoice run — **that gap is the single
   most valuable finding of round 4**, and naming it precisely is worth more
   than papering it over.
7. No push. The assembly branch stays local.

---

## 8. Phase 5 — The duplication verdict

Correction 2: the restart exists partly because there were **multiple workflows
for one purpose**. Round 3 reproduced exactly that inside the clean shell.

Named in the handover: **two delivery state machines, two document models, two
active-connector derivations, and ~3,500 LOC across 13 orphaned modules.**

Required, on the assembly branch where both copies are finally visible at once:

1. Inventory each pair: file, LOC, tests, callers, which lane wrote it, and
   what each does that the other does not.
2. **Pick one of each, and justify the pick** on capability, not authorship or
   recency. Where the two are genuinely complementary, say what the merged one
   must do rather than keeping both.
3. **Retirement plan, not deletion.** What must exist before the loser goes,
   what parity coverage each surface needs, and the ordered steps. **Delete
   nothing this round.**
4. The 13 orphaned modules: for each, one line — retire, wire, or keep with a
   named future caller. `liveness-sweeper.ts` is the clearest case: 266 lines,
   31 tests, zero callers, and the AMS module is what should consume it.
5. Deliver as `docs/notes/2026-08-28-duplication-verdict.md`.

---

## 9. Phase 6 — The Dalvegur re-onboard rehearsal

The real re-onboard writes the first placements and **must not happen until ADR
0054 items 1–6 land**. It is not this round. The rehearsal is.

Required:

1. Rehearse it entirely offline against fixtures. **No Zaptec API call, no
   socket, no database.**
2. The estate is the known one and does not need re-deriving: 20 active
   chargers, 15 deactivated, 35 in the portal, **30 rows in our database**. Two
   things follow and both are yours. **Both were verified 2026-08-28:**
   `listChargers` in `apps/api/src/lib/zaptec.ts` returns `json?.Data ?? []`
   and reads no `Pages` field at all — its own docblock says *"Pagination is
   via the `Pages` envelope Zaptec returns; default page size is large enough
   for typical fleets so we don't paginate yet"*, which is an assumption
   nobody has tested against 35 chargers. And `Active` is declared on
   `ZaptecChargerLite` and discarded downstream. Fix the pagination — honour
   the envelope, and say what the real count is — and persist the four
   vendor-config fields through A's locked port:

```ts
export interface VendorConfigObservation {
  deviceId: string;
  observedAt: Date;
  chargerActive: boolean | null;
  authenticationType: number | null;
  isAuthorizationRequired: boolean | null;
  ocppDefaultIdTag: string | null;   // a token, never a person
}

export interface VendorConfigSinkPort {
  record(o: VendorConfigObservation): Promise<{ status: 'recorded' | 'unchanged' }>;
  latestFor(deviceId: string): Promise<Evidence<VendorConfigObservation>>;
}
```

3. **The fleet is `AuthenticationType = 2` (Ocpp) uniformly** and driver auth is
   off per-charger via `IsAuthorizationRequired`. That is a setting, not a
   fault — correction 5. Record it; do not diagnose it.
4. Deliver `docs/notes/2026-08-28-dalvegur-re-onboard-runbook.md`: the ordered
   sequence, a stop point at every irreversible step with its abort condition,
   what is verified before continuing, and the explicit precondition that items
   1–6 have landed and been applied. Cross-reference A's
   `docs/notes/2026-08-18-first-invoice-operator-runbook.md` so the two do not
   contradict each other on ordering.
5. State how many placements the real run will write, and for which devices.

---

## 10. Completion gates — done when all are true

| # | Gate |
|---|---|
| 1 | Baseline recorded; any deviation from round 3's close reported as a finding |
| 2 | `docs/notes/2026-08-28-round-4-schema-requests.md` created in Phase 0; every SR appended, never rewritten |
| 3 | Write operations enumerated from the existing read interfaces before any is built |
| 4 | Amendment that would change a settled period is a refusal with a named reason |
| 5 | Clauses and memberships effective-dated; terminate closes an interval, never deletes |
| 6 | The bearer ladder expressible in full, and no wider than it already reads |
| 7 | The default idTag expressed as an ordinary group member — **no resolver branch, no nullable `userId`** |
| 8 | Every write over a port; Drizzle adapter written and never executed |
| 9 | `mutation_receipts` on every mutating operation; missing key refuses |
| 10 | `dry-run-onboard-org.mts` takes an org from nothing to invoiceable offline, agreement included |
| 11 | ≥ 15 agreement tests including the settled-period refusal and cross-tenant on every write |
| 12 | Every membership call site found and reported with its real count |
| 13 | All converted to validity over `MembershipValidityPort`; absent is `unavailable`, never `false` |
| 14 | Boundary-instant semantics proven: `[from, until)`, the instant belongs to the later interval |
| 15 | ≥ 10 membership-validity tests including left-and-rejoined |
| 16 | `ocpp-authorize` resolves through the placement chain with the **same verdicts** |
| 17 | Two open placements refused rather than `LIMIT 1`-resolved |
| 18 | The `enforceAuthorize` + default-idTag sequence delivered, ordered, reversible, **unexecuted** |
| 19 | ≥ 10 resolution tests including resolution at an instant inside a closed placement |
| 20 | `dev/clean-shell-assembly` created from `7cc591e`; **frozen `8274256` merged**, not a branch head |
| 21 | Every conflict resolution recorded with file, side and one-sentence reason |
| 22 | Assembled tree green; assembled test and check totals reported, with the delta from the two branches explained |
| 23 | **Both dry runs executed in one tree, in sequence, with the result printed** |
| 24 | If the two dry runs do not hand off, the gap named precisely rather than papered over |
| 25 | Duplication verdict delivered: each pair inventoried, one picked, the pick justified on capability |
| 26 | Retirement plan written; **nothing deleted** |
| 27 | All 13 orphaned modules dispositioned in one line each |
| 28 | Zaptec pagination fixed and the `Pages` envelope honoured; 30-of-35 explained |
| 29 | The four vendor-config fields recorded through `VendorConfigSinkPort` as specified |
| 30 | Dalvegur re-onboard runbook delivered with stop points, abort conditions and the items-1–6 precondition |
| 31 | No migration generated on this branch; no migration applied anywhere |
| 32 | ≥ 5 fool-tests across the round, each proving a named real test fails |
| 33 | Completion `.md` and `.json` written **and committed after every phase** |

---

## 11. Fallback queue — work in order once §10 is met

1. **Wire `liveness-sweeper.ts` to the AMS module.** 266 lines, 31 tests, zero
   callers. Per the duplication verdict's disposition for it.
2. **The `z.Energy ?? 0` refusal.** A missing energy value is `unavailable`,
   never zero — ledger note 22 applied to ingest. Every coalesce of that shape
   in your lane, each with a test.
3. **The CDR import path bypasses the gate by construction.** The gate already
   enforces `no_contract` and `no_billable_clauses`; the import path never
   reaches it. Give it its own check **reusing the same verdicts** — a second
   verdict vocabulary is the duplication this round exists to end.
4. **Gherkin for onboarding**: an org with no chargers; a charger with no
   agreement; an agreement with no billable clause; a driver in no group; a
   device moved between orgs mid-period; a re-onboard of an org that already
   exists.
5. **Design the payment-status feed.** Named as essential and unaccounted. The
   host is the kröfuhafi; Straumvakt never holds money, so this is a status
   feed the host's bank or the host themselves provides. **Design only.**
6. **Design the audit trail.** Who did what, to which agreement, when, and what
   an operator sees. Design only.
7. **Design the alert emit path.** What raises, what receives, and what an
   unhandled alert does. Design only.
8. **The organisation is never read** — invoice headers come from fixtures.
   Name every place that must read it and what happens today when it cannot.
9. **The driver has no money surface at all.** One page on what the minimum is,
   given that the dweller is the billable party.
10. **Your own round-3 next actions, three of which are cheap and unclaimed:**
    wire `redactOrgIdentityForList` into `listOrgs` — one line, already tested,
    and it closes the over-broad kennitala payload on the cross-tenant org list
    (a correct guard returning too much, not an open leak); adopt
    `kennitalaProblems` in `register.ts` and `host-applications.ts`, which also
    take a kennitala and were outside round 3's lane; and lift task 13's
    `[BLOCKER: invite codes are bearer-only]`, restating it as
    `[BLOCKER: no agreement write surface; charger attach is platform-only]`
    — **and if Phase 1 succeeds, that restated blocker is itself lifted, so say
    what replaces it.**
11. **A round-4 revision of the onboarding gap list**, superseding
    `docs/notes/2026-08-19-onboarding-an-org-to-invoiceable.md`. It should be
    shorter.

---

## 12. Standing backlog — continue here; do not stop

When §11 is exhausted, keep going in this order. Commit the artifact after each
item.

1. **Re-run the full check suite on the assembly branch** and keep it green as
   later items land. The assembly is the deliverable most likely to rot.
2. **Session-data retention** — invoices are the host's to keep; per-driver
   session rows are undecided and it is Andri's call. Write the options, the
   one-way doors, and what each costs. **Decide nothing.**
3. **Property-based tests for membership intervals**, mirroring what A is doing
   for placements: random interval sets, the invariant asserted on every
   accepted set and violated on every rejected one.
4. **The OCPI export sketch** — `EVSE.uid` → placement id, `PATCH status:
   REMOVED` on close, a new EVSE published on open. One page. A is writing the
   model side; write the rails side so they meet.
5. **A read-only Cloudflare state confirmation**, `wrangler` read verbs only,
   of the three Workers named for `ADMIN_PASSWORD` rotation — `hlada`,
   `hlada-staging`, `hlada-api-staging`. **Confirm they exist and report;
   rotate nothing.** `hlada-api` never existed and `straumvakt-ocpp`'s secrets
   are retired with the dead Worker, never rotated — do not "fix" either.
6. Anything in your own artifact's "next recommended action" that stays in your
   lane.

---

## 13. Completion artifact

Write and commit incrementally to:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-b-agreement-write-surface-and-clean-shell-assembly-completion.md
```

plus the JSON sidecar, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, **plus** the §10 gate table row by row, the §11 and §12
items reached, the full conflict-resolution table from Phase 4, and the
assembled tree's test and check totals.

JSON minimum: `agent`, `round`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null`), `worktree`, `branches`,
`start_tip`, `end_tips`, `dirty`, `commits`, `files_changed`, `tests`,
`gates_met`, `fallback_items_done`, `backlog_items_done`, `blockers`,
`next_actions`, `external_state`, `very_tldr`.

**External state must state:** no push, no deploy, no migration generated on
this branch and none applied to any database, no SQL against any environment,
no socket opened, no Zaptec API call, no `updateChargerSettings`, no Cloudflare
or Neon or GitHub mutation — read-only `wrangler` verbs only — no third party
registered, submitted to or contacted, no charger or hardware action, no branch
or tag deleted, nothing under A's paths edited, and that the only branches
written to are `scratch/claude-b-release-ops-2026-08-10`, `dev/market-rails`
and `dev/clean-shell-assembly`.

Report in chat only a concise TL;DR pointing at the artifact.
