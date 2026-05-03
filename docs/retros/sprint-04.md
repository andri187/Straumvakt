# Sprint 4 — Membership + Permissions Foundation · Retrospective

**Dates:** 2026-05-02 → 2026-05-03
**Exit criterion:** All six milestones from
[delivery plan §7](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#7-sprint-4--membership--permissions-foundation-adr-0014-build-order)
checked. **Status:** **Met (with one operator-driven UI item deferred).**

This sprint was the largest single push in the pilot bridge so far —
identity-model schema, permission catalogue, middleware, ~60 admin
routes migrated, and the OCPP-Authorize gate flipped from "shadow
hardcoded" to "per-installation operator-controlled." Sprint 4
unlocked Sprint 5's invite-flow work and gave the operator the first
real charger-side enforcement lever.

---

## What shipped

| Milestone | Status | Commits | Notes |
|---|---|---|---|
| 4.0 — Sprint 4 plan + scope shift docs | ✅ | `bc4d419` | Delivery plan §6 + §7 rewritten; SPRINT_04_TASKS.md authored at sprint-start (carry-forward learning from Sprint 3). |
| 4.1 — Schema additions (Path A1) | ✅ | `cf3dc56` | MembershipStatus + PlatformRole + PlatformGrantStatus enums; Membership lifecycle fields; PlatformAdmin → PlatformGrant rename + backfill + drop. Migration `20260502170000_membership_permissions` applied to staging Neon; api Worker manually deployed. Deprecated MembershipRole values (operator/helper/contractor/driver) kept; Sprint 9 RLS rebuild retires them. |
| 4.2 — Permission catalogue + role bundles | ✅ | `7c7f06a` + `7305436` | 25 per-tenant verbs + 15 platform verbs; 13 role bundles (7 membership + 6 platform); `effectivePermissions()` pure resolver + `hasPermission()` helper; 90 invariant tests. SVG diagram at `docs/architecture/permission-flow.svg` shows runtime flow + catalogue + bundles in one frame. |
| 4.3 — `requirePermission` middleware + 5 routes | ✅ | `ff3df65` | Hono middleware with `orgIdParam` config, bootstrap god-mode, and `assertPermission` inline helper. `effective-permissions.ts` adds the `platform.tenant.*` expansion (Recommendation A). 21 new tests; hierarchy concerns flagged for later review at `docs/notes/2026-05-02-permission-hierarchy-review.md`. |
| 4.4 — Admin-route migration sweep | ✅ | `49dd39c` + `0e348cf` | adminOrgs (13 routes) finished + boundary test retired; bulk migration of remaining ~50 routes across 13 files. Sidebar restructure deferred to operator (intersects with in-flight homepage concept + integration ref pages). |
| 4.5 — Production cutover code (events ingest) | ✅ | `da09fb2` | apps/api dual-mounts `/api/ocpp/events` + `/api/internal/ocpp-events`; gateway URL renames; production binding flipped `hlada` → `hlada-api` in wrangler.jsonc. Deploy order documented in commit message (operator-driven). |
| 4.6 — `Installation.enforceAuthorize` flag | ✅ | `43412cf` | Schema additive boolean (Rule 4 OK); migration `20260502230000_installation_enforce_authorize` applied; api Worker manually deployed (Version 7f9f79ba). Resolver fetches the chain once, every response carries the flag. Gateway DO `responseFor()` honours the verdict when enforce=true. UI toggle on `/installations/[id]` — emerald shadow / amber enforced. |

### Verification at sprint close

- `npx prisma validate` — clean (root + apps/api).
- `npx tsc --noEmit` — clean across root + apps/api + gateway.
- apps/api vitest — **114/114 pass**.
- gateway vitest — **24/24 pass**.
- root vitest — **41/41 pass** (boundary test retired).
- Two migrations applied to staging Neon; api Worker deployed.

---

## Decisions made (ADRs)

- **[ADR 0014](../adr/0014-identity-tenancy-and-authorization.md)** — pre-Sprint-4 design canon; Sprint 4 executed against its build-order §"Sprint 4 (membership + permissions foundation)" verbatim.
- **[ADR 0015](../adr/0015-sprint-3-scope-swap-ocpi-to-identity.md)** — Sprint 3 retro reference; Sprint 4 inherits the Sprint-3-was-identity-not-OCPI premise.
- **[ADR 0016](../adr/0016-sprint-5-scope-call-invite-over-tariff.md)** *(authored at this retro)* — picks Sprint 5 from the two contenders: invite flow (ADR 0014 build order) vs Commercial Model (delivery plan canon). Goes with invite flow; slips tariff to Sprint 6.

### Hierarchy concern parked

`docs/notes/2026-05-02-permission-hierarchy-review.md` captured three
concerns flagged during 4.3 design that don't block Sprint 4 but
warrant later review:
1. `member.*` carve-out from `platform.tenant.write` expansion
2. Implicit-vs-explicit at the route guard (write/delete may want explicit)
3. RLS reconciliation in Sprint 9

Triggers for revisit: Sprint 9 RLS hardening; first
Straumvakt-staff incident where impersonation would have been the
right tool but `platform.tenant.write` short-circuited; operator
review at next stocktake.

---

## What slipped (or shifted)

### 1. Sub-resource route gating is partially effective

The bulk migration (4.4) used the bare `requirePermission(verb)` form
for ~30 routes that operate on a sub-resource by id (e.g. `GET
/api/admin/sites/:id`) — meaning today's bootstrap admin passes via
god-mode, but a multi-user session would only get platform-side perms
(no Membership lookup because there's no `orgIdParam` to scope to).

**Carry-forward to Sprint 5:** retrofit each sub-resource route with
`assertPermission(c, verb, orgId)` after the resource lookup.
~30 routes. Mechanical once invite flow lands real userIds in the
session.

### 2. Sidebar restructure deferred to operator

ADR 0014's navigation section calls for Operations / Tenants /
Platform tiers in the sidebar. Sprint 4.4 task list included this;
the actual UI work was deferred because the operator's in-flight
homepage concept replacement + integration reference pages
(Autel, ChargeAmps, NexBlue) are reshaping the sidebar in parallel.
Operator drives the structure; the milestone-4.4 commit message
documents the deferral.

### 3. Production cutover deploys are operator-driven

Sprint 4.5 shipped CODE for the production cutover (gateway binding
flip, URL rename, dual-mount during transition). The actual
production redeploys happen when operator runs them. The dual-mount
on apps/api removes the atomic-deploy race so deploy ordering is
forgiving.

**Carry-forward:** once both gateway environments are confirmed on
the new URL, drop the legacy `/api/ocpp/events` mount + UI Worker
dead code in a follow-up commit.

### 4. Permission catalogue judgment calls

Mapping ~30 admin routes to verbs forced choices on:
- Installations → `site.*` (no separate `installation.*` verb)
- Family groups → `contract.read` (billing-side metadata; could be its own verb)
- Vendor credentials org-scoped → `org.write` (treats credentials as org-level metadata)
- Pending discoveries → `platform.tenant.*` (pre-onboarding signal)

These are revisitable single-line edits. Captured in the milestone-4.4
commit message for Sprint 5+ review if the eventual model warrants
different verbs.

---

## What changed in the plan

- **Delivery plan §7** rewritten (was Data Lifecycle; now Membership + Permissions).
- **Delivery plan §8** *(in this retro's accompanying commit)* will
  reframe to Invite Flow + Driver Self-Registration per ADR 0016.
  Commercial Model slips to §9 (Sprint 6).
- **SPRINT_04_TASKS.md** authored at sprint-start (the Sprint 3
  carry-forward learning). Used as the working tracker throughout.
- **SPRINT_05_TASKS.md** rewritten in this retro's commit to match
  the new Sprint 5 scope.

---

## Carry-forward into Sprint 5

These items don't block Sprint 5 starting but the Sprint 5 plan picks
them up:

1. **Sub-resource route inline `assertPermission` lookups** (~30 routes
   that today use bare `requirePermission(verb)`). Refactor to fetch
   the resource by id, get its orgId, call `assertPermission(c, verb, orgId)`.
2. **Production cutover follow-up commit** — drop the legacy
   `/api/ocpp/events` mount on apps/api + delete UI-Worker-side dead
   code in `src/lib/ocpp/*` and `src/app/api/ocpp/events/`,
   `src/app/api/internal/ocpp-auth/`. Pure deletion; no schema or
   logic changes.
4. **Sidebar restructure** — operator drives.
5. **Permission hierarchy review** per
   `docs/notes/2026-05-02-permission-hierarchy-review.md`.
6. **Verb-mapping review** for the four judgment calls above.

---

## Carry-forward learnings

### 1. Sprint-start plan + retro pattern is working

Sprint 3 retro flagged "name the scope at sprint-start." Sprint 4
opened with `bc4d419` (delivery plan §7 rewrite + SPRINT_04_TASKS.md)
BEFORE any code landed. Result: zero retroactive ADRs needed within
Sprint 4 itself. ADR 0016 (Sprint 5 scope call) is being authored at
THIS retro, before Sprint 5 code.

Continue: every sprint opens with a plan-doc commit; every retro
authors the next sprint's scope ADR if the choice isn't obvious.

### 2. Path-A vs Path-B prompt pattern works for schema decisions

Milestone 4.1 (and previously milestone 3 / Path A1) used a "two
paths, recommendation marked, operator picks" pattern. Quick
turnaround, low ambiguity, operator stays in control of risky
decisions (Rule 4 / Rule 5). Continue this pattern for any
schema-altering or access-grant change in Sprint 5.

### 3. Bulk migrations are tractable when the pattern is clear

Sprint 4.4's ~60-route migration in one commit looked daunting but
landed cleanly because the pattern (5 routes in 4.3 commit) was
already proven. The trade-off: long commits trade against
reviewability. Mitigate with strong commit-message verb-mapping
documentation (which 0e348cf does).

### 4. Hierarchy concerns deserve a parking lot

Mid-design concerns that don't block the sprint but might bite later
need a place to live. `docs/notes/2026-05-02-permission-hierarchy-review.md`
worked as that parking lot. Continue: any "this might be wrong, want
to review later" thought from a milestone gets a `docs/notes/<date>-<topic>.md`
with revisit triggers spelled out.

---

## Sign-off

- Schema-side exit criterion: **met** (two migrations applied; api
  Worker deployed manually).
- Code-side exit criterion: **met** (all six milestones shipped).
- UI-side exit criterion: **partially met** (4.6 toggle shipped;
  4.4 sidebar deferred to operator).
- Bookkeeping exit criterion: **met** (this retro + ADR 0016 + plan
  edit + SPRINT_05_TASKS.md rewrite committed in same change set).

Sprint 5 may begin. Entry condition: this retro committed + Sprint 5
plan docs landed. **Both ship in the same commit as a unit.**
