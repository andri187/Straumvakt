# Appendix 19D — patch proposals

**58 proposals.** Every one is a *proposal*. **No runtime source was edited in
this run** — `git status` on `apps/api`, `packages`, `src`, `gateway` and
`prisma` is empty. These exist to be reviewed and applied deliberately, later.

Each proposal carries: target files · pseudodiff · tests to add · migration
impact · rollback · unresolved questions · why deferral is safe.

Pseudodiffs are written against the files as read at `fc071b3`. They will need
rebasing; treat the surrounding context as identification, not as a patch that
will apply cleanly with `git apply`.

| Part | Area | Count |
|---|---|---|
| §0 | permission provenance | 1 |
| [§1](#part-1--s2-invitepassword-hardening) | S2 invite/password hardening | 17 |
| [§2](#part-2--attribution-and-token-class) | attribution and token class | 18 |
| [§3](#part-3--agreement-and-cost-factor-write-surface-and-the-organisation-onboarding-aggregate) | agreements, cost factors, onboarding aggregate | 22 |

---

## §0 — permission provenance

### PP-PROV-01 — Add provenance without changing any existing signature

**Target** `apps/api/src/lib/auth/effective-permissions.ts` :154-186 · **Pkg**
C02,C03,D10 · **Scen** 63-70 · **Risk** Low · **Apply when** any time — it is
additive and gates nothing

`resolveEffectivePermissions` returns a flat `Permission[]`, so no caller can
tell whether a verb came from the user's membership in this organisation or
from their platform grant. The support-context guard needs exactly that
distinction. This adds a sibling that computes both, and makes the existing
function a one-line delegate — so the two production callers, the three test
mocks and all 165 route call sites keep working untouched.

The reasoning, the eight options considered and the failure modes are in
[doc 19 §3](19-source-linked-implementation-readiness.md).

```diff
+/**
+ * Permission resolution that preserves WHERE each verb came from.
+ * `viaMembership` is computed with a null platform grant, so
+ * expandPlatformTenantVerbs contributes nothing to it — that is what
+ * makes the difference operation in satisfiedOnlyByPlatformGrant sound.
+ */
+export interface PermissionResolution {
+  all: Permission[];
+  viaMembership: Permission[];
+  viaPlatform: Permission[];
+  membershipRole: MembershipRole | null;
+  platformRole: PlatformRole | null;
+}
+
+export async function resolvePermissionsWithProvenance(
+  db: Db,
+  userId: string,
+  orgId: string | null,
+): Promise<PermissionResolution> {
+  const [membership, platformGrant] = await Promise.all([
+    orgId ? getActiveMembership(db, userId, orgId) : Promise.resolve(null),
+    getActivePlatformGrant(db, userId),
+  ]);
+  const viaMembership = expandPermissionsSync(
+    membership ? { role: membership.role } : null, null);
+  const viaPlatform = expandPermissionsSync(
+    null, platformGrant ? { role: platformGrant.role } : null);
+  return {
+    all: Array.from(new Set([...viaMembership, ...viaPlatform])),
+    viaMembership,
+    viaPlatform,
+    membershipRole: membership?.role ?? null,
+    platformRole: platformGrant?.role ?? null,
+  };
+}
+
+/** Difference, NOT membership of viaPlatform. See doc 19 §3.7 failure mode 1. */
+export function satisfiedOnlyByPlatformGrant(
+  r: PermissionResolution,
+  verb: Permission,
+): boolean {
+  return r.all.includes(verb) && !r.viaMembership.includes(verb);
+}
+
 export async function resolveEffectivePermissions(
   db: Db,
   userId: string,
   orgId: string | null,
 ): Promise<Permission[]> {
-  const [membership, platformGrant] = await Promise.all([
-    orgId ? getActiveMembership(db, userId, orgId) : Promise.resolve(null),
-    getActivePlatformGrant(db, userId),
-  ]);
-
-  const base = pureEffectivePermissions(
-    membership ? { role: membership.role } : null,
-    platformGrant ? { role: platformGrant.role } : null,
-  );
-
-  return expandPlatformTenantVerbs(base);
+  return (await resolvePermissionsWithProvenance(db, userId, orgId)).all;
 }
```

- **Tests to add:** `TS-25` (set equality against today's resolver for all 13
  role bundles × both grant states — the merge gate); `TS-27`
  (`satisfiedOnlyByPlatformGrant` is false for a user holding **both** an active
  membership granting the verb and an active platform grant — the only fixture
  that discriminates, see §3.8); `TS-28` (true for platform-only). **None fails
  today**, because nothing calls the new function yet — that is the point of an
  additive change, and it is also why `TS-27` must be fool-tested by inverting
  the predicate to the union form and confirming it goes red.
- **Migration impact:** **none — pure TypeScript.** No schema, no data, no
  config. This is what makes it the safe first commit of the whole sequence.
- **Rollback:** delete the three new exports and restore the old body. Nothing
  else references them until the guard lands.
- **Unresolved:** (a) `all` is now the union of two independently-expanded
  lists, so **ordering differs** from today even though membership is identical
  — confirm no caller depends on order (both current callers use `.includes`,
  but `permissions.test.ts:211-250` asserts on arrays). (b) whether
  `org-scope.ts:52-56`, which re-derives platform-derivation with its own
  definition, converges onto this helper now or later — see `IT-PROV-14`.
- **Safe to apply later because:** it is purely additive. Nothing changes
  behaviour until a caller opts in, so it can sit on `main` unused and inert
  for as long as the schema work takes.

---

## Appendix 19D Part 1 — S2 invite/password hardening: patch proposals

This part turns 18A Group A (A01–A14) into an apply-ready change set against one file that already exists and ships: `apps/api/src/routes/public/invites.ts`, mounted at `apps/api/src/index.ts:206`. This is **hardening, not greenfield** — the route is live, the mobile app calls it (`apps/mobile/lib/api/client.dart:93-119`), and one parity test already asserts its current 200-path behaviour (`apps/api/test/parity/driver-invite-redemption-parity.test.ts:620-668`). Two of the seventeen proposals are new-file (a static guard script, a parity test file) and one requires a Postgres enum migration; the rest are pure TypeScript inside a single handler.

Two corrections to the 18-series carry through everything below. **(a)** The critical defect is an ordering defect, not just an `upsert` defect: the conditional claim at `:130-133` runs *before* the credential write at `:141-146`, so any guard added after the claim burns the invite on refusal and locks the real invitee out permanently — that is the ADR 0053 deadlock re-created. **(b)** 18D line 27 annotates `malformed_metadata` as "was 500". That is true of **peek** (`:69`), not of **consume**: the consume status map at `:179-181` sends every non-`not_found` refusal to **410**, so consume's malformed metadata returns 410 today. Both need changing, for different reasons, and they are separate proposals.

The attack this part closes is concrete and reachable: `repositories/invites.ts:94-106` resolves an *existing* User by email rather than always creating one, and refuses only when the membership in **that** org is already `active` (`:122-127`). An operator with a password in `org_alpha` who is invited to `org_beta` therefore gets an `invite` token bound to their existing `userId` — and possession of that token, today, overwrites their `org_alpha` password.

---

### PP-S2-01 — Move a credential-existence guard strictly above the token claim

**Target** `apps/api/src/routes/public/invites.ts` :100-146 · **Pkg** A01 · **Scen** 1-3 · **Risk** High · **Apply when** the `select` on `userToken.findUnique` is widened in the same commit — the guard cannot read `user.credentials` from the current projection (`:102-109` selects no relation).

Today possession of an unused invite token for a user who already has a password sets a new password for that user, and the invite is already marked used by the time the write happens. After this change the request is refused before any row is mutated, the token's `usedAt` is still null, and the genuine invitee can complete the flow afterwards. The refusal reason must be produced *between* the expiry check and the claim — anywhere lower and the token is burned.

```diff
     const row = await tx.userToken.findUnique({
       where: { tokenHash },
       select: {
         id: true,
         userId: true,
         kind: true,
         usedAt: true,
         expiresAt: true,
         metadata: true,
+        user: { select: { credentials: { select: { passwordHash: true } } } },
       },
     });
@@
     if (!orgId || !email) {
       return { ok: false as const, reason: "malformed_metadata" as const };
     }
 
+    // The rule this route turns on — ported from
+    // routes/public/driver.ts:1086-1091. An established account must never
+    // be reachable by possession of a code. This MUST stay above the claim
+    // below: a refusal after the claim burns the invite and locks the real
+    // invitee out (ADR 0053 deadlock, re-created).
+    if (row.user.credentials?.passwordHash != null) {
+      return { ok: false as const, reason: "already_claimed" as const };
+    }
+
     // Conditional claim — concurrent consumers race; loser sees
     // count=0 and reports already_used.
     const claimed = await tx.userToken.updateMany({
```

- **Tests to add:** `T-S2-1` "bearer + existing credential → 409, stored hash string byte-identical"; `T-S2-5` "refused consume leaves `usedAt` null and the invitee still succeeds". Both FAIL today — T-S2-1 gets a 200 and a rotated hash, T-S2-5 gets a burned token. Assert on the *stored string* read back from `user_credentials.password_hash`, not on a re-hash: `hashPassword` salts randomly (`apps/api/src/lib/password.ts`, format `pbkdf2:sha256:iter:salt:hash`).
- **Migration impact:** none — pure TypeScript. `UserCredential` is already a 1:1 optional relation on `User` (`prisma/schema/identity.prisma:340-349`).
- **Rollback:** revert the two hunks. Nothing is lost — no data is written or migrated by this patch. Any invite refused while it was deployed is still unused and still redeemable.
- **Unresolved:** should an `admin` or `owner`-role invite to a *second* org be allowed to proceed for a user who already has a password (they are a legitimate re-invite, not an attacker)? Refusing them means every multi-org operator must accept through a signed-in path that does not exist yet. Reviewer must decide whether PP-S2-12's "sign in instead" copy is a sufficient answer for beta.
- **Safe to apply later because:** additive and self-contained — it introduces one new refusal branch and mutates nothing. But deferring it leaves the reachable overwrite live, so "safe to defer" is a statement about apply-order, not about risk.

---

### PP-S2-02 — Replace `userCredential.upsert` with `create`

**Target** `apps/api/src/routes/public/invites.ts` :138-146 · **Pkg** A02 · **Scen** 4, 18 · **Risk** High · **Apply when** PP-S2-01 is in the same commit — `create` alone converts a silent overwrite into an unhandled P2002 that surfaces as a 500.

The `update: { passwordHash }` branch is the overwrite primitive; the header comment at `:138-140` calls it "defensive", which inverts what it does. After this change the write can only ever create, so if the guard above it is ever deleted the database refuses rather than complying — the unique constraint becomes the backstop instead of the comment.

```diff
-    // Hash + persist password. Upsert in case the user already had
-    // a credential row from a prior reset (unusual for an invite
-    // flow, but defensive).
-    const passwordHash = await hashPassword(password);
-    await tx.userCredential.upsert({
-      where: { userId: row.userId },
-      create: { userId: row.userId, passwordHash },
-      update: { passwordHash },
-    });
+    // create, never upsert. The guard above is the policy; this is the
+    // backstop. user_credentials.user_id is the PK, so a second write for
+    // the same user raises P2002 and rolls the whole tx back rather than
+    // silently rotating an established password.
+    await tx.userCredential.create({
+      data: { userId: row.userId, passwordHash },
+    });
```

- **Tests to add:** `T-S2-2` "credential created exactly once for a fresh invitee" (passes today too — it is the regression anchor); plus a guard-removal test that stubs the guard off and asserts the tx rolls back rather than overwriting. The second FAILS today, because today there is nothing to roll back — the upsert succeeds.
- **Migration impact:** none — pure TypeScript. The uniqueness this depends on already exists: `userId String @id` at `prisma/schema/identity.prisma:341`.
- **Rollback:** restore the `upsert` block. Nothing is lost, but the overwrite primitive comes back with it — do not roll this back without also rolling back PP-S2-01, or the guard's error path becomes an untested 500.
- **Unresolved:** `passwordHash` is nullable (`identity.prisma:343`) and `clearUserPasswordHash` (`domains/identity/repositories/users.ts:381-386`) leaves the row while nulling the column. A user whose password an admin deliberately cleared has a credential *row*, so `create` will P2002 for them. PP-S2-04 handles the guard side; the writer side needs a decision — see there.
- **Safe to apply later because:** it changes no behaviour on the only path currently reached in practice (fresh invitee, no credential row), where `upsert` and `create` are identical. It is a no-op until the day it matters.

---

### PP-S2-03 — Extend the refusal status map so `already_claimed` returns 409

**Target** `apps/api/src/routes/public/invites.ts` :179-182 · **Pkg** A03, A06, A07 · **Scen** 1 · **Risk** Low · **Apply when** PP-S2-01 has added the `already_claimed` reason — shipping the map first is harmless but dead.

The map collapses everything that is not `not_found` into 410, so a new refusal reason would arrive at clients as "gone" and be rendered as "this invite has already been redeemed" (`client.dart:126-128`) — wrong, and it tells the wrong person the wrong thing. 409 separates "you may not do this" from "this token is spent", which is what the mobile and archived-web copy branches need to key on.

```diff
   if (!result.ok) {
-    const status = result.reason === "not_found" ? 404 : 410;
-    return c.json({ error: result.reason }, status);
+    const status =
+      result.reason === "not_found"
+        ? 404
+        : result.reason === "already_claimed"
+          ? 409
+          : result.reason === "malformed_metadata"
+            ? 400
+            : 410;
+    return c.json({ error: result.reason }, status);
   }
```

- **Tests to add:** `T-S2-1` asserts status 409 specifically (not "not 200"); `T-S2-6` asserts 400 for malformed metadata — see PP-S2-06. `T-S2-1` FAILS today at the status assertion even after PP-S2-01, because 410 is returned.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** revert the ternary chain. Clients that already learned 409 fall back to their default branch (`client.dart:135` "Could not redeem invite (code)") — degraded copy, not a crash.
- **Unresolved:** does 409 leak that "this email already has an account here"? It does — it is an account-existence oracle on an unthrottled endpoint. It is only defensible once PP-S2-14 lands. Reviewer must decide whether 409 ships before or after the rate limit.
- **Safe to apply later because:** the mapping is a pure function of a reason string that no client currently receives, so applying it early changes no observable response and applying it late only degrades copy.

---

### PP-S2-04 — Make the guard test `passwordHash IS NOT NULL`, not row existence

**Target** `apps/api/src/routes/public/invites.ts` :121-133 (guard added by PP-S2-01) · also corrects the source pattern at `apps/api/src/routes/public/driver.ts` :1068, :1089 · **Pkg** A01, A02 · **Scen** 1, 4 · **Risk** Medium · **Apply when** applied together with PP-S2-01 — this is a correction to that patch, not a follow-on.

The pattern being ported from `driver.ts` selects `credentials: { select: { userId: true } }` (`:1068`) and tests `row.user.credentials !== null` (`:1089`) — row existence. `clearUserPasswordHash` (`domains/identity/repositories/users.ts:381-386`) nulls the column and leaves the row, so a user whose password was deliberately cleared by an admin reads as "already claimed" and can never be re-onboarded by invite. Testing the column instead makes the guard mean what it says.

```diff
-        user: { select: { credentials: { select: { userId: true } } } },
+        user: { select: { credentials: { select: { passwordHash: true } } } },
@@
-    if (row.user.credentials !== null) {
+    // Row-existence is the wrong test: clearUserPasswordHash
+    // (domains/identity/repositories/users.ts:381-386) leaves the row and
+    // nulls the column, and that user must remain re-onboardable.
+    if (row.user.credentials?.passwordHash != null) {
       return { ok: false as const, reason: "already_claimed" as const };
     }
```

- **Tests to add:** `T-S2-1b` "user with a credential row whose `passwordHash` is NULL consumes successfully". FAILS under a naive port of the `driver.ts` guard; passes under this one. There is no test covering this on `driver.ts` today either — the same test should be added there.
- **Migration impact:** none — pure TypeScript. But it forces PP-S2-02's `create` to become `upsert`-shaped for exactly this case, or to P2002. Recommended resolution: keep `create`, and have the guard's *pass* path first `deleteMany` the null-hash row inside the same tx. That keeps the file free of `upsert` (PP-S2-15) at the cost of one extra statement.
- **Rollback:** revert to `userId` selection. Lost: admin-cleared users become permanently un-invitable again, silently. No data loss.
- **Unresolved:** is `clearUserPasswordHash` actually called by anything reachable? A caller search is needed — if it is dead, this proposal is a correctness nicety rather than a live gap, and the simpler row-existence guard is defensible. Unverified in this pass.
- **Safe to apply later because:** it only widens the set of requests that succeed, and only for users with a NULL hash — it cannot make a previously-refused overwrite succeed, since a non-null hash still refuses under both versions.

---

### PP-S2-05 — Hoist `hashPassword` out of the transaction

**Target** `apps/api/src/routes/public/invites.ts` :92-99, :141 · **Pkg** A01, A09 · **Scen** 7, 8 · **Risk** Low · **Apply when** any time — independent of every other proposal here.

`hashPassword` runs PBKDF2 at 100 000 iterations (`apps/api/src/lib/password.ts`, `DEFAULT_ITERATIONS`) and is currently called at `:141`, *inside* the open transaction, between the claim and the credential write. That holds a row lock on `user_tokens` across a deliberately-slow CPU operation, which is exactly the window the concurrency test (`T-S2-4`) probes. `driver.ts:1049` already hashes before `prisma.$transaction` at `:1051`; this makes the two paths match.

```diff
   const { token, password } = parsed.data;
   const tokenHash = await sha256Hex(token);
+  // Hash before the tx opens. PBKDF2 at 100k iterations is deliberately
+  // slow; doing it inside the tx holds the user_tokens row lock across it.
+  // Same ordering as routes/public/driver.ts:1048-1051.
+  const passwordHash = await hashPassword(password);
   const db = makePrisma(c.env);
@@
-    const passwordHash = await hashPassword(password);
     await tx.userCredential.create({
       data: { userId: row.userId, passwordHash },
     });
```

- **Tests to add:** `T-S2-4` "two concurrent consumes of one token: exactly one 200, one 410 `already_used`". It passes today by luck of the CAS; this change makes it pass by design. No test FAILS today because of this — it is a latency and lock-duration fix, not a correctness fix.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** move the call back inside. Lost: nothing functional; the lock window returns.
- **Unresolved:** hashing before the token is validated means an attacker can spend server CPU with a garbage token and any password. That is only bounded by PP-S2-14's rate limit. Reviewer must confirm the ordering of those two.
- **Safe to apply later because:** identical inputs, identical output value, identical write — the only difference is when the CPU is spent. Pure motion.

---

### PP-S2-06 — Correct `malformed_metadata` in both handlers, for two different reasons

**Target** `apps/api/src/routes/public/invites.ts` :68-70 (peek) and :124-126 + :179-181 (consume) · **Pkg** A13 · **Scen** 16 · **Risk** Low · **Apply when** any time; independent.

18D's note "malformed 400 [was 500]" is correct **only of peek**. Peek returns 500 at `:69`, which pages an on-call for what is a data-shape fault in a token minted by `repositories/invites.ts`. Consume returns **410** — the status map at `:180` has no branch for it — which tells the recipient "this invite is gone" when in fact the invite is intact and the metadata is wrong. Both should be 400, and the on-call signal should come from a log line, not from the status code.

```diff
   const email = typeof meta.email === "string" ? meta.email : null;
   if (!orgId || !role || !email) {
-    return c.json({ error: "malformed_metadata" }, 500);
+    // Not a server fault at request time: the token was minted with bad
+    // metadata. 400 to the caller, log line for the operator.
+    console.warn("[invites] malformed token metadata on peek");
+    return c.json({ error: "malformed_metadata" }, 400);
   }
```

- **Tests to add:** `T-S2-6` "peek on a token whose metadata lacks `role` → 400" and `T-S2-6b` "consume on a token whose metadata lacks `orgId` → 400". `T-S2-6` FAILS today with 500; `T-S2-6b` FAILS today with 410. The consume half also needs PP-S2-03's map branch.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** restore both literals. Lost: nothing; the mobile client already renders `malformed_metadata` from the body, not the status (`client.dart:132-133`), so its copy is unaffected either way.
- **Unresolved:** none. But note the two changes are not symmetric — reviewers reading 18D will expect one change and find two.
- **Safe to apply later because:** status-only, on a branch reached solely by data that should never exist. No client currently branches on the status for this error.

---

### PP-S2-07 — Add `bearer` to the `ActorKind` enum

**Target** `prisma/schema/platform.prisma` :119-126 · `packages/shared/src/db/platform.ts` :29 · new file `prisma/migrations/<ts>_actor_kind_bearer/migration.sql` · **Pkg** A04, N02 · **Scen** 6 · **Risk** Medium · **Apply when** the two migrations already pending against staging (`20260807003000_drop_issues_scaffold`, `20260807120000_drop_never_used_tables`, per `.github/workflows/check.yml`) are reconciled — otherwise `prisma migrate status` blocks this one.

18A A04 scopes "audit refused consume with `actorKind:"bearer"`" as "New audit branch". It is not: `ActorKind` has exactly four values today — `user`, `system`, `vendor_webhook`, `ocpp_worker` — declared in `prisma/schema/platform.prisma:119-126` and mirrored in Drizzle at `packages/shared/src/db/platform.ts:29`. Writing `actorKind: "bearer"` fails to typecheck against the generated enum and would fail the insert. This is a schema change, and it must land before PP-S2-08.

```diff
 enum ActorKind {
   user
   system
   vendor_webhook
   ocpp_worker
+  // A request authorised only by possession of a token, with no proven
+  // identity behind it. Used when a bearer-authorised action is REFUSED —
+  // the invitee must never be recorded as the actor of an act they did
+  // not perform (invites.ts refusal audit).
+  bearer
 
   @@schema("audit")
 }
```

```diff
--- packages/shared/src/db/platform.ts
-export const actorKindEnum = auditSchema.enum("ActorKind", ["user", "system", "vendor_webhook", "ocpp_worker"]);
+export const actorKindEnum = auditSchema.enum("ActorKind", ["user", "system", "vendor_webhook", "ocpp_worker", "bearer"]);
```

Migration SQL (new file, pseudodiff — exact filename is timestamp-generated):

```diff
+-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in
+-- Postgres < 12 semantics under Prisma's wrapper; IF NOT EXISTS makes it
+-- re-runnable against the branch where it was applied by hand.
+ALTER TYPE "audit"."ActorKind" ADD VALUE IF NOT EXISTS 'bearer';
```

- **Tests to add:** `T-SCHEMA-1` "Drizzle `actorKindEnum` values equal the Prisma enum values" — this belongs in `scripts/check-schema-consistency.mjs`, which already runs in `check-all.mjs` and is the only gate that would catch the two declarations drifting. No existing test covers `ActorKind` at all (`apps/api/src/lib/audit.ts` has no test file).
- **Migration impact:** real. One `ALTER TYPE ADD VALUE` on `audit.ActorKind`. Additive and non-blocking; existing rows are untouched. `apps/api/prisma/schema/` is a **generated copy** (`scripts/sync-api-prisma-schema.mjs`) — regenerate it in the same commit or `check:api-schema` goes red.
- **Rollback:** `ALTER TYPE ... DROP VALUE` does not exist in Postgres. Rolling this back means recreating the type and rewriting `audit.actions.actor_kind` — effectively unrollbackable once any row uses it. Treat as one-way.
- **Unresolved:** is `bearer` the right name, or should it be the broader `anonymous` / `unauthenticated` that Group N will also want for other refusals? Adding an enum value is one-way, so the name should be chosen for Group N, not for this one route. **This is the single question that most needs answering before S2 is applied.**
- **Safe to apply later because:** it is additive at the type level and nothing reads it until PP-S2-08 writes it — the enum can sit unused indefinitely. The *fallback* if it is deferred is PP-S2-08's `system` variant, which needs no migration.

---

### PP-S2-08 — Audit the refused consume with a non-invitee actor

**Target** `apps/api/src/routes/public/invites.ts` :161-182 · **Pkg** A04 · **Scen** 5, 6 · **Risk** Medium · **Apply when** PP-S2-07 has landed *or* the `system` fallback below is chosen — do not ship `actorKind: "bearer"` against the current enum.

Today a refusal writes nothing at all: `recordAuditAction` is only called on the success path (`:161-169`), and it names the invitee as `actorUserId` with `actorKind: "user"`. An attempted takeover of anna's account currently leaves no trace, and if the existing call were simply reused for refusals it would record anna as having performed the attempt — actor laundering. The refusal audit must name the org, the token, and explicitly *not* a user.

```diff
     if (!orgId || !email) {
       return { ok: false as const, reason: "malformed_metadata" as const };
     }
 
+    if (row.user.credentials?.passwordHash != null) {
+      // Audit inside the tx, on the refusal path. actorUserId is null on
+      // purpose: nobody proved they are this user, and recording them as
+      // the actor would launder the attempt into their own history.
+      await recordAuditAction(tx, {
+        orgId,
+        actorUserId: null,
+        actorKind: "bearer",
+        action: "invite.consume_refused",
+        targetType: "user_token",
+        targetId: row.id,
+        metadata: { reason: "already_claimed", invitedUserId: row.userId },
+      });
+      return { ok: false as const, reason: "already_claimed" as const };
+    }
```

`recordAuditAction` accepts a Prisma transaction handle — `AuditPrismaDb` includes `Prisma.TransactionClient` (`apps/api/src/lib/audit.ts:39-41`), and `isDrizzle` (`:54-56`) routes it to the Prisma branch — so this composes with the existing `db.$transaction` without a second client.

- **Tests to add:** `T-S2-3` "refused consume writes one `audit.actions` row for the org with `actorUserId = null`"; `T-AUD-1` "no `audit.actions` row anywhere names the invitee as actor of a refused consume". Both FAIL today — zero rows are written on any refusal path.
- **Migration impact:** depends on PP-S2-07. With it: none beyond that enum. Without it: substitute `actorKind: "system"` and keep `actorUserId: null` — the "actor is not anna" property (scenario 5) holds either way; only scenario 6's literal `bearer` fails. That is the recommended de-risked first cut.
- **Rollback:** delete the `recordAuditAction` block. Rows already written stay and remain readable — `audit.actions` has no retention policy today (A04 area findings). Nothing is lost except future visibility.
- **Unresolved:** the refusal returns from inside `db.$transaction` — does the returned `{ok:false}` cause Prisma to commit or roll back? It commits (no throw), so the audit row persists. Confirm this against the parity harness before relying on it; if a reviewer prefers an explicit rollback on refusal, the audit write must move outside the tx.
- **Safe to apply later because:** it is a write-only side effect on a path that already returns a refusal — no response shape, status, or state change depends on it. Adding it later backfills nothing but costs nothing.

---

### PP-S2-09 — Keep `ConsumeBody` non-strict; add a shadow strict parse that only counts

**Target** `apps/api/src/routes/public/invites.ts` :36-39, :86-92 · **Pkg** A10 · **Scen** 13, 19-21, 23 · **Risk** High · **Apply when** the client-version telemetry of PP-S2-11 has been collecting for at least one release cycle — flipping strict without it is a blind break.

`ConsumeBody` is a plain `z.object` with no `.strict()`, while its sibling `RegisterBody` at `routes/public/register.ts:41-56` *is* `.strict()`. The mobile app posts a third field, `kennitala` (`apps/mobile/lib/api/client.dart:99-107`), which the server silently drops. Making the schema strict as 18A A10 asks would **400 every shipped mobile redemption** — that is scenario 23's "failing by design", except it lands on installed clients, not archived ones. This proposal keeps the door open and instruments it, so the flip becomes a measured decision rather than a guess.

```diff
 const ConsumeBody = z.object({
   token: z.string().min(8).max(256),
   password: z.string().min(8).max(128),
 });
+
+// Deliberately NOT the schema we validate against — see 19D PP-S2-09.
+// apps/mobile/lib/api/client.dart:99-107 posts a third field, `kennitala`,
+// which this route has always dropped. Flipping ConsumeBody to .strict()
+// would 400 every shipped mobile redemption. We measure first: parse with
+// the strict shape, log the mismatch, serve the request anyway.
+const ConsumeBodyStrict = ConsumeBody.strict();
@@
   const parsed = ConsumeBody.safeParse(raw);
   if (!parsed.success) {
     return c.json({ error: "validation", issues: parsed.error.issues }, 400);
   }
+  if (!ConsumeBodyStrict.safeParse(raw).success) {
+    const extras = Object.keys((raw ?? {}) as Record<string, unknown>)
+      .filter((k) => k !== "token" && k !== "password")
+      .sort();
+    console.warn(
+      `[invites] consume with unknown fields: ${extras.join(",")} client=${
+        c.req.header("x-straumvakt-client") ?? "unknown"
+      }`,
+    );
+  }
```

- **Tests to add:** `T-SEC-3a` "body `{token, password, kennitala}` still returns 200 and the extra field is not persisted"; `T-COMPAT-1` "the archived web form's `{token, password}` body (`archive/straumvakt-org-console-2026-08-08/app/invite/[token]/accept-form.tsx:49-52`) still returns 200". Both pass today — they are the anti-regression anchors for the eventual strict flip. Scenario 13's "strict → 400" test must be written but **skipped/pending** until the flip.
- **Migration impact:** none — pure TypeScript. No key name is ever logged with its value; only the key names.
- **Rollback:** delete the shadow parse. Lost: the measurement that makes the strict flip decidable. No behaviour changes.
- **Unresolved:** does anything besides `client.dart` post to this endpoint? Nothing in this repo does — the only two callers found are the mobile client and an **archived** Next.js form; the web app has no `src/app/api` and no live `/invite/[token]` route. If an out-of-repo integration exists, it is unverified.
- **Safe to apply later because:** the shadow parse is observation-only — its result is never used to reject. It can be added, removed, or re-added at will with zero contract impact.

---

### PP-S2-10 — Resolve kennitala as drop-and-document, not verify

**Target** `apps/api/src/routes/public/invites.ts` :36-39 (documentation) · `apps/mobile/lib/api/client.dart` :93-107 · **Pkg** A11, A12 · **Scen** 13-15 · **Risk** Medium · **Apply when** product has recorded the decision — this proposal is the recommendation and its evidence, not the decision itself.

18A A11 offers "verify or drop". Verify is not implementable on this path: `User.kennitala` is nullable (`prisma/schema/identity.prisma:25`), and `repositories/invites.ts:99-105` creates the invited User with `{ email, audience: "operator", status: "active" }` and **no kennitala**. Every user reachable through an org invite therefore has `kennitala = NULL`, so a comparison would either fail for all of them or be skipped for all of them. Drop is the only behaviour that is one behaviour. The mobile side should stop sending it and the server comment should say why.

```diff
--- apps/mobile/lib/api/client.dart
   Future<ConsumeInviteResult> consumeInvite({
     required String token,
-    required String kennitala,
     required String password,
   }) async {
     final res = await http.post(
       Uri.parse('$baseUrl/api/public/invites/consume'),
       headers: {'content-type': 'application/json'},
       body: jsonEncode({
         'token': token,
-        'kennitala': kennitala,
         'password': password,
       }),
     );
```

```diff
--- apps/api/src/routes/public/invites.ts
 const ConsumeBody = z.object({
   token: z.string().min(8).max(256),
   password: z.string().min(8).max(128),
 });
+// kennitala is NOT accepted here, deliberately. Users minted by
+// repositories/invites.ts:99-105 have kennitala = NULL, so there is
+// nothing to compare against — a "verify" branch would be skipped for
+// every real invitee. Collection happens at registration
+// (routes/public/register.ts:45), which requires it and is .strict().
```

- **Tests to add:** `T-SEC-3b` — rename the mobile contract test that asserts "serializes identity" (18A A12) and have it assert the real two-field shape. Note that `apps/mobile/test/api/client_contract_test.dart` **does not exist on this branch**, so A12 is a new-file task, not a rename.
- **Migration impact:** none — pure TypeScript and Dart. No column is added or dropped.
- **Rollback:** restore the Dart parameter. Because the server has always ignored the field, both versions of the app work against both versions of the server — this is the one change in this part with no compatibility edge at all.
- **Unresolved:** the mobile redeem screen (`apps/mobile/lib/screens/redeem_invite.dart:88`) collects and digit-normalises kennitala for the user before calling. Dropping the field means removing a form field drivers are used to seeing, or keeping it as dead UI. Product decision, not a code one.
- **Safe to apply later because:** the server already ignores the field, so client and server can be changed in either order, in any release, without a coordinated deploy.

---

### PP-S2-11 — Require and log a client-version header on consume

**Target** `apps/api/src/routes/public/invites.ts` :86-99 (new logging) · `apps/mobile/lib/api/client.dart` :96-99 · **Pkg** B13, A12 · **Scen** 24, 27-30 · **Risk** Low · **Apply when** any time — additive on both sides.

Scenarios 27-30 gate the retirement of `invites/consume` on "legacy calls counted per client version" and "legacy < 1% for 14 days". No such measurement is possible today: a repo-wide search for `x-client-version` / `clientVersion` finds nothing, and only two routes read `user-agent` at all (`routes/internal/ocpp-auth.ts:107`, `routes/internal/pending-discovery.ts:78`). Without this, the B13 retirement gate is unmeasurable and will be argued rather than decided.

```diff
--- apps/mobile/lib/api/client.dart
     final res = await http.post(
       Uri.parse('$baseUrl/api/public/invites/consume'),
-      headers: {'content-type': 'application/json'},
+      headers: {
+        'content-type': 'application/json',
+        // Read by the API to count legacy consume calls per version — the
+        // B13 retirement gate. Version string only; no device identifier.
+        'x-straumvakt-client': clientVersion,
+      },
```

```diff
--- apps/api/src/routes/public/invites.ts
 publicInvites.post("/consume", async (c) => {
+  // One structured line per consume, whatever the outcome. This is the
+  // only source of data for the B13 retirement gate (scenarios 27-30).
+  console.log(
+    `[invites] consume client=${c.req.header("x-straumvakt-client") ?? "unknown"}`,
+  );
   const raw = (await c.req.json().catch(() => null)) as unknown;
```

- **Tests to add:** `T-COMPAT-4` "a request with no `x-straumvakt-client` header still returns 200" — the header must never be required, or it becomes the break it exists to prevent. Passes today trivially; it is the guard against someone later making it mandatory.
- **Migration impact:** none — pure TypeScript and Dart.
- **Rollback:** remove the log line and the header. Lost: the retirement gate's only input. Counts already emitted stay in the Worker log stream, which has no retention policy anyone has stated — treat historical counts as unavailable after rollback.
- **Unresolved:** there is no metrics store and no dashboard — observability in this codebase is `console.log` inside the Worker (A04 area findings). "Legacy < 1% for 14 days" therefore requires someone to actually query the log sink, and no such query exists. The gate is measurable in principle and unautomated in fact.
- **Safe to apply later because:** the header is optional on both sides and the log line has no consumers — nothing branches on either. The only cost of deferral is that the 14-day clock starts later.

---

### PP-S2-12 — Refuse to let consume double as a password reset, and point the 409 at the real one

**Target** `apps/api/src/routes/public/invites.ts` :1-24 (header), :179-188 · compare `apps/api/src/repositories/registration.ts` :607-660 · **Pkg** A01, A07 · **Scen** 1, 3 · **Risk** Medium · **Apply when** PP-S2-03 has added the 409, and the reset route's link target is confirmed reachable.

There is a live temptation to "fix" PP-S2-01 by declaring consume a legitimate password-reset for an existing user. It is not, and the contrast is instructive: `confirmPasswordReset` (`registration.ts:607`) *also* claims-then-upserts (`:640-652`), and its `upsert` is defensible because its token was minted only after `initiatePasswordReset` (`:553`) proved control of the mailbox for that specific user and sent the link *there*. An invite token is minted by an org admin for someone else and delivered to an address the admin typed. The two have different provenance and must have different powers. The right answer for a 409 is a signpost to the reset flow.

```diff
   if (!result.ok) {
     const status = ...;
-    return c.json({ error: result.reason }, status);
+    if (result.reason === "already_claimed") {
+      // Not a reset. An invite token proves an admin typed an address; a
+      // password_reset token proves control of the mailbox
+      // (registration.ts:553-598). Only the latter may rotate a password —
+      // which is why confirmPasswordReset's upsert at :647 is legitimate
+      // and this route's was not.
+      return c.json(
+        { error: "already_claimed", nextStep: "sign_in_or_reset" },
+        409,
+      );
+    }
+    return c.json({ error: result.reason }, status);
   }
```

- **Tests to add:** `T-S2-1c` "409 body carries `nextStep: 'sign_in_or_reset'`". FAILS today (no 409 exists). Also `T-RESET-1` "`POST /api/public/password-reset/confirm/:token` on a user with an existing password still succeeds" — proving the reset path is deliberately left alone by S2 and remains the only rotation route.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** drop the branch; the plain 409 from PP-S2-03 remains. Lost: the client's ability to route the user somewhere useful.
- **Unresolved:** `initiatePasswordReset` links to `${baseUrl}/password-reset/${plaintext}` (`registration.ts:588`) and **no such route exists** — `src/app` on this branch contains only `home`, `org/[slug]`, `staff/overview`. Signposting users to a reset flow whose landing page 404s is worse than not signposting. This proposal is blocked on that page existing, or on the mobile app handling the reset in-app.
- **Safe to apply later because:** it only enriches a response body on a path that already refuses; clients that do not know `nextStep` ignore it. Purely additive to the contract.

---

### PP-S2-13 — Notify the invited mailbox when a consume is refused as `already_claimed`

**Target** `apps/api/src/routes/public/invites.ts` :179-188 (after the tx) · new file `apps/api/src/lib/email-templates/invite-takeover-attempt.ts` · **Pkg** A05, A04 · **Scen** 5, 17 · **Risk** Medium · **Apply when** PP-S2-08's audit write is in place — the email should never be the only record.

A refused consume means someone with a valid invite link tried to set a password on an account that already has one. The account holder learns nothing today. `sendEmail` already exists (`apps/api/src/lib/email.ts`) and fails open with a warn, and three templates already live in `apps/api/src/lib/email-templates/` (`invite.ts`, `password-reset.ts`, `verify-email.ts`), so this is a fourth of the same shape. The send must be **outside** the transaction — an email round-trip inside an open tx is the same mistake as PP-S2-05's hash.

```diff
   if (!result.ok) {
+    if (result.reason === "already_claimed" && result.notifyEmail) {
+      // Outside the tx on purpose: a 50-800ms Resend round-trip must not
+      // hold a row lock. sendEmail fails open with a warn, so a dead
+      // provider degrades this to the audit row written above.
+      const content = renderInviteTakeoverAttemptEmail({
+        displayName: result.notifyDisplayName,
+        orgDisplayName: result.notifyOrgName,
+      });
+      await sendEmail(c.env, {
+        to: result.notifyEmail,
+        subject: content.subject,
+        html: content.html,
+        text: content.text,
+        tags: [{ name: "category", value: "invite_takeover_attempt" }],
+      });
+    }
     const status = ...;
```

- **Tests to add:** `T-OBS-1` "refused consume enqueues exactly one email to the invited address and none to any other"; `T-OBS-1b` "a refusal with the email provider down still returns 409 and still writes the audit row" — the fail-open property. Both FAIL today; neither the email nor the audit row exists.
- **Migration impact:** none — pure TypeScript, one new template module. No email send writes an audit row anywhere in this codebase today (A04 area findings), so the audit row from PP-S2-08 is the durable record and this is the notification.
- **Rollback:** delete the block and the template. Lost: the account holder's only signal. The audit row survives, so an operator can still reconstruct the event.
- **Unresolved:** does notifying create its own abuse channel — a bearer holding a stale invite can send mail to the invitee at will? Yes. It needs the rate limit of PP-S2-14 and probably a per-token once-only suppression (the token id is available at `row.id`). Neither is specified here.
- **Safe to apply later because:** it is a side effect on a path that already refuses, gated on a result field that is `undefined` until this patch sets it — so the block is inert if half-applied.

---

### PP-S2-14 — Rate-limit consume and peek, and fail closed on this route

**Target** `apps/api/src/routes/public/invites.ts` :34, :41, :86 · uses `apps/api/src/lib/rate-limit.ts` :119-129 · **Pkg** A01, A05 · **Scen** 11, 12 · **Risk** Medium · **Apply when** the `PUBLIC_INVITE_RATE_LIMITER` binding is declared in `apps/api/wrangler.jsonc` for every environment — otherwise the fail-closed variant 503s the route on deploy.

`publicInvites` registers **no middleware at all**: neither `GET /peek` nor `POST /consume` is rate-limited, while every sibling public onboarding route is (`register.ts:78`, `password-reset.ts:66,:96`, `driver.ts:1031-1036`). Scenarios 11 and 12's "unknown token → 404" is therefore an unthrottled token-guessing oracle, and after PP-S2-03 it becomes an unthrottled account-existence oracle too. Compounding it, `rateLimit` **fails open** with a `console.warn` when the binding is absent (`rate-limit.ts:121-129`), so "we added a rate limit" is not the same as "there is a rate limit".

```diff
-publicInvites.get("/peek", async (c) => {
+publicInvites.get(
+  "/peek",
+  rateLimit({
+    keyBy: "ip",
+    limit: 20,
+    windowSec: 60,
+    bindingName: "PUBLIC_INVITE_RATE_LIMITER",
+  }),
+  async (c) => {
@@
-publicInvites.post("/consume", async (c) => {
+publicInvites.post(
+  "/consume",
+  rateLimit({
+    keyBy: "ip",
+    limit: 10,
+    windowSec: 60,
+    bindingName: "PUBLIC_INVITE_RATE_LIMITER",
+  }),
+  async (c) => {
```

Fail-closed, as a separate opt-in rather than a change to shared middleware (pseudodiff — `RateLimitOptions` must gain the field):

```diff
--- apps/api/src/lib/rate-limit.ts
     if (!binding || typeof (binding as RateLimitBinding).limit !== "function") {
       console.warn(
         `[rate-limit] binding ${String(opts.bindingName)} missing or malformed — failing open`,
       );
+      // Opt-in per route. Default stays fail-open so dev is unaffected and
+      // no existing caller changes behaviour.
+      if (opts.failClosed) {
+        return c.json({ error: "unavailable" }, 503);
+      }
       return next();
     }
```

- **Tests to add:** `T-RL-1` "consume with no binding and `failClosed` returns 503, not 200"; `T-RL-2` "every other `rateLimit` caller still fails open with the binding absent" — the blast-radius test, which must pass unchanged for `register.ts:78`, `password-reset.ts:66`, `password-reset.ts:96` and `driver.ts:1031`. `T-RL-1` FAILS today; the option does not exist.
- **Migration impact:** none in schema. Real in **deploy config**: a new binding in `apps/api/wrangler.jsonc` for dev, staging and prod. Missing it in any one environment plus `failClosed` takes invite redemption down there.
- **Rollback:** remove the middleware from both routes. Lost: throttling. The `failClosed` option can be rolled back independently by removing the flag from the two call sites while leaving the middleware change in place — it is inert without a caller.
- **Unresolved:** should `peek` and `consume` share a bucket with the other onboarding routes (`ADMIN_LOGIN_RATE_LIMITER`, which all three siblings share) or get their own? Sharing means an invite-guessing flood also locks out logins from that IP. Separate bucket recommended; unverified whether the Cloudflare account's binding budget allows another.
- **Safe to apply later because:** middleware placement is additive and reversible per route, and `failClosed` defaults off — a half-applied version of this patch throttles nothing and breaks nothing.

---

### PP-S2-15 — Add a build-failing static guard against `userCredential.upsert` in public routes

**Target** **new file** `scripts/check-no-credential-upsert.mjs` · wired into `scripts/check-all.mjs` :14-36 and `package.json` :23-41 · **Pkg** A02, A05 · **Scen** 18 · **Risk** Low · **Apply when** PP-S2-02 has landed — the guard fails on `main` until the `upsert` at `invites.ts:142` is gone.

Scenario 18 asks that a reintroduced `upsert` be flagged in review. Review is not a mechanism; `check-all.mjs` is. There are exactly four credential writers in the tree — `invites.ts:142` (the defect), `driver.ts:1096` (`create`, correct), `registration.ts:182` (`create`) and `registration.ts:647` (`upsert`, **legitimate** — mailbox-proven reset), plus the Drizzle `setUserPasswordHash` at `domains/identity/repositories/users.ts:368-377` (admin reset). So the guard must be path-scoped, not global, or it fails on two correct call sites.

```diff
--- scripts/check-no-credential-upsert.mjs (new file)
+#!/usr/bin/env node
+//
+// A bearer-authorised route must never be able to rotate an existing
+// password. `userCredential.upsert` is the primitive that lets it; this
+// forbids it under routes/public/ only.
+//
+// NOT global, deliberately. Two upserts in this tree are correct:
+//   repositories/registration.ts:647 — password_reset token, mailbox-proven
+//   domains/identity/repositories/users.ts:374 — admin reset, session-proven
+// Both are reached only after an identity is established. Routes under
+// routes/public/ are reached by possession of a token alone.
+import fs from "node:fs";
+import path from "node:path";
+
+const DIR = path.resolve(import.meta.dirname, "../apps/api/src/routes/public");
+const BANNED = /userCredential\s*\.\s*upsert|onConflictDoUpdate/;
+const bad = [];
+for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"))) {
+  const src = fs.readFileSync(path.join(DIR, f), "utf8");
+  src.split("\n").forEach((line, i) => {
+    if (BANNED.test(line)) bad.push(`${f}:${i + 1}  ${line.trim()}`);
+  });
+}
+if (bad.length) {
+  console.error("credential upsert in a bearer-authorised route:\n  " + bad.join("\n  "));
+  process.exit(1);
+}
+console.log("no credential upsert under routes/public");
```

```diff
--- scripts/check-all.mjs
   ["unused-exports", "npm run check:unused-exports"],
+  // 19D PP-S2-15. Forbids the password-overwrite primitive in
+  // bearer-authorised routes. Offline, no DB.
+  ["no-credential-upsert", "npm run check:no-credential-upsert"],
```

- **Tests to add:** `T-GUARD-1` "the guard exits non-zero when `userCredential.upsert` is present in a `routes/public/` file" — run it against a temp fixture, in the style of the existing `scripts/check-schema-consistency.test.mjs`. FAILS today because the script does not exist; and the script itself FAILS today against the real tree, which is the point.
- **Migration impact:** none — pure JavaScript, offline, no DB. It is the only S2 change that runs in CI: `.github/workflows/check.yml` runs `npm run check`, which is `check-all.mjs`, which runs nine offline checks and no vitest. Nothing else in this part is gated by CI at all.
- **Rollback:** remove the entry from `CHECKS`. Lost: the mechanism. Note `check-all.mjs` runs every check and reports all failures rather than short-circuiting, so adding this cannot mask another check the way a `&&` chain would.
- **Unresolved:** should `onConflictDoUpdate` be banned too? It is the Drizzle equivalent and is the primitive `setUserPasswordHash` uses. No `routes/public/` file is on Drizzle yet, so the pattern is currently unreachable there — banning it now is free and forward-looking, but it will surprise whoever ports these routes.
- **Safe to apply later because:** it is a check, not a behaviour — the shipped Worker is byte-identical with or without it. Deferring costs only the guarantee that PP-S2-02 stays applied.

---

### PP-S2-16 — Add the S2 parity suite as a new test file

**Target** **new file** `apps/api/test/parity/invites-consume-hardening.test.ts` · harness `apps/api/test/parity/_harness.ts` · config `apps/api/vitest.parity.config.ts` · **Pkg** A08, A09, P01 · **Scen** 1-12 · **Risk** Low · **Apply when** a `PARITY_DATABASE_URL` pointing at the Neon **test** branch is available to the runner — the suite `describe.skipIf(!hasDb)`s itself otherwise.

Nothing unit-tests `invites.ts`. The only coverage is one case inside `driver-invite-redemption-parity.test.ts:620-668`, which asserts the current 200 path and would keep passing through every defect above. T-S2-1..6 need their own file, and `T-S2-5` — "a refusal leaves the invite usable" — must be permanent, because it is the ADR 0053 deadlock this whole part risks recreating.

```diff
--- apps/api/test/parity/invites-consume-hardening.test.ts (new file)
+// T-S2-1..6. Route-level, against the Neon TEST branch.
+//
+// The route mints its own Prisma client from c.env, so these drive real
+// HTTP through publicInvites.fetch — the pattern already used by
+// callConsumeOrgInvite in driver-invite-redemption-parity.test.ts:116-123.
+
+async function callConsume(body: unknown) {
+  const req = new Request("http://test/consume", {
+    method: "POST",
+    headers: { "content-type": "application/json" },
+    body: JSON.stringify(body),
+  });
+  return publicInvites.fetch(req, testEnv());
+}
+
+it("T-S2-1: refuses with 409 and leaves the stored hash byte-identical", async () => {
+  const { userId, token } = await mintInviteForUserWithPassword();
+  const before = await getStoredHash(userId);
+  const res = await callConsume({ token, password: "<redacted>" });
+  expect(res.status).toBe(409);
+  expect(await getStoredHash(userId)).toBe(before);   // string compare, not re-hash
+});
+
+it("T-S2-5: a refused consume does not burn the invite", async () => {
+  const { tokenId, token } = await mintInviteForUserWithPassword();
+  await callConsume({ token, password: "<redacted>" });
+  const row = await getApiPrisma().userToken.findUniqueOrThrow({
+    where: { id: tokenId }, select: { usedAt: true },
+  });
+  expect(row.usedAt).toBeNull();
+});
```

- **Tests to add:** this **is** the test proposal — T-S2-1 (409 + identical hash), T-S2-2 (create once), T-S2-3 (refusal audited, actor not the invitee), T-S2-4 (concurrent consume, one winner), T-S2-5 (no burn), T-S2-6 (malformed → 400). T-S2-1, -3, -5 and -6 FAIL today. T-S2-2 and -4 pass today and are anchors.
- **Migration impact:** none. Fixtures use `driver-anna@example.test` / `staff-carol@example.test` / `org_alpha` and the literal `"<redacted>"` for every password — nothing real, ever. The existing parity fixtures use `@example.invalid`; match whichever the harness enforces.
- **Rollback:** delete the file. Lost: all six assertions. Nothing else depends on it.
- **Unresolved:** **no test suite runs in CI.** `.github/workflows/check.yml` has three steps (`npm install`, `npm run db:generate`, `npm run check`) and `check-all.mjs` runs nine offline checks, none of them vitest. `test:parity` exists (`apps/api/package.json:12`) but nothing invokes it, and it needs a DB credential the repo deliberately does not hold. Writing this file does not make it run — 18A P01 ("S2 suite in CI, offline") is unsatisfiable as written, because these six tests all need a database.
- **Safe to apply later because:** a test file that nothing invokes changes no runtime behaviour and cannot break a deploy. The cost of deferral is that PP-S2-01's property is asserted by nobody.

---

### PP-S2-17 — Define a rollback path that cannot lose a password

**Target** `apps/api/src/routes/public/invites.ts` (whole handler) · **Pkg** A01, A02, A05 · **Scen** 3 · **Risk** High · **Apply when** before any of PP-S2-01/02/07 is deployed — this is the sequencing constraint, and it must be agreed first.

The rollback risk in this change set is asymmetric and worth stating plainly: **the code changes are reversible and the enum change is not**, and reverting the guard while `create` stays in place converts a silent overwrite into a P2002 that rolls the whole transaction back — which is *safe*, but 500s the invitee. Reverting `create` while the guard stays is also safe. Reverting *both* restores the overwrite. So the two must be reverted together or not at all, and the enum must never be reverted.

```diff
   // Returns the resolved email so the recipient page can redirect to
   // /login?email=<...> with the email pre-filled.
+//
+// ── S2 REVERT ORDER (19D PP-S2-17) ──────────────────────────────────
+// PP-S2-01 (guard) and PP-S2-02 (create) revert TOGETHER or not at all.
+//   guard alone reverted  -> P2002, tx rolls back, invitee sees 500. Safe,
+//                            ugly. Acceptable as an emergency stop.
+//   create alone reverted -> guard still refuses. Safe. No reason to.
+//   both reverted         -> the overwrite is live again. Requires the
+//                            same sign-off as shipping it did.
+// PP-S2-07 (ActorKind 'bearer') is NOT revertible: Postgres has no
+// ALTER TYPE ... DROP VALUE. If the audit branch is rolled back, leave
+// the enum value in place, unused.
+// No password is lost in any of these paths: nothing in S2 writes,
+// clears or rotates an existing password_hash. The failure mode of a
+// bad rollback is a refused or 500'd redemption, never a lost account.
```

- **Tests to add:** `T-ROLL-1` "with the guard stubbed out and `create` in place, a consume for a user with an existing password returns non-2xx and the stored hash is unchanged" — proves the P2002 path does not overwrite. FAILS today; today that request succeeds and overwrites.
- **Migration impact:** none for the comment. The constraint it documents is that PP-S2-07's migration is one-way; that is the only irreversible element of S2.
- **Rollback:** the comment itself is a comment. The point is that the *other* rollbacks are now ordered rather than improvised.
- **Unresolved:** is an emergency stop that 500s acceptable to whoever is on call, or does the emergency stop need to be a feature flag reading an env var so the guard can be disabled without a deploy? A flag is more operable and is also a switch an attacker's target could be moved onto. Reviewer must pick one; this proposal assumes revert-by-deploy.
- **Safe to apply later because:** it is documentation of an ordering constraint, and documenting it late does not change the constraint — but applying any of PP-S2-01/02/07 *before* this is agreed means the ordering exists and nobody wrote it down, which is how the ADR 0053 deadlock happened the first time.
## Part 2 — attribution and token class

Eighteen patch proposals for the one question the system currently answers by
guessing: *whose charge session was that?* Roughly half is **greenfield** — no
`tokenClass` column, no `session_attribution` table, no `authorization_decision`
table and no correction path exist anywhere in the tree (verified: zero grep hits
across `apps`, `packages`, `prisma`, `src`, `gateway`). The other half is
**hardening** of code that already runs on every charge: `resolveAuthorize`
(`apps/api/src/routes/internal/ocpp-authorize.ts`), the two OCPP projection
handlers in `apps/api/src/lib/ocpp/projections.ts`, and the read surfaces that
render the result. The invariant every proposal below serves: **a shared
installation-technical credential must never be attributed to a person, and where
the data cannot name a driver the recorded state is "authorized, unidentified" —
not a blank that the next read coalesces into somebody's name.**

Nothing here is applied. Every path was read at tip `fc071b3`; line anchors are a
reading aid and will drift.

---

### PP-AT-01 — Give an idTag a class that is independent of who holds it

**Target** `prisma/schema/identity.prisma` :203-262 · also new file `prisma/migrations/<ts>_id_token_class/migration.sql` (**new-file**) and `packages/shared/src/db/identity.ts` :54-55,:127-151 · **Pkg** E01,E02 · **Scen** 75-77,81,82 · **Risk** Medium · **Apply when** the migration defaults every existing row to `unclassified` and no code branches on the new value yet

Today `IdTokenKind` records the *format* of a credential (`rfid`, `evccid`,
`manual`, `virtual_rfid`) and nothing records whether it belongs to a person or
to a wall. An operator who enrols the Zaptec "Default ID tag" for a stairwell
charger picks a kind and a user, and every later read treats that user as the
driver. This column is the first place the distinction can be stated.

```diff
   label               String?
   status              IdTokenStatus    @default(active)
+  // Sprint-pending E01 — WHAT this credential is, orthogonal to `kind`
+  // (which is its wire format) and to `status` (which is its lifecycle).
+  // `unclassified` is the honest default for every pre-existing row:
+  // nothing in the schema before this column recorded the difference,
+  // so inferring one at migration time would be a fabrication.
+  tokenClass          IdTokenClass     @default(unclassified) @map("token_class")
   expiresAt           DateTime?        @map("expires_at") @db.Timestamptz(6)
   lastUsedAt          DateTime?        @map("last_used_at") @db.Timestamptz(6)
```

```diff
+enum IdTokenClass {
+  driver_personal          // one named person; a subject may be recorded
+  installation_technical   // belongs to the wall, not to anybody
+  vehicle_bound            // an EVCCID/EMAID; a car, which may have many drivers
+  unclassified             // not yet decided — never treat as driver_personal
+
+  @@schema("identity")
+}
+
 enum IdTokenStatus {
   active
   suspended
   revoked
   expired
 
   @@schema("identity")
 }
```

- **Tests to add:** `id-tokens.test.ts` "createIdToken defaults tokenClass to unclassified"; `apps/api/test/parity/schema-columns.test.ts` gains `identity.id_tokens.token_class`; `apps/api/test/parity/domain-schemas.test.ts` asserts the Drizzle enum literal list matches the Prisma enum. None of these exist today, so none fail today — the first *failing* test arrives with PP-AT-05.
- **Migration impact:** one `CREATE TYPE` plus one `ADD COLUMN … DEFAULT 'unclassified' NOT NULL`. Both Prisma schema copies must move together: `prisma/schema/identity.prisma` is the source, `apps/api/prisma/schema/identity.prisma` is generated by `scripts/sync-api-prisma-schema.mjs` and verified by `npm run check:api-schema`. The Drizzle mirror at `packages/shared/src/db/identity.ts:54` needs a matching `identitySchema.enum("IdTokenClass", …)`.
- **Rollback:** `DROP COLUMN token_class` plus `DROP TYPE`. Loses every classification an operator entered; nothing else regresses because no read path branches on it until PP-AT-05.
- **Unresolved:** is `vehicle_bound` a class of its own or a sub-case of `driver_personal` with a binding record (PP-AT-06)? An EVCCID identifies a car, and two people can drive one car — the packet's E12 asks for an explicit binding model but does not say where the class boundary falls.
- **Safe to apply later because:** additive with a default; no existing query selects the column, so a deploy that lands the migration and not the code is a no-op.

---

### PP-AT-02 — Let a token have no person, and forbid a technical token from having one

**Target** `prisma/schema/identity.prisma` :205,:229 · also new file `prisma/migrations/<ts>_id_token_nullable_subject/migration.sql` (**new-file**) · **Pkg** E04,E05 · **Scen** 75,83 · **Risk** High · **Apply when** PP-AT-01 has shipped and every `IdToken` creation path names a class explicitly (PP-AT-03)

`IdToken.userId` is `NOT NULL` with a cascading FK, so "this credential belongs to
the installation" is not currently expressible — an operator enrolling a shared
tag must attach it to a human, usually themselves or the host admin. Making the
column nullable and adding the CHECK is what turns the invariant from a
convention into something the database refuses to violate.

```diff
 model IdToken {
   id                  String           @id @default(uuid()) @db.Uuid
-  userId              String           @map("user_id") @db.Uuid
+  // Nullable since E04: an installation-technical credential has no
+  // person behind it. The CHECK in the paired migration makes the
+  // converse true as well — a technical token may not acquire one.
+  userId              String?          @map("user_id") @db.Uuid
   kind                IdTokenKind
```

```diff
-  user                User             @relation(fields: [userId], references: [id], onDelete: Cascade)
+  user                User?            @relation(fields: [userId], references: [id], onDelete: Cascade)
   scopeInstallation   Installation?    @relation("InstallationIdTokens", fields: [scopeInstallationId], references: [id], onDelete: SetNull)
```

Paired migration (**new file**, SQL as written):

```diff
+ALTER TABLE "identity"."id_tokens" ALTER COLUMN "user_id" DROP NOT NULL;
+
+-- E05 / scenario 83. Stated as an implication rather than an equality:
+-- `unclassified` and `vehicle_bound` are deliberately unconstrained for
+-- now, because tightening them would reject rows that exist today.
+ALTER TABLE "identity"."id_tokens"
+  ADD CONSTRAINT "id_tokens_technical_has_no_person"
+  CHECK ("token_class" <> 'installation_technical' OR "user_id" IS NULL);
```

- **Tests to add:** `id-tokens.test.ts` "createIdToken(installation_technical, userId) is rejected by the constraint" (real-DB, rolled back — the file already has a real-DB harness); `ocpp-authorize.test.ts` "a token row with userId null resolves without throwing". The second FAILS today: `PrismaLike.idToken.findUnique` at `ocpp-authorize.ts:364-370` types `userId: string`, and `resolveAuthorize` passes it straight into `driverGroupMembership.findFirst` at `:279`.
- **Migration impact:** column nullability change plus a table-scanning CHECK. The type ripple is wide and is the real cost: `IdTokenRow.userId` (`id-tokens.ts:59`), `toSummary` (`:73-89`), `IdTokenSummary.userId` in `@straumvakt/shared/domain/users`, `PrismaLike` (`ocpp-authorize.ts:364`), and the `token.userId` read at `local-auth-list-push.ts:167`.
- **Rollback:** re-add `SET NOT NULL` only after re-pointing or deleting every technical token; otherwise the ALTER fails. The rows themselves survive — rollback is blocked, not lossy.
- **Unresolved:** what happens to `onDelete: Cascade` semantics for a token with no user? Cascade is a no-op on a NULL FK, so a technical token now outlives every user — is that intended retention, or does it need an explicit installation FK to hang from?
- **Safe to apply later because:** the CHECK can only be violated by rows PP-AT-01 cannot produce (its default is `unclassified`), so the constraint is vacuously satisfiable on today's data and the migration will not fail on staging.

---

### PP-AT-03 — Make the class an explicit argument at creation and refuse to infer it

**Target** `apps/api/src/domains/identity/repositories/id-tokens.ts` :119-196 · **Pkg** E01,E02,E13 · **Scen** 81,82 · **Risk** Medium · **Apply when** PP-AT-01 has shipped and the four hand-rolled creation paths have been enumerated

`createIdToken` currently takes `kind` and mints a value; there is no place for
the caller to say what the credential *is*. Requiring the class at the one
repository entry point is the only way the four independent creation paths
(`registration.ts:157`, `host-invites.ts:180`, `users.ts:272`, and the admin form)
stop producing rows nobody can classify later. Shape must never seed the class:
`classifyIdTagFormat` is a display heuristic and calls an `08`-prefixed phone tap
a MIFARE card (`idtag-classifier.ts:96-98`).

```diff
 export async function createIdToken(
   db: DbOrTx,
   input: {
-    userId: string;
+    /** Null only when `tokenClass === "installation_technical"` — the
+     *  DB CHECK from E05 enforces the converse. */
+    userId: string | null;
     kind: IdTokenKind;
+    /**
+     * E01 — required, with no default. A default here would put the
+     * decision back in the code that happens to call this, which is
+     * exactly how `kind` came to mean four different things.
+     */
+    tokenClass: IdTokenClass;
     value?: string;
     label?: string;
     vendorIssuedBy?: string;
     vendorTokenId?: string;
     expiresAt?: Date;
     scopeInstallationId?: string;
   },
 ): Promise<IdTokenSummary> {
   const provided = input.value?.trim();
   if (provided !== undefined && provided.length === 0) {
     throw new Error("idtoken.value: empty string not allowed");
   }
+  if (input.tokenClass === "installation_technical" && input.userId !== null) {
+    throw new Error(
+      "idtoken.tokenClass: an installation-technical token may not name a user",
+    );
+  }
```

- **Tests to add:** `id-tokens.test.ts` "createIdToken rejects installation_technical with a userId" and "backfillPrimaryRfidForUsersWithoutTokens mints driver_personal". The second guards `backfillPrimaryRfidForUsersWithoutTokens` (`:357-400`), which mints for every user with zero tokens and would otherwise inherit whatever default is added later.
- **Migration impact:** none — pure TypeScript, given PP-AT-01's column exists. Every call site must be edited in the same commit or the build breaks, which is the point.
- **Rollback:** revert the signature; rows keep whatever class they were given.
- **Unresolved:** `create-driver.ts:143` `createDriver` has zero importers today (inventory A01 finding 6). Does it get the new argument, or is it deleted first? Editing dead code to keep it compiling is the worse of the two.
- **Safe to apply later because:** it is a compile-time change with no runtime branch — it cannot half-apply, and deferring it only means rows accumulate as `unclassified`, which is the truthful state anyway.

---

### PP-AT-04 — Say who the authorisation is FOR, not only what it decided

**Target** `apps/api/src/routes/internal/ocpp-authorize.ts` :42-54,:333-339 · **Pkg** E03,E16 · **Scen** 76,77,79 · **Risk** Low · **Apply when** the gateway treats unknown response fields as ignorable — it does, `requestAuthorizeVerdict` casts the body to a fixed interface at `gateway/src/identity-do.ts:938`

`AuthorizeResult` carries `verdict` (what the charger is told) and optionally
`userId`, and nothing distinguishes "no user because we could not find one" from
"no user because there is not supposed to be one". A separate `attribution` field
makes the second case sayable, and it is purely additive: an older gateway
deserialising this response ignores it.

```diff
 export interface AuthorizeResult {
   verdict: AuthorizeVerdict;
   reason: AuthorizeReason;
   userId?: string;
   idTokenId?: string;
+  /**
+   * E03 — who this authorisation is FOR, as distinct from what it
+   * decided. Additive by design (E16): a gateway that does not read the
+   * field behaves exactly as before.
+   *
+   *   "driver"       a person is identified; `userId` is set.
+   *   "installation" a shared/technical credential; `userId` is ABSENT,
+   *                  and that absence is a fact, not a lookup failure.
+   *   "unknown"      authorised, but nothing here can name anybody.
+   *
+   * Absent on refusal paths — there is no subject for a decision that
+   * denied.
+   */
+  attribution?: "driver" | "installation" | "unknown";
   /**
    * Per-installation auth-enforce gate (Sprint 4 milestone 4.6).
```

- **Tests to add:** `ocpp-authorize.test.ts` "Accepted driver token carries attribution:'driver'" and "the field is absent on every Blocked path". Neither fails today because the field does not exist; the failing test is PP-AT-05's.
- **Migration impact:** none — pure TypeScript. The response is JSON over a service binding, not a versioned contract.
- **Rollback:** delete the field. The gateway's optional read (PP-AT-08) already tolerates its absence.
- **Unresolved:** should a refusal carry `attribution` too, so a `Blocked` on a technical token is distinguishable in the decision log from a `Blocked` on a driver token? PP-AT-09's table can hold it either way; the packet's SI-OCPP-01 open question asks the same thing about placement.
- **Safe to apply later because:** additive optional field on a JSON response with exactly one consumer, which reads it through `?.`.

---

### PP-AT-05 — Refuse to return a person for a credential that is not a person's

**Target** `apps/api/src/routes/internal/ocpp-authorize.ts` :214-223,:275-306,:333-339 · **Pkg** E04,E17 · **Scen** 75,77,78,81,82 · **Risk** High · **Apply when** PP-AT-01 and PP-AT-02 have shipped, so `tokenClass` is selectable and `userId` may be null

`resolveAuthorize` returns `userId: token.userId` for any active token that passes
the gates, and `IdToken.userId` is NOT NULL, so a shared stairwell tag returns a
human every time. After this change the resolver states the class it found and
emits a subject only when the class permits one — which is where scenario 78
("two concurrent sessions on one technical token, neither names a user") becomes
satisfiable at all.

```diff
   const token = await db.idToken.findUnique({
     where: { value: input.idTag },
     select: {
       id: true,
       userId: true,
+      tokenClass: true,
       status: true,
       expiresAt: true,
       scopeInstallationId: true,
     },
   });
```

```diff
   if (token.scopeInstallationId) {
     if (!installationId || installationId !== token.scopeInstallationId) {
       return { verdict: "Invalid", reason: "scope_mismatch", idTokenId: token.id, enforceAuthorize };
     }
   }
 
+  // ── The invariant (E04) ────────────────────────────────────────────
+  // A shared installation credential is never a person. Enforced here as
+  // well as by the E05 CHECK, because the resolver's answer is the only
+  // thing the gateway ever sees, and a legacy row that predates the
+  // constraint would otherwise still name somebody.
+  const attribution: "driver" | "installation" | "unknown" =
+    token.tokenClass === "installation_technical"
+      ? "installation"
+      : token.userId
+        ? "driver"
+        : "unknown";
+  const subject = attribution === "driver" ? token.userId : null;
+
```

```diff
-  if (enforceAuthorize && installationId) {
+  // The contract gate asks "does this PERSON hold a membership here",
+  // which is unanswerable without a person. Skipping it for a subjectless
+  // token changes nothing today — `enforceAuthorize` is false at every
+  // installation until the F02 runbook is run — but see Unresolved.
+  if (enforceAuthorize && installationId && subject) {
     const now = new Date();
     const membership = await db.driverGroupMembership.findFirst({
       where: {
-        userId: token.userId,
+        userId: subject,
         driverGroup: {
```

```diff
   return {
     verdict: "Accepted",
     reason: "ok",
-    userId: token.userId,
+    ...(subject ? { userId: subject } : {}),
+    attribution,
     idTokenId: token.id,
     enforceAuthorize,
   };
```

- **Tests to add:** `ocpp-authorize.test.ts` "installation_technical token accepts with no userId and attribution 'installation'" — **FAILS today**, the resolver has no branch that can omit `userId` on an Accepted verdict. Plus "two Authorize calls on one technical token both return attribution 'installation'" (E17 / scenario 78).
- **Migration impact:** none — pure TypeScript, but it hard-depends on PP-AT-01's column being present in the generated client, so it cannot deploy ahead of that migration.
- **Rollback:** revert the file. Sessions authorised in the interim keep whatever attribution PP-AT-11 wrote; nothing in the DB has to be undone.
- **Unresolved:** what gates an installation-technical token once `enforceAuthorize` is armed? Membership cannot, by construction. The candidates are (a) an installation-type `Agreement` existing at all, (b) the `scopeInstallationId` match alone, (c) a new `no_subject` refusal. This is a product decision, not a code one, and it must be answered before F02's first installation flips the flag.
- **Safe to apply later because:** every new branch is behind `tokenClass === "installation_technical"`, a value nothing can hold until an operator sets it, so committing this ahead of classification is a strict no-op.

---

### PP-AT-06 — Name the authorized-but-unidentified state instead of leaving a hole

**Target** `gateway/src/identity-do.ts` :640-656 · **Pkg** E14,F05,F10 · **Scen** 79,80,87 · **Risk** Medium · **Apply when** PP-AT-04's field exists, and the operator accepts one extra upstream call per no-idTag start

When a charger starts a free-vend session it may send `StartTransaction` with no
`idTag` at all. `if (idTag && this.meta)` then skips the entire authorize block:
no upstream call, no verdict, no log line, and the session lands with
`id_tag = NULL` — indistinguishable from a session whose tag we lost. This makes
the free-vend case a recorded state rather than an absence.

```diff
     let authLog: { idTag: string; cached: boolean; availabilityRefusal: boolean } | null = null;
     if (frame.action === "Authorize" || frame.action === "StartTransaction") {
       const idTag = stringField(frame.payload, "idTag");
-      if (idTag && this.meta) {
+      if (!idTag && this.meta) {
+        // Free vend / no-idTag start (scenario 79). The charger decided
+        // locally and told us nothing about who. That is a real, nameable
+        // state — "authorized, unidentified" — and it must be logged as
+        // such rather than falling through unrecorded, which is what put
+        // a blank in `session_ledger.driver_user_id` that the read side
+        // then filled from somewhere else.
+        authLog = { idTag: "", cached: false, availabilityRefusal: false };
+      } else if (idTag && this.meta) {
         const resolved = await this.resolveAuthorizeVerdict(idTag, frame.action);
         authResolverVerdict = resolved.verdict;
         authLog = {
           idTag,
           cached: resolved.cached,
```

- **Tests to add:** `gateway/src/identity-do.test.ts` "StartTransaction with no idTag logs attribution 'unknown' and still replies Accepted" — FAILS today, the log line is never reached. `identity-do.test.ts` is 1485 lines and already exercises the Authorize path, so the harness exists.
- **Migration impact:** none — pure TypeScript in the gateway worker.
- **Rollback:** restore the single `if`. Loses the log line; the reply the charger gets is unchanged either way, because `responseFor` returns the stub whenever `authVerdict` is null.
- **Unresolved:** bench question H1 (`F05`, scenario 87) is unanswered — does a Zaptec Pro in free-vend actually send an empty `idTag`, or does it synthesise one (the "Default ID tag" `EE43C609263CC7` at Dalvegur suggests the latter)? If it synthesises, this branch never fires and the real work is PP-AT-01 classifying that synthesised tag as `installation_technical`.
- **Safe to apply later because:** the new branch only adds a log emission on a code path that currently does nothing at all; the OCPP reply is computed by `responseFor` from `authResolverVerdict`, which stays null.

---

### PP-AT-07 — Stop the classifier calling every phone tap a MIFARE card

**Target** `apps/api/src/lib/idtag-classifier.ts` :29,:31-37,:96-98,:153-168 · **Pkg** E02,F09,R02 · **Scen** 79,84 · **Risk** Medium · **Apply when** the `mintRfidValue` collision below is resolved, because the fix is not purely cosmetic

`classifyIdTagFormat("085ACDF6")` returns `iso14443_4byte` / `high` while
`isRandomEmulatedUid` calls the identical string a phone tap; the classifier
imports only `./oui/lookup` (`:29`). Every operator surface that reads
`detectedKind` — `session-full-detail.ts:548-568` is the live one — confidently
mislabels every tap-and-auth session as a physical card, which is precisely the
evidence a dispute would turn on.

```diff
 import { lookupOuiVendor } from "./oui/lookup";
+// One owner for "this is a phone, not a card". The resolver already
+// depends on this module (ocpp-authorize.ts:31); the classifier not
+// depending on it is how the two came to disagree about one string.
+import { isRandomEmulatedUid } from "./tap-intent/random-uid";
 
 export type IdTagKind =
+  | "random_emulated_uid" // phone card-emulation; regenerated on every tap
   | "iso14443_4byte"   // MIFARE Classic 4-byte UID — 8 hex chars
   | "iso14443_7byte"   // DESFire / Zaptec Default ID tag — 14 hex chars
```

```diff
   // 8 hex chars → ISO 14443 4-byte UID. Very common; what most
   // MIFARE Classic cards present and what Zaptec auto-mints from
   // mintRfidValue() in id-tokens.ts.
   if (isHex && stripped.length === 8) {
+    // …except when the first byte is 0x08, which ISO 14443-3 reserves
+    // for randomly generated UIDs. A real manufacturer code is never 08.
+    if (isRandomEmulatedUid(stripped)) {
+      return { detectedKind: "random_emulated_uid", confidence: "high" };
+    }
     return { detectedKind: "iso14443_4byte", confidence: "high" };
   }
```

```diff
 export function idTagKindLabel(kind: IdTagKind): string {
   switch (kind) {
+    case "random_emulated_uid":
+      return "Phone tap (anonymous UID)";
     case "iso14443_4byte":
       return "RFID (4-byte UID)";
```

- **Tests to add:** `idtag-classifier.test.ts` "085ACDF6 classifies as random_emulated_uid, not iso14443_4byte" — **FAILS today**, and the existing file almost certainly asserts the opposite for some 8-hex fixture, so this is a deliberate expectation flip that must be reviewed line by line.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** revert. Operator badges go back to mislabelling; no stored data changes, because `detectedKind` is computed at read time in `buildVehicleIdentity` and never persisted.
- **Unresolved:** `mintRfidValue()` (`id-tokens.ts:49-55`) draws 4 random bytes, so roughly 1 in 256 auto-minted primary RFIDs starts with `08`. Such a token is (a) about to be relabelled a phone tap by this change and (b) already unreachable through the normal path, because `resolveAuthorize:173-177` diverts it into `matchAndConsumeTapIntent` before the `IdToken` lookup. That is a live latent bug independent of this proposal and it needs its own fix — exclude `08` in the mint loop — before this lands.
- **Safe to apply later because:** the classifier feeds display only (`session-full-detail.ts:548`); no verdict, no billing, no persistence reads it, so deferral costs accuracy in the console and nothing else.

---

### PP-AT-08 — Carry attribution across the gateway without breaking the old contract

**Target** `gateway/src/identity-do.ts` :80-86,:677-700 · **Pkg** E16,F01 · **Scen** 76,77,79 · **Risk** Low · **Apply when** PP-AT-04 has deployed to the API worker, or never — the field is optional in both directions

The gateway's `AuthorizeVerdict` interface is a hand-written mirror of the API's
response and drops anything it does not declare; the one existing consumer of
`userId` is a log field at `:680`. Adding the optional field and logging it is
what makes F01's shadow-mode evidence report able to count verdicts by
attribution rather than only by reason.

```diff
 interface AuthorizeVerdict {
   verdict: "Accepted" | "Blocked" | "Expired" | "Invalid";
   reason: string;
   userId?: string;
   idTokenId?: string;
+  /**
+   * E03/E16 — additive and optional in both directions: absent when the
+   * API worker predates PP-AT-04, and ignored by any gateway that
+   * predates this line. Neither side needs the other deployed first.
+   */
+  attribution?: "driver" | "installation" | "unknown";
   enforceAuthorize: boolean;
 }
```

```diff
         verdict: authResolverVerdict?.verdict ?? "upstream_error",
         reason: authResolverVerdict?.reason ?? "upstream_error",
         userId: authResolverVerdict?.userId,
+        // Distinct from `userId` on purpose. A missing userId with
+        // attribution "installation" is a correct answer; a missing
+        // userId with attribution "unknown" is a gap; a missing userId
+        // with no attribution at all is an old API worker.
+        attribution: authResolverVerdict?.attribution ?? null,
         idTokenId: authResolverVerdict?.idTokenId,
```

- **Tests to add:** `gateway/src/identity-do.test.ts` "an upstream response carrying attribution is logged verbatim" and "an upstream response without it logs attribution:null". Neither fails today; both are regression fences for the mixed-deploy window.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** revert. The cached `CachedAuthorizeVerdict` entries (`:151-155`) written while this was live simply carry an extra key that the reverted code ignores.
- **Unresolved:** the 60 s DO verdict cache (`AUTHORIZE_CACHE_TTL_MS`, `:275`) now stores a subject as well as a decision. For a `tap_intent` verdict that subject is a specific driver and the intent has already been consumed — is a 60 s replay of that subject acceptable, or should tap-derived verdicts be excluded from the cache entirely?
- **Safe to apply later because:** the field is optional on the wire and read through `?.`, so gateway and API can deploy in either order and any combination behaves like the older of the two.

---

### PP-AT-09 — Record every authorisation decision as evidence

**Target** new file `prisma/migrations/<ts>_authorization_decisions/migration.sql` and new file `apps/api/src/repositories/authorization-decisions.ts` (**new-file proposals** — nothing named `authorization_decision` exists in the tree); call site `apps/api/src/routes/internal/ocpp-authorize.ts` :103-106 · **Pkg** E10,F01,M05 · **Scen** 79,98 · **Risk** Medium · **Apply when** the write is fire-and-forget and cannot change the verdict the charger receives

A dispute (scenario 98) needs the authorisation decision alongside the meter
data, and today the only trace is a `console.log` in the gateway that Logpush
retains on its own schedule. Writing the decision at the route boundary — not
inside `resolveAuthorize` — keeps the pure resolver and its existing test suite
untouched.

```diff
   const db = makePrisma(c.env);
   const result = await resolveAuthorize(db, { idTag, identityId, orgId });
+  // E10 — the decision is evidence. The resolver stays pure, so the write
+  // lives here. Fire-and-forget on purpose: a logging outage must never
+  // strand a driver, so a failure is logged and the verdict still goes
+  // out. That asymmetry is the whole design.
+  c.executionCtx.waitUntil(
+    recordAuthorizationDecision(db, { idTag, identityId, orgId, result }).catch(
+      (err) =>
+        console.error("[ocpp-authorize] decision log failed", {
+          identityId,
+          error: err instanceof Error ? err.message : String(err),
+        }),
+    ),
+  );
   return c.json(result, 200);
```

New table (**new file**, SQL as written — pseudodiff, column set not yet reviewed):

```diff
+CREATE TABLE "protocol"."authorization_decisions" (
+    "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
+    "org_id"         UUID           NOT NULL,
+    "identity_id"    UUID           NOT NULL,
+    "id_tag"         TEXT,                      -- NULL = free vend, no tag presented
+    "id_token_id"    UUID,
+    "verdict"        TEXT           NOT NULL,   -- Accepted | Blocked | Expired | Invalid
+    "reason"         TEXT           NOT NULL,   -- AuthorizeReason, incl. tap_intent*
+    "attribution"    TEXT,                      -- driver | installation | unknown
+    "subject_user_id" UUID,
+    "enforced"       BOOLEAN        NOT NULL,
+    "decided_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
+    CONSTRAINT "authorization_decisions_pkey" PRIMARY KEY ("id"),
+    CONSTRAINT "authorization_decisions_subject_matches_attribution"
+      CHECK ("attribution" = 'driver' OR "subject_user_id" IS NULL)
+);
+CREATE INDEX "authorization_decisions_identity_time_idx"
+    ON "protocol"."authorization_decisions" ("identity_id", "decided_at" DESC);
+CREATE INDEX "authorization_decisions_tag_time_idx"
+    ON "protocol"."authorization_decisions" ("id_tag", "decided_at" DESC);
```

- **Tests to add:** `apps/api/src/repositories/authorization-decisions.test.ts` "a Blocked verdict with attribution unset writes subject_user_id NULL"; `ocpp-authorize.test.ts` "a throwing decision writer does not change the response body" — the second is the one that matters and it cannot be written today, because there is no writer to make throw.
- **Migration impact:** one new table in the `protocol` schema, two indexes. It is append-only and high-volume — every Authorize *and* every StartTransaction, so roughly two rows per session — which makes retention a day-one decision, not a later one. The repo already partitions `events.protocol_log` by day (`20260802220000_protocol_log`); the same treatment is the obvious precedent.
- **Rollback:** `DROP TABLE`. Loses the decision history; nothing reads it except the dispute bundle, which degrades to what it has today.
- **Unresolved:** retention class. `20260803090000_reclassify_retention_by_action` established that retention is set per action kind — which class does an authorisation decision belong to, and does a denied decision keep the same clock as an accepted one?
- **Safe to apply later because:** the table is append-only and read by nothing; deferring it costs evidence for sessions in the gap and changes no behaviour.

---

### PP-AT-10 — Create the one table that holds who a session is attributed to, and why

**Target** new file `prisma/migrations/<ts>_session_attribution/migration.sql` plus a model in `prisma/schema/charging.prisma` (**new-file proposal** — zero grep hits for `session_attribution` anywhere) · **Pkg** E06,E07,E08,M04 · **Scen** 83,84,85,86 · **Risk** High · **Apply when** it is created as a shadow of `session_ledger.driver_user_id`, written but not yet read

Attribution is currently one nullable column on the ledger, computed once at
stop-time, with no record of what evidence produced it. This table separates the
subject from the basis, makes "installation" and "unknown" first-class values
rather than NULLs, and gives corrections somewhere to land without an UPDATE.

```diff
+model SessionAttribution {
+  sessionId       String    @id @map("session_id") @db.Uuid
+  // driver | installation | unknown. TEXT per the ADR 0019 convention
+  // (no Postgres enum types), validated at the application layer.
+  subjectKind     String    @map("subject_kind")
+  subjectUserId   String?   @map("subject_user_id") @db.Uuid
+  installationId  String?   @map("installation_id") @db.Uuid
+  // id_token | tap_intent | cdr_card | operator_correction | none.
+  // E07: the evidence, not the conclusion. `none` is legitimate and is
+  // what a free-vend session carries.
+  basis           String
+  idTokenId       String?   @map("id_token_id") @db.Uuid
+  idTag           String?   @map("id_tag")
+  decidedAt       DateTime  @default(now()) @map("decided_at") @db.Timestamptz(6)
+  // Set only for basis='operator_correction' (M07 — the actor is not the
+  // subject and never the credential).
+  decidedByUserId String?   @map("decided_by_user_id") @db.Uuid
+  // E08/E09 — corrections are appended to charging.attribution_corrections
+  // and this row is repointed; the prior value is never destroyed.
+  correctionId    String?   @map("correction_id") @db.Uuid
+
+  @@index([subjectUserId, decidedAt(sort: Desc)])
+  @@map("session_attribution")
+  @@schema("charging")
+}
```

Paired constraint (**new file**, SQL as written):

```diff
+-- Scenario 83. The invariant, stated where it cannot be bypassed.
+ALTER TABLE "charging"."session_attribution"
+  ADD CONSTRAINT "session_attribution_subject_matches_kind"
+  CHECK (
+    ("subject_kind" = 'driver'       AND "subject_user_id" IS NOT NULL)
+ OR ("subject_kind" = 'installation' AND "subject_user_id" IS NULL AND "installation_id" IS NOT NULL)
+ OR ("subject_kind" = 'unknown'      AND "subject_user_id" IS NULL)
+  );
```

- **Tests to add:** `apps/api/src/repositories/session-attribution.test.ts` "inserting subject_kind='installation' with a subject_user_id is rejected" (scenario 83, real-DB); "basis is required and 'none' is accepted". Neither can be written today.
- **Migration impact:** one new table plus one CHECK, both additive. `sessionId` is a plain UUID column, not a declared FK — the same choice `session_ledger.sessionId` already made (`session-ledger.ts:135-136` explains why), so the enrichment pattern there transfers directly.
- **Rollback:** `DROP TABLE`. Loses every recorded basis. As long as PP-AT-13 has not yet made the ledger defer to this table, `session_ledger.driver_user_id` still carries the old answer, so billing does not regress.
- **Unresolved:** does this table supersede `session_ledger.driver_user_id` or shadow it? SI-SESSIONS-01 asks the same question. Shadowing first is the only sequencing that lets a mismatch report be built before the cutover — but nobody has said how long the shadow period is or who signs it off.
- **Safe to apply later because:** additive table with no reader until PP-AT-13; write-only tables cannot regress a read path.

---

### PP-AT-11 — Attribute the session when it starts, not when it stops

**Target** `apps/api/src/lib/ocpp/projections.ts` :151-199 (and the identical shape at :835-873) · **Pkg** E06,E11,M07 · **Scen** 84,91,95 · **Risk** High · **Apply when** PP-AT-10's table exists and `charging.sessions.user_id` writes are confirmed not to collide with the Zaptec webhook family

`onSessionStarted` and `onOcppRawStartTransaction` both omit `userId` from the
`chargeSession.create`, so an OCPP-originated session never appears in
`GET /api/driver/sessions/current` (`driver-sessions.ts:114` filters on
`user_id`) or `GET /api/driver/invoices` (`driver-invoices.ts:53`, same filter) —
the driver is charging and the app says they are not. Deciding attribution once,
at the moment the session exists, is also what gives the tap-intent verdict
somewhere to land.

```diff
   await tx.chargeSession.create({
     data: {
       id: event.aggregateId,
       orgId: event.orgId,
       siteId,
       chargingStationId,
       evseId: connector.evseId,
       ocppIdentityId,
       connectorId,
       idTag: idTag ?? null,
+      // E06 — decide once, here. Only a driver-class token yields a
+      // person; everything else leaves this NULL *and* records why in
+      // session_attribution, so a NULL here stops meaning "unknown".
+      userId: attributed.subjectUserId,
       startedAt: new Date(event.occurredAt),
       energyWh: meterStartWh !== undefined ? BigInt(meterStartWh) : null,
       status: "in_progress",
     },
   });
+  await tx.sessionAttribution.create({
+    data: {
+      sessionId: event.aggregateId,
+      subjectKind: attributed.subjectKind,
+      subjectUserId: attributed.subjectUserId,
+      installationId: attributed.installationId,
+      basis: attributed.basis,
+      idTokenId: attributed.idTokenId,
+      idTag: idTag ?? null,
+    },
+  });
```

- **Tests to add:** `projections.test.ts` "session.started with a driver token sets sessions.user_id" — **FAILS today**; "session.started with an installation_technical token leaves user_id NULL and writes subject_kind='installation'"; "session.started with a random emulated UID records basis='tap_intent'". `projections.test.ts` is 35 KB and already drives these handlers.
- **Migration impact:** none beyond PP-AT-10. But it changes what `charging.sessions.user_id` means: today only the Zaptec webhook (`routes/webhooks/zaptec.ts:211,:335`) and CDR sync write it, so after this the column has two writer families and the CDR match at `zaptec-session-sync.ts:256-271` may find a session that already has a subject.
- **Rollback:** revert the handler. Sessions created while it was live keep their `user_id`, which is correct data — the rollback is not destructive, it just stops producing more.
- **Unresolved:** the tap-intent path. `resolveAuthorize:183-199` consumes the intent at Authorize time and the gateway discards the `userId` (`identity-do.ts:680`); by the time `session.started` projects, the intent row is marked consumed. Reading it back by `(chargingStationId, consumedIdTag)` is possible — `tap_intents` keeps `consumed_id_tag` "for forensics" (`charging.prisma:258-259`) — but that is a new query on the projection hot path and nobody has costed it.
- **Safe to apply later because:** it is additive per session and idempotent per event (`sessionAttribution.create` keys on the session id, which is the event's aggregate id); a replay collides on the PK exactly as `sessionLedger.upsert` was written to survive.

---

### PP-AT-12 — Make the stop-time re-resolve upgrade-only and class-aware

**Target** `apps/api/src/lib/ocpp/projections.ts` :406-416 and the byte-identical block at :971-978 · **Pkg** E04,E08,M02 · **Scen** 78,85,86 · **Risk** High · **Apply when** PP-AT-01 has shipped; correct without PP-AT-11, better with it

At stop time both handlers re-run `idToken.findFirst({ value, status: "active" })`
and write whatever userId comes back into `session_ledger.driver_user_id`. Because
`IdToken.userId` is NOT NULL, a shared tag names a person here; and because the
lookup is by current token state, a card that changed hands retroactively
attributes an old session to its new holder. This makes the lookup refuse a
technical class and refuse to overwrite a decision already made.

```diff
   let driverUserId: string | null = null;
   if (updated.idTag) {
     const idTokenRow = await tx.idToken.findFirst({
       where: {
         value: updated.idTag,
         status: "active",
       },
-      select: { userId: true },
+      select: { userId: true, tokenClass: true },
     });
-    driverUserId = idTokenRow?.userId ?? null;
+    // E04 — a shared installation credential never names a person, so
+    // the lookup succeeding is not the same as the lookup identifying
+    // anybody. E08 — this is a fill, never an overwrite: a start-time
+    // decision stands, and any change to it goes through a correction
+    // event (M02), not through a projection re-run.
+    driverUserId =
+      idTokenRow && idTokenRow.tokenClass !== "installation_technical"
+        ? idTokenRow.userId
+        : null;
   }
```

- **Tests to add:** `projections.test.ts` "session.stopped on an installation_technical token leaves driver_user_id NULL" — **FAILS today** (the current code writes the token's owner); "session.stopped does not overwrite a driver_user_id already set at start". The second only becomes meaningful after PP-AT-11.
- **Migration impact:** none — pure TypeScript, dependent on PP-AT-01's column.
- **Rollback:** revert both blocks together. Rows written in the interim keep NULL where the old code would have written a name — which is the truthful value, so rolling back does not require a data fix.
- **Unresolved:** the block exists twice verbatim (`:406-416`, `:971-978`) and a near-copy lives in `routes/webhooks/zaptec.ts:493-503` (`resolveDriver`). Three copies of one rule is how the three-copy contract gate happened (inventory A05 finding 6). Extract to `lib/ocpp/resolve-session-subject.ts` in the same commit, or accept that a future fix will land in two of three places.
- **Safe to apply later because:** it only ever converts a value from "a name" to NULL, never the reverse, so it cannot manufacture an attribution — the failure mode of deferring is a wrong name, and the failure mode of applying is a missing one.

---

### PP-AT-13 — Stop the ledger implying a person it cannot prove

**Target** `prisma/schema/commercial.prisma` :297-336 plus new migration file (**new-file** for the migration) · **Pkg** E14,M07 · **Scen** 95,96 · **Risk** Medium · **Apply when** PP-AT-10 is writing shadow rows, so the new column can be populated from a source rather than guessed

`session_ledger.driver_user_id IS NULL` currently collapses three different
facts: nobody has been identified yet, nobody *can* be identified, and the cost
belongs to the installation. Scenario 95 ("an unknown-attribution session may be
billed to the installation") and 96 ("no person named anywhere in the invoice")
are both unstatable while one nullable column carries all three meanings.

```diff
   driverUserId      String?      @map("driver_user_id") @db.Uuid
   driverIdTag       String?      @map("driver_id_tag")
+  // E14/M07 — WHO PAYS, as a value rather than as the absence of one.
+  //   "driver"       driver_user_id is set and is the billing subject.
+  //   "installation" the installation pays; no person is named anywhere.
+  //   "unknown"      authorised, unidentified — billable to the
+  //                  installation by policy, but recorded as unknown so
+  //                  the invoice never implies a driver was found.
+  // NULL means "predates this column", not "none of the above".
+  billingSubjectKind           String?  @map("billing_subject_kind")
+  billingSubjectInstallationId String?  @map("billing_subject_installation_id") @db.Uuid
   startedAt         DateTime     @map("started_at") @db.Timestamptz(6)
```

Paired constraint (**new file**, SQL as written):

```diff
+-- Scenario 96 stated as a constraint: an installation-billed row cannot
+-- carry a person. NULL kind is exempt so pre-existing rows survive.
+ALTER TABLE "reports"."session_ledger"
+  ADD CONSTRAINT "session_ledger_subject_matches_kind"
+  CHECK (
+    "billing_subject_kind" IS NULL
+ OR ("billing_subject_kind" = 'driver'  AND "driver_user_id" IS NOT NULL)
+ OR ("billing_subject_kind" <> 'driver' AND "driver_user_id" IS NULL)
+  );
```

- **Tests to add:** `session-ledger.test.ts` "a row with billing_subject_kind='installation' and a driver_user_id is rejected"; "listSessionLedger returns billingSubjectKind". The first FAILS today only in the sense that the constraint does not exist — the row is currently insertable and the ledger has rows in exactly that shape.
- **Migration impact:** two nullable columns plus a CHECK that is satisfied vacuously by every existing row (kind NULL). `LedgerRow` (`session-ledger.ts:46-68`) and both `select` blocks (`:113-127`, `:230-234`) need the new field; `getSessionDetail` and `getSessionFullDetail` both prefer the ledger cost already, so they are the natural consumers.
- **Rollback:** drop both columns and the CHECK. Loses the distinction; billing falls back to "NULL means figure it out", which is today.
- **Unresolved:** who is the installation billing subject in practice — the `Installation` row, or the org that owns it? `session_ledger` already has `org_id`, so `billing_subject_installation_id` may be redundant. Group K is greenfield (there is no agreement write surface at all), so nothing downstream constrains the answer yet.
- **Safe to apply later because:** additive nullable columns with a CHECK that exempts NULL — existing rows and existing writers are untouched, and the ledger keeps behaving exactly as it does now until a writer starts setting the kind.

---

### PP-AT-14 — Stop the read side inventing a driver the ledger deliberately left blank

**Target** `apps/api/src/repositories/session-full-detail.ts` :324-329,:387-388 · **Pkg** E14,M05,M07 · **Scen** 96,98 · **Risk** Medium · **Apply when** it is acceptable for some operator views to show "unidentified" where they previously showed a name

`getSessionFullDetail` returns `driverUserId: ledger?.driverUserId ?? session.userId`.
The `??` treats a deliberate NULL on the ledger as missing data and falls through
to `charging.sessions.user_id`, which a *different* writer family populates
(`routes/webhooks/zaptec.ts:211`, `:335`) — so a session the billing ledger
recorded as unattributed renders with a person's name attached. This is the
single line that turns "authorized, unidentified" into a guess.

```diff
-    driverIdTag: ledger?.driverIdTag ?? session.idTag,
-    driverUserId: ledger?.driverUserId ?? session.userId,
+    // The ledger is the settled attribution, including when its answer
+    // is "nobody". `??` could not express that: it read a deliberate
+    // NULL as absence and substituted charging.sessions.user_id, a
+    // column written by an entirely different writer family. When a
+    // ledger row exists, its answer stands.
+    driverIdTag: ledger ? ledger.driverIdTag : session.idTag,
+    driverUserId: ledger ? ledger.driverUserId : session.userId,
```

Second hunk (**pseudodiff** — `driverDisplayName` is computed at `:324` ahead of
where `driverUserId` is resolved, so the real change reorders as well as edits):

```diff
   // Driver display
-  const driverDisplayName = session.user
+  // Never render a name for a session the attribution does not claim.
+  // `session.user` is the relation off charging.sessions.user_id, which
+  // may be set on a row the ledger attributes to nobody.
+  const driverDisplayName = session.user && resolvedDriverUserId === session.user.id
     ? [session.user.firstName, session.user.lastName].filter(Boolean).join(" ").trim() ||
       session.user.displayName ||
       null
     : null;
```

- **Tests to add:** `apps/api/src/repositories/session-full-detail.test.ts` (**does not exist** — this repository has no test file at all) "a ledger row with driver_user_id NULL renders driverUserId null even when sessions.user_id is set" — FAILS today. Note the ripple: `routes/public/driver.ts:766` gates driver access on `detail.driverUserId !== userId`, so this change also tightens who can read a session.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** restore the `??`. Names reappear on unattributed sessions, and the driver-scope check at `driver.ts:766` loosens back.
- **Unresolved:** the change makes `GET /api/driver/sessions/:id` 404 for a driver whose session the ledger left blank but whose `sessions.user_id` names them — which is every Zaptec-webhook session where the card did not resolve. Is that a correct tightening or a regression drivers will report? It needs a count against staging before it ships, and this task ran no queries.
- **Safe to apply later because:** read-only change with no stored consequence; every row it affects can be re-rendered correctly the moment it lands.

---

### PP-AT-15 — Make a correction an event, and stop the backfill script from writing attribution at all

**Target** `apps/api/scripts/backfill-session-costs.ts` :176-199 · plus new file `prisma/migrations/<ts>_attribution_corrections/migration.sql` (**new-file**) · **Pkg** M02,M03,M08,E09 · **Scen** 85,86,91,92,97 · **Risk** High · **Apply when** the script's operator is identified and told, because a `--commit` run today silently rewrites the driver columns

The only correction path that exists in the repository is this script, and it
passes one `data` object as both `create` and `update`. On an OCPP-origin session
`s.userId` is NULL (nothing writes it) and `s.ocppIdentity?.identityString` is the
*charger's* OCPP identity, so a `--commit` run nulls the driver and writes a
charger id into `driver_id_tag`. Fencing the script is the cheap half; the
correction table is the half that makes scenario 92 satisfiable.

```diff
         const data = {
           orgId: s.orgId,
           siteId: s.siteId,
           chargingStationId: s.chargingStationId,
-          driverUserId: s.userId,
-          driverIdTag: s.ocppIdentity?.identityString ?? null,
           startedAt: s.startedAt,
           stoppedAt: s.endedAt,
           durationSec,
           energyKwh: energyKwh.toFixed(3),
           costIskMinor: recomputed,
           tariffDefinitionId: tariffId,
           // NB: verifiedSource/enrichmentStatus omitted — the Node Prisma
           // client generation used by tsx predates those ENRICH-1 columns.
         };
         await nodePrisma.sessionLedger.upsert({
           where: { sessionId: s.id },
-          create: { sessionId: s.id, ...data },
-          update: data,
+          // `driverIdTag` here was the CHARGER's identity string, not a
+          // driver token, and `driverUserId` is NULL for every OCPP-origin
+          // session — so the update branch overwrote real attribution with
+          // a charger id. This script recomputes COST. It may not touch
+          // who a session belongs to; that is a correction event (M02).
+          create: { sessionId: s.id, driverUserId: null, driverIdTag: s.idTag ?? null, ...data },
+          update: { costIskMinor: recomputed, tariffDefinitionId: tariffId },
         });
```

Correction record (**new file**, SQL as written — pseudodiff, shape not yet reviewed):

```diff
+CREATE TABLE "charging"."attribution_corrections" (
+    "id"                UUID           NOT NULL DEFAULT gen_random_uuid(),
+    "session_id"        UUID           NOT NULL,
+    -- The prior value, preserved verbatim (scenario 86). Never updated.
+    "from_subject_kind" TEXT           NOT NULL,
+    "from_subject_user_id" UUID,
+    "to_subject_kind"   TEXT           NOT NULL,
+    "to_subject_user_id"   UUID,
+    "basis"             TEXT           NOT NULL,  -- evidence for the NEW value
+    "reason"            TEXT           NOT NULL,  -- operator's free text
+    -- M07: the actor is the operator, never the driver (scenario 94).
+    "actor_user_id"     UUID           NOT NULL,
+    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
+    CONSTRAINT "attribution_corrections_pkey" PRIMARY KEY ("id"),
+    -- E08 upgrade-only: unknown -> driver is free; driver -> anything
+    -- else requires an explicit reason, which is NOT NULL above.
+    CONSTRAINT "attribution_corrections_not_a_noop"
+      CHECK ("from_subject_kind" <> "to_subject_kind"
+          OR "from_subject_user_id" IS DISTINCT FROM "to_subject_user_id")
+);
```

- **Tests to add:** `apps/api/src/repositories/attribution-corrections.test.ts` "a correction preserves the prior subject" (scenario 86) and "a no-op correction is rejected". Nothing tests `backfill-session-costs.ts` today and nothing can — it is a `tsx` script with a top-level `main()`, so the fence is verified by reading, not by CI.
- **Migration impact:** one new append-only table. The script change is pure TypeScript with no schema effect.
- **Rollback:** revert the script hunk (restores the corrupting behaviour — do not); `DROP TABLE` for the corrections, which loses the correction history while leaving whatever `session_attribution` currently points at.
- **Unresolved:** is this script still run, and by whom (SI-SESSIONS-14 asks the same)? It writes with a Node Prisma client whose generation "predates those ENRICH-1 columns" per its own comment at `:191-193`, which suggests it has not been regenerated in months. If it is dead, deleting it beats fencing it.
- **Safe to apply later because:** the fence is a strict narrowing of what a manually-invoked script may write — it cannot break a running system, only a human's habit — and the corrections table has no reader until a correction route exists.

---

### PP-AT-16 — Separate the staff actor from the billing subject in the audit row

**Target** `prisma/schema/platform.prisma` :119-126 and `apps/api/src/lib/audit.ts` :26-34,:58-86 · **Pkg** M07,A04,C09 · **Scen** 6,70,94,97 · **Risk** Medium · **Apply when** the enum migration is accepted — `ActorKind` is a Postgres enum, so adding values is a migration, not a code change

`AuditActionInput` has one person field, `actorUserId`, so an operator correcting
anna's session and anna correcting her own produce indistinguishable rows once
`targetId` is a session id. Scenario 70 asks for actor, subject and credential as
three distinct fields, and scenario 94 asks that a correction's actor be the
operator, not the driver — neither is expressible in the current shape.

```diff
 enum ActorKind {
   user
   system
   vendor_webhook
   ocpp_worker
+  // A04/scenario 6 — a bearer holding an invite token is not "user":
+  // there is no authenticated identity behind the request at all, and
+  // recording one as `user` names somebody who did not act.
+  bearer
+  // C09/M07 — platform staff acting inside a tenant. Distinct from
+  // `user` (a member of that tenant) and from the subject of the action.
+  support_agent
 
   @@schema("audit")
 }
```

```diff
 export interface AuditActionInput {
   orgId: string;
   actorUserId: string | null;
   actorKind: ActorKind;
+  /**
+   * M07 / scenario 70 — the person the action is ABOUT. Distinct from
+   * `actorUserId` (who did it) and from any credential recorded in
+   * `metadata` (what authorised it). One column carrying all three is
+   * why "the audit actor is the operator, not the driver" (scenario 94)
+   * cannot be asserted today.
+   */
+  subjectUserId?: string | null;
   action: string;
   targetType?: string | null;
   targetId?: string | null;
   metadata?: Record<string, unknown>;
 }
```

- **Tests to add:** a new `apps/api/src/lib/audit.test.ts` (**does not exist**) "recordAuditAction persists subjectUserId on both the Drizzle and Prisma branches" — FAILS today. The dual-client branch at `:54-56` means one test is not enough; both paths need covering or the shim will drift.
- **Migration impact:** two `ALTER TYPE … ADD VALUE` on `audit.ActorKind` plus one nullable `subject_user_id` column on `audit.actions`. Postgres cannot add an enum value inside a transaction that also uses it, so this is a two-step deploy. The Drizzle mirror `packages/shared/src/db/platform.ts:29` must gain both values in the same commit.
- **Rollback:** the column drops cleanly; the enum values do **not** — Postgres has no `DROP VALUE`. Adding them is effectively one-way, which is the main reason to decide the full value list now rather than adding `bearer` today and `support_agent` next month.
- **Unresolved:** does the support-context id (Group C, greenfield in full — no table, no module, no column) belong on this row as a third column, or in `metadata`? `metadata` is untyped JSONB and nothing validates it, so putting an access-control fact there means it can silently go missing.
- **Safe to apply later because:** the new field is optional and both writer branches ignore `undefined`; the enum additions are additive and no existing value changes meaning.

---

### PP-AT-17 — Alert when a technical token names a person, and count attribution by basis

**Target** `apps/api/src/lib/ocpp/projections.ts` :406-416,:459-471 · **Pkg** R02,R04,F01 · **Scen** 75,79,84 · **Risk** Low · **Apply when** log-based alerting exists — Cloudflare tail/Logpush is the only sink the repo uses today, and the existing single-line grep-able convention is already established

`[ledger] session_cost_recorded` logs energy, duration and cost but nothing about
who the session was attributed to or on what evidence, so there is no way to see
the invariant breaking. R02 asks for an alert on exactly the condition PP-AT-05
and PP-AT-12 make impossible in new code but which legacy rows can still produce.

```diff
+  // R02 — the invariant, watched rather than assumed. After PP-AT-02's
+  // CHECK this cannot happen for a row created since; it can still
+  // happen for a legacy technical token that was never reclassified.
+  // Single-line, grep-able, same convention as the gateway's
+  // authorize.evaluated.
+  if (driverUserId && attributionSubjectKind === "installation") {
+    console.error("[attribution] technical_token_named_person", {
+      sessionId: updated.id,
+      orgId: updated.orgId,
+      idTag: updated.idTag,
+      driverUserId,
+    });
+  }
+
   console.log("[ledger] session_cost_recorded", {
     sessionId: updated.id,
     orgId: updated.orgId,
     siteId: updated.siteId,
+    // R04 — outcomes by basis. Without these two fields the shadow-mode
+    // evidence report (F01) can count verdicts but not attributions.
+    attributionSubjectKind,
+    attributionBasis,
     energyKwh,
     durationSec,
```

- **Tests to add:** `projections.test.ts` "session.stopped logs attributionSubjectKind" — asserting on `console` output is ugly, and the honest alternative is to extract the log payload into a returned/exported object and assert on that. Neither exists today.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** revert. Loses visibility only.
- **Unresolved:** there is no alerting configuration in this repository — `.github/workflows/check.yml` has three steps and no monitoring wiring exists. "Fires" as an acceptance criterion for R02 needs a destination that someone owns, and naming that destination is outside what this branch can verify.
- **Safe to apply later because:** log-only, no branch on the result, no persistence — it cannot change behaviour whether it lands or not.

---

### PP-AT-18 — Refuse to push a subjectless credential into a charger's local auth list

**Target** `apps/api/src/repositories/local-auth-list-push.ts` :57-71,:118-145 · **Pkg** E15 · **Scen** 75,78 · **Risk** Medium · **Apply when** PP-AT-01 has shipped; harmless before then because no token can hold the class

`pushIdTokenToCharger` guards status, expiry, scope and contract, but not class.
A token pushed into a charger's local list authorizes during offline windows with
no CSMS record at all, and any session it opens is attributed later by shape
alone — which is the worst possible combination for a shared credential. The
contract gate at `:165-188` also reads `token.userId`, which PP-AT-02 makes
nullable, so this file has to change anyway.

```diff
 export class PushIdTokenError extends Error {
   constructor(
     public readonly code:
       | "identity_not_found"
       | "id_token_not_found"
       | "id_token_revoked"
       | "id_token_suspended"
       | "id_token_expired"
       | "scope_mismatch"
+      | "token_class_not_pushable"
       | "no_contract",
     message: string,
   ) {
```

```diff
   if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
     throw new PushIdTokenError(
       "id_token_expired",
       "IdToken's expiresAt is in the past.",
     );
   }
+  // E15 — class guard. An installation-technical token in a local list
+  // authorizes offline with no CSMS record, and the session it opens can
+  // never be attributed to anyone. The contract gate below cannot help:
+  // it asks about a person, and this credential has none.
+  if (token.tokenClass === "installation_technical") {
+    throw new PushIdTokenError(
+      "token_class_not_pushable",
+      "Refusing to push an installation-technical token — it names no driver, so any offline session it opens is unattributable.",
+    );
+  }
```

- **Tests to add:** an entire new `apps/api/src/repositories/local-auth-list-push.test.ts` (**does not exist** — none of the four guards in this file is covered by CI today) with "pushing an installation_technical token throws token_class_not_pushable" plus regression cases for revoked / suspended / expired / scope_mismatch / no_contract. The class case FAILS today; the other five would pass and are the more valuable addition.
- **Migration impact:** none — pure TypeScript. The route at `routes/admin/chargers.ts:491-518` maps `PushIdTokenError.code` to a status; the new code needs a case there or it falls into whatever the default branch is.
- **Rollback:** revert. Any technical token already pushed stays in the charger's list — `pushIdTokenToCharger` has no removal counterpart, so this guard prevents a state it cannot undo.
- **Unresolved:** what removes an already-pushed token? There is no delete path and no caller of the gateway's `/invalidate-authorize`, so a mistake made here is permanent until someone clears the list by hand. That gap is larger than this proposal and belongs with E15.
- **Safe to apply later because:** the branch is unreachable until an operator sets a class, so committing it early is a no-op; and it only ever refuses, never widens.

---

## Twelve cases where the current model answers wrongly

Every "says today" cell names the line that produces the behaviour. Fixture
identities only.

| # | Case | What the system says today (file and line) | What is actually true | Who is harmed | Which proposal fixes it |
|---|---|---|---|---|---|
| 1 | A shared stairwell tag is enrolled. `IdToken.userId` is `NOT NULL` (`prisma/schema/identity.prisma:205`), so the operator attaches it to admin-dagur. | `resolveAuthorize` returns `userId: token.userId` (`ocpp-authorize.ts:336`) and the stop-time re-resolve writes it to `session_ledger.driver_user_id` (`projections.ts:408-415`) — every session on that charger is dagur's. | The credential belongs to the wall. Nobody knows who charged. | admin-dagur, billed for every stranger; the host, whose usage report is fiction. | PP-AT-01, PP-AT-02, PP-AT-05, PP-AT-12 |
| 2 | Two cars start on the same technical token at one installation, on two EVSEs. | Both sessions resolve the same `userId` (`projections.ts:971-977`), and because the gateway invents its own transaction id (`identity-do.ts:961`) and `onOcppRawStopTransaction` closes by `(ocppIdentityId, status='in_progress')` picking the most recent (`projections.ts:895-899`), the wrong session may be closed too. | Two anonymous sessions. Neither names a person, and they are distinguishable only by EVSE. | The named person; the operator, who cannot reconcile. | PP-AT-05, PP-AT-11, PP-AT-12 (scenario 78 / E17) |
| 3 | driver-anna arms the app and taps her phone. `resolveAuthorize` matches the tap intent and returns her userId (`ocpp-authorize.ts:185-190`). | The gateway uses that userId only as a log field (`identity-do.ts:680`). Nothing persists it. A random emulated UID can never match an `IdToken` by construction (`random-uid.ts:38`), so the stop-time re-resolve returns null and the ledger row is `driver_user_id = NULL`. | anna charged, and the system proved it seconds earlier. | anna — no history, no invoice; the host — unbillable energy. | PP-AT-09, PP-AT-10, PP-AT-11 |
| 4 | driver-bjorn starts a session over pure OCPP with his own enrolled card. | `onSessionStarted` omits `userId` from the create (`projections.ts:185-199`), so `GET /api/driver/sessions/current` returns `[]` (`driver-sessions.ts:114` filters `user_id`) and `GET /api/driver/invoices` returns nothing (`driver-invoices.ts:53`, same filter) — while `GET /sessions/history` shows the session, because that reads the ledger. | bjorn is charging right now, and it is his session. | bjorn, whose app says he is not charging while he is. | PP-AT-11 |
| 5 | A Zaptec-webhook session was written with `sessions.user_id` = staff-carol, then a later ledger row deliberately recorded no driver. | `getSessionFullDetail` returns `driverUserId: ledger?.driverUserId ?? session.userId` (`session-full-detail.ts:388`), so the `??` discards the ledger's deliberate NULL and renders carol's name — and `driverDisplayName` (`:324-329`) prints it. | The billing ledger attributes this session to nobody. | carol, named on a session she did not have. | PP-AT-14 |
| 6 | A charger in free vend starts a session with no `idTag`. | The gateway's `if (idTag && this.meta)` (`identity-do.ts:643`) skips the entire authorize block: no upstream call, no verdict, no log line. The session lands with `id_tag = NULL` and the ledger with `driver_user_id = NULL`. | Authorized, unidentified — deliberately, by the installation's own configuration. | The operator, who cannot tell this apart from a lost tag or a failed lookup. | PP-AT-06, PP-AT-13 |
| 7 | The API worker is briefly unreachable at an installation whose gate is armed. | `AVAILABILITY_REFUSAL_STATUS` is literally `"Blocked"` (`identity-do.ts:326`) and goes on the wire through `responseFor` (`:736`), separated from a genuine deny only by an `availabilityRefusal: true` log field (`:698`). | Nothing was decided about anna's token. The backend could not be asked. | anna, told she is blocked; support, who reads "Blocked" as a token problem. | PP-AT-09 (records the outcome as a distinct decision rather than a log field) |
| 8 | An operator revokes bjorn's lost card via `DELETE /api/admin/tokens/:tokenId`. | `revokeIdToken` flips status and returns (`id-tokens.ts:229-237`). Nothing calls the gateway's `/invalidate-authorize` — zero hits in `apps/api/src` — so the DO serves the cached `Accepted` for up to `AUTHORIZE_CACHE_TTL_MS` (60 s, `identity-do.ts:275,:795-800`), and indefinitely from a charger's local list, which has no removal path. | The card is revoked. | bjorn, still attributed for sessions after revocation; the operator, who believes the card is dead. | PP-AT-18 (prevents the local-list half); the cache-invalidation half is **unresolved** and larger than this stream |
| 9 | Someone runs `backfill-session-costs.ts --commit` to repair costs. | The same `data` object is passed as both `create` and `update` (`:194-198`) with `driverUserId: s.userId` (NULL for every OCPP-origin session) and `driverIdTag: s.ocppIdentity?.identityString` (`:185`) — the charger's OCPP identity string. Correct attribution is nulled and the driver column gets a charger id. | The sessions had drivers; the script was only meant to recompute cost. | Every driver whose ledger row it touches; anyone later reading `driver_id_tag`. | PP-AT-15 |
| 10 | An operator finds an unlabelled card and wants it usable at one installation. | `createIdToken` requires a `userId` (`id-tokens.ts:119-131`, insert at `:177`), so there is no way to enrol it unbound — the operator attaches it to themselves or to the host admin. | The card is bound to nobody and should authorise as an installation credential. | Whoever the operator picked; every later attribution of that card. | PP-AT-01, PP-AT-02, PP-AT-03 |
| 11 | A `sales_cs` grant holder opens `GET /api/admin/billing/sessions?driverUserId=<anna>`. | `scopeFromQuery` turns the query param into a `LedgerScope` verbatim (`billing.ts:58-67`) with no ownership check, the repository documents that it trusts the caller (`session-ledger.ts:16-18`), and `sales_cs` reaches `billing.read` because `platform.tenant.read/write` (`permissions.ts:266-270`) is expanded into the whole per-tenant family (`effective-permissions.ts:103-125`). Rows come back carrying `driverIdTag`. | sales_cs should not be able to enumerate a named driver's sessions in an org they have no relationship with. | anna and every driver in every tenant. | PP-AT-16 records the actor properly, but the scope hole itself belongs to the permission stream, not this one — flagged, not fixed here |
| 12 | A physical card changes hands from anna to bjorn and the operator repoints it. | `updateIdToken` permits editing `value` but explicitly refuses `userId` — "token transfer between drivers" is disallowed (`id-tokens.ts:268-285`). So the operator's only move is to revoke and re-enrol, and every past session stays attributed by whatever the stop-time re-resolve found at the time (`projections.ts:408-415`), with no record connecting the two credentials. | One physical card had two holders, with a date dividing them. | bjorn, if the old token is reused; anna, whose history is now ambiguous; anyone auditing. | PP-AT-15 (correction event), PP-AT-10 (basis recorded per attribution) |
| 13 | An EVCCID token is enrolled for a household car that anna and bjorn share (`IdTokenKind.evccid`, `identity.prisma:247`). | The NOT NULL `userId` forces one owner, and `classifyIdTagFormat` reports `evccid_mac` for display only (`idtag-classifier.ts:110-126`) — nothing gates attribution on it, so every session on that car is one person's. | The credential identifies a **car**, which has two drivers. | Whichever of the two was picked. | PP-AT-01 (`vehicle_bound` class), PP-AT-06; the binding model itself is E12 and remains **unresolved** |
| 14 | A support agent corrects a disputed session's attribution. | There is no correction path — the word "dispute" appears in three files, all as prose comments. The only writable route is the backfill script in row 9, and `recordAuditAction` has one person field, `actorUserId` (`audit.ts:26-34`), so the operator and the driver cannot be distinguished on the resulting row. | The operator acted; the driver is the subject; the credential is a third thing. | The driver, if the row reads as though they corrected their own bill; the auditor. | PP-AT-15, PP-AT-16 (scenarios 70, 94, 97) |
## 19D Part 3 — agreement / cost-factor write surface and the organisation onboarding aggregate

This part proposes the diffs for Group K (agreement write surface), Group L (cost-factor
assignment) and Group G (organisation onboarding aggregate), plus the four adjacent defects
in charger onboarding that the source inventory found while reading them. **Both areas are
greenfield**, not hardening: `apps/api/src/repositories/agreements.ts:1-7` declares itself
read-only and no `prisma.agreement.create/update` exists anywhere under `apps/api/src`
(19A finding A07-1), and a repo-wide grep for `onboarding_workflow` / `onboarding_step`
returns zero hits outside `docs/` (19A finding A08-1). So most proposals below are
**new-file** proposals; the six that patch a real file are PP-AG-08, PP-ON-07, PP-ON-08,
PP-ON-09, PP-ON-10 and PP-ON-11. Nothing here has been applied — this document proposes,
it does not mutate.

Two structural facts govern the whole set and are repeated where they bite:

- There is exactly one working staged-version write surface in the repo,
  `apps/api/src/routes/admin/billing-rate-references.ts` + its repository
  `apps/api/src/repositories/billing-rate-references.ts`. Its create path
  (`createRateReference` :209-283) auto-closes the prior active row's `effectiveUntil`
  inside one `db.$transaction` and rejects a past-dated new version with
  `active_row_would_overlap`. Every agreement proposal below lifts that shape rather than
  inventing one.
- `contract.write` and `tariff.write` both end in `.write`, so
  `expandPlatformTenantVerbs` (`apps/api/src/lib/auth/effective-permissions.ts:103-138`)
  hands them to anyone holding `platform.tenant.write` — which `sales_cs` holds
  (`permissions.ts:266-270`). Gating agreement activation on a `.write` verb therefore
  does **not** keep staff out, and scenario 141 fails by construction until that is fixed.

---

### PP-AG-01 — Add a write repository for Agreement that lifts the rate-reference staged-version transaction

**Target** `apps/api/src/repositories/agreements-write.ts` **new file** · **Pkg** K01,K02,K09 · **Scen** 137,138,143 · **Risk** High · **Apply when** the Agreement Prisma model is confirmed unchanged and PP-AG-03's Zod input types exist

Today an agreement can only be created by hand in SQL or by the one-off script
`apps/api/scripts/supersede-orphan-b6771541.ts`; the operator UI can read agreements and
nothing else. This adds `createAgreementDraft`, `updateAgreementDraft`, `activateAgreement`
and `retireAgreement`, each returning a discriminated error rather than throwing, so the
route layer maps them the way `billing-rate-references.ts` already does. The immutability
rule is copied verbatim from the rate book: once `status = "active"`, the price-resolution
fields (`effectiveFrom`, `installationId`, `cpoOrgId`, `agreementType`) cannot be edited —
you stage a successor instead.

```diff
+// Write repository for agreements.agreements.
+//
+// Deliberately separate from repositories/agreements.ts, whose header (:1-7)
+// declares that file read-only for the operator UI. Keeping the read shapes
+// and the write shapes in different modules means the read module's pilot-type
+// filter (PILOT_TYPES :11) cannot silently leak into write authorisation.
+//
+// Rule lifted from repositories/billing-rate-references.ts:200-283 — an ACTIVE
+// row's resolution fields are immutable; "stage a new version" auto-closes the
+// prior row's effectiveUntil in one transaction.
+
+import type { PrismaClient } from "../generated/prisma/client";
+import type { CreateAgreementInput, UpdateAgreementDraftInput } from "../lib/billing/agreement-zod";
+
+export type AgreementWriteError =
+  | { errorCode: "not_found" }
+  | { errorCode: "active_row_immutable"; suggestion: "stage_new_version" }
+  | { errorCode: "not_draft"; currentStatus: string }
+  | { errorCode: "would_overlap"; conflictingAgreementId: string }
+  | { errorCode: "validation_error"; message: string };
+
+export async function createAgreementDraft(
+  db: PrismaClient,
+  input: CreateAgreementInput,
+): Promise<{ id: string } | AgreementWriteError> {
+  const effectiveFrom = new Date(input.effectiveFrom);
+  const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
+  if (effectiveUntil !== null && effectiveUntil <= effectiveFrom) {
+    return { errorCode: "validation_error", message: "effectiveUntil must be after effectiveFrom" };
+  }
+  const created = await db.agreement.create({
+    data: {
+      agreementType: input.agreementType,
+      counterpartyOrgId: input.counterpartyOrgId,
+      cpoOrgId: input.cpoOrgId ?? null,
+      installationId: input.installationId ?? null,
+      displayName: input.displayName,
+      status: "draft",
+      effectiveFrom,
+      effectiveUntil,
+      notes: input.notes ?? null,
+    },
+    select: { id: true },
+  });
+  return created;
+}
+
+export async function updateAgreementDraft(
+  db: PrismaClient,
+  id: string,
+  input: UpdateAgreementDraftInput,
+): Promise<{ id: string } | AgreementWriteError> {
+  const existing = await db.agreement.findUnique({
+    where: { id },
+    select: { id: true, status: true },
+  });
+  if (!existing) return { errorCode: "not_found" };
+  if (existing.status !== "draft") {
+    // Scenario 138. Same posture as patchRateReference :312-314.
+    return { errorCode: "active_row_immutable", suggestion: "stage_new_version" };
+  }
+  const updated = await db.agreement.update({
+    where: { id },
+    data: {
+      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
+      ...(input.notes !== undefined ? { notes: input.notes } : {}),
+      ...(input.effectiveFrom !== undefined ? { effectiveFrom: new Date(input.effectiveFrom) } : {}),
+      ...(input.effectiveUntil !== undefined
+        ? { effectiveUntil: input.effectiveUntil ? new Date(input.effectiveUntil) : null }
+        : {}),
+    },
+    select: { id: true },
+  });
+  return updated;
+}
```

- **Tests to add:** `apps/api/src/repositories/agreements-write.test.ts` — `createAgreementDraft persists status=draft` (scen 137), `updateAgreementDraft on an active agreement returns active_row_immutable` (scen 138), `effectiveUntil <= effectiveFrom is rejected`. All three fail today because the module does not exist; no existing test regresses because no existing test imports agreements.ts's write path (there is none).
- **Migration impact:** none — pure TypeScript against the existing `Agreement` model at `prisma/schema/commercial.prisma:483-513`.
- **Rollback:** delete the file and unmount PP-AG-02's router. Nothing is lost — drafts written by it stay in the table and remain readable through `listAgreements` :155, since `status: "draft"` is already a value `AgreementListRow` models (`agreements.ts:18`).
- **Unresolved:** `getAgreementDetail` :235-238 hides non-pilot types (`service_contractor`, `service_workplace`, `workplace`) from the UI entirely. Should the write surface accept those types and produce rows the operator then cannot read back? Recommend restricting create to `PILOT_TYPES` until the read filter is lifted.
- **Safe to apply later because:** it is purely additive — a new module, no existing import changes. The resolver reaches agreements through `loadAgreementContext` (`persist.ts:86`), which queries the table directly and is unaffected by whether a write module exists.

---

### PP-AG-02 — Mount agreement create / update / activate / retire routes ahead of the existing debug `GET /:id`

**Target** `apps/api/src/routes/admin/agreements-write.ts` **new file**, mounted in `apps/api/src/index.ts` :178 · **Pkg** K01,K02,K03,K04,K10 · **Scen** 137,138,142,143 · **Risk** High · **Apply when** PP-AG-01 and PP-AG-03 are in, and the route-ordering check below has been run

`app.route("/api/admin/agreements", adminAgreementsDebug)` at `index.ts:178` already owns
`GET /:id` (`agreements-debug.ts:42`), and `adminAgreementsResolve` is mounted one level
deeper at `/api/admin/agreements/sessions` (`index.ts:184`). A new writer mounted on the
same prefix must not shadow either. The safest shape is a fourth router mounted on the same
path with only `POST`/`PATCH` verbs, registered **before** the debug router so its
`POST /` is matched before Hono's `/:id` wildcard can see it.

```diff
  // Sprint 9 / ADR 0019 milestone A.6 — read-only debug endpoint for the
  // agreement resolver. Operator picks (driver, charger, time) and sees
  // what the resolver would emit at session-stop. Never writes.
+ // ADR 00xx — the WRITE surface mounts on the same prefix and must be
+ // registered first: adminAgreementsDebug owns GET /:id (agreements-debug.ts:42),
+ // which would otherwise swallow POST-adjacent literal segments.
+ app.route("/api/admin/agreements", adminAgreementsWrite);
  app.route("/api/admin/agreements", adminAgreementsDebug);
```

```diff
+adminAgreementsWrite.post("/", requirePermission("contract.write"), async (c) => {
+  const raw = await c.req.json().catch(() => null);
+  const parsed = CreateAgreementSchema.safeParse(raw);
+  if (!parsed.success) {
+    return c.json(
+      {
+        error: "validation_error",
+        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
+      },
+      400,
+    );
+  }
+  const db = makePrisma(c.env);
+  const result = await createAgreementDraft(db, parsed.data);
+  if ("errorCode" in result) return mapAgreementError(c, result);
+  await recordAuditAction(db, {
+    orgId: parsed.data.counterpartyOrgId,
+    actorUserId: sessionUserId(c.get("session")),
+    actorKind: "user",
+    action: "agreement.draft.create",
+    targetType: "agreement",
+    targetId: result.id,
+    metadata: { agreementType: parsed.data.agreementType, effectiveFrom: parsed.data.effectiveFrom },
+  });
+  return c.json({ agreement: result }, 201);
+});
```

- **Tests to add:** `apps/api/src/routes/admin/agreements-write.test.ts` — `POST / creates a draft and writes exactly one audit row` (scen 137, 155), `PATCH /:id on active returns 400 active_row_immutable` (scen 138), `POST /:id/retire sets effectiveUntil and deletes nothing` (scen 143). A route-ordering test asserting `GET /api/admin/agreements/<uuid>` still reaches `getAgreementDetail` fails today only if the mount order is wrong — it is the regression guard, not a new-behaviour test.
- **Migration impact:** none — pure TypeScript.
- **Rollback:** remove the single `app.route(...)` line at `index.ts:178`. Agreements created before rollback remain in the table and remain readable; nothing in the resolver distinguishes a UI-created agreement from a script-created one.
- **Unresolved:** whether `POST /:id/retire` should refuse when unbilled sessions exist inside the window it closes. Rate references answer this with a warning string, not a refusal (`billing-rate-references.ts:229-233`). Agreements probably need the stronger answer, and no one has decided.
- **Safe to apply later because:** it is a mount, not a modification. Until the `app.route` line lands the module is dead code; after it lands, every route it adds is a verb+path combination that currently 404s.

---

### PP-AG-03 — Require effective dating at the schema boundary, not at the database

**Target** `apps/api/src/lib/billing/agreement-zod.ts` **new file** · **Pkg** K06 · **Scen** 140 · **Risk** Low · **Apply when** written before PP-AG-01, which imports its types

`prisma/schema/commercial.prisma:492` makes `effectiveFrom` non-nullable but supplies no
default, so an omitted value is a Prisma error with an opaque message rather than a 400 with
a field path. Scenario 140 wants "given no effective date, then creation is refused" — this
makes the refusal legible and puts the `effectiveUntil > effectiveFrom` check in one place
that both create and update call. The sibling file `apps/api/src/lib/billing/cost-factor-zod.ts`
(`createCostFactorSchema` :67) is the naming and export convention being followed.

```diff
+import { z } from "zod";
+
+// Agreement type ↔ nullable-FK pairing is enforced by a CHECK constraint in
+// migration 20260508120000_agreements_v2 (see the comment block at
+// prisma/schema/commercial.prisma:473-482). Mirroring it here turns a
+// Postgres 23514 into a 400 with a field path.
+export const CreateAgreementSchema = z
+  .object({
+    agreementType: z.enum(["service_cpo", "installation"]),
+    counterpartyOrgId: z.string().uuid(),
+    cpoOrgId: z.string().uuid().nullish(),
+    installationId: z.string().uuid().nullish(),
+    displayName: z.string().min(1).max(200),
+    effectiveFrom: z.string().datetime(),        // K06 — required, no default
+    effectiveUntil: z.string().datetime().nullish(),
+    notes: z.string().max(2000).nullish(),
+  })
+  .superRefine((v, ctx) => {
+    if (v.agreementType === "installation" && !v.installationId) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        path: ["installationId"],
+        message: "installation agreements require an installationId",
+      });
+    }
+    if (v.agreementType === "service_cpo" && (v.installationId || v.cpoOrgId)) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        path: ["agreementType"],
+        message: "service_cpo agreements carry neither installationId nor cpoOrgId",
+      });
+    }
+  });
```

- **Tests to add:** `agreement-zod.test.ts` — `missing effectiveFrom fails with path ["effectiveFrom"]` (scen 140), `installation type without installationId fails`, `service_cpo with installationId fails`. All fail today (module absent). No existing test touches this.
- **Migration impact:** none — pure TypeScript. It restates a CHECK constraint that already exists in `20260508120000_agreements_v2`; it does not add one.
- **Rollback:** delete the file; PP-AG-01 then fails to compile, so roll both back together. Nothing persisted is lost.
- **Unresolved:** `effectiveUntil: null` currently means open-ended, and 18A K06's acceptance says "open-ended rejected". Those contradict. The rate book permits open-ended (`createRateReference` :214-216 accepts null) and the resolver relies on it (`persist.ts:139` treats `effectiveUntil: null` as still-active). Recommend K06 be read as "effective**From** required", not "effectiveUntil required" — otherwise every existing row violates it.
- **Safe to apply later because:** it is additive validation on a path that currently has no caller at all. Tightening a schema nobody sends to cannot break a client.

---

### PP-AG-04 — Add the btree_gist exclusion constraint that scenario 139 asserts and that does not exist

**Target** `prisma/migrations/<ts>_agreement_overlap_exclusion/migration.sql` **new file** · **Pkg** K05 · **Scen** 139 · **Risk** High · **Apply when** a staging query has confirmed zero currently-overlapping active installation agreements, because the constraint is validated on creation

Grepping all of `prisma/migrations/` for `EXCLUDE`, `btree_gist` or `tstzrange` returns
nothing; `Agreement` has four plain `@@index` declarations
(`prisma/schema/commercial.prisma:507-510`) and no range constraint. The overlap case is
handled today at **read** time in `apps/api/src/lib/agreement/persist.ts:143-165`: a
`prisma.agreement.count` fires, and if it exceeds 1 a `console.warn` names the installation
and the count, then `findFirst` picks the winner deterministically via
`orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }]`. That behaviour is correct and should
**stay** after the constraint lands — it is the only thing that would catch a row inserted
by a path the constraint does not cover.

```diff
+-- Scenario 139 / K05. Two ACTIVE installation agreements must not cover
+-- overlapping time for the same installation.
+--
+-- Until this lands the overlap is handled at READ time only:
+-- apps/api/src/lib/agreement/persist.ts:143-165 counts the matches, warns
+-- to the Workers log, and picks the newest by (effective_from desc, id asc).
+-- That is a mitigation, not a guarantee — it makes the collision deterministic
+-- and visible, it does not prevent it. Keep it after this migration: it is
+-- the detector for any row that reaches the table by a path this constraint
+-- does not cover (e.g. a partial index bypass via status flip ordering).
+CREATE EXTENSION IF NOT EXISTS btree_gist;
+
+ALTER TABLE agreements.agreements
+  ADD CONSTRAINT agreements_installation_active_no_overlap
+  EXCLUDE USING gist (
+    installation_id WITH =,
+    tstzrange(effective_from, effective_until, '[)') WITH &&
+  )
+  WHERE (status = 'active' AND installation_id IS NOT NULL);
```

- **Tests to add:** an integration test `agreement-overlap.test.ts` asserting the second activation raises Postgres 23P01 (scen 139, K05, L11). It cannot run in CI today — there is no DATABASE_URL secret in this repo and `check:migrations` is deliberately unwired for exactly that reason (`.github/workflows/check.yml:11-45`). Mark it `test:integration` and run it by hand against a Neon branch.
- **Migration impact:** creates an extension and a validated constraint. `CREATE EXTENSION` needs privileges the app role may not hold on Neon — verify before scheduling. The constraint scan is O(rows) and `agreements.agreements` is small, so lock duration is short, but it is an ACCESS EXCLUSIVE lock on the table the live resolver reads.
- **Rollback:** `ALTER TABLE agreements.agreements DROP CONSTRAINT agreements_installation_active_no_overlap;`. Leave `btree_gist` installed — dropping it is riskier than keeping it. What is lost on rollback: nothing that exists yet, since no overlapping rows can have been created while it was on.
- **Unresolved:** the constraint above covers `installation` agreements only. `workplace` agreements are keyed on `cpo_org_id` and overlap is arguably legitimate there (a driver can be in two workplace groups). `persist.ts:167-186` does a `findMany` for workplace agreements and merges them, which implies overlap is by design. Confirm before widening.
- **Safe to apply later because:** the read-time handling at `persist.ts:143-165` already makes an overlap deterministic and logged, so deferring costs observability sharpness, not correctness of the picked row. It is also strictly additive — no existing query plan changes.

---

### PP-AG-05 — Add draft-only clause add/remove against `agreements.cost_factors`

**Target** `apps/api/src/repositories/agreement-clauses-write.ts` **new file** · **Pkg** K12,L02 · **Scen** 145,146 · **Risk** High · **Apply when** PP-AG-01 is in, so `status !== "draft"` refusal is centralised

To be explicit about which of the two cost-factor tables this is: clauses reference
**`agreements.cost_factors`** (`AgreementCostFactor`, `prisma/schema/commercial.prisma:429-445`,
codes DSO/ELE/ACS/PRM/TRF/SRF/RNT/MTR) — the table the resolver actually walks. It is
**not** `billing.cost_factors` (`CostFactor`, `:105-122`), which is what
`billing-cost-factors.ts` CRUDs and which the agreements resolver never reads. The only
write surface `agreements.cost_factors` has today is the read-only select-options endpoint
at `billing-rate-references.ts:43-55`. `AgreementClause` has `@@unique([agreementId, costFactorId])`
(`:534`), so add is naturally idempotent-by-conflict.

```diff
+// Clause writes target agreements.cost_factors (AgreementCostFactor), the
+// table the resolver walks via loadAgreementContext -> clauses.costFactor.
+// NOT billing.cost_factors (CostFactor), which billing-cost-factors.ts CRUDs
+// and which no agreement ever references. Two tables, same @@map("cost_factors"),
+// different @@schema — see prisma/schema/commercial.prisma:105 and :429.
+export async function addClauseToDraft(
+  db: PrismaClient,
+  agreementId: string,
+  input: AddClauseInput,
+): Promise<{ id: string } | AgreementWriteError> {
+  const agreement = await db.agreement.findUnique({
+    where: { id: agreementId },
+    select: { status: true },
+  });
+  if (!agreement) return { errorCode: "not_found" };
+  if (agreement.status !== "draft") {
+    return { errorCode: "not_draft", currentStatus: agreement.status };
+  }
+  // allocationJson is validated by allocationSchema from
+  // @straumvakt/commercial/agreement/types (:91) BEFORE it reaches here, so
+  // the UPPERCASE-bearer preprocess at types.ts:69 is applied on write too —
+  // otherwise new rows repeat the "USR" vs "usr" drift that made the resolver
+  // reject every seeded clause until 2026-08-07.
+  const parsedAllocation = allocationSchema.safeParse(input.allocation);
+  if (!parsedAllocation.success) {
+    return { errorCode: "validation_error", message: "allocation_json failed allocationSchema" };
+  }
+  const created = await db.agreementClause.create({
+    data: {
+      agreementId,
+      costFactorId: input.costFactorId,
+      defaultBearerType: input.defaultBearerType,
+      defaultBearerRef: input.defaultBearerRef ?? null,
+      defaultRateRefCode: input.defaultRateRefCode ?? null,
+      allocationJson: parsedAllocation.data,
+    },
+    select: { id: true },
+  });
+  return created;
+}
```

- **Tests to add:** `agreement-clauses-write.test.ts` — `addClauseToDraft rejects when agreement is active` (K12), `allocation with UPPERCASE bearer codes is normalised to lowercase on write` (guards the `types.ts:53-69` failure mode), `duplicate (agreementId, costFactorId) surfaces as a conflict not a 500`. All fail today.
- **Migration impact:** none — pure TypeScript. `AgreementClause` already exists with the unique constraint.
- **Rollback:** delete the module and its routes. Clauses already written stay; they are indistinguishable from seeded ones, which is the point.
- **Unresolved:** `defaultBearerRef` is "required when defaultBearerType=trd" per the schema comment at `:527`, but that is a comment, not a constraint. Should the repository enforce it, or should a migration add a CHECK? Enforcing it in TypeScript only leaves the script path unguarded.
- **Safe to apply later because:** clause rows are only read by `loadAgreementContext` for agreements that are already `status = "active"` (`persist.ts:138`). A draft's clauses are inert until PP-AG-02's activate runs, so adding the write path early cannot change any price.

---

### PP-AG-06 — Add scoped cost-factor assignment via BearerRule, with effective dating and no per-driver tier

**Target** `apps/api/src/repositories/bearer-rules-write.ts` **new file** · **Pkg** L01,L02,L03,L10 · **Scen** 145,146 · **Risk** High · **Apply when** PP-AG-05 is in and the scope enum question below is answered

"Assign a cost factor to a scope" is a `BearerRule` row: `scopeType` is one of
`site / installation / circuit / charger` (`RULE_SCOPES`,
`packages/commercial/src/agreement/types.ts:16`) and `audienceType` is
`driver_group / user` (`RULE_AUDIENCES` :19). There is no `org` or `driver_group` tier in
`RuleScope`, so L01's proposed enum `org/group/installation/charger` does **not** match
what the resolver walks — this proposal keeps the resolver's enum and lets L01's "no
per-driver scope" (scenario 146) be enforced by refusing `audienceType: "user"` at the
write boundary rather than by removing anything.

```diff
+// L01 / scenario 146 — "per-driver scope rejected for beta".
+//
+// Note the shape: RULE_SCOPES (types.ts:16) is site|installation|circuit|charger
+// and carries no per-driver tier at all. The per-driver capability lives on the
+// AUDIENCE axis (RULE_AUDIENCES :19 = driver_group|user). So the beta restriction
+// is "audienceType may not be 'user'", not "scopeType may not be 'driver'".
+// The column stays nullable and the enum keeps `user`, so lifting the beta
+// restriction later is a one-line change here and no migration.
+const BETA_FORBIDDEN_AUDIENCE = "user" as const;
+
+export async function assignBearerRule(
+  db: PrismaClient,
+  agreementId: string,
+  input: AssignBearerRuleInput,
+): Promise<{ id: string } | AgreementWriteError> {
+  if (input.audienceType === BETA_FORBIDDEN_AUDIENCE) {
+    return {
+      errorCode: "validation_error",
+      message: "per-driver bearer rules are not available in beta — scope to a driver_group",
+    };
+  }
+  const effectiveFrom = new Date(input.effectiveFrom);          // L10 — required
+  const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
+  if (effectiveUntil !== null && effectiveUntil <= effectiveFrom) {
+    return { errorCode: "validation_error", message: "effectiveUntil must be after effectiveFrom" };
+  }
+  const created = await db.bearerRule.create({
+    data: {
+      agreementId,
+      costFactorId: input.costFactorId,
+      scopeType: input.scopeType ?? null,
+      scopeId: input.scopeId ?? null,
+      audienceType: input.audienceType ?? null,
+      audienceId: input.audienceId ?? null,
+      bearerType: input.bearerType ?? null,
+      rateRefCode: input.rateRefCode ?? null,
+      allocationJson: input.allocation ?? null,
+      effectiveFrom,
+      effectiveUntil,
+    },
+    select: { id: true },
+  });
+  return created;
+}
+
+/** L03 — retire an assignment by closing its window. Never deletes: historical
+ *  resolution for already-priced sessions must stay reproducible. */
+export async function retireBearerRule(
+  db: PrismaClient,
+  id: string,
+  at: Date,
+): Promise<{ id: string } | AgreementWriteError> {
+  const existing = await db.bearerRule.findUnique({ where: { id }, select: { effectiveFrom: true } });
+  if (!existing) return { errorCode: "not_found" };
+  if (at <= existing.effectiveFrom) {
+    return { errorCode: "validation_error", message: "retire time must be after effectiveFrom" };
+  }
+  return db.bearerRule.update({ where: { id }, data: { effectiveUntil: at }, select: { id: true } });
+}
```

- **Tests to add:** `bearer-rules-write.test.ts` — `audienceType "user" is refused` (scen 146), `a charger-scoped rule resolves for that charger only` driven through `resolveBillingLines` (scen 145, and it is the one that proves the write shape matches what the resolver reads), `retireBearerRule never deletes`. All fail today.
- **Migration impact:** none — `BearerRule` exists at `prisma/schema/commercial.prisma:726-751` with every column used above, including the composite resolver index at `:747`.
- **Rollback:** delete the module. Rules already written keep resolving — `persist.ts` loads them with `include: { bearerRules: true }` regardless of who wrote them. That is why rollback is not free: a retired-by-UI rule stays retired.
- **Unresolved:** `agreements.bearer_rules` is empty today (noted in `20260807120000_drop_never_used_tables/migration.sql`, which explicitly spared it because the live engine reads it). So the first write to this table is also the first time the rule-walk executes against real data. Someone must decide whether that happens on staging behind a specific installation first.
- **Safe to apply later because:** every rule carries `effectiveFrom`, and the resolver filters on it (`resolve.ts` `pickActiveRate` :123). A rule written with a future `effectiveFrom` is inert until that time, so the write path can be shipped and exercised before it can change any price.

---

### PP-AG-07 — Add tenant-scoped driver-group create/retire under an agreement

**Target** `apps/api/src/repositories/driver-groups-write.ts` **new file** · **Pkg** K09,L07 · **Scen** 145 · **Risk** Medium · **Apply when** PP-AG-01 is in

Driver **membership** assignment already exists and is tenant-guarded:
`apps/api/src/routes/admin/driver-group-memberships.ts` is mounted at
`/api/admin/orgs/:orgId/driver-group-memberships` (`index.ts:155`), is idempotent, and
refuses when `DriverGroup.ownerOrgId` does not match the URL `:orgId` (its header :11-14).
What has no write surface is the **group** itself — you cannot create the `DriverGroup` that
those memberships hang off. This adds that, reusing the same cross-tenant guard shape so
the two surfaces cannot disagree about who owns a group.

```diff
+// Cross-tenant guard mirrors routes/admin/driver-group-memberships.ts:11-14 —
+// DriverGroup.ownerOrgId must equal the :orgId in the URL. Stated here as well
+// because the two surfaces must not drift: if a group can be CREATED under
+// org A pointing at org B's agreement, the membership guard is decorative.
+export async function createDriverGroup(
+  db: PrismaClient,
+  orgId: string,
+  input: CreateDriverGroupInput,
+): Promise<{ id: string } | AgreementWriteError> {
+  const agreement = await db.agreement.findUnique({
+    where: { id: input.agreementId },
+    select: { counterpartyOrgId: true, cpoOrgId: true, status: true },
+  });
+  if (!agreement) return { errorCode: "not_found" };
+  if (orgId !== input.ownerOrgId) {
+    return { errorCode: "validation_error", message: "ownerOrgId must match the :orgId path segment" };
+  }
+  const created = await db.driverGroup.create({
+    data: {
+      agreementId: input.agreementId,
+      ownerOrgId: input.ownerOrgId,
+      displayName: input.displayName,
+      scopeFilterJson: input.scopeFilter ?? {},
+    },
+    select: { id: true },
+  });
+  return created;
+}
```

- **Tests to add:** `driver-groups-write.test.ts` — `createDriverGroup refuses when ownerOrgId != :orgId` (the cross-tenant case: org_alpha operator cannot create a group owned by org_beta), `scopeFilterJson defaults to {}` (matching the schema default at `:544`). Both fail today.
- **Migration impact:** none — `DriverGroup` exists at `prisma/schema/commercial.prisma:539-556`.
- **Rollback:** delete the module. Groups already created keep their memberships and keep resolving; `listAgreementMembershipsForUser` :110 reads them without caring who created them.
- **Unresolved:** `DriverGroup` has no status or soft-delete column, and `Agreement.defaultDriverGroupId` (`:490`) points at one for public installations. Retiring a group that is some agreement's default would leave a dangling FK reference with no guard. No decision exists on whether groups are retirable at all.
- **Safe to apply later because:** a group with no memberships confers no access — `loadAgreementContext` reaches a driver only through `driverGroups: { some: { memberships: { some: { userId } } } }` (`persist.ts:176`). An empty group is a shape, not a grant.

---

### PP-AG-08 — Make `contract.write` and `tariff.write` actually guard something, and fix the staff-escalation hole that breaks scenario 141

**Target** `apps/api/src/routes/admin/billing-cost-factors.ts` :50,:97,:163,:188 and `apps/api/src/lib/auth/effective-permissions.ts` :108-119 · **Pkg** K11,K07,L07 · **Scen** 141,142 · **Risk** High · **Apply when** the permission-bundle consequence below has been accepted, because this change removes access from at least one role

`contract.write` and `tariff.write` are declared (`permissions.ts:69,:72`) and bundled into
ADMIN (`:152-153`) and partly into FINANCE (`:175`), yet `requirePermission("contract.write")`
and `requirePermission("tariff.write")` appear in zero route files — every billing mutation
is gated on `billing.write`. Worse for K07: both verbs end in `.write`, so
`expandPlatformTenantVerbs` :112-119 sweeps them into the WRITES set and grants them to
anyone with `platform.tenant.write`, which `sales_cs` holds (`permissions.ts:266-269`,
where the "column-restricted in repo layer" comment describes a mitigation that is not
implemented). **Gating agreement activation on `contract.write` therefore does not keep
staff out** — scenario 141 fails by construction until the expansion is narrowed.

```diff
   const WRITES: PerTenantPermission[] = PER_TENANT_PERMISSIONS.filter(
     (p) =>
-      p.endsWith(".write") ||
+      (p.endsWith(".write") &&
+        // Commercial verbs are NOT tenant-support verbs. sales_cs holds
+        // platform.tenant.write for org notes/tags; sweeping contract.write and
+        // tariff.write in with it means a sales agent can activate a priced
+        // agreement in every org. Scenario 141 requires org-admin-only.
+        p !== "contract.write" &&
+        p !== "tariff.write") ||
       p === "member.invite" ||
       p === "member.remove" ||
       p === "billing.export" ||
       p === "charger.config" ||
       p === "charger.remote_start" ||
       p === "charger.remote_stop",
   );
```

```diff
-costFactorsRouter.post("/", requirePermission("billing.write"), async (c) => {
+costFactorsRouter.post("/", requirePermission("tariff.write"), async (c) => {
```

- **Tests to add:** `effective-permissions.test.ts` — `sales_cs does not receive contract.write via platform.tenant.write` (fails today: it does receive it), `platform_admin still receives charger.config`. And `agreements-write.test.ts` — `a sales_cs session gets 403 on POST /:id/activate` (scen 141, fails today for two independent reasons: the route does not exist, and the verb would be granted if it did).
- **Migration impact:** none — pure TypeScript. No grant rows change; only the in-memory expansion changes.
- **Rollback:** revert both hunks. What is lost: nothing persisted. But note the asymmetry — while this is deployed, `sales_cs` sessions lose an ability they silently had, and any internal workflow depending on it breaks loudly rather than quietly.
- **Unresolved:** FINANCE_BUNDLE (`permissions.ts:170-178`) holds `contract.write` and `tariff.read` but **not** `tariff.write`. Switching the cost-factor catalogue routes from `billing.write` to `tariff.write` therefore locks finance out of the catalogue they arguably own. Either add `tariff.write` to FINANCE_BUNDLE in the same change, or introduce a `requireAnyPermission` helper — no such helper exists today (only `requirePermission` and `assertPermission` in `require-permission.ts`).
- **Safe to apply later because:** it is not safe to defer indefinitely — it is the only proposal here that closes an existing privilege hole rather than adding a surface. But the two hunks are independent: the `effective-permissions.ts` narrowing can ship alone, before any agreement route exists, and it is the half that matters.

---

### PP-AG-09 — Make pricing preview call the resolver instead of becoming the fourth pricing implementation

**Target** `apps/api/src/routes/admin/agreements-preview.ts` **new file** · **Pkg** K08,L05,L12 · **Scen** 144,145 · **Risk** Medium · **Apply when** PP-AG-02's router exists, so the preview mounts beside the write surface it previews

There are three pricing implementations in the tree right now: the legacy tariff chain
(`lib/tariff/compute-session-cost.ts:112`, which prices every real session), the agreements
resolver (`packages/commercial/src/agreement/resolve.ts:34`, which has priced zero), and the
driver-pricing headline summarisers (`driver-pricing.ts` `summarisePerKwhForList` :175,
`summariseForCharger` :208, whose own header at :25-34 states that BearerRule overrides are
out of scope for the headline). A preview that computes its own numbers would be the fourth.
This proposal writes no arithmetic at all: it calls the same two functions `debug-resolve`
already calls — `loadAgreementContext` (`persist.ts:86`) then `resolveBillingLines`
(`resolve.ts:34`) — and reuses the exact `BillingLineJson` mapping from
`agreements-debug.ts:134-152`.

```diff
+// K08 / scenario 144 — "preview uses the existing resolver and matches actual
+// resolution". The whole point of this file is that it contains NO pricing
+// arithmetic. It calls loadAgreementContext + resolveBillingLines, the same
+// pair agreements-debug.ts:104-132 calls, and serialises with the shared
+// mapper. If a number here disagrees with a real session's billing_lines, the
+// resolver is wrong — not this endpoint.
+//
+// Distinct from driver-pricing.ts's summarisers (:175, :208): those walk clause
+// DEFAULTS only and skip BearerRule overrides by design (see its header :25-34).
+// This does not replace them; it is the operator-facing, override-aware view.
+import { resolveBillingLines } from "../../lib/agreement/resolve";
+import { loadAgreementContext } from "../../lib/agreement/persist";
+import { toBillingLineJson } from "./agreements-line-json";  // extracted from agreements-debug.ts:134-152
+
+adminAgreementsPreview.post("/:id/preview", requirePermission("billing.read"), async (c) => {
+  const parsed = PreviewSchema.safeParse(await c.req.json().catch(() => ({})));
+  if (!parsed.success) return c.json({ error: "invalid_input", details: parsed.error.format() }, 400);
+  const prisma = makePrisma(c.env);
+  const result = await loadAgreementContext(prisma, {
+    userId: parsed.data.userId,
+    chargingStationId: parsed.data.chargingStationId,
+    at: parsed.data.at ? new Date(parsed.data.at) : new Date(),
+    energyKwh: parsed.data.energyKwh ?? 10,
+    durationMinutes: parsed.data.durationMinutes ?? 60,
+    durationDays: (parsed.data.durationMinutes ?? 60) / (60 * 24),
+  });
+  if (!result.granted) return c.json({ granted: false, reason: result.reason });
+  return c.json({ granted: true, billingLines: resolveBillingLines(result.ctx).map(toBillingLineJson) });
+});
```

- **Tests to add:** `agreements-preview.test.ts` — `preview output equals resolveAndPersistForSession output for the same inputs` (scen 144; this is the one that fails today, because no preview endpoint exists to compare against). Also `agreements-line-json.test.ts` guarding that the extracted mapper still matches `BillingLineDraft` — the drift `agreements-debug.ts:63-68` documents having already happened once when `RATE_BASES` gained `per_connector`.
- **Migration impact:** none — pure TypeScript. Extracting `toBillingLineJson` out of `agreements-debug.ts` is a move, not a behaviour change.
- **Rollback:** unmount the route; `agreements-debug.ts` keeps working because the extracted mapper stays. If you also revert the extraction, revert both together.
- **Unresolved:** preview against a **draft** agreement is not possible as written — `loadAgreementContext` filters `status: "active"` (`persist.ts:138`). Previewing a draft (which is the whole point before activation) needs either a status parameter threaded into the loader or a separate loader. That is a real design question K08 does not answer.
- **Safe to apply later because:** it is read-only and calls only functions that already run in production on the debug path. It cannot write a billing line — `resolveBillingLines` returns drafts; only `resolveAndPersistForSession` (`persist.ts:335`) persists, and this does not call it.

---

### PP-AG-10 — Record the supersede chain and an activation pricing snapshot

**Target** `prisma/schema/commercial.prisma` :483-513 plus `prisma/migrations/<ts>_agreement_supersede_chain/migration.sql` **new file** · **Pkg** K10,K13 · **Scen** 142,143,155 · **Risk** Medium · **Apply when** PP-AG-02 exists to populate the column, and after PP-AG-04 (both touch the same table)

`Agreement` has no link from a successor back to the row it replaced, so the "stage new
version" flow the rate book models (`billing-rate-references.ts:11-12`) produces two
unrelated rows and the operator cannot see the chain. Scenario 142 additionally wants
activation "audited with a pricing snapshot" — meaning the audit metadata must carry what
the resolver **would** have emitted at activation time, so a later dispute can be answered
without re-deriving from mutable rows. Note `prisma/schema/` is a Prisma **schema folder**
(its own header at `schema.prisma:15-20` says so); there is no `prisma/schema.prisma` file
to edit, and `apps/api/prisma/schema/` is a generated copy produced by
`scripts/sync-api-prisma-schema.mjs`, so it must not be hand-edited.

```diff
   model Agreement {
     id                    String              @id @default(uuid()) @db.Uuid
     agreementType         AgreementType       @map("agreement_type")
     counterpartyOrgId     String              @map("counterparty_org_id") @db.Uuid
     cpoOrgId              String?             @map("cpo_org_id") @db.Uuid
     installationId        String?             @map("installation_id") @db.Uuid
     defaultDriverGroupId  String?             @map("default_driver_group_id") @db.Uuid // public installations only
     displayName           String              @map("display_name")
     status                AgreementStatus     @default(draft)
     effectiveFrom         DateTime            @map("effective_from") @db.Timestamptz(6)
     effectiveUntil        DateTime?           @map("effective_until") @db.Timestamptz(6)
+    // K13 — successor link. Nullable and self-referential: a chain head has
+    // NULL. Set by the activate transaction at the same moment the predecessor's
+    // effectiveUntil is auto-closed, so the two facts cannot disagree.
+    supersedesAgreementId String?             @map("supersedes_agreement_id") @db.Uuid
     notes                 String?
     createdAt             DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt             DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)
+
+    supersedes            Agreement?          @relation("AgreementSupersede", fields: [supersedesAgreementId], references: [id], onDelete: Restrict)
+    supersededBy          Agreement[]         @relation("AgreementSupersede")
```

- **Tests to add:** `agreements-write.test.ts` — `activating a successor sets supersedesAgreementId and closes the predecessor in one transaction` (K13), `activation writes exactly one audit row whose metadata contains the resolved line set` (scen 142, 155). Both fail today.
- **Migration impact:** one nullable column plus a self-referential FK with `ON DELETE RESTRICT`. Additive and backfill-free — every existing row keeps NULL, which correctly means "chain head". Regenerate `apps/api/prisma/schema/` via `scripts/sync-api-prisma-schema.mjs`; `npm run check:api-schema` (one of the nine checks in `scripts/check-all.mjs:17`) fails if you forget.
- **Rollback:** drop the column and the relation. Lost: the chain links recorded while it was live — they are not reconstructible from `effectiveFrom` alone once two supersedes share a timestamp.
- **Unresolved:** should the activation snapshot live in `audit.actions.metadata` (JSONB, unbounded, already written by `recordAuditAction`) or in its own table? A snapshot of every line for a large agreement could be sizeable, and `audit.actions` has no retention policy that this document verified.
- **Safe to apply later because:** the column is nullable with no default and nothing reads it — the resolver's queries (`persist.ts:133-165`) select by type, installation, status and dates only. Adding it later backfills as NULL, which is the correct value for every pre-existing row.

---

### PP-AG-11 — Ship the `per_connector` enum migration before any rate reference tries to use it, and start the agreement tables empty

**Target** `prisma/migrations/<ts>_rate_basis_per_connector/migration.sql` **new file** · **Pkg** K14 · **Scen** 139,140 · **Risk** Medium · **Apply when** it is confirmed that no code path writes `basis: "per_connector"` yet — today none can, and that is the window

`per_connector` is declared in three places — `prisma/schema/commercial.prisma:406`,
`packages/shared/src/db/commercial.ts:46` and `RATE_BASES` in
`packages/commercial/src/agreement/types.ts:38-44` — but grepping `prisma/migrations/` for
`per_connector` returns nothing, and `types.ts:34-37` says so explicitly: the Postgres enum
"does NOT yet carry this value". The schema files are ahead of the database. Anyone running
`prisma migrate` against staging generates this `ALTER TYPE` implicitly; writing it as an
explicit migration makes it reviewable instead of incidental. Related: K14 says "new tables
start empty, no legacy backfill" — that is already true and should be stated so nobody
writes a backfill later.

```diff
+-- ADR 0019 addendum 2026-08-08 — flat platform fee (Straumvakt→host, principal).
+--
+-- The union in packages/commercial/src/agreement/types.ts:38-44 has carried this
+-- value since 2026-08-08 while the Postgres enum did not, deliberately: the
+-- resolver and its tests were settled before the schema moved (types.ts:34-37).
+-- This closes that gap. It does NOT backfill: agreements.rate_references has no
+-- row that should become per_connector, and K14's rule is that agreement tables
+-- start empty rather than inheriting legacy tariff rows.
+ALTER TYPE agreements."RateBasis" ADD VALUE IF NOT EXISTS 'per_connector';
```

- **Tests to add:** none new. The existing `packages/commercial/src/agreement/resolve.test.ts` already carries a `describe("per_connector basis")` block (added 2026-08-08) that its forked twin `apps/api/src/lib/agreement/resolve.test.ts` lacks — both run under the root `vitest.config.ts` include list, and neither runs in CI (`scripts/check-all.mjs` has nine checks, none of them vitest). Reconciling the fork is a prerequisite for trusting either.
- **Migration impact:** `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on older Postgres and is irreversible — Postgres has no `DROP VALUE`. Prisma wraps migrations in a transaction by default; this may need `-- prisma-migrate: no-transaction` or a manual apply. Unverified which applies on the Neon version in use.
- **Rollback:** none available. An enum value cannot be removed without recreating the type and rewriting every dependent column. That is the reason to ship it while zero rows can use it.
- **Unresolved:** `basisQuantityFor` in `resolve.ts` throws when a `per_connector` rate is resolved through the session path (by design — a connector count is not session-derived). So storing such a rate creates a row that the session resolver refuses. Who computes the connector count, and on what schedule, is undecided.
- **Safe to apply later because:** it is additive to an enum and nothing can currently write the value — the resolver refuses it on the session path and no write surface for `RateReference.basis` accepts it (`CreateRateReferenceSchema` validates against the generated `RateBasis`). Deferring costs nothing until the first per-connector rate is needed; at that point it is a hard blocker.

---

### PP-ON-01 — Create the onboarding workflow and step tables with a partial unique index

**Target** `prisma/schema/identity.prisma` (model additions) plus `prisma/migrations/<ts>_onboarding_workflow/migration.sql` **new file** · **Pkg** G01,G02,G03,G04 · **Scen** 99,100 · **Risk** High · **Apply when** the schema home question below is settled — this is the first structural decision and everything in Group G depends on it

Nothing named `onboarding_workflow`, `onboarding_step` or `onboarding_substep` exists
anywhere in the repo outside `docs/` — the aggregate is entirely absent, so scenarios 99-112
are greenfield rather than a hardening job. What exists adjacent to it is
`assets.installations.onboarding_status` (`prisma/schema/assets.prisma:160`, enum
`InstallationOnboardingStatus` at `:228-236` with values
`pending_credentials / discovering / active / suspended / error`) — a per-installation
column that nothing drives through a lifecycle. The org-level workflow is a different thing
and must not reuse that enum.

```diff
+// ADR 00xx / Group G — organisation onboarding aggregate.
+//
+// Distinct from assets.installations.onboarding_status (assets.prisma:160),
+// which tracks ONE installation's credential state. This tracks an ORG's
+// commercial onboarding and is the thing that gates access (scenario 107).
+model OnboardingWorkflow {
+  id            String                   @id @default(uuid()) @db.Uuid
+  orgId         String                   @map("org_id") @db.Uuid
+  status        OnboardingWorkflowStatus @default(draft)
+  version       Int                      @default(1)
+  idempotencyKey String?                 @map("idempotency_key")
+  startedByUserId String?                @map("started_by_user_id") @db.Uuid
+  startedByKind ActorKind                @map("started_by_kind")
+  createdAt     DateTime                 @default(now()) @map("created_at") @db.Timestamptz(6)
+  updatedAt     DateTime                 @updatedAt @map("updated_at") @db.Timestamptz(6)
+
+  organization  Organization             @relation(fields: [orgId], references: [id], onDelete: Cascade)
+  steps         OnboardingStep[]
+
+  @@index([orgId, status])
+  @@map("onboarding_workflows")
+  @@schema("tenancy")
+}
+
+enum OnboardingWorkflowStatus {
+  draft
+  ready
+  active
+  suspended
+  cancelled
+
+  @@schema("tenancy")
+}
```

```diff
+-- G02 / scenario 100 — at most ONE open workflow per org. Prisma cannot express
+-- a partial unique index, so it is raw SQL and the model above carries only a
+-- plain @@index. "Open" is draft|ready|active|suspended; cancelled rows are
+-- excluded so an org can be re-onboarded after cancellation (scenario 109).
+CREATE UNIQUE INDEX onboarding_workflows_one_open_per_org
+  ON tenancy.onboarding_workflows (org_id)
+  WHERE status <> 'cancelled';
```

- **Tests to add:** `onboarding-workflow.test.ts` — `a second open workflow for the same org raises 23505` (scen 100), `a cancelled workflow does not block a new one` (scen 109). Both are integration tests and cannot run in CI (no DATABASE_URL secret; see `.github/workflows/check.yml:11-45`).
- **Migration impact:** two new tables, one enum, one partial unique index. No backfill — every existing org starts with no workflow, which PP-ON-02 renders as "not tracked yet". Regenerate `apps/api/prisma/schema/` via `scripts/sync-api-prisma-schema.mjs` or `check:api-schema` goes red.
- **Rollback:** drop both tables, the enum and the index. Lost: every workflow and step recorded. Since nothing else reads them, no other surface breaks.
- **Unresolved:** which Postgres schema owns this. `Organization` lives in `tenancy`; audit lives in `platform`. Putting it in `tenancy` (as above) is a guess — 18A doc 11 A1 does not say, and moving it later is a table rename across two generated schema copies.
- **Safe to apply later because:** the tables are additive and nothing queries them. Every consumer added by PP-ON-02 through PP-ON-07 is written to treat "no row" as a first-class answer, so a database without these tables and a database with zero rows in them are indistinguishable to every other surface.

---

### PP-ON-02 — Serve the workflow summary, and make "no workflow" an explicit answer rather than a derived one

**Target** `apps/api/src/routes/admin/org-onboarding.ts` **new file**, mounted on `adminOrgs` · **Pkg** G06 · **Scen** 111,112,150 · **Risk** Medium · **Apply when** PP-ON-01's tables exist

`apps/api/src/routes/admin/orgs.ts` (411 lines) registers no `/onboarding` sub-route, so
`GET /api/admin/orgs/:orgId/onboarding` — one of the three endpoints 18D names — returns 404
today. The important part is not the happy path but the empty one: scenario 112 requires the
UI to say "this isn't tracked yet" rather than inferring progress from whatever rows happen
to exist. That only holds if the API distinguishes *absent* from *empty*, so this returns
`{ workflow: null, tracked: false }` and never a synthesised zero-progress object.

```diff
+// G06 / scenarios 111-112. Mounted on adminOrgs so it inherits requireAdmin
+// (orgs.ts:49) and the { orgIdParam: "orgId" } scoping convention used by
+// every sibling route (e.g. orgs.ts:97).
+//
+// The absent case is deliberate and load-bearing: `tracked: false` is NOT the
+// same as a workflow with zero completed steps. Deriving progress from org
+// rows would let the UI claim onboarding state that no one ever asserted —
+// scenario 112 exists to forbid exactly that.
+adminOrgs.get(
+  "/:orgId/onboarding",
+  requirePermission("org.read", { orgIdParam: "orgId" }),
+  async (c) => {
+    const db = makePrisma(c.env);
+    const workflow = await getOnboardingWorkflow(db, c.req.param("orgId"));
+    if (!workflow) {
+      return c.json({ tracked: false, workflow: null });
+    }
+    return c.json({ tracked: true, workflow });
+  },
+);
```

- **Tests to add:** `org-onboarding.test.ts` — `an org with no workflow returns tracked:false and workflow:null, never a zero-progress object` (scen 112 — this is the one that fails today, since the route 404s), `the summary shape matches OnboardingSummary` (scen 111, a shape test against the contract package).
- **Migration impact:** none — pure TypeScript on top of PP-ON-01.
- **Rollback:** remove the route registration. The UI must already handle 404 and `tracked:false` identically for this to be safe, which is worth asserting in the client.
- **Unresolved:** `org.read` is the gate chosen above by analogy with `orgs.ts:97`'s `org.write`. Whether a driver-facing or host-facing caller ever needs this summary is undecided; if so the verb is wrong.
- **Safe to apply later because:** it is a read-only GET on a path that currently 404s. The UI contract for "not tracked" is the same shape whether the endpoint is absent or present-and-empty, so the client can be built against it before the endpoint ships (see the demo section below).

---

### PP-ON-03 — Add start/resume and step-patch commands with idempotency and optimistic concurrency

**Target** `apps/api/src/routes/admin/org-onboarding.ts` **new file** (same module as PP-ON-02) · **Pkg** G07,G08 · **Scen** 101,102 · **Risk** High · **Apply when** PP-ON-01's `version` and `idempotency_key` columns exist

There is no `POST`/`PATCH` onboarding route anywhere, and no route in the repo currently
reads an `If-Match` or `Idempotency-Key` header — this would be the first. Start is
idempotent on `(orgId, idempotencyKey)`: replaying the same key returns the existing
workflow with `created: false` rather than colliding with the partial unique index from
PP-ON-01. Step patches carry `If-Match: "<version>"` and a stale value returns 409 with the
current aggregate in the body, so the client can re-render without a second round trip.

```diff
+adminOrgs.post(
+  "/:orgId/onboarding",
+  requirePermission("org.write", { orgIdParam: "orgId" }),
+  async (c) => {
+    const idempotencyKey = c.req.header("Idempotency-Key") ?? null;
+    const db = makePrisma(c.env);
+    // Scenario 101 — same key returns the existing workflow, not a 409. The
+    // partial unique index (PP-ON-01) is the backstop for a MISSING key; this
+    // is the cooperative path for a retried request.
+    const result = await startOrResumeWorkflow(db, {
+      orgId: c.req.param("orgId"),
+      idempotencyKey,
+      actorUserId: sessionUserId(c.get("session")),
+    });
+    return c.json({ workflow: result.workflow, created: result.created }, result.created ? 201 : 200);
+  },
+);
+
+adminOrgs.patch(
+  "/:orgId/onboarding/steps/:stepKey",
+  requirePermission("org.write", { orgIdParam: "orgId" }),
+  async (c) => {
+    const ifMatch = c.req.header("If-Match");
+    if (!ifMatch) return c.json({ error: "if_match_required" }, 428);
+    const db = makePrisma(c.env);
+    const result = await patchStep(db, {
+      orgId: c.req.param("orgId"),
+      stepKey: c.req.param("stepKey"),
+      expectedVersion: Number(ifMatch.replace(/"/g, "")),
+      body: await c.req.json().catch(() => null),
+      actorUserId: sessionUserId(c.get("session")),
+    });
+    if ("errorCode" in result && result.errorCode === "version_conflict") {
+      // Scenario 102 — hand back the current aggregate so the client can
+      // re-render without a second GET.
+      return c.json({ error: "version_conflict", workflow: result.current }, 409);
+    }
+    return c.json({ workflow: result });
+  },
+);
```

- **Tests to add:** `org-onboarding-commands.test.ts` — `replaying the same Idempotency-Key returns created:false` (scen 101), `a stale If-Match returns 409 with the current aggregate` (scen 102), `a missing If-Match returns 428`. All three fail today.
- **Migration impact:** none beyond PP-ON-01 — `version` and `idempotency_key` are declared there.
- **Rollback:** remove both registrations. Workflows already started remain readable through PP-ON-02 and frozen at whatever state they reached.
- **Unresolved:** the version bump must be atomic with the step write, which means an `updateMany` guarded on `{ id, version: expectedVersion }` inside the transaction — a `findUnique` then `update` loses the race. Whether the repository layer does that correctly is the single highest-risk detail in Group G and it is not settled by any doc.
- **Safe to apply later because:** both commands are guarded — the partial unique index prevents a duplicate open workflow even if the idempotency logic is wrong, and `If-Match` being required means no client can write blind. The failure mode of deferring is that the UI stays read-only, not that it writes something wrong.

---

### PP-ON-04 — Persist step provenance and require a reason on every skip

**Target** `apps/api/src/repositories/onboarding-workflow.ts` **new file** · **Pkg** G03,G10 · **Scen** 103,104,110 · **Risk** Medium · **Apply when** PP-ON-01's `onboarding_steps` table exists

Nothing records who advanced a step or why. Scenarios 103 and 104 want two different
refusals — a **required** step cannot be skipped at all (422 `step_not_skippable`), and an
**optional** step skipped without a reason is a 400 — which means "skippable" must be a
property of the step definition, not of the request. Provenance (`completedByUserId`,
`completedByKind`, `skipReason`) goes on the step row so the aggregate answers "who did
this" without a join to `audit.actions`.

```diff
+// G03/G10 — the seven step keys. Required-ness is a property of the DEFINITION,
+// not the request: scenario 103 (required step skipped → 422 step_not_skippable)
+// and scenario 104 (optional step skipped with no reason → 400) are different
+// refusals and cannot both come from request validation.
+const STEP_DEFINITIONS = [
+  { key: "org_profile",        required: true  },
+  { key: "billing_contact",    required: true  },
+  { key: "site_survey",        required: false },
+  { key: "installation",       required: true  },
+  { key: "charger_commission", required: true  },
+  { key: "agreement",          required: true  },
+  { key: "driver_enrolment",   required: false },
+] as const;
+
+export async function patchStep(db: PrismaClient, cmd: PatchStepCommand) {
+  const def = STEP_DEFINITIONS.find((d) => d.key === cmd.stepKey);
+  if (!def) return { errorCode: "unknown_step" as const };
+  if (cmd.body?.action === "skip") {
+    if (def.required) return { errorCode: "step_not_skippable" as const };      // 422, scen 103
+    if (!cmd.body.reason?.trim()) return { errorCode: "skip_reason_required" as const }; // 400, scen 104
+  }
+  // Provenance is written on the step row, not only to audit.actions, so the
+  // aggregate can answer "who did this" without a cross-schema join.
+  // ...
+}
```

- **Tests to add:** `onboarding-steps.test.ts` — `skipping a required step returns step_not_skippable` (scen 103), `skipping an optional step with a blank reason returns 400` (scen 104), `a staff actor is recorded as completedByKind="staff"` (scen 110). All fail today.
- **Migration impact:** none beyond PP-ON-01, provided the step columns are declared there. If they are not, this needs its own additive migration.
- **Rollback:** revert the module; step rows keep their provenance columns, which become unread rather than wrong.
- **Unresolved:** the seven step keys above are a reconstruction from 18A G03 ("7 keys") and doc 10 §1 — the actual key strings are **unverified**, and 18A G04 additionally names thirteen substeps that this proposal does not model. Someone must pin the canonical key list before any client hard-codes it.
- **Safe to apply later because:** the step definitions are data, not schema. Adding, renaming or reordering them later touches one array, and a step key with no row is already the "not started" state.

---

### PP-ON-05 — Record the staff actor on every onboarding write without inventing a SupportContext

**Target** `apps/api/src/lib/onboarding/actor.ts` **new file** · **Pkg** G10 · **Scen** 110 · **Risk** Medium · **Apply when** PP-ON-04 exists to consume the resolved actor

`SupportContext` and `support_contexts` do not exist in any schema, and `session_attribution`
and `tokenClass` do not either — so any proposal that threads a support context through
onboarding is proposing three greenfield things at once. This proposal deliberately does the
smaller thing: resolve `{ userId, kind }` from the session that already exists and record it,
so scenario 110's "`nextActor` and audit reflect staff" is answerable from real data. The
one thing it must handle honestly is the bootstrap admin: `requirePermission` returns early
for sessions where `sub === "admin"` with no `userId` (`require-permission.ts:55-59`, mirrored
in `assertPermission` :115-117), so `sessionUserId` returns null and the actor is genuinely
unknown, not merely unrecorded.

```diff
+// Scenario 110 — "nextActor and audit reflect staff".
+//
+// There is no SupportContext in this codebase (no support_contexts table, no
+// session_attribution, no tokenClass anywhere in any schema). Rather than
+// invent all three, this resolves what the session actually carries.
+//
+// The bootstrap admin is a real hole, not an omission: requirePermission
+// returns early for sub==="admin" sessions with no userId
+// (require-permission.ts:55-59), so sessionUserId() is null and there is no
+// user to attribute to. Recording "bootstrap" explicitly is better than
+// recording null and letting a reader assume the column was simply unset.
+export type OnboardingActor =
+  | { kind: "user"; userId: string }
+  | { kind: "bootstrap"; userId: null };
+
+export function resolveOnboardingActor(session: SessionPayload): OnboardingActor {
+  const userId = sessionUserId(session);
+  if (userId) return { kind: "user", userId };
+  return { kind: "bootstrap", userId: null };
+}
```

- **Tests to add:** `onboarding-actor.test.ts` — `a bootstrap session resolves to kind:"bootstrap" with a null userId, not to a fabricated id`, `a multi-user session resolves to kind:"user"`. Both fail today. Note `platform.impersonate` and `platform.support.action` have **zero** enforcement call sites anywhere, so there is no impersonation state to distinguish staff-acting-as-org from staff-acting-as-staff.
- **Migration impact:** none — pure TypeScript, assuming PP-ON-01 declared `startedByKind`.
- **Rollback:** revert the module; writes fall back to `actorUserId: null`, which is what every other write path does today (see PP-ON-10).
- **Unresolved:** whether "staff" should be a distinct `ActorKind` from "user". `ActorKind` is a generated Prisma enum (`apps/api/src/lib/audit.ts:22`) and its member list was not read for this document — **unverified** whether it already has a staff member. If it does not, adding one is an enum migration with the same irreversibility as PP-AG-11.
- **Safe to apply later because:** it is a pure function over a session object that already exists on every admin request. Adding it changes nothing until a caller reads it, and the value it returns is derivable retroactively from `audit.actions.actor_user_id` for rows written before it.

---

### PP-ON-06 — Refuse invite redemption while the org's workflow is not `active`

**Target** `apps/api/src/routes/public/invites.ts` :121-126 · **Pkg** G09 · **Scen** 107 · **Risk** High · **Apply when** PP-ON-01 and PP-ON-03 are live AND every currently-invited org has an `active` workflow — otherwise this bricks in-flight invitations

Doc 02 §3's invariant is that only an `active` workflow confers access, but
`POST /api/public/invites/consume` today reads `orgId` out of the token metadata and flips
the membership to active with no reference to org state at all. The check belongs inside the
existing transaction, immediately after the metadata is extracted and **before** the
conditional token claim at :139-143 — refusing after the claim would burn a single-use token
on a rejected redemption.

```diff
     const meta = (row.metadata ?? {}) as Record<string, unknown>;
     const orgId = typeof meta.orgId === "string" ? meta.orgId : null;
     const email = typeof meta.email === "string" ? meta.email : null;
     if (!orgId || !email) {
       return { ok: false as const, reason: "malformed_metadata" as const };
     }
 
+    // G09 / scenario 107 — only an ACTIVE onboarding workflow confers access.
+    // Placed BEFORE the conditional claim below: refusing after the claim would
+    // burn a single-use token on a redemption that was never going to succeed.
+    //
+    // Absent workflow is treated as PERMITTED, not refused. Every org that
+    // predates the aggregate has no workflow row, and refusing those would
+    // break every in-flight invitation on the day this deploys.
+    const wf = await tx.onboardingWorkflow.findFirst({
+      where: { orgId },
+      select: { status: true },
+    });
+    if (wf && wf.status !== "active") {
+      return { ok: false as const, reason: "org_not_active" as const };
+    }
+
     // Conditional claim — concurrent consumers race; loser sees
     // count=0 and reports already_used.
     const claimed = await tx.userToken.updateMany({
       where: { id: row.id, usedAt: null },
       data: { usedAt: new Date() },
     });
```

- **Tests to add:** `invites-consume.test.ts` — `a draft workflow refuses redemption with org_not_active and does NOT mark the token used` (scen 107, fails today), `an org with no workflow still redeems` (the compatibility case), `an active workflow redeems`. None exist — there is no test file for `routes/public/invites.ts` at all.
- **Migration impact:** none — pure TypeScript, one extra `SELECT` inside an existing transaction.
- **Rollback:** revert the hunk. Nothing persisted changes; invitations refused while it was live were never claimed, so they can simply be retried.
- **Unresolved:** `ConsumeBody` (:35-38) is non-strict `{token, password}` and `apps/mobile/lib/api/client.dart:101-105` sends a third field, `kennitala`, which Zod silently strips. Making the schema strict would 400 **every** mobile redemption. This proposal does not touch that — but anyone editing this file must not "tidy" the schema while they are here.
- **Safe to apply later because:** the absent-workflow case is treated as permitted, so the check is a no-op for every org until someone starts a workflow for it. That makes the change flag-like without a flag: adoption is per-org and opt-in by the act of creating a workflow.

---

### PP-ON-07 — Write exactly one audit event per onboarding state change, and audit the org archive path that writes none

**Target** `apps/api/src/routes/admin/orgs.ts` :109-120 · **Pkg** G11,G12 · **Scen** 108,109,155 · **Risk** Low · **Apply when** any time — it is additive and independent of the rest of Group G

`POST /api/admin/orgs/:orgId/archive` updates `status` to `"archived"` directly through
Prisma and writes no audit row, while its sibling mutations elsewhere in the codebase
(`createOnboardingChain` :183-196, `driver-group-memberships.ts`) all call
`recordAuditAction`. Since 18A G11 nominates archive as the cancel path, an unaudited status
flip is the one transition in Group G that already exists and already fails scenario 155.
Suspension explicitly must **not** revoke memberships (scenario 108) — the diff below leaves
membership rows untouched, which is the current behaviour and should be asserted rather than
changed.

```diff
 // Archive is destructive — owner-level OR platform.tenant.delete.
 adminOrgs.post(
   "/:orgId/archive",
   requirePermission("org.write", { orgIdParam: "orgId" }),
   async (c) => {
     const db = makePrisma(c.env);
     const updated = await db.organization.update({
       where: { id: c.req.param("orgId") },
       data: { status: "archived" },
     });
+    // Scenario 155 — exactly one audit event per state change. This route was
+    // the only org-status mutation in the file that wrote none.
+    // Memberships are deliberately NOT touched (scenario 108): archiving is a
+    // status flip, not a revocation.
+    await recordAuditAction(db, {
+      orgId: updated.id,
+      actorUserId: sessionUserId(c.get("session")),
+      actorKind: "user",
+      action: "org.archive",
+      targetType: "organization",
+      targetId: updated.id,
+      metadata: { previousStatus: "active" },
+    });
     return c.json({ org: { id: updated.id, status: updated.status } });
   },
 );
```

- **Tests to add:** `orgs-archive.test.ts` — `archiving writes exactly one audit row with action org.archive` (scen 155, fails today: zero rows written), `archiving does not change any membership status` (scen 108, passes today and is a regression guard).
- **Migration impact:** none — pure TypeScript. `recordAuditAction` accepts the Prisma client already in scope (`audit.ts:38-46`).
- **Rollback:** revert the hunk. Audit rows written stay; they are additive history and harm nothing.
- **Unresolved:** `metadata.previousStatus` is hard-coded to `"active"` above, which is wrong if an already-archived org is archived again. Read the prior status inside a transaction, or drop the field. Also unresolved: `updateOrg` (`repositories/orgs.ts:165`) can set `status` directly with no enum guard, so archive is not the only way to reach `archived`.
- **Safe to apply later because:** it is append-only. An audit row that was never written cannot be reconstructed, so deferring loses history permanently — but it breaks nothing, and the rows written after it lands are immediately correct.

---

### PP-ON-08 — Give chain-born chargers an installation so they stop landing in the orphan bucket

**Target** `apps/api/src/repositories/onboarding-chains.ts` :117-127 · **Pkg** G07,H01 · **Scen** 99,113 · **Risk** High · **Apply when** a decision exists on whether `/chains` creates the Installation itself or requires the caller to supply one

`createOnboardingChain` inserts Org, Property, Site, SiteAsset, ChargingStation, EVSE,
Connector and OcppIdentity, but `tx.chargingStation.create` at :117-127 sets **no**
`installationId` — while the Drizzle sibling `createCharger` (`repositories/chargers.ts:534`)
does pass one. The consequence is visible: `listSiteTree` buckets chargers by
`installationId`, and anything with `installationId == null && circuitId == null` falls into
`orphanChargers` (`site-tree.ts:722-727`). So every charger created by the onboarding wizard
appears outside the installation tree, and `assets.installations.onboarding_status` never
applies to it because there is no installation to hold the status.

```diff
     await tx.chargingStation.create({
       data: {
         siteAssetId: siteAsset.id,
         orgId: org.id,
+        // Without this the row lands in listSiteTree's orphanChargers bucket
+        // (site-tree.ts:722-727), outside the installation tree, and no
+        // installation onboarding_status can ever apply to it. createCharger
+        // (repositories/chargers.ts:534) has always passed one; this path
+        // never did.
+        installationId: installation.id,
         vendor: input.stationVendor,
         model: input.stationModel,
         serialNumber: input.stationSerialNumber,
         firmwareVersion: input.stationFirmwareVersion,
         installDate: input.stationInstallDate ? new Date(input.stationInstallDate) : undefined,
       },
     });
```

- **Tests to add:** `onboarding-chains.test.ts` — `a chain-created charger appears under an installation in listSiteTree, not in orphanChargers` (fails today), `the created installation carries onboardingStatus = pending_credentials` (the schema default at `assets.prisma:160`). No test file exists for this repository today.
- **Migration impact:** none — `chargingStation.installationId` already exists and is already nullable. But the transaction gains a ninth-and-tenth round trip (`installation.create`), and the header at :59-62 already notes the 60s timeout "cuts it close over Hyperdrive".
- **Rollback:** revert the hunk. Chargers created while it was live keep their `installationId` and stay correctly placed — rollback does not orphan them again, it only stops new ones from being placed.
- **Unresolved:** 18A SI-ONBOARDING-02's open question, verbatim: does G07 require the chain to create an Installation row, or should `OnboardingChainInput` gain an optional `installationId` and require the caller to have made one? The input schema (`packages/contracts/src/inputs/onboarding-chains.ts:31-85`) has no installation field of any kind today, so either answer is a contract change.
- **Safe to apply later because:** the column is nullable and every reader already handles null — `site-tree.ts` buckets it as an orphan rather than failing. Deferring produces mis-shelved chargers, not broken ones, and a later backfill can set `installation_id` from `site_id` for the affected rows.

---

### PP-ON-09 — Match pending discoveries case-insensitively so provisioning actually clears them

**Target** `apps/api/src/repositories/onboarding-chains.ts` :166-168 and `apps/api/src/repositories/chargers.ts` :579-581 · **Pkg** H05 · **Scen** 113 · **Risk** Medium · **Apply when** a staging count of mixed-case `pending_discoveries` rows has been taken, because the fix changes which rows a delete touches

`upsertPendingDiscovery` lowercases the key before writing
(`pending-discoveries.ts:98`, deliberately — its comment at :85-88 explains that firmware
versions vary the case). Both delete paths, however, match on the **raw** operator-typed
string: `tx.pendingDiscovery.deleteMany({ where: { identityString: input.identityString } })`
in the chain, and the Drizzle `eq(pendingDiscoveries.identityString, input.identityString)`
in `createCharger`. `IDENTITY_RE` permits `[A-Za-z0-9._:-]` (`onboarding-chains.ts:5` in the
contracts package), so an operator typing `ZPR074002` never clears the row the gateway wrote
as `zpr074002`, and the charger stays on the pending list after being successfully
provisioned.

```diff
     // Mirror chargers.createCharger — close the pending-discoveries
     // loop in the same tx if the operator's onboarding chain provisions
     // an identityString the gateway has been seeing.
+    //
+    // Lowercased to match the write side: upsertPendingDiscovery
+    // (pending-discoveries.ts:98) stores the key lowercased on purpose, but
+    // IDENTITY_RE permits mixed case on input, so an operator typing
+    // "ZPR074002" was never clearing the row the gateway wrote as "zpr074002".
     await tx.pendingDiscovery.deleteMany({
-      where: { identityString: input.identityString },
+      where: { identityString: input.identityString.toLowerCase() },
     });
```

```diff
     // Closes the pending-discoveries loop: if the gateway recorded
     // failed auth attempts for this identityString before provision,
     // remove the row in the same transaction. No-op when nothing matches.
+    // Lowercased — see pending-discoveries.ts:98, which is the write side.
     await tx
       .delete(pendingDiscoveries)
-      .where(eq(pendingDiscoveries.identityString, input.identityString));
+      .where(eq(pendingDiscoveries.identityString, input.identityString.toLowerCase()));
```

- **Tests to add:** `pending-discoveries-case.test.ts` — `provisioning "ZPR074002" clears a pending row stored as "zpr074002"` (fails today on both paths), `provisioning is still a no-op when no pending row exists`. Neither repository has a test file today.
- **Migration impact:** none — pure TypeScript. No existing row changes; only which rows a `DELETE` predicate matches.
- **Rollback:** revert both hunks. Stale pending rows reappear on the operator's `/chargers/pending` page as noise; nothing is lost, because `clearIdlePendingDiscoveries` (:70) sweeps rows older than five minutes anyway.
- **Unresolved:** should `OcppIdentity.identityString` be lowercased on write too, so the whole system agrees on one case? It is not today — the chain writes `input.identityString` raw at :155. Fixing only the delete side leaves the gateway matching identities case-sensitively against a mixed-case column, which is a separate and larger question.
- **Safe to apply later because:** the change only widens which rows a delete matches, and a pending-discovery row is pure observability — deleting one that should not have been deleted costs nothing, since the gateway re-creates it on the next failed auth (`pending-discoveries.ts:61-64`).

---

### PP-ON-10 — Stop passing `null` as the actor on three admin write paths that have a session in hand

**Target** `apps/api/src/routes/admin/onboarding.ts` :20, `apps/api/src/routes/admin/chargers.ts` :68 and :272 · **Pkg** H03,N01 · **Scen** 110,115,155 · **Risk** Low · **Apply when** any time — the parameter already exists and already accepts null

All three routes sit behind `requireAdmin`, so `c.get("session")` is populated, and all three
then hand `null` to a repository whose signature is `actorUserId: string | null`
(`createOnboardingChain` :54, `createCharger` :510). The audit row is written either way —
`recordAuditAction` coerces with `input.actorUserId ?? null` (`audit.ts:65`) — so the effect
is not a missing row but a row that cannot answer who did it. `sessionUserId` is already
imported in `orgs.ts:27` and exported from `require-permission.ts:161`.

```diff
   const db = makePrisma(c.env);
-  const result = await createOnboardingChain(db, parsed.data, null);
+  // requireAdmin (:11) guarantees a session here. Passing null wrote an audit
+  // row (audit.ts:65 coerces) that could not name the actor. Bootstrap-admin
+  // sessions still resolve to null — genuinely unknown, not merely unpassed.
+  const result = await createOnboardingChain(db, parsed.data, sessionUserId(c.get("session")));
```

```diff
   const db = makeDrizzle(c.env);
-  const r = await createCharger(db, parsed.data, null);
+  const r = await createCharger(db, parsed.data, sessionUserId(c.get("session")));
```

```diff
   const db = makeDrizzle(c.env);
-  const charger = await updateCharger(db, c.req.param("id"), parsed.data, null);
+  const charger = await updateCharger(db, c.req.param("id"), parsed.data, sessionUserId(c.get("session")));
```

- **Tests to add:** `chargers-audit-actor.test.ts` — `POST /api/admin/chargers writes an audit row whose actor_user_id equals the session user` (fails today: it is always null), `a bootstrap-admin session still writes the row, with a null actor`. `installation-ocpp.test.ts` already exists and already covers the rotate path's actor (H03), so this closes the gap around it rather than duplicating it.
- **Migration impact:** none — pure TypeScript. `actorUserId` is already a nullable column.
- **Rollback:** revert the three hunks. Audit rows written while it was live keep their actor; rows written before it are permanently anonymous and cannot be backfilled.
- **Unresolved:** the bootstrap admin still resolves to null, because `requirePermission` returns early for `sub === "admin"` sessions with no `userId` (`require-permission.ts:55-59`). Until multi-user login is the only login, "null actor" and "bootstrap admin" are indistinguishable in `audit.actions`. Recording a sentinel would be a data change, not a code change, and no one has decided.
- **Safe to apply later because:** the parameter is already threaded through every signature and already nullable, so this is a three-token change with no type consequences. Nothing reads `actor_user_id` in a way that would break on it becoming non-null.

---

### PP-ON-11 — Wire a test runner into the check script, because nothing runs the tests today

**Target** `scripts/check-all.mjs` :14-35 · **Pkg** P01,P02 · **Scen** 154 · **Risk** Medium · **Apply when** the current vitest suites are known-green locally, since this turns any red test into a red CI run on every branch

Every "Tests to add" line above is worth less than it looks: `.github/workflows/check.yml`
runs three steps (`npm install`, `npm run db:generate`, `npm run check`), and `npm run check`
is `scripts/check-all.mjs`, whose nine entries are typecheck, schemas, api-schema,
schema-consistency, deps, deps-graph, api-endpoints, unused-exports and work-view. **None of
them is vitest.** The forked resolver suites (`packages/commercial/src/agreement/resolve.test.ts`
and `apps/api/src/lib/agreement/resolve.test.ts`) both exist and neither has run in CI. The
parity suite under `apps/api/test/parity/` needs `vitest.parity.config.ts` and its own npm
script. This adds the one offline runner; it does not add the integration tests, which need a
database secret this repo does not have.

```diff
 const CHECKS = [
   ["typecheck", "npm run typecheck"],
   ["schemas", "npm run check:schemas"],
   ["api-schema", "npm run check:api-schema"],
+  // Nine checks ran here and none of them was a test. The forked resolver
+  // suites (packages/commercial/.../resolve.test.ts and its apps/api twin)
+  // both existed and neither had ever run in CI — which is how they forked:
+  // the per_connector describe block landed in one and not the other.
+  // Offline only; the integration suites need a DATABASE_URL this repo has
+  // no secret for (see .github/workflows/check.yml:11-45).
+  ["unit", "npx vitest run --config vitest.config.ts"],
   ["schema-consistency", "npm run check:schema-consistency"],
   ["deps", "npm run check:deps"],
```

- **Tests to add:** none — this is what makes the others exist. The immediate verification is that adding it turns the check summary from nine lines to ten and that the run is green before the line is committed.
- **Migration impact:** none — pure tooling.
- **Rollback:** remove the array entry. Nothing is lost except the gate; the test files stay and can still be run by hand.
- **Unresolved:** the two forked `resolve.test.ts` copies both match the root include list, so wiring this in runs both — and 18A SI-AGREEMENTS-01's open question ("which is authoritative") becomes a blocker rather than a curiosity the moment CI runs them. Decide before wiring, or the first red run is about the fork rather than about any real defect.
- **Safe to apply later because:** `check-all.mjs` deliberately runs every check and reports all results rather than short-circuiting (its header :5-11 explains why), so adding an entry cannot mask an existing one. It is a one-line, order-independent array insertion.

---

## What can be demoed before the backend exists

The rule: a screen that **displays a shape** can be built now; a screen that **asserts a
number a customer would rely on** cannot.

**Safe to build visually now**

- Agreement list and detail pages — `GET /api/admin/agreements` and `GET /:id` already return the full nested tree (`agreements-debug.ts:35,42`), including clauses, driver groups, memberships and bearer rules.
- Agreement create/edit **forms** with client-side validation — the field set is fixed by `prisma/schema/commercial.prisma:483-513` and PP-AG-03's schema; only the submit button needs a backend.
- Cost-factor catalogue browse and the create/edit forms for `billing.cost_factors` — full CRUD already ships at `billing-cost-factors.ts:40,50,97,163,188`.
- Rate-book browse with current/staged/expired badges — `listRateReferences` already computes exactly those three buckets per code (`billing-rate-references.ts:104-178`).
- The "stage a new version" wizard for rate references — the whole transaction exists and works (`createRateReference` :209-283); this is the one write flow that is genuinely finished.
- Onboarding workflow **empty state** — scenario 112's "this isn't tracked yet" is the correct rendering for every org today and stays correct after PP-ON-02 ships, because absent and untracked are the same shape.
- The onboarding step **checklist layout**, greyed and non-interactive — the seven keys are a fixed list and rendering them proves the layout without asserting any org's progress.
- Site tree with installations, circuits and chargers — `listSiteTree` :360-752 returns the complete assembled tree including the orphan buckets.
- Pending-discoveries list — `listPendingDiscoveries` :20 returns real rows, and the page's job is exactly to show the mismatch state (its comment at :23-28).
- Driver-group membership add — `POST /api/admin/orgs/:orgId/driver-group-memberships` exists, is idempotent, and enforces the cross-tenant guard.
- The disabled-control states themselves — scenarios 149-154 are the deliverable, and asserting a disabled state is a real UI test that needs no endpoint (scenario 154 says so explicitly).

**Must wait for backend truth**

- Any priced number shown to a driver — three pricing implementations disagree and no comparison enforces agreement between them; `driver-pricing.ts:25-34` says so in the source.
- Pricing preview against a **draft** agreement — `loadAgreementContext` filters `status: "active"` (`persist.ts:138`), so a draft cannot be previewed at all until PP-AG-09's unresolved question is answered.
- Any "this agreement is in effect" badge — no exclusion constraint exists, so two overlapping active agreements can coexist and the resolver silently picks the newest with a `console.warn` (`persist.ts:143-165`). The badge would be confidently wrong.
- Agreement activation, and any UI implying staff cannot activate — `sales_cs` currently receives `contract.write` through `expandPlatformTenantVerbs`, so the screen would enforce a rule the server does not.
- Onboarding progress percentages — there is no workflow table, so any percentage is derived from proxies, which scenario 112 forbids by name.
- "Access granted because onboarding is active" — the invariant is not enforced anywhere; `invites.ts` consume never looks at org state.
- A charger's installation placement after wizard creation — chain-born chargers have no `installationId` and land in `orphanChargers`, so the tree position shown would be the bug, not the layout.
- Onboarding audit trail / "who did this" — three write paths pass `actorUserId: null`, so the trail exists but cannot name anyone.
- Anything asserting a per-connector fee — the Postgres enum does not carry `per_connector`, so no such rate can even be stored.
- Cost-factor **assignment** to a scope on either table — `agreements.cost_factors` has no write surface at all beyond select-options, and `agreements.bearer_rules` is empty; a UI showing assignments would be showing nothing, forever, with no error to explain why.
