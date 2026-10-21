# Latest Agent Prompts

This index points each active worker window at the prompt it should read when
Andri says "go".

| Agent | Agent ID | Prompt File | Status | Very TL;DR |
|---|---|---|---|---|
| Claude A | `claude-a` | `2026-08-28\2026-08-28-1800-claude-a-asset-model-and-invoice-numbering.md` | **complete** | 29/31 + 1 exception + 1 partial · whole fallback queue · 5 of 6 backlog · 2h08m · tip `eed6503` |
| Claude B | `claude-b` | `2026-08-28\2026-08-28-1800-claude-b-agreement-write-surface-and-clean-shell-assembly.md` | **complete** | 33/33 · 43m46s · tips `d9a8b18` lane, `71101e3` assembly |
| Claude C | `claude-c` | `2026-08-28\2026-08-28-1900-claude-c-mobile-reconciliation-and-money-unit.md` | **ready if a window is free** | Establish the money unit, land the cost fix stranded on a branch since 2026-08-09, collapse four driver-app states into one trunk |
| Codex Work | `codex-work` | `2026-08-28\2026-08-28-1900-codex-work-money-screens-visual-design.md` | ready | **Visual only.** The money screens: every state of a cost, the held period, the provenance block, Icelandic formatting, the empty states |

**A, B and Codex run in parallel.** C dispatches only if a third Claude Code
window is free; nothing waits on it, though the bug it fixes is live.

## Who owns what

| Lane | Tool | Owns |
|---|---|---|
| `claude-a`, `claude-b`, `claude-c` | **Claude Code in Visual Studio** | All code work — backend, schema, mobile engineering |
| `codex-work` | **ChatGPT** | **The visual aspect of the UI only** — driver app and admin/CPO web. Layout, states, copy, formatting, accessibility. Not contracts, not units, not wiring |
| coordinator | **Claude Desktop** | Writes the prompts, reconciles the ledger, decides the lane cut. **Does not write product code** |

**No lane consults legacy data.** This is a fresh start: no backfill, no parity
against the old ledger, no figure from the old system used to size anything.
Chargers get onboarded through the correct pathway when the model is ready for
them — ADR 0054 items 1–6 first, then the placements.

## Round 4 — COMPLETE, both lanes, 2026-08-28

**Nothing pushed. No migration applied to any database.**

| | Claude A | Claude B |
|---|---|---|
| Result | **29/31 gates**, 1 stated exception, 1 partial | **33/33 gates** |
| Wall clock | 2h08m41s | 43m46s |
| Tests | 1,689 → **1,882** / 105 files · 16 checks · 19 fool tests | 992 → 1,076 lane · **1,877 assembled** · 17 checks |
| Beyond the gates | **whole fallback queue + 5 of 6 backlog items** | queue not started — context spent |
| Tip | `eed6503` | `d9a8b18` · assembly `71101e3` |

**What round 4 actually produced**

- **Five migrations generated, none applied** — `0004` the number store, `0005`
  devices/identities/placements under the temporal key, `0006`, `0007` the
  hierarchy, vocabulary and vendor config, `0008` sessions sealed with their
  own context.
- **Billing counts placement overlap, not current rows** — which takes Dalvegur
  from **30 connectors to 20** and stops a mid-month move billing the wrong
  host. The ADR's double-invoice case is a named test *and* a property test
  over eight seeds.
- **The agreement write surface exists** — thirteen operations, effective-dated,
  idempotent, refusing rather than amending a settled period.
- **The clean shell exists in one tree for the first time** — 1,877 tests and
  17 checks green on `dev/clean-shell-assembly`.
- **Two live defects found and fixed**: a CDR with no Energy was priced at zero
  *and* marked complete (`zaptec-session-sync.ts:235`); the cross-tenant
  enrichment view was unconfined on both halves.

**The finding of the round, from B's gate 24:** the two dry runs **do not hand
off**. No shared org, period or sequence — both allocate `SV-2026-000001`. One
function closes it, and it is the highest-value item available anywhere.

**Coordinator failure, now closed:** ADR 0054 and four notes existed on **no
branch** — untracked files in canonical. A found it in its Phase 0 and refused
to duplicate the ADR into a lane branch, correctly.

## Round 5 — the onboarding round, not yet cut

The target changed on 2026-08-28: **a dress rehearsal of the whole product, not
a first invoice.** See `docs/notes/2026-08-28-the-dress-rehearsal.md` and
`SOW-market-phase.md` v2. Six items are open and named:

1. Seal the **owner** on the session — fixes third-party bearers, per-driver
   overrides, and mid-session membership changes in one change
2. Let an organisation statement address **any** org, agent posture when it is
   not the host
3. **Unattributed energy is a critical exception** with the host as residual
   payer — needs a reconciliation surface, reconciled against the meter
4. The **participant** persona — a company whose drivers charge at an
   installation it does not own, with delegated roster management
5. **ADR 0056** — group-to-group access grants, unwritten
6. The cost catalogue v2 — logged, not implemented

## Round 4 — dispatched 2026-08-28 18:00

| | Claude A | Claude B |
|---|---|---|
| Round 1 (08-18 14:15) | 20/20 gates, 57m | 21/21 + full fallback, 45m56s |
| Round 2 (08-18 15:40) | interrupted by a 529 at `e7247b6` | 26/26 + 7/7 fallback, 32m45s |
| Round 2 chunks (18:05) | A2a 12/12 · A2b 14/14 · A2c 15/15 | — |
| Round 3 (20:55) | **22/22 gates, 44m05s** | **21/21 + 7/7 fallback, 27m34s** |
| Round 3 close | 1,689 passed / 1 skipped / 92 files · 16 of 16 checks | 992 root + 176 gateway · 14 checks |
| Round 4 start tip | `8274256` | `7cc591e` |
| Round 4 gates | 31 + 10 fallback + 6 backlog | 33 + 11 fallback + 6 backlog |

**Why these lanes.** ADR 0054 was locked on 2026-08-20 and its items 1–6 must
land **before** the Dalvegur re-onboard, because that run writes the first
placements and a settled period can never be re-priced. Round 4 is that
implementation, split by the one boundary that cannot be crossed:

- **A owns every migration.** `dev/market-rails` carries `0000` and `0001`
  only — it has never seen `0002` or `0003` — so a migration generated in B's
  tree would be numbered `0002` and collide destructively at assembly. A takes
  the whole asset model plus `0004`, the invoice number sequence store A
  deliberately declined to invent in round 3.
- **B takes the two things ADR 0054 does not give it and one thing nobody
  has:** the agreement write surface (B's own artifact: *"setting the flat-fee
  agreement has none — `agreements.ts` is read-only and nothing calls
  `agreement.create`"*, and nobody may hand-edit the database), validity in
  place of existence at every membership and identity call site, and
  **assembly** — A has the money engine and no PDF, delivery or onboarding; B
  has those and no `core-billing`. **The clean shell has never existed in one
  tree.** B merges A's *frozen* `8274256`, never a branch head, onto a new
  `dev/clean-shell-assembly`, and runs both dry runs in sequence there. That is
  the first end-to-end proof this project has had.

## Authority — unchanged since round 1

| | Claude A | Claude B |
|---|---|---|
| Local commits | yes | yes |
| Local merge to a dev integration branch | yes | yes |
| Local branch creation | yes | yes — `dev/clean-shell-assembly` |
| Push | **no** | **no** |
| Generate a migration | **yes — A owns all of them** | **no — would collide at 0002** |
| Apply a migration to any database | **no** | **no** |
| SQL against any environment | no | no |
| Cloudflare mutation | no | **no — read-only `wrangler` verbs only** |
| Register, submit or contact a third party | n/a | **explicitly forbidden** |

**Neither lane is blocked by this.** Every surface goes over a port with a
fixture adapter; the Drizzle adapters are written and never executed. Ledger
notes 21–22.

Still Andri's, and unchanged since 2026-08-20: the active-driver definition,
authorising `0002`/`0003`, session retention, **which PostgreSQL version Neon
serves** (`WITHOUT OVERLAPS` is 18+; below that ADR 0054 needs
`EXCLUDE USING GIST` — A emits both forms rather than stalling), the
`ADMIN_PASSWORD` rotation on exactly three Workers, the two questions for
customer 1, and what "production" means.

## Lane boundary — round 4, by path

| Claude A owns | Claude B owns |
|---|---|
| **`apps/api/drizzle/**` — every migration** | `packages/contracts/**` |
| **`packages/shared/src/db/**` — the Drizzle schema** | `apps/api/src/lib/zaptec.ts`, the vendor importer |
| `packages/commercial/**` | `apps/api/src/routes/**` *except* A's billing tree |
| `apps/api/src/lib/billing/**` | `repositories/agreements*`, `onboarding*`, `zaptec-*` |
| `repositories/activity-month*`, `chargers.ts` | `apps/api/src/routes/internal/ocpp-authorize.ts` |
| **new:** `repositories/devices.ts`, `placements.ts` | `gateway/**`, all `wrangler` configs |
| `apps/api/src/routes/admin/billing/**` | `scripts/analysis/**`, `dry-run-onboard-org.mts` |
| `scripts/dry-run-first-invoice.mts` | |

**The cross-lane channel is reversed this round.** B appends `SR-n` entries to
`docs/notes/2026-08-28-round-4-schema-requests.md` on its own branch; A reads
it with `git show dev/market-rails:...` **at every phase boundary**, not only
in Phase 0, and services or refuses each in writing. **B never waits on an
SR** — it writes the fixture adapter and keeps moving.

Three port signatures are locked and appear **verbatim in both prompts**, so
neither lane waits on the other to agree them: `VendorConfigSinkPort`,
`MembershipValidityPort`, `PlacementResolverPort`.

## Standing rules carried into both prompts

- **The completion artifact is written and committed after every phase**, and
  after every fallback item. Ledger note 16.
- **Deliverable-gated, no wall-clock target — and this round is deliberately
  long.** Each prompt has a gate table, a fallback queue *and* a standing
  backlog, with an explicit rule: **do not stop when the gate table is full.**
  Ledger note 11 still holds — the work is deep, the clock is not a target.
- **Resume, do not restart.** An interrupted run reads its own artifact, finds
  the last committed phase, and continues from the next unmet gate. Notes
  19–20.
- **Never idle on a decision that is Andri's.** Implement the argued option
  behind a named switch, document the fork, continue.
- **Absent is `unavailable`, never zero.** Note 22, applied to every new method
  in both lanes.
- **The five framing corrections of 2026-08-20** are quoted in full in both
  prompts: fresh start, no backfill; the restart's actual diagnosis; the
  dweller is the billable party; Straumvakt never holds money; legacy data is
  reference data and never sizes a decision.
- **Kennitala handling** — no real or checksum-valid value in any fixture, log,
  export or commit.

## Superseded — do not execute

| Prompt | Why |
|---|---|
| `2026-08-18\...-2055-claude-a-period-lifecycle...` | Complete, 22/22. Round 4 follows it |
| `2026-08-18\...-2055-claude-b-onboarding-an-org-to-invoiceable.md` | Complete, 21/21 + 7/7. Round 4 follows it |
| `2026-08-18\...-1725-...-RESUME.md` | Replaced by the A2a/A2b/A2c split, which completed |
| `2026-08-18\...-1540-claude-a-activity-source-and-first-invoice-dry-run.md` | Interrupted; delivered by the three chunks |
| `2026-08-11\...-0955-claude-a-core-billing-merge-blocker-burn-down.md` | Never fired; absorbed into round 1 |
| `2026-08-11\...-0955-claude-b-cloudflare-top-level-readiness-and-liveness-sweeper.md` | Never fired; absorbed as round 1's fallback queue, worked in full |
| `2026-08-28\...-1830-codex-work-driver-money-surface-and-mobile-reconciliation.md` | **Withdrawn the same evening, coordinator error.** It gave the GPT lane engineering work — API contracts, money units, branch reconciliation. Split into the 19:00 codex prompt (visual) and the 19:00 claude-c prompt (engineering) |
| `2026-08-10\...-2305-codex-work-market-core-ui-productization.md` | Ran 2026-08-10 and completed; artifact at `docs/agent-runs/2026-08-10/`. Only the index was ever missing — it was never stalled |
