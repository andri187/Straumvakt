---
agent: codex-work
status: ready
round: 4
lane: money-screens-visual-design
created_utc: 2026-08-28T19:00:00Z
supersedes: 2026-08-28\2026-08-28-1830-codex-work-driver-money-surface-and-mobile-reconciliation.md
worktrees:
  - E:\Claude\Straumvakt-onboarding-web        # web UI — admin and CPO
  - E:\Claude\Straumvakt-driver-access-ui      # mobile — driver app
web_branch: codex/core-ui-real-product-polish-2026-08-10
web_start_tip: 6e7076e
mobile_branch: codex/unaffiliated-driver-experience
mobile_start_tip: 77b7e75
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\codex-work-money-screens-visual-design-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\codex-work-money-screens-visual-design-completion.json
external_mutation_allowed: false
very_tldr: The visual design of the money screens — how a driver sees what they used and what it cost, how an operator sees a period that holds, how an unknown reads as unknown and never as zero, and how an example figure is visibly an example.
---

# Codex Work Prompt — The Money Screens, Visually

You are `codex-work`. **You own the visual aspect of the UI: the driver mobile
app, and the admin and CPO web UI.** Layout, hierarchy, state design, copy,
typography, number formatting, colour, spacing, accessibility.

**You do not own the plumbing.** Not the API contracts, not the money units,
not which branch becomes trunk, not endpoint wiring. Where a screen needs a
value, it is specified to you; where it is not specified, you design the state
and raise it. Claude A and Claude B are working the backend in parallel right
now, and `claude-c` owns the mobile reconciliation.

Execute only after Andri says `go`, and only if
`docs/agent-prompts/latest.md` points Codex Work here.

---

## 0. Operating rules

1. Work only in `E:\Claude\Straumvakt-onboarding-web` (web) and
   `E:\Claude\Straumvakt-driver-access-ui` (mobile).
2. **`E:\Claude\Straumvakt` — the canonical folder — is read-only to you**,
   with one exception: your completion artifact under
   `docs\agent-runs\2026-08-28\`.
3. **Never run `git clean -fd` anywhere in this repository.**
   `docs/agent-prompts/`, `docs/agent-runs/`, `docs/memory/`, `docs/OCPP/` and
   `research/` are **untracked**; a clean destroys the coordination layer,
   including this prompt.
4. **Read-only to you this round:** `apps/api/**`, `packages/**`,
   `apps/mobile/lib/api/**`. Those are the other three lanes'. **You style and
   lay out what the app already has; you do not change what it fetches, what a
   field means, or what unit it is in.**
5. **Forbidden:** push; deploy; any Cloudflare, Neon or GitHub mutation; any
   migration; SQL; charger commands; hardware; app-store submission.
6. **Permitted:** local commits on your two branches. No push.
7. No `git clean`, delete, prune, reset, rebase, amend, force, branch deletion,
   stash drop or worktree retirement.
8. Write the completion artifact incrementally and commit it after every phase.
9. **Deliverable-gated, no wall-clock target.** Your last two runs finished in
   ~19 and ~15 minutes against a 4–8h estimate because the work was already
   largely done. This is design work and it is not.
10. Never commit a secret, token, idTag, password, kennitala or personal row.
    All example values synthetic.

### Three rules of this product that are visual rules

Everything below follows from these. They are not style preferences.

1. **An unknown is not a zero.** Absent evidence renders as *unavailable*,
   never as `0 kr` and never as a plausible placeholder. A zero and an unknown
   look identical on a screen, and only one of them is honest.
2. **Straumvakt never holds money.** The host is the creditor; Straumvakt
   operates their claims as agent. **No screen may imply Straumvakt collects,
   holds, refunds or remits.** No "pay now", no balance held with us.
3. **A statement is not an invoice, an invoice is not a payment request, and
   none of them is a paid status.** The last two runs established this
   language. Keep it.

Also: **the dweller is the billable party — there is no apartment
abstraction.** If any screen says "apartment", it is wrong. And **nothing
legacy is presented anywhere**; this product starts from scratch, so no screen
shows a historical figure as if it were current.

---

## 1. Phase 0 — Start state

- Both worktrees: branch, tip, dirty state. Baselines: web install/typecheck/
  lint/test/build; mobile `flutter analyze` and `flutter test`. Record the
  numbers. If a toolchain is missing in your window, say so plainly and
  continue with what is available.
- Create `docs/notes/2026-08-28-ui-change-requests.md` on your branch with a
  header and no entries. **Every value you need and cannot honestly render
  becomes `UI-CR-n` there** — what you need, which screen, what you rendered
  instead. Do not go and fetch it yourself.

---

## 2. Phase 1 — The driver's money screens

The driver has **no money surface at all** today. Design one.

What the driver is owed sight of, given the model: what they used, what it
cost, under whose tariff, and who will charge them — and **never an implication
that Straumvakt takes the payment.**

Deliver:

1. **The screen set**, as working Flutter: a charge's cost, a period's total,
   and the driver's standing relationship to the host who bills them.
2. **Every state designed, not just the happy one.** Priced. Not yet priced.
   Never priced. Unavailable. Disputed. A session still running. **The
   not-yet-priced and the unavailable states must be visually distinct from
   each other and from a zero**, and neither may be a spinner that never
   resolves.
3. **The uncosted session is the design problem of this phase.** The history
   screen already gets it right in principle — a null cost reads "Not priced",
   never `0 kr`. Give that treatment a consistent visual form and apply it
   everywhere money appears.
4. Accessibility parity with the hardening already done on the mobile branches:
   text scaling, contrast, touch targets. The amber used for money
   (`BrandPalette.amber`) needs a contrast check at the sizes you use it.
5. **Do not change any API type, field or unit.** If a value's meaning is
   unclear, `UI-CR` it and render the state you would render if it were
   unavailable.

---

## 3. Phase 2 — The operator's money screens, web

Nine billing endpoints became real on 2026-08-19; several routes still carry
`Local fixture` / `Backend gated` labels. **You do not audit which are true —
`claude-c` and the coordinator do that.** You design what the operator sees.

Deliver:

1. **The held period is the most important screen in this product**, because
   holding is the expected outcome until several decisions land. An operator
   opening it should see *which* period, *why* it holds, in the system's own
   named reason, and what would change it. Design that screen properly.
2. **The refusal is content, not an error toast.** A named refusal — no
   contract, no billable clause, a count unavailable — gets a designed
   presentation, not a red banner.
3. **The provenance block.** Round 3 put derived counts and operator assertions
   on the invoice, with who, when and why. Give it a visual form: what was
   measured, what was asserted by a person, and the difference between them
   legible at a glance.
4. **Irreversibility must look irreversible.** Issuing an invoice consumes a
   number that cannot be reused. That action does not get a button that looks
   like every other button, and the consequence is stated on the screen rather
   than in a confirm dialog nobody reads.
5. Keep every honesty guarantee already established: disabled actions stay
   disabled, no fake payment or invoice, **no `0 kW` where the measurement is
   missing**, no Service persona.

---

## 4. Phase 3 — Number formatting and the example-figure audit

Verified: `apps/mobile/lib/screens/my_vehicle.dart` line 247 renders
`'2,486 kr'`, and lines 1531–1534 a breakdown of `'2,188 kr'`, `'298 kr'`,
`'2,486 kr'` — hardcoded, and formatted to look exactly like a real figure.

Deliver:

1. Every hardcoded currency figure across both surfaces, in one table: file,
   line, figure, screen, and whether a user could mistake it for their own
   money.
2. **Any figure a user could mistake for theirs is either driven by real data
   or visibly an example.** Design what "visibly an example" looks like — it
   must survive a screenshot taken out of context.
3. **Icelandic formatting: thousands `.`, decimal `,` — `7.564,00 kr`**, as the
   invoice renders it. `'2,486 kr'` is not Icelandic. Fix the formatting
   wherever a figure survives.
4. **One money formatter per surface**, not three. This is a presentation
   concern and it is yours.

---

## 5. Phase 4 — The empty states

Each of these is a real state with a real explanation, and each is currently a
blank: an org with no chargers; a charger with no agreement; an agreement with
no billable clause; a driver in no group; a driver with no sessions yet; a
period with no activity.

Design all six. An empty state says what is true, what it means, and what the
person looking at it can do — and never implies a zero where the answer is
"nothing has happened yet".

---

## 6. Phase 5 — The visual review note

`docs/notes/2026-08-28-money-screens-visual-review.md`, on your branch, in the
style of `apps/mobile/UI_REVIEW.md`:

- Each money screen, its states, and the visual rule each state follows.
- The contrast and text-scaling results.
- The consolidated `UI-CR` list.
- **What the driver still cannot see about their own money** — the short list.

---

## 7. Completion gates

| # | Gate |
|---|---|
| 1 | Both baselines recorded; missing toolchains stated plainly, not worked around |
| 2 | `2026-08-28-ui-change-requests.md` created; every needed value raised as `UI-CR-n` rather than fetched |
| 3 | Driver money screen set delivered as working code on the mobile branch |
| 4 | Priced / not-yet-priced / never-priced / unavailable / running / disputed each designed and **visually distinct** |
| 5 | No state renders an unknown as `0 kr` or as a placeholder figure |
| 6 | No screen implies Straumvakt collects, holds, refunds or remits |
| 7 | Statement / invoice / payment request / paid status kept distinct in copy |
| 8 | No screen says "apartment" |
| 9 | Text scaling and contrast checked on every money screen, amber included |
| 10 | The held-period screen designed: which period, the named reason, what would change it |
| 11 | Named refusals presented as content, not as error toasts |
| 12 | Provenance block given a visual form distinguishing measured from asserted |
| 13 | Invoice issue visually marked irreversible, with the consequence on the screen |
| 14 | Every hardcoded currency figure tabled |
| 15 | Every such figure data-driven or visibly an example, surviving an out-of-context screenshot |
| 16 | Icelandic formatting correct — `7.564,00 kr` |
| 17 | One money formatter per surface |
| 18 | All six empty states designed |
| 19 | **No file under `apps/api/**`, `packages/**` or `apps/mobile/lib/api/**` edited** |
| 20 | Canonical untouched but for the completion artifact |
| 21 | Visual review note delivered |
| 22 | Completion `.md` and `.json` written and committed after every phase |

---

## 8. Fallback queue — continue here; do not stop

1. **Web accessibility pass** on every route you touched: keyboard, focus
   order, contrast, and the money colour at small sizes.
2. **The CPO's monthly path, visually** — profile → sites → connectors →
   drivers and access → pricing → billing material. You built the navigation;
   design the sense of progress and of what is not yet done.
3. **The unaffiliated driver's money view** — the case
   `codex/unaffiliated-driver-experience` hardened, crossed with Phase 1.
4. **A charger's host is true only as of a date** — a device can move between
   hosts mid-month. Any screen asserting ownership without a date is asserting
   something that can quietly become false. List them; fix the cheap ones.
5. **Dark-mode and small-screen review** of every money screen.
6. Anything in your own artifact's next actions that stays visual.

---

## 9. Completion artifact

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-28\codex-work-money-screens-visual-design-completion.md
```

plus the JSON sidecar. **Your last two sidecars used non-standard key names and
the coordinator could not read them.** Use exactly:

`agent`, `round`, `status`, `start_utc`, `end_utc`, `wall_clock_seconds`,
`target_met` (`null`), `worktrees`, `branches`, `start_tips`, `end_tips`,
`dirty`, `commits`, `files_changed`, `tests`, `gates_met`,
`fallback_items_done`, `blockers`, `ui_change_requests`, `next_actions`,
`external_state`, `very_tldr`.

**External state must state:** no push, no deploy, no app-store submission, no
migration, no SQL, no Cloudflare/Neon/GitHub mutation, no hardware action, no
branch or tag deleted, **nothing under `apps/api/**`, `packages/**` or
`apps/mobile/lib/api/**` edited**, nothing written in canonical but the
artifact, and which branches you wrote to.

Report in chat only a concise TL;DR pointing at the artifact.
