---
agent: claude-a
status: ready
chunk: A2c of 3
lane: feeder-wiring-and-first-invoice-dry-run
created_utc: 2026-08-18T18:05:00Z
worktree: E:\Claude\Straumvakt-core-billing
branch: dev/core-billing-integration
previous_chunk: 2026-08-18\2026-08-18-1805-claude-a2b-driver-activity-and-active-driver-decision.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2c-feeder-wiring-and-first-invoice-dry-run-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2c-feeder-wiring-and-first-invoice-dry-run-completion.json
target_wall_clock: none — deliverable-gated
very_tldr: Chunk 3 of 3. Wire the flat-fee feeder to the activity source, then produce customer 1's first invoice as an offline dry run and print it in full for a human to read.
---

# Claude A2c — Feeder Wiring and the First-Invoice Dry Run

You are `claude-a`. Execute only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A here.

**This is chunk 3 of 3, and the one that matters most.** Everything in chunks 1
and 2 was in service of this.

**Chunks 1 and 2 must have completed.** Read both completion artifacts in
`docs/agent-runs/2026-08-18/` before Phase 0. If either is missing, **stop and
report** — do not attempt their work from here.

---

## 1. Operating rules

1. Work only in `E:\Claude\Straumvakt-core-billing`, on
   `dev/core-billing-integration`. Other `E:\Claude\Straumvakt*` folders are
   **read-only comparison**.
2. **Forbidden without exception:** push; deploy; DNS or domain binding; any
   Cloudflare or Neon or GitHub mutation; **running any migration against any
   database, including dev and scratch**; live SQL against any environment;
   production or staging personal rows; charger commands; BLE/NFC; hardware.
   **The dry run touches no database and needs no network.**
3. **Permitted:** local commits and local merges into
   `dev/core-billing-integration`. **No push.**
4. No `git clean`, delete, prune, reset, rebase, amend, force, branch deletion,
   stash drop or worktree retirement.
5. **Line endings:** `core.autocrlf` is `true` at system level. Keep a
   pre-commit `git diff --cached -w` check. Propose nothing, run nothing, add
   no `.gitattributes`.
6. **Write the completion artifact incrementally and commit it** — after
   Phase 1, and again after Phase 2.
7. Lane boundary: read and consume `packages/contracts/src/invoice/**`, never
   edit it. **This chunk consumes it heavily** — if a contract blocks you,
   append CR-2 (CR-3…) to
   `docs/notes/2026-08-18-invoice-contract-change-requests.md` and work around
   it; do not fork it. B is idle, so a new CR will not be serviced today. Say
   plainly in the artifact whether it blocks.
8. No wall-clock target. Deliverable-gated by §5.
9. Never print, echo, log or commit a secret, token value, idTag, password,
   connection string, kennitala or personal row. **Every value in the dry-run
   fixtures is synthetic**, including the host kennitala.

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4.** Rule 3 governs this chunk: one
money engine, two money lines, and the flat fee is **Straumvakt's own money on
the principal line**.

---

## 2. Context

**The two money lines.** Straumvakt ↔ host is Straumvakt's money, principal
posture, own invoice — **this is the market line and the only one in scope**.
Host ↔ driver is the host's money, agent posture, kröfuhafi is the host,
rendered "Straumvakt f.h. \<host\>" — deferred, needs attribution, and **must
not appear in this document**. Lines of different posture never share an
invoice, because the header is the legal artefact.

**Gap-free numbering is settled by Icelandic law, not preference** —
*"fyrirfram tölusett með áprentuð númer í samfelldri töluröð"*. B's contract
already enforces it: no release operation, void-in-place, allocation
transactional with issue. **Conform; do not design around it.**

**What B built that you consume:** document model (mixed posture rejected at
construction), gap-free numbering, delivery contract, dunning, reconciliation,
header contract, 65 fixtures, and the `check:invoice` validator. B's round 2
also added **kennitala capture** — check whether the host identity field the
header needs is populated from it.

---

## 3. Phase 1 — Wire the feeder to the activity source

The flat-fee feeder (`packages/commercial/src/core-billing/flat-fee.ts`) was
built in round 1 and refuses rather than inventing a count. Chunks 1 and 2 gave
it a source. Connect them.

Required:

1. **Connect through a repository interface, not Drizzle directly** — the
   feeder depends on a contract, not an ORM.
2. **Prove by test that a period with no activity rows *holds* with a named
   reason** rather than producing a 0 kr invoice. A zero and an unknown look
   identical on an invoice, and only one of them is honest.
3. **Cap arithmetic end to end from activity rows**, not hand-passed counts —
   at least five cases: below cap; exactly at cap; above cap; zero drivers;
   many drivers on one connector.
4. **Rate lock-in proven by test:** unit price and effective window stored as
   **copies** on the settlement rows, so editing a rate row later cannot
   restate a settled period.
5. Remember round 1's finding: **a subscription line cannot be stored as a
   settlement component** — `RateComponentKind` is only
   `dso | retailer | cpo_addon`, and `settlement_components.session_id` is
   `NOT NULL` while the flat fee has no session. Statement lines are fine:
   `StatementLineKind` carries `subscription_connector`,
   `subscription_driver` and `cap_relief`. Do not re-litigate this; conform to
   it, and if the wiring reveals it was wrong, that is a finding worth stating
   loudly.
6. **Commit the artifact so far.**

---

## 4. Phase 2 — The first-invoice dry run

Build `scripts/dry-run-first-invoice.mts` — **runnable offline, no database, no
network, exit-code driven** — taking a synthetic org through the entire path:

```
org + asset chain + agreement fixture
  → connector activity + driver activity rows   (chunks 1 & 2)
    → flat-fee statement lines
      → statement, grouped by (claim holder, counterparty, period)
        → invoice document               (B's model, principal posture)
          → npm run check:invoice validator
            → rendered header + document
              → delivery record in state `unknown`
```

Required:

1. **Print the rendered invoice in full**, and include it **verbatim in the
   completion artifact**. A human has to read it. That is the entire point of
   this chunk — every other deliverable is a test asserting something a person
   already believes; this one is the first time anyone sees the actual output.
2. **Use B's real contracts** — document model, numbering, header, validator —
   never a parallel implementation.
3. **Principal line only.** Assert by test that an agent-posture line cannot
   join this document.
4. **Numbering:** prove allocation is transactional with issue, gap-free, and
   that a crash between allocate and issue does not consume a number.
5. **Delivery record ends `unknown`, never `delivered`.** Nothing was
   delivered; the dry run must not lie about it.
6. **Determinism:** a second run produces an identical document byte for byte,
   except where a field is legitimately time-dependent — and those fields must
   be named in the artifact.
7. **At least three deliberately broken fixtures** — a period with a hold, an
   org with no kennitala, a mixed-posture attempt — each exiting non-zero with
   a readable reason.
8. **≥ 3 fool-tests** across this chunk, each proving a real test fails when
   the guard is removed.

---

## 5. Completion gates — done when all are true

| # | Gate |
|---|---|
| 0 | Chunks 1 and 2 completion artifacts read; the state they describe confirmed present |
| 1 | Feeder consumes activity through a repository interface, not Drizzle directly |
| 2 | A period with no activity rows **holds** with a named reason — proven by test |
| 3 | Cap arithmetic proven end to end from activity rows, ≥ 5 cases |
| 4 | Rate lock-in proven by test |
| 5 | `dry-run-first-invoice.mts` runs offline, no database, no network, and exits 0 on the happy path |
| 6 | It produces a document that passes `check:invoice` |
| 7 | **The rendered invoice printed in full in the completion artifact** |
| 8 | Principal-only proven: an agent-posture line cannot join the document |
| 9 | Numbering proven transactional, gap-free, and crash-safe between allocate and issue |
| 10 | Delivery record ends `unknown` |
| 11 | Determinism proven across two runs, with time-dependent fields named |
| 12 | ≥ 3 broken fixtures each exiting non-zero with a readable reason |
| 13 | ≥ 3 fool-tests, each proving a real test fails when the guard is removed |
| 14 | Completion `.md` and `.json` written **and committed** |

---

## 6. Fallback queue — work in order once §5 is met

This is the tail of the original round-2 queue. Reaching it means the invoice
path is proven; everything here is hardening around it.

1. **Point the parity harness at the new ledger** — the 1,621 legacy
   `session_ledger` rows and the 64 test-branch priced sessions, with the
   vacuity guard, per the harness from `a28e9b8`.
2. **Census row 104 (`billing-enrichment.ts`)**, deferred since round 1.
3. **The 22 remaining `missing-orgIdParam` gates** — each removal from the
   allowlist with a test that fails when the scope is removed.
4. **Prisma → Drizzle** for every file these three chunks touched, per FOCUS
   rule 1's exception. Repository before route.
5. **30 Gherkin scenarios** for the flat-fee path: month boundary; org with no
   connectors; org added mid-period; cap edge; disputed line; a period that
   holds; a re-run after correction.
6. **The legacy retirement plan** per FOCUS rule 1's harvest protocol step 3 —
   what parity coverage each silently-failing surface needs before the old path
   can retire.
7. **The operator runbook** for customer 1's real invoice once `0002` is
   applied — numbered, with a stop point at each irreversible step, and
   cross-referenced to **B's round-2 revision** of its release checklist (not
   the 2026-08-18 15:13 version, which B superseded).

---

## 7. Completion artifact

Write and commit:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2c-feeder-wiring-and-first-invoice-dry-run-completion.md
```

plus the JSON sidecar, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, **plus**:

- That this is chunk 3 of 3, and a two-line summary of what chunks 1 and 2
  delivered, so the three artifacts read as one body of work.
- **The rendered dry-run invoice, in full.**
- The §5 gate table row by row, and how far into §6 you got.
- **What now stands between here and a real invoice**, stated as a short
  ordered list. After this chunk that list should be short, and Andri should be
  able to act on every item in it.

JSON minimum: `agent`, `chunk`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null`), `worktree`, `branch`,
`start_tip`, `end_tip`, `dirty`, `commits`, `files_changed`, `tests`,
`gates_met`, `fallback_items_done`, `blockers`, `next_actions`,
`external_state`, `very_tldr`.

**External state must state:** no push, no deploy, **no migration applied to
any database**, no SQL against any environment, no Cloudflare or Neon or GitHub
mutation, no charger or hardware action, no third party contacted, and that the
only branch written to is `dev/core-billing-integration`.

Report in chat only a concise TL;DR pointing at the artifact.
