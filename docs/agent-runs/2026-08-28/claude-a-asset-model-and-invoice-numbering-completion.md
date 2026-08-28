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

## Phase 4 — items 5 and 6: memberships and sessions

### Item 5 — folded into migration `0006`, with the reason written down

The prompt allowed `0006` or `0005` with a written reason. Neither happened
exactly: **item 5 landed early, in `0006`, because B raised SR-2 asking for the
same change at the Phase 2 boundary.** Doing it twice was not an option and
doing it later would have left B blocked on a Drizzle adapter for two phases.
So `0006` carries SR-1 and SR-2 together: one migration, one `btree_gist`
dependency, one review.

What Phase 4 owed beyond the schema is here: the tests, and the predicate.

**The membership change was not additive and the honest census is in `0006`:**
`UNIQUE (driver_group_id, user_id)` is dropped and replaced by a plain index
plus the temporal key. Two `UPDATE`s backfill the interval from `added_at`. It
is the only non-`CREATE`-only migration this round and it says so at the top.

### Item 6 — migration `0008_worthless_mimic.sql`, additive only

**Verb census:** 3 ALTER TABLE (all `ADD COLUMN`, all nullable), 1 CREATE
INDEX. No DROP, no UPDATE, no backfill, nothing made NOT NULL.

**Requirement 2 — sessions were already tenant-safe, checked before adding
anything.** `charging.sessions` carries `org_id`, `site_id`,
`charging_station_id` and `evse_id`, and **all four are NOT NULL**. So a
session already survives a device moving tenant: nothing about it is resolved
through the charger row at read time. What it did *not* carry is the placement
and the tariff, which are the two facts a dispute turns on.

Three columns added:

| column | why |
|---|---|
| `placement_id` | the placement live at session start |
| `tariff_snapshot_json` | the tariff **as applied**, copied in |
| `tariff_snapshot_at` | when the snapshot was taken |

**One is a reference and one is a copy, and the difference is the point.** A
placement row is immutable in the ways that matter — `device_id`, `org_id` and
`installation_id` never change, only the period's upper bound closes — so
pointing at it cannot cause re-attribution. A rate reference is *not* immutable
in that sense: rows are effective-dated and superseded, so resolving "what did
this cost" against today's rows is the re-derivation FOCUS rule 4 forbids. OCPI
`mod_cdrs` makes the same split, copying the location in rather than
referencing it.

`tariff_snapshot_at` exists even though it will almost always equal
`started_at`. "The tariff we sealed" and "the moment the session began" are
different facts, and a gap between them is a bug worth being able to see — a
snapshot taken at **stop** time silently prices a session straddling a rate
change at the wrong rate. That case is a test.

**Not backfilled, on purpose.** Every existing session gets NULL in all three.
Back-filling `placement_id` means deciding where each device was during a
period nothing recorded; back-filling the tariff means running today's resolver
over yesterday's sessions, which is the exact thing the column prevents. NULL
is `unavailable`, and a test asserts it is **not a zero price**.

`charging.sessions` is not a partitioned table — `charging.meter_values`,
`events.event_log` and `events.protocol_log` are, and this is none of them — so
the `ADD COLUMN`s are catalogue-only and take a brief lock on one relation.

`JSONB` rather than columns for the tariff because a tariff is not one number:
an org may be on per-kWh and per-minute at once, and flattening that into
columns fixes an arity the agreement model deliberately leaves open.

### Requirement 3 — the predicate for B's item 9, not implemented here

`docs/notes/2026-08-28-membership-validity-predicate.md`. The schema serves it;
A does not write the check.

- **at an instant** — `m.period @> $at`, lower-inclusive, upper-exclusive.
- **over a period** — `m.period && tstzrange($start, $end, '[)')`. **Overlap,
  not currency**: a driver who joined on the 2nd and left on the 28th was a
  member in March, and `period @> now()` run in April finds nobody.
- **counting** — `count(DISTINCT m.user_id)`, and `DISTINCT` is still required:
  the constraint forbids *overlapping* rows, not multiple rows, so a driver who
  left in March and returned in July legitimately has two.

Three things it must not do: read `added_at` (that is when the ROW was written,
not when the membership was valid — a backdated membership has today's
`added_at`); treat no rows as zero (ledger note 22 — reuse
`activity-source.ts`, do not reinvent); or use `BETWEEN`, which makes the upper
bound inclusive and double-counts the one instant a move-out and a move-in
share.

### Tests — 13 new, and a fool test that reaches across four files

`session-seal.test.ts` 10 · `effective-dating.test.ts` +3 for item 5.

The four cases the phase names, each present:

1. **Move-out then move-in for one user in one group** — two rows, both kept,
   each answering for its own months, and April in the gap correctly having
   neither. Under the old pair unique the second row collided with the first,
   so the only way to re-add a driver was to delete the record of their first
   stay — and a driver count for last February, run afterwards, silently lost
   them.
2. **Two overlapping memberships rejected** — with the double-count it prevents
   computed rather than asserted: two live rows make any summing count the
   person twice. This is the membership version of the double-invoice.
3. **A session sealed with a placement that later closes** — the placement is
   closed, then the device moves to another org; the session still names the
   original host, and the test also asserts what a *re-derivation* would have
   returned, so the failure mode is visible rather than described.
4. **A session whose tariff changed after it started** — keeps the sealed price
   against a superseded rate, carries the whole applied rate rather than a
   code, and the straddling-rate-change case shows why the snapshot is taken at
   start.

Plus the boundary case that makes the half-open interval earn its keep: a
session at exactly midnight on move day belongs to the **new** host, because
the old placement ends at that instant and does not contain it. **No instant is
claimed by both and none by neither.**

| fool | mutation | failed |
|---|---|---|
| 10 | `overlaps` upper bound made inclusive | **10, across 2 files** |

Fool 10 was run against the whole domain suite rather than one file, because
the seal, the memberships and the placements all rest on the same `overlaps`.
Ten failures in two files is the evidence that they actually do.

**Checks at Phase 4 close:** tsc 0, **1,784 passed / 1 skipped / 98 files**,
`npm run check` **16 of 16**, `check:schema-consistency` at **85 tables / 1,038
columns**.

**SR channel at the Phase 4 boundary:** `dev/market-rails` still `d9a8b18`,
still three SRs, diff over that path empty. No new request.

---

## Phase 5 — item 7: billing counts overlap

### What was wrong, and which direction it failed in

`gatherConnectorEvidence` derived a connector from three kinds of evidence —
a session, a StatusNotification, a human assertion — and **every one of them is
attributed by the SESSION's org**. There was no placement in the picture at
all, so:

- a device placed on the 2nd and removed on the 28th, with no sessions, was
  invisible: 26 days of hardware, nobody billed;
- a device that moved on the 12th had its whole month attributed to whichever
  host's rows happened to be there.

The second is the worse one. It bills the **wrong** host rather than no host,
and the invoice looks right to everyone except the two people it is wrong for.

### The fix — a fourth evidence tier, not a replacement

`ConnectorEvidence` gains `placements`. The three derived tiers stay exactly as
they were, because they answer a different question: they say a connector was
*used*, and the flat fee is not a usage fee. **200 kr per active connector per
month is a PRESENCE fee**, and presence is what a placement records — which is
why the placement tier is the one attributed by the placement's org rather than
the session's.

The query joins `assets.placements → assets.evses → assets.connectors` with
`p.period && tstzrange(start, end, '[)')`. **Written and never executed** —
migrations 0005 and 0007 are unapplied — so the decisions live in
`apps/api/src/lib/billing/placement-evidence.ts` where a fixture can drive
them. `e.device_id` is nullable during the transition, so an EVSE still
parented only to a `charging_station` produces no row here and falls through to
the three tiers above rather than silently vanishing.

**The `(org_id, period_year, period_month, connector_id)` key on
`connector_assertions` and `connector_activity_month` is untouched.** A device
that moves mid-month naturally produces one row per host under it — that shape
was right before anyone knew why, and it is what made this a change to the
*evidence* rather than to the schema underneath it.

### Requirement 2 — Dalvegur, old derivation and new

The dry run prints the old number today, unchanged:

> `connector count 30 — DERIVED from 30 activity rows (3 session_observed, 26 status_available, 1 manually_asserted)`

| derivation | count | why |
|---|---|---|
| **old** — activity rows, unfiltered | **30** | every row in our database, ten of them vendor-deactivated |
| **new** — placement overlap **and** `Charger.Active` | **20** | the ten deactivated rows fail half (b) |
| in the Zaptec portal | 35 | five have no row here at all |

**6,000 kr against 4,000 kr of real estate, on one site, every month.** The
five missing rows fail the other way and no predicate can reach them: a row
that does not exist cannot be filtered in. That is an import gap needing a
reconciliation, and it is named separately for exactly that reason.

### Requirement 3 — the proration fork, decided as far as it is mine to decide

**One fee to one host is ruled out first**, because it cannot be made
non-arbitrary: whichever host is chosen is wrong for the other, and the only
rule that is not a coin flip — "whoever holds it at month end" — makes the fee
depend on **when the query runs**, which is precisely what decision 5 forbids.
A device moving on the 28th would bill the new host for a month it held for
three days.

Between the two that survive:

**I argue for `prorate_by_overlap_days`.** ADR 0054 names it twice — decision 5
says the device "belongs to the old host for eleven days and the new one for
the rest", and "What this aligns with" lists overlap-based proration as the
ordinary subscription convention. It gives one device-month a total of one fee
however many hosts held it, which is the property that makes the invoice
explainable to both of them. It also composes with FOCUS rule 3: proration is a
multiplier on a quantity, the engine still prices one rate against one count,
and neither money line learns about placements.

**The default is `whole_month_per_host` anyway, and that is deliberate.**
It is what the system does today, and **changing what an invoice says must not
be a side effect of a schema change.** Flipping it is one constant in
`placement-evidence.ts` plus a decision that is Andri's. Both branches are
implemented, both are tested, and a test asserts that the implicit default
equals the explicit one — so the default cannot drift without a test failing.

**If proration is chosen, one thing moves with it:** the 450 kr per connector
per month cap is expressed in whole connector-months and would have to apply to
the prorated total rather than to each host's share. Recorded because it is the
kind of thing that gets missed when a switch is flipped six weeks later.

### Requirement 4 — the dry run, and two bugs it caught in its own case

`scripts/dry-run-first-invoice.mts` gains `mid-month-move`: one device, one
connector, host A `[Jan 15, Mar 12)`, host B `[Mar 12, )`. **Two invoices
print.** 9/9 cases behave.

**Every pre-existing case is byte-identical**, verified by diff rather than by
eye: `--all` output lines 1–78 and the whole default happy-path run match the
pre-change capture exactly.

Writing the case found two real defects, both in code the case itself exercises:

**1 · A dropped sequence state.** `issue` is pure and returns the next state;
the first draft passed the same `seq` to both hosts and discarded the return.
Both invoices came out `SV-2026-000001` — **which is also the correct answer**,
because migration 0004 keys the series `(org, series, year)` and two hosts each
legitimately hold ordinal 1. The bug and the correct behaviour are
indistinguishable in the output. The case now allocates a second document for
host A and prints it: `SV-2026-000002` proves the state was threaded, and the
line reads `<- STATE WAS DROPPED` if it was not. `behavedAsExpected` is gated
on it, so the case fails rather than printing a plausible number.

**2 · Proration lost an eyrir.** Dividing each share independently printed:

```
  Hýsill A  11/31 × 200,00 kr.  =   70,96 kr.
  Hýsill B  20/31 × 200,00 kr.  =  129,03 kr.
  total for one connector-month     199,99 kr.
```

Both truncate, and the missing eyrir goes nowhere. Silent, once per moved
device, and worse the more hosts a device passes through. Fixed by allocating
**cumulatively** — each host gets the running total minus what has already been
given out, so the last share absorbs the remainder:

```
  Hýsill A  11/31 × 200,00 kr.  =   70,96 kr.
  Hýsill B  20/31 × 200,00 kr.  =  129,04 kr.
  total for one connector-month     200,00 kr.
```

**And a structural finding that came out of trying to print it: the feeder
cannot express proration today, and this is not a gap in the switch.**
`measured()` in `flat-fee.ts` throws unless the count is a non-negative
**integer** — deliberately — so a prorated share cannot be passed as a smaller
count. `11/31 of a connector` is not a connector count, and pretending it is
would put a rounding decision in the layer that counts rather than the layer
that prices. What proration would actually need: a per-line
`(numerator, denominator)` carried into the money engine and applied after the
rate, with `roundAurarToIsk` doing the rounding. **One contract change, not a
second engine** — FOCUS rule 3 survives it. Costed here so the fork is decided
with that in view rather than discovered afterwards.

### Tests — 24, and the fool test lands where it should

`placement-evidence.test.ts` 19 · `dry-run-first-invoice.test.mts` +5.

All five named cases present: a device that **moves on the last day** (one day,
and under the default that is a full fee — the case that makes proration
arguable); a device that **moves twice** (three hosts, 9 + 10 + 12 = 31 days);
a device **placed after the period ends**; a placement that **opens and closes
inside one day** (0 whole days of overlap and emphatically not 0 placements —
the host had the hardware); and **no placements at all**, which is
`unavailable` and never zero.

Plus the distinction note 22 turns on, as its own test: a **vendor-deactivated**
device returns `counted` with an empty list, not `unavailable`. We looked, we
have the evidence, the answer is genuinely "none of these are billable".
**Measured zero is legal; assumed zero is not.**

| fool | mutation | failed |
|---|---|---|
| 11 | the overlap join reverted to a current-row read (`period.until === null`) | **8** |

Named tests that fail: *"bills a device placed on the 2nd and removed on the
28th"*, *"a device that moves mid-month produces ONE ROW PER HOST"*, *"a device
that moves on the LAST DAY still gives the new host a row"*, *"a device that
moves TWICE gives three hosts three rows"*, and four more. Requirement 6 asked
for one; eight is the shape of a regression that could not hide.

**Checks at Phase 5 close:** tsc 0, **1,808 passed / 1 skipped / 99 files**,
`npm run check` **16 of 16**, dry run **9/9**, `check:schema-consistency` at
**85 tables / 1,038 columns**.

---

## Phase 6 — items 10 and 13: attach, detach, and closing as a state

### What the constraint does, and what the port adds

The temporal key on `assets.placements` is the enforcement. **A move that skips
the detach fails at write time**, in the database, on a write made by anything
at all — this code, a script, psql, a service written next year. That is item
10's requirement and it is not satisfiable by an application check, because an
application check is only as good as the set of applications that run it.

What the port adds is **a refusal a caller can read**. Surfacing SQLSTATE
`23P01` to an operator who attached a device to the wrong site tells them
nothing; `device_already_placed_elsewhere` with the conflicting placement named
tells them what to do. The pre-check loses every race and that is fine — the
constraint has the last word, and **both paths refuse under the same name**.

**Two names for one constraint violation**, because the operator's next move
differs: an OPEN placement elsewhere means "detach first, or use `moveDevice`";
a CLOSED one overlapping means the history is wrong, which is a different
conversation. Both are refused; a partial unique index would have permitted the
second.

**The SQLSTATE fork is closed in code.** Migration 0005 ships Form A (`EXCLUDE`,
`23P01`) active and Form B (`UNIQUE … WITHOUT OVERLAPS`, `23505`, PG 18+)
commented. `isOverlapError` treats both identically, so switching forms is a
migration and not a code change — and the failure it prevents would have been
silent, because an unhandled error surfaces as a 500 rather than a named
refusal. There is a test for exactly that.

### Item 10 — attach, detach, move

`repositories/placements-port.ts` (the port and the shared decisions),
`fixture-placements.ts`, `placements.ts` (Drizzle, **written and never
executed**), `devices.ts`, `fixture-devices.ts`.

**`attachDevice` is idempotent**: attaching a device already open at that
installation returns the existing placement — never a duplicate, never an error
that would hide a real one. Attaching to a *different* installation while open
is a **refusal with a named reason**, not an implicit move: an implicit move
silently re-tenants a device.

**An explicit move is atomic.** `moveDevice` closes and opens **in one
transaction**, with `SELECT … FOR UPDATE` on the open placement. Two separate
calls can be interrupted between them, and the state in between — a device
placed nowhere — is one a billing run can observe: the period shows a gap and
the new host is under-billed for it. The two intervals **touch and do not
overlap**, `[x, at)` and `[at, )` — which is the whole reason the interval is
half-open. Under a closed upper bound every move would be a constraint
violation.

The fixture rolls back on a refused move, so a refused move leaves the old
placement **open**. A partial move is the one outcome worse than a refused one.

**`mutation_receipts` on every mutating operation**, scoped
`placement.attach` / `placement.detach` / `placement.move`, and **a missing
idempotency key is a refusal, never a generated one** — round 1's rule,
unchanged. Tenancy is checked on every call, including both orgs on a move.

### Item 13 — closing is a state

`detachDevice` sets the period's upper bound and **keeps the row**. OCPI
requires `status: REMOVED` rather than removal, and a deleted row takes the
session history's context with it. The `UPDATE` is bounded to `upper_inf`, so a
second detach cannot move an end date already recorded.

`not_placed` is **not an error**: "never attached" and "already detached" are
both the state the caller asked for, and turning that into a failure makes a
retried teardown script noisy for no fact.

A detach **at or before** the attach is refused. Closing there makes the range
empty, which the CHECK constraint refuses — and an empty placement is a claim
the device was never there, which is not what a detach means.

**`devices.ts` has no delete and will not get one**, asserted structurally
rather than described: a test enumerates the port's keys, because a port that
grew a `delete` later would pass every other test in the file. Retirement is a
state, for the same reason.

### `createCharger` — left in place, marked, and scheduled

Not changed, and that is a decision rather than an omission. B's onboarding
path reaches it through `onboarding-chains.ts`, which is **B's file**; changing
both sides in two trees is the merge conflict this boundary exists to prevent.
Its docblock now says what replaces it, where, and why. The call-site migration
is in the retirement plan for round 5, with the ordering constraint spelled
out: **retiring it before the backfill would leave two paths writing to
different tables for one physical charger.**

### One thing the schema cannot do, reported rather than hidden

`(vendor, serial_number)` is UNIQUE and both columns are NULLABLE — because
OCPP 2.0.1 makes `serialNumber` optional and 1.6 offers three competing serial
fields. **Postgres treats NULLs as distinct in a unique index**, so two
unserialised devices do not collide, which is correct — and it also means an
unserialised device **cannot be deduplicated**. Registering the same one twice
makes two rows and no constraint can prevent it.

`checkRegister` returns `dedupable: false` for that case rather than papering
over it, so an importer can refuse, ask, or accept the duplicate knowingly.
What it must not do is pretend the second row is the first. A serial with no
vendor is refused outright: serials are vendor-scoped, and storing one without
its vendor makes the unique index meaningless for that row without saying so.

### Tests — 31, and two fool tests

`placements.test.ts` 21 · `devices.test.ts` 10. All six named cases present:

| case | test |
|---|---|
| the atomic move | *"closes and opens at the SAME instant, and the intervals touch"* |
| the skipped detach fails at write time | *"a MOVE THAT SKIPS THE DETACH fails at WRITE time"* — asserts **both** the readable refusal and, reaching past the port, that the write-time predicate refuses independently |
| cross-installation attach refused | *"REFUSES a cross-installation attach — never an implicit move"* |
| detach of a device never attached | *"…is not_placed, not an error"* |
| detach twice | *"does not move the end date that was already recorded"* |
| cross-tenant attach refused | *"refuses a cross-TENANT attach — FOCUS rule 5"* |

Plus the ADR's double-invoice reached through the repository: a **backfilled
closed row** overlapping an existing one is refused, which is the case a partial
unique index would have permitted.

| fool | mutation | failed |
|---|---|---|
| 12 | only Form A's SQLSTATE handled | **1** |
| 13 | `classifyAttachConflict` ignores closed rows (the partial-index behaviour) | **1** |

**`check:unused-exports` baseline moved**: `makeDrizzleDevices` and
`makeDrizzlePlacements` added, deliberately ahead of their callers like every
Drizzle adapter in this lane, and `gatherConnectorEvidence` **removed** because
Phase 5 gave it one.

**Checks at Phase 6 close:** tsc 0, **1,839 passed / 1 skipped / 101 files**,
`npm run check` **16 of 16**.

---

## §10 — the gate table, row by row

| # | gate | | evidence |
|---|---|---|---|
| 1 | baseline recorded; deviation reported | **met** | 1,689 / 16-of-16 matched exactly; three Phase-0 findings recorded instead |
| 2 | SR file read Phase 0 and every boundary; each serviced or refused in writing | **met** | absent at P0; three SRs at P2, all answered in `2026-08-28-round-4-schema-responses.md`; re-checked at P3–P6, diff empty |
| 3 | numbering invariant stated, mechanism named, cost stated | **met** | unique vs gap-free; counter row over `SEQUENCE`; serialises per `(org, series, year)` |
| 4 | `0004` generated, unapplied, `CREATE` only, natural-key unique | **met** | 2 tables, 4 unique indexes, 1 index, zero destructive verbs |
| 5 | allocation transactional with issue; per-org per-year; crash semantics stated and tested | **met** | `SELECT … FOR UPDATE`; "a failed transaction consumes nothing" |
| 6 | ≥8 numbering tests incl. concurrency, retry-same-key, retry-different-key rejected, rollover | **met** | **15** |
| 7 | `devices` surrogate PK, `(vendor, serial)` unique nullable, lifetime counters, placement columns stripped | **met** | migration `0005` |
| 8 | `device_identities` dated, temporal key | **met** | two keys — `(device, period)` and `(identity_string, period)` |
| 9 | `placements` dated, temporal key, stable public id from day one | **met** | `public_id` = OCPI `EVSE.uid` |
| 10 | both constraint forms emitted, with which to apply and what differs | **met** | Form A active, Form B commented, three differences named |
| 11 | the double-invoice proven to fail at write time **and** to pass under the partial index | **met** | `"ADR 0054 double-invoice: the worked example"`, 4 tests |
| 12 | Drizzle / raw-SQL divergence documented, not silent | **met** | banners in `assets.ts`, `commercial.ts`, `0005`, `0006` |
| 13 | ≥15 placement/identity tests incl. adjacency, unbounded, move-out/move-in | **met** | **27** in `effective-dating.test.ts` |
| 14 | EVSE/connector hierarchy from `BootNotification`; **the 1:1:1 invention removed**; connector not a membership | **PARTIAL — see below** | columns and hierarchy done; the invention is in B's importer and was not edited |
| 15 | protocol status vocabulary verbatim; no house enum | **met** | nine values, case-sensitive parser, `NOT VALID` CHECK on both tables |
| 16 | four vendor-config fields persisted with timestamps behind the port as specified | **met** | signature verbatim, no CR-3 needed |
| 17 | billing predicate under `Charger.Active` stated, Dalvegur old vs new | **met** | 30 → 20, with the 35 − 30 import gap named separately |
| 18 | membership interval added, pair unique dropped, temporal key in place | **met** | migration `0006` (early, via SR-2) |
| 19 | sessions additively gain `placement_id` + tariff snapshot; existing context confirmed intact | **met** | four columns confirmed `NOT NULL` before anything was added |
| 20 | membership-validity predicate recorded for B | **met** | `2026-08-28-membership-validity-predicate.md` |
| 21 | `gatherConnectorEvidence` joins placements overlapping the period | **met** | fourth evidence tier, attributed by the placement's org |
| 22 | proration decided and justified, or both branches behind a named switch with the fork documented | **met** | both; recommends proration, defaults to today's behaviour, and the cap consequence recorded |
| 23 | dry run extended with a mid-month move; prior cases green and byte-identical | **met** | 9/9; lines 1–78 diff-identical |
| 24 | ≥10 overlap tests incl. no-placements → `unavailable`, never zero | **met** | **19** |
| 25 | attach/detach over ports; skipped detach fails at write time; move atomic | **met** | one transaction, `FOR UPDATE`, rollback on refusal |
| 26 | `createCharger` left as a marked shim; call-site migration deferred | **met** | docblock + retirement plan |
| 27 | `mutation_receipts` on every mutating device operation; missing key refuses | **met** | three scopes; refusal tested for each |
| 28 | tenancy proven on every new read and every new write | **met — with a stated exception** | see below |
| 29 | ≥6 fool tests, each proving a named real test fails | **met** | **13** |
| 30 | no migration applied to any database | **met** | `0002`–`0008` all generated, none executed |
| 31 | completion `.md` and `.json` written and committed after every phase | **met** | `.md` after each of six phases; `.json` with this commit |

**29 met, 1 met with a stated exception, 1 partial.**

### Gate 14 — partial, and why it was not closed

The gate has three clauses. Two are met: the hierarchy is `device → EVSE →
connector` with `evses.device_id` added and every field sourced from
`BootNotification` given its own `observed_at`; and a connector gains no
`period`, per decision 4.

**The third — "the 1:1:1 invention removed" — is not done, and I chose not to
do it.** The invention is in `apps/api/src/repositories/zaptec-import.ts`, and
§6 of the prompt says *"the columns are yours; the importer is B's"*. Editing
it would put the same change in two trees, which is the merge conflict this
lane boundary exists to prevent.

What was done instead: the columns now make the correct shape expressible, and
the three inventions are written up for B in the responses file with line
numbers — one EVSE at index 1, one connector typed `Type2`, and
`warrantyExpires = installDate + 5 years`. **The warranty one is different in
kind**: the first two are under-modelling, that one is fabrication.

**This is a coordination item, not a technical one.** It closes when B changes
the importer, or when a round explicitly assigns the file to A.

### Gate 28 — tenancy, and the one place it deliberately is not a column

Every new **read** and **write** on a tenanted table carries scope:
`placements` (`restrictToOrgIds` on attach, detach, and *both* orgs on a move —
tested), `driver_group_memberships`, `agreement_clauses`, and the placement
overlap query in `gatherConnectorEvidence`.

**`assets.devices` and `assets.vendor_config_observations` carry no `org_id`,
on purpose.** A device is not tenanted — that is decision 1. If it were, a
device moving between hosts would have to become a *different device*, which is
precisely the conflation ADR 0054 exists to undo, and its lifetime counters
would split across the two rows.

Tenancy for those two is reached **through the placement**: "which devices are
mine" is a join, not a column, and the scope check on the vendor-config port is
therefore `restrictToDeviceIds` rather than `restrictToOrgIds` — and it returns
`out_of_scope`, distinct from `never_observed`, so a caller is never told a
charger has no configuration when it simply cannot see it. That distinction is
tested.

FOCUS rule 5 says tenancy in every row and every query. **The honest reading
here is that the rule holds for every row that has a tenant**, and that a
device does not have one — which is a claim worth making explicitly rather than
quietly satisfying with a column that would be wrong.

---

## §11 fallback — item 1: the first-placement write path

**It did not exist.** ADR 0054 says the re-onboard creates the first
placements; nothing said what a *correct* first onboarding writes, and
`createCharger` writes the old shape and is marked for retirement. Design and
port only — no vendor call, no database, no HTTP.
`apps/api/src/repositories/onboard-device-port.ts`.

### What it writes, in order

| | table | note |
|---|---|---|
| 1 | `assets.devices` | idempotent on `(vendor, serial)` |
| 2 | `assets.device_identities` | the credential, dated |
| 3 | `assets.placements` | where it is, dated and **tenanted** |
| 4 | `assets.evses` | **only** from a `BootNotification` |
| 5 | `assets.connectors` | children of those EVSEs |

**One transaction**, and the half-states are named because each is a specific
operational failure rather than untidiness:

- **device + identity, no placement** — the charger connects and authenticates
  and bills **nobody**. Free electricity with a working audit trail.
- **device + placement, no identity** — the host is billed for a charger that
  cannot connect. Wrong in the direction nobody forgives.
- **placement, no connectors** — the flat fee counts connectors, so the host is
  billed for zero. This one had a defect of its own; see below.

A retry after a partial failure is worse than the failure: the device row is
idempotent but the identity and placement are not, so the second attempt
collides with the first half and the operator sees a constraint error naming a
row they never knowingly created.

**The order is not arbitrary.** Device first because everything references it.
**Identity second, before the placement**, because its uniqueness is the one
most likely to collide — an operator reusing an identity string from a unit
decommissioned last month — and failing early costs less work than failing
late. Placement third because it is the tenanted row and the one billing reads.
Children last because they are the only part that may legitimately be empty.

### The decision worth arguing, and what it broke

**A first onboarding with no `BootNotification` writes no EVSE and no
connector**, and reports `refusedToInvent: true`. Not an error: a charger is
often registered before it first connects, and refusing would make an operator
wait for hardware to phone home before they can record where they put it. What
it must never do is write one EVSE at index 1 with one `Type2` connector.

**A boot reporting ZERO EVSEs is refused, and that is a different case.** The
charger spoke and said it has nothing — a protocol bug, or a unit we should not
be billing for. **Silence and "I have nothing" are not the same claim**, and
this is the same distinction as `never_reported` versus `Unavailable` on
connector status.

**And it surfaced a live defect in Phase 5's code.** A placement whose device
has no connectors would have contributed nothing to `connectorSharesForPeriod`
— a **measured zero for a device we have never heard from**. That is ledger
note 22's exact failure reached from a direction nobody was watching: not an
absent row, but a present row with an empty list. The period now holds with
`unavailable: placement_without_connectors`, and it holds for the **whole**
period rather than skipping that device, because an invoice short by one
charger looks complete. A vendor-deactivated connectorless placement is skipped
*before* the check, so a decommissioned charger cannot block an invoice.

### The duplicate no constraint can catch

`acceptPossibleDuplicate` must be passed explicitly when `(vendor, serial)`
cannot deduplicate. **Defaulting it to `true` would make a double-onboarding
silent, which is how one physical charger ends up with two lifetime-energy
counters** — and decision 7 says those follow the asset and are never erased,
so the split would be permanent.

### What a partial failure leaves behind

Recorded as a value, `PARTIAL_FAILURE_CONTRACT`, so it cannot drift from the
adapter that has to honour it. Two cases and no others: **inside the
transaction, nothing is written**; **after commit but before the receipt
write**, the rows exist and the receipt does not, so a retry finds the device
already known, the placement already open, and either returns it or refuses by
name. That is recoverable and not silent — the most that can be promised
without the receipt write being inside the same transaction, which is where it
belongs and where the Drizzle adapter puts it.

**Tests — 15** (12 for the port, 3 for the defect it found). Suite **1,854
passed / 1 skipped / 102 files**, `npm run check` **16 of 16**.

---

## §11 fallback — item 2: census row 104, the cross-tenant enrichment view

`GET /api/admin/billing/enrichment`. `listEnrichmentSessions` read
`reports.session_ledger` with **no tenant term in either half** — the summary
`groupBy` and the session list — and is mounted behind `billing.read`, which
`requireAdmin` grants to **any org member, not only platform staff**. Any
tenant's admin could read every tenant's sessions, with charger and site
display names attached.

**The summary was the worse half.** A list of 100 rows is visibly a list; four
counts computed across *"the entire window, no row cap, no status filter"* read
as **your** numbers, and an operator has no reason to doubt them.

Fixed the same way as burn-down fixes 1 and 2: a **required**
`restrictToOrgIds` on the repository function, a shared `tenantWhere` used by
both halves, and the route supplying identity and nothing else. The repository
is the enforcement point for the reason the note already gave — a route can
omit a call, a required parameter cannot be omitted without the build failing,
and the route-side rule was written down once and still not followed for four
months.

**`scopeFrom` lives in the repository, beside the type it produces.** The first
draft put it in the route, which made the repository's own test import a route
— an edge `check:deps-graph` is right to refuse, and it caught it. The
conversion belongs on the same side as the enforcement.

`{ all: true }` maps to `null` (platform-wide, unchanged).
`{ all: false, orgIds: [] }` — what `resolveOrgScope` returns for an unknown
user — maps to `[]`, and **`[]` must not fall into `{}`**, which means
everything. That case is spelled out and tested rather than fallen into.

**Tests — 9**, including that both halves are confined *identically* (a tile
confined differently from the rows beneath it is worse than either being wrong
alone), and that the status filter is applied **on top of** the tenant term
rather than instead of it.

| fool | mutation | failed |
|---|---|---|
| 14 | an empty allow-list falls into "everything" | **1** |
| 15 | the summary left unconfined while the list is confined | **4** |

Fool 15's four failures are the point: the two halves are checked against each
other, so confining only one is not a partial fix that passes most tests.

Suite **1,863 passed / 1 skipped / 103 files**, `npm run check` **16 of 16**.
`docs/architecture/dependency-graph.md` regenerated.

---

## §11 fallback — item 3: the `missing-orgIdParam` gates

The allowlist held **36 file:verb pairs across 75 gate occurrences**, of which
33 still read *"unscoped when this guard was introduced, 2026-08-11"*. The
note's own rule is that these are *"worked down deliberately rather than in a
sweep nobody can review"*, so this is a slice, not a pass.

**Two entries paid in this round**, both in the billing tree, both with the
enforcement in the repository and a test that fails when it is removed.

### `billing-enrichment.ts` — the entry I made stale, corrected

Fallback item 2 scoped it and left the allowlist saying it was unscoped. That
line now reads what the other two scoped entries read: **the gate has no
`orgIdParam` and that is deliberate**, because the tenant comes from the
caller's memberships and not from a path parameter, with the enforcement named.
An allowlist whose reasons have gone stale is worse than a shorter one — it
records debt that has been paid as debt that is outstanding.

### `billing-driver-contracts.ts` — worse in kind than row 104

`listDriverMemberships` and `getDriverContractsTiles` both took an **optional
`orgId` read straight from the query string**, and `null` meant every row.
Mounted behind `billing.read`, which `requireAdmin` grants to any org member.

**A caller-supplied filter is not a tenancy control.** It confines the query
only for callers who choose to send it — which is exactly the set of callers
who were not the threat.

And this leak is different in kind from the enrichment one: those rows carry
`email`, `displayName` and `phone`. **Operational data versus personal data
about people who are not the caller's drivers.**

Fixed by reusing `decideLedgerAccess` — the same decision function the session
ledger uses — rather than writing a third variant of it. That buys the two
answers the old code could not give:

- naming **someone else's** org is a **403**, not a quiet narrowing to your own
  rows. Asking for something you may not have is a different act from omitting
  the parameter, and it deserves its own answer.
- a caller with **no memberships** is denied outright rather than handed the
  table. `resolveOrgScope` returns `{ all: false, orgIds: [] }` for that
  caller, and `[]` and `null` both look falsy and mean opposite things — which
  is asserted directly as its own test.

Both functions take a **required** `restrictToOrgIds` through one shared
`ownerOrgWhere`, so the tile strip cannot be confined differently from the list
beneath it. The requested `?orgId=` **intersects** with the allow-list rather
than replacing it, so a bug in the route cannot widen the answer in the
repository.

**Tests — 6.** Fool test 16: the empty allow-list falling into `{}` → **2
failed**.

### What remains, and it is not a small number

**31 file:verb pairs still carry the 2026-08-11 reason.** They are listed in
`scripts/check-orgid-param.mjs`, each is a debt rather than an approval, and
the `vanished` failure mode means paying one and forgetting to delete its entry
is itself a build failure. The remaining billing-tree entries are
`billing-contracts`, `billing-cost-centers`, `billing-cost-factors` (read and
write), `billing-dso`, `billing-electricity`, `billing-rate-references` (read
and write), `billing-tariff-detail` and `billing-tariff-mgmt`. The rest are
chargers, circuits, installations and sites, which are outside this lane.

**Not started rather than half-done**, deliberately: each needs its repository
scoped and a test, and a sweep of nine surfaces in one commit is the thing the
allowlist exists to prevent.

Suite **1,869 passed / 1 skipped / 104 files**, `npm run check` **16 of 16**.

---

## §11 fallback — item 4: Prisma → Drizzle in the billing tree

**Assessed and deliberately not done, with the reason stated rather than
skipped.**

FOCUS rule 1's exception is *touch it, convert it*, and I touched two Prisma
files this round: `billing-enrichment.ts` and `billing-driver-contracts.ts`.
Both were touched to fix a **cross-tenant leak**.

`billing-enrichment.ts` is the tractable one — five flat call sites, **zero
`include:`**, already using the two-pass batch-lookup pattern.
`billing-driver-contracts.ts` is not: nested `include` three levels deep
through `user`, `driverGroup` and `agreement`.

**Neither was converted, and the argument is the same one that made every
Drizzle adapter in this round "written and never executed" — read the other
way round.**

A NEW path that has never run costs nothing by being unexecuted: nothing
depended on it yesterday. Converting a **working** read path to Drizzle on a
branch with no database means replacing code that demonstrably works with code
that cannot be run at all — and doing it in the same commit as a security fix,
so the tenancy change becomes unreviewable inside the rewrite.

**What would make it safe:** a database to run the converted query against, or
a parity harness that runs both and compares. Neither exists in this lane, and
both are larger than the conversion.

**Recorded as owed**, not waived: `billing-enrichment.ts` is the one to take
first, and it is small.

---

## §11 fallback — item 5: the flat-fee scenarios

`docs/specs/flat-fee-billing.feature` — **34 scenarios**, and
`docs/specs/flat-fee-billing-coverage.md` mapping each one to a test or to a
named gap.

**Not executable, on purpose.** There is no Cucumber runner here and adding one
is a build change nobody asked for. What these are is the **acceptance
language**: the sentences an operator, an accountant and a host would each
recognise, written down before a UI exists to argue about them in.

Every case §11 names is present — month boundary, org with no connectors, org
added mid-period, **device moved mid-period**, cap edge, disputed line, a
period that holds, a re-run after correction, an asserted connector, and a
deactivated charger still in the vendor portal.

**The coverage map is what keeps the feature file honest: 24 covered, 10 gaps.**
A scenario with no test is a finding, and the gaps have a shape:

- **Eight of the ten are one gap wearing different clothes** — the fixture
  proves the decision and the SQL has never run, because no database has these
  migrations applied. That is this lane's deliberate shape, and it means the
  acceptance language is, for those rows, a promise rather than a fact.
- **Gap 3** — the cap applying to a prorated total — is unbuilt work with
  Andri's decision attached.
- **Gap 4** — five portal chargers with no row here — is **not a software gap
  at all**. No amount of testing reaches it; it needs a reconciliation against
  the vendor.

### Gap 1 was closed while writing the map

Which is the argument for writing it. *"A session that straddles the month
boundary counts once, in March"* was **true by construction and asserted
nowhere** — every window predicate reads `started_at`, and a future writer
keying on `stopped_at`, or adding a `stopped_at` term "for completeness", would
break it while every other test stayed green.

Three tests now pin it: the session window and the driver window each read
`started_at` and contain **no** `stopped_at` term, and — the one worth having —
the **placement** window uses `&&` instead, because sessions attribute by a
point in time and placements by overlap of an interval. **Both are correct and
they are not the same rule**, and a placement keyed on its start would lose
every device installed before the month began.

Fool test 17: the session window keyed on `stopped_at` → **1 failed**.

Suite **1,872 passed / 1 skipped / 104 files**, `npm run check` **16 of 16**.

---

## §11 fallback — items 6, 7, 9, 10, and 8 as the capstone

Four design notes and the revised critical-path list. No code; nothing in this
section builds anything.

### Item 6 — `docs/notes/2026-08-28-ocpp-identities-retirement-plan.md`

**64 files** reference `ocpp_identities` outside generated code, and the plan
turns on the fact that **they are not equal**. Four tiers, and **only the first
can take the site down**: the auth path (`gateway/src/auth.ts`,
`identity-do.ts`, `ocpp-internal-auth.ts`) — a wrong lookup for one second is
one second in which no charger can connect. The write path, the projections and
the sixty read-only surfaces all fail visibly.

**Two findings worth having before anyone starts.**

`identity-do.ts` keys its Durable Object on **`ocpp_identities.id`, the UUID,
not the identity string** — a piece of good luck, because the DO key survives an
identity string changing. It survives the retirement **only if the backfill
carries the ids across**, and *that is decided at backfill time*, which is why
it must be settled before step 2 rather than discovered at step 4. If new ids
are issued, **every live DO is orphaned at cutover and every connected charger
is dropped**.

And a permanent hole: **the backfill cannot recover an identity that was ever
CHANGED in place.** The old value is gone; no interval can be reconstructed. It
should be recorded on the row rather than papered over — those devices' identity
history begins at backfill, and any earlier question is `unavailable`.

Seven ordered steps. Steps 3 and 4 must not be one deploy; step 4 and step 6
must not be one deploy.

### Item 7 — the `createCharger` call-site migration

**Done in the asset-model retirement plan**, with both callers named
(`routes/admin/chargers.ts:68`, mine; `repositories/onboarding-chains.ts:163`,
B's) and the ordering constraint written out: **retiring it before the backfill
leaves two paths writing to different tables for one physical charger.**

### Item 9 — `docs/notes/2026-08-28-lifetime-counter-maintenance.md`

**Store the device's own reading; never accumulate.** The two rejected
approaches each fail permanently and invisibly: *summing our sessions* misses
every session before import and looks authoritative; *incrementing per session*
double-counts on replay and under-counts on a dropped message, with nothing to
reconcile against.

The write is an **assignment with a guard**, and three properties fall out of
it: a replay is a no-op, an out-of-order message is a no-op, and **a reading
that goes backwards is refused**. That last is the one that will fire in
practice — a meter swap genuinely restarts the register — and **what to do then
is deliberately not decided**, because the guard must make the event visible
before anyone chooses between an offset column and a swap record.

Session **count** has no OCPP 1.6 register, so it is the vendor's figure or
`unavailable` — and it must **not** be quietly derived from our own rows, which
is the summing error wearing a different hat.

One product consequence, flagged rather than buried: no erasure on transfer
(decision 7) means **the new host can see how much energy the unit delivered at
its previous site.** A fact about equipment they now own, and also a number
about somebody else's business.

### Item 10 — `docs/notes/2026-08-28-ocpi-mapping.md`

The receipt for ADR 0054's claim that the shape *"is what the interoperability
specifications already require, arrived at independently"*.

**`EVSE.uid` → `placements.public_id`**, never a serial, a device id or an OCPP
identity. OCPI warns against hardware identifiers by name, because redeploying
the same unit elsewhere then breaks uniqueness.

The move maps one-to-one onto `moveDevice` — `PATCH status: REMOVED`, then
`PUT` a new EVSE under the new Location — **and the order matters on the wire**:
sending the PUT first makes the same physical unit live at two Locations, which
is the roaming-visible form of the double-invoice.

The status conversion is written out because it is **lossy**: five OCPP values
collapse into `CHARGING`, and `SuspendedEV` versus `SuspendedEVSE` is gone. That
is item 11's argument in one table — the conversion happens at the boundary, and
the support call that needs the distinction happens on our side of it. A
never-reported connector maps to `UNKNOWN` and **not** `INOPERATIVE`: mapping
silence to "out of service" would route drivers away from a charger that may be
fine.

---

## §11 item 8 — what NOW stands between here and a real invoice

Round 3's list was *"two decisions and one migration"*. **This one is longer,
and that is the honest answer rather than a regression.** Round 3's list was
short because it was counting what stood between the code and *an* invoice.
Round 4 made the invoice **correct**, and correctness added items that were
always there and had not been counted.

### On the critical path

1. **Answer the active-driver decision packet.** Unchanged from round 3, still
   one line, and until it is answered every real period holds — by design.
2. **Authorise the migrations — now `0002` through `0008`.** Five more than
   round 3, and **they are not all the same shape**:
   - `0002`, `0003`, `0004`, `0005`, `0007`, `0008` are additive. `0005`
     creates `btree_gist`.
   - **`0006` is not.** It drops two unique indexes, backfills two columns with
     `UPDATE`, and adds two exclusion constraints. Its own header carries the
     verb census and the hazard: **the pair unique it drops is exactly what
     guarantees the constraint it adds can validate**, so steps 4 and 5 of that
     file must run in one transaction.
3. **Decide the PostgreSQL version.** `SELECT current_setting('server_version_num')::int`.
   `0005` and `0006` ship both constraint forms and default to the one that
   works everywhere, so this does not block — but it must be answered before
   either is applied, because applying Form A and later wanting Form B is a
   `DROP CONSTRAINT` under an `ACCESS EXCLUSIVE` lock.
4. **Decide mid-month proration.** Both branches implemented, default is
   today's behaviour, so nothing changes silently. **New from this round:** the
   feeder cannot express proration at all — `measured()` requires an integer
   count — so choosing it is one contract change to the money engine, not a
   switch flip. Costed in Phase 5.
5. **The statement renderer.** `issueDocument` allocates a real number and then
   refuses by name: `number_allocated_<N>_but_statement_renderer_not_built`.
   Round 3 called migration `0004` the last engineering item on the critical
   path; `0004` is written, and **this is what took its place.**

### New on the critical path, and it was always there

6. **The five Dalvegur chargers that exist in the portal and not in our
   database.** 35 in the portal, 30 rows here. **No predicate can reach them**
   — a row that does not exist cannot be filtered in — so this is a
   reconciliation against the vendor and not a code change. It **under**-bills,
   which is why nobody has noticed.
7. **The accountant's constraint on numbering.** Still unanswered. Three things
   his answer could move, each a one-place change by construction.

### Off the critical path, unchanged

The round-1 mobile money-unit patch, and B's `MAIN_APP → hlada-api`
pending-creation binding.

### The one thing that is not on any list, and should be

**ADR 0054 is committed on no branch.** The document this entire round
implements exists only as an untracked file in the canonical working tree. One
`git clean` destroys the specification for rounds 4 and 5. It is not an
engineering item and it is the highest-severity thing in this artifact.

---

## §12 standing backlog — item 1: the `?? 0` refusal at ingest

`apps/api/src/repositories/zaptec-session-sync.ts:235` read:

```ts
const energyKwh = z.Energy ?? 0;
```

**A CDR with no `Energy` field was priced at zero.** The zero reached two
places and both believed it:

- `computeSessionCost` priced the session at nothing;
- the CDR/OCPP enrichment comparison, on a **Zaptec-native installation where
  no OCPP row exists to disagree with**, took the `ocppValue == null` branch
  and marked the session **`complete`**.

A free session with a clean bill of health, invisible to the enrichment view
that exists to catch exactly this. **Ledger note 22 at ingest, and the sharpest
instance of it in the repository**, because unlike an absent row this one
produces a present row that looks finished.

### The fix, and why it skips rather than nulls

A missing reading is not zero energy. It is **no reading**, and the session is
now `skipped` with `no_energy_in_cdr`.

Writing the row with a null energy was the alternative and it is worse: the row
would be unpriceable, and the enrichment view, the ledger totals and the
statement would each have to learn a null they have never had to handle. **A
skipped session is visible in the report and re-importable the moment the
vendor supplies the figure; a zero-priced one is invisible forever.**

`Number.isFinite` is part of the guard, and it catches what `?? 0` never could:
a field that is **present, non-null and not a number** falls straight through
nullish coalescing and into the arithmetic.

### The distinction the fix rests on

**A measured zero is imported.** A session that genuinely delivered nothing — a
plug-in that never drew — is a fact, and refusing it would be the same error in
the other direction. That is its own test.

### The census of the other `?? 0` sites

Nine others were found and **none is the same defect**. Every one is a
**presentation** coalesce on an aggregate that has already been computed —
`billing-summary.ts:81`, `session-ledger.ts:286`, `billing-cost-centers.ts:135`
and the rest are all `(_sum.x ?? 0).toString()`, where Prisma returns `null`
for *"no rows matched"* and the surface renders `0`.

That is defensible and it is not this defect: **the number is being displayed,
not stored, and not priced.** It is arguably still worth distinguishing "no
sessions" from "no data" on a dashboard, and that is a UI question rather than
a money one. Recorded here so the census is not re-run from scratch:
**one storing coalesce, nine displaying ones, and the storing one is fixed.**

**Tests — 5.** Fool test 18: `?? 0` restored → **3 failed**.

Suite **1,877 passed / 1 skipped / 104 files**, `npm run check` **16 of 16**.

---

## §12 standing backlog — items 2 and 3

### Item 2 — `Charger.Active` consumers

`docs/notes/2026-08-28-charger-active-consumers.md`.

**The first finding is that the question has no consumers yet, because nothing
writes the field** — and that is the reason to do the census now, while the
answer can still be designed rather than retrofitted.

**`Active` is already read and dropped.** `lib/zaptec.ts` declares
`Active?: boolean` on `ZaptecChargerLite`, and
`zaptec-charger-status-sync.ts:265-280` persists the *other two* fields from
that same response, each guarded so `undefined` does not overwrite a known
value. There is no third block. The natural writer for
`vendor_config_observations` is one guarded block in a sync that already writes
its two neighbours — and **the importer is B's**, which is why the note names
the site rather than editing it.

**The census: 11 read paths, and they do not want the same rule.** Five matter,
two matter **in the opposite direction**, and four do not. The worst is
`routes/public/driver.ts:296` — a driver routed to a deactivated charger
arrives at hardware that will not start. `circuits.ts` and `installations.ts`
are the inverted pair: a deactivated charger draws no power, so including it
**over**-estimates the circuit.

Three rules fall out, and conflating them is how the next fix goes wrong:

1. **money or a driver → filter to active.**
2. **operational → SHOW deactivated rows, marked.** Hiding them makes an
   operator wonder where their charger went; marking them answers it.
3. **historical → do not filter at all.** Filtering history by today's state
   rewrites the past, which is the same error `tariff_snapshot_json` prevents.

**And the ordering that must not be got wrong:** until the observation table
has rows, every consumer reads `unavailable` — which is a **hold**, not a
filter. Adding filters before the writer exists would turn all five surfaces
off. Writer, then backfill, then filters, not overlapping.

### Item 3 — property-based tests for the temporal key

`packages/shared/src/domain/effective-dating.property.test.ts` — **5 tests over
8 seeds**, generating interval sets rather than pinning cases a human thought
of.

**No property-testing library was added.** `fast-check` would be a new
dependency for a check that needs a seeded PRNG and a loop, and `check:deps` is
right to make that deliberate. The generator is 20 lines and **deterministic**:
a fixed seed means a failure is reproducible from the test output alone, which
is the property that matters most and the one a random-per-run harness gives up.

Both directions of the invariant, because only one of them is the obvious test:

- **every ACCEPTED set has at most one live placement at every day** in the
  window — checked by sampling days rather than by re-running `overlaps`, so
  the test does not assert the implementation against itself;
- **every REJECTED candidate genuinely collides** with something accepted. A
  rejection with no overlapping row would be a false refusal — an operator told
  "already placed" about a device that is free — and a constraint that is
  merely *strict* passes the first test and fails this one. The suite also
  asserts each seed produced at least one rejection, because a run with none
  proves nothing about rejections.

And the ADR's claim, **generated rather than worked once**: the partial unique
index admits sets with two placements live at the same instant, and the billing
predicate over such a set returns more than one billable row for **one device**.
If that test ever stops finding a violation, the alternative has become
adequate and the ADR's argument needs revisiting — the failure message says so.

**Fool test 19:** an unbounded upper bound treated as an instant → **8 failed
across 2 files**, which is the generator earning its keep: the same mutation
against the example-based suite alone would have been quieter.

Suite **1,882 passed / 1 skipped / 105 files**, `npm run check` **16 of 16**.

---

## §12 standing backlog — items 4 and 5

### Item 4 — the schema consequences of the six unaccounted essentials

`docs/notes/2026-08-28-schema-consequences-of-the-six.md`. The question is
narrower than "should we build them": **which of the six constrain the SHAPE of
the schema, and therefore want deciding while it is still young.** The test
applied to each — *if we build this in six months, is the extra cost
structural?* A missing table is cheap later; a missing column on a table that
already has rows is not; a missing **identity** is worst.

| | essential | schema consequence |
|---|---|---|
| 2.1 | organisation never read | **none** — a join, the cheapest item on the list |
| 2.2 | no remittance ledger | **large, and it is money** |
| 2.3 | cannot receive money | **already paid for** |
| 2.4 | no audit trail | **none — the column exists** |
| 2.5 | nothing watches anything | **none** — wiring |
| 2.6 | retention has no owner | **medium, and it worsens with rows** |

**2.2 is the one that should land first, and it is a schema decision rather
than a feature.** A remittance ledger is not derivable from invoices: an
invoice says what was *billed*; remittance needs *collected*, *remitted* and
*when*, and no current table records any of the three. Four things its shape
must get right on day one — a movement is an **entry, never a mutable
balance**; every entry carries **the org whose money it is**, which is not
always the org being invoiced; aurar as `bigint`; and an entry references the
document that caused it. The `vörslureikningur` question decides whether
collected money is one balance or two, **and it has to be answered before the
table exists.**

**2.3 turns out to be already paid for.** The rail is deferrable — the
do-nothing baseline is a bank transfer against an emailed PDF. The **payment
reference** is not, and it already exists: the document number, unique per org
and gap-free since migration `0004`. What would have been expensive later is
discovering that the number an operator matches against is not the one printed.
It provably is.

**A correction I made to myself while writing it.** The draft recommended
adding an `org_id` column to `audit.actions`. **It already has one** — along
with `actor_user_id`, `actor_kind`, `action`, `target_type`, `target_id`,
`metadata` and `occurred_at`. Checked rather than assumed, and the
recommendation became "nothing; it needs a writer, which is code". The
structural point survives as a rule about *use*: `org_id` must record the
tenant the target belonged to **at the time**, which is free provided nothing
ever back-fills it.

**2.6's boundary is already half drawn**, and ADR 0054 should be read as having
drawn it: decision 7 makes lifetime device statistics permanent *because they
are facts about hardware rather than about a person*, and explicitly leaves
per-driver session retention undecided. The classification is what cannot wait —
you cannot tell, later, which of a million session rows belonged to a resident
who has since left.

### Item 5 — an audit trail for the asset model

`docs/notes/2026-08-28-asset-audit-trail.md`.

**The rule that keeps the two stores from drifting: the row answers "who", the
audit answers "what happened".** The asset model already carries actor columns
— `attached_by_user_id`, `detached_by_user_id`, `asserted_by_user_id`,
`assigned_by_user_id` — and a row can only remember its last state. What makes
both necessary: **a refused attach writes no row.** An operator who tried the
wrong site three times before succeeding leaves one placement and three audit
rows, and the three are what they are asking about.

Six event shapes, and **the refusal is the one that must not be dropped** —
every other has a surviving artefact and it has none.

Three rules for the writer: `org_id` at the time and never back-filled; the
audit write **in the same transaction as its effect**, with the refusal row as
the deliberate exception because the transaction it would join is the one that
rolled back; and **no personal data in `metadata`**, which would otherwise put
an idTag in the one table least able to delete it.

**What an operator sees is two surfaces and only one is new.** A device
timeline is `placements` read in order — `historyFor` already returns it, and
needs no audit table at all. **That is the point of closing rather than
deleting.** The org activity log is the one that does not exist.

**Nothing was built, and the second reason is the interesting one.** The first
is ordinary: the write paths go through a Drizzle adapter that has never
executed. The second is that **the refusal that matters most cannot be audited
where it happens.** A skipped detach caught by the exclusion constraint
surfaces as a SQLSTATE inside a transaction that just died; the writer that
would record it is the one that died with it. It has to be written by the
caller, after the rollback, from the refusal the port returns — **which is
exactly why `attachDevice` returns a named reason rather than throwing.** That
decision was made in Phase 6 for a different purpose and turns out to be what
makes the audit trail possible at all. Recorded so nobody simplifies it back
into a throw.

Suite **1,882 passed / 1 skipped / 105 files**, `npm run check` **16 of 16**.

---

## External state — running

No push. No deploy. **No migration applied to any database — `0002`, `0003`,
`0004`, `0005`, `0006`, `0007` and `0008` all remain generated and unapplied.**
No SQL against any environment, no socket opened, no database connected to. No
Cloudflare, Neon or GitHub mutation — the Neon MCP tools are available to this
session and **were not used**, because operating rule 3 forbids it. No charger
or hardware action, no BLE/NFC. No branch or tag deleted, no `git clean`,
reset, rebase, amend or force.
Nothing under `packages/contracts/**` or any of B's paths edited.
`dev/market-rails` was read at `ae99700` and `d9a8b18` and never merged; its SR
file was read with `git show` and answered in a file on this branch.
**`zaptec-import.ts` was read and NOT edited** — the importer is B's. Every fixture value is synthetic;
no checksum-valid kennitala, no real idTag, no token value appears anywhere.
The only branch written to is `dev/core-billing-integration`.

---

## Phase boundary re-checks — B's SR channel

| boundary | `dev/market-rails` | SRs | action |
|---|---|---|---|
| Phase 0 | `7cc591e` | file absent | none |
| Phase 2 | `ae99700` | SR-1, SR-2, SR-3 | all three answered |
| Phase 3 | `d9a8b18` | unchanged — `git diff` between the two tips over that path is **empty** | none |
| Phase 4 | `d9a8b18` | unchanged | none |
| Phase 5 | `d9a8b18` | unchanged | none |
| Phase 6 | `d9a8b18` | unchanged | none |

The channel rule is that an earlier SR is never rewritten. Checked rather than
assumed: the diff is empty, so nothing I answered has moved under me.
