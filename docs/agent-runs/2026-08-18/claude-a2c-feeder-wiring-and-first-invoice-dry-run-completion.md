# Claude A2c — Feeder Wiring and the First-Invoice Dry Run

**Completion artifact. Chunk 3 of 3 — the one the other two were for.**

Prompt: `docs/agent-prompts/2026-08-18/2026-08-18-1805-claude-a2c-feeder-wiring-and-first-invoice-dry-run.md`

**Chunks 1 and 2, in two lines.** A2a built the connector activity writer and
decided that a zero-session connector is *active* (the fee is per connector,
not per session). A2b built the driver writer, kept the refusal, and turned
"what makes a driver active" into a costed decision packet.

---

## TL;DR

**The invoice exists.** It is printed in full below, and it is the first time
anyone has seen the output of this path end to end.

Customer 1, March 2026: 30 connectors, 2 drivers, uncapped — **7.564,00 kr**.
Exactly the arithmetic A2b's decision packet predicted.

It runs **with no database and no network**, so every correctness question was
answered offline where being wrong is free. And it **refuses to pretend**: the
driver count is fixture-supplied and the document says so on its own face.

---

## THE RENDERED INVOICE

```
════════════════════════════════════════════════════════════════════════
Sölureikningur nr. SV-2026-000001

KRÖFUHAFI
Straumvakt ehf.
Kt. SYNTHETIC-SELLER-ID
VSK-númer kröfuhafa: SYNTHETIC-VSK-1

GREIÐANDI
Hýsill A ehf.
Dalvegur 10 - 14
201 Kópavogur
IS

Tímabil: 2026-03-01 – 2026-03-31
Útgáfudagur: 2026-04-01  ·  Gjalddagi: 2026-04-15
════════════════════════════════════════════════════════════════════════

LÍNUR
────────────────────────────────────────────────────────────────────────
Lýsing                                  Magn    Ein.verð        Upphæð
Core — active connectors                  30  200,00 kr.  6.000,00 kr.
  CORE_CONNECTOR · connector_month
Core — active drivers                      2   50,00 kr.    100,00 kr.
  CORE_DRIVER · driver_month
────────────────────────────────────────────────────────────────────────
Samtals án vsk (24%)                                      6.100,00 kr.
Virðisaukaskattur 24%                                     1.464,00 kr.
════════════════════════════════════════════════════════════════════════
SAMTALS TIL GREIÐSLU                                      7.564,00 kr.
════════════════════════════════════════════════════════════════════════

Staða afhendingar: unknown  (ekkert var sent — þetta er þurrkeyrsla)

PROVENANCE
  · connector count 30 — DERIVED from 30 activity rows (3 session_observed, 27 status_available)
  · driver count 2 — SUPPLIED BY THE FIXTURE, not derived. The charging-only derivation would give 2; the locked definition ("charging or reporting activity") is not computable because reporting activity has no persisted source. See docs/notes/2026-08-18-active-driver-definition.md
  · cap not binding — 450 kr × 30 connectors
  · document number SV-2026-000001 — allocated, gap-free sequence
  · posture principal — Straumvakt earns this; platform_to_host is the market line
```

**Every value is synthetic**, including the host's registered identity —
following B's `fixtures.ts` convention that no kennitala-shaped value appears
in the repository, because a checksum-valid 10-digit string is
indistinguishable from a real person's national id.

### Three things to notice while reading it

1. **The provenance block is not decoration.** It states which numbers were
   derived and which were handed over. The driver count is the one that was
   handed over, and the document says so rather than letting the reader assume.
2. **3 session_observed, 27 status_available.** Only three connectors saw a
   session all month. A derivation that read "active" as "used" would have
   billed **3 connectors instead of 30** — 600 kr instead of 6.000 kr, an
   under-charge of 5.400 kr on a 6.100 kr invoice, with no error anywhere.
   That is what A2a's zero-session decision is worth, in one number.
3. **`Staða afhendingar: unknown`.** Nothing was delivered, and the dry run
   does not say otherwise.

---

## Run facts

| | |
|---|---|
| Agent | `claude-a`, chunk **A2c of 3** |
| Status | complete — 15/15 gates |
| Start (UTC) | 2026-08-18T18:31:18Z |
| End (UTC) | 2026-08-18T18:46:00Z |
| Wall clock | ~15 minutes |
| Worktree | `E:\Claude\Straumvakt-core-billing` |
| Branch | `dev/core-billing-integration` |
| Start tip | `1b9df38` |
| End tip | `5795ac8` + this artifact's commit |
| Dirty at close | 0 |
| Commits | 2 (+ artifact) |
| Tests | 1,590 → **1,630 passing**, 1 skipped, 0 failing (89 files) |
| `npm run check` | **all 16 pass** |

---

## Phase 1 — The port

`ActivitySourcePort` lives in `packages/commercial` beside the feeder;
`apps/api` supplies `makeActivitySourcePort` over Drizzle.

**That is not architecture for its own sake.** It is what lets the dry run
exercise the entire path with no database, by handing the same feeder a
fixture-backed port. Had the feeder called Drizzle directly, the only way to
see an invoice before `0002` is applied would be to apply `0002`.

**The rule the port enforces: absent rows are `unavailable`, never zero.** Both
methods return `CountEvidence` rather than a number, so an adapter physically
cannot express "I looked and found nothing" as a zero — it must choose, and
choosing wrongly is visible in review. `countFromRows` holds the rule in one
place.

**A consequence worth stating.** With rows-based evidence there is no such
thing as "zero active drivers" — only "no driver rows", which is *unknown*. An
org with connectors and no drivers now **holds** rather than being billed for
connectors alone. A caller that can genuinely assert zero still bills; proven
both ways.

20 tests: the hold on an empty source (five cases, including the property
asserted directly); `countFromRows` in isolation; cap arithmetic end to end
from row counts; rate lock-in through the wiring; and a guard that an
impossible month is rejected *before* spending a query.

---

## Phase 2 — The dry run

`scripts/dry-run-first-invoice.mts`, six cases, 20 subprocess tests.

**Run as a subprocess rather than imported**, because half of what the gates
ask about *is* the exit code — the signal an operator and any automation
downstream consume — and an in-process test would not exercise it.

### Two exit-code modes, because one boolean would make one of them lie

| mode | question | exit 0 when |
|---|---|---|
| one case | *"can this org be invoiced for this period?"* — an operator action | an invoice actually came out. **A period that correctly held still exits 1**, because no invoice exists and nothing downstream may proceed as though one does |
| `--all` | *"does every case still behave?"* — a regression check | every case did what it is specified to do, refusals included. **6/6 today** |

### The six cases

| case | outcome | exit |
|---|---|---|
| `happy-path` | the invoice above | 0 |
| `holds-without-connector-rows` | `connector_count_unavailable: no_activity_source` | 1 |
| `holds-on-real-driver-definition` | `driver_count_unavailable` — **what a live run does today** | 1 |
| `refuses-host-without-kennitala` | `recipient_registered_id_missing` | 1 |
| `refuses-mixed-posture` | `mixed_posture`, rejected **at construction** | 1 |
| `numbering-gap-free-and-crash-safe` | no gaps | 0 |

Four broken fixtures, each exiting non-zero with a readable reason — the gate
asked for three.

### Numbering

```
first        SV-2026-000001
after crash  SV-2026-000001  (same number, sequence not advanced)
re-issued    SV-2026-000001  (reused=true)
next doc     SV-2026-000002
gaps         none
```

Icelandic law requires *samfelld töluröð* — an unbroken sequence — so a number
spent on a document that never existed is a hole that cannot be filled later,
because the documents around it are already in someone else's books. A crash
between allocate and issue re-enters with the same idempotency key and gets the
same number back without advancing the sequence.

### Determinism

Two runs **byte-for-byte identical, 2,782 bytes**. The script **reads no clock
at all** — asserted by a test that greps the source for `Date.now()` and
`new Date()` outside comments.

**Time-dependent fields in a real run, named:** `issueDate` and `dueDate`, and
nothing else. Both are fixture constants here.

### Principal-only, proven

An agent-posture line cannot join this document: B's model rejects mixed
posture **at construction**, not at render — a malformed document that exists
is one some unaudited code path will eventually render.

### The document passes `check:invoice`

`--json` emits the draft; B's validator accepts it, exit 0.

---

## Fool tests — 3

| # | sabotage | caught by |
|---|---|---|
| 1 | `countFromRows` returns `measured(0)` for an empty table | **5 of 20** |
| 2 | the market line given agent posture (`host_to_driver`) | **12 of 20** |
| 3 | the delivery record made to claim `delivered` | **1** |

All restored, all re-verified green.

---

## Gates — §5, row by row

| # | gate | status |
|---|---|---|
| 0 | chunks 1 and 2 artifacts read; state confirmed | **met** |
| 1 | feeder consumes activity through a repository interface, not Drizzle | **met** — `ActivitySourcePort` |
| 2 | a period with no activity rows holds with a named reason | **met** — 5 tests |
| 3 | cap arithmetic end to end from activity rows, ≥ 5 cases | **met** — 7 |
| 4 | rate lock-in proven by test | **met** — incl. pricing at period start |
| 5 | dry run offline, no DB, no network, exits 0 on the happy path | **met** |
| 6 | produces a document that passes `check:invoice` | **met** |
| 7 | **rendered invoice printed in full in the artifact** | **met** — above |
| 8 | principal-only proven | **met** — rejected at construction |
| 9 | numbering transactional, gap-free, crash-safe | **met** |
| 10 | delivery record ends `unknown` | **met** |
| 11 | determinism proven, time-dependent fields named | **met** — `issueDate`, `dueDate` |
| 12 | ≥ 3 broken fixtures each exiting non-zero with a readable reason | **met** — 4 |
| 13 | ≥ 3 fool-tests | **met** — 3 |
| 14 | completion `.md` and `.json` written **and committed** | **met** |

**Fallback queue §6: not started.** The gate table consumed the chunk. All
seven items remain, unchanged, and item 7 (the operator runbook) is now the
most valuable of them because the dry run has proven what it would describe.

---

## What now stands between here and a real invoice

Short, ordered, and every item is Andri's to act on.

1. **Answer the active-driver decision packet.**
   `docs/notes/2026-08-18-active-driver-definition.md`. Option A narrows to
   charging activity and takes minutes. **Until this is answered every real
   period holds** — the dry run's `holds-on-real-driver-definition` case shows
   exactly that.
2. **Authorise migration `0002`.** The preflight pack is
   `docs/notes/2026-08-18-migration-0002-preflight.md` — 48 objects, all
   `CREATE`, no `ALTER`, no `DROP`, no lock on any populated table. The
   rollback window closes at the first generation run.
3. **Decide the connector-assertion gap** (preflight delta 9.7). There is no
   table behind `manually_asserted`, so a connector with no session and no
   StatusNotification in a period produces no row and the period holds. At 21
   chargers that is unlikely; it is not impossible.
4. **Record that the activity job ran** (preflight delta 9.8). Nothing writes
   a `billing_periods` row today, so `activityJobHasRun` has to be passed in
   and the honest default is `false`.
5. **Land the mobile patch** from round 1, `2026-08-18-money-unit-boundary.md`
   §5.2–5.4. Unrelated to the invoice, still blocking that branch's API deploy.

Items 1 and 2 are the only two on the critical path. **Everything else in this
lane is done and proven offline.**

---

## External state

No push. No deploy. **No migration applied to any database.** No SQL against
any environment; **no database was connected to and no socket was opened** —
the dry run is offline by construction. No Cloudflare, Neon or GitHub
mutation. No charger or hardware action, no BLE/NFC. **No third party
contacted.** No branch or tag deleted, no `git clean`, reset, rebase, amend or
force. No `.gitattributes` added or proposed. Nothing under
`packages/contracts/src/invoice/**` edited — it was consumed read-only, and
**no CR-2 was needed**: B's contracts covered everything this chunk required.

No secret, token value, idTag, password, connection string, kennitala or
personal row printed, logged or committed. Every fixture value is synthetic.

The only branch written to is `dev/core-billing-integration`.

---

## The three chunks, as one body of work

| chunk | delivered | gates |
|---|---|---|
| A2a | connector activity writer; zero-session connector is active; salvage of the interrupted run | 12/12 |
| A2b | driver activity writer; the refusal kept and sharpened; the costed active-driver decision packet | 14/14 |
| A2c | the port; the first invoice, printed | 15/15 |

**41 of 41 gates. 1,630 tests passing, 16 of 16 checks green, tree clean.**
