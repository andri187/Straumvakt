# Claude A — Period Lifecycle and the Operable Invoice

**Completion artifact. Round 3**, following A2a/A2b/A2c (41 of 41 gates).

Prompt: `docs/agent-prompts/2026-08-18/2026-08-18-2055-claude-a-period-lifecycle-and-the-operable-invoice.md`

Written and committed incrementally after every phase, per the standing rule
the 15:40 run's 529 taught.

---

## TL;DR

**Both preflight deltas are closed, and the invoice is now reachable through an
API — still with no database touched.**

`activityJobHasRun` was a boolean a caller handed in, and `false` was the only
honest default, so every period held. It is now derived from a recorded
lifecycle transition that says who sealed the period and when.

Delta 9.7 turned out to be **bigger than "unlikely"**: a connector with neither
a session nor a StatusNotification is not an edge case, it is the permanent
state of every connector on a vendor-native installation. The assertion table
was necessary, not manufactured.

Nine endpoints, every one through a port, 20 route tests against a fixture
adapter and a Drizzle adapter that has never executed. **Applying `0002`,
`0003` and one more migration is the whole remaining distance.**

---

## Run facts

| | |
|---|---|
| Agent | `claude-a`, round 3 |
| Status | complete — 22/22 gates |
| Start (UTC) | 2026-08-19T19:02:55Z |
| End (UTC) | 2026-08-19T19:47:00Z |
| Wall clock | ~44 minutes |
| Time target | none — deliverable-gated |
| Worktree | `E:\Claude\Straumvakt-core-billing` |
| Branch | `dev/core-billing-integration` |
| Start tip | `a84141e` |
| End tip | `4a84b5b` |
| Dirty at close | 0 |
| Commits | 5 |
| Tests | 1,630 → **1,689 passing**, 1 skipped, 0 failing (92 files) |
| `npm run check` | **all 16 pass** |
| Dry run | **8/8 cases behaved as specified** |

**Phase 0 baseline matched the prompt exactly** — 1,630 tests, 16 of 16 checks,
tree clean, `dev/market-rails` unmoved at `a81860b`. **No deviation to report.**

---

## Phase 1 — The period lifecycle (delta 9.8)

### The state set, justified rather than adopted

Six conditions were required. They are **not six equally-shaped states**, and
treating them as such is the mistake worth avoiding:

| state | why it is what it is |
|---|---|
| `not_opened` | the **absence** of a row, never persisted. A row recording that nothing has happened invents a fact and gives an operator something to reason about that does not exist |
| `open` | the only state that accepts activity rows |
| `activity_sealed` | the aggregation **ran to completion**. Deliberately distinct from "activity rows exist" — rows existing proves something ran, not that it finished, **and that difference is the whole of 9.8** |
| `priced` | a **settled** statement exists. A period whose pricing *held* does not reach it; it stays sealed with its holds recorded, so "we tried and refused" is visible rather than looking like "we have not tried" |
| `invoiced` | a number allocated and issued. First irreversible step |
| `closed` | terminal and immutable |

The event is named `record_pricing_settled` precisely so there is **no way to
spell** "pricing ran and refused" as a transition to `priced`. Holding is the
expected outcome today, and it must not look like progress.

### Closed is immutable, and says which kind of "no"

A closed period rejects new activity, re-pricing and re-issue, each with
`period_closed` rather than `illegal_transition`. Those are different facts —
"you may not do that from here" and "this month is finished" send an operator
to different places.

### Reopening deliberately not implemented

`billing_periods` carries `reopened_at`, `reopened_by_user_id` and
`reopen_reason`, so the schema contemplates it. This does not, and those
columns stay null. **It is the one transition that can restate settled money**,
which FOCUS rule 4 forbids — and the legitimate need already has a door: a
correction is an *additive* next-period line, so the original figure stays
exactly as invoiced.

### The Postgres enum was not widened

`billing."PeriodState"` is `open | closing | closed`. Widening means
`ALTER TYPE … ADD VALUE`, which cannot run inside a transaction block and
cannot be undone. The fine states live in an append-only log; `coarseStateOf`
maps them onto the existing three, **computed rather than stored**, so the two
cannot drift — asserted over every fine state.

### Delta 9.8, closed

`countFromRows` took `activityJobHasRun: boolean`. It now takes the period's
recorded state, and the boolean is gone from every signature I own. It cannot
be asserted any more; it is earned by a `seal_activity` transition.

---

## Phase 2 — The connector assertion (delta 9.7)

### Stated precisely, and it is structural

A connector with neither signal in a month is **not** an occasional edge case.
It is the **permanent, guaranteed** state of every connector on a vendor-native
(Zaptec-authentication) installation:

- the Zaptec importer writes `connector_id: null` on every session it creates
  (`zaptec-session-sync.ts:394`);
- `ocpp.raw.StatusNotification` only ever reaches `events.event_log` from our
  own OCPP gateway (`projections.ts:1087`), which such a charger does not talk
  to.

Verified by grep: nothing else writes either signal.

| scale | expected frequency |
|---|---|
| **21 chargers today** | an OCPP connector needs a month-long outage that `ocpp-silence-watch` (45-minute threshold) would have escalated — rare. But **every vendor-native connector is affected permanently**, and the Zaptec sync module exists precisely because such installations exist, so the count is ≥ 1 today and grows with each such host |
| **4,000 chargers** | ~8,000 connectors; even a 0.5% month-long-outage rate is ~40/month, **plus 100% of whatever share of the fleet is vendor-native** |

So the assertion is necessary. I did not manufacture a table to avoid a
documented refusal — the refusal would have been wrong.

### Machine evidence wins, and the assertion is kept

An assertion claims "this connector was installed"; evidence proves the same
thing. **The count does not change** — it was already one — so what is at stake
is only which proof the invoice cites, and it should cite the strongest
available. The assertion row is retained so the audit trail still shows a human
vouched before proof existed.

### Surfaced on the document

The dry run's fixture now models the real mixed installation, and the invoice
says so on its face:

```
· connector count 30 — DERIVED from 30 activity rows
  (3 session_observed, 26 status_available, 1 manually_asserted)
```

Beside the derived counts, never blended into them.

---

## Migration `0003` — generated, unapplied

`apps/api/drizzle/0003_handy_stranger.sql`. **`CREATE` only**, verified by verb
census: 2 `CREATE TABLE`, 2 `CREATE UNIQUE INDEX`, 2 `CREATE INDEX`, and **zero**
`ALTER` / `DROP` / `TRUNCATE` / `INSERT` / `UPDATE` / `DELETE` / `GRANT` /
`REVOKE`.

| table | natural key | what a retry does |
|---|---|---|
| `billing.period_transitions` | `(org_id, period_year, period_month, event)` | no event occurs twice in a period's life, so a retried month-end job **collides** instead of double-recording |
| `billing.connector_assertions` | `(org_id, period_year, period_month, connector_id)` | a duplicate assertion **collides** rather than double-counting |

Mirrored into Prisma; `check:schema-consistency` agrees at **79 tables / 959
columns**.

---

## Phase 3 — The API surface

Nine endpoints under `apps/api/src/routes/admin/billing/`, mounted at
`/api/admin/orgs/:orgId/billing/…`.

**Every handler goes through `BillingOperationsPort`.** No Drizzle, no Prisma,
no SQL in the route file. The tests drive `makeFixtureOperationsPort`, which is
**not a mock** — it uses the real state machine, the real feeder, the real
numbering and the real document model, and only the *storage* is a Map. A mock
would let the routes pass while the logic was wrong; this lets them fail for
the same reasons production will. `makeDrizzleOperationsPort` is written and
**has never executed**.

### Idempotency

Via `billing.mutation_receipts` and its `(org_id, scope, idempotency_key)`
unique index:

- a **missing** key is a `400` refusal, never a generated one;
- the same key with the same body **replays** the stored answer and the effect
  does not run again — asserted by comparing the recorded effect list, not by
  trusting a status code;
- the same key with a **different** body is a `409`, not a replay;
- a different key on the same logical operation **never consumes a second
  document number**.

### Pricing never produces a partial invoice

A held period returns `409 count_unavailable` with every hold reason named, the
period stays where it is so a later run can succeed, and **no document number
is allocated** — asserted directly.

### Tenancy

All nine routes are mounted under `/orgs/:orgId/`, so `requirePermission` gets a
real `orgIdParam` and needs **no allowlist entry** — better than allowlisting,
because `check:orgid-param` exists precisely because a gate without
`orgIdParam` resolves orgId to null and skips the membership lookup.
Cross-tenant refusal proven on every read and every write, **404 not 403**: a
403 confirms the org exists.

**Gate 14's staleness proof:** adding a probe entry for these routes makes the
checker report *"ALLOWLIST STALE … Delete the entry — that is progress, and the
list must shrink to record it."* Probe removed; checker passes at 75.

### Two generator couplings, conformed to rather than worked around

Both are cases where a reasonable structure would have made a *gate go blind* —
no false pass, but no coverage either, and nothing recording the gap.

1. **`gen-api-endpoints.mjs`** resolves a mount by matching
   `<mountedIdentifier>.post("path")` **textually**. A router built in a factory
   and assigned to a differently-named local is invisible to it. The factory's
   local now carries the exported name. **The surface doc went 178 → 187
   endpoints** — nine that would otherwise have been able to change without a
   diff.
2. **`check-orgid-param.mjs`** finds gates by matching `requirePermission("verb",
   { orgIdParam: … })` textually. Naming the injected permission factory `perm`
   would have hidden all nine gates. The local **shadows the import** and keeps
   its name, documented at the declaration.

### Three injection points, and why

`requireAuth`, `resolveAccess` and `requirePerm` each default to the real
implementation. All three exist because the route's own middleware opens a
database, and **a route that can only be exercised behind a live auth stack and
a live database is a route nobody exercises**. What they gate is unchanged.

---

## Phase 4 — The operator runbook

`docs/notes/2026-08-18-first-invoice-operator-runbook.md`. Thirteen steps, a
stop point at every irreversible one, a named abort condition each.

**Two doors, and naming them is most of the value:**

- **Step 7, the first activity job run** — closes `0002`'s rollback window.
  Before it, rolling back drops empty tables. After it, the same `DROP`
  destroys the only record of what a session cost when it was settled.
- **Step 10, issue** — no rollback at all. A consumed number cannot be reused;
  the only remedy is voiding in place and correcting forward.

**§9 is the section an operator will actually reach for**: what to do when a
period holds, per named reason, because holding is the *expected* outcome
today. It maps each reason to the specific fix, including what asserting a
connector means — *"you are personally vouching, with no machine evidence, and
it will appear on the invoice's provenance block."*

Cross-referenced to B's **round-2** revision (not the 15:13 version it
superseded), with the interlock stated: applying `0002` is B's §7 step 6 and
this document's step 4, **and they are the same action performed once**.

---

## Gates — §8, row by row

| # | gate | status |
|---|---|---|
| 1 | baseline recorded; deviation reported | **met** — matched exactly, no deviation |
| 2 | state machine defined, set justified | **met** |
| 3 | closed-period immutability proven, each named | **met** — activity, re-pricing, re-issue, all `period_closed` |
| 4 | pure state machine, repository separate | **met** |
| 5 | `activityJobHasRun` no longer passed in | **met** — derived; gone from every signature I own |
| 6 | open/complete idempotent; ≥ 10 lifecycle tests | **met** — 26 |
| 7 | delta 9.7 stated with frequency at 21 and 4,000 | **met** |
| 8 | assertion designed with who/when/why, on the provenance block | **met** |
| 9 | `0003` generated, unapplied, `CREATE` only, natural-key unique | **met** |
| 10 | `manually_asserted` a documented union member | **met** |
| 11 | ≥ 5 assertion tests incl. cross-org and contradicted-by-evidence | **met** — 7 |
| 12 | every endpoint under `admin/billing/`, each through a port | **met** — 9 |
| 13 | `mutation_receipts` on every mutation; missing key refuses | **met** |
| 14 | tenancy on every route; allowlist proven to fail when stale | **met** |
| 15 | pricing refuses with a named reason | **met** |
| 16 | numbering transactional with issue through the API path | **met** |
| 17 | dry run drives the API; original six green; ≥ 2 new | **met** — 8/8 |
| 18 | ≥ 2 idempotency tests | **met** — 4 |
| 19 | cross-tenant refusal on every read and write | **met** |
| 20 | runbook with stop points and the hold-reason section | **met** |
| 21 | ≥ 4 fool tests | **met** — 4 |
| 22 | artifact written **and committed incrementally** | **met** |

### Fool tests — 4, all caught, all restored

| sabotage | caught by |
|---|---|
| a closed period accepts new activity | **6 of 26** |
| a missing idempotency key is generated | **1 of 20** |
| an assertion crosses an org boundary | **2 of 40** |
| the billing tenancy guard disabled | **3 of 20** |

**Fallback queue §9: not started.** The 22-gate table consumed the round. All
seven items remain.

---

## What now stands between here and a real invoice

Shorter than A2c's list, which is the point. **Two decisions and one migration.**

1. **Answer the active-driver decision packet.** Option A is one line. Until
   then every real period holds — by design.
2. **Authorise `0002` and `0003`.** Both are `CREATE`-only and take no lock on
   any populated table. The runbook's steps 4–5.
3. **Write migration `0004`: a store for the invoice number sequence.** This is
   new information from this round, and it is now **the last engineering item on
   the critical path.** The numbering logic is proven — gap-free, transactional
   with issue, crash-safe between allocate and issue — but neither `0002` nor
   `0003` creates a counter, so `issueDocument` refuses against a database with
   `document_sequence_table_not_yet_created`. I did not invent one: an
   unapplied, untested sequence table guessed at in a round that could not run
   it would be worse than naming the gap.

Off the critical path, unchanged: the round-1 mobile money-unit patch, and
B's `MAIN_APP → hlada-api` pending-creation binding.

---

## External state

No push. No deploy. **No migration applied to any database — `0002` and `0003`
both remain generated and unapplied.** No SQL against any environment; **no
socket opened and no database connected to**. No Cloudflare, Neon or GitHub
mutation — the Neon MCP tools became available to this session and **were not
used**, because rule 3 forbids it. No charger or hardware action, no BLE/NFC.
No branch or tag deleted, no `git clean`, reset, rebase, amend or force. No
`.gitattributes` added or proposed. **Nothing under `packages/contracts/**`
edited** — consumed read-only, and **no CR-2 was needed**.

No secret, token value, idTag, password, connection string, kennitala or
personal row printed, logged or committed. Every fixture value is synthetic.

The only branch written to is `dev/core-billing-integration`.

### Two lane-boundary notes

- **`apps/api/src/lib/billing/period-repository.ts` is a repository living in
  `lib/`.** The round-3 boundary gives me `lib/billing/**` outright and
  `repositories/` only as `activity-month*`. **Move it to
  `repositories/period-store.ts` when the lanes merge** — nothing depends on
  the location.
- **`apps/api/src/index.ts` was edited** to mount the router (two lines: one
  import, one `app.route`). It is the app assembly point, not a route file, and
  an unmounted API is not "operable". Flagged because B is also in `apps/api`
  this round.
- **`packages/shared/src/db/commercial.ts`** was extended with the two new
  tables. It is assigned to neither lane and is where FOCUS rule 7 says schema
  changes start.
