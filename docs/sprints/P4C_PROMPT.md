# P4-C — kickoff prompt (ingest and command integrity)

Hand this to a fresh session. It is deliberately self-contained: it names
the goal, the constraints, the order, and the points where you must stop.

---

## Prompt

> You are working on **Straumvakt** at `E:\Claude\Straumvakt`.
>
> Read `CLAUDE.md` first and treat it as binding. Rules 1, 3, 4, 5, 8, 9
> and 10 all apply here, and four of them will actually bite.
>
> **Your work block is P4-C — Ingest and command integrity.**
>
> Canon, in order of authority:
> 1. `docs/architecture/GOING_PUBLIC_CRITICAL_PATH.md` — the ratified
>    phase plan (P0–P6). Phase numbers are the stable identifier; "target
>    sprint" is a suggestion.
> 2. `docs/adr/0035-multi-operator-scale-readiness-roadmap.md` — why P4
>    expanded, and the findings table F1–F20 with file:line for each
> 3. `docs/sprints/P4_TASKS.md` — the live task tracker; check boxes off
>    as you go. Your milestones are **P4.C0 and P4.12–P4.18**, then
>    P4.C9 to close.
>
> Read before touching code:
> `docs/notes/2026-05-12-fix-a-reverted-batching-deployed.md` (why
> batching was reverted and what it cost),
> `docs/adr/0018-data-platform-and-orm-boundary.md` (the ORM boundary you
> must respect).
>
> ### The objective
>
> Close nine known defects on the OCPP event and command path so that
> P4-D's load test measures a system with no known bugs. Every one is
> documented with a file and line number in ADR 0035's findings table.
>
> The most important is **F1**: the batch write fast path is gated on
> every message in the batch being a heartbeat. At ~250 concurrent
> sessions that condition almost never holds, so roughly 99% of batches
> fall back to a per-event Prisma loop — the exact ingest ceiling ADR
> 0017 identified for MeterValues. Generalising that path is the centre
> of gravity.
>
> ### What this is NOT
>
> - **Not a measurement block.** Several changes will beg to be
>   benchmarked. Don't. P4-D has a real fleet simulator; a hand-rolled
>   benchmark here produces numbers nobody will trust and burns the time
>   this work needs.
> - **Not a read-model block.** `fleet_state`, page caching, server
>   rendering and polling backoff are P4-E.
> - **Not a Zaptec block.** The sequential per-charger sweeps (F10/F11)
>   are real defects on the legacy vendor-REST path, which ADR 0035
>   demotes to maintenance. Touch them only if they actively block you.
> - **Not a feature block.** It ships nothing a customer can see. That is
>   expected and recorded in the ADR.
>
> ### Order of work
>
> Do **P4.C0 first and completely.** The tree currently has ~70 untracked
> files and 6 modified. Rule 9 forbids starting from that, and the triage
> is genuinely part of the work — some of those files may encode
> decisions nobody wrote down. Do not start code until `git status` is
> clean, you are on a `dev/p4-c-*` branch, and `npx tsc --noEmit` plus
> `npx prisma validate` are both green.
>
> Then, roughly in this order — each is independently shippable, so
> commit per Rule 8 (one logical change each):
>
> 1. **P4.12** generalised batch write path *(Rule 5 gate)*
> 2. **P4.13** archive fanout via `sendBatch`, driven by P4.12's
>    `RETURNING event_id` set
> 3. **P4.16** outbound command durability in DO storage
> 4. **P4.17** OCPP subprotocol echo
> 5. **P4.14** connection handling and batch cadence *(Rule 4 gate)*
> 6. **P4.15** partition retention *(destructive — dry-run first)*
> 7. **P4.18** Authorize verdict caching *(Rule 5 gate)*
> 8. **P4.C9** exit verification
>
> P4.12 is first because P4.13's correct fix depends on it. P4.15 and
> P4.18 are late because they have the worst failure modes.
>
> ### Stop points — do not work through these
>
> - **Before editing `projections.ts` call sites (P4.12).** Rule 5. The
>   `StopTransaction` projection triggers tariff resolution and a ledger
>   write. Summarise what changes, what must not change, and why it's
>   safe. Wait for approval.
> - **Before editing `apps/api/wrangler.jsonc` (P4.14).** Rule 4. Ask for
>   an explicit instruction naming the file.
> - **Before implementing Authorize caching (P4.18).** Rule 5. This
>   caches an access-control decision, and it must not disturb P4.11's
>   shadow-mode → enforced flip. Present the staleness window, the
>   invalidation path and the failure modes. Wait for approval.
> - **Before enabling destructive partition drop (P4.15).** Rule 3. State
>   which database it targets. Dry-run for a full cycle first.
>
> ### Definition of done
>
> Rule 10 plus P4.C9:
>
> - `npx tsc --noEmit` clean, `npm run build` succeeds
> - Full test suite green, including new tests for every milestone
> - An end-to-end VCP sandbox session — Boot, Status, Start, MeterValues,
>   Stop — with every projection firing and exactly one correct ledger
>   entry, no duplicate sessions
> - One hour of real staging traffic watched via
>   `wrangler tail | grep '\[ocpp-q\]'` with no `validation_failed`, no
>   unexplained `transient_failure`, no DLQ growth
> - Partition count stable across a retention cycle in dry-run mode
> - The P4.14 pooling finding written up in `docs/notes/`
>
> ### If you get blocked
>
> Do every task that doesn't depend on the blocker, then say plainly what
> is blocked and why. Don't narrow the scope silently — scaling it down
> is the operator's call. If a task disagrees with the phase plan, the
> plan wins and the task list gets fixed; if the *milestone* is wrong,
> that's Rule 11 (ADR + plan edit), not a quiet drift.
>
> Never commit to `master`. Never open or merge a PR. State the branch
> before any push.

---

## Notes for whoever runs this

- The two Rule 5 gates are the real risk. If a session works through them
  without stopping, that's a failed block regardless of whether the code
  is correct — the point of the gate is that a human agreed the billing
  and access-control paths were safe.
- P4.C0 is sized as "blocking" on purpose. The untracked set includes a
  migration (`20260531200000_driver_self_onboarding`), three ADRs and a
  dozen probe scripts. Some of that is a decision record nobody has
  written down.
- P4.14's pooling question has no known answer. It's fine to end with a
  written finding rather than a refactor, so long as the
  create-and-destroy-per-batch behaviour is gone.
- **P4.17 ships regardless of everything else.** If P7 (fleet
  acquisition) gets pulled forward by the market situation, spec-strict
  firmware from an unknown vendor will not connect without it, and there
  is no workaround.
- P4-C is parallel to Track E. It does not block P1 billing, P2
  onboarding or P3 mobile, and nothing here moves the launch date.
