# Session handover — 2026-08-18 22:07 UTC

Written by the Cowork coordinator session at close. **Read this first next
time.** It records exactly where everything stands, what is dispatched but not
started, and what is waiting on Andri rather than on an agent.

Companion reading, in order: `FOCUS.md` · `CLAUDE.md` rules 1–4 ·
`docs/agent-prompts/latest.md` · `docs/agent-runs/2026-08-18/` ·
`docs/notes/2026-08-09-ai-prompt-history-ledger.md`.

---

## 1. The one-line state

**The invoice exists as an offline dry run. Round 3 is dispatched and has not
started. Two decisions — both Andri's — stand between here and a real invoice.**

---

## 2. Branches

| Branch | Tip | Holds | State |
|---|---|---|---|
| `dev/core-billing-integration` | `a84141e` | The whole money path: resolver, invoice ledger, activity writers, flat-fee feeder, `ActivitySourcePort`, the dry run. `dev/market-rails` merged in at `a81860b`. | **green** — 1,630 tests, 16/16 checks, clean |
| `dev/market-rails` | `a81860b` | Invoice contracts, numbering, delivery, dunning, reconciliation, header, validator, liveness sweeper, kennitala capture contract. | **green** — 13 checks, 888 + 176 tests, clean |
| `dev/straumvakt-org-relaunch` | `82c63ac` | Canonical mainline. Has not moved since 2026-08-10. | **red on `npm run typecheck`** |

Neither integration branch has been pushed. Nothing has been deployed. **No
migration has been applied to any database.**

**Canonical's red is not merge damage.** 118 errors, all under `tools/`, caused
by the 08-10 consolidation commit adding a standalone Next app that the root
tsconfig included but never excluded. Claude A proved it with an empty
`git diff 82c63ac..HEAD -- tsconfig.json tools/` and fixed it in one line on its
branch; the fix reaches canonical when that branch merges.

**Canonical also carries uncommitted mobile work** — ~2,857 lines of new Flutter
screens (`my_vehicle.dart`, `charge_history.dart`, `profile.dart`) plus edits to
`client.dart`, `types.dart` and `menu_drawer.dart`. It belongs to whoever owns
the mobile lane and was not touched.

---

## 3. What was delivered on 2026-08-18

Seven agent runs across three rounds. Six complete, one lost to a platform
incident. Every completion artifact is in `docs/agent-runs/2026-08-18/`.

| Time | Agent | Result |
|---|---|---|
| 14:15 | A | Core-billing integration; merged with **zero conflicts**; three launch blockers closed. **20/20** |
| 14:15 | B | Market rails — delivery + kröfuhafi decision packets, the format-agnostic invoice rail. **21/21 + full fallback** |
| 15:40 | A | **Interrupted — `API Error: 529 Overloaded`.** 2 commits survived, no artifact |
| 15:40 | B | Production definition and the environment path. **26/26 + 7/7 fallback** |
| 18:08 | A2a | Connector activity writer; salvage of the interrupted run; CR-1 merge. **12/12** |
| 18:18 | A2b | Driver activity writer; the refusal kept; the costed active-driver packet. **14/14** |
| 18:31 | A2c | The port; **the first invoice, printed**. **15/15** |

**The invoice**, produced offline with no database and no socket opened,
byte-for-byte reproducible at 2,782 bytes:

```
Sölureikningur nr. SV-2026-000001
Kröfuhafi: Straumvakt ehf.        Greiðandi: Hýsill A ehf.
Tímabil: 2026-03-01 – 2026-03-31

Core — active connectors    30 × 200,00 kr.   6.000,00 kr.
Core — active drivers        2 ×  50,00 kr.     100,00 kr.
                     Samtals án vsk           6.100,00 kr.
                     VSK 24%                  1.464,00 kr.
                     SAMTALS TIL GREIÐSLU     7.564,00 kr.

Staða afhendingar: unknown  (ekkert var sent — þetta er þurrkeyrsla)
```

**The number worth remembering:** 3 connectors saw a session all month, 27 did
not. Reading "active" as "used" would have billed **3 instead of 30** — a
5.400 kr undercharge on a 6.100 kr invoice, with no error raised anywhere.

---

## 4. Round 3 — dispatched, not started

Both prompts are `status: ready`. `docs/agent-prompts/latest.md` points at them.
Ledger rows are in. **Say `go` in each window; they run in parallel.**

| | Claude A | Claude B |
|---|---|---|
| Prompt | `2026-08-18/2026-08-18-2055-claude-a-period-lifecycle-and-the-operable-invoice.md` | `2026-08-18/2026-08-18-2055-claude-b-onboarding-an-org-to-invoiceable.md` |
| Start tip | `a84141e` | `a81860b` |
| Gates | 22 + 7 fallback | 21 + 7 fallback |

**A's round** closes the two engineering items from its own closing list —
preflight delta 9.7 (no table behind `manually_asserted`, so a connector with no
session and no StatusNotification silently holds a period) and delta 9.8
(nothing writes `billing_periods`, so "has the activity job run" is a parameter
someone hands in and the honest default is `false`). Then the billing API
surface over ports under a **new** `apps/api/src/routes/admin/billing/`
directory, then the operator runbook.

**B's round** takes the half nobody has walked. A's invoice is proven for an org
that already exists; one of its four refusal cases is
`refuses-host-without-kennitala`, and **nothing captures it**. B wires the
capture end to end, walks the admin-onboarding path (task 12) with a cited gap
table, re-verifies task 13's blockers, and builds an offline onboarding dry run
that ends by asserting the org satisfies every precondition A's pipeline needs.

**Lane boundary is by path this round** — both agents are in `apps/api` for the
first time. A creates `routes/admin/billing/` as a new directory precisely so
neither edits the other's route file. Cross-lane changes go through
`docs/notes/2026-08-18-invoice-contract-change-requests.md` as CR-2, CR-3…,
which B services in its Phase 0.

---

## 5. Waiting on Andri — nothing here is agent work

Ordered by leverage.

1. **Answer the active-driver decision packet** —
   `docs/notes/2026-08-18-active-driver-definition.md`. The locked definition is
   "charging **or reporting** activity" and reporting activity has no persisted
   event, so it cannot be computed. **Until this is answered every real period
   holds.** The gap is 50 kr/month at customer 1 (0.83% of the bill) but
   structurally ~15% in the MDU shape the product is built for. Narrowing is one
   line — and the door only opens forwards, because closed periods can never be
   re-priced.
2. **Authorise migration `0002`** —
   `docs/notes/2026-08-18-migration-0002-preflight.md`. 48 objects, all
   `CREATE`, no `ALTER`, no `DROP`, no lock on any populated table. **The
   rollback window closes at the first generation run.**
3. **Land the mobile money-unit patch** —
   `docs/notes/2026-08-18-money-unit-boundary.md` §5.2–5.4. The Flutter client
   is inconsistent with itself: `DriverHistorySession` divides `costIsk` by 100,
   `ActiveSession` does not — so **in-flight cost renders 100× too large in
   production today**. The API-side rename must not reach any environment the
   app talks to until the client patch lands.
4. **Rotate `ADMIN_PASSWORD`** on `hlada`, `hlada-staging`,
   `hlada-api-staging`, `straumvakt-ocpp`. Outstanding since 2026-08-08; the old
   value is compromised via git history. `hlada-api` is **not** on the list — it
   has never existed.
5. **Ask customer 1 one question:** krafa, or a transfer against a PDF? It
   re-prioritises the whole collection track. **Nothing blocks customer 1
   today** — a transfer against a PDF needs only a bank account and an IBAN.
6. **Decide the delivery format and the bank** — eight ordered blocking
   questions are written out with the Icelandic wording in
   `docs/notes/2026-08-18-collection-krofuhafi-decision.md`. One phone call.
7. **Decide what "production" means** — promote staging, build top-level fresh,
   or rename. Recommendation is **promote staging**: the only option whose first
   step does not touch 21 live WebSockets. Rename should be struck entirely.
8. **Confirm or supersede the Codex Work dispatch** — still pointed at the
   2026-08-10 23:05 prompt with no completion artifact, 8 days stale. By
   calibration note 10 that is a stalled dispatch.

---

## 6. Findings that changed the map, and should not be re-derived

- **Production already exists and is called staging.** All three public
  hostnames serve traffic and all three bind to `-staging` Workers. S0 is
  `ws.straumvakt.org → straumvakt-ocpp-staging`, **proven**, not inferred.
  Top-level `straumvakt-ocpp` is unreachable and served zero requests in 25 s.
- **Rollback works today.** The "no version id, so the first deploy is a one-way
  door" premise — treated as the single blocking release fact since 2026-08-11 —
  **was wrong**. Cloudflare has been recording every version all along.
- **`hlada-api` has never existed**, and the top-level gateway binds `MAIN_APP`
  to it, so that config cannot deploy into a working state as committed.
- **The kröfuhafi registration is not the long pole.** It is optionality worth
  starting early, not a release gate — unless customer 1 asks for a krafa.
- **TS-236 is not a third delivery option** — it is the Icelandic national
  extension of PEPPOL BIS Billing 3.0.
- **Gap-free invoice numbering is settled by Icelandic law**, not preference —
  *"fyrirfram tölusett með áprentuð númer í samfelldri töluröð"*. No release
  operation, void-in-place, allocation transactional with issue.
- **The cross-tenant CDR hole was never a token collision.**
  `identity.id_tokens.value` is globally unique so that collision is
  unreachable; the real failure needed no coincidence, because the lookup never
  asked whether the driver had any relationship with the host.

---

## 7. Process rules earned today

All are recorded as numbered calibration notes in the ledger; they should
survive into every future prompt.

| # | Rule |
|---|---|
| 10 | A prompt at `status: ready` for >48h with no completion artifact is a **stalled dispatch** — re-confirm or supersede |
| 11 | **Deliverable-gated, no wall-clock targets.** Twelve consecutive runs under-ran 4–14h targets |
| 14 | **Never state git working-tree facts measured through the Cowork Linux bridge** — it cannot see Windows' system-level `core.autocrlf=true`. 584 files from the bridge; 4 from Windows |
| 16 | **Commit the completion artifact after every phase**, never once at the end |
| 17 | Cross-lane defects go in a **handover CR file**, serviced by the owning lane in its Phase 0 |
| 19 | **Chunk long prompts when the platform is degraded** — check status.claude.com first |
| 21 | **Build over a port, test against a fixture adapter, write the Drizzle adapter and never execute it** |
| 22 | **Absent rows are `unavailable`, never zero** — a zero and an unknown look identical on an invoice |
| 23 | Once both agents are in one app, **the lane boundary is by path**, and new work goes in a new directory |

---

## 8. Housekeeping that is still open

- **The coordination layer is untracked** — `docs/agent-prompts/`,
  `docs/agent-runs/`, `docs/memory/`, `docs/OCPP/` (115 MB), `research/`, and
  most 2026-08-18 notes. **A `git clean -fd` in canonical destroys all of it.**
  Committing it onto a dedicated branch also unlocks deleting
  `Straumvakt-parked` and `zaptec-test` — about 528 MB.
- `Straumvakt-diag-p4c` is still detached **and** dirty.
- `Straumvakt-core-security` is outstanding and not retired.
- The Android upload key is on one disk plus one local backup, **both on the
  same machine**.
- A live status board exists as a persisted Cowork artifact,
  `straumvakt-market-phase-status` — update it rather than rebuilding.
