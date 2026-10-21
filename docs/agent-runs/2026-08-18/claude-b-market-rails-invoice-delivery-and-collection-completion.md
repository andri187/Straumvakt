---
agent: claude-b
lane: market-rails-invoice-delivery-and-collection
status: complete
prompt: docs/agent-prompts/2026-08-18/2026-08-18-1415-claude-b-market-rails-invoice-delivery-and-collection.md
start_utc: 2026-08-18T14:27:49Z
end_utc: 2026-08-18T15:13:45Z
wall_clock: 45m56s
target_wall_clock: none — deliverable-gated this round
target_met: null
worktree: E:\Claude\Straumvakt-relops-b
external_mutation: none
---

# Claude B — completion: market rails, invoice delivery and collection

## TL;DR

1. **TASKS.md task 8 is decidable.** Two packets, every claim basis-labelled,
   a <200-word answer page, and eight ordered blocking questions with the
   exact Icelandic wording to put to a bank.
2. **The reversible half of the decision is the format; the permanent half is
   numbering and header semantics.** Both permanent halves are now built to
   the stricter standard, so PEPPOL later is a mapper, not a migration.
3. **The whole format-agnostic rail shipped** — document model, gap-free
   numbering, delivery contract, dunning, reconciliation, header contract,
   65 fixtures, a runnable offline validator wired into `npm run check`.
4. **A read-only Cloudflare session was available**, so six of the seven
   blocked facts are closed — and `hlada-api` turns out never to have existed.
5. **`npm run check`: all 12 green. 846 tests pass** (baseline 641 + a suite
   that could not run).

---

## Timing

| | |
|---|---|
| Start | `2026-08-18T14:27:49Z` |
| End | `2026-08-18T15:13:45Z` |
| Wall clock | **45 m 56 s** |
| Target | **none — this round was deliverable-gated, not time-boxed** |
| Target met | `null` (no target set) |

All 21 completion gates met, then the full §10 fallback queue worked.

---

## State

| | Start | End |
|---|---|---|
| Branch | `scratch/claude-b-release-ops-2026-08-10` | unchanged |
| Tip | `815425a` | **`608749f`** |
| Dirty | 0 | **0** |
| `git diff --shortstat` | empty | empty |
| `git diff -w --shortstat` | empty | empty |
| Integration branch | — | **`dev/market-rails` at `608749f`** (local only, never pushed) |

**Diff across the run:** 29 files changed, +6011 / −24.

### Phase 0 findings that changed how the run went

- **`node_modules` was absent** (the 2026-08-11 run was blocked by this).
  `npm ci` is impossible — **there is no `package-lock.json` in this repo** —
  so `npm install --no-package-lock` was used, which installed 945 packages
  without creating a lockfile the repo does not track.
- **Network egress works.** registry.npmjs.org, skatturinn.is, rb.is all
  reachable. This is what let Phases 1–2 be `verified-external-source` rather
  than `requires-confirmation` throughout.
- **`wrangler` is authenticated** (OAuth, `andrith187@gmail.com`). The
  2026-08-11 blocker is gone. **No token value was read or printed.**
- **Baseline before any edit:** vitest 641 passed / 1 skipped, 1 suite
  failing (`apps/api` ocpp-authorize, missing generated Prisma client);
  `tsc --noEmit` clean.

---

## Commits — 6 slices

| SHA | Slice |
|---|---|
| `4b688c6` | docs: the two decision packets |
| `3aace15` | feat: the format-agnostic invoice rail |
| `084c0dd` | feat: liveness sweeper + OB18 false-pass fix |
| `b1d333c` | docs: the release-ops queue (§10) |
| `91f7760` | chore: regenerate dependency graph |
| `608749f` | chore: commit the generated work-view page |

---

## Deliverables against the §9 gate table

| # | Gate | Result |
|---|---|---|
| 1 | Delivery packet, seven sections | ✅ `docs/notes/2026-08-18-invoice-delivery-decision.md` |
| 2 | Every factual claim basis-labelled | ✅ four labels, no unlabelled numbers in either packet |
| 3 | <200-word answer page at the top | ✅ 194 words |
| 4 | Reversibility separates permanent from changeable | ✅ §5, two tables |
| 5 | Collection packet, seven sections | ✅ `docs/notes/2026-08-18-collection-krofuhafi-decision.md` |
| 6 | Ordered blocking questions, why-it-blocks + what-unblocks | ✅ 8 questions, placed first |
| 7 | Lead time as a timeline with named unknowns | ✅ serial spine S1–S5 + parallel P1–P6; each unknown as "ask X this question" |
| 8 | Agent-posture requirements split per money line | ✅ §4 table |
| 9 | "What can start today" named precisely | ✅ 10 rows, 7 done this run |
| 10 | Document model, mixed posture rejected at construction | ✅ `document.ts`, tested |
| 11 | Numbering, ≥4 concurrency/retry/rollover tests | ✅ 17 tests |
| 12 | Delivery-log contract + handover target named | ✅ `delivery.ts`; target `packages/commercial/src/core-billing/delivery-log.ts` |
| 13 | Fail-closed; delivered/unknown/failed proven end to end | ✅ `delivery.test.ts` |
| 14 | Dunning transition table | ✅ `dunning.ts` |
| 15 | ≥40 fixtures | ✅ **65** (35 document, 11 delivery, 15 settlement, 4 numbering) |
| 16 | Runnable offline validator, demonstrated | ✅ `scripts/validate-invoice.mts`, wired as `npm run check:invoice`; run against real JSON, exit 0 and exit 1 both shown |
| 17 | Header rules both postures | ✅ `header.ts` |
| 18 | Mixed-posture render impossible, proven | ✅ 4 tests incl. one proving the cached posture field is not trusted |
| 19 | Golden file per posture | ✅ `__golden__/header-{principal,agent}.txt` |
| 20 | ≥4 fool-tests | ✅ **8** (7 in `fool.test.ts` + 1 in the sweeper suite) |
| 21 | Completion `.md` + `.json` | ✅ this file and its sidecar |

**21 of 21.**

---

## §10 fallback queue — 7 of 7

1. ✅ **Top-level config — explicit HOLD**, with the reasoning. Not a patch,
   because every step of a patch is an account mutation.
2. ✅ **Liveness sweeper built** — `gateway/src/liveness-sweeper.ts`, 31 tests.
3. ✅ **Queue/DLQ/R2 semantics** — per-event-class table and message envelope.
4. ✅ **CRLF** — measured; **the premise does not reproduce**; recommend not
   running it.
5. ✅ **Six of seven Cloudflare facts closed** from the read-only session; the
   seventh named honestly as not closed.
6. ✅ **OB16–OB28 re-verified** — all unchanged except OB18, which was wrong.
7. ✅ **Customer-1 release checklist** with a stop point at each irreversible
   step.

---

## Checks run

| Check | Result |
|---|---|
| `npm run check` | **all 12 passed** |
| `npx vitest run` (root) | **846 passed, 1 skipped, 58/58 files** |
| gateway vitest | **157 passed, 7/7 files** |
| `tsc --noEmit` + workspaces + gateway | **0 errors** |
| `check:invoice` self-test | 35/35 document fixtures, corpus 65 |
| observability gate self-test | **83 passed, 0 failed** (was 81) |
| observability gate vs real tree | **11 errors, 3 warnings** (was 10/3) |

**On the two checks that were red mid-run and are now green:** `typecheck`
and the failing vitest suite were both the *missing generated Prisma client*,
not a defect — `npm run db:generate` (local codegen, no database contacted)
cleared both. `check:work-view` was red at the **start tip** because the
generated page was not tracked on this branch at all; regenerating and
committing it makes `npm run check` green from a clean clone rather than only
on a worktree where someone ran the generator.

---

## Important corrections to earlier assumptions

**To the prompt's own premises:**

1. **The CRLF premise does not reproduce.** The dispatch says the canonical
   checkout carries "580 whitespace-only modified files because there is no
   `.gitattributes` and `core.autocrlf` is unset." Measured read-only: **4
   modified files**, `git diff --shortstat` **identical** to `git diff -w
   --shortstat` (so none whitespace-only), and **`core.autocrlf` is `true`,
   set at the SYSTEM level** — hence applying to all 13 worktrees.
   `.gitattributes` is indeed absent. Recommendation flips from "propose a
   normalisation sequence" to **"do not run one"**.
2. **TS-236 is not a separate delivery option.** §5 of the prompt asks for it
   alongside PEPPOL. It *is* the Icelandic national extension of PEPPOL BIS
   Billing 3.0. This removes an option rather than adding one.
3. **No format is disqualified for the agent line.** The prompt anticipated a
   format that cannot express "Straumvakt f.h. \<host\>". EN 16931's BG-10
   Payee (BT-59/BT-60) is designed for exactly this. The real distinction is
   weaker and more useful: **PDF permits the correct header, PEPPOL requires
   it.**

**To the 2026-08-11 run's conclusions:**

4. **`hlada-api` has never existed.** That run's census "assumes the former
   conservatively" — that it is production. Conservative in the wrong
   direction: `wrangler deployments list --name hlada-api` returns
   `code: 10007, This Worker does not exist on your account`.
5. **"Top-level declares no queues/DLQ/R2" understated it** — the account has
   no production queues or buckets *at all*. All six queues and the one
   bucket are `-staging`.
6. **OB18 was giving a FALSE PASS.** Its `[\s\S]{0,3000}?` window after
   `async alarm(` matched a `liveness` reference in a *different method* ~100
   lines below, so the gate passed while the alarm body was verbatim the
   outbound-command timeout sweep its own error text says does not count.
   Now brace-matched to the actual method body, plus two regression fixtures.
   **Fourth instance in that file of a rule matching text near the thing
   instead of the thing — and the first that hid a gap rather than raising a
   false alarm.**

**To my own work, mid-run:**

7. The golden files caught a real header defect on their **first** render —
   `Kröfuhafi er Hýsill A ehf..`, a doubled full stop because Icelandic
   company names end in "ehf.". Fixed before the goldens were committed.
8. An early attempt to recover exact ISK fees from Landsbankinn's price-list
   PDF produced a **plausible but misaligned** column mapping. It was
   discarded rather than published: the fee *labels* are quoted verbatim and
   every amount is a `[confirm:]`.

---

## Findings

1. **The long pole is not what it looked like.** Nothing blocks customer 1 —
   transfer against a PDF needs only a bank account and an IBAN. The
   kröfuhafi track is optionality worth starting early, not a release gate,
   **unless customer 1 asks for a krafa** (blocking question Q1).
2. **Gap-free numbering is settled by law, not preference** — *"fyrirfram
   tölusett með áprentuð númer í samfelldri töluröð"*. This forces: no
   release operation, void-in-place, and allocation transactional with issue.
3. **Per-claim bank fees may change the billing period.** A single-connector
   host is a 200 kr invoice; the fee taxonomy shows you pay per claim
   created, per slip, per change, per payment and per escalation. If those
   are a material fraction of 200 kr, monthly billing is wrong. That is Q6
   and it can change the product, not just the code.
4. **The bank duns on its own.** If bank reminders are enabled, Straumvakt
   must not also dun — hence the `externally_managed` mode that tracks state
   and emits nothing.
5. **The `yfirlýsing` nobody has on a list.** Electronic bookkeeping requires
   a declaration from the seller or the software's author that the system
   meets the requirements. It is not code, it is a signature, and it is the
   cheapest thing in the packet to get wrong.
6. **Top-level is not a degraded environment, it is an absent one.** Two of
   three Workers do not exist; the third last deployed 2026-04-19 and its
   secret set is the pre-Sprint-4.5 architecture.
7. **The top-level gateway binds `MAIN_APP` to a Worker that has never
   existed**, so that config cannot deploy into a working state as committed.

---

## Files created and changed

**Created (docs):** `docs/notes/2026-08-18-invoice-delivery-decision.md` ·
`docs/notes/2026-08-18-collection-krofuhafi-decision.md` ·
`docs/notes/2026-08-18-release-ops-queue.md`

**Created (code):** `packages/contracts/src/invoice/{document,number,delivery,dunning,reconciliation,header,index,fixtures}.ts`
· 6 test files · 2 golden files · `scripts/validate-invoice.mts` ·
`gateway/src/liveness-sweeper.ts` + its test ·
`src/app/(app)/admin/work/page.tsx` (generated)

**Changed:** `package.json` (adds `check:invoice`) ·
`packages/contracts/package.json` (8 export entries) · `scripts/check-all.mjs`
(wires the invoice gate) ·
`scripts/analysis/observability/check-observability.mjs` (OB18 + 2 fixtures) ·
`docs/architecture/dependency-graph.md` (regenerated)

**Lane boundary respected.** No file under `packages/commercial/**`,
`apps/api/src/lib/billing/**`, `apps/api/drizzle/**` or
`apps/api/src/routes/public/driver.ts` was read for modification or touched.
The `delivery-log.ts` overlap was handled as specified: A owns the code, this
run owns the contract and the fixtures, and the handover target is named in
the file header.

---

## External state confirmation

**No push. No deploy.** No DNS or domain binding. **No Cloudflare mutation** —
every `wrangler` call was read-only (`whoami`, `queues list`,
`r2 bucket list`, `deployments list`, `secret list`, `tail`); no `deploy`,
`publish`, `put`, `create`, `delete` or `versions upload` was run. **No Neon
mutation. No migration. No SQL against any environment.** No GitHub remote
mutation. No charger, OCPP, BLE, NFC or hardware action. **No account was
registered, no form submitted, no application filed and no third party
contacted.** No branch or tag deleted; no worktree retired; no file deleted or
moved. No new top-level folder under `E:\Claude`.

**The only branch created is `dev/market-rails`**, local, at `608749f`, per
§1 rule 4. It was not pushed. Claude A's branch was **not** merged into it —
A's integration lane is `dev/core-billing-integration` and merging a peer's
in-flight branch is not this lane's call.

**Secrets:** no token, key, DSN, password, connection string, kennitala or
bank account number was printed, logged, exported or committed. `wrangler
secret list` returns **names only** and only names appear in the artifacts.
No fixture in this run uses a kennitala-shaped value — deliberately, and the
reason is documented in `fixtures.ts`.

**Dependencies were installed** into `E:\Claude\Straumvakt-relops-b\node_modules`
(945 packages, no lockfile written since the repo tracks none), and
`prisma generate` was run — local codegen only, no database contacted.

**Read-only worktrees were read only.** `E:\Claude\Straumvakt` was inspected
for the CRLF measurement and not modified; its 4 modified files belong to
someone else and were not touched.

---

## Cleanup candidates created

- `E:\Claude\Straumvakt-relops-b\node_modules` — 945 packages installed this
  run. Gitignored. Retire it if disk matters; the next run needs it again.
- `src/generated/prisma` — Prisma client, generated locally. Gitignored.
- Nothing else. No worktree retired (rule 6). `Straumvakt-core-security`
  remains outstanding and **not retired**, as before.

---

## Exact next human actions

1. **Ask customer 1 one question:** do you need a krafa, or will you pay a
   transfer against a PDF? It re-prioritises the entire collection track.
2. **Ask one bank Q4–Q7** (the wording is written out). One phone call.
   Landsbankinn publishes 410 4000.
3. **Capture host kennitala at onboarding.** The only remaining
   zero-dependency task, and its cost rises with every org onboarded without
   it — it cannot be added retroactively without going back to ask.
4. **Decide what "production" means** (§1 of the release-ops note): promote
   staging, build top-level fresh, or rename. The config cannot be written
   correctly before that.
5. **Record a version id.** Still the single blocking release fact, unchanged
   since 2026-08-11.
6. **Ask the accountant the four `[confirm: accountant]` questions**, one of
   which (the `yfirlýsing`) touches the first invoice.
