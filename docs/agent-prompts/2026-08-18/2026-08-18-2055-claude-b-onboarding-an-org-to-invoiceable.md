---
agent: claude-b
status: ready
round: 3
lane: onboarding-an-org-to-invoiceable
created_utc: 2026-08-18T20:55:00Z
worktree: E:\Claude\Straumvakt-relops-b
branch: scratch/claude-b-release-ops-2026-08-10 (integration: dev/market-rails)
follows: 2026-08-18\2026-08-18-1540-claude-b-production-definition-and-environment-path.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-onboarding-an-org-to-invoiceable-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-onboarding-an-org-to-invoiceable-completion.json
target_wall_clock: none — deliverable-gated
very_tldr: A can now produce an invoice for an org that exists. Nobody has ever walked an org from nothing to invoiceable. Capture the host kennitala at onboarding — your own last zero-dependency item — and exercise the whole path, naming every gap.
---

# Claude B Prompt — Onboarding an Org to Invoiceable

You are `claude-b`. Execute only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude B here.
Verify this header says `agent: claude-b` and `status: ready` first.

This is **round 3**, following the 15:40 dispatch which completed 26 of 26
gates **and its entire fallback queue**. Nothing is superseded; this continues
from `a81860b`.

---

## 0. Why this lane

Claude A has produced customer 1's first invoice as an offline dry run —
`SV-2026-000001`, 30 connectors, 2 drivers, **7.564,00 kr**, no database, no
socket. The money path is proven.

**It is proven for an org that already exists, with chargers already attached
and an agreement already in place.** Nobody has walked an org from nothing to
that state. TASKS.md task 12 — *"admin-onboard customer 1 on the existing
surface, deliberately not gated on self-serve"* — has never been started, and
task 13's self-serve path is blocked behind gaps that were last enumerated on
2026-08-08.

And one of the dry run's four refusal cases is
**`refuses-host-without-kennitala`**. The invoice side correctly refuses to
render a header without the host's registered identity. **Nothing captures it.**

That is your own §6 item 8, and you wrote the reason yourself:

> **Item 8 is the recommendation of this section.** Every other unstarted item
> is someone else's clock. That one is Straumvakt's, it is small, and its cost
> rises with every org onboarded without it — it cannot be added retroactively
> without going back to ask.

---

## 1. Operating rules

1. Work only in `E:\Claude\Straumvakt-relops-b`. Other
   `E:\Claude\Straumvakt*` folders are **read-only comparison**.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; DNS or domain binding; **any
   Cloudflare mutation**; any Neon mutation; any migration against any
   database; live SQL against any environment; GitHub remote mutation; charger
   commands; BLE/NFC; hardware. **No account registered, no form submitted, no
   application filed, no third party contacted.**
4. **Cloudflare access is READ-ONLY**, as before — `whoami`, `queues list`,
   `r2 bucket list`, `deployments list`, `secret list`, `tail` and equivalents
   only. Never read or print a token, secret value or DSN.
5. **Permitted:** local commits, and local merges into `dev/market-rails`.
   **No push.**
6. No `git clean`, delete, prune, reset, rebase, amend, force, branch deletion,
   stash drop or worktree retirement.
7. **Line endings:** settled. `core.autocrlf` is `true` at system level; the
   round-1 claim of 580 whitespace-only files was a coordinator measurement
   error. Propose nothing, run nothing, add no `.gitattributes`.
8. **Write the completion artifact incrementally and commit it after every
   phase.** Standing rule since the 15:40 529.
9. **No wall-clock target.** Deliverable-gated by §6, then continue into §7.
10. Record start and end UTC and actual wall clock, with no target comparison.
11. **Kennitala handling is the sensitive part of this round.** Never print,
    log, export, commit or fixture a real or checksum-valid national id. Every
    test value is synthetic and obviously so, per your own `fixtures.ts`
    convention. Treat the field as an identifier requiring deliberate handling,
    and say in the artifact what handling you specified.

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4.** Rule 5 (tenancy in every row and
every query) governs everything you touch here.

### Lane boundary — round 3

Claude A is working the **period lifecycle and the billing API surface** in
parallel. You are both in `apps/api` now, so the split is by path and it is
strict:

| You own | A owns |
|---|---|
| `packages/contracts/**` | `packages/commercial/**` |
| `gateway/**`, all `wrangler` configs | `apps/api/src/lib/billing/**` |
| `scripts/analysis/observability/**` | `apps/api/drizzle/**` |
| onboarding routes and repositories | `apps/api/src/repositories/activity-month*` |
| `apps/api/src/routes/**` *except* A's tree | **`apps/api/src/routes/admin/billing/**`** |
| | `apps/api/src/routes/public/driver.ts` |

**Do not create or edit anything under `apps/api/src/routes/admin/billing/`.**
A is creating that directory this round precisely so the two of you never edit
one route file.

**Check `docs/notes/2026-08-18-invoice-contract-change-requests.md` in Phase
0.** If A has appended a CR-2, service it before anything else — A is blocked
on you while it stands. CR-1 is closed; do not rewrite it.

---

## 2. Where you left off

`dev/market-rails` at **`a81860b`**. `npm run check` 13 green; 888 + 176 tests.

Round 2 established, all `[cf]` from a read-only session:

- **Production already exists and is called staging.** All three public
  hostnames serve traffic and all three bind to `-staging` Workers.
- **S0 is `ws.straumvakt.org → straumvakt-ocpp-staging`, proven** — not
  inferred. Top-level `straumvakt-ocpp` is unreachable and served zero requests
  in 25 s.
- **Take option (a), promote staging.** Option (c), rename, should be struck.
- **The one-way-door premise was wrong.** Cloudflare has recorded every version
  all along; rollback works today. That had been treated as the single blocking
  release fact since 2026-08-11.
- `hlada-api` has never existed, and the top-level gateway binds `MAIN_APP` to
  it.

You also built the invoice contracts A now consumes, and **kennitala capture in
`packages/contracts`** — the type and validation exist. **Nothing calls it.**
That is Phase 1.

---

## 3. Primary objective

Take an organisation from nothing to **invoiceable**, and prove it offline the
way A proved the invoice.

Invoiceable means, precisely: the org exists with roles set; its host identity
is captured; at least one user is enrolled; at least one charger is attached
with its connectors in the asset chain; and a flat-fee agreement is in force
for the period. **Anything short of that and A's pipeline correctly refuses.**

Ordered:

1. Capture the host kennitala at onboarding, end to end.
2. Exercise the admin-onboarding path (task 12) and name every gap.
3. Re-enumerate task 13's self-serve gaps against current source.
4. An offline onboarding dry run, in A's style, that ends in an org A's
   pipeline would accept.

---

## 4. Phase 0 — Start-state verification

- Branch, start tip, dirty state, `git status --porcelain` counts.
- `git diff --shortstat` and `git diff -w --shortstat`.
- Baseline **before any edit**: `npm run check`, `npx vitest run` (root and
  gateway), `tsc --noEmit`. `node_modules` should still be present; if not,
  `npm install --no-package-lock` — **the repo tracks no `package-lock.json`**,
  so `npm ci` is impossible.
- **Check for a CR-2** in
  `docs/notes/2026-08-18-invoice-contract-change-requests.md`. Service it first
  if present; record its absence if not.
- Record `dev/core-billing-integration`'s tip so the artifact says what A's
  state was when you started. **Do not merge it** — A owns that integration.

---

## 5. The work

### Phase 1 — Host kennitala, captured end to end

The contract exists in `packages/contracts`. Wire it.

Required:

1. **Where it is captured.** Trace the org-creation path and decide the point
   of capture. State whether it is required at creation or can be added later,
   and justify — noting that A's invoice renderer refuses without it, so "later"
   means "an org that cannot be invoiced" and that state must be *visible*, not
   discovered at invoice time.
2. **Storage contract and tenancy.** Which table, which column, `org_id`
   present, who may read it, who may write it, and whether it is ever returned
   on a general org read. An identifier that leaks through a list endpoint is a
   different class of mistake from one that leaks through a detail endpoint.
3. **Validation** — format and checksum. Reject malformed input with a named
   reason. **Do not put a valid kennitala in any fixture**; test the validator
   with deliberately-invalid and synthetic-shaped values, and document why the
   positive path is tested the way it is.
4. **What refuses without it**, and where the refusal surfaces — ideally at
   onboarding, not at invoice time.
5. **An org readiness signal.** Something that answers "is this org
   invoiceable?" before anyone tries. It should name what is missing, in the
   same style as A's holds — a named reason, never a bare boolean.
6. Tests: capture at creation; capture after creation; malformed; missing;
   read by a user of another org; presence in a list response vs a detail
   response; readiness with each prerequisite missing in turn.
7. Fool-test: let the identifier cross an org boundary; prove a test fails.

### Phase 2 — The admin-onboarding path (task 12)

TASKS.md: *"Admin-onboard customer 1 on the existing surface. Deliberately not
gated on self-serve — the invoice must not wait for it."*

The workstream shape from FOCUS.md is:

```
org self-enrols → org created (roles set by Straumvakt admin)
  → invite / enrol users → attach existing chargers
    → set the flat-fee agreement
```

Required:

1. **Walk the existing surface and record what is actually there** — endpoint
   or UI action per step, cited `file:symbol`. Do not describe intent; describe
   what exists.
2. **A gap table**: per step — works / works with hand-setup / missing /
   unsafe. Cite evidence for each. "Works" claimed without a citation is the
   failure mode FOCUS rule 1 exists to prevent.
3. **Attach existing chargers** is the step most likely to be underspecified:
   what identifies a charger, what binds it to an org, what creates its
   connectors in the asset chain, and what happens when a charger already
   belongs to another org. **That last case is an access-grant question — if
   the current behaviour is permissive, that is a finding of the same class as
   the invite-code hijack, and it must be reported that way.**
4. **Set the flat-fee agreement**: what creates the degenerate agreement — one
   cost factor, one rate reference — that A's resolver reads. If there is no
   write surface, say so; round 1 recorded the agreement routes as GET-only and
   that may still hold.
5. **The operator script**: the ordered sequence an admin actually performs,
   with the exact call or action per step and what to verify after each. This
   is the deliverable someone will use on the day.

### Phase 3 — Self-serve gaps (task 13), re-enumerated

The invite-code hijack is fixed (ADR 0053, identity-bound redemption, real-DB
coverage). The 2026-08-08 note recorded **two further defects on the same
path** — the invitee locked out of redeeming their own invite, and the
placeholder user carrying no idToken. Verify both against current source:
fixed, still open, or superseded. Then produce the current gap list for task
13, with each gap's blocking severity, so its `[BLOCKER]` in TASKS.md can be
either lifted or restated accurately.

### Phase 4 — The offline onboarding dry run

In A's style, and for the same reason: prove it where being wrong is free.

`scripts/dry-run-onboard-org.mts` — offline, no database, no network,
exit-code driven — taking a synthetic org from nothing to invoiceable through
ports, and **ending by asserting the org satisfies every precondition A's
pipeline requires**. Print the readiness report in full and include it verbatim
in the completion artifact.

At least four cases: the happy path; an org with no kennitala; an org with no
chargers attached; an org with no agreement in force. Each non-happy case exits
non-zero with a readable reason.

---

## 6. Completion gates — done when all are true

| # | Gate |
|---|---|
| 1 | CR-2 serviced, or its absence recorded |
| 2 | Baseline recorded before any edit |
| 3 | Point of kennitala capture decided and justified against the invoice-time refusal |
| 4 | Storage contract stated: table, column, tenancy, who reads, who writes, list vs detail exposure |
| 5 | Validation implemented with a named refusal for malformed input |
| 6 | **No valid or checksum-valid kennitala in any fixture**, and the positive-path testing approach documented |
| 7 | Org readiness signal implemented, naming what is missing rather than returning a bare boolean |
| 8 | ≥ 7 kennitala tests including cross-org read and list-vs-detail exposure |
| 9 | Existing onboarding surface walked and recorded per step with `file:symbol` citations |
| 10 | Gap table complete: works / hand-setup / missing / unsafe, each with evidence |
| 11 | Charger attach analysed, including the already-belongs-to-another-org case, reported as an access-grant finding if permissive |
| 12 | Flat-fee agreement write surface established or its absence proven |
| 13 | Operator script delivered: ordered, exact action per step, verification per step |
| 14 | The two 2026-08-08 invite defects verified against current source: fixed, open, or superseded |
| 15 | Task 13 gap list produced with severity, sufficient to lift or restate its `[BLOCKER]` |
| 16 | `dry-run-onboard-org.mts` runs offline and exits 0 on the happy path |
| 17 | ≥ 4 cases; every non-happy case exits non-zero with a readable reason |
| 18 | The readiness report printed in full in the completion artifact |
| 19 | The dry run asserts the org satisfies every precondition A's pipeline requires |
| 20 | ≥ 4 fool-tests, each proving a real test fails when the guard is removed |
| 21 | Completion `.md` and `.json` written **and committed incrementally** |

---

## 7. Fallback queue — work in order once §6 is met

1. **The PDF renderer.** The document model exists; nothing renders it to a
   file. This is **option-independent** — your own finding is that customer 1
   can pay a transfer against a PDF, needing only a bank account and an IBAN —
   so it is the delivery half that is not waiting on Andri's format decision.
   Offline, deterministic, golden-file tested like the header. Must render the
   principal posture correctly and refuse a mixed-posture document.
2. **Wire the PDF into the delivery log** so a rendered document moves the
   delivery state, fail-closed, `unknown` until confirmed.
3. **The observability red-gate decision record** — OB14/15/16/17/19/24 are
   known-red. Which must be green before which release step, and what breaks if
   each stays red through the first invoice.
4. **Re-verify the six closed Cloudflare facts** and close the seventh if the
   read-only session can now reach it.
5. **The `ADMIN_PASSWORD` rotation runbook** — four Workers, outstanding since
   2026-08-08, old value compromised via git history. Names only, never a
   value, and **do not perform it**. Note `hlada-api` is not on the list
   because it does not exist.
6. **`Straumvakt-core-security`** — still outstanding and not retired. Report
   read-only; recommend, do not act.
7. **A round-3 revision of the release checklist**, cross-referenced against
   A's operator runbook from its Phase 4 so the two do not drift.

---

## 8. Completion artifact

Write and commit incrementally:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-onboarding-an-org-to-invoiceable-completion.md
```

plus the JSON sidecar, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, **plus** the §6 gate table row by row, the readiness report
in full, and **a plain statement of whether an org can today be walked from
nothing to invoiceable without hand-editing the database** — yes, no, or
yes-with-these-manual-steps.

JSON minimum: `agent`, `round`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null`), `worktree`, `branch`,
`start_tip`, `end_tip`, `dirty`, `commits`, `files_changed`, `checks`,
`gates_met`, `findings`, `fallback_items_done`, `blockers`, `next_actions`,
`external_state`, `very_tldr`.

**External state must state:** no push, no deploy, no DNS or domain binding,
**no Cloudflare mutation — every `wrangler` call read-only, listed by verb**,
no Neon mutation, no migration, no SQL against any environment, no GitHub
remote mutation, no charger or OCPP or BLE or NFC or hardware action, **no
account registered, no form submitted, no application filed, no third party
contacted**, **no real or checksum-valid kennitala written anywhere**, no
branch or tag deleted, no worktree retired, nothing under A's owned paths
touched, and that the only branches written to are your lane branch and
`dev/market-rails`.

Report in chat only a concise TL;DR pointing at the artifact.
