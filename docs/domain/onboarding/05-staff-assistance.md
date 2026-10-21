# Staff assistance without impersonation

Phase 4. Straumvakt staff assist at any step; actions retain the staff actor and
the target organisation. Proposal only.

## 1. The rule

**Support context, not impersonation.** Staff never become the organisation
admin. Every write carries two identities:

```
actorUserId        -- the Straumvakt person. Always real, never substituted.
onBehalfOfOrgId    -- the organisation the action affects.
```

There is no mode in which `actorUserId` is the customer. If a log line cannot
name the human who caused a change, the design has failed.

## 2. Existing material to build on

**[F]** `apps/api/src/lib/auth/permissions.ts` already separates the two sides:
`PLATFORM_PERMISSIONS` (`platform.tenant.read`, `platform.tenant.write`, …) is
platform-side only and carries **no per-tenant verbs** (`permissions.ts:26-27`),
while tenant bundles compose upward `VIEWER → TECHNICIAN → MANAGER → ADMIN →
OWNER`, plus `FINANCE`. `effectivePermissions` composes membership and platform
grants (`permissions.ts:9`).

**[F]** `super_user` receives the platform set as a **literal list, not a
wildcard**, deliberately so a future `platform.*` addition is not auto-granted
(`permissions.ts:26-28`).

**[I]** The separation needed for non-impersonating support already exists.
What is missing is a *scoped, time-boxed, reason-carrying* bridge from a
platform permission to a specific tenant — today the choice is "platform verbs"
or "be a member".

## 3. Support context

```
SupportContext
  id, staffUserId, targetOrgId
  reason                    -- required, free text, audited
  grantedPermissions[]      -- subset of the tenant bundle, never OWNER
  openedAt, expiresAt       -- short, absolute
  closedAt?, closedReason?
```

Rules:

1. Entering requires an explicit platform permission — **[R]**
   `platform.support.enter` as a *new* verb, not reuse of
   `platform.tenant.write`. Reusing an existing verb makes every current
   super-user a support agent retroactively.
2. The target organisation is explicit. There is no "current org" inferred from
   a previous request.
3. Absolute expiry, not sliding. A support session that renews on activity
   becomes permanent by accident.
4. Permissions are a **subset** of what an org admin has, never a superset, and
   never `OWNER`. Staff can help onboard; they cannot transfer ownership or
   delete the tenant.
5. Exit is explicit, and expiry is enforced server-side per request — never by
   the client hiding a button.
6. Opening and closing are both events, visible to **both** Straumvakt and the
   organisation. An organisation must be able to see, unprompted, that
   Straumvakt entered its tenant, who, when, and why.

## 4. Step-level permissions

| Step | Tenant verb | Staff may | Reason required |
| --- | --- | --- | --- |
| `org_identity` | `org.write` | yes | no |
| `legal_contact` | `org.write` | yes | no |
| `commercial_terms` | `agreement.write` | **no** — org must accept its own terms | n/a |
| `property` / `site` | `site.write` | yes | no |
| `installation` | `installation.write` | yes | no |
| `charger_claim` | `charger.write` | yes | no |
| `vendor_credentials` | `vendor.credential.write` | yes | **yes** |
| `driver_group` | `drivergroup.write` | yes | no |
| `access_policy` | `drivergroup.write` | yes | **yes** |
| `invitations` | `invite.write` | yes | no |
| `validation` / activate | `org.write` | yes | **yes** |

**Commercial terms is the one step staff must not complete.** An organisation
accepting pricing it never saw, recorded as accepted because a staff member
clicked it, is the failure mode that survives into billing disputes. **[U]**
Whether a "staff prepared, org accepted" two-actor variant is needed at launch.

## 5. Confused deputy and cross-tenant prevention

- Every tenant-scoped query keeps its `orgId` predicate. Support context supplies
  the org; it never removes the predicate. **[F]** The pattern is already the
  repo rule — every repository function takes tenant as its first argument.
- The support context binds to exactly one org. A staff member assisting two
  organisations holds two contexts and cannot act on both in one request.
- **[R]** Reject any request whose body references an org other than the
  context's target, rather than filtering silently. A silent filter turns a
  cross-tenant bug into a partial write.
- The trusted-header pattern used by middleware — strip any client-supplied
  header, then re-set after verification **[F]** — should apply to any support
  context header, for the same reason.

## 6. Break-glass

**[R]** Break-glass is a *labelled* support context, not a separate mechanism:
same record, `breakGlass: true`, reason mandatory, maximum lifetime shorter, and
a notification to the organisation that does not depend on anyone reading a log.
Reviewed on a fixed cadence, with review recorded as an event.

The reason it is the same mechanism: a separate emergency path is the one least
exercised and least audited, and it is the one that will be used at 3am.

## 7. Deletion and the contractor mapping

- Soft delete by default for identity, access and audit records; hard delete
  only through an explicit retention action with a reason. **[U]** Retention
  periods are a legal question, not an engineering one.
- **[F]** ADR 0034 defines a contractor/Tengill compatibility mapping.
  **[R] It must not become staff authority.** A contractor is a tenant-side
  role; a Straumvakt staff member is platform-side. If the contractor mapping is
  ever composed into `effectivePermissions` for platform users, every contractor
  grant becomes a support capability by accident. Keep them in separate
  namespaces and assert it in a test.
