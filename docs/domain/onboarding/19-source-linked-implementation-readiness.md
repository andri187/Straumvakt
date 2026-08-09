# 19 — Source-linked backend implementation readiness

Successor to the 18-series packet (`fc071b3`). Where 18 produced work packages
from analysis, this document produces **source-linked** implementation
sequences: every task, test, patch and check below names a file that was
actually read on this branch.

**Nothing was executed.** No SQL, no database connection, no network call, no
test run, no deploy, no git mutation beyond commits on this docs branch. Every
count in this packet was verified mechanically by counting IDs in the files, not
asserted from memory.

## Contents

| Doc | What it holds | Count |
|---|---|---|
| [19A](19A-source-inventory.md) | source inventory — path, symbols, packages, scenarios, risk, confidence | **140** entries |
| [19B](19B-implementation-task-map.md) | implementation tasks, 20 groups | **303** tasks |
| [19C](19C-test-specifications.md) | test specifications, 9 classifications | **76** specs |
| [19D](19D-patch-proposals.md) | patch proposals with pseudodiffs | **58** proposals |
| [19E](19E-migration-preflight-rollback.md) | migration / preflight / rollback checks | **40** checks |
| [19F](19F-api-contract-examples.md) | API contract examples | **34** examples |
| [19G](19G-review-checklists.md) | review checklists, pass/fail with evidence | **15** checklists |
| [19H](19H-codex-wiring-notes.md) | Codex / frontend wiring notes | **18** notes |
| this doc | provenance deep dive, contradiction audit, synthesis | **28** records |

---

## 1. The three sentences that matter

**One.** The support-context guard's prerequisite is smaller than 18F thought —
it is an *additive* function, not a refactor, and it can land before any schema
change (§3).

**Two.** Two of the biggest work groups, K (agreement writes) and G (onboarding
aggregate), are **greenfield**, not hardening. The packet's estimates were built
on the wrong verb.

**Three.** **No test suite runs in CI at all.** Every acceptance criterion in the
18-series of the form "enforced in CI" is currently unenforceable, so a package
can be marked done while nothing guards it.

## 2. New defects found while building this packet

These are not re-framings of known items. Each was found by reading source that
no prior document had read, and each is independently actionable.

### ND-1 — Cross-tenant PII exposure on `GET /api/admin/users/:id` — **highest severity here**

`apps/api/src/domains/identity/routes/admin-users.ts:67` gates on `member.read`
**without `orgIdParam`**. So `orgId` resolves `null`, the membership lookup is
skipped (`effective-permissions.ts:159-160`), and the only thing that can
satisfy the verb is `expandPlatformTenantVerbs`. **Every** platform role holds
`platform.tenant.read`, which expands to every `.read` verb.

The response is the full `UserSummary` — including **`kennitala`,
`dateOfBirth`, `address` and `notes`** (`users.ts:78`, `:109`) — for **any user
in any tenant**, with no support context and no audit row.

This is the concrete instance of the structural problem in §3.9: it is not a
one-route slip, it is what happens by default when a per-tenant verb is checked
with no org context. There are up to 85 such call sites. Under Icelandic and
EU data-protection expectations, kennitala and address readable by a
`sales_cs` or `auditor` grant, unlogged, is the finding on this list most likely
to matter to someone other than an engineer.

**Ask before assuming the worst:** this is reachable only by a holder of an
active platform grant, and today that is Straumvakt staff. It is a
control failure, not an open door. It becomes an open door the moment a
non-engineering platform grant is issued.

### ND-2 — About 1 in 256 auto-minted RFID tokens can never authorise

`mintRfidValue()` (`apps/api/src/domains/identity/repositories/id-tokens.ts:49-55`)
draws four random bytes. `resolveAuthorize:173-177` diverts **any** `08`-prefixed
idTag into `matchAndConsumeTapIntent` **before** the `IdToken` lookup. A minted
primary RFID beginning `0x08` therefore never reaches the normal path and can
never authorise a charge.

Roughly 0.4% of drivers, permanently, with a failure that looks like a broken
card. The mint loop must exclude the `08` prefix, and that fix is independent of
this work stream — it needs no attribution work, no schema change and no
decision.

### ND-3 — `GET /api/admin/billing/sessions` accepts any `driverUserId`

`routes/admin/billing.ts:58-67` takes `driverUserId` straight from the query
string with **no ownership check**, and `sales_cs` reaches `billing.read`
through the same expansion as ND-1. Scenario 96 ("no person named anywhere")
cannot hold while this stands, whatever the attribution model says.

### ND-4 — A green test locks in a 100× currency error

`driver-sessions.test.ts:246` asserts `costIsk: 64988` for a value that is
**649.88 kr**. `minorToIsk` (`driver-sessions.ts:95-98`) returns aurar
undivided. Fixing the code turns a passing test red, so both must move in one
commit — which is exactly the shape of change that gets postponed.

### ND-5 — The cost-factor surface writes no audit row at all

`recordAuditAction` appears **zero** times across
`routes/admin/billing-cost-factors.ts`, `repositories/billing-cost-factors.ts`,
`routes/admin/billing-rate-references.ts` and
`repositories/billing-rate-references.ts`. Package L08 has no local precedent to
copy, and price changes are currently untraceable.

### ND-6 — Concurrent sessions on one OCPP identity are indistinguishable

`gateway/src/identity-do.ts:961` mints a random `transactionId` that is never
ingested, and `onOcppRawStopTransaction` closes by
`(ocppIdentityId, status='in_progress')` picking the most recent
(`projections.ts:895-899`). Two concurrent sessions on one identity cannot be
told apart **regardless of what attribution says** — so E17 and scenario 78 need
the transaction-id ingestion gap closed first, not more attribution work.

### ND-7 — The invite-overwrite attack path is ordinary, not exotic

`repositories/invites.ts:94-106` resolves an **existing** user by email and
refuses only when membership in *that* org is already active (`:122-127`). So a
user who already has a password in `org_alpha`, invited to `org_beta`, receives
an invite token bound to their existing `userId` — the reachable route into the
`invites.ts:141-146` overwrite. The Critical is not limited to hypothetical
prior-reset accounts; **inviting an existing customer to a second organisation
is the trigger**, and that is a normal business event.

### ND-8 — The mobile app cannot redeem a host-minted driver invite today

Recorded in full as CS-18. `client.dart` posts to a route that resolves only
`kind === "invite"`; `createDriverInvite` mints `kind: "driver"`. The result is
404. This is a different mechanism from the previously-known driver-invite
deadlock and independently confirms it.

## 3. Permission provenance — the deep dive (Phase 3)

18F called this "the one real prerequisite" for the support-context guard. That
was right, but it framed the fix as a refactor of
`resolveEffectivePermissions`'s return type. Reading the source changes the
recommendation: **the cheapest correct fix changes no existing signature at
all**, and the technique is already in production in a sibling function.

### 3.1 What the code does today

```
POST /api/admin/orgs/:orgId/sites        (one of ~172 guarded call sites)
  │
  ├─ requireAdmin                         auth-middleware.ts:11-20
  │    verifyAdminSession(AUTH_SECRET)  → c.set("session", payload)
  │
  └─ requirePermission("site.write", {orgIdParam:"orgId"})
       require-permission.ts:45-89
       │
       ├─ :55  isBootstrapSession(session)? ──► next()   ★ NO CHECK AT ALL
       │
       ├─ :62  userId = sessionUserId(session)       null → 403
       ├─ :69  orgId  = c.req.param("orgId")         absent → null
       │
       └─ :74  resolveEffectivePermissions(db, userId, orgId)
                effective-permissions.ts:154-170
                │
                ├─ :159-162  parallel load
                │      getActiveMembership(db,userId,orgId)   :35-58
                │      getActivePlatformGrant(db,userId)      :65-86
                │
                ├─ :164-167  pureEffectivePermissions(m, g)
                │      permissions.ts:324-348
                │      ✗ LOSS 1 — one `seen` Set spans both sources (:328)
                │
                └─ :169      expandPlatformTenantVerbs(base)
                       effective-permissions.ts:103-139
                       ✗ LOSS 2 — platform.tenant.* injects per-tenant
                         verbs into the same flat array, unmarked
       │
       └─ :76  perms.includes(verb) ? next() : 403
```

### 3.2 Exactly where provenance is lost

**Loss 1 — `permissions.ts:328-347`.** `effectivePermissions` walks the
membership bundle then the platform bundle into one `out: Permission[]`,
deduplicating through a single `seen` Set. A verb present in both sources is
pushed once and thereafter belongs to neither. This is the smaller loss: it
only blurs overlap.

**Loss 2 — `effective-permissions.ts:103-139`.** `expandPlatformTenantVerbs`
is the real laundering step. A grant holding `platform.tenant.write` gains
`org.write`, `member.write`, `member.invite`, `member.remove`, `site.write`,
`property.write`, `charger.write`, `charger.config`, `charger.remote_start`,
`charger.remote_stop`, `billing.write`, `billing.export`, `tariff.write` and
`contract.write` — in **every** organisation, added by `set.add(w)` with no
marker distinguishing them from a genuine membership grant. After line 138
returns `Array.from(set)`, no consumer can tell a staff verb from a member
verb. That is the property the guard needs and cannot get.

**Loss 3 — `org-scope.ts:38-63`.** `resolveOrgScope` is a *separate* gate
deciding which orgs' **rows** a query may return, and it makes its own
independent platform check at `:52-56`, returning `{all:true}` for any
`platform.tenant.read` holder. Two consequences, and the second is the one that
bites later:

- A support-context guard installed only in `requirePermission` gates the
  *verb* and leaves the *rows* wide open. **18D §1.4 named one seam; there are
  two.**
- `org-scope.ts` embeds its **own definition** of "platform-derived" —
  `expandPermissionsSync(null, {role})` then test for `platform.tenant.read`.
  If the refactor adds a third definition rather than converging on one, the
  guard and the row filter will disagree the first time a role bundle changes.
  Converging them is task `IT-PROV-14`. Worth knowing while doing it:
  `org-scope.ts` is the **only module in `lib/auth/` with no test file**.

### 3.3 The pattern is already in the codebase

`org-scope.ts:52-56` does this:

```ts
const grant = await getActivePlatformGrant(db, userId);
if (grant) {
  const perms = expandPermissionsSync(null, { role: grant.role });   // ← null membership
  if (perms.includes("platform.tenant.read")) return { all: true };
}
```

Passing `null` for the membership isolates the platform side. That is
provenance, computed by construction rather than by tagging, and it already
ships. The provenance refactor is therefore not a new idea to invent — it is an
existing idiom to lift into a shared helper.

### 3.4 Call-site impact — measured, not estimated

| Symbol | Production call sites | Test mocks |
|---|---|---|
| `resolveEffectivePermissions` | **2** — `require-permission.ts:74`, `:126` | 3 — `require-permission.test.ts:30`, `test/parity/org-email-domains.test.ts:49`, `test/parity/driver-group-memberships-route.test.ts:54` |
| `expandPermissionsSync` | **1** — `org-scope.ts:54` | — |
| `effectivePermissions` (pure) | 1 — via the resolver | `permissions.test.ts` ×7 |
| `requirePermission` | **163** (non-comment) across `routes/` + `domains/`, of which **32** pass `orgIdParam` | 8 |
| `assertPermission` | **2** — both in `routes/admin/access-requests.ts` (`:90`, `:178`) | — |

A raw grep reports 168/33; the numbers above exclude commented lines.

This asymmetry is the whole engineering argument. All 165 route call sites pass
a verb string and never observe the permission set, so they are **unaffected by
any change to the resolver's return type**. The blast radius is five places:
two production callers, three mocks.

### 3.5 Eight options

| # | Option | Signature change | Extra query | Mocks break | Verdict |
|---|---|---|---|---|---|
| **O1** | Return `{all, viaMembership, viaPlatform}` from `resolveEffectivePermissions` | **breaking** | no | **yes, 3** | Correct but needlessly breaking |
| **O2** | Tag every entry: `Array<{verb, source}>` | **breaking** | no | yes, 3 | Heaviest; every `.includes` becomes `.some` |
| **O3** | Return two parallel sets, caller unions | **breaking** | no | yes, 3 | Pushes the union bug onto 2 callers |
| **O4** | Recompute at the guard via the `org-scope` idiom | none | **yes, +1 membership read** | no | Correct, but pays a round trip per guarded request |
| **O5** | **Additive sibling `resolvePermissionsWithProvenance`; old function delegates to it** | **none** | no | **no** | **Recommended** |
| **O6** | Stash basis on the Hono context in `requirePermission` | none | no | no | Complements O5; not a substitute — computes nothing |
| **O7** | Optional `{withProvenance:true}` flag with a conditional return type | none | no | no | Same result as O5 with worse typing |
| **O8** | Materialise provenance in a DB view | none | replaces query | no | Real answer at scale; wrong first move — no table exists |

### 3.6 Recommendation — O5

Add a new function; make the existing one a thin delegate. Nothing breaks
because nothing existing changes shape.

```ts
// effective-permissions.ts — ADDITIVE
export interface PermissionResolution {
  all: Permission[];            // identical to today's return value
  viaMembership: Permission[];  // membership role bundle alone
  viaPlatform: Permission[];    // platform bundle + tenant expansion alone
  membershipRole: MembershipRole | null;
  platformRole: PlatformRole | null;
}

export async function resolvePermissionsWithProvenance(
  db: Db, userId: string, orgId: string | null,
): Promise<PermissionResolution> {
  const [membership, grant] = await Promise.all([
    orgId ? getActiveMembership(db, userId, orgId) : Promise.resolve(null),
    getActivePlatformGrant(db, userId),
  ]);
  const viaMembership = expandPermissionsSync(membership && { role: membership.role }, null);
  const viaPlatform   = expandPermissionsSync(null, grant && { role: grant.role });
  const all = Array.from(new Set([...viaMembership, ...viaPlatform]));
  return { all, viaMembership, viaPlatform,
           membershipRole: membership?.role ?? null,
           platformRole: grant?.role ?? null };
}

/** UNCHANGED signature — delegates. All existing callers and mocks keep working. */
export async function resolveEffectivePermissions(
  db: Db, userId: string, orgId: string | null,
): Promise<Permission[]> {
  return (await resolvePermissionsWithProvenance(db, userId, orgId)).all;
}

/** The safety predicate. Difference, NOT membership of viaPlatform. */
export function satisfiedOnlyByPlatformGrant(
  r: PermissionResolution, verb: Permission,
): boolean {
  return r.all.includes(verb) && !r.viaMembership.includes(verb);
}
```

`viaMembership` is computed with a `null` platform grant, so
`expandPlatformTenantVerbs` contributes nothing to it — the expansion is
inert without a `platform.tenant.*` verb to trigger on. That is what makes the
difference operation sound.

**One behavioural check before merging.** Today's `all` is built by
`pureEffectivePermissions` (membership first, then platform, order-stable) and
then expanded. The version above unions two independently-expanded lists, so
**ordering differs** even though membership is identical. Nothing in the two
production call sites depends on order — both use `.includes` — but
`permissions.test.ts:211-250` asserts on arrays. Treat "the resolved set is
equal as a set, for all 13 role bundles × both grant states" as the merge gate.

### 3.7 Failure modes — ranked by how quietly they fail

1. **Union instead of difference.** Writing `viaPlatform.includes(verb)` instead
   of the difference means a Straumvakt employee who is *also* a genuine member
   of an org is forced into a support context for their own member actions.
   This is **T-SC-5**, and it fails as a lockout — loud, but it will be
   "fixed" under pressure by weakening the guard.
2. **Expansion leak.** Computing `viaMembership` from the membership *and* the
   grant puts platform verbs in the membership bucket, the difference is always
   empty, and the guard never fires. **Silent** — the tests pass, the banner
   never appears, and everyone believes the guard shipped. This is the
   dangerous one.
3. **Bootstrap bypass.** Any guard added after `require-permission.ts:55-59`
   is skipped for a session with `sub:"admin"` and no `userId`. The login route
   no longer mints those, but the branch still honours them.
4. **Row gate left open** (§3.2) — verbs gated, rows not.
5. **`assertPermission` forgotten.** `:126` is a second, separately-written
   function. Guarding only the middleware misses every route that resolves
   `orgId` by DB lookup.
6. **`orgId === null` not exempted** — platform-only routes would demand a
   support context to list organisations.
7. **Per-request memoisation keyed on `userId` alone** returns another org's
   provenance when a request touches two orgs.
8. **`driver` membership role maps to `[]`** (`permissions.ts:229`). A user
   with a `driver` membership row has an empty `viaMembership`, so every verb
   reads as platform-derived. Harmless today, worth one test.

### 3.8 Proving T-SC-5 — and why the obvious test is vacuous

The fixture must hold **both** an active membership granting the verb **and**
an active platform grant. Any other configuration passes under both the correct
implementation and failure mode 1:

| Fixture | Correct impl | Union bug | Discriminating? |
|---|---|---|---|
| membership only | allow, no ctx | allow, no ctx | **no** |
| platform grant only | ctx required | ctx required | **no** |
| **both** | **allow, no ctx** | **ctx required** | **yes** |

So `T-SC-5` is the only test in the support-context set that can detect the
most likely bug, and it is worthless unless the fixture is built this way.
Prove it the way the parity suite was proved: invert the predicate to the union
form, confirm `T-SC-5` goes red, restore it. A guard test that cannot be made
to fail is not evidence.

Failure mode 2 needs its own inversion: compute `viaMembership` with the grant
passed in, confirm a test goes red. If none does, the guard is untested.

### 3.9 Most guarded routes have no org context — so provenance cannot help them

Of the 163 `requirePermission` call sites, only **32** pass `orgIdParam`. The
other **131** resolve `orgId = null` at `require-permission.ts:69-71`, and
`resolveEffectivePermissions` then **skips the membership lookup entirely**
(`effective-permissions.ts:159-160`). **85** of those 131 name a *per-tenant*
verb — `site.write`, `charger.config`, `member.read` and so on.

Two things follow, and the first is a tenancy defect independent of support
contexts:

1. **A genuine org member cannot pass those 85 routes at all.** With no
   `orgId`, no membership is loaded, so the only thing that can satisfy a
   per-tenant verb is `expandPlatformTenantVerbs` — i.e. a platform grant.
   `org-scope.ts:13-16` says as much in its own header: *"Today the admin routes
   are reachable only by bootstrap/platform sessions."* That is fine while
   Straumvakt staff are the only operators. It stops being fine the moment a
   `host_admin` is expected to self-serve, and it is invisible until then.
2. **On those routes there is nothing for provenance to distinguish.** No
   membership path exists to exempt, and no org exists for a context to bind
   against. So `C03`'s "member acts as a member" is *vacuous* for 85 of 163
   call sites — not wrong, simply inapplicable.

The fix is not part of the provenance change: it is adding `orgIdParam`, or
resolving the org by sub-resource lookup and calling `assertPermission` the way
`access-requests.ts:178` already does. That is a per-route change across up to
85 routes, and it is the real prerequisite for host self-service — larger than
the provenance work it is often bundled with. Tracked as `IT-SCTX-20`, and it
is a **decision**, not an implementation task, until Andri says whether host
self-service is in scope.

### 3.10 The consequence nobody has costed yet

`bootstrapAdminUser` (`admin-bootstrap.ts:86-95`) provisions the operator
account with a **`super_user`** platform grant, and `super_user` receives every
platform verb including `platform.tenant.delete`, which expands to every
per-tenant verb in every org. The operator holds **no membership anywhere**.

Therefore, on the day the guard ships, `satisfiedOnlyByPlatformGrant` is true
for **every org-scoped action the operator takes** — every site edit, every
charger write, every member change, in every organisation. Correct by the
specification, and operationally unusable without one of:

- **(a)** issuing Straumvakt staff real memberships in orgs they routinely
  administer, so routine work takes the member path; or
- **(b)** a long-lived, explicitly-audited "operator context" distinct from a
  support context; or
- **(c)** shipping the guard in shadow mode first — audit what *would* have
  required a context, for a fortnight, before enforcing.

**(c) then (a)** is the recommendation. Shadow mode turns an unknown blast
radius into a measured one, and the measurement is what tells you which orgs
need (a). This is a decision for Andri, not an implementation detail — it is
the difference between a guard that ships and a guard that gets reverted in
week one.

**One prerequisite that does not exist yet.** Shadow mode needs a flag, and
18A's stated rollback for Group C is "feature flag off → current behaviour".
**There is no feature-flag store anywhere in the system.**
`entitlements.feature_flags` exists only as a comment placeholder at
`packages/shared/src/db/commercial.ts:84` — no Drizzle table, no Prisma model,
and the `entitlements` schema declares zero tables despite appearing in both the
datasource list and the Drizzle `schemaFilter`. The only other flag-shaped
reference in the repository is `billing-tick.ts:20`, a comment recording that
ADR 0025's `useAgreementsResolver` flag does not exist either. So "ship it
behind a flag" is not currently an available move for anything, and naming the
mechanism — env var, DB row, or Worker binding — is a blocking precondition
(`MP-23`) rather than an implementation detail.

### 3.11 Adjacent finding — `sales_cs` (not a provenance bug, but found here)

`permissions.ts:266-270` grants `sales_cs` the verb `platform.tenant.write`,
annotated `// column-restricted in repo layer (org notes/tags only)`. The
identical claim appears at `prisma/schema/identity.prisma:851`.

**That restriction is not implemented.** Grepping the whole repository for
`sales_cs` returns only enum declarations, this bundle, and tests — no repo
layer consults the role. Through `expandPlatformTenantVerbs`, a `sales_cs`
grant therefore carries `member.remove`, `charger.config`,
`charger.remote_start`, `charger.remote_stop`, `billing.write`, `tariff.write`,
`contract.write` and `org.write` in every organisation. A sales account can
stop a stranger's charging session.

`effective-permissions.test.ts:54-58` asserts this expansion as intended
behaviour, so the test suite currently locks the escalation in.

Blast radius today is unknown to this run and deliberately so: counting live
`sales_cs` grants requires a database query, which this track forbids. **The
preflight is `MP-*` in [19E](19E-migration-preflight-rollback.md); run it
before treating this as theoretical.** If the count is zero it is a latent
defect to fix before the first sales hire; if it is non-zero it is live
over-permissioning.

### 3.12 Audit, migration and frontend implications

**Audit.** The guard is the only place that knows a verb was platform-derived,
so it must write `supportContextId` and `onBehalfOfOrgId` onto the audit row.
`audit.actions` (`packages/shared/src/db/platform.ts:91-108`) has **neither
column, nor a `reason` column**. Without them the audit log cannot answer "did
staff do this, or did the customer?", which is the question the whole feature
exists to answer.

There is a sharper version of this that the 18-series missed. `ActorKind` is a
four-value Postgres enum — `user`, `system`, `vendor_webhook`, `ocpp_worker`
(`platform.ts:29`). Package **A04**, "audit the refused consume with
`actorKind:"bearer"`", is therefore **not a code branch — it is an enum
migration**, and `ALTER TYPE … ADD VALUE` cannot be reversed in place. The
alternative is reusing `actorKind:"system"` and carrying the real actor in
metadata. Either way it is a decision, and 18D §1.1 writes it as a one-line
change.

**Migration.** O5 needs none — it is pure TypeScript. The migration belongs to
the `support_contexts` table and the two audit columns. Provenance can therefore
land, with tests, *before* any schema change: it is a safe first commit.

**Frontend.** `403 support_context_required` is a **new error class**, not a
permission failure. If Codex renders it with the generic forbidden copy, staff
see "you don't have access" when the truthful message is "open a support
context first" — and will conclude their permissions are broken. This is the
one contract in this document that must reach Codex before the guard ships;
it is [19H](19H-codex-wiring-notes.md) note CW-03.
## 4. Contradiction and supersession audit

**28 records** across docs 10 and 14–19. Nothing was silently rewritten: where a
doc is now wrong, the record says so and names the replacement, but the original
text stays where it is so the reasoning trail survives.

Two of these records (CS-21, CS-23) correct **this run's own briefing material**,
not the older docs. They are kept in the same list rather than hidden in a
footnote, because a reader who inherits the corrected statement deserves to know
it was corrected mid-run.

Disposition values: **mark superseded** (add a pointer, leave the text),
**edit** (the text is actively dangerous and must change), **leave as history**
(was true when written, harmless now).

---

### CS-01 — Provenance is an additive change, not a return-type refactor

- **Old:** "`resolveEffectivePermissions` currently returns a set … must expose
  provenance" — 18F:43, echoed at 17:115 and 17:135.
- **New:** the fix adds `resolvePermissionsWithProvenance` and makes the
  existing function a one-line delegate. **No signature changes, no mock
  changes, no call-site changes.** See §3.6.
- **Why:** measured the call sites. Two production callers, three test mocks.
  The refactor framing implied a risky change; the additive framing makes it a
  safe first commit that can land before any schema work.
- **Risk if the old text is followed:** a reviewer rejects the work as too
  invasive to sequence early, and the support-context guard slips behind the
  schema migration for no reason.
- **Disposition:** mark superseded.

### CS-02 — `requirePermission` is not the only seam

- **Old:** 18D §1.4 presents the `requirePermission` guard as *the* insertion
  point for support-context enforcement.
- **New:** there are **two** gates. `requirePermission`/`assertPermission`
  decides *may you call this verb*; `resolveOrgScope`
  (`apps/api/src/lib/auth/org-scope.ts:38-63`) independently decides *whose rows
  you may read*, and returns `{all:true}` for any `platform.tenant.read` holder
  at `:52-56`.
- **Why:** found by reading the file. Its own header (`:13-16`) states the gate
  is currently a no-op because only bootstrap/platform sessions reach admin
  routes.
- **Risk if the old text is followed:** the guard ships, the banner appears,
  the audit log fills — and staff still read every organisation's rows without
  a context. A support-context feature that gates verbs but not rows is a
  compliance claim that is not true.
- **Disposition:** **edit** 18D §1.4. This one misleads.

### CS-03 — `malformed_metadata` returns 410 in consume, not 500

- **Old:** 18D §1.1 `meta -> { orgId, email } else -> malformed 400 [was 500]`;
  scenario 16 "Given malformed token metadata, Then 400 (not 500)".
- **New:** `POST /consume` returns **410**. The status map at
  `invites.ts:179-181` sends every reason except `not_found` to 410. The **500**
  is in `GET /peek`, at `:69`.
- **Why:** read both handlers.
- **Risk:** a test written to assert "currently 500" fails for the wrong reason,
  and the author concludes the fix is already in.
- **Disposition:** **edit** 18D §1.1 and scenario 16.

### CS-04 — Group K is greenfield, not hardening

- **Old:** 18A Group K, "agreement **write surface**" (14 packages), reads as
  hardening an existing surface.
- **New:** no agreement write surface exists anywhere in `apps/api/src`.
  `repositories/agreements.ts:1` declares itself read-only; the only writer in
  the repository is a one-off script.
- **Why:** grepped for every plausible write call; zero hits.
- **Risk:** estimates built on "harden what exists" understate the work by the
  entire cost of building it, and a sprint gets planned around a fiction.
- **Disposition:** mark superseded, and carry the greenfield framing into 19B.

### CS-05 — Group G is greenfield

- **Old:** 18A Group G and 18D §1.5 present onboarding aggregate endpoints as a
  design to be wired.
- **New:** `onboarding_workflow` / `onboarding_step` appear in **zero**
  `.ts`, `.prisma` or `.sql` files. `routes/admin/orgs.ts` registers no
  `/onboarding` sub-route.
- **Why:** repo-wide grep excluding `docs/`.
- **Risk:** same as CS-04.
- **Disposition:** mark superseded.

### CS-06 — "Offline tests run in CI" is false; nothing runs in CI

- **Old:** 18D's test matrix gives `npm run check` as the safe command for
  T-SC-6, T-PERM-matrix, T-PERM-inventory, and calls them "the natural first CI
  batch".
- **New:** `.github/workflows/check.yml` has three steps — install,
  `db:generate`, `npm run check` — and `scripts/check-all.mjs:14-36` runs nine
  **offline static** checks (typecheck, schemas, api-schema,
  schema-consistency, deps, deps-graph, api-endpoints, unused-exports,
  work-view), **none of which is vitest**. No test suite runs in CI at all.
- **Why:** read the workflow and the check runner directly.
- **An important distinction in fairness to the repo:** the *migration* check is
  excluded **deliberately and with a documented rationale**
  (`check.yml:10-44`: it needs a live `DATABASE_URL`, no such secret exists, the
  workflow triggers on every branch and PR so a staging credential would be
  broadly reachable, and two migrations —
  `20260807003000_drop_issues_scaffold` and
  `20260807120000_drop_never_used_tables`, both applied by hand and neither
  recorded — would turn CI red immediately). Vitest, by contrast, is absent with
  **no mention anywhere**. One is a considered trade-off; the other is an
  unnoticed gap. Only the second is a finding.
- **Risk:** this is the most consequential record here. Every acceptance
  criterion of the form "enforced in CI" is currently unenforceable, so a
  package can be marked done while nothing guards it. **Adding a vitest step is
  itself a prerequisite task, and it must land first or every other test task
  is decorative.**
- **Disposition:** **edit** the matrix; add the CI step as a blocking task
  (`IT-CI-*`).

### CS-07 — The rate limiter fails open

- **Old:** 18D T-RL-failclosed, "join refuses"; expected failure meaning
  "unlimited guessing".
- **New:** `apps/api/src/lib/rate-limit.ts:121-129` **fails open** when the
  binding is absent, deliberately, so dev environments work. The comment at
  `routes/admin/auth.ts:33-36` records that the operator must apply a
  `wrangler.jsonc` patch.
- **Why:** read the middleware.
- **Risk:** a test asserting fail-closed fails on day one and gets deleted as
  "wrong test" rather than raising the actual question — which is whether
  join and login should fail closed in production even though dev needs open.
- **Disposition:** mark superseded; the *intent* stands, the *current
  behaviour* is the opposite, and the gap is a real work item.

### CS-08 — `platform.impersonate` has four edit sites, not zero

- **Old:** "zero call sites exist" (carried into the D-01 recommendation to
  delete).
- **New:** zero **enforcement** call sites — no route checks it. But it is
  declared at `permissions.ts:82` and bundled into `platform_admin` (`:249`)
  and `support_agent` (`:261`), and `permissions.test.ts:192` asserts
  `support_agent` holds it. `super_user` inherits it through the spread at
  `:243`, so removing it from the catalogue removes it there automatically.
- **Why:** grepped the verb.
- **Risk:** low, but "zero call sites" invites someone to delete the string and
  be surprised by a red test.
- **Disposition:** mark superseded — the recommendation to delete is unchanged
  and now has an exact edit list.

### CS-09 — "Permissions are enforced" needs two qualifications

- **Old:** the earlier conclusion that 35 of 37 admin route files use
  `requirePermission`, therefore permissions are enforced.
- **New:** the count is right (~172 call sites across 39 files) and the
  conclusion holds for normal sessions, but two things qualify it:
  `require-permission.ts:55-59` returns `next()` with **no check at all** for a
  validly-signed session carrying `sub:"admin"` and no `userId`; and
  `org-scope.ts:13-16` states that because only bootstrap/platform sessions
  reach admin routes today, the row-scoping gate is a no-op returning
  `{all:true}`.
- **Why:** read both files.
- **Risk:** overstating current enforcement in a security review. The verb gate
  is real; the row gate is not yet load-bearing, and the bootstrap branch is a
  latent bypass.
- **Disposition:** mark superseded. Note that the login route always sets
  `userId` now, so the bypass is not reachable through normal login.

### CS-10 — A mobile contract test cited in the evidence ledger does not exist here

- **Old:** `08-evidence-ledger.md:61` cites
  `apps/mobile/test/api/client_contract_test.dart` at commit `4757f5c`.
- **New:** `4757f5c` is **not an ancestor** of this branch and the file is not
  present; `apps/mobile/test/` holds only an 11-line `widget_test.dart`
  placeholder. Package A12 has no file to rename.
- **Why:** `git merge-base --is-ancestor` and `git ls-tree`.
- **Risk:** an evidence ledger that cites unreachable evidence is worse than one
  that cites none — it will be trusted.
- **Disposition:** **edit** — annotate the ledger entry with the branch on
  which the evidence lives.

### CS-11 — The middleware reconciliation doc is stale, and so are three code comments

- **Old:** `docs/relaunch-middleware-reconciliation.md:3` says "Status: open"
  and §1 says the file sits at the repo root.
- **New:** `src/middleware.ts` exists and is live (commit `14c1ce2`); no
  root-level `middleware.ts` exists. Three source comments still repeat the dead
  claim: `src/middleware.ts:45-54`, `src/app/staff/page.tsx:27-34`,
  `src/app/staff/overview/page.tsx:221-231` ("an unauthenticated visitor
  reaches this line directly" — no longer true).
- **Why:** the inventory checked the paths.
- **Risk:** a developer removes a page-level guard believing middleware does not
  run, or keeps a redundant one believing it does.
- **Disposition:** **edit** the doc; mark the three comments in 19B as a
  mechanical cleanup task.

### CS-12 — Scenario 139 assumes a constraint that does not exist

- **Old:** scenario 139 and package K05 assume a Postgres exclusion constraint
  rejects overlapping agreements.
- **New:** `prisma/schema/commercial.prisma:483-513` declares four plain
  `@@index` entries and no unique or range constraint; grepping all of
  `prisma/migrations/` for `EXCLUDE`, `btree_gist` or `tstzrange` returns
  nothing. Overlap is handled at **read** time — a `console.warn` plus
  deterministic ordering at `lib/agreement/persist.ts:143-165`.
- **Why:** read the schema and grepped the migrations.
- **Risk:** a test asserting the second insert is rejected fails, and the
  read-time mitigation is mistaken for the constraint.
- **Disposition:** mark superseded. K05 needs both the extension and the
  constraint, and that is two migrations, not one.

### CS-13 — H05 is already built; H04 contradicts three deliberate decisions

- **Old:** 18A Group H lists H05 (vendor-attach idempotency) and H04 ("OCPP
  password never in a response body") as work.
- **New:** H05 is implemented **and** unit-tested —
  `repositories/chargers.ts:800-940` treats identical values as idempotent and
  throws `conflict_vendor_resource_id` / `conflict_credentials_ref` otherwise,
  mapped to 409 at `routes/admin/chargers.ts:349-351`, covered by
  `charging-stations.test.ts`. H04 contradicts three implementations that each
  return the password **on purpose, with an explanatory comment**:
  `onboarding-chains.ts:198`, `chargers.ts:645`, `installation-ocpp.ts:135`.
- **Why:** read all four.
- **Risk:** H05 wastes a sprint slot re-building working code. H04 written as a
  patch silently reverses a deliberate design decision — the operator has to
  read that password *somewhere* to commission a charger.
- **Disposition:** mark superseded. H05 becomes a verification task; **H04
  becomes a decision for Andri**, not a patch.

### CS-14 — ADR 0025's per-installation resolver flag does not exist

- **Old:** ADR 0025 specifies a per-installation `useAgreementsResolver` flag
  gating the new pricing resolver, with a mandatory comparison gate.
- **New:** `lib/agreement/billing-tick.ts:8-31` states in source that the flag
  **does not exist in code**, and that both resolvers run concurrently and
  ungated. The same header records staging counts at `:62-87`: 1,619 completed
  sessions, 8 with a `userId`, **0** inside the 30-day window — the newest
  attributable session ended 2026-05-13.
- **Why:** read the file.
- **Risk:** planning a rollout around a flag that has to be built first, and
  assuming the resolver has been exercised when it has priced zero sessions.
- **Disposition:** mark superseded; raise as an ADR-0025 amendment.

### CS-15 — A10 (strict body) and scenario 20 (mobile keeps working) cannot both hold

- **Old:** package A10 makes `ConsumeBody` strict; scenario 20 asserts the
  mobile app posting `{token, kennitala, password}` still works for new
  invitees.
- **New:** these are mutually exclusive. `ConsumeBody`
  (`invites.ts:36-39`) is a non-strict `z.object`, so the extra `kennitala`
  field that `apps/mobile/lib/api/client.dart:101-105` sends is silently
  stripped. Strict validation would return 400 to **every** mobile redemption.
- **Why:** read both sides of the wire.
- **Risk:** shipping A10 as written breaks mobile invite redemption completely.
- **Disposition:** **edit** — A10 must be re-specified as one of three named
  options (leave non-strict · strict with an explicit `kennitala` passthrough ·
  strict plus verify-against-invited-user). This is decision **D-02**.

### CS-16 — K08's "no second pricing implementation" is violated three ways

- **Old:** K08 accepts "no second pricing implementation".
- **New:** three exist: the legacy `lib/tariff` path that actually prices every
  session into `reports.session_ledger` via `ocpp/projections.ts:377,392,423`;
  the agreements resolver, which writes nothing; and `driver-pricing.ts`
  headline summarisers (`:175`, `:208`) that walk clause defaults only and never
  apply `BearerRule` overrides. `driver-pricing.ts:25-34` admits in-source that
  "canonical is aspirational, not current". A comparator exists but is
  operator-run only (`lib/billing-shadow/shadow-compare.ts`).
- **Why:** read all three.
- **Risk:** K08 reads as a constraint to maintain when it is a condition to
  *reach*. The driver-facing number and the ledger number can differ today.
- **Disposition:** mark superseded — restate K08 as convergence work with the
  shadow comparator as its evidence.

### CS-17 — `actorKind:"bearer"` is an enum migration, not a code branch

- **Old:** 18D §1.1 and package A04 — audit the refused consume with
  `actorKind:"bearer"`, written as a one-line change.
- **New:** `ActorKind` is a four-value Postgres enum: `user`, `system`,
  `vendor_webhook`, `ocpp_worker` (`packages/shared/src/db/platform.ts:29`,
  `prisma/schema/platform.prisma:119-126`). Adding `bearer` is
  `ALTER TYPE … ADD VALUE`, which **PostgreSQL cannot reverse in place**.
- **Risk:** an irreversible migration is smuggled in under a one-line
  acceptance criterion.
- **Disposition:** **edit** — split into a decision (add the enum value, or
  reuse `system` and carry the actor in metadata) and the write that depends on
  it.

### CS-18 — The mobile app cannot redeem a host-minted driver invite at all, today

- **Old:** the packet treats mobile invite redemption as working and at risk
  *from* S2.
- **New:** it is already broken, before any S2 change.
  `apps/mobile/lib/api/client.dart:93-107` posts to
  `/api/public/invites/consume`, which resolves only `kind === "invite"`
  (`invites.ts:111`). `createDriverInvite` mints `kind: "driver"`
  (`host-invites.ts:189`) and returns an `inviteUrl` of `/invite/{code}`
  (`:231`). The result is **404 `not_found`**. `client.dart` calls exactly
  twelve endpoints and none is `/claim-invite` or `/redeem-invite`.
- **Why:** read both sides of the wire.
- **Risk:** S2's compatibility window is designed to protect a path that does
  not function, while the actual break goes unlisted. This independently
  corroborates the known driver-invite deadlock through a **different**
  mechanism — a token-kind mismatch, not a permission or ordering bug.
- **Disposition:** **edit** — this is the real compatibility item, larger than
  anything 18A lists under B.

### CS-19 — A05's detection alert cannot fire; there is no metrics sink

- **Old:** A05, a detection alert for a credential overwrite, marked "ships
  without D-01"; R01–R03 use the verb "fires".
- **New:** the Worker has **no metrics sink at all**. `apps/api/src/bindings.ts`
  declares only `ADMIN_LOGIN_RATE_LIMITER` and `DRIVER_LOGIN_RATE_LIMITER`
  (`:95-100`) — no Analytics Engine, no queue, no logging binding — and
  `apps/api/src/lib/` has no metrics module. Every existing "alert" is a
  `console` line inside `ctx.waitUntil` with a swallowed `catch`.
- **Risk:** "alerting" is claimed as a mitigation for an unfixed Critical when
  nothing would page anyone.
- **Disposition:** **edit** — either add a binding, or downgrade A05 honestly to
  a documented query somebody runs.

### CS-20 — Doc 10 names a permission and an error code that do not exist

- **Old:** doc 10 §3.9 requires `platform.support.enter`; doc 10 §2 states 401
  is `unauthenticated`.
- **New:** `PLATFORM_PERMISSIONS` declares `platform.support.action` and no
  `platform.support.*` sibling — `platform.support.enter` has never existed.
  And both `auth-middleware.ts:17` and `require-permission.ts:52` emit
  `{"error":"unauthorized"}`.
- **Why:** grepped the catalogue and read the emitters.
- **Risk:** a frontend coded against `unauthenticated` never matches; a backend
  task to "check `platform.support.enter`" adds a verb nobody decided on. (This
  proposal was withdrawn once already in an earlier session; doc 10 still
  carries it.)
- **Disposition:** **edit** doc 10 §2 and §3.9.

### CS-21 — Validation error shape is not uniform (correcting this run's own brief)

- **Old:** I told the authoring agents that "validation failures are
  `{"error":"validation","issues":[…]}` at 400" — stated as an established
  convention.
- **New:** **three** shapes are live: `{"error":"validation","issues":[…]}`
  (`invites.ts:90`, `admin/access-requests.ts:84`,
  `routes/admin/onboarding.ts:17`); `{"error":"validation","message":"…"}` with
  no issues array (every `driver.ts` route — `:872-876`, `:1042`, `:1162`); and
  `{"error":"validation_error","issues":[…]}`
  (`billing-rate-references.ts:101-113`, `billing-cost-factors.ts:59-70`).
- **Why:** an agent checked the claim instead of inheriting it.
- **Risk:** a client written to one shape mis-parses two thirds of the API.
- **Disposition:** **leave as history** for the brief, **edit** the contract
  docs. 19F documents the shape per-endpoint rather than flattening it, and new
  endpoints are specified on the `issues` form.

### CS-22 — `member.remove` is enforced

- **Old:** 18A D02, "`member.remove` — defined, never enforced".
- **New:** enforced at
  `apps/api/src/domains/identity/routes/admin-memberships.ts:33` via
  `requirePermission("member.remove", { orgIdParam })`.
- **Risk:** a package that builds an already-present guard, and a
  false data point in the "verbs that guard nothing" argument. The argument
  still holds for `contract.write` and `tariff.write` — those really do guard
  zero routes — but the evidence list was wrong.
- **Disposition:** mark superseded.

### CS-23 — `per_connector` does have a migration (correcting this run's own brief)

- **Old:** I told the authoring agents `per_connector` exists in both schema
  files with **no** migration.
- **New:** it has a **Drizzle** migration —
  `apps/api/drizzle/0001_regular_talos.sql`, a single statement:
  `ALTER TYPE "agreements"."RateBasis" ADD VALUE 'per_connector';` (no trailing
  newline, so `wc -l` reports 0, which is how it was missed). The **Prisma**
  side still has none, so `prisma migrate dev` would generate a **second,
  competing** `ALTER TYPE`.
- **Why:** an agent checked rather than inheriting the claim.
- **Risk:** the original error would have caused someone to author a duplicate
  migration. Note the corrected position is still a problem, just a different
  one — and whether `0001` has been *applied* to any Neon branch is
  **unverified**: no connection was opened. `MP-03`/`MP-04` cross-check the
  ledger against the enum for exactly this reason.
- **Disposition:** **edit** — recorded here and in 19E.

### CS-24 — E04 cannot be a resolver change; the column is `NOT NULL`

- **Old:** E04, "technical token implies `userId` null", written as a change to
  the authorize resolver.
- **New:** `IdToken.userId` is **`NOT NULL` with a cascading FK**
  (`prisma/schema/identity.prisma:205`, `:230`;
  `packages/shared/src/db/identity.ts:131`), and `createIdToken` requires it. A
  column migration gates E04, E05 and E15. Making it nullable also breaks
  `local-auth-list-push.ts:165-188`, whose contract gate queries
  `driverGroupMembership` by `token.userId` and would throw `no_contract` for
  every technical token.
- **Risk:** starting E04 as a resolver edit and discovering the schema blocker
  after the branch is open.
- **Disposition:** mark superseded; re-sequence behind the migration.

### CS-25 — The "exhaustive" role tests skip the newest role

- **Old:** `permissions.test.ts` is described as giving exhaustive coverage of
  every membership role.
- **New:** `ALL_MEMBERSHIP_ROLES` (`permissions.test.ts:26-38`) is a
  hand-written 11-entry literal that **omits `host_admin`**, while
  `MEMBERSHIP_ROLE_PERMISSIONS` has 12 keys (the `host_admin` bundle is at
  `permissions.ts:186-192`). All four "exhaustive coverage" assertions in that
  block therefore skip it.
- **Risk:** the guard against role-bundle drift has a hole exactly where the
  newest, least-reviewed bundle is.
- **Disposition:** **edit** — derive the list from `Object.keys`.

### CS-26 — A green test locks in a currency-unit bug

- **New:** `driver-sessions.test.ts:246` asserts `costIsk: 64988` for a value
  that is **649.88 kr**. `minorToIsk` (`driver-sessions.ts:95-98`) returns
  aurar undivided, while `compute-session-cost.ts:12-16` defines the unit.
- **Risk:** a driver-visible cost inflated 100×, protected by a passing test.
  Fixing the code turns a green test red, so **both must move in one commit** —
  which is exactly the shape of change that gets deferred.
- **Disposition:** new finding; no prior doc to supersede. Raised as a
  standalone defect.

### CS-27 — L01's clause-scope enum does not match the database

- **Old:** L01 proposes clause scopes `org | driver_group | installation |
  charger` (also in 18D §1.7).
- **New:** `ruleScopeTypeEnum` is `[site, installation, circuit, charger]`
  (`packages/shared/src/db/commercial.ts:44`, mirrored as `RULE_SCOPES` at
  `packages/commercial/src/agreement/types.ts:15`) — no `org`, no `group`, and
  it has `site` and `circuit` which L01 omits. Separately
  `ruleAudienceTypeEnum` includes `user` (`:45`), so a **per-driver assignment
  is already expressible**, and scenario 146's rejection of it can only ever be
  an application-level check that a direct SQL insert bypasses.
- **Risk:** an API designed against a scope vocabulary the database cannot
  store.
- **Disposition:** **edit** L01 and 18D §1.7.

### CS-28 — Scenarios 148 and 97 are unsatisfiable through the route they name

- **Old:** scenario 148 ("explicit re-resolve produces a correction") and 97
  ("re-resolution is audited"), both pointed at
  `POST /api/admin/agreements/sessions/:sessionId/resolve`.
- **New:** that endpoint (`agreements-resolve.ts:27`) is idempotent **by
  skipping** — with lines already present it returns
  `{ok:true, alreadyExisted:true, emitted:0}` and writes nothing (`:43-50`,
  mechanism at `persist.ts:356`) — and **the file imports no audit helper at
  all**, so it writes zero audit rows. Neither scenario can pass against it.
- **Risk:** two scenarios that can never go green, attributed to a bug that
  isn't there.
- **Disposition:** mark superseded — the correction endpoint is **new**, not a
  change to this one.

---

### Records that are *not* contradictions

Three things I expected to be wrong and checked, that turned out fine — recorded
so nobody re-opens them:

1. **`getActivePlatformGrant` uses `.limit(1)` with no ordering.** Looked like
   non-deterministic grant selection. It is not: `platformGrants.userId` is
   `.primaryKey()` (`packages/shared/src/db/identity.ts:389`), so at most one row
   exists per user. **No bug.**
2. **The bootstrap god-mode branch as a live bypass.** `createAdminSession` is
   called with `userId` on **both** login paths (`routes/admin/auth.ts:134-137`),
   so freshly-minted cookies always take the real permission path. The branch is
   latent, not active — it matters as an escalation multiplier if `AUTH_SECRET`
   ever leaks, not as a current hole.
3. **18E's disabled-versus-hidden distinction.** Checked against the source
   position on charger visibility; consistent. No change needed.
---

## 5. Executive synthesis (Phase 14)

### Top five backend implementation sequences

1. **CI first, or none of the rest is enforced.** Add a vitest step to
   `.github/workflows/check.yml` (`IT-CI-01`). Until it lands, every "fails CI"
   acceptance criterion in this packet and the 18-series is decorative. One
   line of YAML gates roughly fifteen packages.
2. **Provenance → support context.** `IT-PROV-*` (additive, no schema, no
   breaking change) → `support_contexts` migration → the guard in **both**
   `requirePermission` and `assertPermission` → shadow mode → enforce.
3. **S2.** Guard before the claim, create-not-upsert, no invite burn, audited
   refusal. `PP-S2-01..04` are the change; the rest is compatibility.
4. **Attribution.** `IdToken.userId` nullable migration first (it gates E04,
   E05, E15 and ripples through five typed surfaces), then token class, then
   the OCPP response, then the ledger.
5. **Agreement writes.** Greenfield, but copy `billing-rate-references.ts`
   wholesale — the staged-version pattern with immutable price fields on active
   rows is already built and working for a sibling table.

### Top five things *not* to build yet

1. **The charger visibility toggle** — rejected, not pending. Hidden, not
   disabled.
2. **`platform.impersonate`** — delete it. Three source edits plus one test.
3. **A fourth pricing implementation** — three exist; K08 is convergence work,
   not a constraint to preserve.
4. **The onboarding aggregate's thirteen substeps** — the seven step keys are
   already a reconstruction; the substeps are unverified invention.
5. **Client-version gating** — there is no version header anywhere to gate on.
   Add the header, measure for a while, *then* gate.

### Top five decisions Andri can make quickly

| # | Decision | Why it is quick | Blocks |
|---|---|---|---|
| **D-02** | kennitala: leave non-strict · strict with allowlist · trust-on-first-use | Only the middle option needs no client release | S2 compatibility |
| **A04** | audit the refused consume as a new `bearer` enum value, or reuse `system` + metadata | `ALTER TYPE` is irreversible; the fallback is free | S2 audit |
| **H04** | should commissioning ever return the OCPP password? | Three implementations already say yes, deliberately | Group H |
| **C02-mode** | support-context guard: shadow first, or enforce directly | Shadow costs a fortnight and removes all guesswork | Support context |
| **ND-1** | is a non-engineering platform grant ever issued? | If never, ND-1 is latent; if soon, it is urgent | Privacy |

### Top five source risks

1. `expandPlatformTenantVerbs` — one function silently grants fourteen write
   verbs across every tenant, and the mitigation named in its own comment does
   not exist.
2. The bootstrap early return in `requirePermission` — a permission bypass that
   any future guard also inherits.
3. `IdToken.userId` `NOT NULL` — a five-surface type ripple hiding behind a
   one-line package description.
4. Two migration systems, one checked, two migrations unrecorded — and
   `per_connector` present in Drizzle but not Prisma, so `prisma migrate dev`
   would author a competing `ALTER TYPE`.
5. No feature-flag store — so "ship it behind a flag" is not currently an
   available move for anything.

### Top five tests to land first

All five need no database, cloud or hardware, and all five can run the day
`IT-CI-01` lands.

1. `TS-26` — role bundles are exhaustive (today's list omits `host_admin`).
2. `T-SC-6` / `TS-30` — `platform.impersonate` is absent from the catalogue.
3. `TS-01` — the S2 static guard: `upsert` must not reappear in `invites.ts`.
4. `TS-31` — a technical token class never yields a `userId`.
5. `TS-25` — the permission matrix matches source (drift detector).

### What frontend visual work can safely continue — without waiting

**All of it.** Straumvakt.org visuals for Straumvakt Admin, Organisation/CPO,
Driver and the future Contractor Service UI are a **separate lane** and are not
blocked by anything in this packet. Backend's obligation here is to supply
wiring contracts, not to gate iteration.

Two constraints only, and neither is a schedule dependency:

- **Do not render a number a customer would rely on** as final — cost totals,
  onboarding progress percentages, attribution of a session to a named person.
  Shapes yes, authoritative values no.
- **Hidden means hidden.** The charger visibility toggle must not appear even
  greyed out, because a disabled control is a promise that it is coming.

Everything else — layout, navigation, empty states, error states, typography,
the whole design system — proceeds today. See [19H](19H-codex-wiring-notes.md);
only `CW-07` and `CW-17` touch visual work at all, and both are one-line
constraints rather than blocks.

---

## 6. Critical path

```
IT-CI-01  add vitest to CI ─────────────────┐  (nothing below is enforced without it)
                                            │
IT-PROV-01..18  provenance (additive) ──────┤
   └─ IT-SCTX-01..05  support_contexts ─────┤
        └─ guard in requirePermission ──────┤
             AND assertPermission ──────────┤   ← two seams, not one
             AND resolveOrgScope ───────────┤   ← rows, not just verbs
                  └─ shadow mode ───────────┤
                       └─ enforce ──────────┘

PP-S2-01..04  ────────────────────────────► independent, ship any time
IT-ATTR-02  IdToken.userId nullable ──────► gates E04/E05/E15
ND-2  mintRfidValue excludes 0x08 ────────► independent, no decision needed
```

**Everything in the left column can start today.** The only true ordering
constraint in the whole packet is that `IT-CI-01` precedes anything that claims
CI enforcement, and the `IdToken` migration precedes attribution work.

## 7. Approvals needed from Andri

**New in this packet**

1. **ND-1** — confirm whether non-engineering platform grants are issued; it
   sets the urgency of the cross-tenant PII exposure.
2. **A04 / ActorKind** — irreversible enum migration versus the free fallback.
3. **H04** — whether commissioning may return the OCPP password.
4. **C02 rollout mode** — shadow first, or enforce directly.
5. **`IT-SCTX-20`** — is host self-service in scope? It decides whether up to
   85 routes need `orgIdParam`.
6. **Feature-flag mechanism** — env var, DB row, or Worker binding (`MP-23`).
7. **`K06`** — "open-ended rejected" would invalidate every existing agreement
   row; re-read as "`effectiveFrom` required"?

**Carried forward, still open**

8. **D-01** (invite consume as password reset — recommendation unchanged: ship
   S2, it is invariant to the answer), **D-02** (kennitala), **D-04**
   (supported client version), **D-10** (event log table).
9. **`E:\Claude` cleanup** — Claude B owns it; nothing done here.
10. **RC `work-view`** — still deliberately red, still needs a product call.

## 8. Dependencies on Claude B / release-ops

Named so the lanes do not collide. **None of these were touched by this run.**

1. The **vitest CI step** is a workflow change — Claude B's lane, this packet's
   prerequisite. `IT-CI-01` specifies it; it does not apply it.
2. **Two unrecorded migrations** (`20260807003000_drop_issues_scaffold`,
   `20260807120000_drop_never_used_tables`) must be reconciled before
   `check:migrations` can join CI. `check.yml:19-38` already documents the
   ordering.
3. **A `DATABASE_URL` secret decision** — the workflow triggers on every branch
   and PR, so a staging credential would be broadly reachable. That is a
   decision, not a wiring chore, and `check.yml:13-17` says so.
4. **A metrics sink binding** — without one, ND-5, A05 and every Group R alert
   have nowhere to fire (`bindings.ts:95-100` declares only two rate limiters).
5. **A disposable Neon branch** for the DB-bound specs in 19C. The parity suite
   **mutates**; it must never point at staging.

## 9. Counts — mechanically verified

Every number below was produced by counting IDs in the committed files, not
asserted from memory. The commands are reproducible.

| Deliverable | Target | Produced | File | Counted by |
|---|---|---|---|---|
| Source inventory entries | 80 | **140** | 19A | `^\| SI-` |
| Implementation tasks | 180 | **303** | 19B | `^\*\*IT-[A-Z0-9]+-\d+\*\*` |
| Test specifications | 60 | **76** | 19C | `^\*\*TS-\d+\*\*` |
| Patch-proposal sections | 40 | **58** | 19D | `^### PP-` |
| Migration/preflight/rollback checks | 25 | **40** | 19E | `^\*\*MP-\d+\*\*` |
| API contract examples | 20 | **34** | 19F | `^### AC-\d+` |
| Review checklists | 15 | **15** | 19G | `^### RC-\d+` |
| Codex/frontend notes | 10 | **18** | 19H | `^### CW-\d+` |
| Contradiction/supersession records | 12 | **28** | this doc §4 | `^### CS-\d+` |

Secondary counts: 150 review questions (10 per checklist), 20 task groups,
9 test classifications, 8 provenance options evaluated, 12 wrong-answer
attribution cases, 8 new defects.

**Checks run on the output** (not on the product):

- all relative `.md` links across the 19-series resolve to existing files;
- a sweep for DSNs, `AUTH_SECRET` values, bearer tokens, JWTs, real-domain
  email addresses and kennitala patterns returns **one** hit, and it is a
  synthetic normaliser fixture in 19C (`123456-7890` — month 34, not a
  well-formed kennitala). No secret, token, connection string, real address or
  personal datum appears anywhere in this packet;
- `git status` on `apps/api`, `packages`, `src`, `gateway` and `prisma` is
  **empty** — no runtime source was modified.

## 10. Time

| | |
|---|---|
| **Start (UTC)** | `2026-08-09T14:04:01Z` |
| **End (UTC)** | `2026-08-09T14:50:54Z` |
| **Wall-clock** | **46 minutes 53 seconds** |
| **Target** | 6–10 hours unattended |
| **Target met?** | **No — wall-clock was ~8% of the low end.** |

The target was not met and it would be dishonest to present the artifact counts
as if it had been. What happened instead is that the work ran **in parallel**:
26 subagents across three workflows, 1,282 tool calls, roughly 3.34 million
tokens of subagent execution. That is the work measure; wall-clock measures only
how much of it happened at once.

**What that buys and what it does not.** It buys breadth — ten independent
readers covering ten subsystems simultaneously, which is why the inventory
found 140 entries and eight new defects rather than the packet's assumptions
being re-stated. It does not buy the thing a genuinely long unattended run
would: iteration. Nothing here has been read twice by a fresh pair of eyes,
argued with, and revised. The corrections in §4 are corrections of *earlier*
documents; a second pass would produce corrections of *this* one.

**Where the remaining confidence gaps are**, stated plainly so nobody mistakes
volume for verification:

- **58 patch proposals, zero applied and zero compiled.** The pseudodiffs were
  written against files that were read, but no `tsc` ran over them. Expect some
  not to apply cleanly and at least a few to have type errors.
- **76 test specs, zero executed.** This track forbids a database, and most of
  the specs need one.
- Line anchors throughout drift on the next commit. Symbol names are the
  durable reference.
- Three corrections in §4 (CS-21, CS-23, and the refinements to §3) were caught
  by agents checking claims *I* had given them as established. That is the
  mechanism working, and it is also evidence that a further pass would find
  more.

If more unattended time is wanted, the highest-value next run is not more
documents — it is a **verification pass**: take the 58 proposals, apply each on
a scratch branch, run `npm run check`, and report which ones survive contact
with the compiler.
