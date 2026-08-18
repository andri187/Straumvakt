# Persistence, migration and the rollout programme

Phases 5 and 7, completing the previously partial Phase 7. **No migration SQL,
no schema edit.** Every field is marked `NEW` or mapped to a current model.

## Part A — logical model

Drizzle in `packages/shared/src/db` is authoritative (ADR 0051); Prisma mirrors
it. Anything `NEW` lands in Drizzle first.

### A1. Onboarding aggregate

| Entity | Key | Ownership | Uniqueness | Notes |
| --- | --- | --- | --- | --- |
| `onboarding_workflow` **NEW** | `id` | `organisation_id` nullable until the org exists | one **open** workflow per org — partial unique index on `(organisation_id) WHERE state NOT IN ('active','cancelled')` | `version` for If-Match |
| `onboarding_step` **NEW** | `(workflow_id, key)` | via workflow | that pair | 7 coarse keys |
| `onboarding_substep` **NEW** | `(workflow_id, key)` | via workflow | that pair | 13 audit-grain keys |
| `onboarding_event` **NEW** | `id` | via workflow | — | append-only |

The partial unique index is the load-bearing one: it makes "two open workflows
for one organisation" unrepresentable rather than merely discouraged.

**`UNKNOWN`** — whether `onboarding_event` should be a new table or reuse
`audit.actions`. Reuse keeps one log; separate keeps workflow control-flow out
of an audit surface with a different retention lifetime. Leaning separate.

### A2. Installation access credentials

`installation_access_credential` **NEW** — `id`, `org_id`, `installation_id`,
`driver_group_id`, `code` (**unique**, indexed, non-secret), `passphrase_hash`,
`salt`, `policy_mode`, `max_uses?`, `used_count`, `valid_from`, `expires_at?`,
`rotated_from_id?`, `revoked_at?`, `revoked_reason?`, `created_by_user_id`,
`on_behalf_of_org_id?`.

Rotation is a **new row** plus `expires_at` on the old — never an update in
place, so the chain is auditable and a printed sticker keeps working through the
grace window.

**Redaction:** `passphrase_hash` and `salt` must never appear in any API
response, log line, audit metadata or error message. `code` may.

### A3. Access policy

Lives on the credential (A2 `policy_mode`) **and** on the installation as a
default. Rationale: an installation with several credentials (staff sticker,
visitor card) may want different modes per credential, but must have a default
so a newly minted credential is never mode-less.

### A4. Access requests

Maps to the existing **`AccessRequest`** model (`SOURCE-FACT` — routes
`/api/driver/access-requests`, `/api/admin/access-requests` exist today).
`NEW` fields: `via_credential_id?`, `policy_mode_at_submission`,
`decided_by_user_id?`, `decided_at?`, `reason_code?`.

Uniqueness: partial unique on `(installation_id, user_id) WHERE status = 'pending'`
— this *is* the dedupe rule from [10](10-api-contracts.md) §3.6, enforced by the
database rather than by application check-then-insert, which races.

### A5. Support context

`support_context` **NEW** — `id`, `staff_user_id`, `target_org_id`, `reason`,
`granted_permissions[]`, `opened_at`, `expires_at`, `closed_at?`,
`closed_reason?`, `break_glass`.

Every audited action taken inside one carries `support_context_id`, so "what did
Straumvakt do in my tenant on Tuesday" is one indexed query, not a scan.

### A6. Authorization and attribution evidence

- `IdToken` **EXISTING** + `token_class` **NEW** ∈
  `driver | physical_card | installation_technical`.
- `authorization_decision` **NEW** — `id`, `id_token_id?`, `token_class`,
  `verdict`, `reason`, `enforce_authorize`, `station_id`, `connector_id`,
  `occurred_at`. Records what was decided **and why**, which shadow mode needs
  to produce evidence for the `enforceAuthorize` rollout.
- `session_attribution` **NEW** — `session_id`, `attribution`
  (`driver|installation|unknown`), `basis`
  (`driver_token|physical_card|tap_evidence|autocharge|none`),
  `subject_user_id?`, `upgraded_at?`, `corrected_by_event_id?`.

**Invariant, enforced by a CHECK, not by convention:**
`attribution = 'installation' OR attribution = 'unknown' ⇒ subject_user_id IS NULL`.

### A7. Notification outbox

`notification_outbox` **NEW** — transactional outbox so "the organisation is
told Straumvakt entered its tenant" cannot be lost when a send fails. Same
transaction as the event; a worker drains it. Without this, notification is
best-effort and the promise in doc 05 §3 rule 6 is unenforceable.

## Part B — query shapes at scale

Worst case stated by the brief: **5,000 connectors, multiple operators.**

| Query | Shape | Index required |
| --- | --- | --- |
| Join by code | point lookup on `code` | unique on `code` — **must not** be a scan; this is the rate-limited path |
| Driver's chargers | membership → groups → installations → stations | `(user_id)` on membership; `(driver_group_id)` |
| Org's pending requests | filter + page | `(installation_id, status)` partial |
| Authorize | point lookup on idTag | `(id_tag)` unique — hot path, per transaction |
| Audit for an org | filter + page, newest first | `(org_id, occurred_at DESC)` |
| Staff actions in a tenant | filter | `(support_context_id)` |
| Attribution for a session | point | PK on `session_id` |

**Tenancy filters are mandatory, not optional**, on every one of these. At one
operator a missing predicate is invisible; at several it is a cross-tenant leak.
The repo rule — every repository function takes tenant as its first argument —
is what keeps this true, and the new tables must follow it.

## Part C — migration, expand → migrate → contract

**Zero legacy backfill.** Accepted direction 8: no old charging logs, no legacy
business data. New tables start empty; nothing is reconstructed.

**Expand.** Add all `NEW` tables and columns, nullable/defaulted. Nothing reads
them. Reversible by dropping.

**Migrate.** Dual-write: new writes populate new structures while old paths keep
working. Backfill only *derivable* facts — e.g. `token_class` from existing
`IdToken` rows. **`UNKNOWN`** — whether existing idTags can be classified from
data alone, or need an operator to say which are technical. This is a real
blocker for A6 and is called out rather than assumed.

**Contract.** Only after gates G1–G5. Drop nothing before them.

**Backout.** Each phase reverses independently. The contract phase is the only
irreversible one, which is why it is last and gated.

## Part D — rollout programme (Phase 7)

Designed against one requirement: **do not recreate the N1 deadlock.** The
danger is concrete — `claim-invite` has never had a client
([08](08-evidence-ledger.md) §4), so the existence of a better path is not
evidence that anyone uses it.

| # | Stage | Entry | Exit | Rollback |
| --- | --- | --- | --- | --- |
| 1 | **Measure** | telemetry deployed on every legacy entry | 14 days of baseline: calls/day per route, per client version | none needed |
| 2 | **Capability detection** | client sends a version header; server advertises supported methods | ≥1 release in the wild reporting capability | server ignores header |
| 3 | **New path live** | `POST /api/driver/join` deployed | green in production 30 days | route returns 404; clients fall back |
| 4 | **Dual contract** | both paths accepted; new clients prefer `join` | new-path share rising | clients keep using consume |
| 5 | **Adoption gate** | — | legacy < 1% of joins for 14 consecutive days **and** zero calls from any supported client version | hold indefinitely — no time limit forces this |
| 6 | **Harden `consume`** | gate 5 passed | identity binding live, overwrite refused | revert one conditional |
| 7 | **Retire** | G1–G5 all pass + Andri approves | route removed | restore from Git |

**Stages 1–2 and the S1/S2 fixes are independent of all of this** and should
ship first: S1 (stop discarding kennitala) and S2 (stop the overwrite) have no
client dependency, and S2 closes a Critical.

### Modelling installed old apps honestly

App-store adoption is not immediate and is **never total**. Some installs never
update. Therefore:

- Stage 5 has **no deadline**. A gate with a deadline is not a gate.
- "Supported client version" needs a definition — **`UNKNOWN`**, and it is a
  product decision, not an engineering one. Without it, stage 5 cannot be
  evaluated and the programme stalls at stage 4 by design, which is the safe
  failure.
- The retirement decision should be modelled on *users blocked*, not *versions
  outstanding*: one install belonging to an active fleet driver matters more
  than a hundred dormant ones.

### Stop conditions

Halt the programme and roll back the current stage if any of: join error rate
above baseline; a rise in `already_used`/`not_found` on legacy paths (indicating
clients being broken); any cross-tenant grant; any `installation_technical`
token resolving to a `userId`; or support-context actions appearing without
`onBehalfOfOrgId`.
