# Sprint Task Lists

Implementation grain beneath each sprint's milestones in
[STRAUMVAKT_V3_DELIVERY_PLAN.md](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md).
Generated 2026-04-25 from rev 2 of the plan
([ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md) +
[ADR 0007](../adr/0007-circuit-asset-tier-back.md)).

## Status

| Sprint | File | Detail |
|---|---|---|
| -1 Login Shell | (DONE — no task list needed) | — |
| 0 Foundation Schema | (DONE — see [retro](../retros/sprint-00.md)) | — |
| 1 OCPP Foundation | (1.1–1.4 DONE; 1.5 code-side complete, runbook pending) | — |
| 2 Admin Onboarding + Zaptec | [SPRINT_02_TASKS.md](./SPRINT_02_TASKS.md) | **deep** (next up) |
| 3 OCPI Foundation (CPO-only) | [SPRINT_03_TASKS.md](./SPRINT_03_TASKS.md) | sketch |
| 4 Data Storage Lifecycle | [SPRINT_04_TASKS.md](./SPRINT_04_TASKS.md) | sketch |
| 5 Commercial Model | [SPRINT_05_TASKS.md](./SPRINT_05_TASKS.md) | sketch |
| 6 Billing Dashboard | [SPRINT_06_TASKS.md](./SPRINT_06_TASKS.md) | sketch |
| 7 Push API + Observability | [SPRINT_07_TASKS.md](./SPRINT_07_TASKS.md) | sketch |
| 8 Hardening | [SPRINT_08_TASKS.md](./SPRINT_08_TASKS.md) | sketch |
| 9 Multi-Tenant + White-Label | [SPRINT_09_TASKS.md](./SPRINT_09_TASKS.md) | sketch |
| 10 Pilot Go-Live (admin-only) | [SPRINT_10_TASKS.md](./SPRINT_10_TASKS.md) | sketch |

## Working rules

- **The delivery plan is canon.** These files are implementation
  grain — if a task here disagrees with a milestone in the delivery
  plan, the plan wins; fix the task list. If the *milestone* is
  wrong, follow CLAUDE.md Rule 11 (ADR + plan edit), don't drift the
  task list silently.
- **Sketch sprints refine when they become next-up.** Sprints 3–10
  are intentionally light. The sprint *before* them produces the
  next-deep version as part of its retrospective.
- **Tasks not in the plan need an ADR + plan edit.** Don't expand
  scope here. If a task doesn't trace back to a milestone, it's
  either premature or an undocumented decision.
- **Check off as you go.** GitHub renders `- [ ]` and `- [x]` as
  checkboxes; the file is the live tracker for the sprint.
- **End-of-sprint:** every task either checked off or moved into a
  follow-up note in the retro. No half-finished bullets left in the
  file.
