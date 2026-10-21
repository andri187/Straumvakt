# Round 2026-08-18 — dispatch and results

This folder holds both the **prompts** dispatched on 2026-08-18 and the
**completion artifacts** they must produce. Prompt and result sit together so
the round can be read in one place.

Canonical prompt location remains
`docs/agent-prompts/2026-08-18/` — the copies here are for tracking. If they
ever disagree, `docs/agent-prompts/` wins, because that is what `latest.md`
points at and what each window actually reads.

## Dispatched

| Agent | Prompt (copy here) | Completion artifact expected | Status |
|---|---|---|---|
| Claude A | `2026-08-18-1415-claude-a-core-billing-integration-and-blocker-burn-down.md` | `claude-a-core-billing-integration-and-blocker-burn-down-completion.md` + `.json` | ready — awaiting `go` |
| Claude B | `2026-08-18-1415-claude-b-market-rails-invoice-delivery-and-collection.md` | `claude-b-market-rails-invoice-delivery-and-collection-completion.md` + `.json` | ready — awaiting `go` |

Codex Work still points at `2026-08-10/2026-08-10-2305-codex-work-market-core-ui-productization.md`,
which has no completion artifact. Confirm or supersede before the next round.

## What is different about this round

**Deliverable-gated, no wall-clock target.** Twelve consecutive runs under-ran
their targets — 2m49s through 1h13m against 4–14h. Both prompts now carry a
numbered gate table (A: 20 gates, B: 21) plus a fallback queue of 7 items each.
A run is complete when the gates are met, not when a clock says so. See
calibration notes 10–12 in
`docs/notes/2026-08-09-ai-prompt-history-ledger.md`.

**One new authority, and only one:** local merge to a dev integration branch.
No push. No migration applied to any database. No Cloudflare mutation. B may
not register, submit, file or contact any third party.

**A hard lane boundary.** B must not edit `packages/commercial/**`,
`apps/api/src/lib/billing/**`, `apps/api/drizzle/**` or
`apps/api/src/routes/public/driver.ts`. Expected collision point is
`delivery-log.ts` — A owns the code, B owns the contract it satisfies.

**Neither agent touches the CRLF churn.** The canonical checkout shows 584
modified files of which 580 are whitespace-only. A checks
`git diff --cached -w` before every commit so churn cannot enter the merge;
the `.gitattributes` fix is proposal-only in B's fallback queue and must not
run while A holds 77 unmerged commits.

## Superseded by this round

| Agent | Superseded prompt | Why |
|---|---|---|
| Claude A | `docs/agent-prompts/2026-08-11/2026-08-11-0955-claude-a-core-billing-merge-blocker-burn-down.md` | Dispatched 2026-08-11, never fired — no commit exists on any branch after `2026-08-11T09:33:29Z`. Objectives absorbed and extended. |
| Claude B | `docs/agent-prompts/2026-08-11/2026-08-11-0955-claude-b-cloudflare-top-level-readiness-and-liveness-sweeper.md` | Same. Objectives absorbed as §10, the fallback queue. |

Both files now carry `status: superseded` with `superseded_by`,
`superseded_utc` and `superseded_reason` in their headers.

## Still blocked on Andri — not on either agent

These sit on the critical path and no amount of agent work moves them:

1. **Which bank registers as kröfuhafi**, and the delivery format (PDF vs
   PEPPOL/TS-236). B produces the decision packets; the decision is yours.
   This is the long pole — it has real-world lead time.
2. **Authorising migration `0002`.** A produces the preflight pack; applying it
   is a separate approval.
3. **A Cloudflare read-only session.** Seven dashboard facts have been blocked
   on this since before 2026-08-09.
4. **`ADMIN_PASSWORD`** on hlada · hlada-staging · hlada-api · hlada-api-staging.
   The old value is compromised via git history.
5. **Dev-tier cost**: ≈ $40–50/mo hot vs ≈ $5–15/mo scale-to-zero.
   Scale-to-zero recommended in `SERVICES.md`, not picked.
