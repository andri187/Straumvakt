---
agent: claude-b
status: ready
lane: market-rails-invoice-delivery-and-collection
created_utc: 2026-08-18T14:15:00Z
worktree: E:\Claude\Straumvakt-relops-b
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-market-rails-invoice-delivery-and-collection-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-market-rails-invoice-delivery-and-collection-completion.json
target_wall_clock: none — deliverable-gated
supersedes: 2026-08-11\2026-08-11-0955-claude-b-cloudflare-top-level-readiness-and-liveness-sweeper.md
very_tldr: Turn TASKS.md task 8 from "unscoped and market-critical" into a decision packet Andri can act on in one sitting, plus the delivery/collection contracts in code; Cloudflare top-level readiness and the missed-heartbeat sweeper become the fallback queue.
---

# Claude B Prompt — Market Rails: Invoice Delivery and Collection

You are `claude-b`. Execute this prompt only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude B to this
file. Verify this header says `agent: claude-b` and `status: ready` before
doing anything.

This prompt **supersedes**
`2026-08-11\2026-08-11-0955-claude-b-cloudflare-top-level-readiness-and-liveness-sweeper.md`,
which was dispatched on 2026-08-11 and never fired — no commit exists on any
branch after `2026-08-11T09:33:29Z`. Its objectives are **not discarded**: they
are absorbed as §10, the fallback queue, and you are expected to reach them.
Do not execute the superseded file.

---

## 0. Why this lane changed

TASKS.md task 8 reads: *"Scope and wire the invoice delivery + collection rail —
email/PDF and/or the Icelandic kröfu claim system. Currently unscoped, and
market-critical: the pipeline is not done until the host can receive and pay."*

It has been unscoped since 2026-08-08. It is the **long pole**, and it is the
only item on the board whose clock runs outside this repository: registering as
kröfuhafi with a bank is paperwork with real-world lead time that no amount of
agent hours compresses. Every other blocker can be caught up by working harder
later. This one cannot.

Your job is **not** to pick the answer. Two of these are Andri's decisions
(`SERVICES.md` marks both PENDING). Your job is to make the decision cheap,
correct and reversible-where-possible — and to build everything downstream of it
that does not depend on which way it goes.

---

## 1. Operating rules

1. Work only in `E:\Claude\Straumvakt-relops-b`. Every other
   `E:\Claude\Straumvakt*` folder is **read-only comparison**.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; bind domains; DNS; any
   Cloudflare mutation; any Neon mutation; any migration against any database;
   live SQL against any environment; GitHub remote mutation; charger commands;
   BLE/NFC; hardware. **No account is to be registered, no form submitted, no
   application filed, and no third party contacted, under any circumstance.**
   You produce the packet; Andri acts on it.
4. **Newly permitted this round:** you may create a local integration branch
   `dev/market-rails` and merge into it locally. **No push.**
5. Cloudflare access, if any exists, is **read-only**. Do not read or print
   token or secret values. Do not call a mutating endpoint even if it would
   succeed.
6. No cleanup, deletion, `git clean`, prune, reset, branch deletion or worktree
   retirement.
7. **Lane boundary — do not cross it.** Claude A is working the same period in
   `E:\Claude\Straumvakt-core-billing` on billing correctness. You must **not**
   edit `packages/commercial/**`, `apps/api/src/lib/billing/**`,
   `apps/api/drizzle/**`, or `apps/api/src/routes/public/driver.ts`. Where your
   work needs something there, write the **contract and fixtures** in your own
   worktree and name the handover target. Overlap is expected on
   `delivery-log.ts` in particular — A owns the code, you own the contract it
   must satisfy.
8. **There is no wall-clock target this round.** Deliverable-gated: complete
   when §9's counts are met, then continue into §10. Do not pad. Do not stop
   after a verdict — a verdict is the beginning of a deliverable, not the end.
9. Record start and end UTC and actual wall clock anyway, for the ledger.
10. Commit coherent local slices with checks recorded. Do not amend prior
    commits. Preserve peer changes; if a target file is dirty and not yours,
    stop and report.
11. Never print, echo, log, export or commit a secret, token, password,
    connection string, kennitala, bank account number or personal row.

---

## 2. Context you must not re-derive

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4 first.** Rule 3 is load-bearing for
this entire prompt.

**The two money lines, and why the invoice header is the legal artefact:**

| line | whose money | Straumvakt's posture | who is kröfuhafi | market phase |
|---|---|---|---|---|
| host ↔ driver | the **host's** | **agent** — presents the claim on the host's behalf | the **host**, rendered "Straumvakt f.h. \<host\>" | deferred, needs attribution |
| Straumvakt ↔ host | **Straumvakt's** | **principal**, own invoice | **Straumvakt** | **this is the market line** |

Money we merely *present* carries obligations money we *earn* does not — VAT
posture, remittance, and whose name is on the claim all differ. **Lines of
different posture must never share an invoice.** A delivery and collection rail
that cannot represent both postures will be rebuilt within a year; one that
assumes only the agent posture will get the first invoice's header legally
wrong.

**Locked commercial model** (the market line's content):
`200 kr / active connector / month` + `50 kr / active driver / month`, capped at
`450 kr / connector / month`.

**What `SERVICES.md` already records as PENDING** — read it before Phase 1:

- Invoice **delivery**: PDF vs PEPPOL / TS-236. Not picked.
- **Collection**: bank claim via RB — which bank to register as kröfuhafi. Not
  picked.
- Dev-tier cost delta ≈ $40–50/mo hot vs ≈ $5–15/mo scale-to-zero;
  scale-to-zero recommended. Not picked.
- No observability.
- Email **fails open** — correct for notices, **wrong for invoices**. This is
  already a finding; Phase 4 must resolve it.

**What the last completed B run (2026-08-11) established.** Read
`E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-cost-observability-release-drill-completion.md`
in full before Phase 5:

- Event-driven architecture exists **only in staging**: top-level lacks queue
  producer, consumer, DLQ and R2.
- Missed heartbeats create **no event**; liveness is computed only when frames
  arrive.
- Top-level is **NO-GO**; staging is GO only after version metadata and rollback
  capture.
- Observability gates OB16–OB28 exist and flagged real gaps.
- Seven Cloudflare dashboard facts remain blocked on an absent read-only
  session. That is still true as of 2026-08-18.

**Research honesty rule.** Parts of Phases 1 and 2 concern Icelandic
invoicing and banking practice, and parts of that may not be verifiable from
this machine. **Every factual claim in your packet must be labelled with its
basis**: `verified-in-repo`, `verified-external-source` (with the source),
`inferred` (with the reasoning), or `requires-confirmation` (with exactly who
must confirm and what question to ask them). A packet whose confidence is
uniform is a packet Andri cannot act on. Do not fill gaps with plausible
detail — an unlabelled guess about a banking requirement is worse than a blank.

---

## 3. Primary objective

Produce a decision packet for TASKS.md task 8 that Andri can act on in one
sitting, and build every part of the delivery and collection rail that does not
depend on which way he decides.

Ordered:

1. Delivery format decision packet — PDF vs PEPPOL/TS-236, with what each
   commits Straumvakt to.
2. Collection decision packet — kröfuhafi registration, what it requires, what
   it costs, how long it takes, and what must be true before it can start.
3. The format-agnostic parts, built: invoice document model, delivery log
   contract, retry and fail-closed semantics, dunning and reconciliation states.
4. The invoice header, correct for both postures, as a tested contract.
5. Fallback: the release-ops queue absorbed from 2026-08-11.

---

## 4. Phase 0 — Start-state verification

Record all of it in the completion artifact:

- Branch, start tip, dirty state, `git status --porcelain` counts.
- `git diff --shortstat` and `git diff -w --shortstat`, both.
- Last 10 commits with dates.
- Dependency availability; whether checks and test suites run at all; baseline
  results **before** any edit.
- Whether `wrangler` is authenticated — **without printing tokens**.
- Whether any Cloudflare read-only command is available — without mutating.
- Whether network egress is available at all from this window, and if so what
  kinds of source you can reach. State this plainly; it determines how much of
  Phases 1 and 2 can be `verified-external-source` rather than
  `requires-confirmation`.
- Confirm the prior B completion artifacts exist at the paths in §2.

---

## 5. Phase 1 — Invoice delivery: the decision packet

Deliver `docs/notes/2026-08-18-invoice-delivery-decision.md`.

Required content:

1. **The options, stated as commitments not features.** For each of: plain PDF
    by email; PDF plus a structured attachment; PEPPOL BIS Billing via an access
    point; Icelandic TS-236 / rafrænn reikningur; and a hybrid — give: what
    Straumvakt must build, what it must buy, what it must register for, what
    ongoing obligation it creates, and what it forecloses.
2. **What each option means for the two money lines.** Specifically: can the
    format represent an agent-posture claim where the kröfuhafi is the host and
    the presenter is Straumvakt? If a format cannot express "Straumvakt f.h.
    \<host\>" in its header semantics, say so — that is disqualifying for the
    deferred line even if it is fine for the market line, and choosing it now
    means choosing to rebuild later.
3. **Legal and tax surface**, labelled by basis: VAT treatment per posture;
    retention obligations; whether Icelandic B2B invoicing carries a structured-
    format mandate and whom that mandate binds; sequential numbering
    requirements; credit-note and correction handling; what makes an invoice
    legally issued as opposed to merely emailed.
4. **The recommendation**, with the reasoning shown, the conditions under which
    it flips, and what would have to be learned to increase confidence.
5. **The reversibility analysis.** Which parts of this decision can be changed
    in six months at low cost, and which are effectively permanent. Andri should
    be able to see which half of the decision he is actually making.
6. **Cost model** with stated assumptions: per-invoice, per-month, setup, and at
    what invoice volume the ranking changes.
7. **One page, at the top, that answers it in under 200 words.** Everything else
    is appendix. A packet nobody finishes reading has not made the decision
    cheap.

---

## 6. Phase 2 — Collection: the kröfuhafi packet

Deliver `docs/notes/2026-08-18-collection-krofuhafi-decision.md`.

Required content:

1. **What the Icelandic bank claim rail actually requires of a claim
    originator** — registration, identification, agreements, technical
    onboarding, file or API formats, test cycles, and per-claim cost.
    Every item labelled by basis per §2's research honesty rule.
2. **Lead time, as a timeline, not an adjective.** Give the sequence of steps,
    which are serial, which can overlap, which need something from Straumvakt
    that does not yet exist, and where the unknowns sit. If a step's duration is
    unknown, say "unknown — ask X this question," and write the question.
3. **The comparison**, for each realistic route (direct bank claim; a claims or
    invoicing service provider; card or direct-debit mandate; plain bank
    transfer against a PDF, which is the do-nothing baseline): setup burden,
    ongoing cost, reconciliation quality, failure modes, and what it implies for
    the driver-facing line later.
4. **The agent-posture problem, addressed head on.** When Straumvakt eventually
    presents claims on behalf of hosts, the money is not Straumvakt's. Client-
    account handling, remittance, and whether presenting another party's claim
    changes the registration required — analyse it now, because choosing a
    collection route that cannot do it means choosing to redo this.
    **Do not let this block the market line** — the flat connector fee is
    Straumvakt's own money and needs none of it. Say clearly which requirements
    belong to which line.
5. **The blocking question list.** The exact set of questions Andri must answer
    or ask a bank, one per line, ordered, each with why it blocks and what
    unblocks on the answer. This list is the single most valuable artefact in
    the run — write it first and refine it last.
6. **What can start today**, before any decision. Name it precisely.
7. **Reconciliation contract.** What comes back from the rail — claim created,
    paid, partially paid, overdue, disputed, cancelled, returned — and how each
    maps to statement state. This is format-agnostic and must be built
    regardless of route.

---

## 7. Phase 3 — Build the format-agnostic rail

Everything here is independent of both decisions and must be delivered whether
or not they are made. **Respect the §1 lane boundary** — contracts and fixtures
in your worktree; do not edit A's files.

Required:

1. **Invoice document model.** A serialisation-independent structure carrying:
    issuer; kröfuhafi; presenter where different from kröfuhafi; recipient;
    period; currency; line items with unit, quantity, unit price, basis and
    VAT treatment; totals; sequential document number; issue and due date;
    references to the settlement rows that produced it; and the money-line tag.
    Tests proving a document carrying two postures is **rejected at
    construction**, not at render.
2. **Document numbering.** Gap-free or gap-tolerant — decide and justify against
    the legal surface from Phase 1; deterministic; idempotent under retry;
    tenant-scoped. Tests for concurrent issue, retry, crash mid-issue, and
    year rollover.
3. **Delivery log contract.** States, allowed transitions, terminal states,
    what is retryable and what is not, how many attempts, backoff, and what
    operator intervention looks like. Claude A owns `delivery-log.ts`; you own
    this contract and the fixtures it must satisfy. Name the handover target
    explicitly.
4. **Fail-closed delivery.** `SERVICES.md` records that email currently **fails
    open** — right for notices, wrong for invoices. Specify and test the
    fail-closed path: an invoice whose delivery is unconfirmed must be visibly
    undelivered, must not be silently marked sent, and must not be
    auto-retried into duplicate delivery. Prove the distinction between
    "delivered", "unknown" and "failed" is preserved end to end.
5. **Dunning and lifecycle states**, with the transition table and the events
    each emits.
6. **≥ 40 fixtures** across: a clean single-connector org; multi-site org;
    mid-period activation; zero-connector org; cap boundary; credit note;
    correction after issue; disputed line; partial payment; overpayment;
    duplicate delivery attempt; bounced email; unknown-delivery timeout;
    period with a settlement hold; and an agent-posture claim that must not
    share a document with a principal line.
7. **A runnable validator** that takes an invoice document and returns the
    reasons it is not issuable. Offline, no network, exit-code driven, wired
    into `npm run check` if that is safe to do without touching A's files.

---

## 8. Phase 4 — The invoice header as a tested contract

The header is the legal artefact. Make it impossible to get wrong.

Required:

- Render rules for each posture, including the exact "Straumvakt f.h. \<host\>"
  construction for the agent line and the plain Straumvakt construction for the
  principal line.
- A test that a document mixing postures cannot be rendered at all.
- A test that the kröfuhafi field is never inferred, always explicit.
- VAT presentation per posture, labelled by basis.
- What appears when the host has no registered identity yet — refuse, do not
  render a partial header.
- A golden-file test per posture so a future change to header rendering is
  visible in review rather than in a customer's inbox.

---

## 9. Completion gates — this prompt is done when all of these are true

| # | Gate |
|---|---|
| 1 | Delivery decision packet delivered with all seven required sections |
| 2 | Every factual claim in both packets carries a basis label |
| 3 | The under-200-word answer page exists at the top of the delivery packet |
| 4 | Reversibility analysis separates the permanent half of the decision from the changeable half |
| 5 | Collection packet delivered with all seven required sections |
| 6 | The blocking-question list exists, ordered, each with why-it-blocks and what-unblocks |
| 7 | Lead time given as a timeline with named unknowns, not an adjective |
| 8 | The agent-posture analysis states which requirements belong to which money line |
| 9 | "What can start today" named precisely |
| 10 | Invoice document model implemented, with mixed-posture rejection tested at construction |
| 11 | Document numbering implemented; ≥ 4 concurrency/retry/rollover tests |
| 12 | Delivery log contract specified with full transition table and handover target named |
| 13 | Fail-closed delivery specified and tested; delivered/unknown/failed distinction proven end to end |
| 14 | Dunning lifecycle transition table delivered |
| 15 | ≥ 40 fixtures delivered across the named scenarios |
| 16 | Runnable offline validator delivered and demonstrated |
| 17 | Header render rules implemented for both postures |
| 18 | Mixed-posture render impossible, proven by test |
| 19 | Golden-file test per posture |
| 20 | ≥ 4 fool-tests, each proving a real test fails when the guard is removed |
| 21 | Completion `.md` and `.json` written at the header paths |

---

## 10. Fallback queue — absorbed from the unfired 2026-08-11 dispatch

Work these in order once §9 is met. These are real objectives, not filler.

1. **Top-level Cloudflare config patch or explicit hold.** Determine exactly
   what top-level must declare for queue producer, queue consumer, DLQ, R2
   bucket, version metadata, Analytics Engine binding, Sentry DSN env, routes
   and custom domains, and `workers_dev`. Patch locally with placeholders and
   comments where safe; where a patch would risk live behaviour on later
   deploy, deliver a staged config block plus a gate that fails until explicit
   activation. **The gateway's charger-facing hostname is preserved (S0)** — 21
   chargers hold live WebSockets against it. Add fixtures for: missing
   producer; missing consumer; missing DLQ; missing R2; missing version
   metadata; routes disabling `workers_dev`; inherited config; env override;
   invalid JSONC; and a commented placeholder that must not count as live.
2. **Missed-heartbeat liveness sweeper.** Trace ChargerDO heartbeat and liveness
   storage. Compare DO alarm vs scheduled Worker vs queue consumer vs Workflow
   vs API cron, briefly, and choose. Implement the smallest safe local
   mechanism, or pure sweeper logic plus tests and a gated adapter. It must
   emit on **transition** only, never every sweep; recover on next heartbeat
   and emit recovery once; persist no raw heartbeat payloads; carry enough
   org/site/connector identity for alerting without leaking credentials or
   idTags; and tolerate clock skew, delayed queues and changed intervals.
   Tests for: on-time; late-within-grace; missed; repeated missed sweeps with no
   duplicate event; recovery; interval change; noisy charger; no prior
   heartbeat; disabled charger; site and org grouping. Fool-test by making it
   emit every sweep.
3. **Queue/DLQ/R2 failure semantics.** Classify every meaningful OCPP event
   class as: can drop; must retry; must persist; must alert; raw/debug only;
   billing material. Define the message envelope — schema version, event id,
   charger identity, org and site, idempotency key, retention class, sensitive
   fields excluded.
4. **The CRLF remediation proposal.** The canonical checkout carries 580
   whitespace-only modified files because there is no `.gitattributes` and
   `core.autocrlf` is unset. Deliver a proposed `.gitattributes`, the exact
   normalisation sequence, what it will do to open branches and worktrees, and
   the risk to the 13 registered worktrees. **Propose only — do not run it.**
   It must not be executed while Claude A has an unmerged 77-commit branch.
5. **The seven blocked Cloudflare facts.** Restate each as a question with the
   exact read-only command or dashboard path that answers it, so a five-minute
   authenticated session closes all seven. If a session is available and
   read-only, close them.
6. **Observability gates OB16–OB28.** Re-verify each against current source and
   record which have changed since 2026-08-11.
7. **Release checklist for customer 1**, assuming Track A lands: what must be
   green, in what order, with a stop point at each irreversible step.

---

## 11. Completion artifact — mandatory

At the end of the run, do not rely on chat as the only handoff. Write:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-b-market-rails-invoice-delivery-and-collection-completion.md
```

plus the JSON sidecar at the header path. Per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`, include: agent;
prompt file; target worktree; branch names; start UTC; end UTC; actual wall
clock; the fact that no time target was set this round; start tips; end tips;
dirty state at close; TL;DR of five lines or fewer; human-readable conclusion;
files created and changed; commits created; tests and checks run with results;
deliverables completed against the §9 table row by row; deliverables skipped or
blocked with the reason; **important corrections to earlier assumptions**;
external-state confirmation; cleanup candidates created; next recommended
action.

JSON minimum fields: `agent`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (use `null` — no target this round),
`worktree`, `branch`, `start_tip`, `end_tip`, `dirty`, `commits`,
`files_changed`, `checks`, `gates_met`, `findings`, `blockers`, `next_actions`,
`external_state`, `very_tldr`.

**External state confirmation must explicitly state:** no push, no deploy, no
DNS or domain binding, no Cloudflare or Neon or GitHub mutation, no migration,
no SQL against any environment, no charger or hardware action, **no account
registered, no form submitted, no application filed and no third party
contacted**, no branch or tag deleted, and that the only branch created is the
local integration branch named in §1 rule 4.

Report in chat only a concise TL;DR pointing at the artifact.
