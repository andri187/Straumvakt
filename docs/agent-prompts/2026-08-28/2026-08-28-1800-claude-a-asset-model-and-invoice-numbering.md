---
agent: claude-a
status: ready
round: 4
lane: asset-model-and-invoice-numbering
created_utc: 2026-08-28T18:00:00Z
worktree: E:\Claude\Straumvakt-core-billing
branch: dev/core-billing-integration
start_tip: 8274256
follows: 2026-08-18\2026-08-18-2055-claude-a-period-lifecycle-and-the-operable-invoice.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-a-asset-model-and-invoice-numbering-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-a-asset-model-and-invoice-numbering-completion.json
target_wall_clock: none — deliverable-gated. This is a deliberately long round; §12 exists so the queue does not empty.
external_mutation_allowed: false
very_tldr: Build ADR 0054's asset model in schema — devices, device_identities, placements under a temporal key — plus migration 0004 for the invoice number sequence, then make billing count placements that overlap the period instead of rows that are current, and prove the double-invoice the ADR predicts fails at write time.
---

# Claude A Prompt — The Asset Model and Invoice Numbering

You are `claude-a`. Execute only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A here.
Verify this header says `agent: claude-a` and `status: ready` first.

This is **round 4**. Round 3 completed 22 of 22 gates and left the branch clean
at **`8274256`**. Nothing is superseded.

---

## 0. Operating rules

1. Work only in `E:\Claude\Straumvakt-core-billing`, on
   `dev/core-billing-integration`. Other `E:\Claude\Straumvakt*` folders are
   **read-only comparison**.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; DNS or domain binding; any
   Cloudflare, Neon or GitHub mutation; **running any migration against any
   database, including dev and scratch**; live SQL against any environment;
   production or staging personal rows; charger commands; BLE/NFC; hardware.
4. **Permitted:** local commits, and local merges into
   `dev/core-billing-integration`. **No push.**
5. No `git clean`, delete, prune, reset, rebase, amend, force, branch deletion,
   stash drop or worktree retirement.
6. **Line endings are settled.** `core.autocrlf` is `true` at system level.
   Keep the pre-commit `git diff --cached -w` check. Propose nothing, run
   nothing, add no `.gitattributes`.
7. **Write the completion artifact incrementally and commit it after every
   phase, and after every fallback item.** Ledger note 16. Not optional.
8. **No wall-clock target — and this round is explicitly long-running.**
   Deliverable-gated by §10, then §11, then §12. **Do not stop when the gate
   table is full.** The run ends when §12 is exhausted or Andri stops you.
9. **If you are resumed after an interruption, do not restart.** Read your own
   completion artifact, find the last committed phase, and continue from the
   next unmet gate. Ledger notes 19–20.
10. **Never idle on a decision that is Andri's.** Every phase below has an
    offline path. Where a decision is genuinely required, implement both
    branches behind a named switch, document the fork, and continue — do not
    stop and wait.
11. Record start and end UTC and actual wall clock, with no target comparison.
12. Never print, echo, log or commit a secret, token value, idTag, password,
    connection string, kennitala or personal row. **All fixture values are
    synthetic.** No checksum-valid ten-digit string appears anywhere in the
    repository.

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4**, and **read
`docs/adr/0054-devices-placements-and-effective-dating.md` in full before
Phase 1.** This entire round is that ADR's implementation items. FOCUS rules 1
(Prisma exception — touch it, convert it), 4 (the CDR is the record; money is
derived, never destructively), 5 (tenancy in every row and every query) and 7
(Drizzle owns the schema; never `drizzle-kit push`) all bear on it.

### The five framing corrections — these override older notes

From 2026-08-20, and each one invalidates analysis you may find in the repo:

1. **Fresh start. Nothing legacy is required. No backfill.** There is no parity
   burden and no rollback-window analysis to preserve.
2. **The restart exists because of database hardwiring, useless APIs, and
   multiple workflows for one purpose.** The port pattern is the cure for the
   first; do not reintroduce the second or third.
3. **The dweller is the billable party. There is no apartment abstraction.**
   Do not resurrect `BillObject` for the MDU line.
4. **Straumvakt never holds money.** The host is the kröfuhafi.
5. **Legacy data is reference data.** Never size a decision with a legacy
   figure, and **never reconstruct a fault from a data gap** — the May–August
   auth gap was a deliberate setting, not an outage.

### Lane boundary — round 4, by path

Claude B is working **the agreement write surface and the clean-shell
assembly** in parallel, in `E:\Claude\Straumvakt-relops-b`. The split is by
path and it is strict.

| You own | B owns |
|---|---|
| **`apps/api/drizzle/**` — every migration this round is yours** | `packages/contracts/**` |
| **`packages/shared/src/db/**` — the Drizzle schema** | `apps/api/src/lib/zaptec.ts` and the vendor importer |
| `packages/commercial/**` | `apps/api/src/routes/**` *except* your billing tree |
| `apps/api/src/lib/billing/**` | `apps/api/src/repositories/agreements*`, `onboarding*`, `zaptec-*` |
| `apps/api/src/repositories/activity-month*` | `gateway/**`, all `wrangler` configs |
| `apps/api/src/repositories/chargers.ts` | `scripts/analysis/**`, `scripts/dry-run-onboard-org.mts` |
| **new:** `apps/api/src/repositories/devices.ts`, `placements.ts` | `apps/api/src/routes/internal/ocpp-authorize.ts` |
| `apps/api/src/routes/admin/billing/**` | |
| `scripts/dry-run-first-invoice.mts` | |

**Why all migrations are yours:** `dev/market-rails` carries `0000` and `0001`
only. B's tree has never seen `0002` or `0003`, so a migration generated there
would be numbered `0002` and collide destructively at assembly. B knows this
and will not generate one.

**The cross-lane channel.** B appends schema requests as `SR-n` to
`docs/notes/2026-08-28-round-4-schema-requests.md` **on its own branch**. You
read them without merging:

```
git show dev/market-rails:docs/notes/2026-08-28-round-4-schema-requests.md
```

Do that at **every phase boundary**, not only in Phase 0. Service an open `SR`
before starting the next phase, or record in the artifact why you are refusing
it. B is blocked while an SR stands, so servicing them is ahead of your own
next phase in priority.

---

## 1. Where you left off — verified, not assumed

`dev/core-billing-integration` at **`8274256`**, clean. Your own round-3
artifact records the close precisely: **1,689 passed, 1 skipped, 0 failed
across 92 files, `npm run check` all 16 pass**, 187 endpoints documented, 79
tables / 959 columns, 4 fool-tests run and 4 caught. Verified 2026-08-28 by the
coordinator:

- `apps/api/drizzle/` holds `0000_baseline`, `0001_regular_talos`,
  `0002_powerful_warbird`, `0003_handy_stranger`. **The next number is `0004`.**
- `0002` created `billing_periods`, `mutation_receipts`, `session_settlements`,
  `settlement_components`, `settlement_holds`, `statements`, `statement_lines`,
  `statement_exports`, `statement_delivery_attempts`, and the two
  `reports.*_activity_month` tables. `0003` added `connector_assertions` and
  `period_transitions`.
- **There is no invoice number sequence store anywhere.** You declined to
  invent one in round 3, correctly. It is Phase 1 of this round.
- `gatherConnectorEvidence` lives in `apps/api/src/repositories/activity-month.ts`
  and counts rows that are current.
- The Drizzle schema is `packages/shared/src/db/{assets,charging,catalog,
  commercial,identity,platform,protocol,vendor}.ts`.
- `createCharger` is in `apps/api/src/repositories/chargers.ts` and performs no
  existence check.

**Your round-3 fallback queue is still untouched.** It is carried into §11.

---

## 2. Primary objective

**Put ADR 0054's model into the schema, and make billing count overlap.**

The ADR is locked. Items 1–6 must land before the Dalvegur re-onboard, because
that run writes the first placements and data written under the wrong shape
cannot be corrected in a settled period. This round lands items 1–7 and 10–13
on the schema side, plus migration `0004`.

Ordered by what unblocks the most:

1. `0004` — the invoice number sequence store. It is your own round-3 blocker
   and it blocks a real invoice, not a dry run.
2. `devices`, `device_identities`, `placements` — the model itself.
3. The EVSE/connector hierarchy and the vendor-config columns.
4. Memberships and sessions gain their intervals and snapshots.
5. Billing counts overlap, and the double-invoice the ADR predicts fails at
   write time.

**Everything is generated and unapplied.** Every surface goes over a port with
a fixture adapter and an unexecuted Drizzle adapter. Ledger note 21: build over
a port, test against a fixture, write the Drizzle adapter and never run it.
Ledger note 22: absent rows are `unavailable`, never zero — no method you add
this round may express "I looked and found nothing" as a `0`.

---

## 3. Phase 0 — Start-state verification

- Branch, start tip, dirty state, `git status --porcelain` counts.
- `git diff --shortstat` and `git diff -w --shortstat`, both.
- Baseline **before any edit**: `npx tsc --noEmit -p apps/api`,
  `npm run typecheck`, `npm test`, `npm run check`. **Expect 1,689 passed, 1
  skipped, 92 files, 16 of 16 checks.** Any deviation is a finding — record it
  before proceeding.
- Read ADR 0054 in full. Read `docs/notes/2026-08-20-session-handover.md` §5
  and §8.
- `git show dev/market-rails:docs/notes/2026-08-28-round-4-schema-requests.md`
  — service any `SR` before Phase 1, or record the refusal.
- Record `dev/market-rails`'s tip. **Do not merge it this round.** B is
  performing the assembly on a separate branch; a second assembly in your tree
  produces two different clean shells, which is the exact failure round 4 is
  meant to end.
- **Confirm the PostgreSQL version question is still open.** If nothing in the
  repo records which version Neon serves, that is Phase 2's fork, not a stop.

---

## 4. Phase 1 — Migration 0004: the invoice number sequence store

Round 3 issued `SV-2026-000001` from a dry run. Nothing persists the sequence,
so a second operator, a retry, or a second process allocates the same number.

Required:

1. **State the invariant first, in the artifact:** what "gap-free" means here,
   what "no duplicate" means, and which of the two survives if they ever
   conflict. An accountant's numbering sequence is gap-free *and* unique; a
   database sequence gives unique and not gap-free. **Say plainly which
   mechanism you chose and what it costs.**
2. Generate migration `0004` — `CREATE` only, no `ALTER`, no `DROP`, natural-key
   uniqueness that makes a retry collide rather than duplicate. Follow `0002`'s
   discipline exactly.
3. The allocation is **transactional with issue**. A number is never allocated
   by a read, never reserved and abandoned, never allocated outside the
   transaction that writes the statement.
4. **Per-year and per-org series.** `SV-2026-000001` implies both. Prove that
   two orgs issuing in the same second get distinct numbers, and that the
   series rolls at the year boundary without a collision.
5. **Crash semantics.** Say what happens if the process dies between allocation
   and commit, and prove it by test.
6. **The accountant's constraint is unanswered** (retention, numbering,
   corrections, the *yfirlýsing seljanda eða hönnuðar hugbúnaðarins*). Do not
   wait for it. Build the mechanism so that a credit note and a correction each
   consume a number from a *stated* series, and record in the artifact exactly
   what would change if his answer differs.
7. Tests: at least eight, including concurrent allocation, retry with the same
   idempotency key, retry with a different key on the same logical issue
   (**rejected**), year rollover, two orgs in the same instant, and a gap
   introduced by a failed transaction — with the documented verdict.
8. Fool-test: remove the uniqueness and prove a test fails.

---

## 5. Phase 2 — ADR 0054 items 1–3: devices, identities, placements

The heart of the round. Migration `0005`.

**1 · `charging_stations` becomes `devices`.** Surrogate PK. `(vendor, serial)`
unique and nullable — OCPP 2.0.1 makes `serialNumber` optional, vendor-specific
and 25 characters. Strip the placement-shaped columns: `org_id`,
`installation_id`, `circuit_id`, the `site_assets` link. Add the lifetime
counters: lifetime energy, lifetime session count, firmware history, fault and
warranty history. **These follow the asset, never the site, and are never
erased on transfer** (decision 7).

**2 · `device_identities`** — `device × identity_string × tstzrange`. The OCPP
identity is a credential: it doubles as the HTTP Basic username and in 2.0.1 it
is a settable `SecurityCtrlr.Identity`. Operators keep it across a unit swap at
one site and must change it on a tenant move. Neither may be a model violation.

**3 · `placements`** — `device × installation × tstzrange`, carrying org,
installation, circuit and site. **Give it a stable public id from day one** —
that is the OCPI `EVSE.uid`, which the spec says can never be changed. Free
now, impossible to retrofit.

The constraint, on both `placements` and `device_identities`:

```sql
period tstzrange NOT NULL,
CONSTRAINT one_place_at_a_time UNIQUE (device_id, period WITHOUT OVERLAPS)
```

with `btree_gist`. Open-ended is the unbounded range `[from,)`, **never a NULL
column**.

Required:

1. **Resolve the PostgreSQL version fork without waiting for Andri.**
   `WITHOUT OVERLAPS` is 18+. Emit the migration so that both forms exist and
   the choice is explicit and reviewable: the `WITHOUT OVERLAPS` form and the
   `EXCLUDE USING GIST (device_id WITH =, period WITH &&)` form, with a written
   statement of which one to apply once the version is known and what differs
   in behaviour between them. **Do not pick silently and do not stall.**
2. **The ADR's own worked example is a required test.** A device placed at
   site A `[Jan 1, Mar 1)`; a correction backfilled as a second closed row at
   site B `[Feb 1, Mar 1)` without ending the first. Under a partial unique
   index this inserts cleanly and February invoices two hosts for one physical
   unit. **Prove the insert fails at write time under your constraint, and
   prove the partial-index alternative would have permitted it.** This test is
   the reason the ADR exists; name it so.
3. Drizzle cannot express `WITHOUT OVERLAPS` natively. Say how you handled it —
   raw SQL in the migration with the schema module carrying the column and a
   documented comment is acceptable; a silently divergent snapshot is not.
   FOCUS rule 7 holds: Drizzle owns the schema, the migration is generated,
   nothing is pushed.
4. **`ocpp_identities` does not survive** in its present form. Do not delete it
   in this migration — mark it, document what replaces it, and put its removal
   in the retirement plan. `CREATE` only.
5. Tests: at least fifteen. Overlap rejected; adjacency accepted (`[a,b)` and
   `[b,c)` do not overlap); unbounded overlapping bounded; two devices in one
   place at one time is legal; one device in two places is not; a closed
   placement reopened as a new row; identity moved between devices; identity
   reused at one site across a unit swap; the ADR's double-invoice case.
6. Fool-tests: at least three, each removing a guard and proving a named test
   fails.

---

## 6. Phase 3 — Items 4, 11, 12: the hierarchy, the vocabulary, the config

**Item 4 — the 1:1:1 hardcoding goes.** The import invents one EVSE and one
connector at index 1, `type: "Type2"`, and a warranty date of install + 5
years. For a Zaptec Pro the 1:1:1 is true; **bake the OCPP hierarchy rather
than the coincidence.** EVSE and connector remain children of the device.
Vendor, model, serials and firmware come from `BootNotification`, not from
invention. A connector is **not** a dated membership — decision 4 is explicit;
its availability is a status series with its own retention.

**Item 11 — keep the protocol's status vocabulary** on connectors:
`Available`, `Preparing`, `Charging`, `SuspendedEV`, `SuspendedEVSE`,
`Finishing`, `Reserved`, `Unavailable`, `Faulted`. No house enum. A 2.0.1
migration and any OCPI export both want the originals.

**Item 12 — persist the four vendor-config fields**, each with a timestamp:
`Charger.Active`, `AuthenticationType`, `IsAuthorizationRequired`,
`PropertyOcppDefaultIdTag`. Each changes what our own rows *mean*, which is the
test for what belongs in the database.

Verified 2026-08-28: the first three are already on the bulk response type
`ZaptecChargerLite` in `apps/api/src/lib/zaptec.ts` — which is **B's file** —
and that file's own comments carry two corrections worth reading before you
model anything: `AuthenticationType` is the *integration path*
(0=Native, 1=WebHooks, 2=Ocpp, 3=OcppNative), reads 2 uniformly because it is
an installation property, and **can never indicate per-charger driver auth**;
`IsAuthorizationRequired` is the driver-auth flag, true on exactly one charger
in the fleet. Two different wrong readings of `AuthenticationType` have already
been committed to this repo and corrected. Do not make a third. The default
idTag's source field is B's to confirm.

**The columns are yours; the importer is B's.** Define the columns and the
writer behind this port, whose signature is locked and appears verbatim in B's
prompt:

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

`Evidence` follows round 3's convention: an absent row is `unavailable`, never
a zero and never a `false`. If you need to change this signature, append `CR-3`
to `docs/notes/2026-08-18-invoice-contract-change-requests.md` and say in the
artifact whether it blocks B.

**The estate finding this makes billable-correct:** 20 active chargers at
Dalvegur, 15 deactivated, 35 in the Zaptec portal, **30 rows in our database**.
Per-connector billing over unfiltered rows invoices 30 where 20 exist. With
`Charger.Active` persisted, state precisely which predicate the billing count
must use, and put that predicate in Phase 5.

Tests: at least eight, including a device whose `Charger.Active` flips
mid-period, and an observation that is byte-identical to the last one
(`unchanged`, not a duplicate row).

---

## 7. Phase 4 — Items 5 and 6: memberships and sessions

**Item 5 · `driver_group_memberships`** gains the interval, **drops the
`(group, user)` unique**, and takes the same temporal key. The uniqueness is on
the interval, not on the pair — which is exactly what move-out then move-in
requires, and it is the capability that had no owner.

**Item 6 · `charging.sessions`** gains `placement_id` and the tariff snapshot.
Additive. A session is sealed and never re-attributed when a device moves
(decision 6, and OCPI `mod_cdrs` says the same: sealed, preserving what was
valid when the session started).

Required:

1. Both in migration `0006`, or folded into `0005` with a written reason.
   `CREATE`/additive only.
2. **Sessions are already safe** — `charging.sessions` carries its own `org_id`,
   `site_id`, `charging_station_id`, `evse_id`. Confirm that is still true
   before adding anything, and say so.
3. The membership *validity* check is **B's item 9** and shares this shape. Do
   not implement it; make sure the schema serves it, and record in the artifact
   the exact predicate B should use.
4. Tests: at least eight. Move-out then move-in for one user in one group; two
   overlapping memberships rejected; a session sealed with a placement that
   later closes; a session whose tariff changed after it started.

---

## 8. Phase 5 — Item 7: billing counts overlap

**Decision 5: billing counts placements overlapping the period, not placements
current at the moment of billing.** A device placed on the 2nd and removed on
the 28th is billable. A device that moves on the 12th belongs to the old host
for eleven days and the new one for the rest.

`gatherConnectorEvidence` in `apps/api/src/repositories/activity-month.ts`
counts current rows today and would bill a mid-month move to the wrong host.

Required:

1. Rewrite it to join placements overlapping the period, through the existing
   port. `connector_assertions` and `connector_activity_month` are already
   keyed `(org_id, period_year, period_month, connector_id)`, so a device that
   moves mid-month naturally produces one row per host — **that shape was right
   before we knew why, and you must not change it.**
2. Apply the `Charger.Active` predicate from Phase 3. State the count for
   Dalvegur under the old derivation and the new one.
3. **Proration is a decision, not an assumption.** The flat fee is per
   connector per month. Say plainly whether a mid-month move produces two full
   fees, two prorated fees, or one fee to one host — and justify it against
   FOCUS rule 3 and the ADR's decision 5. If the answer is genuinely Andri's,
   implement the option you argue for behind a named switch, implement the
   alternative behind the same switch, and document the fork. **Do not stall.**
4. **Extend `scripts/dry-run-first-invoice.mts`** with a mid-month move: one
   device, two hosts, one month. Print both invoices. Keep every existing case
   green and byte-identical where nothing changed — a diff in the unchanged
   cases is a finding, not a nuisance.
5. Tests: at least ten, including a device that moves on the last day, a device
   that moves twice, a device placed after the period ends, a placement that
   opens and closes inside one day, and a period with no placements at all —
   which is `unavailable`, **never zero**.
6. Fool-test: revert the overlap join to a current-row read and prove a named
   test fails.

---

## 9. Phase 6 — Items 10 and 13: attach, detach, and closing as a state

**Item 10 · `createCharger` becomes `attachDevice` / `detachDevice`.** Explicit
close-then-open, enforced by the temporal constraint rather than by an
application check, **so a move that skips the detach fails at write time.**

**Item 13 · Closing a placement is a state, not a delete.** OCPI requires
`status: REMOVED` rather than removal; CPOs who delete instead are the reason
the ecosystem has an open issue about it. A closed placement is what would emit
that.

Required:

1. New `apps/api/src/repositories/devices.ts` and `placements.ts`, over ports,
   fixture adapters for tests, Drizzle adapters written and never executed.
2. **Leave `createCharger` in place as a shim** that delegates and is marked
   for retirement. B's onboarding path calls it through
   `onboarding-chains.ts`, which is B's file; changing both sides in two trees
   is the merge conflict this boundary exists to prevent. Put the call-site
   migration in the retirement plan for round 5.
3. `attachDevice` is idempotent: attaching a device already open at that
   installation returns the existing placement, never a duplicate and never an
   error that hides a real one. Attaching it to a *different* installation
   while open is a **refusal with a named reason**, not an implicit move.
   An explicit move is `detach(at) → attach(at)` at the same instant, and it
   must be atomic.
4. `mutation_receipts` for every mutating operation, per round 1's rule: a
   missing idempotency key is a refusal, never a generated one.
5. Tenancy on every call, FOCUS rule 5.
6. Tests: at least twelve, including the atomic move, the skipped detach
   (fails at write time), the refusal on a cross-installation attach, a detach
   of a device that was never attached, a detach twice, and cross-tenant
   attach refused.

---

## 10. Completion gates — done when all are true

| # | Gate |
|---|---|
| 1 | Baseline recorded; any deviation from 1,689 tests / 16-of-16 reported as a finding |
| 2 | B's `SR` file read in Phase 0 and again at **every** phase boundary; each SR serviced or refused in writing |
| 3 | Numbering invariant stated — gap-free vs unique — with the mechanism named and its cost stated |
| 4 | Migration `0004` generated and **unapplied**; `CREATE` only; natural-key unique |
| 5 | Allocation transactional with issue; per-org, per-year; crash semantics stated and tested |
| 6 | ≥ 8 numbering tests including concurrency, retry-same-key, retry-different-key rejected, year rollover |
| 7 | `devices` on a surrogate PK with `(vendor, serial)` unique nullable and the lifetime counters; placement columns stripped |
| 8 | `device_identities` dated, temporal key |
| 9 | `placements` dated, temporal key, **with a stable public id from day one** |
| 10 | Both the `WITHOUT OVERLAPS` and `EXCLUDE USING GIST` forms emitted, with a written statement of which to apply and what differs |
| 11 | **The ADR's double-invoice case proven to fail at write time, and proven to pass under the partial index** |
| 12 | Drizzle/raw-SQL divergence for the temporal key documented, not silent |
| 13 | ≥ 15 placement/identity tests including adjacency, unbounded, and move-out/move-in |
| 14 | EVSE/connector hierarchy from `BootNotification`; the 1:1:1 invention removed; connector not modelled as a membership |
| 15 | Protocol status vocabulary kept verbatim; no house enum |
| 16 | The four vendor-config fields persisted with timestamps behind `VendorConfigSinkPort` as specified |
| 17 | The billing predicate under `Charger.Active` stated, with the Dalvegur count old vs new |
| 18 | `driver_group_memberships` interval added, `(group, user)` unique dropped, temporal key in place |
| 19 | `charging.sessions` additively gains `placement_id` and the tariff snapshot; the existing self-carried context confirmed intact |
| 20 | The membership-validity predicate recorded for B |
| 21 | `gatherConnectorEvidence` joins placements overlapping the period |
| 22 | Mid-month proration decided and justified, or both branches implemented behind a named switch with the fork documented |
| 23 | `dry-run-first-invoice.mts` extended with a mid-month move; all prior cases green and byte-identical where unchanged |
| 24 | ≥ 10 overlap tests including no-placements → `unavailable`, never zero |
| 25 | `attachDevice`/`detachDevice` over ports; skipped detach fails at write time; move is atomic |
| 26 | `createCharger` left as a marked shim; call-site migration deferred to the retirement plan |
| 27 | `mutation_receipts` on every mutating device operation; missing key refuses |
| 28 | Tenancy proven on every new read and every new write |
| 29 | ≥ 6 fool-tests across the round, each proving a named real test fails |
| 30 | **No migration applied to any database**; every migration generated and unexecuted |
| 31 | Completion `.md` and `.json` written **and committed after every phase** |

---

## 11. Fallback queue — work in order once §10 is met

This is your round-3 queue, untouched, plus what round 4 adds.

1. **The first-placement write path.** ADR 0054 says the re-onboard creates the
   first placements; nothing says what a *correct* first onboarding writes.
   Specify it: the `device` row, its `device_identity`, its `placement`, and
   the EVSE/connector children — in what order, in one transaction or not, and
   what a partial failure leaves behind. **This is the pathway a charger will
   be onboarded through when we get there, and it does not exist yet.**
   Design plus the port; no vendor call, no database.
2. **Census row 104 (`billing-enrichment.ts`)**, deferred since round 1 and
   already classified "safe to fix now".
3. **The 22 remaining `missing-orgIdParam` gates** — each removal with a test
   that fails when the scope is removed.
4. **Prisma → Drizzle** for every remaining file in the billing tree, FOCUS
   rule 1's exception: touch it, convert it.
5. **30 Gherkin scenarios** for the flat-fee path: month boundary; org with no
   connectors; org added mid-period; **device moved mid-period**; cap edge;
   disputed line; a period that holds; a re-run after correction; an asserted
   connector; a deactivated charger still in the vendor portal.
6. **The `ocpp_identities` retirement plan** — what reads it, what must exist
   before it can go, and the ordered steps. Nothing is deleted in this round.
7. **The `createCharger` call-site migration plan** for round 5, naming every
   caller across both branches.
8. **A round-4 revision of "what stands between here and a real invoice."**
   It should be shorter than round 3's.
9. **The lifetime-counter maintenance question** — decision 1 says devices
   carry lifetime energy and session counts. Say what writes them, when, and
   how a replay or a correction does not double-count. Design only.
10. **The OCPI mapping note** — `EVSE.uid` → placement id, `PATCH status:
    REMOVED` on close, a new EVSE on open. One page, so the export is not
    redesigned from scratch later.

---

## 12. Standing backlog — continue here; do not stop

When §11 is exhausted, keep going in this order. Commit the artifact after each
item.

1. **The `z.Energy ?? 0` refusal.** A missing energy value is `unavailable`,
   never zero — ledger note 22 applied to ingest. Find every coalesce of that
   shape in your lane and convert it, each with a test.
2. **Persisted `Charger.Active` consumers** — every read path that currently
   assumes all rows are live.
3. **Property-based tests for the temporal key.** Generate random interval sets
   and assert the invariant "at most one placement per device per instant"
   holds for every accepted set and fails for every rejected one.
4. **A schema-shape review of the fresh generation** against
   `docs/notes/2026-08-19-clean-shell-requirements.md`: the clean shell writes
   to zero of the 66 baseline tables and reads three. Say which of the six
   unaccounted essentials — organisation never read, no payment-status feed, no
   audit trail, no alert emit path, session retention, no driver money surface
   — have a schema consequence that should land while the schema is still
   young. **Design and document; do not build them this round.**
5. **An audit-trail design** for the asset model specifically: who attached,
   who detached, who asserted, and what an operator sees.
6. Anything in your own artifact's "next recommended action" that you can do
   without leaving your lane.

---

## 13. Completion artifact

Write and commit incrementally to:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-a-asset-model-and-invoice-numbering-completion.md
```

plus the JSON sidecar, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, **plus** the §10 gate table row by row, the §11 and §12
items reached, and the revised short list of what stands between here and a
real invoice.

JSON minimum: `agent`, `round`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null`), `worktree`, `branch`,
`start_tip`, `end_tip`, `dirty`, `commits`, `files_changed`, `tests`,
`gates_met`, `fallback_items_done`, `backlog_items_done`, `blockers`,
`next_actions`, `external_state`, `very_tldr`.

**External state must state:** no push, no deploy, **no migration applied to
any database — `0002`, `0003`, `0004`, `0005` and any `0006` remain generated
and unapplied**, no SQL against any environment, no socket opened, no
Cloudflare or Neon or GitHub mutation, no charger or hardware action, no branch
or tag deleted, nothing under `packages/contracts/**` or B's paths edited, and
that the only branch written to is `dev/core-billing-integration`.

Report in chat only a concise TL;DR pointing at the artifact.
