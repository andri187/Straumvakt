# Claude A2b — Driver Activity and the Active-Driver Decision

**Completion artifact. Chunk 2 of 3.**

Prompt: `docs/agent-prompts/2026-08-18/2026-08-18-1805-claude-a2b-driver-activity-and-active-driver-decision.md`

Written and committed incrementally: after the writer landed (`950dc83`), after
the decision packet (`21191c8`), and this file.

---

## The decision packet's headline answer, in three lines

1. **The locked definition cannot be computed.** "Charging **or reporting**
   activity" — and reporting activity has no persisted event of any kind.
2. **The gap is 50 kr/month at customer 1 (0.83% of the bill), but
   structurally ~15% in the MDU shape the product is built for.** That is why
   "it's tiny, ship it" is the wrong instinct even though it is true this month.
3. **Narrowing to charging activity is one line and is not a one-way door** —
   but the door only opens forwards: closed periods can never be re-priced, and
   the evidence for a widened definition will not exist retroactively.

---

## Run facts

| | |
|---|---|
| Agent | `claude-a`, chunk **A2b of 3** |
| Status | complete — 14/14 gates |
| Start (UTC) | 2026-08-18T18:18:02Z |
| End (UTC) | 2026-08-18T18:26:00Z |
| Wall clock | ~8 minutes |
| Time target | none — deliverable-gated |
| Worktree | `E:\Claude\Straumvakt-core-billing` |
| Branch | `dev/core-billing-integration` |
| Start tip | `3a27999` |
| End tip | `21191c8` + this artifact's commit |
| Dirty at close | 0 |
| Commits | 3 |
| Tests | 1,582 → **1,590 passing**, 1 skipped, 0 failing |
| `npm run check` | **all 16 pass** |

---

## Gate 0 — chunk 1's state, confirmed

Read `claude-a2a-connector-activity-writer-completion.md` first. Every item its
closing section promised was verified present before any edit:

| promised | found |
|---|---|
| branch `dev/core-billing-integration`, tip `3a27999`, dirty 0 | ✔ |
| `activity-month.ts` + test in `packages/commercial` | ✔ |
| `activity-month.ts` + test in `apps/api/src/repositories` | ✔ |
| `docs/notes/2026-08-18-activity-source-census.md` | ✔ |
| CR-1 file present and closed | ✔ |
| **absent:** the active-driver decision packet | ✔ absent |
| **absent:** `scripts/dry-run-first-invoice.mts` | ✔ absent |
| 1,582 tests passing, 16/16 checks | ✔ |

**One naming discrepancy, recorded rather than papered over.** This chunk's §3
told me to cite `docs/notes/2026-08-18-connector-activity-source.md`. Chunk 1
named that file `docs/notes/2026-08-18-activity-source-census.md` — it was an
optional "if you finish early" deliverable in A2a's §7 and I named it for what
it covers, which is both connectors *and* drivers. I cited the real filename.
Nothing is missing; only the name differs.

---

## Phase 1 — The driver activity writer

**The derivation and writer already existed**, carried by salvage from the
interrupted 15:40 run, exactly as chunk 1's artifact flagged. I **verified and
extended rather than rebuilt**, which is what that flag was for.

### Candidate sources for driver activity

| source | proves | misses | reliable | pre-Authorize coverage |
|---|---|---|---|---|
| `reports.session_ledger` (`driver_user_id`) | the driver **charged** in the period | drivers active by the locked definition who did not charge | yes | **no — and this is not an error.** Pre-Authorize sessions are *structurally unattributable* (2026-08-08 amendment to ADR 0049); they carry no driver because none was ever captured, not because something failed |
| `charging.sessions` (`user_id`) | the same, one step upstream | same, plus sessions the ledger projection never took | yes | no, same reason |
| **reporting activity** | — | **there is no source. No table, no column, no event.** | n/a | n/a |
| `agreements.driver_group_memberships` (roster) | the driver is *enrolled* | whether they did anything — **and it has only `added_at`**, no status and no `removed_at`, so it cannot be intersected with a billing month at all | **not a measure of activity** | n/a |

The pre-Authorize row is the one that matters for correctness: those sessions
must **not** be counted as errors. The derivation simply produces no driver row
for them, and `deriveConnectorActivity` is unaffected — which is precisely why
the flat fee, needing no driver attribution, is the line that ships first.

### `source` as a typed union, consistent with chunk 1's

| value | asserts | derived? |
|---|---|---|
| `charging_session` | the driver had a session in the period | **yes** |
| `reporting_access` | the driver used a reporting surface | **no — nothing persists this** |
| `roster_membership` | the driver was on the org's roster | **never** — enrolment is not activity |

Same shape as the connector union: three values, exactly one never-derived
operator assertion. **A drift guard now enforces that shape** — see below.

### The refusal, preserved and sharpened

`deriveActiveDrivers` still refuses, and the tests now assert *which* reason:

- it returns `driver_definition_incomplete`, **not** the generic
  `no_activity_source` — the sources exist; the *definition* cannot be
  satisfied;
- the refusal survives any charging count, including 200 and zero. A bigger
  lower bound is not closer to the truth in a way that justifies shipping it.

### Upsert semantics — drivers

Conflict target: the unique index `(org_id, period_year, period_month,
driver_user_id)` from `0002`. **That index is the idempotency mechanism.**

- **Overwritten:** `source`, `session_count`, `last_seen_at` (GREATEST).
- **Preserved:** `id`, `created_at`, `first_seen_at` (**LEAST**).

`driver_activity_month` has no settled-figure column, so unlike the connector
table there is no `cap_applied_isk` to protect — which is stated here so the
difference between the two writers reads as deliberate rather than as an
omission.

### Tests added this chunk — 8

Driver idempotency proven directly (identical evidence in any order → identical
insert payload); the four-column conflict target; **a period with no
attributable sessions writes nothing** (the pre-Authorize shape — a zero-count
row would assert we checked and found no active drivers, a different claim);
the refusal's named reason; the refusal under a large and an empty count; plus
three union-drift guards.

Together with chunk 1's, the driver-specific coverage is: sessions across two
orgs · zero sessions · active in one period not the next · token disabled
mid-period · the refusal path · idempotency · the pre-Authorize shape.

**Fool test:** `deriveActiveDrivers` made to return
`measured(new Set(chargingDriverIds).size, …)` instead of refusing → **3 tests
failed.** Restored, and the restore re-verified green.

### §6 deepening — the union drift guard

The two unions live on separate tables and will be edited by separate people.
Three tests now fail if they diverge in shape: every value a derivation emits is
a member of its own union; each union carries exactly one never-derived
assertion value; and the never-derived values are in fact never derived —
including `reporting_access`, whose absence from any output is the entire
subject of the decision packet.

---

## Phase 2 — The decision packet

`docs/notes/2026-08-18-active-driver-definition.md`. All six required parts,
written so someone who has not read this codebase can decide from it alone.

### The size of the gap — quantified, which is what was missing

Every figure is cited to the note that recorded it and dated, because querying
any environment is forbidden here. **Stated as recorded, not as measured now.**

| | count | source |
|---|---|---|
| Drivers on the roster | **2** | 2026-05-31 integrity audit (staging) |
| Drivers with charging activity | **1** | 2026-08-07 — all 128 billing lines, 64 sessions, resolve to a single payer |
| Drivers with reporting activity | **unknowable** | no source exists |
| **Under-count billing charging-only** | **1 driver = 50% of the roster** | |

The second enrolled driver, `kronan@kronan.is`, has zero `id_tokens` — it
cannot authenticate at any charger, so it can never appear in a charging count
by construction.

### The commercial consequence, with the arithmetic

Customer 1 is **N1 ehf, Dalvegur 10–14 — 30 connectors** (2026-05-31: 32
stations / 32 EVSEs / 32 connectors across all orgs, of which 2 are the
Straumvakt sandbox).

```
connector component      30 × 200 = 6,000 kr
cap                      30 × 450 = 13,500 kr   (binds above 5 drivers per
                                                 connector = 150 drivers;
                                                 nowhere near, so uncapped)

charging-only   1 driver  × 50 =    50 kr  →  6,050 kr
roster          2 drivers × 50 =   100 kr  →  6,100 kr
                                              ───────────
difference                                        50 kr/month  = 0.83%
ten such customers                               500 kr/month  = 6,000 kr/year
```

**And why it will not stay small.** The MDU shape the product is built for — 30
connectors, 30 enrolled residents, 10 charging in a given month:

```
drivers who charged  10 × 50 =   500 kr  →  6,500 kr
drivers enrolled     30 × 50 = 1,500 kr  →  7,500 kr
gap                          1,000 kr/month  = 15.4%
```

**0.83% today; structurally ~15% at target scale.**

### The one-way-door question, answered in those words

> **No, it is not a one-way door. But it is a door that only opens forwards.**

Two independent reasons: FOCUS rule 4 means a settled period is never restated,
and `settlement_components` stores unit price and effective window as *copies*
so it structurally cannot be; and the evidence for a widened definition will not
exist retroactively, because whatever gets built starts recording the day it
ships.

**Remedy if the past matters:** `StatementLineKind` already carries
`correction` and `CorrectionReason` carries `tariff_misapplied`, so it is a
**next-period line with the arithmetic shown** — never a quiet reissue of a
closed month.

**The asymmetry that drives the recommendation:** under-billing is recoverable
via a correction line you may choose to issue; over-billing needs a credit note
and an apology. If you are going to be wrong, be wrong in the direction that
does not require one.

### A second defect of the shape chunk 1 found

`agreements.driver_group_memberships` has **only `added_at`** — no status, no
`removed_at`, no validity window. The roster therefore **cannot be intersected
with a billing month at all**: a driver removed in February still looks
enrolled in August.

`assets.connectors` has exactly the same hole (chunk 1: no `disabled_at`, no
status history). **Two of the three tables billing depends on record creation
and never removal.** That is worth knowing whatever is decided about the
definition, and it is the mechanical reason option C below is not available
today.

### The counter-argument, included deliberately

A decision packet that only argues one way is a recommendation wearing a
costume. The packet argues the opposite case at full strength: a resident who is
enrolled with a working RFID is *provided a service* all month whether or not
they plug in — which is **exactly the argument this project already accepted for
connectors**, where a zero-session connector is billed because the fee is for
capacity, not utilisation. Applying capacity logic to connectors and
utilisation logic to drivers is inconsistent, and on that reading the roster is
the better proxy.

It still loses, but for a **mechanical** reason rather than a philosophical
one: the roster has no `removed_at`. If the capacity argument persuades Andri,
the decision is not "narrow to charging" but "add `removed_at` and a status,
then bill the roster" — a larger change that deserves to be chosen rather than
arrived at.

---

## Gates — §5, row by row

| # | gate | status |
|---|---|---|
| 0 | chunk 1's artifact read; state confirmed | **met** — every promised item verified, one filename discrepancy recorded |
| 1 | driver source table cited, pre-Authorize stated as structurally-unattributable not error | **met** — 4 sources |
| 2 | `source` a typed union consistent with chunk 1's | **met** — same shape, drift guard added |
| 3 | charging derivation pure, repository writer around it | **met** |
| 4 | refusal preserved, naming the missing source | **met** — `driver_definition_incomplete`, asserted not to be the generic code |
| 5 | upsert semantics stated; idempotency proven by test | **met** |
| 6 | ≥ 5 driver tests including the refusal path | **met** — 7 derivation + 8 added |
| 7 | ≥ 1 fool-test on the refusal | **met** — 3 tests failed |
| 8 | decision packet, all six parts | **met** — plus a seventh, the counter-argument |
| 9 | size of the gap quantified | **met** — 1 driver, 50 kr/month, 0.83% today / ~15% at MDU scale |
| 10 | commercial consequence in kr, arithmetic shown, at one and ten customers | **met** |
| 11 | narrowing change named by file and symbol | **met** — `flat-fee.ts` → `deriveActiveDrivers`, with the 3 tests that fail by design |
| 12 | one-way-door answered in those words, with the remedy | **met** |
| 13 | completion `.md` and `.json` written **and committed** | **met** |

---

## Commits

| sha | subject |
|---|---|
| `950dc83` | test(driver-activity): idempotency, the named refusal reason, and the fool test |
| `21191c8` | docs: the active-driver decision packet |
| *(this file)* | docs(a2b): completion artifact for chunk 2 of 3 |

---

## External state

No push. No deploy. **No migration applied to any database** — `0002` remains
generated and unapplied. No SQL against any environment; **no database was
connected to**, which is why every figure in the decision packet is cited to a
recorded note and dated rather than measured live. No Cloudflare, Neon or GitHub
mutation. No charger or hardware action, no BLE/NFC. No branch or tag deleted,
no `git clean`, reset, rebase, amend or force. No `.gitattributes` added or
proposed. No secret, token value, idTag, connection string, kennitala or
personal row printed, logged or committed.

The only branch written to is `dev/core-billing-integration`.

*(One user email appears in the decision packet — `kronan@kronan.is` — quoted
from a committed integrity-audit note where it already sits in the repository.
It identifies a test/demo account, not a customer's personal row.)*

---

## The exact state chunk 3 should expect

| | |
|---|---|
| Branch | `dev/core-billing-integration` |
| Tip | `21191c8` plus this artifact's commit |
| Dirty | 0 |
| Tests | **1,590 passing**, 1 skipped, 0 failing (87 files) |
| `npm run check` | **all 16 pass** |

**Exists:**

- Both activity derivations, pure, in `packages/commercial/.../activity-month.ts`.
- Both repository writers plus `runActivityAggregation` in
  `apps/api/src/repositories/activity-month.ts`.
- `docs/notes/2026-08-18-activity-source-census.md` — connector and driver
  source tables.
- **`docs/notes/2026-08-18-active-driver-definition.md` — the decision packet,
  awaiting Andri's answer.**
- `flat-fee.ts` with `generateFlatFeeStatement`, still holding on any
  unavailable count.
- B's invoice rail under `packages/contracts/src/invoice/**`, read-only, CR-1
  closed.

**Does not exist:**

- Feeder wiring to the activity source through a repository interface.
- `scripts/dry-run-first-invoice.mts`.
- Any assertion table for `manually_asserted` (connectors) — preflight delta 9.7.
- Any narrowing of `deriveActiveDrivers`. **It still refuses**, and chunk 3
  must expect every period to hold until Andri answers the packet.

**The thing chunk 3 must plan around:** with the definition unanswered, a real
period holds. The dry run therefore has to supply its driver count explicitly
in its fixture — via `measured(n, "activity_month_table")` — and **say in its
output that it did so**, rather than appearing to have derived it. Otherwise
the dry run will quietly demonstrate a capability that does not exist.

**Chunk 3 is ready to dispatch.**
