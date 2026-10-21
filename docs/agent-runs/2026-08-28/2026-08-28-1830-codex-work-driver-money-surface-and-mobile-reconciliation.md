---
agent: codex-work
status: ready
round: 4
lane: driver-money-surface-and-mobile-reconciliation
created_utc: 2026-08-28T18:30:00Z
worktrees:
  - E:\Claude\Straumvakt-onboarding-web        # web UI — admin and CPO
  - E:\Claude\Straumvakt-driver-access-ui      # mobile — driver app
web_branch: codex/core-ui-real-product-polish-2026-08-10
web_start_tip: 6e7076e
mobile_branch: codex/unaffiliated-driver-experience
mobile_start_tip: 77b7e75
follows: 2026-08-10\2026-08-10-2305-codex-work-market-core-ui-productization.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\codex-work-driver-money-surface-and-mobile-reconciliation-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\codex-work-driver-money-surface-and-mobile-reconciliation-completion.json
target_wall_clock: none — deliverable-gated. Deliberately long; §10 exists so the queue does not empty.
external_mutation_allowed: false
very_tldr: Reconcile four competing states of the driver app and land the money fix that has been stranded on a branch since 2026-08-09, then build the driver money surface that does not exist, then wire the admin and CPO web UI to the nine real billing endpoints instead of fixtures.
---

# Codex Work Prompt — The Driver Money Surface and the Mobile Reconciliation

You are `codex-work`. Execute only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Codex Work here.
Verify this header says `agent: codex-work` and `status: ready` first.

**You own the product surfaces:** the driver mobile app, and the web UI for
admin and CPO. Claude A and Claude B own the backend and are **running in
parallel right now** in their own worktrees. Read §0's boundary before you
touch anything.

Your last dispatch ran on 2026-08-10 and completed. It was never filed in the
index, which made it look stalled for eighteen days; it is filed now. **Two
things follow: your lane has had no dispatch in eighteen days, and the backlog
below is what accumulated.**

---

## 0. Operating rules

1. Work only in `E:\Claude\Straumvakt-onboarding-web` (web) and
   `E:\Claude\Straumvakt-driver-access-ui` (mobile).
2. **`E:\Claude\Straumvakt` — the canonical folder — is read-only to you**,
   with exactly one exception: your completion artifact under
   `docs\agent-runs\2026-08-28\`. Nothing else there, ever.
3. **Never run `git clean -fd` anywhere in this repository.**
   `docs/agent-prompts/`, `docs/agent-runs/`, `docs/memory/`, `docs/OCPP/`
   (115 MB) and `research/` are **untracked**. A clean destroys the entire
   coordination layer, including this prompt.
4. Do not create new top-level folders under `E:\Claude`.
5. **Forbidden without exception:** push; deploy; DNS or domain binding; any
   Cloudflare, Neon or GitHub mutation; running any migration against any
   database; live SQL against any environment; production or staging personal
   rows; charger commands; BLE/NFC; hardware; app-store submission of any
   kind.
6. **Permitted:** local commits, local branch creation, local merges. **No
   push.**
7. No `git clean`, delete, prune, reset, rebase, amend, force, branch deletion,
   stash drop or worktree retirement.
8. **Write the completion artifact incrementally and commit it after every
   phase.** Per `docs/notes/2026-08-10-agent-completion-artifact-rule.md`.
9. **No wall-clock target — and this round is deliberately long.** Your last
   two runs finished in ~19 and ~15 minutes against a 4–8h estimate, because
   the work was already largely done. **This round is not.** Deliverable-gated
   by §9, then §10. Do not stop when the gate table is full.
10. **If you are resumed after an interruption, do not restart.** Read your own
    artifact, find the last committed phase, continue from the next unmet gate.
11. Never print, echo, log or commit a secret, token, idTag, password,
    connection string, kennitala or personal row. All fixture values synthetic.

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4.** Rule 4 of FOCUS is the one that
governs this whole round: **money is derived from the record, never invented.**

### The measurement trap — read before you believe any dirty-file count

The coordinator works through a Linux bridge with no `/etc/gitconfig`, so it
**cannot see Windows' system-level `core.autocrlf=true`.** Through the bridge
the canonical checkout has previously looked like 584 modified files when
native Windows git reported **4**. Every "modified" count in this prompt is
therefore untrusted. **Measure from your native Windows window, and cross-check
`git diff --shortstat` against `git diff -w --shortstat`.** If the two differ
wildly, the difference is line endings and not work. Propose no
`.gitattributes`; line endings are settled.

### Lane boundary — round 4

| You own | Claude A owns | Claude B owns |
|---|---|---|
| `apps/mobile/**` | `apps/api/drizzle/**` | `packages/contracts/**` |
| `src/app/**` — the web UI | `packages/shared/src/db/**` | `apps/api/src/lib/zaptec.ts` |
| `src/components/**` | `packages/commercial/**` | `apps/api/src/routes/**` |
| your two worktrees | `apps/api/src/lib/billing/**` | `gateway/**` |

**`apps/api/**` and `packages/**` are read-only to you this round.** Both are
being edited right now by the other two lanes. If you need a backend change,
**do not make it** — append `UI-CR-n` to
`docs/notes/2026-08-28-ui-change-requests.md` **on your own branch**, stating
what you need, which endpoint, which phase it blocks, and whether a fixture
lets you continue meanwhile. Then continue with the fixture. The coordinator
services that file between rounds.

**Read the API; never edit it.** `git show dev/core-billing-integration:<path>`
and `git show dev/market-rails:<path>` give you the current backend without
merging anything.

---

## 1. What changed under you while the lane was idle

Round 3 finished on both backend lanes on 2026-08-19. Relevant to you:

- **Nine real billing endpoints exist**, under `apps/api/src/routes/admin/billing/`
  on `dev/core-billing-integration`, all over ports and all tested offline. The
  documented endpoint count went 178 → 187. Your web UI still labels billing
  routes `Local fixture` / `Backend gated`. **Some of those labels are now
  false, and a false honesty label is worse than none.**
- **An invoice exists** — `SV-2026-000001`, 7.564,00 kr — rendered offline, and
  round 3 added a **PDF renderer and a delivery log** in
  `packages/contracts/src/invoice/`.
- **An org can now be onboarded offline** through `scripts/dry-run-onboard-org.mts`,
  though the agreement write surface is Claude B's round-4 work and does not
  exist yet.
- **ADR 0054 was locked on 2026-08-20.** The one line that reaches your lane: a
  device is immortal, a **placement** is dated, and a charger can move between
  hosts mid-month. Any UI that says "this charger belongs to X" is stating
  something that is only true *as of a date*.

### The five framing corrections — these override anything older in the UI copy

1. **Fresh start. Nothing legacy is required. No backfill.**
2. The restart exists because of **database hardwiring, useless APIs, and
   multiple workflows for one purpose.** Phase 1 is the third of those.
3. **The dweller is the billable party — there is no apartment abstraction.**
   If any screen says "apartment", it is wrong.
4. **Straumvakt never holds money.** The host is the kröfuhafi and Straumvakt
   operates their claims as agent. **No screen may imply Straumvakt collects,
   holds, refunds or remits.** No "pay now" button, no balance held with us.
5. **Legacy data is reference data.** Never present a legacy figure as current.

---

## 2. Primary objective

**Make the product surfaces tell the truth about money, and stop the driver app
from having four competing versions of itself.**

Ordered:

1. Reconcile the mobile branches and **land the fix that already exists**.
2. The driver money surface, which does not exist at all.
3. The web UI's billing routes, against the endpoints that are now real.
4. The fixture-money audit — every hardcoded krónur figure on a screen.

---

## 3. Phase 0 — Start-state verification

- For **both** worktrees: branch, tip, and a dirty count measured natively and
  cross-checked with `-w` per the measurement trap above.
- Web baseline before any edit: install, typecheck, lint, test, build. Record
  the numbers. Any deviation from a green baseline is a finding.
- Mobile baseline: `flutter analyze` and `flutter test`. Record them. If the
  toolchain is not available in your window, **say so plainly in the artifact
  and continue with what is** — do not install a toolchain and do not guess.
- Create `docs/notes/2026-08-28-ui-change-requests.md` on your branch with a
  header and no entries.

---

## 4. Phase 1 — The mobile reconciliation, and the fix that already exists

**There are four competing states of the driver app.** Verified 2026-08-28:

| State | Where | Tip |
|---|---|---|
| `codex/unaffiliated-driver-experience` | `E:\Claude\Straumvakt-driver-access-ui` | `77b7e75` — *harden unaffiliated access accessibility* |
| `dev/mobile-product-to-market` | branch only | `ae5db26` — ***fix(mobile): format active cost in kronur*** |
| `dev/mobile-product-hardening` | branch only | `4757f5c` — *harden charging accessibility and text scaling* |
| uncommitted work | canonical working tree | ~2,857 lines of Flutter screens plus `client.dart`, `types.dart`, `menu_drawer.dart` — **count untrusted, see the measurement trap** |

**The money fix is already written.** `ae5db26`, authored **2026-08-09**, three
files, +8/−3:

```
-              value: session?.costIsk == null
-                  ? 'Pending'
-                  : '${session!.costIsk!.toStringAsFixed(0)} kr',
+              value: session?.costLabel ?? 'Pending',
```

It adds a `costLabel` getter to `ActiveSession` in `apps/mobile/lib/api/types.dart`
and a test. **It has never been merged, and the unfixed render is still live.**

Required:

1. **Verify the unit before you land anything.** This is the part nobody has
   done. `DriverHistorySession.costIsk` is an `int` and is documented as
   **aurar**, and its `costLabel` divides by 100. `ActiveSession.costIsk`
   (`apps/mobile/lib/api/types.dart` ~line 207) is a `double` with **no unit
   documented at all**, and `active_session.dart:209` and `:290` render it with
   `toStringAsFixed(0)` and no division. The API stores `costIskMinor` — minor
   units. **Read what `GET /api/driver/sessions/current` actually emits** —
   `git show dev/market-rails:apps/api/src/routes/...` — and state the unit as
   a fact with a file:line citation. If the endpoint already converts, then
   `ae5db26` would introduce a 100× *under*-render and must not be landed as
   written. **Establish the unit first; land second.**
2. **Document the unit on the field**, whichever way it goes. An undocumented
   money unit on a `double` is how this happened.
3. **Pick the mobile trunk** among the four states, on capability and not
   recency, and say why in one paragraph. Land the money fix onto it first, as
   its own commit, before any other reconciliation — it is the only one of the
   four that is a live wrongness rather than a difference.
4. **Reconcile the rest as a merge, not a rewrite.** For each of the other
   states: what it has that the trunk does not, and either bring it across or
   record why it should not be. **Delete no branch. Delete no work.**
5. The canonical folder's uncommitted mobile work is **read-only to you**.
   Inventory it, say what is in it that no branch has, and **recommend** where
   it should land. Andri commits it, not you.
6. Tests: the money render, at minimum. A session with a null cost renders
   `Pending` and **never `0 kr`** — an uncosted session is a real state, not a
   zero, and the history screen already gets this right.

---

## 5. Phase 2 — The driver money surface

**The driver has no money surface at all.** Named as one of six essentials
missing from a real CPMS, and it is the one that is entirely yours.

Required:

1. **State what the driver is owed sight of**, given the model: the dweller is
   the billable party; the host is the kröfuhafi; **Straumvakt never holds
   money.** So the driver sees what they used, what it cost, under whose
   tariff, and what they will be charged by **whom** — and the app never
   implies Straumvakt takes payment.
2. Design it against what exists: the history endpoint, the session cost, the
   invoice/statement contracts in `packages/contracts/src/invoice/` (read-only
   to you), and the distinction round 3's UI work already established —
   **a statement is not an invoice, an invoice is not a payment request, and
   none of them is a paid status.** Keep that language.
3. Build what the current API can honestly support. Where it cannot, **render
   the absence** — `unavailable`, never a zero, never a plausible placeholder.
   That rule is not a UI preference: absent evidence is `unavailable` and never
   zero throughout this system, and a screen that shows `0 kr` for "we don't
   know" is the same lie as an invoice that does.
4. Every gap you hit becomes a `UI-CR-n`. Continue against a fixture.
5. Accessibility parity with what the two mobile branches already hardened —
   text scaling and the accessibility work in `4757f5c` and `77b7e75` are not
   to be lost in the reconciliation.

---

## 6. Phase 3 — The admin and CPO web UI against real endpoints

Your market-route contract classifies all 79 post-login routes with
`Core / readiness / evidence / future`, plus `Local fixture`, `Read only` and
`Backend gated` labels. **Nine billing endpoints became real on 2026-08-19.**

Required:

1. **Re-audit every label against the backend as it stands today.** Read the
   route surface from `dev/core-billing-integration`; do not merge it. Produce
   a table: route, current label, true label, evidence.
2. Wire the routes where a real endpoint now exists — period open, activity,
   assertion, pricing, statement list, invoice issue, document fetch — as
   **read-only views first.** A mutating control goes in only where the
   endpoint is idempotent and refuses honestly, and **`issue an invoice`
   consumes a number that cannot be reused**, so it does not get a naked
   button in this round. Render it as a guarded operator action with the
   consequence stated on the screen.
3. **Refusals are content, not errors.** Pricing refuses with a named reason
   when a count is unavailable; a period holds; an org has no contract or no
   billable clause. **Show the named reason.** The operator's most common
   experience of this system today is a period that holds, and the screen that
   explains why is worth more than the screen that prices.
4. **The provenance block is a UI element now** — round 3 surfaced derived
   counts and operator assertions on the invoice, with who, when and why.
   Render it.
5. Keep every honesty guarantee the last two runs established: disabled actions
   stay disabled, no fake payment or invoice, **no 0 kW where the measurement
   is missing**, no Service persona.

---

## 7. Phase 4 — The fixture-money audit

Verified 2026-08-28 in `apps/mobile/lib/screens/my_vehicle.dart`: `'2,486 kr'`
at line 247, and at 1531–1534 a cost breakdown of `'2,188 kr'` electricity,
`'298 kr'` plug-time, `'2,486 kr'` total — **hardcoded, and formatted exactly
like a real figure.**

Required:

1. Find every hardcoded currency figure across both surfaces. One table: file,
   line, figure, screen, and whether a user could mistake it for their own
   money.
2. **Any figure a user could mistake for theirs is either driven by real data
   or visibly marked as an example.** A number that looks real and is not is
   the one defect this project has been most consistent about refusing.
3. The Icelandic thousands separator is `.` and the decimal is `,` —
   **7.564,00 kr**, as the invoice renders it. `'2,486 kr'` is not Icelandic
   formatting. Fix the formatting wherever a figure survives as an example.
4. One shared money formatter per surface. Not three.

---

## 8. Phase 5 — The product-truth pass

One document, `docs/notes/2026-08-28-ui-product-truth.md`, on your branch:

- What each persona can actually do today, end to end, and where each stops.
- Every screen that states something the backend cannot support, after your
  fixes.
- The `UI-CR` list, consolidated, ordered by what unblocks the most.
- **What the driver still cannot see about their own money**, which is the
  short list Andri will care about most.

---

## 9. Completion gates — done when all are true

| # | Gate |
|---|---|
| 1 | Both worktrees' baselines recorded, dirty counts measured natively and cross-checked with `-w` |
| 2 | `docs/notes/2026-08-28-ui-change-requests.md` created; every gap raised as `UI-CR-n`, never as a backend edit |
| 3 | **The money unit of `ActiveSession.costIsk` established as a fact, with a file:line citation from the API route** |
| 4 | The unit documented on the field itself |
| 5 | `ae5db26`'s fix landed on the chosen trunk as its own commit — **or** shown by evidence to be wrong now, with that shown in the artifact |
| 6 | A null cost renders `Pending`, never `0 kr`, proven by test |
| 7 | Mobile trunk chosen and justified on capability |
| 8 | The other three states inventoried; each difference brought across or refused in writing; **no branch deleted, no work deleted** |
| 9 | Canonical's uncommitted mobile work inventoried and a landing place recommended — **not committed by you** |
| 10 | Accessibility and text-scaling work from `4757f5c` and `77b7e75` preserved through the reconciliation |
| 11 | The driver money surface designed against the real model — dweller billable, host as kröfuhafi, **Straumvakt never holding money** |
| 12 | No screen implies Straumvakt collects, holds, refunds or remits |
| 13 | Statement / invoice / payment request / paid status kept distinct in the copy |
| 14 | Absence renders as `unavailable`, never as `0 kr` |
| 15 | All 79 web routes re-audited: route, current label, true label, evidence |
| 16 | Real billing endpoints wired as read-only views; no naked invoice-issue button |
| 17 | Named refusal reasons rendered — a held period explains itself on screen |
| 18 | The invoice provenance block rendered, with who/when/why on an operator assertion |
| 19 | Every hardcoded currency figure found and tabled |
| 20 | Every figure a user could mistake for their own is data-driven or visibly an example |
| 21 | Icelandic number formatting correct — `7.564,00 kr` |
| 22 | One money formatter per surface |
| 23 | No file under `apps/api/**` or `packages/**` edited; canonical untouched but for the artifact |
| 24 | `docs/notes/2026-08-28-ui-product-truth.md` delivered |
| 25 | Completion `.md` and `.json` written **and committed after every phase** |

---

## 10. Fallback queue — continue here; do not stop

1. **The charger-moves-hosts consequence in the UI.** ADR 0054: a placement is
   dated. Any screen asserting ownership without a date is asserting something
   that can silently become false. List them; fix the ones that are cheap.
2. **The driver's access story** — `codex/unaffiliated-driver-experience`
   hardened the unaffiliated case. State what an unaffiliated driver sees about
   money, which is the intersection of that branch and Phase 2.
3. **A CPO onboarding walkthrough in the UI**, mirroring
   `dry-run-onboard-org.mts`: profile → sites → connectors → drivers and access
   → pricing → billing material. You already built the path; check every step
   against what the backend can now actually do.
4. **The empty states.** An org with no chargers, a charger with no agreement,
   an agreement with no billable clause, a driver in no group. Each is a real
   state with a real explanation, and each is currently a blank.
5. **A screenshot-free visual review note** for the driver app's money screens,
   in the style of `apps/mobile/UI_REVIEW.md`.
6. **Web accessibility pass** on the routes you touched — keyboard, focus
   order, contrast on the amber money colour.
7. Anything in your own artifact's next-action list that stays in your lane.

---

## 11. Completion artifact

Write and commit incrementally to:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\codex-work-driver-money-surface-and-mobile-reconciliation-completion.md
```

plus the JSON sidecar, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. **Your last two
sidecars used non-standard key names and the coordinator could not read them.**
Use these keys exactly:

`agent`, `round`, `status`, `start_utc`, `end_utc`, `wall_clock_seconds`,
`target_met` (`null`), `worktrees`, `branches`, `start_tips`, `end_tips`,
`dirty`, `commits`, `files_changed`, `tests`, `gates_met`,
`fallback_items_done`, `blockers`, `ui_change_requests`, `next_actions`,
`external_state`, `very_tldr`.

**External state must state:** no push, no deploy, no app-store submission, no
migration applied anywhere, no SQL, no Cloudflare or Neon or GitHub mutation,
no charger or hardware action, no branch or tag deleted, **nothing under
`apps/api/**` or `packages/**` edited**, nothing in the canonical folder
written but the completion artifact, and which branches you wrote to.

Report in chat only a concise TL;DR pointing at the artifact.
