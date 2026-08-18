# Claude A2a — The Connector Activity Writer

**Completion artifact. Chunk 1 of 3**, resuming the 15:40 dispatch that died on
`API Error: 529 Overloaded` at `e7247b6`.

Prompt: `docs/agent-prompts/2026-08-18/2026-08-18-1805-claude-a2a-connector-activity-writer.md`

> **Written and committed incrementally**, per the standing rule the 529
> taught: after Phase 1, and again after Phase 2. The last run lost its entire
> record because the artifact was a file waiting to be written; two commits
> survived because they were commits.

---

## TL;DR

**Nothing was lost in the interruption.** The connector activity writer was
already built and green in the working tree when the 529 hit; it is committed
here unchanged. `reports.connector_activity_month` now has the writer it has
never had — the first half of preflight §9.6, *"the single blocker between an
applied `0002` and customer 1's first invoice."*

`dev/market-rails` re-merged at `a81860b`. **CR-1 is closed** — B's fix landed
and matches the diagnosis exactly.

**The branch is fully green for the first time: all 16 checks pass, 1,577 tests,
zero failures.**

---

## Run facts

| | |
|---|---|
| Agent | `claude-a`, chunk **A2a of 3** |
| Status | complete — 12/12 gates |
| Resumed from | `2026-08-18-1540-claude-a-activity-source-and-first-invoice-dry-run.md`, interrupted at `e7247b6` |
| Start (UTC) | 2026-08-18T18:08:43Z |
| End (UTC) | 2026-08-18T18:14:00Z |
| Wall clock | ~5 minutes |
| Time target | none — deliverable-gated |
| Worktree | `E:\Claude\Straumvakt-core-billing` |
| Branch | `dev/core-billing-integration` |
| Start tip | `e7247b6` |
| End tip | `1a418df` |
| Dirty at close | 0 |
| Commits | 2 |

---

## Phase 0 — The salvage decision

`git status --porcelain` at start, every entry classified:

| entry | classification |
|---|---|
| `?? packages/commercial/src/core-billing/activity-month.ts` | **mine**, interrupted run |
| `?? packages/commercial/src/core-billing/activity-month.test.ts` | **mine**, interrupted run |
| `?? apps/api/src/repositories/activity-month.ts` | **mine**, interrupted run |
| `?? apps/api/src/repositories/activity-month.test.ts` | **mine**, interrupted run |
| `?? docs/notes/2026-08-18-activity-source-census.md` | **mine**, interrupted run |
| ` M packages/commercial/src/index.ts` | **mine** — barrel export for the above |

No peer files, no generated output, nothing unaccounted for.

**Decision: finished and committed as its own slice — `28f5fdc`. Not stashed,
nothing discarded.** The work was already complete and passing (44 tests) when
the 529 hit; stashing it would have deferred a finished deliverable for no
benefit. The one thing it needed was the `unused-exports` baseline entry, added
by hand rather than via `--baseline` so that three *unrelated* stale entries
were not silently resolved in this commit.

`git log --oneline 686f5af..HEAD` confirmed exactly the two expected commits,
`cafbee4` and `e7247b6`, before any edit.

### Baseline, measured with the salvage in tree

| check | result |
|---|---|
| `npx tsc --noEmit -p apps/api` | pass |
| `npm run typecheck` | pass |
| `npm test` | 1,533 passed, **2 failed**, 1 skipped |
| `npm run check` | 15 gates, 1 failed (`unused-exports`, resolved in `28f5fdc`) |

The 2 failures were the expected `header.test.ts` golden-file cases — CR-1,
B's lane. Phase 1 fixes them.

### Carried by salvage — chunk 2 should read this

The salvaged commit **also contains `deriveDriverActivity` and
`writeDriverActivity`**. They were written during the interrupted run, before
the three-chunk split existed, and operating rule 4 forbids discarding work.

**Chunk 2 should verify and extend them, not rebuild them.** What is *not*
started, and what is chunk 2's actual subject, is the **active-driver decision
packet** — the six-part document that makes the "charging **or reporting**
activity" question a five-minute call for Andri. The refusal in
`deriveActiveDrivers` is untouched and still refuses.

---

## Phase 1 — Re-merge `dev/market-rails` at `a81860b`

`git merge-tree` dry run first: **exit 0, no conflicts.** The real merge agreed.

**Conflict table: none.** `scripts/check-all.mjs` was modified on both sides
and auto-merged correctly — my round-2 union (`pricing-ssot`, `orgid-param`,
`invite-guard`) survived and B's new `bindings` gate was added alongside. **16
gates now run**, and `npm run check` runs both the billing gates and
`check:invoice`.

**Zero CRLF-only changes:** 21 files in `git diff --numstat`, 21 in
`git diff -w --numstat`; shortstats identical at 2,881/7.

Migration journal still coherent: `0000`, `0001`, `0002`, each once.

### CR-1 is closed

`packages/contracts/src/invoice/header.test.ts` — **23 tests, all passing**
(B added two while fixing it).

B normalised the **file side only**, and the reasoning in the committed comment
matches the diagnosis exactly: the blob is LF, `core.autocrlf=true` converts on
**checkout**, the files were written and never re-checked-out in the worktree
that created them, and my merge was the first checkout — a latent defect that
would fail on any fresh Windows clone and is invisible on its own branch.

B's note on *why not both sides*: making the renderer emit CRLF would be a real
content change. That is the right call — the golden file is a byte-exact
fixture of what the renderer produces, and the renderer's output is the thing
under test.

### Post-merge baseline

| check | before merge | after merge |
|---|---|---|
| `npm test` | 1,533 pass / **2 fail** | **1,577 pass / 0 fail**, 1 skipped |
| `npm run check` | 15 gates, 1 fail | **16 gates, all pass** |

**No new red. The branch is fully green for the first time.**

One informational note surfaced by B's new gate, recorded rather than acted on:
`gateway/wrangler.jsonc` binds `MAIN_APP` to worker `hlada-api`, flagged
`PENDING-CREATION (Andri)`. The gate passes with it recorded. It is B's lane
and outside this chunk.

---

## Phase 2 — The connector activity writer

Landed in `28f5fdc`. `reports.connector_activity_month` is created by migration
`0002` and had **zero writers**.

### The definition, stated once in source

At the top of `packages/commercial/src/core-billing/activity-month.ts`:

> **A connector is ACTIVE in a month if it existed on Straumvakt at any point
> in that month and we hold evidence it was still installed — whether or not
> anybody charged on it.**

**The zero-session connector is active, deliberately.** The locked model prices
`200 kr / active connector / month` and caps at `450 kr / connector / month` —
both per *connector*, neither per session. A host pays for capacity Straumvakt
operates for them: the OCPP connection, the availability, the monitoring, the
readiness to bill.

If "active" meant "had a session", a host with ten connectors and a quiet
February would owe nothing while we carried all ten — **and the per-connector
cap would be pricing a unit that was not the billable unit.** That error
under-bills, raises nothing, and is found by nobody. The reasoning is in the
source file, not only in a note, because that is where the next reader will be.

**No proration.** The model says nothing about fractions of a month. A
connector activated on the 28th counts; so does one last seen on the 2nd.

### The candidate-source table

Full version with citations in `docs/notes/2026-08-18-activity-source-census.md`.

| source | proves | misses | reliable | pre-Authorize coverage |
|---|---|---|---|---|
| `charging.sessions` (`connector_id`, `started_at`) | existed **and worked** | every session with `connector_id` NULL; every unused connector | yes where present | **yes** — sessions predate Authorize and still name a connector |
| `events.event_log` / `ocpp.raw.StatusNotification` (`projections.ts:1087`, handler `:766`) | was **talking to us** that day | vendor-native connectors that never speak OCPP to our gateway | yes — 426 frames from one site in one day, measured (`projections.ts:643`) | yes, for anything OCPP-connected then |
| `assets.connectors` (`created_at`, `status`, `status_updated_at`) | exists **now** | **when it was removed** — no `disabled_at`, no history | **no, retrospectively** | **no** — a connector removed in February still has its row |
| `reports.session_ledger` | as sessions, billed subset | whatever the projection never took | yes, strict subset | partial |
| asset chain (`evses`/`charging_stations`/`site_assets`) | the parent existed | nothing about the connector | n/a — wrong grain | n/a |
| `charging.live_sessions` / samples | in-flight state | anything historical | no, for a closed month | no |

### The finding that changed the design

**`charging.sessions.connector_id` is nullable, and the Zaptec importer writes
`connectorId: null` on every synthetic session it creates**
(`zaptec-session-sync.ts:394`).

A session-only derivation is therefore **structurally blind to every
Zaptec-native installation** — precisely the ones that exist *because* the
charger does not speak OCPP to us. It would have under-counted an entire
installation type, produced a smaller invoice, and raised nothing.

That is why `status_available` is a first-class evidence tier and not a
fallback, and why the derivation cites the *strongest* evidence per connector
rather than the first it encounters.

### `source` as a typed union

| value | asserts | derived? |
|---|---|---|
| `session_observed` | a session on this connector in the period | **yes** |
| `status_available` | a StatusNotification in the period | **yes** |
| `manually_asserted` | an operator stated it was installed | **never** |

**`manually_asserted` is never inferred, and that is the safety property.** The
roster cannot prove a connector was still installed last March. Inventing an
assertion from `assets.connectors` would bill 200 kr for hardware that may have
been in a skip since February. No in-period evidence → **no row** → the feeder
holds → an operator is asked. There is no assertion table yet (preflight delta
9.7).

### The nullable columns, decided per column

| column | this writer | what NULL means |
|---|---|---|
| `active_days` | **populates** from distinct UTC days of real evidence | "no evidence-based day count exists" — today only on `manually_asserted`. **Never "zero days"**: a derived row exists only because there was ≥1 day of something, so it always carries `activeDays >= 1`. |
| `cap_applied_isk` | **always NULL** | "not yet settled". The column means *whole ISK actually charged after the 450 cap* — a billing outcome from settlement, which runs after this. `0` would state the connector was billed nothing: a different, false claim. |

### Upsert semantics

Conflict target: the unique index `(org_id, period_year, period_month,
connector_id)` from `0002`. **That index is the idempotency mechanism.**

- **Overwritten:** `source`, `session_count`, `active_days`,
  `charging_station_id` (COALESCE, so a learned value is not replaced by a
  null), `last_seen_at` (GREATEST).
- **Preserved:** `id`, `created_at`, `first_seen_at` (**LEAST** — a later run
  over a narrower window must not move the start of the month forward), and
  **`cap_applied_isk`**, absent from the `SET` clause entirely.

`cap_applied_isk` is the load-bearing one: settlement writes it *after* this
job runs, and a routine re-aggregation that reset it to NULL would erase the
record of what a connector was actually billed — silently, on a table nobody
watches. **A test asserts that absence rather than trusting the comment.**

### Hot-path side (FOCUS rule 7) — split, not assigned

- **Evidence aggregation → raw SQL.** Scans `events.event_log`, the
  highest-volume table in the system, and reduces to one row per
  (connector, day) *inside Postgres*.
- **The upsert → Drizzle.** At most one row per connector per month.

| | today, 21 chargers | at 4,000 chargers |
|---|---|---|
| connectors | ~42 | ~8,000 |
| sessions / month | < 1,000 (census: 1,619 completed **in total**) | ~120,000 |
| StatusNotification frames / month | ~1e4–5e4 | ~1e6–1e7 |
| **rows the JS side sees** | **≤ 42** | **≤ 8,000** |

Raw input grows ~200×; derived output grows by ~8,000 rows. Pulling frames into
JS to group them would be a month-long table scan marshalled row by row. This
is why the pure derivation is *specified* to take already-reduced observations
— the expensive reduction cannot accidentally migrate into JS later.

### Tenancy

`restrictToOrgIds` is a **required field**; `null` means platform-wide and must
be written deliberately. An out-of-scope org **throws** rather than writing
nothing quietly — an empty result and a refusal look identical to a caller that
only checks `rowsWritten`.

### Tests — 44

`packages/commercial/.../activity-month.test.ts` (25, pure): empty period; one
connector one session; **one connector zero sessions**; both evidence kinds
present; mid-period activation; mid-period deactivation; connector moved
between stations; a null station id filled later; two orgs not mixing; one
connector under two orgs throwing; out-of-period observations counted not
swallowed; boundaries start-inclusive/end-exclusive; `manually_asserted` never
derived; an explicit assertion with `activeDays` null; determinism under
shuffled evidence; multiple sessions on one connector; `capAppliedIsk` never
populated; a period containing pre-Authorize sessions. Plus 7 driver cases.

`apps/api/src/repositories/activity-month.test.ts` (19, repository): in-scope
write; platform write; **out-of-scope throws**; empty allow-list throws; no
evidence writes nothing; out-of-period reported; conflict target has four
columns; **`capAppliedIsk` absent from the SET**; the overwrite set is exactly
the recomputable six; LEAST/GREATEST on timestamps; identical evidence →
identical payload; more evidence → larger counts; reads scoped too.

**Fool test:** `assertOrgInScope` made a no-op → **4 of 19 failed.** Restored.

A bug my own test caught while writing it: the first version asserted
LEAST/GREATEST via `JSON.stringify` on a Drizzle SQL node, which is a circular
structure (SQL → column → table → columns). Replaced with a chunk reader that
does not traverse the cycle.

---

## Gates — §6, row by row

| # | gate | status |
|---|---|---|
| 0 | salvage decision recorded | **met** — finished and committed as `28f5fdc`, nothing stashed, nothing discarded |
| 1 | `a81860b` merged; the 2 golden tests green | **met** — 23/23 in `header.test.ts` |
| 2 | `npm run check` runs billing gates + `check:invoice`; zero CRLF-only | **met** — 16 gates, 21/21 files identical under `-w` |
| 3 | candidate-source table complete, cited, historical coverage stated | **met** — 6 sources |
| 4 | "active connector" in one sentence in source; zero-session case decided | **met** |
| 5 | `source` a typed union, every value documented | **met** — 3 values |
| 6 | derivation pure, repository writer around it | **met** |
| 7 | upsert semantics stated | **met** — 5 overwritten, 4 preserved |
| 8 | `active_days` / `cap_applied_isk` decided, null-meaning stated | **met** |
| 9 | hot-path side with volume estimate at 21 and 4,000 | **met** |
| 10 | ≥ 10 connector tests incl. both mid-period cases and re-run idempotency | **met** — 25 pure + 19 repository |
| 11 | ≥ 1 fool-test | **met** — 4 of 19 failed |
| 12 | completion `.md` and `.json` written **and committed** | **met** |

---

## Checks at close

| check | result |
|---|---|
| `npx tsc --noEmit -p apps/api` | pass |
| `npm run typecheck` | pass |
| `npm test` | **1,577 passed, 0 failed, 1 skipped (87 files)** |
| `npm run check` | **all 16 pass** |

---

## External state

No push. No deploy. **No migration applied to any database** — `0002` remains
generated and unapplied. No SQL against any environment. No Cloudflare, Neon or
GitHub mutation. No charger or hardware action, no BLE/NFC. No branch or tag
deleted, no `git clean`, reset, rebase, amend or force. **Nothing discarded
during salvage.** No secret, token value, idTag, connection string or kennitala
printed, logged or committed.

The only branch written to is `dev/core-billing-integration`. `dev/market-rails`
was read and merged from, never written to.

---

## The exact state chunk 2 should expect

| | |
|---|---|
| Branch | `dev/core-billing-integration` |
| Tip | **`1a418df`** (plus the artifact commit that follows this file) |
| Dirty | 0 |
| Tests | 1,577 passing, 1 skipped, **0 failing** |
| `npm run check` | **all 16 pass** |

**Exists:**

- `packages/commercial/src/core-billing/activity-month.ts` — pure derivation
  for **both** connectors and drivers, exported from the package barrel.
- `apps/api/src/repositories/activity-month.ts` — `gatherConnectorEvidence`,
  `gatherDriverEvidence`, `writeConnectorActivity`, `writeDriverActivity`,
  `runActivityAggregation`, `readConnectorActivityCount`,
  `readDriverActivityCount`. All three gather/run exports are baselined as
  deliberately-ahead-of-caller in `.unused-exports-known.json`.
- `docs/notes/2026-08-18-activity-source-census.md` — the source table and the
  definition, for chunks 2 and 3 to cite rather than re-derive.
- CR-1 in `docs/notes/2026-08-18-invoice-contract-change-requests.md`, now
  **closed** by `a81860b`. Do not rewrite it; append CR-2 onward.

**Does not exist:**

- The **active-driver decision packet** — chunk 2's real subject. Not started.
- Any narrowing of `deriveActiveDrivers`. It still refuses, with the named
  reason `driver_definition_incomplete`.
- Feeder wiring to the activity source (chunk 3).
- `scripts/dry-run-first-invoice.mts` (chunk 3).
- Any assertion table for `manually_asserted` (preflight delta 9.7).

**Chunk 2 is ready to dispatch.**
