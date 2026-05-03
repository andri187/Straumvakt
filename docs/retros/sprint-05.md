# Sprint 5 — Queue-Backed Inbound OCPP + Invite Flow MVP · Retrospective

**Dates:** 2026-05-03 (single working day)
**Exit criterion:** Both tracks green per
[delivery plan §8](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#8-sprint-5--queue-backed-inbound-ocpp--invite-flow-mvp)
**Status:** **Met.**

Sprint 5 was the pre-pilot scale unlock per ADR 0017 — gateway DO
stops blocking the charger's CALLRESULT on a Postgres write.
Charger reply latency dropped from "Hyperdrive round-trip dependent"
to "Cloudflare-Queues-accept dependent" — sub-5ms p95 instead of
50–500ms. Track B (invite flow MVP) rode in parallel: bootstrap
admin gets a real `User` row, agents can be invited per org, the
recipient `/invite/<token>` page accepts a password and provisions
a `UserCredential` for the new agent.

A side fix branch (`fix/installation-ocpp-password`) landed
mid-sprint for an unrelated operator pain — Zaptec charger
`zpr042325` was 401-looping because the OCPP password set in our
DB didn't match what Zaptec's portal was pushing to the charger.
The fix added a per-installation password manager + a no-auth
opt-in path with double-confirm, plus the schema change to make
`auth_secret_hash` nullable.

---

## What shipped

| Milestone | Status | Commits | Notes |
|---|---|---|---|
| 5.1 — Queue + DLQ binding | ✅ | `ac65e73` | Provisioned `straumvakt-ocpp-events-staging` + DLQ. Consumer wired with idempotency parity to existing `ingestEventInTx`. DLQ replay script + runbook. 5 tests. |
| 5.2 — Gateway DO enqueues + early reply | ✅ | `a1d24bd` | `enqueueOrPost` helper — primary path is `OCPP_EVENTS_QUEUE.send`, fallback to service-binding `postEvent` for local-dev / transient queue failure. Removed `inflight:eventId` DO-storage retry path. Both ingest call sites swapped (`identity-do.ts:222` + `:480`). 4 new gateway tests. |
| 5.3 — Idempotent consumer hardening | ✅ | `b12d653` | 4 new test cases beyond 5.1's set: triple-replay, partial-batch failure, empty batch, DLQ replay no-op. No production-code changes — properties already correct from 5.1; tests prove them. |
| 5.4 — Observability via wrangler tail | ✅ | `f5c865c` | `[ocpp-q] batch_start` + `batch_summary` (acked/retried/dropped/recorded/replays + p50/p95 lag + duration) on consumer. `[ocpp-gw] enqueued` + `posted_fallback` on producer. Runbook gets a per-Worker grep-pattern table + common-query block. Health endpoint deferred to Sprint 10. |
| 5.5 — Bootstrap admin → real User row | ✅ | `fe0cd67` | `bootstrapAdminUser(db, email)` idempotent upsert — User row + super_user PlatformGrant. Login route calls it post-credential-check. `SessionPayload.userId` (optional in type for back-compat with pre-5.5 cookies). 5 tests covering the four paths. Audit call sites in installations route now write real actor. |
| 5.6 — UserToken sibling table | ✅ | `d3d90c5` | Original plan was polymorphic UserCredential; reshape would have violated Rule 4. Path C — sibling `UserToken` table for one-shot tokens (invite / magic_link / password_reset). Pure-additive migration `20260503140000_user_tokens`. 32-char Crockford-style plaintext (~160 bits), SHA-256 hashed, atomic conditional-claim consume. 12 tests. |
| 5.7 — Agent invite flow (admin side) | ✅ | `b38e178` | `createInvite` / `listInvitesForOrg` / `revokeInvite` repo. POST/GET/DELETE under `/api/admin/orgs/:orgId/invites`. UI: agent invites panel (one-shot URL reveal + copy-to-clipboard + outstanding-list with revoke). Re-inviting kills any outstanding invite token for the same user+org. Operator pastes link manually — transactional email is Sprint 6+. |
| 5.8 — Agent invite flow (recipient side) | ✅ | `f6b0494` | `apps/api/src/lib/password.ts` PBKDF2-SHA256 helper (100k iterations, 16-byte salt, prefix-tagged storage). Public peek + consume routes (token-gated, no admin cookie). `/invite/[token]` recipient page with password+confirm form. Login route extension — Path A (env-var admin) OR Path B (UserCredential lookup). Middleware exempts `/invite/*` + `/api/public/invites/*`. 5 password tests. |

### Side fix during the sprint

| Commit | Subject | Reason |
|---|---|---|
| `319e63e` | Drop Onboarded/Pending tabs from charger detail page | Operator UI cleanup |
| `efc0128` | Installation-level OCPP password rotation + explicit set | Operator was stuck — no UI path to re-stamp the OCPP password after Zaptec import |
| `488fca8` | Enrich installations list with OCPP password column + inline manage | Same operator flow, list-page level |
| `02ae86b` | Shorten rotated OCPP password to 20-char alphanumeric | 64-char hex overflowed Zaptec's password field on some firmware |
| `85b6d04` | Per-installation no-auth path (nullable authSecretHash) | This Zaptec firmware genuinely doesn't send Basic Auth headers — operator needs an opt-in security relaxation per fleet |
| `aa75020` | Explicit auth-mode emblem on every installation row | List-level visibility for the no-auth posture |
| `b5157e9` | Move Agents panel to its own tab next to Contracts | Profile tab grew long — invite panel was buried below the edit form |

The side fix branch was merged into `dev/sprint-05-queue-and-invite`
mid-sprint (commit `9bbc79b`) so subsequent Sprint 5 deploys
preserved the no-auth feature.

### Verification at sprint close

- `npx prisma validate` — clean (root + apps/api).
- `npx tsc --noEmit` — clean across root + apps/api + gateway.
- apps/api vitest — **156/156 pass** (was 114 at Sprint 4 close; +42).
- gateway vitest — **29/29 pass** (was 24; +5).
- Two migrations applied to staging Neon:
  - `20260503110000_ocpp_identity_authsecret_nullable` (side fix)
  - `20260503140000_user_tokens` (Sprint 5.6)
- All three Workers deployed at sprint close:
  - apps/api `9b690cbf-cbe6-45bc-8d68-1f7c700bc277`
  - gateway `7a498a9f-f6a0-40a0-bf3b-40ed09c3c93d`
  - UI `968f65ea-b0b6-49d1-bc0f-7acb46076cb1`
- Smoke verification: 9 `[ocpp-q] consumed` events in 30s tail
  window post-5.2 deploy, all `recorded:true`, p95 lag 1481–1872ms
  (within Cloudflare's `max_batch_timeout=1s` plus consumer DB
  round-trip).

---

## Decisions made (ADRs)

- **[ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md)**
  *(authored pre-sprint)* — drove the rescope. Track A (queue-
  backed ingest) became Sprint 5 headline; Track B (invite flow)
  rode in parallel. Driver self-registration + impersonation slip
  to Sprint 8 as planned.

### In-flight design decisions captured in commits / memory

- **OCPP-first, vendor API as fallback** — saved as memory
  `ocpp_first_strategy.md`. Originated from operator's clarification
  during the no-auth side fix: "the API approach fell apart because
  we couldn't retrieve the permissionlist via installation via api.
  So we go full OCPP, with API fallback, no orphan messages." Captured
  as a durable architectural principle so the inverse (vendor-API-
  as-canon) doesn't get re-pitched in a future sprint.

- **Path C for "polymorphic credentials"** — Sprint 5.6 was named
  "UserCredential polymorphic schema" but reshaping the existing
  `UserCredential.userId @id` to demote it from primary key violates
  Rule 4. Chose Path C — sibling `UserToken` table for short-lived
  one-shot artefacts (invite / magic_link / password_reset). Same
  operator outcome with a cleaner domain model and a fully additive
  migration. Captured in commit message + repo header comment.

- **No-auth opt-in security tradeoff** — operator chose Schema A
  (nullable `auth_secret_hash`) over Schema C (sentinel string).
  Required Rule 4 explicit instruction. Documented in commit
  `85b6d04` + the panel UI's double-confirm prompts spell out the
  impersonation risk verbatim.

- **Email delivery deferred** — invite flow uses operator-curated
  link delivery (paste to Slack / email / SMS). Wiring a
  transactional-email service (Resend / SendGrid) is Sprint 6+
  scope. Same pattern as the OCPP password reveal panel.

- **Health endpoint deferred** — `/api/internal/queue-health` for
  the queue-monitoring Grafana wiring. Needs persistent storage
  (KV / DB / DO state) for batch metadata between Worker invocations.
  Non-trivial design that didn't fit a Sprint 5 milestone. Sprint
  10's full observability pass takes it.

---

## What slipped (or shifted)

### 1. UserCredential polymorphic shape → UserToken sibling table

The original Sprint 5.6 plan was polymorphic UserCredential with a
`kind` discriminator. Discovered mid-sprint that `UserCredential.userId`
is `@id` (not `@unique`), so demoting it from primary key is a real
reshape that Rule 4 forbids. Pivoted to a sibling table. Net better
domain model — passwords + TOTP belong in UserCredential (long-lived,
one-per-user); invites + magic-links + password-resets belong in
UserToken (short-lived, time-boxed, multiple per user).

### 2. Audit call site migration is partial

Sprint 5.5 wired `actorUserId: c.var.session.userId ?? null` through
the installations OCPP password routes (the ones the side fix
introduced). The same change for older repository functions (e.g.
`credential-management.ts:544`, `zaptec-import.ts:340`) is
deferred — those sit inside repo functions that don't accept
`actorUserId` as a parameter, so threading the session through is
a separate refactor. Two `actorUserId: null` literals remain in the
codebase. Carry-forward.

### 3. Path-B users have no admin UI

Invited operators (Sprint 5.7-5.8) can sign in via the new login
Path B (UserCredential lookup), but they have no `PlatformGrant` —
so every `requirePermission(...)` admin route returns 401.
Today they land on `/login` after accepting an invite, sign in,
and... see the admin sidebar but get 401s on most actions. Sprint 6+
needs an org-scoped UI for non-platform-admin users. Documented in
the 5.8 commit message.

### 4. Charger sub-tabs (Overview/Log/Permissions) parked

Operator request mid-sprint to add Charger log + Permissions tabs
to the charger detail page. Surveyed but parked — recognised as
sprint-scope creep and deferred until its sprint owner gets to it.
The charger detail page still has the OPS tabs layout from the
side-fix branch deploy; getting the sub-tabs requires the work the
operator parked.

---

## What changed in the plan

- Side fix branch (`fix/installation-ocpp-password`) lifted into
  Sprint 5 mid-flight via merge. Not in the original SPRINT_05_TASKS
  list, but ended up part of the Sprint 5 deliverable because the
  fix branch's API/UI deploys and the Sprint 5.x deploys touched
  the same `hlada-api-staging` Worker. Merging into the Sprint 5
  branch ensured subsequent Sprint 5 deploys preserved the no-auth
  feature.
- Sprint 5.6 reshape from polymorphic UserCredential to UserToken
  sibling table — deviation from the original SPRINT_05_TASKS spec.
  Net additive, better domain model.

---

## Carry-forward into Sprint 6

Sprint 6 is a **decision sprint** (ADR 0018), not a code sprint.
Three decisions land:
1. Telemetry data platform — Neon-with-partitioning (default per
   ADR 0017) vs Timescale Cloud.
2. ORM boundary — Prisma scope vs raw-SQL scope.
3. Raw OCPP archive layout — R2 bucket, key scheme, retention.

Carry-forward items from Sprint 5 that touch Sprint 6's territory:

- **Per-event Prisma writes in the queue consumer** ([ocpp-events.ts](../../apps/api/src/queues/ocpp-events.ts))
  are the exact thing ADR 0018 will rule on. Sprint 7 implements
  the chosen path. The current consumer's `ingestEvent` call into
  Prisma is the baseline that Sprint 6's decision lets us optimise.
- **Lag distribution from 5.4 observability** is the data Sprint 6
  uses to size the partitioning vs Timescale decision. Operator
  has p50/p95 numbers visible from `wrangler tail | grep batch_summary`.
- **DLQ replay script** ([apps/api/scripts/replay-dlq.ts](../../apps/api/scripts/replay-dlq.ts))
  uses Cloudflare Queues' HTTP API. Sprint 6's R2 archive decision
  may add a parallel "archive replay from R2 → main queue" path.

Carry-forward items NOT in Sprint 6:

- **Audit call site migration** (above) — Sprint 6 is decision-only,
  no code. Defer to Sprint 7+ when those repos get touched anyway.
- **Org-scoped UI for non-admin Path-B users** — Sprint 6 is decision-
  only. Deferred until Sprint 8 tariff work surfaces the need.
- **Charger sub-tabs (Log / Permissions)** — operator-owned
  sprint-scope decision. Not on the delivery plan; revisit when
  operator brings it back up.

---

## Carry-forward learnings

### 1. The "side fix mid-sprint" pattern works when the fix branch is short-lived

The OCPP password fix was urgent (operator pain), unrelated to
Sprint 5's headline work, and only branchable because nothing in
Sprint 5 had touched installations yet. Cutting `fix/installation-
ocpp-password` from staging, shipping it, deploying, then merging
back into the Sprint 5 line worked cleanly. Three preconditions:
- The fix is genuinely orthogonal to in-flight sprint work.
- The deploy targets overlap (so merging is mandatory, not
  optional, before the next sprint deploy).
- The fix is small enough to land in the same working day so the
  branches don't drift far apart.

If any of those break, the fix should be its own sprint task or
get explicitly deferred.

### 2. Rule 4 as a forcing function for better design

Sprint 5.6's Path A → Path C pivot was driven by Rule 4's "additive
only" prohibition on reshaping primary keys. The forced
re-evaluation surfaced a cleaner domain model — the constraint
made me think harder about whether `UserCredential` was the right
home for invite tokens at all. Net: better outcome, less code,
zero migration risk. Worth noting that Rule 4 isn't just a guard
rail; it's a thinking tool when a "polymorphic" schema is on the
table.

### 3. Observability lines designed for grep are operator-friendly

The `[ocpp-q]` and `[ocpp-gw]` prefix convention from 5.4 lets the
operator slice `wrangler tail` with one pipe. Pattern: namespace
prefix + verb + JSON object. Single-line so each event fits one
log line, no multiline parsing needed. Worth carrying into Sprint
6+ work — name every grep-able log line with a consistent prefix.

### 4. Two-Worker deploys need explicit ordering documentation

Sprint 5.2's gateway producer flip + Sprint 5.7's UI panel both
required deploying apps/api before the other Worker. The runbook
captures this for the queue path but not generally. Worth a
one-paragraph addition to the project deploy guide once the
Sprint 6 decision sprint clarifies what other producer/consumer
pairs we'll have.

### 5. Memory captures the architectural why, not the architectural what

The `ocpp_first_strategy.md` memory I wrote during the sprint is
about "WHY OCPP first" (vendor APIs lag + don't expose installation-
level permissions). The "WHAT" (which projection lives where) is
in the code itself. Memory is for the architectural decisions a
future Claude session would otherwise re-litigate. Three more
candidates to capture next session:
- The `prisma/schema.prisma` is duplicated in apps/api/prisma/
  (with subtle generator differences) — anyone editing the schema
  needs to know to update both.
- The `cf_autodeploy_clobbers` memory's deploy-ordering rule has a
  nuance: it only applies to `staging`/`master` branches. Feature
  branches don't auto-deploy. Worth tightening the memory text.
- Path-B login users (UserCredential) currently get a session
  cookie but no UI — Sprint 6 decisions don't change this; Sprint
  8+ does.

---

## Sign-off

Sprint 5 closes on the same day it opened. Eight milestones plus
seven side-fix commits. Twelve commits on `dev/sprint-05-queue-
and-invite`, all pushed. Two migrations, three Worker deploys, no
incidents. The 4k-charger pre-pilot scale unlock (ADR 0017's
headline goal) is live on staging and verifiable via `wrangler tail`.

Sprint 6 (decision sprint, ADR 0018) starts when the operator
gives the go.
