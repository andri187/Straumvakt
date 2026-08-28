# Customer 1's first invoice — operator runbook

**2026-08-18 · Claude A, round 3 · for whoever runs the first invoice**

This is the ordered sequence from *nothing has been applied* to *customer 1 has
an invoice*. Every step is a command or a named action. **Every irreversible
step has a stop point**, with what to verify before continuing and the named
condition that aborts.

The dry run has already produced the document this describes, offline. Run it
first — §1 — because the cheapest place to find out something is wrong is
before any of this has touched a database.

> **Cross-reference.** The deploy half of this belongs to Claude B's
> **round-2 revision** of its release checklist:
> `docs/notes/2026-08-18-release-ops-queue-round2.md` §7. That revision
> supersedes the round-1 note; do not follow the earlier one, the ordering
> changed. Where the two documents overlap, B's §7 owns the *deploy* order and
> this document owns the *billing* order. The single interlock is stated in
> §4: **`0002` is B's §7 step 6 and this document's step 4, and they are the
> same action.**

---

## 0. Before you start — what is true today

| | |
|---|---|
| Migration `0002` | **generated, never applied** — 11 tables, 11 types, 26 indexes |
| Migration `0003` | **generated, never applied** — `period_transitions`, `connector_assertions` |
| The billing API | built and mounted at `/api/admin/orgs/:orgId/billing/…`, never run against a database |
| The active-driver definition | **unanswered** — see §7. Until it is answered, **every period holds** |
| The invoice sequence table | **does not exist** — see §8. Numbering works in the fixture adapter and has no store |

**Two of those are decisions, not tasks, and both are Andri's.** Steps 1–3 are
free and reversible; step 4 is the first that touches a database.

---

## 1. Local, free, and reversible

Nothing here touches a database or a network.

```sh
cd E:/Claude/Straumvakt-core-billing
npm run check                                   # expect: all 16 pass
npm test                                        # expect: 0 failing
npx tsx scripts/dry-run-first-invoice.mts       # prints the invoice
npx tsx scripts/dry-run-first-invoice.mts --all # expect: 8/8 cases behaved
```

**Read the printed invoice.** That is the point of it. Check the host name, the
period, the connector count, the arithmetic, and the provenance block at the
bottom — in particular the line that says the driver count was **supplied by
the fixture, not derived**.

**Stop and do not continue if:** any of the four commands is red, or the
printed document says anything you would not want a customer to read.

**Rollback:** none needed. Nothing changed.

---

## 2. Answer the active-driver question

`docs/notes/2026-08-18-active-driver-definition.md`. Four options, costed.

**This is not optional and it is not a formality.** Until it is answered
`deriveActiveDrivers` refuses, and *every* period holds — the dry run's
`holds-on-real-driver-definition` case shows exactly what a live run does
today. You can apply `0002`, run the API, and still produce no invoice.

**Stop point:** a decision recorded in the note.
**Rollback:** free — narrowing the definition later is one line, and §6 of that
note explains why widening it later is a door that only opens forwards.

---

## 3. Confirm the agreement exists for customer 1

The flat fee is a **degenerate agreement**: one cost factor, three rate
references — `CORE_CONNECTOR` at 200 kr, `CORE_DRIVER` at 50 kr, `CORE_CAP` at
450 kr, all `per_connector` basis, all with an `effective_from` **on or before
the period start**.

Without them the feeder holds with `no_rate_at_period_start`, and with a wrong
price it holds with `rate_disagrees_with_locked_frame` rather than billing an
amount nobody agreed.

**Stop point:** the three rate rows exist and read 20000 / 5000 / 45000 aurar.
**Rollback:** free — rate rows are configuration, not money.

---

## 4. ⛔ Apply migration `0002` — FIRST IRREVERSIBLE STEP

**This is B's §7 step 6 and it is the same action. Do it once.**

Follow `docs/notes/2026-08-18-migration-0002-preflight.md` in full. It has the
read-only preflight `SELECT`s, the object inventory, the lock profile and the
rollback. In summary:

1. Run the preflight queries (§3 of the pack). **They are all `SELECT`.**
2. Confirm §3.5 and §3.6 return **zero rows** — no name collisions.
3. Confirm §3.7 shows `per_connector` in `agreements."RateBasis"` — that is
   `0001` having been applied.
4. Take a branch snapshot.
5. Apply.
6. Verify with §8 of the pack: 11 tables, 11 types, all empty.

**⛔ STOP POINT.** Verify before continuing:

- `npm run db:migrate:status` reports nothing pending.
- The eleven tables exist and are **empty**.
- `npm run check:schema-consistency` still passes.

**Abort condition:** any preflight query returns a name collision, or the
migration fails partway. It runs in a transaction, so a failure rolls back
completely and nothing was created.

**Rollback:** fully available **and only until step 7 runs.** The pack's §6 has
the exact `DROP` sequence. Read §6's second half before you rely on it — it
names what stops being recoverable.

---

## 5. ⛔ Apply migration `0003`

`apps/api/drizzle/0003_handy_stranger.sql`. Two tables, two unique indexes, two
plain indexes. **`CREATE` only** — verified by verb census: zero
`ALTER`/`DROP`/`TRUNCATE`/`INSERT`/`UPDATE`/`DELETE`.

- `billing.period_transitions` — the lifecycle log. Without it nothing can
  record that the activity job ran, and the port refuses every count.
- `billing.connector_assertions` — the operator's vouch. Without it, every
  connector on a vendor-native installation produces no activity row.

**⛔ STOP POINT.** Both tables exist and are empty; `check:schema-consistency`
passes at 79 tables.

**Rollback:** `DROP TABLE billing.period_transitions;` and
`DROP TABLE billing.connector_assertions;` — safe while both are empty, which
is until step 6.

---

## 6. Open the period

```
POST /api/admin/orgs/{orgId}/billing/periods/2026/3/open
Idempotency-Key: <a stable key you will reuse on retry>
```

**Idempotent.** The same key returns the same answer without re-running. A
**missing** key is a `400 idempotency_key_required` — that is deliberate; a
generated key would make every retry a fresh operation.

**Refusals you may see:**

| code | meaning | what to do |
|---|---|---|
| `period_not_open` with `period_not_yet_ended` | the month has not finished | wait for the month to end |
| `period_closed` | already closed | nothing; a closed period is terminal |
| `org_not_in_scope` (404) | your session cannot see this org | check who you are signed in as |

**Rollback:** the transition row can be deleted while the period is still
`open` and nothing downstream exists. After step 7 it is history, not state.

---

## 7. ⛔ Run the activity job — CLOSES THE `0002` ROLLBACK WINDOW

```
POST /api/admin/orgs/{orgId}/billing/periods/2026/3/activity
Idempotency-Key: <stable>
```

This aggregates connector and driver activity into
`reports.connector_activity_month` and `driver_activity_month`, then **seals**
the period.

**⛔ STOP POINT — this is the step after which `0002`'s rollback destroys data
rather than empty tables.** Verify before continuing:

- The response's `counts.connectorRows` matches the number of connectors you
  believe customer 1 has. **If it is lower, go to §9 before pricing.**
- `counts.driverRows` is what you expect under whichever definition §2 settled.
- The response's `sealed.to` is `activity_sealed`.

**Abort condition:** the connector count is materially wrong. Do not price a
period whose counts you do not believe — the invoice is the thing that reaches
the customer.

**Rollback:** the activity rows can be deleted and the seal transition removed
while the period is not yet priced. From here on, prefer forward correction.

---

## 8. Price the period

```
POST /api/admin/orgs/{orgId}/billing/periods/2026/3/price
Idempotency-Key: <stable>
```

**A period that holds returns `409 count_unavailable` with every reason named,
and NO invoice is produced.** That is the expected outcome until §2 is
answered. See §9 for what each reason means.

On success the response carries `totalIsk`, `activeConnectors`,
`activeDrivers` and `capApplied`. **Read them.** They are the numbers that will
be on the document.

**Rollback:** free. Pricing writes a settlement, not a claim. Re-pricing after
fixing an input is normal, up until step 10.

---

## 9. When a period holds — the section you will actually reach for

Holding is not a failure. It is the system refusing to invent a number.

| reason | what it means | what to do |
|---|---|---|
| `connector_count_unavailable` / `no_activity_source` | the activity job has not sealed this period, **or** it sealed and found no connectors | if not sealed, run §7. If sealed with zero, the connectors produced no session and no StatusNotification — assert them, below |
| `driver_count_unavailable` / `driver_definition_incomplete` | the locked definition is not computable | answer §2. This is the common one today |
| `driver_count_unavailable` / `no_activity_source` | sealed, but no driver rows | either the org genuinely had no active drivers, or attribution is missing. **A zero and an unknown are different facts** — decide which, do not guess |
| `no_rate_at_period_start` | the agreement has no rate effective at the period start | §3 |
| `rate_disagrees_with_locked_frame` | a rate row is not 200 / 50 / 450 | fix the rate row. Do not override |
| `plug_time_unmeasurable` | a plug-time factor is attached and the timestamps do not exist | remove the factor, or accept that plug time cannot be billed yet |

### Asserting a connector

A connector on a **vendor-native (Zaptec-authentication) installation produces
no machine evidence at all** — the importer writes `connector_id: null` on its
sessions and it never speaks OCPP to our gateway. That is permanent, not
occasional.

```
POST /api/admin/orgs/{orgId}/billing/periods/2026/3/assertions
Idempotency-Key: <stable>
{ "connectorId": "...", "reason": "why you believe it was installed",
  "evidenceNote": "work order / photo / ticket" }
```

**You are personally vouching that this connector was installed and billable
for that month, with no machine evidence.** The row records who, when and why,
and the assertion is visible on the invoice's provenance block beside the
derived counts. `reason` is required, because an unexplained assertion is an
unauditable one.

Then re-run §7 and §8.

---

## 10. ⛔⛔ Issue the invoice — THE MOST IRREVERSIBLE STEP

```
POST /api/admin/orgs/{orgId}/billing/periods/2026/3/issue
Idempotency-Key: <stable>
```

**This consumes a document number, and a consumed number cannot be reused.**
Icelandic law requires *"fyrirfram tölusett með áprentuð númer í samfelldri
töluröð"* — pre-numbered documents in an **unbroken sequence**. There is
deliberately **no release operation**: a number spent on a document that never
existed is a hole that cannot be filled later, because the documents around it
are already in someone else's books. The only remedy is to record it as
**voided in place**.

**⛔ STOP POINT — before you send this request:**

1. **A human has read the rendered document.** Fetch it first:
   `GET /api/admin/orgs/{orgId}/billing/periods/2026/3/document`.
2. The accountant's outstanding questions are answered — B's delivery packet
   §2 flags at least one on VAT wording for a non-registered kröfuhafi.
3. The claim holder line says **Straumvakt**, not "Straumvakt f.h. …". This is
   the market line, principal posture, Straumvakt's own money. If it says
   anything else, **stop** — an agent-posture line has reached a document that
   should not carry one.
4. The total matches what §8 reported.

**Abort condition:** any of the four. Aborting before this request costs
nothing; aborting after costs a voided number.

> **⚠️ KNOWN GAP — read before attempting.** The Drizzle adapter currently
> **refuses** this with `document_sequence_table_not_yet_created`. Neither
> `0002` nor `0003` creates a store for the number sequence. The numbering
> logic is proven — gap-free, transactional with issue, crash-safe between
> allocate and issue, all exercised in the dry run — but it has nowhere to
> persist a counter. **A migration `0004` is required before step 10 can run
> against a database.** This is the last engineering item on the critical path.

**Rollback:** none for the number. The period can be corrected only by an
**additive next-period correction line** — `StatementLineKind.correction` with
a `CorrectionReason` — never by editing or reissuing a closed month.

---

## 11. Deliver

Delivery is B's rail. The record ends in `unknown` until a channel positively
confirms — **never** assume `delivered`.

`unknown` is dangerous in both directions: treated as delivered, the host never
gets an invoice nobody knows is missing; auto-retried, the host gets the same
claim twice. **`unknown` never auto-transitions.** It waits for a human or for
out-of-band evidence.

See B's §7 steps 13–14 and `2026-08-18-invoice-delivery-decision.md`.

---

## 12. Close the period

```
POST /api/admin/orgs/{orgId}/billing/periods/2026/3/close
Idempotency-Key: <stable>
```

**Closed is terminal and immutable.** A closed period rejects new activity,
re-pricing and re-issue, each with `period_closed`. Reopening is deliberately
not implemented: it is the one transition that can restate settled money, and
corrections already cover the legitimate need additively.

**Rollback:** none. This is the point past which the month is history.

---

## 13. The whole sequence, and where the doors shut

| # | step | reversible? |
|---|---|---|
| 1 | local checks and the dry run | yes, entirely |
| 2 | answer the active-driver question | yes |
| 3 | confirm the agreement's rate rows | yes |
| 4 | **apply `0002`** | yes, until step 7 |
| 5 | **apply `0003`** | yes, until step 6 |
| 6 | open the period | yes, until step 7 |
| 7 | **run the activity job** | ⛔ closes `0002`'s rollback window |
| 8 | price | yes — re-pricing is normal until step 10 |
| 9 | resolve holds / assert connectors | yes |
| 10 | **issue** | ⛔⛔ **no rollback.** A number is spent. Corrections only |
| 11 | deliver | no — a claim has reached the customer |
| 12 | close | no — the month is history |

**Two doors, and they are steps 7 and 10.** Everything before step 7 can be
undone by dropping empty tables. Everything after step 10 can only be corrected
forward.
