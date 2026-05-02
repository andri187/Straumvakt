# Permission hierarchy — open for review

**Date:** 2026-05-02
**Status:** Implementation choice flagged at Sprint 4 milestone 4.3 design;
operator wants to revisit when more route patterns are concrete.
**Relates to:** [ADR 0014](../adr/0014-identity-tenancy-and-authorization.md) §"Layer 4 — Authorization (PBAC)".

## What got chosen and why

Sprint 4 milestone 4.3 went with **Recommendation A** of the
permission-hierarchy decision: **`platform.tenant.{read,write,delete}`
expand into per-tenant verbs at resolve time**, NOT at the route guard.

Concretely, when `effectivePermissions()` sees a `PlatformGrant` with
`platform.tenant.write`, the returned `Permission[]` includes every
per-tenant `*.read` and `*.write` verb. Same for `read` (read-only
expansion) and `delete` (read + write + delete expansion).

The route guards stay simple — `requirePermission("site.write")` works
for both an org admin AND a Straumvakt platform engineer with
`platform.tenant.write`.

## Why the operator wants to revisit

The platform-staff bypass is implicit. Reading a route guard
`requirePermission("site.write")` doesn't tell you "this also accepts
platform.tenant.write." A reader has to know about the resolver's
expansion behaviour. That's a non-local rule.

Two specific concerns to revisit:

### 1. Member.* expansion carve-out

`platform.tenant.write` currently expands to include `member.invite`,
`member.write`, `member.remove`. So a Straumvakt support engineer can
add or remove members from a customer org. That's probably wrong —
member management should stay tenant-admin-only even for support
escalations (the audit log helps but doesn't prevent the action).

A future revision should likely carve `member.*` OUT of the platform
expansion. Operators retain member management; platform staff escalate
via impersonation (`platform.impersonate`) which logs the swap.

### 2. Implicit-vs-explicit at the route guard

Three routes might want different rules:

- **Read-it-all routes** (e.g. GET /api/admin/sites) — platform staff
  with `platform.tenant.read` SHOULD see everything. Current behaviour:
  correct.
- **Write routes** (e.g. POST /api/admin/sites) — platform staff with
  `platform.tenant.write` CAN write. Reasonable for emergency repair
  but logs less context than going through a real customer admin.
- **Destructive routes** (e.g. DELETE /api/admin/sites/:id) — platform
  staff with `platform.tenant.delete` CAN destroy customer data. This
  is the highest-risk surface; probably wants explicit `requirePermission`
  with both `site.delete` AND a separate platform-side
  `platform.tenant.delete` check OR a confirmation step in UI.

A future revision might split the expansion: read expansion = automatic,
write expansion = automatic except member.*, delete expansion = NOT
automatic (route guards add `platform.tenant.delete` explicitly).

## When to revisit

Three triggers, any of which:

1. **Sprint 4.4 sidebar restructure** finishes the route migration. If
   we hit a route where the platform expansion produces surprising
   behaviour, that's the moment to refactor.
2. **First Straumvakt-staff incident** where impersonation would have
   been the right tool but `platform.tenant.write` short-circuited the
   audit trail. (Nothing forces the staff member to impersonate today
   — they can just write directly.)
3. **Sprint 9 RLS hardening.** RLS at the DB layer is a stricter check
   than middleware; reconciling RLS rules with the middleware's
   expansion rules will force the question.

## What this note locks in (and what it doesn't)

This note doesn't decide the answer; it captures that the operator has
reservations and wants the choice revisited. The Sprint 4 retro should
include a "permission hierarchy review" entry pointing back here so it
doesn't fall out of working memory.

The pre-pilot answer is "ship Recommendation A and move on" because:
- Sprint 4 needs middleware to land for the rest of 4.4-4.6.
- No customer is yet on the platform; consequences of the implicit rule
  are bounded to internal staff actions on test data.
- Refactoring is mechanical: change the resolver's expansion logic in
  one place; route guards don't need to change.
