# S2 patch proposal — invite consume must not overwrite a password

**PROPOSAL ONLY. NOT APPLIED.** Runtime source is untouched in this track. This
file exists so the change can be reviewed exactly, not so it can be pasted
without thought.

Target: `apps/api/src/routes/public/invites.ts` @ `4b69d0f`.
Closes the Critical in [09-adversarial-analysis](../domain/onboarding/09-adversarial-analysis.md) §2.
Truth table: [15-product-to-market-backend-runway](../domain/onboarding/15-product-to-market-backend-runway.md) §1.2.

## The ordering constraint that makes this non-trivial

The current transaction claims the token **before** writing the credential
(`:130-132` then `:142`). A naive fix that refuses at the credential step would
refuse *after* `usedAt` has been set — burning the invite and stranding the real
invitee. That is the ADR 0053 mistake reproduced in a different file.

**The credential check must therefore move above the conditional claim.** That
is the whole of the change; the refusal itself is trivial.

## Proposed diff

```diff
@@ inside db.$transaction, after the expiry check and metadata resolution,
@@ BEFORE the conditional claim
     if (!orgId || !email) {
       return { ok: false as const, reason: "malformed_metadata" as const };
     }

+    // S2 — an invitation is not a password reset.
+    //
+    // Possession of this token is the only authorisation the caller has
+    // (see the header). If the bound user already has a credential, letting
+    // a bearer choose a new one is a full account takeover, and the audit
+    // row would name the victim as the actor.
+    //
+    // Checked BEFORE the conditional claim below, deliberately: refusing
+    // after the claim would burn the invite and strand the real invitee —
+    // the ADR 0053 failure, in a different file.
+    //
+    // The bound user still has a route in: authenticate, then accept. That
+    // path is added separately and is not part of this fix.
+    const existingCredential = await tx.userCredential.findUnique({
+      where: { userId: row.userId },
+      select: { userId: true },
+    });
+    if (existingCredential) {
+      return { ok: false as const, reason: "already_claimed" as const };
+    }
+
     // Conditional claim — concurrent consumers race; loser sees
     // count=0 and reports already_used.
     const claimed = await tx.userToken.updateMany({
@@ the credential write can now be a create, not an upsert
-    await tx.userCredential.upsert({
-      where: { userId: row.userId },
-      create: { userId: row.userId, passwordHash },
-      update: { passwordHash },
-    });
+    // create, not upsert: the guard above proved no credential exists, and a
+    // create makes a future regression fail loudly on the unique constraint
+    // rather than silently overwriting again.
+    await tx.userCredential.create({
+      data: { userId: row.userId, passwordHash },
+    });
@@ status mapping
-    const status = result.reason === "not_found" ? 404 : 410;
+    const status =
+      result.reason === "not_found" ? 404
+      : result.reason === "already_claimed" ? 409
+      : 410;
```

## Why `create` instead of keeping `upsert`

The guard already proves no credential exists, so `upsert`'s update branch is
now unreachable. Replacing it with `create` means that if the guard is ever
removed or bypassed by a refactor, the unique constraint on `userCredential`
raises — **the regression fails loudly instead of silently overwriting a
password again**. Defence in depth for the exact bug being fixed.

## Error code

`409 already_claimed` — reusing the code `driver.ts:1090` already returns for
the identical situation on the driver path. No new vocabulary.

## What this does NOT fix

Rows 4 and 5 of the truth table — a bearer, or a *different* authenticated user,
consuming an invite bound to someone else. That is the bearer-membership grant,
and it needs an authenticated caller, so it waits for the adoption gate. **S2
closes the account-takeover half now, without any client change.**

## Blast radius

Zero for first-time invitees, which is every legitimate flow in the Codex mobile
(`75beb3c`), Codex web (`d228f53`) and archived web clients — none of them can
present a token whose bound user already has a password, in the normal case.

The only behaviour that breaks is re-consuming to set a new password, i.e. the
abuse case. **Confirm with Q-02 first** (are any invite tokens outstanding, and
for which accounts) — minutes of work, and it turns this from a principle into a
number.

## Tests to land with it

- `T-S2-1` credential exists + anonymous → `409`, `passwordHash` **byte-identical**, `usedAt` **still null**
- `T-S2-2` no credential → `200`, credential created
- `T-S2-3` refusal audited, actor is **not** the invitee
- `T-S2-4` two concurrent consumes → exactly one winner
- `T-S2-5` **anti-deadlock**: after a refusal, the real invitee can still complete the flow

`T-S2-5` is the one that must not be skipped. It is the test that proves this
fix did not recreate the problem it was modelled on.

## Verification before merge

Real-DB parity, against an approved disposable branch only — the suite mutates:

```
PARITY_DATABASE_URL=<approved disposable branch> npm --prefix apps/api run test:parity
```

Never point that at staging or production.
