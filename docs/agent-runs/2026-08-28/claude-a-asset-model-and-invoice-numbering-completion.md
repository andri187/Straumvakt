# Claude A — The Asset Model and Invoice Numbering

**Completion artifact. Round 4** — ADR 0054's implementation items.
**Written and committed incrementally after every phase**, per ledger note 16.

Prompt: `docs/agent-prompts/2026-08-28/2026-08-28-1800-claude-a-asset-model-and-invoice-numbering.md`

> **STATUS: IN PROGRESS.** Phases completed so far are recorded below with
> their commits. If this run is interrupted, resume from the first unmet gate
> in §10 — do not restart.

---

## Phase 0 — Start-state verification

| | |
|---|---|
| Start (UTC) | 2026-08-28T18:00:27Z |
| Branch | `dev/core-billing-integration` |
| Start tip | `8274256` |
| Dirty at start | 0 |
| `git diff --shortstat` and `-w` | both empty — clean |
| `dev/market-rails` tip | **`7cc591e`** — recorded, **not merged** |

**Baseline matched the prompt exactly**: `npx tsc --noEmit -p apps/api` 0,
`npm run typecheck` 0, **1,689 passed / 1 skipped / 92 files**, `npm run check`
**all 16 pass**. No deviation.

### Three Phase-0 findings

**1 · ADR 0054 is committed on no branch.** The document this entire round
implements exists only as an **untracked file in the canonical working tree**,
`E:\Claude\Straumvakt\docs\adr\0054-devices-placements-and-effective-dating.md`
(13,448 bytes, mtime 2026-08-20). Verified:

```
git ls-tree -r dev/market-rails            -- docs/adr | grep 0054   -> nothing
git ls-tree -r dev/straumvakt-org-relaunch -- docs/adr | grep 0054   -> nothing
git log --all --diff-filter=A -- 'docs/adr/0054*'                    -> nothing
```

I read it from the canonical working tree — read-only comparison is permitted —
and this round implements it faithfully. **I deliberately did not copy it into
my branch.** Duplicating an ADR into a lane branch is how two copies diverge,
which is a failure mode this project has already paid for, and canonical is
where it belongs. **Recommendation for the coordinator: commit it.** One
`git clean` in the canonical tree destroys the specification for rounds 4 and 5.

**2 · `docs/notes/2026-08-20-session-handover.md` is not on this branch.**
§5 and §8 were required reading. Same class of finding; the five framing
corrections carried in the prompt itself supplied what I needed.

**3 · B's schema-request file does not exist.**
`git show dev/market-rails:docs/notes/2026-08-28-round-4-schema-requests.md`
→ *"path does not exist in 'dev/market-rails'"*. **No SR is outstanding.**
Re-checked at every phase boundary.

**The PostgreSQL version question is confirmed open.** Nothing in `docs/notes`,
`docs/reference` or `docs/adr` records which version Neon serves, and
`WITHOUT OVERLAPS` / `btree_gist` appear nowhere in the repository. That is
Phase 2's fork, handled there rather than stalled on.

---

## Phase 1 — Migration `0004`: the invoice number sequence store

### The invariant, stated before the mechanism

Icelandic law requires *"fyrirfram tölusett með áprentuð númer í samfelldri
töluröð"*. That is **two** requirements, and conflating them is how the wrong
mechanism gets chosen:

- **UNIQUE** — no two documents ever carry the same number.
- **GAP-FREE** — every ordinal between the first and the last is accounted for,
  either by a live document or by one recorded **void**.

**They do not conflict here, and that is the point of the mechanism.** The
obvious implementation delivers only one:

| mechanism | unique | gap-free | why |
|---|---|---|---|
| Postgres `SEQUENCE` | yes | **no** | `nextval` is non-transactional *by design*; a rolled-back issue burns its value permanently |
| **a counter row** | yes | **yes** | the increment participates in the issuing transaction and rolls back with it |

**Chosen: the counter row, and its cost is named rather than hidden —
allocation SERIALISES per `(org, series, year)`**, because concurrent issuers
contend on one row via `SELECT … FOR UPDATE`. At one invoice per org per month
that contention is nil, and throughput is not the axis worth trading
correctness on.

**If they ever did conflict, gap-free wins.** A duplicate is detectable by
anyone holding both documents; a hole is detectable only by whoever audits the
series — and it is the thing the statute names.

### Crash semantics

**If the process dies between allocation and commit, nothing is consumed.** The
counter increment, the `document_numbers` row and the statement are one
transaction; a crash rolls back all three and the next attempt takes the same
ordinal. This is why there is deliberately **no release operation**: a number
can only be spent by a committed transaction, and a committed number is never
taken back — it is recorded `voided` **in place**, and the sequence still
accounts for it.

### Migration `0004_tough_reaper.sql` — generated, UNAPPLIED

`CREATE` only, verified by verb census: **2 `CREATE TABLE`, 4 `CREATE UNIQUE
INDEX`, 1 `CREATE INDEX`; zero `ALTER` / `DROP` / `TRUNCATE` / `INSERT` /
`UPDATE` / `DELETE`.**

`billing.document_number_series` — one row per `(org, series, year)`. Per-org
because each host's sequence is its own; per-year because `SV-2026-000001`
restarts each January, which is standard Icelandic practice and keeps each
year's series unbroken.

`billing.document_numbers` — every number ever spent and what it became. Three
uniques, each preventing a different failure:

| unique | prevents |
|---|---|
| `(org, series, year, ordinal)` | two documents sharing a number |
| `(org, series, year, idempotency_key)` | a retry consuming a second number |
| `(statement_id, purpose)` | **a different key for the same logical issue** quietly spending another |

Mirrored into Prisma; `check:schema-consistency` agrees at **81 tables / 982
columns**.

### The accountant's constraint — what would change

Unanswered, and not waited on. `purpose` is carried on every allocation so a
credit note and a correction each take a number from a *stated* series. Three
things his answer could move, each a one-place change **by construction**:

1. **A shared series across orgs** — drop `org_id` from the series key.
2. **Credit notes on their own series** — a caller argument, `"SVK"` not `"SV"`.
3. **No year reset** — B's `number.ts` already carries `resetOnYearRollover`.

### Tests — 15

Issue order · missing key refused and never generated · retry with the same key
returns the same number **without touching the counter**, asserted through a
recorded `counterHits` list rather than inferred · retry with a *different* key
**refused** · a credit note for the same statement takes its own number ·
**10 concurrent allocations get 10 distinct ordinals** · 10 concurrent retries
of one key yield one number and **one** counter hit · two orgs in the same
instant · year rollover · each year independently gap-free · a failed
transaction consumes nothing · **a void is not a gap** · double-void refused ·
cross-org void refused · **`findGaps` proven able to see a manufactured gap**,
so the guard is not vacuous.

The fixture models `FOR UPDATE` with a per-series promise lock, so the
concurrency tests exercise the real serialisation rather than smoothing it over.

**Fool test 1:** the `(statement, purpose)` uniqueness removed → **1 test
failed**. Restored.

### Round 3's last blocker, closed

`issueDocument` in the Drizzle adapter used to refuse with
`document_sequence_table_not_yet_created`. It now allocates through
`DocumentNumberStorePort`. It still refuses the **render** half by name —
`number_allocated_<N>_but_statement_renderer_not_built` — because returning a
number with an empty rendering would be a lie about what exists. The number is
what this round unblocked; the renderer is a later item.

**Checks at Phase 1 close:** tsc 0, **1,704 passed / 1 skipped / 93 files**,
`npm run check` **16 of 16**.


---

## Phase 2 — the asset model (ADR 0054 items 1–3)

### Migration `0005_supreme_psylocke.sql` — generated, hand-extended, UNAPPLIED

Three tables, and the split that matters is between what the generator can say
and what it cannot.

`assets.devices` — the physical unit, immortal. Keyed by a surrogate id, **not
by the serial**: OCPP 2.0.1 makes `serialNumber` optional, vendor-specific and
25 characters, and OCPP 1.6 offers two competing serial fields plus a third for
the meter. `(vendor, serial_number)` is unique and **nullable** — Postgres
treats NULLs as distinct, so unserialised devices do not collide. The
placement-shaped columns `charging_stations` carries — `org_id`,
`installation_id`, `circuit_id`, the `site_assets` link — are **absent**.

`assets.device_identities` — the OCPP identity, dated. **Two** temporal keys,
not one: `(device_id, period)` and `(identity_string, period)`. The second is
the half that matters on the wire, because the gateway resolves an inbound
connection by the identity string, so two devices answering to one identity at
one instant is an authentication ambiguity rather than untidy data.

`assets.placements` — `public_id` exists **from day one**. It is the OCPI
`EVSE.uid`, which the spec says can never be changed, and OCPI explicitly warns
against deriving it from hardware. Free now; impossible to retrofit once
anything external holds a reference.

### The PostgreSQL version fork — resolved, not waited on

`WITHOUT OVERLAPS` is 18+. Nothing in the repository records what Neon serves.
**Both forms are in the migration**: Form A (`EXCLUDE USING GIST`) is active,
Form B is written out and commented, with the server-version query as the
decider, and **three stated behavioural differences**:

| | Form A — active | Form B — 18+ |
|---|---|---|
| SQLSTATE on violation | `23P01` exclusion_violation | `23505` unique_violation |
| can a temporal FK reference it | **no** | yes — it is a real UNIQUE constraint |
| empty ranges | cannot fire, since empty overlaps nothing | — |

The third is closed for both by the well-formedness CHECK, applied
unconditionally so the fork does not change behaviour on that axis. The first
is closed in code: the refusal path treats both SQLSTATEs identically, so
switching forms is a migration and not a code change. Moving A to B later is a
DROP CONSTRAINT plus an ADD CONSTRAINT over the same column.

### The divergence Drizzle cannot express, declared rather than silent

Drizzle has no range type and no syntax for either constraint form. So the
**column** is declared in `packages/shared/src/db/assets.ts` via a `tstzrange`
`customType` and is generated; the **constraint** is hand-appended below a
banner in the migration. The consequence is written at both sites: **the
drizzle-kit snapshot does not know the constraints exist.** A future
`drizzle-kit generate` will not drop them — a snapshot only diffs what it can
see — but it will never recreate them either, so the hand-written block is
their only definition and must travel with the tables.

**Verb census, 0005:** 3 CREATE TABLE, 2 CREATE UNIQUE INDEX, 6 CREATE INDEX,
1 CREATE EXTENSION (`btree_gist`), 5 ALTER TABLE — all ADD CONSTRAINT on the
three tables created in the same file. Zero DROP, TRUNCATE, INSERT, UPDATE,
DELETE.

### The ADR's worked example is a test, and it is named as one

`packages/shared/src/domain/effective-dating.test.ts`, describe block
**"ADR 0054 double-invoice: the worked example"**. Four tests, in the order the
ADR argues it:

1. **the temporal key REFUSES the backfilled overlap at write time** — site A
   `[Jan 1, Mar 1)`, site B `[Feb 1, Mar 1)` backfilled without ending the
   first; the conflicting row is named in the refusal.
2. **the partial unique index PERMITS it** — and the same test proves the index
   is not a vacuous stub by showing the one thing it *does* catch, two open
   rows.
3. **February then bills TWO hosts for ONE physical device** — the consequence
   computed rather than asserted: the billing predicate returns two rows, one
   `deviceId`, two `orgId`s. At 200 kr per active connector that is 400 kr
   charged for 200 kr of hardware, and neither host can see it.
4. **a REAL mid-month move also returns two rows — and that one is correct.**
   The contrast, and the reason the constraint cannot simply be "refuse two
   rows in a month": a device that moves on the 12th genuinely belongs to two
   hosts in February. Identical query; what differs is that those two rows do
   not overlap.

The counterfactual is implemented, not described: `checkPartialUniqueOpenRow`
is real code in `effective-dating.ts`, marked never to be called from
production. A design document's claim about the design that was *not* built is
the easiest kind to get wrong.

### What the module is, and what it is not

**The enforcement is the constraint in 0005.** The database stops a bad write
including one made by psql or by a service that never imports this module.
`effective-dating.ts` is the same predicate expressed where it can be tested,
and it says so at the top: *if this and the database ever disagree, the
database is right.*

### Tests — 24, and three fool tests

Interval algebra 7 · the temporal key 8 · the worked example 4 · decision 5's
billing predicate 5.

| fool | mutation | failed |
|---|---|---|
| 1 | `overlaps` counts touching as overlapping | **7** |
| 2 | `checkTemporalKey` delegates to the partial-index model | **2** |
| 3 | `checkPartialUniqueOpenRow` made adequate | **1** |

Fool 3 is the one that matters: it proves the rejected alternative is modelled
honestly rather than crippled to lose the comparison.

### Retirement, marked and planned — nothing dropped

`assets.charging_stations` and `ocpp.ocpp_identities` are **marked in their
Drizzle declarations** with what supersedes them and why, and 0005 does not
touch either: no ALTER, no DROP, no backfill. The plan is
`docs/notes/2026-08-28-asset-model-retirement-plan.md`, and it flags the hard
part up front: **`charging_stations` records where a device *is* and nothing
records when it got there.** A backfill can honestly produce one placement per
station starting at `created_at`, and **must not** invent an earlier bound —
decision 5 bills by overlap, so a fabricated early bound is a fabricated
charge. Rows where `created_at` is unreliable are **unavailable**, listed
rather than filled.

---

## SR service — B's schema requests, first seen at the Phase 2 boundary

At Phase 0 `docs/notes/2026-08-28-round-4-schema-requests.md` did not exist. At
the Phase 2 boundary `dev/market-rails` had moved `7cc591e` to **`ae99700`**
and carried three SRs. Responses:
**`docs/notes/2026-08-28-round-4-schema-responses.md`** — B cannot see this
branch and I cannot write to B's, so the reply is a file here.

| SR | verdict |
|---|---|
| SR-1 `agreement_clauses` interval | **serviced**, migration 0006 |
| SR-2 `driver_group_memberships` interval | **serviced**, same migration — pulled forward out of Phase 4 |
| SR-3 `agreements.mutation_receipts` | **refused as specified**; the need serviced by the existing table |

SR-1 asked for a key on `factor_code`. There is no such column — the clause
points at a cost factor by `cost_factor_id` and the code lives on the
cost-factor row. Serviced on the real column, and the difference is stated in
both the migration and the response.

### SR-3 — why the refusal

`billing.mutation_receipts` already exists (migration 0002) and its `scope`
column is exactly SR-3's `operation`. Two receipt stores are two answers to
"has this key already run", which is the one thing an idempotency mechanism
must not have.

**And the shape as specified has a live defect, which is the real reason.**
`idempotency_key text PRIMARY KEY` is a **cross-tenant global namespace**. Two
orgs' month-end scripts both using `month-end-2026-08` — the key a human would
pick — collide: the second org is told its write was a replay, its operation
silently does not run, and it is handed **the other org's** recorded outcome. A
leak and a no-op in the same row. Offered instead, if B still wants a separate
table: keyed `(org_id, operation, idempotency_key)`, never on the key alone.
Not blocking B either way — the fixture already holds receipts.

### Migration `0006_heavy_cobalt_man.sql` — and what the generator got wrong

**This is the first migration this round that is not CREATE-only**, so the
census is stated: 2 UPDATE (both backfills, both bounded), 2 DROP INDEX (both
named, both replaced by a plain index on the same columns), 6 ALTER TABLE, 2
CREATE INDEX. No DROP TABLE, no DROP COLUMN, no TRUNCATE, no DELETE.

drizzle-kit emitted one `ADD COLUMN ... DEFAULT tstzrange(now(), NULL, ...) NOT
NULL` per table. **That applies cleanly and is wrong** — the worse of the two
failure modes. The default fills every pre-existing row with an interval
starting at the instant the migration ran, so a membership that has existed for
months claims to have begun at migration time. Decision 5 bills by overlap, so
a run over any earlier period finds those rows invalid and counts nobody. No
error, no warning, a smaller invoice.

(An earlier draft of the declaration had no default. *That* version failed
loudly — `column "period" contains null values` — on any table with rows, and
cleanly on an empty dev database, which is its own trap. The default is needed
for a different reason, below; it is not a backfill.)

Rewritten as: add with the default, then **overwrite the pre-existing rows from
evidence** — `[created_at, )` and `[added_at, )` — bounded so it cannot
re-stamp a row whose interval has since been managed.

**The default is load-bearing for a second reason.** Prisma types the column
`Unsupported("tstzrange")` and **cannot write it**. Without the default, NOT
NULL breaks three live `prisma.driverGroupMembership.create(...)` sites the
moment 0006 applies.

**A hazard in the drop, recorded so review does not have to find it.** The
backfill gives every pre-existing row an open period, so any two rows sharing a
key would now overlap — and the pair unique being dropped is exactly the
guarantee that no such pair exists. **The old constraint is what makes the new
one applicable**, so the drop and the temporal key must run in one transaction.

### Two functions that were wrong the instant the pair unique came off

Found by the typechecker, not by the grep: my first pass searched the Prisma
model name and missed `repositories/driver-group-memberships.ts`, which uses
the table name. Both were fixed and the SR response was corrected in place.

- **`createMembership`** took `.limit(1)` on the pair and reported "already a
  member" for any row returned. Exact while the pair was unique; with the
  interval it reports a driver who **left in March** as a current member. Now
  fetches every row for the pair and asks `selectLiveMembership`.
- **`removeMembership`** hard-**deleted** the row — a direct violation of ADR
  0054 decision 4, and the thing SR-2 exists to stop. Now closes the interval,
  bounded to still-open rows so a second call is a no-op rather than a moved
  end date.
- **`listMembershipsForDriverGroup`** gained `includeEnded`, default **false**.
  Closing instead of deleting would otherwise have made the members tab list
  everyone who ever left, growing silently and never shrinking. `MembershipRow`
  gained `endedAt` so `includeEnded: true` is usable at all.

### A parser bug that every ISO-8601 fixture would have hidden

Postgres returns a range with a space separator and a **two-digit offset**, and
the offset is the easy half to miss: JavaScript's `Date` rejects a bare
two-digit UTC offset outright — ECMA-262 wants four digits or a `Z`. A parser
written against ISO-8601 fixtures passes every test and then reads **nothing at
all** from the database. Every range literal in the test file is therefore in
Postgres's shape, quotes and space included.

**Membership tests — 13, and two more fool tests.** Includes the upper bound
being exclusive and the lower inclusive; the gap between two stays returning
null; and **the old rule executed**, showing the row a `.limit(1)` returned is
a membership that ended in March.

| fool | mutation | failed |
|---|---|---|
| 4 | offset normalisation removed from the timestamp parser | **6** |
| 5 | an unparseable range grants membership | **2** |

Fool 5 covers the direction that matters: this value decides access, so every
unreadable shape is "not a member". Guessing is how a closed membership becomes
an open door.

**Checks at Phase 2 close:** tsc 0, **1,741 passed / 1 skipped / 95 files**,
`npm run check` **16 of 16**, `check:schema-consistency` at **84 tables / 1,026
columns** (from 81 / 982).

---

## Phase 3 — items 4, 11, 12: the hierarchy, the vocabulary, the config

### Migration `0007_mean_overlord.sql` — generated, hand-extended, UNAPPLIED

**Verb census:** 1 CREATE TABLE, 1 CREATE INDEX, 3 ALTER TABLE — one ADD COLUMN
(nullable) and two ADD CONSTRAINT. Zero DROP, TRUNCATE, INSERT, UPDATE, DELETE.

### Item 4 — the hierarchy, expressible before an importer needs it

`assets.evses` gains `device_id`, **nullable**, and it is not backfilled. Both
parents coexist until `charging_stations` retires: a backfill in the same
migration that adds the column would have to invent the device rows it points
at, and there is no reconciled mapping yet.

**I did not edit the importer.** The round-4 split is *the columns are mine,
the importer is B's*, and `zaptec-import.ts` is B's to change. The three
inventions are recorded for B in the responses file rather than fixed here:
one EVSE at index 1, one connector typed `Type2`, and — different in kind —
`warrantyExpires = installDate + 5 years`.

**The warranty one is fabrication, not merely under-modelling.** It is a number
no vendor supplied, stored in a column whose name asserts it came from
somewhere. `devices.warranty_expires` is nullable precisely so that **no
warranty date is available as an answer**, which is the difference between "we
do not know" and a wrong date a claim gets denied against. For a Zaptec Pro the
1:1:1 is genuinely true, and that is what makes it dangerous: a coincidence
that reads as a model, until the first DC unit is imported.

### Item 11 — the vocabulary, and a constraint shape that fits what is known

The nine OCPP 1.6 §4.9 values live in
`packages/shared/src/domain/ocpp-connector-status.ts`, verbatim and in the
spec's order, with a **case-sensitive** parser: a charger sending `charging` is
refused by name rather than absorbed, because absorbing it means the stored
value is no longer the protocol's.

`SuspendedEV` and `SuspendedEVSE` are kept apart with a test that says why —
"the car stopped it" versus "we stopped it" is the distinction a driver support
call turns on, and it is the first casualty of any house enum. OCPI's
`EVSE.status` is a different vocabulary again, so OCPP → house → OCPI loses it
permanently; OCPP → OCPI is a stated conversion.

**`unknown` is kept as the not-observed sentinel and is deliberately NOT
`Unavailable`.** This is the sharper version of ledger note 22: OCPP *has* a
status called `Unavailable`, so writing it for a connector we have never heard
from would look like reporting rather than inventing. It is a different claim —
`Unavailable` means the charger told us it is out of service — and a connector
that has never reported is not one an operator should be dispatched to.

**The CHECK constraints are `NOT VALID`, which is a decision and not a hedge.**
`NOT VALID` enforces on every INSERT and UPDATE from that moment and does not
scan existing rows. Both are true and both matter: no database in this lane has
been read, `status` has always been plain `text` with no constraint, so what is
actually in those columns is unknown — a validating constraint would fail the
whole migration on the first non-conforming row. And it stops the bleeding
immediately regardless. The census query and the two `VALIDATE CONSTRAINT`
statements that finish the job are written into the migration; `VALIDATE` takes
only `SHARE UPDATE EXCLUSIVE`, so there is no reason to defer it past the
census.

`evses.status` gets the same constraint: OCPP 1.6 reports per connector and
treats `connectorId 0` as the station, so an EVSE's status is the same alphabet
read at a different level — not a second vocabulary that happens to look alike.

**Connectors gain no `period`.** ADR 0054 decision 4 is explicit that a
connector is not a dated membership; it is a child of the device and does not
migrate between devices.

### Item 12 — the four fields, behind the locked port

`VendorConfigSinkPort` is **verbatim as specified**; no CR-3 was needed and
nothing about it blocks B. `apps/api/src/lib/vendor-config/` holds the port,
a fixture adapter, a Drizzle adapter (written, never executed) and the tests.

`assets.vendor_config_observations` is an **append-only log, one row per
CHANGE rather than one per poll**. An importer polling every five minutes would
otherwise write a row per poll and produce a history in which nothing ever
happened. The dedup ignores `observed_at` and the cost of that is stated at the
function: the log answers "what did this charger last report" and "when did it
change", but **not** "when did we last successfully poll it" — a different fact
that wants its own column, not a duplicate row.

**Why a log rather than four columns with four timestamps.** Item 12 asks for
each field to carry a timestamp. Four columns give four timestamps that can
disagree — one row claiming `charger_active` was read at 09:00 and
`auth_required` at 09:05, from a single response. The log gives every field the
timestamp of the observation it appeared in, which cannot disagree, and answers
what four columns cannot: `fieldChangedAt` reports when each field last
**changed**, as opposed to when it was last seen.

**Dedup is against the LATEST observation only, never the whole log.** A
charger going active → inactive → active must record three rows; matching
anywhere in history would swallow the third and leave a log saying it was never
reactivated. Tested.

**`AuthenticationType` is not authentication.** It is the integration path —
0=Native, 1=WebHooks, 2=Ocpp, 3=OcppNative — an *installation* property that
reads 2 uniformly fleet-wide and can never indicate per-charger driver auth.
Two different wrong readings of that field have already been committed to this
repository and corrected; the warning is carried on the type, on the column and
in the Prisma mirror so a third has to be written past three signs.
`IsAuthorizationRequired` is the driver-auth flag. It is persisted anyway,
because a field that reads 2 uniformly today is evidence, and the day one
installation reads 3 is a day we want a record of.

`PropertyOcppDefaultIdTag` is stored as **a token, never a person**. Sessions
arriving under it have no driver, and a driver count that includes them is
wrong — which is the same defect the active-driver work named in round 2.

### The Dalvegur predicate — stated precisely, implemented in Phase 5

    20  chargers ACTIVE at Dalvegur
    15  chargers DEACTIVATED
    35  in the Zaptec portal        (20 + 15)
    30  rows in our database

Two gaps, and they fail in opposite directions:

**30 vs 20 — the one this phase closes.** Ten of our thirty rows are
deactivated chargers. Per-connector billing over unfiltered rows **invoices 30
where 20 exist** — at 200 kr per active connector, 6,000 kr against 4,000 kr of
real estate, on one site, every month.

**35 vs 30 — an IMPORT gap, and no predicate can see it.** Five portal chargers
have no row here at all, and a row that does not exist cannot be filtered in.
It under-bills, and it needs a reconciliation rather than a `WHERE` clause. It
is named separately because the two have nothing in common but arithmetic.

> **A connector is billable in period P when**
> **(a)** its device had a **placement overlapping P** (decision 5) **and**
> **(b)** the **latest vendor-config observation strictly before the end of P**
> has `chargerActive === true`.

Four things the predicate deliberately does not say:

1. **Not `chargerActive` as of now.** Billing March in April must use what was
   true in March, which is why `activeForBilling` takes the period end.
2. **A missing observation is not "inactive".** That is the `false`-is-not-
   `unavailable` trap: a device never polled would silently drop out of the
   invoice. Missing is `unavailable`, and an unavailable count is a **hold**,
   not a smaller number — round 3's rule, unchanged.
3. **It does not consult connector STATUS.** A charger that was `Faulted` when
   someone ran the query was still on site all month. `isServiceable` answers
   the operations question and lives in the other module for that reason.
4. **It does not filter on the portal count.** See the import gap above.

### Tests — 30, and four fool tests

Sink 10 · Dalvegur predicate 8 · `fieldChangedAt` 2 · status vocabulary 10.
Including a device whose `Charger.Active` **flips mid-period** (and the same
log billed for the *previous* period, which must not see it); an observation
**byte-identical to the last** returning `unchanged` with no row written,
asserted through a recorded `writes` list; an observation that exists only
*after* the period, which is `unavailable` rather than evidence; and the whole
estate executed — 30 rows in, 20 billable, 10 named, 0 unavailable.

| fool | mutation | failed |
|---|---|---|
| 6 | `unavailable` collapsed into `not_billable` | **1** |
| 7 | `null` and `false` conflated in `sameReading` | **1** |
| 8 | the status parser made case-insensitive | **1** |
| 9 | `STATUS_NOT_OBSERVED` set to `Unavailable` | **1** |

Fools 6 and 9 are the pair worth reading together: both are the same mistake —
turning an absence into a claim — at two different layers, and each is the
change a reasonable person would make while tidying.

**`check:unused-exports` baseline moved**, and the direction matters:
`makeDrizzleVendorConfigSink` was added (deliberately ahead of its caller, like
every Drizzle adapter in this lane) and **four entries were removed** because
`halfUpDiv`, `multiplyMinorByDecimal`, `orgInScope`, `makeActivitySourcePort`
and `runActivityAggregation` now have callers.

**Checks at Phase 3 close:** tsc 0, **1,771 passed / 1 skipped / 97 files**,
`npm run check` **16 of 16**, `check:schema-consistency` at **85 tables / 1,035
columns**.

---

## External state — running

No push. No deploy. **No migration applied to any database — `0002`, `0003`,
`0004`, `0005`, `0006` and `0007` all remain generated and unapplied.** No SQL
against any environment, no socket opened, no database connected to. No
Cloudflare, Neon or GitHub mutation — the Neon MCP tools are available to this
session and **were not used**, because operating rule 3 forbids it. No charger
or hardware action, no BLE/NFC. No branch or tag deleted, no `git clean`,
reset, rebase, amend or force.
Nothing under `packages/contracts/**` or any of B's paths edited.
`dev/market-rails` was read at `ae99700` and never merged; its SR file was read
with `git show` and answered in a file on this branch. **`zaptec-import.ts` was
read and NOT edited** — the importer is B's. Every fixture value is synthetic;
no checksum-valid kennitala, no real idTag, no token value appears anywhere.
The only branch written to is `dev/core-billing-integration`.

---

## Phase boundary re-checks — B's SR channel

| boundary | `dev/market-rails` | SRs | action |
|---|---|---|---|
| Phase 0 | `7cc591e` | file absent | none |
| Phase 2 | `ae99700` | SR-1, SR-2, SR-3 | all three answered |
| Phase 3 | `d9a8b18` | unchanged — `git diff` between the two tips over that path is **empty** | none |

The channel rule is that an earlier SR is never rewritten. Checked rather than
assumed: the diff is empty, so nothing I answered has moved under me.
