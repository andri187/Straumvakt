---
agent: claude-c
status: ready-if-a-window-is-free
round: 4
lane: mobile-reconciliation-and-money-unit
created_utc: 2026-08-28T19:00:00Z
worktree: E:\Claude\Straumvakt-driver-access-ui
branch: codex/unaffiliated-driver-experience
start_tip: 77b7e75
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-c-mobile-reconciliation-and-money-unit-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-c-mobile-reconciliation-and-money-unit-completion.json
target_wall_clock: none — deliverable-gated. Short round; this is a blocker clearance, not a build.
external_mutation_allowed: false
very_tldr: Four competing versions of the driver app exist and the fix for the live cost-render bug has been sitting unmerged on a branch since 2026-08-09. Establish the money unit as a fact, land the fix, pick one trunk, and stop the app from having four heads.
---

# Claude C Prompt — Mobile Reconciliation and the Money Unit

You are `claude-c`, a Claude Code window. **Dispatch only if a third window is
free.** If not, this is round 5's first item and nothing is lost by waiting —
but the bug it fixes is live.

Execute only after Andri says `go`, and only if
`docs/agent-prompts/latest.md` points Claude C here.

**This is engineering, not design.** The GPT lane owns how the money screens
look; you own what the number means and which branch is real.

---

## 0. Operating rules

1. Work only in `E:\Claude\Straumvakt-driver-access-ui`. Other
   `E:\Claude\Straumvakt*` folders are **read-only comparison**.
2. **`E:\Claude\Straumvakt` — canonical — is read-only**, with one exception:
   your completion artifact under `docs\agent-runs\2026-08-28\`.
3. **Never `git clean -fd`.** `docs/agent-prompts/`, `docs/agent-runs/`,
   `docs/memory/`, `docs/OCPP/` and `research/` are untracked; a clean destroys
   the coordination layer, including this prompt.
4. **Forbidden:** push; deploy; any Cloudflare, Neon or GitHub mutation; any
   migration; SQL; charger commands; hardware; app-store submission.
5. **Permitted:** local commits and local merges on the mobile branches. No
   push. **Delete no branch and no work.**
6. No `git clean`, delete, prune, reset, rebase, amend, force, stash drop or
   worktree retirement.
7. **`apps/api/**` and `packages/**` are read-only.** Claude A and B are
   editing them right now. Read them with
   `git show dev/core-billing-integration:<path>` and
   `git show dev/market-rails:<path>`; merge nothing.
8. Commit the completion artifact after every phase.
9. Never commit a secret, token, idTag, password, kennitala or personal row.

### The measurement trap

The coordinator works through a Linux bridge that cannot see Windows'
system-level `core.autocrlf=true`. Through it, canonical once looked like 584
modified files when native Windows git said **4**. **Every dirty count in this
prompt is untrusted.** Measure natively and cross-check `git diff --shortstat`
against `git diff -w --shortstat`. Propose no `.gitattributes`.

---

## 1. Phase 1 — Establish the money unit as a fact

Nobody has done this, and it is the whole reason the bug is ambiguous.

What is known, verified 2026-08-28:

- `apps/mobile/lib/api/types.dart` has **two different `costIsk` fields on two
  different classes.**
- `DriverHistorySession.costIsk` (line ~349) is an `int`, **documented as
  aurar**, and its `costLabel` getter divides by 100. Correct.
- `ActiveSession.costIsk` (line ~207) is a `double` with **no unit documented
  anywhere**, and `active_session.dart:209` and `:290` render it with
  `toStringAsFixed(0)` and no division.
- The API stores `costIskMinor` — minor units — in
  `apps/api/src/lib/ocpp/projections.ts` and `repositories/billing-*.ts`.

Required:

1. **Read what `GET /api/driver/sessions/current` actually emits** and state
   the unit as a fact with a file:line citation. Not an inference from the
   storage column — the route may convert.
2. If the endpoint emits minor units, the active-session screen renders **100×
   too large** and has done so in production. If it converts, then the
   stranded fix in §2 would introduce a 100× *under*-render and **must not be
   landed as written**. Decide from the evidence, not from the handover.
3. **Document the unit on the field.** An undocumented money unit on a `double`
   is how this happened, and it will happen again to the next field.
4. Check every other money field crossing the API boundary into the app for the
   same defect. Report the count.

---

## 2. Phase 2 — Land the fix that already exists

`ae5db26` on `dev/mobile-product-to-market`, authored **2026-08-09** by Andri,
three files, +8/−3:

```
-              value: session?.costIsk == null
-                  ? 'Pending'
-                  : '${session!.costIsk!.toStringAsFixed(0)} kr',
+              value: session?.costLabel ?? 'Pending',
```

It adds a `costLabel` getter to `ActiveSession` and a test. **Never merged.**

Required:

1. Land it on the chosen trunk **as its own commit**, subject to Phase 1's
   verdict. If Phase 1 says it is now wrong, write the correct fix instead and
   say so plainly.
2. Note that canonical's `active_session.dart` has moved since `ae5db26` was
   written — the diff context no longer matches. Reconcile by hand; do not
   force a patch.
3. **A null cost renders `Pending`, never `0 kr`.** Prove by test. An uncosted
   session is a real state, not a zero — the history screen already gets this
   right, and the rule is the same rule that governs the invoice.
4. Line 290's second render site gets the same treatment. There are two.

---

## 3. Phase 3 — One trunk, not four

Four competing states, verified 2026-08-28:

| State | Where | Tip |
|---|---|---|
| `codex/unaffiliated-driver-experience` | `E:\Claude\Straumvakt-driver-access-ui` | `77b7e75` — unaffiliated access accessibility |
| `dev/mobile-product-to-market` | branch only | `ae5db26` — the money fix |
| `dev/mobile-product-hardening` | branch only | `4757f5c` — charging accessibility, text scaling |
| uncommitted work | canonical working tree | Flutter screens plus `client.dart`, `types.dart`, `menu_drawer.dart`. **Size untrusted — measure it natively** |

This is the "multiple workflows for one purpose" pathology the restart exists
to end, reproduced in the driver app.

Required:

1. **Pick the trunk on capability, not recency**, and justify it in a
   paragraph.
2. For each other state: what it has that the trunk does not. Bring it across,
   or record in writing why it should not come. **The accessibility and
   text-scaling work in `4757f5c` and `77b7e75` is not to be lost.**
3. Canonical's uncommitted work is **read-only to you.** Inventory it, say what
   it holds that no branch does, and recommend where it lands. **Andri commits
   it, not you.**
4. Leave every branch in place.

---

## 4. Phase 4 — Hand the GPT lane a clean surface

`codex-work` is designing the money screens in parallel and must not be
guessing at semantics.

Deliver `docs/notes/2026-08-28-mobile-money-contract.md` on your branch:

- Every money field the app receives, its unit, its null meaning, and the one
  formatter that renders it.
- Which states exist for a cost: priced, not yet priced, never priced,
  unavailable, running. **What each means, so the GPT lane designs the right
  number of states rather than inventing them.**
- Which trunk won, so its screens land on the right branch.

---

## 5. Completion gates

| # | Gate |
|---|---|
| 1 | Baseline recorded; dirty counts measured natively and cross-checked with `-w` |
| 2 | **The unit of `ActiveSession.costIsk` stated as a fact with a file:line citation from the route** |
| 3 | The unit documented on the field itself |
| 4 | Every other money field crossing the API boundary checked; the count reported |
| 5 | `ae5db26` landed as its own commit — or shown wrong by Phase 1 and the correct fix written instead |
| 6 | Both render sites fixed — line 209 and line 290 |
| 7 | Null cost renders `Pending`, never `0 kr`, proven by test |
| 8 | `flutter analyze` and `flutter test` green, or the toolchain's absence stated plainly |
| 9 | Trunk chosen and justified on capability |
| 10 | Every other state's differences brought across or refused in writing |
| 11 | Accessibility and text-scaling work preserved |
| 12 | Canonical's uncommitted work inventoried with a recommended landing place — **not committed by you** |
| 13 | No branch deleted, no work deleted |
| 14 | **No file under `apps/api/**` or `packages/**` edited** |
| 15 | `2026-08-28-mobile-money-contract.md` delivered for the GPT lane |
| 16 | Completion `.md` and `.json` written and committed after every phase |

---

## 6. Fallback queue

1. **The driver's API client**, `client.dart` — every endpoint it calls that no
   longer exists, and every one it should call and does not.
2. **The app's own empty and error states** at the data layer: what it does
   when a call fails, and whether any path renders a zero for a failure.
3. **A charger's host is true only as of a date** — ADR 0054. Any app state
   caching a charger's owner needs to know that can change mid-month.
4. **Flutter test coverage on the money paths**, which is currently thin.
5. Anything in your artifact's next actions that stays in your lane.

---

## 7. Completion artifact

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\claude-c-mobile-reconciliation-and-money-unit-completion.md
```

plus the JSON sidecar, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`.

**External state must state:** no push, no deploy, no app-store submission, no
migration, no SQL, no Cloudflare/Neon/GitHub mutation, no hardware action, no
branch or tag deleted, nothing under `apps/api/**` or `packages/**` edited,
nothing written in canonical but the artifact, and which branches you wrote to.

Report in chat only a concise TL;DR pointing at the artifact.
