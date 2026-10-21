---
agent: claude-b
status: ready
lane: production-definition-and-environment-path
created_utc: 2026-08-18T15:40:00Z
worktree: E:\Claude\Straumvakt-relops-b
branch: scratch/claude-b-release-ops-2026-08-10 (integration: dev/market-rails)
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-production-definition-and-environment-path-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-production-definition-and-environment-path-completion.json
target_wall_clock: none — deliverable-gated
follows: 2026-08-18\2026-08-18-1415-claude-b-market-rails-invoice-delivery-and-collection.md
very_tldr: Answer the question your own HOLD is blocked on — what "production" means — then build every part of the path to it that is not an account mutation, so the day Andri decides, the work is already done.
---

# Claude B Prompt — Production Definition and the Environment Path

You are `claude-b`. Execute this prompt only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude B to this
file. Verify this header says `agent: claude-b` and `status: ready` before
doing anything.

This prompt **follows** the 2026-08-18 14:15 dispatch, which completed with all
21 gates met **and the entire fallback queue worked** — the first run ever to
do so. Nothing in it is superseded; this continues from `608749f`.

---

## 0. Why this lane

Your release-ops note ends with a `[confirm:]` that everything downstream waits
on:

> `[confirm: Andri — is the intended production path (a) promote staging in
> place, (b) create top-level resources and deploy fresh, or (c) rename? Each
> implies a different answer to "what does top-level declare", and the config
> cannot be written correctly before that is chosen.]`

You were right to HOLD rather than patch. A placeholder that looks like
configuration is exactly how `hlada-api` came to be referenced by a service
binding without ever existing.

But a HOLD is only correct while the decision is genuinely un-makeable. **Your
job this round is to make it makeable** — and then to build every part of the
path that is not an account mutation, so that whichever way Andri decides, the
next step is execution rather than design.

---

## 1. Operating rules

1. Work only in `E:\Claude\Straumvakt-relops-b`. Every other
   `E:\Claude\Straumvakt*` folder is **read-only comparison**.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; bind domains; DNS; **any
   Cloudflare mutation**; any Neon mutation; any migration; live SQL against any
   environment; GitHub remote mutation; charger commands; BLE/NFC; hardware.
   **No account is to be registered, no form submitted, no application filed and
   no third party contacted.**
4. **Cloudflare access is READ-ONLY**, exactly as last round. `whoami`,
   `queues list`, `r2 bucket list`, `deployments list`, `secret list`, `tail`
   and equivalents are permitted. `deploy`, `publish`, `put`, `create`,
   `delete`, `versions upload` and every other mutating verb are **not** — even
   if they would succeed, and even if a phase below would be easier with them.
   Never read or print a token, secret value or DSN. `secret list` returns names
   only; only names may appear in artifacts.
5. **Permitted, unchanged:** local commits, and local merges into
   `dev/market-rails`. **No push.**
6. No cleanup, deletion, `git clean`, prune, reset, branch deletion or worktree
   retirement.
7. **S0 is absolute.** The gateway's charger-facing hostname must not change.
   21 chargers hold live WebSockets against it. Nothing in this prompt may
   produce a plan whose first step breaks that, and every plan must say
   explicitly what it does to S0.
8. **Line endings — you were right, this is now settled.** You measured
   `core.autocrlf=true` at the SYSTEM level, 4 modified files, `--shortstat`
   identical to `-w --shortstat`. The 14:15 dispatch's premise was a
   coordinator measurement error made through a Linux bridge with no
   `/etc/gitconfig`. Recorded as calibration note 14. **Propose nothing, run
   nothing, add no `.gitattributes`.** The item is closed.
9. **Lane boundary.** You own `gateway/**`, all `wrangler` configs,
   `scripts/analysis/observability/**`, and `packages/contracts/src/invoice/**`.
   You must **not** edit `packages/commercial/**`,
   `apps/api/src/lib/billing/**`, `apps/api/drizzle/**` or
   `apps/api/src/routes/public/driver.ts`. Claude A is merging `dev/market-rails`
   into `dev/core-billing-integration` this round and consuming your invoice
   contracts read-only; if A needs a contract change it will file a request in
   `docs/notes/2026-08-18-invoice-contract-change-requests.md`. **Check for that
   file in Phase 0 and, if it exists, service it first** — A is blocked on you
   while it stands.
10. **No wall-clock target.** Deliverable-gated: complete when §8's counts are
    met, then continue into §9. You cleared your whole fallback queue last
    round; that is now the standard, not the exception.
11. Record start and end UTC and actual wall clock for the ledger, with no
    target comparison.
12. Never print, echo, log, export or commit a secret, token, password,
    connection string, kennitala or bank account number.

---

## 2. Context you must not re-derive

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4 first.**

**What you established last round**, all `[cf]` from a read-only session:

| Worker | Exists | Last deployment | Note |
|---|---|---|---|
| `hlada` (console, top-level) | yes | **2026-04-23** | holds `OCPP_WEBHOOK_SECRET` — the dead pre-Sprint-4.5 path |
| `hlada-staging` | yes | 2026-08-08 | no `OCPP_WEBHOOK_SECRET` |
| `hlada-api` (top-level) | **NO — never existed** | — | `code: 10007` |
| `hlada-api-staging` | yes | 2026-08-08 | |
| `straumvakt-ocpp` (gateway, top-level) | yes | **2026-04-19** | no `OCPP_INGEST_SECRET`; holds `CHARGER_BASIC_AUTH` |
| `straumvakt-ocpp-staging` | yes | 2026-08-03 | `OCPP_INGEST_SECRET` only |

Plus: **no production queues or R2 buckets exist at all** — six queues and one
bucket, every one `-staging`. And `gateway/wrangler.jsonc:36-41` binds
`MAIN_APP → hlada-api`, a Worker that has never existed, so the top-level
gateway config **cannot deploy into a working state as committed**.

Your own conclusion, which stands: *"top-level is not a degraded environment
that needs config added. It is an environment that has never existed for two of
its three Workers, and whose third Worker last deployed on 2026-04-19."*

**The one live thing in top-level.** `straumvakt-ocpp` at top level is the
gateway the 21 chargers are connected to right now. It is frozen at April and
it is load-bearing. Every plan in this prompt must treat it as a system in
production that cannot be interrupted, regardless of how stale its code is.

**Still the single blocking release fact:** no `version_metadata` version id
exists, so there is no rollback target, which makes the first deploy a one-way
door.

**Not on the critical path**, per your own finding: kröfuhafi registration.
Customer 1 can pay a transfer against a PDF. Start it in parallel; do not gate
on it.

---

## 3. Primary objective

Make the production-path decision makeable, then build everything downstream of
it that is not an account mutation.

Ordered:

1. The production-definition decision packet — (a) promote staging, (b) build
   top-level fresh, (c) rename — with what each does to S0, to the 21 chargers,
   to secrets, to cost, and to reversibility.
2. The version-id procedure, and the smallest safe deploy that establishes a
   rollback target.
3. The dead `MAIN_APP` binding and the dead webhook path.
4. Track B tasks 9, 10 and 11 as executable plans with stop points.
5. The account resource manifest — every command written out, none run.
6. Target secret sets per Worker per environment, names only.

---

## 4. Phase 0 — Start-state verification

- Branch, start tip, dirty state, `git status --porcelain` counts.
- `git diff --shortstat` and `git diff -w --shortstat`.
- Baseline **before any edit**: `npm run check`, `npx vitest run` (root and
  gateway), `tsc --noEmit`. Record each. `node_modules` should still be present
  from last round; if it is not, `npm install --no-package-lock` as before —
  **the repo tracks no `package-lock.json`**, so `npm ci` is impossible.
- Confirm `wrangler` is still authenticated. **Do not print the token.**
- **Check for `docs/notes/2026-08-18-invoice-contract-change-requests.md`.** If
  it exists, service every request in it before Phase 1 and record what you
  changed. A is blocked on you while it stands.
- Confirm `dev/market-rails` at `608749f` and the three 2026-08-18 notes you
  wrote are present.

---

## 5. Phase 1 — The production-definition decision packet

Deliver `docs/notes/2026-08-18-what-production-means.md`.

Required content:

1. **The three options, stated as consequences not preferences.** For each of
   (a) promote staging in place, (b) create top-level resources and deploy
   fresh, (c) rename:
   - What happens to **S0 and the 21 live WebSockets**, step by step. This is
     the first row of every option's table, not a footnote.
   - What account mutations it requires, named, in order, and which of them are
     irreversible in the sense that matters — a Worker name, once deployed, is
     a name chargers and clients can be pointed at.
   - What happens to the frozen April `straumvakt-ocpp` and its
     `CHARGER_BASIC_AUTH`.
   - What happens to secrets: which must be created, which rotated, which
     retired. **Names only.**
   - What it costs, monthly, with the assumptions shown.
   - What it does to the `-staging` suffix everywhere — does staging remain a
     distinct environment, and if not, what replaces it.
   - How to roll back if it goes wrong at each step.
2. **The one that is actually cheapest, and why**, with the conditions under
   which the answer flips.
3. **The reversibility split**, as in your delivery packet: which parts of this
   decision can be changed in six months at low cost, and which are effectively
   permanent. Naming is almost certainly in the permanent column; say so if it
   is.
4. **What is true regardless of the choice.** Anything that must be built or
   created under all three options should be identified and then built in the
   later phases — that work is not blocked and should not wait.
5. **The blocking-question list**, ordered, each with why-it-blocks and
   what-unblocks, in the same style as your collection packet. Fewer, sharper
   questions is better than more.
6. **An under-200-word answer page at the top.** It worked last round; keep it.
7. Every factual claim basis-labelled: `[repo]`, `[cf]`, `[inferred]`,
   `[confirm:]`.

---

## 6. Phase 2 — The version id and the smallest safe deploy

The absence of a version id is the single blocking release fact and has been
since 2026-08-11.

Required:

- Specify exactly what `version_metadata` must record, where it comes from, and
  how it is read back at runtime to identify a running deployment.
- Determine whether a version id can be established **without** a deploy. If it
  cannot, say so plainly and specify the **smallest safe deploy** that creates a
  rollback target — which Worker, which environment, what changes, what does not
  change, and what confirms success.
- **That deploy must not be the gateway**, unless you can show that it cannot
  disturb the 21 chargers. If it must be the gateway, the plan needs a
  charger-reconnection verification step with an explicit stop point and a
  named abort condition.
- Implement the local half: the binding, the build-time injection, the runtime
  read, the health-endpoint exposure, and tests. All local. Nothing deployed.
- A gate that **fails** when a deployed environment reports no version id, so
  the absence is enforced rather than remembered.
- Write the deploy runbook as a numbered checklist with a stop point at each
  irreversible step and the exact command at each line — **written, not run.**

---

## 7. Phase 3 — The dead bindings

Two known-dead paths, both hazards of the same kind: configuration that
references something that does not exist.

Required:

- **`MAIN_APP → hlada-api`** in `gateway/wrangler.jsonc:36-41`. Decide, per
  production option, what it should bind to. Where the answer is the same under
  all three options, fix it locally now. Where it differs, leave it and gate it
  — with a check that **fails** while the binding names a non-existent Worker,
  so this class of defect cannot recur silently.
- **The `OCPP_WEBHOOK_SECRET` path**, which `gateway/wrangler.jsonc:31-35`
  describes as dead code awaiting deletion, and which top-level `hlada` still
  holds a secret for. Trace it; prove it is unreachable; produce the deletion
  plan including the secret retirement, ordered so that nothing is removed
  before the thing that references it.
- **A general gate: every service binding, queue binding, bucket binding and
  Hyperdrive binding in every wrangler config must name a resource that exists
  in the account** — or be explicitly listed as pending-creation with a
  reason. Implement it as a check that can run offline against a recorded
  account snapshot, so it works in CI without credentials. Add fixtures for a
  binding naming a nonexistent Worker, a queue that exists only in staging, a
  commented-out binding, and an env-override binding.

---

## 8. Phase 4 — Track B tasks 9, 10, 11 as executable plans

TASKS.md tasks 9–11 have never been more than a sentence each. Turn each into a
plan someone can execute with a stop point at every irreversible step.

**Task 9 — the shared Dev tier.** The cost delta is recorded as ≈ $40–50/mo hot
vs ≈ $5–15/mo scale-to-zero, scale-to-zero recommended, **not picked**. Deliver:
what resources, what names, what the migration flow looks like end to end, how
it proves the deploy path, what it costs precisely enough to decide, and what
must be true before it is created.

**Task 10 — per-service path-scoped deploys.** A push touching one app rebuilds
one app. Deliver the workflow changes as a written diff, the path filters, and
the proof that **S0 is preserved** — the gateway's charger-facing hostname must
not change. Include the failure mode where a shared dependency changes and
every service must rebuild, and how that is detected rather than missed.

**Task 11 — clean Prod from migrations, clean seed, data hygiene.** Deliver the
ordered procedure, what "clean" means precisely, what data must be preserved,
what the seed contains, and the stop point before every destructive step.
Cross-reference A's `0002` preflight pack so the two documents do not contradict
each other on migration ordering.

Each plan must state which of the three production options it assumes, or that
it is option-independent.

---

## 9. Completion gates — done when all of these are true

| # | Gate |
|---|---|
| 1 | Any invoice-contract change request from A serviced, or its absence recorded |
| 2 | Production-definition packet delivered, all seven required sections |
| 3 | Each of the three options carries an S0 / 21-charger row as its first row |
| 4 | Each option's account mutations named, ordered, with irreversibility marked |
| 5 | Cost per option with assumptions shown |
| 6 | Rollback per option, per step |
| 7 | Reversibility split: permanent vs changeable, explicitly separated |
| 8 | "True regardless of the choice" identified — and that work built in later phases, not deferred |
| 9 | Ordered blocking-question list with why-it-blocks and what-unblocks |
| 10 | Under-200-word answer page at the top |
| 11 | Every factual claim basis-labelled |
| 12 | Version-id contents, source and runtime read specified |
| 13 | Whether a version id needs a deploy answered plainly; if yes, the smallest safe deploy specified |
| 14 | That deploy plan proven not to disturb the 21 chargers, or carrying a reconnection stop point with a named abort condition |
| 15 | Version-id local half implemented with tests; nothing deployed |
| 16 | A gate that fails when a deployed environment reports no version id |
| 17 | Deploy runbook written as a numbered checklist with a stop point per irreversible step |
| 18 | `MAIN_APP` binding decided per option; fixed where option-independent, gated where not |
| 19 | `OCPP_WEBHOOK_SECRET` path traced, proven unreachable, deletion plan ordered |
| 20 | Binding-existence gate implemented, offline-runnable, ≥ 4 fixtures |
| 21 | Task 9 plan delivered with the cost precise enough to decide |
| 22 | Task 10 plan delivered as a written diff with S0 preservation proven |
| 23 | Task 11 plan delivered, cross-referenced against A's `0002` preflight with no contradiction |
| 24 | Each plan states its production-option assumption or declares itself option-independent |
| 25 | ≥ 4 fool-tests, each proving a real check fails when the guard is removed |
| 26 | Completion `.md` and `.json` written at the header paths |

---

## 10. Fallback queue — work these in order once §9 is met

1. **Host kennitala capture at onboarding.** Your own finding: the only
   remaining zero-dependency task, and *"its cost rises with every org
   onboarded without it — it cannot be added retroactively without going back
   to ask."* Deliver the field, the validation, the storage contract, where it
   surfaces in onboarding, and what refuses without it. Note the sensitivity:
   it is an identifier, so specify handling, and put no real kennitala in any
   fixture.
2. **Execute the local-green half of your release checklist §7**, items 1–4:
   `npm run check` including the invoice gate; the vitest run with
   `prisma generate` first; the observability gate reviewed; and the validator
   run against a real generated document rather than a fixture. If A's dry-run
   invoice exists on `dev/core-billing-integration` by then, use it — that is
   the real document item 4 asks for.
3. **The observability red-gate decision record.** OB14/15/16/17/19/24 are
   known-red. Shipping with them red is *"a decision to record, not a state to
   hide"* — so record it: what each gate protects, what breaks if it stays red
   through the first invoice, and which must be green before which release
   step.
4. **The Neon production project plan.** None exists. What it needs, what it
   costs, what retention, what branch topology, and how it relates to the three
   production options.
5. **The `ADMIN_PASSWORD` rotation runbook.** Outstanding since 2026-08-08; the
   old value is compromised via git history. Four Workers. Write the ordered
   procedure with a verification step per environment. **Names only — never a
   value — and do not perform it.**
6. **The `Straumvakt-core-security` worktree**, still outstanding and not
   retired. Report its state read-only and recommend, do not act.
7. **A round-2 release checklist revision**, superseding §7 of the 2026-08-18
   release-ops note with whatever this run changed.

---

## 11. Completion artifact — mandatory

Write:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-production-definition-and-environment-path-completion.md
```

plus the JSON sidecar at the header path, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, plus the §9 gate table row by row.

JSON minimum: `agent`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null` — no target), `worktree`, `branch`,
`start_tip`, `end_tip`, `dirty`, `commits`, `files_changed`, `checks`,
`gates_met`, `findings`, `blockers`, `next_actions`, `external_state`,
`very_tldr`.

**External state confirmation must explicitly state:** no push, no deploy, no
DNS or domain binding, **no Cloudflare mutation — every `wrangler` call
read-only, listed by verb**, no Neon mutation, no migration, no SQL against any
environment, no GitHub remote mutation, no charger or OCPP or BLE or NFC or
hardware action, **no account registered, no form submitted, no application
filed, no third party contacted**, no branch or tag deleted, no worktree
retired, and that the only branch written to is your lane branch and
`dev/market-rails`.

Report in chat only a concise TL;DR pointing at the artifact.
