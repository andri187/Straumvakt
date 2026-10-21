---
agent: codex-work
lane: market-core-ui-productization
status: ready
created_utc: 2026-08-10T23:05:00Z
estimated_wall_clock: 4-8h
target_worktree: E:\Claude\Straumvakt-onboarding-web
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\codex-work-market-core-ui-productization-completion.md
external_mutation_allowed: false
---

# Codex Work — Market Core UI Productization

## Very TL;DR

Make the local post-login product feel market-reviewable: Straumvakt Admin,
Organisation/CPO, and Driver Core workflows with access, pricing, billing,
reports, telemetry, disabled backend actions, tests, and review guide.

## Goal

Turn the existing local UI prototypes into a coherent Core product review
experience. This is local-only, not a production deploy. It should let Andri
look at the product flow and judge what Straumvakt is becoming.

## Locked Product Scope

Core: Iceland-only AC charging for MDUs/workplaces.

Core workflows:

- Straumvakt onboards organisation.
- Organisation/Straumvakt admin onboards chargers/connectors.
- Organisation/Straumvakt admin onboards drivers.
- Admin controls access groups.
- Admin configures pricing: DSO rates, retailer rates, CPO add-on, plug-time.
- Driver sees access, sessions, costs, statements.
- Organisation receives billing material/reporting.
- Standard telemetry is shown honestly.

Core pricing:

- 200 kr / active connector / month
- 50 kr / active driver / month
- cap 450 kr / connector / month

Cloud/backend realities:

- Backend write surfaces are not all ready.
- Pricing write UI must not pretend to persist until unlocked.
- Billing money must be clearly demo/read-only unless backed by contract.
- No `0 kW` as measured power.
- No charger visibility toggle if rejected.

## Worktree

```text
E:\Claude\Straumvakt-onboarding-web
```

Do not touch mobile. Do not deploy.

## Hard Rules

No push, deploy, backend mutation, DB/SQL, Cloudflare/Neon/GitHub remote
mutation, hardware/OCPP/BLE/NFC, or new top-level `E:\Claude` folder. Avoid
large screenshots/evidence. Existing `.next` is not source.

## Phase 0 — Start State

Record start UTC, branch, tip, dirty state, local server state if obvious.
Inspect dirty files before editing.

## Phase 1 — Route/Product Census

Inventory:

- `/login-demo`
- `/app/admin/...`
- `/app/org/...`
- `/app/driver/...`
- `/visual`
- DSO POC only as separate utility, not Core UI

Create a route matrix: route, persona, workflow, Core/future/premium, data
truth, backend dependency, UI honesty risk.

## Phase 2 — Product Flow Polish

Improve or add screens/states for:

Straumvakt Admin:

- organisation readiness
- Core launch checklist
- connector/admin status
- billing/rate readiness
- support/audit caveats

Organisation/CPO:

- charger/connector inventory
- driver roster
- access groups
- pricing setup
- DSO/retailer/CPO add-on
- plug-time/grace
- monthly statements
- report/export delivery status

Driver:

- access status
- assigned chargers
- active/past sessions
- clear cost explanation
- monthly statement
- blocked/pending/rejected states

## Phase 3 — Interaction Honesty

Implement/strengthen:

- disabled persisted pricing actions when backend absent
- read-only demo money labels
- backend unlock labels
- local/demo-only guard
- no fake live power
- no fake invoice sent
- no fake payment collected
- no Service UI as Core

## Phase 4 — Design Quality

Make it operational and market-reviewable:

- calm/dense layout
- clear tables/lists
- no marketing hero feel
- no card nesting
- mobile/tablet no overflow
- ISK money
- clear Icelandic business terminology where useful
- visible path from onboarding to billing material

## Phase 5 — Tests And QA

Add/update tests for:

- route data shape
- Core/future classification
- disabled backend actions
- ISK money
- billing material clarity
- driver statement rows
- no `0 kW` measured power
- local/demo guard
- no Service UI in Core route set

Run focused tests and build/typecheck if safe.

## Phase 6 — Handoff

Create:

- `docs/notes/2026-08-10-market-core-ui-productization.md`
- `docs/notes/2026-08-10-market-core-ui-review-guide.md`
- `docs/notes/2026-08-10-market-core-ui-backend-unlock-list.md`
- `docs/notes/2026-08-10-market-core-ui-test-report.md`

## Completion Artifact

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\codex-work-market-core-ui-productization-completion.md
```

Also write JSON sidecar if practical.

## Verification

Run focused tests, TypeScript, build, route checks if safe. Provide local preview
URL. Do not deploy.

## Final Handoff

Short chat TL;DR with path to completion artifact. Completion must include
timing, target met yes/no, start/end tips, dirty state, routes/files changed,
commits, tests/checks, local preview URL, backend dependencies disabled,
cleanup candidates, external confirmation, and next action.
