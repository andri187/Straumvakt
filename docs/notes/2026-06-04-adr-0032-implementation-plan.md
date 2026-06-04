# ADR 0032 implementation plan — nágrannahjálp + Issue Engine go-live slice

**Date:** 2026-06-04
**Status:** PLAN + DRAFT migration SQL (operator applies — Rule 3/4 staff-only).
**Drives:** the actual build of ADR 0032. No schema/code exists yet (zero refs).
**Source ADR:** [`docs/adr/0032-neighbour-helper-and-issue-engine-go-live.md`](../adr/0032-neighbour-helper-and-issue-engine-go-live.md)

> This document is a **plan and a reviewable draft**. It does **not** edit
> `schema.prisma`, does **not** run a migration, does **not** commit. The
> operator reviews and applies the migration (Rule 3). The two
> `schema.prisma` edits (Rule 4 — additive only) are made in the build
> step that follows operator sign-off, not here.

---

## 0. Ground truth confirmed against the codebase

| Thing | Confirmed location |
|---|---|
| `issues.tickets` model `IssueTicket` | `apps/api/prisma/schema.prisma:1755`, root `prisma/schema.prisma:2035` — **identical field-for-field** |
| `issues.ticket_events` model `TicketEvent` | API `:1814`, root `:2094` |
| `issues.detection_rules` model `DetectionRule` | API `:1829`, root `:2109` — already has `orgId, ruleKey, config JSONB, enabled, version`; `@@unique([orgId, ruleKey])` |
| `agreements.driver_group_memberships` model `DriverGroupMembership` | API `:3035`, root `:3372` — **identical**; today only `id, driverGroupId, userId, addedAt` |
| `agreements.driver_groups` `scopeFilterJson` (the inherited-scope lever) | API `:3016` (`DriverGroup.scopeFilterJson`) |
| Permission catalogue + bundles | `apps/api/src/lib/auth/permissions.ts` |
| Migrations live in **root** `prisma/migrations/` only | latest = `20260604191203_going_public_foundation`; the API package has **no** migrations dir, it carries `prisma/generated/` + `schema.prisma` |
| Repo + mapper pattern | `apps/api/src/repositories/*.ts` (e.g. `driver-group-memberships.ts`, `driver-pricing.ts`) — `db: PrismaClient` first arg, `toRow` mappers, typed return |
| Driver bearer routes | `apps/api/src/routes/public/driver.ts` — `/api/driver/*`, stateless HMAC bearer (`verifyDriverToken`), `sub='driver'` |
| Scope walk (DriverGroupMembership → installation) precedent | `apps/api/src/repositories/driver-pricing.ts:248` (`listDriverInstallations` already walks membership → group → agreement → installations) |
| Existing enums | `IssueSubject {charger, ocpp_identity, connector, session, site, user, other}`, `IssueSeverity {low,medium,high,critical}`, `IssueStatus {open,triaged,assigned,in_progress,waiting,resolved,closed}` |

**Both schema files must be edited.** Root and API `schema.prisma` carry
duplicate copies of every model; they are kept in lock-step. The single
migration SQL below applies once to the database (the schemas it touches
are shared). The two Prisma-model deltas are byte-identical and applied
to **both** files.

---

## 1. The exact additive migration (DDL)

All changes are **additive**: new columns (nullable or defaulted), one
new table, one new enum *value* per existing enum, and an optional new
enum + column for `category`. **No drops, no renames, no reshapes** —
clears Rule 4's additive-only bar for `schema.prisma`.

### 1.1 Proposed migration name

`prisma/migrations/20260605HHMMSS_adr_0032_issue_engine_helper/migration.sql`
(timestamp set at generation time; must sort **after**
`20260604191203_going_public_foundation`).

### 1.2 Migration SQL (reviewable — operator applies)

```sql
-- ADR 0032 — neighbour-helper capability + Issue Engine go-live slice.
-- Additive only: new columns, one new table, breadcrumb data, optional enum.

-- ── §2 — neighbour-helper capability on driver_group_memberships ───────────
ALTER TABLE "agreements"."driver_group_memberships"
  ADD COLUMN "is_helper"           BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN "helper_granted_by_id" UUID,
  ADD COLUMN "helper_granted_at"    TIMESTAMPTZ(6);

-- partial index — helper lookups only ever filter on the true rows
CREATE INDEX "driver_group_memberships_is_helper_idx"
  ON "agreements"."driver_group_memberships" ("driver_group_id")
  WHERE "is_helper" = true;

-- FK for the audit column (host-admin User who elevated). ON DELETE SET NULL:
-- losing the granting user must not cascade-delete the membership.
ALTER TABLE "agreements"."driver_group_memberships"
  ADD CONSTRAINT "driver_group_memberships_helper_granted_by_id_fkey"
  FOREIGN KEY ("helper_granted_by_id")
  REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── §5B — driver-raised origination on tickets ─────────────────────────────
ALTER TABLE "issues"."tickets"
  ADD COLUMN "raised_by_user_id" UUID;   -- null for system-detected (§4/§5D)

ALTER TABLE "issues"."tickets"
  ADD CONSTRAINT "tickets_raised_by_user_id_fkey"
  FOREIGN KEY ("raised_by_user_id")
  REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tickets_raised_by_user_id_idx"
  ON "issues"."tickets" ("raised_by_user_id");

-- ── §6 — per-ticket chat (greenfield table) ────────────────────────────────
CREATE TABLE "issues"."ticket_chat_messages" (
  "id"              UUID         NOT NULL,
  "ticket_id"       UUID         NOT NULL,
  "author_user_id"  UUID         NOT NULL,
  "body"            TEXT         NOT NULL,
  "attachment_refs" TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],  -- R2 keys
  "read_by"         UUID[]       NOT NULL DEFAULT ARRAY[]::UUID[],
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ticket_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_chat_messages_ticket_id_created_at_idx"
  ON "issues"."ticket_chat_messages" ("ticket_id", "created_at");

ALTER TABLE "issues"."ticket_chat_messages"
  ADD CONSTRAINT "ticket_chat_messages_ticket_id_fkey"
  FOREIGN KEY ("ticket_id")
  REFERENCES "issues"."tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issues"."ticket_chat_messages"
  ADD CONSTRAINT "ticket_chat_messages_author_user_id_fkey"
  FOREIGN KEY ("author_user_id")
  REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

`ticket_events.eventType` is a **free `String`** (not an enum) — the
`chat_message` breadcrumb (ADR §6) needs **no DDL**; it is just a new
string value written by the chat repo. Nothing to migrate.

### 1.3 Optional — promote `category` to a closed enum (ADR §open)

ADR §open ("category taxonomy") leaves this a **decision**. `IssueTicket.category`
is a free `String` today (API `:1760`). §5 routing wants a closed set.

**Recommendation: keep `category` as `String` + a validated constant
list in `@straumvakt/shared` for the go-live slice; defer the enum.**
Rationale: the §4 rules already pin defaults (`physical, connectivity,
access, metering`), the constant list gives the same validation at the
route boundary without a schema migration, and a later promotion is a
clean additive `ALTER TABLE ... TYPE ... USING` once the taxonomy is
final. If the operator prefers the enum **now**, the additive form is:

```sql
-- OPTIONAL (only if promoting category to an enum at go-live)
CREATE TYPE "issues"."IssueCategory" AS ENUM
  ('physical', 'connectivity', 'access', 'metering', 'billing', 'other');
-- NOTE: this is the one change that is NOT purely additive at the column
-- level — it rewrites the existing String column. Safe only because the
-- tickets table is effectively empty pre-go-live. If any rows exist,
-- back-map them first. Prefer the constant-list path above otherwise.
ALTER TABLE "issues"."tickets"
  ALTER COLUMN "category" TYPE "issues"."IssueCategory"
  USING ("category"::"issues"."IssueCategory");
```

> **`ALTER TYPE ... ADD VALUE` ordering caveat (applies if any enum DOES
> gain a value):** Postgres cannot run `ALTER TYPE ... ADD VALUE` inside
> the same transaction that then *uses* the new value. Prisma emits
> these in their own statement, and the going-public migration already
> did exactly this (`ALTER TYPE "tenancy"."MembershipRole" ADD VALUE
> 'host_admin'`). **This ADR adds NO enum values** to `IssueStatus`,
> `IssueSeverity`, or `IssueSubject` — the existing `IssueStatus`
> already covers the full §1 lifecycle
> (`open→triaged→assigned→in_progress→waiting→resolved→closed`). The only
> new type is the *optional* `IssueCategory` above, which is a fresh
> `CREATE TYPE` (no ADD-VALUE ordering hazard). So the ordering caveat is
> a no-op for the recommended path; it is documented only because the
> optional enum path introduces a new type.

### 1.4 Prisma model deltas (apply to BOTH schema files, byte-identical)

**`DriverGroupMembership`** (API `:3035`, root `:3372`) — add:

```prisma
  isHelper          Boolean   @default(false) @map("is_helper")
  helperGrantedById String?   @map("helper_granted_by_id") @db.Uuid
  helperGrantedAt   DateTime? @map("helper_granted_at") @db.Timestamptz(6)

  helperGrantedBy   User?     @relation("DriverGroupMembershipHelperGrantedBy", fields: [helperGrantedById], references: [id], onDelete: SetNull)

  @@index([driverGroupId], map: "driver_group_memberships_is_helper_idx") // partial WHERE is_helper added in SQL
```

**`IssueTicket`** (API `:1755`, root `:2035`) — add:

```prisma
  raisedByUserId    String?   @map("raised_by_user_id") @db.Uuid
  raisedByUser      User?     @relation("IssueTicketRaisedBy", fields: [raisedByUserId], references: [id], onDelete: SetNull)
  chatMessages      TicketChatMessage[]

  @@index([raisedByUserId])
```

**New model `TicketChatMessage`** (both files, in the `issues` block):

```prisma
model TicketChatMessage {
  id             String      @id @default(uuid()) @db.Uuid
  ticketId       String      @map("ticket_id") @db.Uuid
  authorUserId   String      @map("author_user_id") @db.Uuid
  body           String
  attachmentRefs String[]    @default([]) @map("attachment_refs")
  readBy         String[]    @default([]) @map("read_by") @db.Uuid
  createdAt      DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)

  ticket         IssueTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  author         User        @relation("TicketChatMessageAuthor", fields: [authorUserId], references: [id], onDelete: Restrict)

  @@index([ticketId, createdAt])
  @@map("ticket_chat_messages")
  @@schema("issues")
}
```

Plus the **back-relations on `User`** (`identity` schema, both files):
`DriverGroupMembershipHelperGrantedBy`, `IssueTicketRaisedBy`,
`TicketChatMessageAuthor` — three new `@relation`-named reverse arrays.
These are the only edits to `User`; all additive.

### 1.5 Additivity / safety checklist

- [x] `driver_group_memberships`: 3 new cols — 1 defaulted bool, 2 nullable. No backfill needed.
- [x] `tickets`: 1 new nullable col. No backfill.
- [x] `ticket_chat_messages`: brand-new table. No existing data.
- [x] FKs use `ON DELETE SET NULL` (audit/origination) or `RESTRICT`/`CASCADE` (chat author/ticket) — no surprise cascades onto memberships or tickets.
- [x] No enum value additions on the recommended path → no `ADD VALUE` transaction hazard.
- [x] No drops, no renames, no column reshapes → satisfies Rule 4 additive-only for `schema.prisma`.
- [x] Optional `IssueCategory` promotion is the **only** non-additive-at-column-level step and is gated behind operator choice + empty-table precondition.

---

## 2. Permission catalogue additions

### 2.1 New `issue.*` verbs — `PER_TENANT_PERMISSIONS`

Add six atomic verbs to the catalogue in `permissions.ts` (after
`audit.read`, before the `as const` close):

```
issue.read       — see in-scope tickets / assistance requests
issue.raise       — driver creates an assistance request (5B.1)
issue.comment     — post chat on an own/claimed ticket (§6)
issue.claim       — pick up a request (sets assigned_to_user_id = self) (5B.2)
issue.transition  — move ticket through lifecycle states (helper/staff)
issue.escalate    — escalate OWN ticket to a technician (5C.1)
```

These also join the relevant **staff bundles** so the operator console
works: `issue.read` + `issue.transition` go into `TECHNICIAN_BUNDLE`
(and therefore `MANAGER/ADMIN/OWNER` by composition); `issue.read` into
`VIEWER_BUNDLE`/`SUPPORT_BUNDLE` (`READ_ALL`); ticket `close`/`triage`/
reassignment stays operator-side and is represented by `issue.transition`
held by staff (drivers never get `issue.transition` except via the
HOST_HELPER tier below, which is **not** a membership bundle).

> Adding verbs to `PER_TENANT_PERMISSIONS` will trip the exhaustive
> bundle test (`permissions.test.ts`) until every bundle decision is
> made explicit — that is the intended forcing function.

### 2.2 The three driver-capability tiers — resolved OUTSIDE the Membership bundle

Drivers have **no `tenancy.Membership`**, so they are **not** in
`MEMBERSHIP_ROLE_PERMISSIONS`. ADR §3 requires a **separate
capability-derived path**. This is the primary Rule 5 surface — every
grant is scope-gated.

New module: `apps/api/src/lib/auth/driver-capabilities.ts` (sibling to
`permissions.ts`, not folded into it — keeps the staff bundle path and
the driver path visibly distinct).

```ts
// Tiers as permission sets (reuse the issue.* verbs above).
export const DRIVER_BASE: Permission[] = [
  "issue.raise",
  "issue.comment",
  "issue.escalate",
];

export const PEER_RESPONDER: Permission[] = [
  ...DRIVER_BASE,        // a peer is also a driver on their own issues
  "issue.read",
  "issue.claim",
];

export const HOST_HELPER: Permission[] = [
  ...PEER_RESPONDER,
  "issue.transition",            // open→in_progress→waiting→resolved
  "charger.remote_start",        // §3 — host-designated helpers ONLY
  "charger.remote_stop",
  // charger.reset — add to PER_TENANT_PERMISSIONS if not present; OPEN per §3
];
```

**Resolution (pure, scope-gated):**

```ts
// Inputs are looked up by the caller from driver context:
//   memberships: the actor's DriverGroupMemberships (with is_helper)
//   target:      the charger/installation/site the action touches
// Algorithm:
//   1. Resolve which membership(s) cover `target` by walking
//      membership → DriverGroup.scopeFilterJson  (the SAME walk
//      driver-pricing.ts:248 listDriverInstallations already does —
//      factor that scope match into a shared helper).
//   2. No covering membership  → []  (out of scope = no capability).
//   3. Covering membership, is_helper=false:
//        - actor === ticket.raisedByUserId → DRIVER_BASE
//        - else (in-scope peer)            → PEER_RESPONDER
//   4. Covering membership, is_helper=true → HOST_HELPER.
```

Key invariants, straight from ADR §3:

- **Scope is inherited, never re-declared.** No `scopeSiteIds` on the
  driver path — reach == `DriverGroup.scopeFilterJson`. A helper outside
  scope is treated as a plain driver (or no capability).
- **Per-membership, not per-identity.** Same `userId` may be HOST_HELPER
  in group A and DRIVER_BASE in group B. Resolve against the membership
  that covers the *target*, not the user globally.
- **Explicitly excluded from every tier:** `charger.config`, billing,
  driver management, tariff, `org.read` beyond own group, cross-site
  visibility, ticket `close`/`triage`/reassignment, contractor
  assignment (5C resolution is operator/host-mediated).
- The middleware that consumes this is a **driver-context analogue** of
  the staff `requirePermission` — it must receive the resolved
  capability set AND re-check scope on the specific target row before
  every mutating action.

---

## 3. Milestone breakdown (ordered; blocked items flagged)

| # | Milestone | Depends on | Status |
|---|---|---|---|
| **M1** | **Schema migration** (§1) — apply DDL, edit both `schema.prisma`, regenerate client. Operator applies migration (Rule 3). | — | Ready |
| **M2** | **Permission catalogue + driver-capability module** (§2) — `issue.*` verbs, staff-bundle wiring, `driver-capabilities.ts` resolver + exhaustive-test fix. Pure, unit-tested. | M1 (types) | Ready |
| **M3** | **Repositories** — `issues.ts` (ticket CRUD + lifecycle transitions + `TicketEvent` breadcrumbs), `ticket-chat.ts` (`listMessages(ticketId, since?)`, `postMessage`, `markRead`), `helper-membership.ts` (`grantHelper`/`revokeHelper` writing `is_helper` + `helper_granted_by_id/at`, `listHelpersForGroup`). All `db`-first, `toRow` mappers, tenant-scoped. | M1 | Ready |
| **M4** | **Shared scope-match helper** — extract the membership→`scopeFilterJson`→target match out of `driver-pricing.ts` into a reusable `resolveDriverScope(target)` used by M2 resolver + M5 routes. | M1 | Ready |
| **M5** | **Detection-rule runner** — the five §4 rules (`charger_offline`, `site_connectivity`, `stuck_session`, `auth_failure_burst`, `metering_anomaly`), each reading its `issues.detection_rules.config` thresholds, dedup/correlate by `(subjectType, subjectId, rule_key)` within a window, writing `tickets` (status `open`, `detectedBy='engine'`, `raisedByUserId=null`) + a `rule_fired` `TicketEvent`. Seed the five `detection_rules` rows per org (data). **Signal source is an §open decision** — recommend reading the projected `events.event_log` (lower coupling than live gateway state) for go-live; note it. | M1, M3 | Ready (signal-source decision needed, non-blocking) |
| **M6** | **Driver/issue API routes** — extend `apps/api/src/routes/public/driver.ts` with `/api/driver/tickets` (raise/list/get), `/api/driver/tickets/:id/claim`, `/api/driver/tickets/:id/escalate` (5C — see M9 block), `/api/driver/tickets/:id/messages` (GET `?since=` poll + POST). Every handler runs the M2 driver-capability check + M4 scope re-check on the target. | M2, M3, M4 | Ready (escalate stub only — see M9) |
| **M7** | **Operator console issue pages** — web console ticket list/detail/transition + chat read+write using staff `issue.*` bundle. Reuses M3 repos. Unblocks the technician-support view. | M2, M3 | Ready |
| **M8** | **Mobile/web issue + chat surfaces** — Flutter driver app (`apps/mobile`) Issues + Helper screens (raise, list in-scope, claim, chat with attachments via R2 presigned helper); host-admin helper-grant UI on the web console. Chat realtime ships **poll-based** (`?since=`) per ADR §6 MVP; `TicketChatDurableObject` is a fast-follow. **Needs a new R2 presigned-URL helper** (`EVIDENCE_BUCKET`, key `<orgId>/tickets/<ticketId>/<uuid>.<ext>`) — greenfield. | M3, M6 | Ready (presigned helper greenfield) |
| **M9** | **§5C cost-gated escalation** — disclose-before-commit cost gate, contractor precedence (host SLA rate → Tengill rate-card fallback), write `assigned_to_contractor_id`, owner-routing via `assets.chargers.owner_org_id` (ADR 0008). | M6 + **Tengill P0.5** + **access-fee/rate-card P0.7** | **BLOCKED** |

### Blocked-dependency detail (M9)

ADR §5C / §"Cost source" gate the **escalation code** (not the rules)
on three ADR 0031 items that have **zero schema/doc refs as of 2026-06-04**:

- **Tengill formalization (P0.5)** — what "Tengill" *is*: a Straumvakt
  service brand, a distinct `tenancy.organizations` row with a
  `service_contractor` role, or a rate-card construct. Until defined,
  `assigned_to_contractor_id` has no resolvable default fallback.
- **Rate-card location (P0.7)** — where Tengill's general rate-card
  lives and how host-SLA rates are recorded against a host's contractor
  agreement. The disclose-before-commit gate has no price to disclose
  without it.
- **Driver-pays + invoice surfacing (ADR 0031 money-flow)** — host-as-
  agent vs Straumvakt collection; how the call-out lands on the
  post-paid invoice.

Everything M1–M8 is buildable **now**; the escalate route in M6 ships as
a stub that records intent and returns "escalation not yet available"
until M9 unblocks.

---

## 4. What unblocks which mock

| Milestone | Unblocks |
|---|---|
| **M1 schema** | Foundation for **all** Issues/Helper/technician surfaces — nothing renders without the `raised_by_user_id`, `is_helper`, and `ticket_chat_messages` columns. |
| **M2 + M4 (capability + scope)** | The authorization layer behind **every** driver Issues/Helper action — gates raise, claim, comment, transition on the driver app. |
| **M3 repos** | Data layer behind both the **driver Issues/Helper screens** and the **technician-support view**. |
| **M5 detection runner** | The **technician-support view's** auto-populated ticket queue (system-detected faults, §5D) — turns the empty support inbox into a live worklist without hand-querying `events.event_log`. |
| **M6 driver routes** | **Driver Issues screen** (raise + list own/in-scope), **Driver Helper screen** (claim + in-scope request feed), and the **chat thread** on each. |
| **M7 operator console** | The **technician-support view** itself — operator/host-admin ticket list, detail, transition, and contractor-side chat. |
| **M8 mobile/web surfaces** | The rendered **driver Issues + Helper screens** in Flutter (with photo attachments — the highest-value *nágrannahjálp* artifact) and the host-admin **helper-grant** UI. |
| **M9 escalation (BLOCKED)** | The **"Escalate to technician" CTA** + cost-disclosure modal on the driver Issues screen. Stays disabled/stubbed until Tengill + rate-card land. |

---

## 5. Open decisions surfaced to the operator (from ADR §open)

1. **`category`** — recommend `String` + shared constant list for go-live;
   enum promotion deferred (§1.3). Operator picks.
2. **Detection-rule signal source** — recommend projected `events.event_log`
   for M5; live gateway state deferred (latency vs load tradeoff).
3. **Chat realtime** — poll-based MVP (`?since=`) at go-live per ADR §6;
   `TicketChatDurableObject` fast-follow.
4. **`assignee_kind` discriminator** — stay derivable (no column) unless
   the operator console UI needs it; ADR defers it.
5. **`charger.reset` verb** — confirm whether to add `charger.reset` to
   `PER_TENANT_PERMISSIONS` (HOST_HELPER tier references it; ADR §3 marks
   it OPEN alongside remote_start/stop).
6. **Push notify-on-message** — greenfield (no FCM/APNs today); MVP uses
   `read_by` unread badges; provider pick + `push_token` on `User` +
   send queue is a named fast-follow, not a go-live blocker.
```
