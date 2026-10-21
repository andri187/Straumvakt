---
agent: codex-work
lane: core-ui-product-polish
status: ready
created_utc: 2026-08-10T22:35:00Z
estimated_wall_clock: 4-8h
target_worktree: E:\Claude\Straumvakt-onboarding-web
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\codex-work-core-ui-real-product-polish-completion.md
external_mutation_allowed: false
---

# Codex Work — Core UI Real Product Polish

## Very TL;DR

Make the local Straumvakt Core UI feel like a credible post-login product:
Admin, Organisation/CPO, and Driver workflows for access, pricing, billing
material, reports, and standard telemetry — with honest disabled states.

## Goal

Continue the frontend product-to-market UI lane, local-only and Core-only. The
output should be reviewable in a browser as the shape of the real product, not
a marketing page and not a backend claim.

## Locked Scope

Straumvakt operates in Iceland only. Core is AC charging operations for MDUs and
workplaces: connectors, drivers, access, pricing, billing material, reporting,
standard telemetry.

Core pricing: 200 kr / active connector / month + 50 kr / active driver / month,
capped at 450 kr / connector / month.

Core billing includes DSO/network rates, retailer rates, CPO add-on, plug-time
fee with grace, clear driver statement, organisation statement/export material,
and delivery status/logs.

Out of scope: contractor Service UI as live product, OpenADR, OCPI/roaming,
Plug & Charge, DC animation/marketing, Samgöngustofa market-data work.

## Worktree

```text
E:\Claude\Straumvakt-onboarding-web
```

Do not touch mobile unless explicitly needed. It is not needed here.

## Hard Rules

No push, deploy, backend mutation, DB/SQL, Cloudflare/Neon/GitHub remote
mutation, hardware/OCPP/BLE/NFC, or new top-level `E:\Claude` folder. Avoid
unnecessary screenshot/evidence bloat. Existing `.next` output is not source.

## Phases

1. Record start UTC, branch, tip, dirty state, and local server status if
   obvious. Inspect dirty files before editing.
2. Inventory current routes: `/login-demo`, `/app/admin/...`, `/app/org/...`,
   `/app/driver/...`, `/visual`, Core billing/reporting routes, DSO POC if
   present but do not mix it into Core UI.
3. Create a route matrix: route, persona, purpose, Core/premium/future,
   fixture/live/disabled, biggest visual flaw, biggest honesty risk.
4. Polish Straumvakt Admin: organisation readiness, connector fleet,
   billing/rate readiness, support/audit caveats, backend blockers.
5. Polish Organisation/CPO Admin: chargers/connectors, driver roster, access
   groups, pricing/rate setup, DSO/retailer/CPO add-on, plug-time fee/grace,
   billing material, monthly reports/statements.
6. Polish Driver: access status, assigned chargers, session history, clear
   monthly charge statement, cost explanation, disabled/pending states.
7. Strengthen honesty rules: no fake live money, no `0 kW` as measured power,
   no final billing claim without backend write surface, no rejected visibility
   toggle, explicit disabled/read-only/pending states.
8. Improve design quality: operational, dense, calm, no marketing hero feel,
   no card nesting, clear scan hierarchy, consistent tables/actions, mobile and
   tablet no overflow, ISK money.
9. Add/update focused tests for route data integrity, Core vs future
   classification, disabled backend actions, no fake billing claims, ISK money,
   driver statement clarity, no `0 kW`, no Service UI as Core.

## Required Deliverables

Inside `E:\Claude\Straumvakt-onboarding-web`:

- `docs/notes/2026-08-10-core-ui-real-product-polish.md`
- `docs/notes/2026-08-10-core-ui-review-guide.md`
- `docs/notes/2026-08-10-core-ui-backend-unlock-list.md`

Completion artifact:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\codex-work-core-ui-real-product-polish-completion.md
```

If practical, also write JSON sidecar next to it.

## Verification

Run focused tests for changed files. Run TypeScript/build/route checks if safe
and established. If a local server is already running or can be started without
external mutation, provide the local preview URL. Do not push/deploy.

## Final Handoff

Chat response: short TL;DR and path to completion artifact.

Completion artifact must include start/end UTC, wall-clock duration, whether
4-8h target was met, start/end tips, dirty/clean state, routes/files changed,
commits, tests/checks, local preview URL, backend dependencies still disabled,
external confirmation, cleanup candidates, and next action.
