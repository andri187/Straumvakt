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

## External state — running

No push. No deploy. **No migration applied to any database — `0002`, `0003` and
`0004` all remain generated and unapplied.** No SQL against any environment, no
socket opened, no database connected to. No Cloudflare, Neon or GitHub mutation
— the Neon MCP tools are available to this session and **were not used**,
because operating rule 3 forbids it. No charger or hardware action, no BLE/NFC.
No branch or tag deleted, no `git clean`, reset, rebase, amend or force.
Nothing under `packages/contracts/**` or any of B's paths edited.
`dev/market-rails` was read and never merged. Every fixture value is synthetic.
The only branch written to is `dev/core-billing-integration`.
