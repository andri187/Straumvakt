# middleware.ts — reconciliation notes for the straumvakt.org relaunch merge

**Status:** open. Written 2026-08-08 from `dev/employee-landing`.
**Audience:** whoever merges the relaunch branches back together.
**Ask:** read this before touching `middleware.ts`, and do the relocation in
step 4 **last**.

---

## 1. The bug: nothing in `middleware.ts` runs

`middleware.ts` sits at the repo root. Next.js 16 only resolves the middleware
convention from **`src/middleware.ts`** when a `src/` directory exists — and
this repo has `src/`. So the root file is never loaded, never compiled, and
never executed. It is, at runtime, an unreferenced TypeScript file.

This is not a new regression and it was not introduced by the relaunch. It
predates the branch split; the relaunch simply inherited it.

**Verified, not inferred.** Against `next dev` on 2026-08-08:

| Request (no session cookie) | root `middleware.ts` | copied to `src/middleware.ts` |
| --- | --- | --- |
| `GET /home` | `200` — reachable unauthenticated | `307` → `/` |
| `GET /staff/overview` | `200` | `307` → `/staff` |
| `GET /staff` | `200` | `200` (correct — it is the sign-in page) |

The dev server also never logs a middleware compile step in the root layout,
and once the file is at `src/middleware.ts` the request log gains a
`proxy.ts:` timing segment that is absent otherwise.

### What this actually costs today

Everything in the file is currently inert, including rules that predate the
relaunch:

- The `"/"` special-case that redirects an already-signed-in visitor to `/home`.
- The catch-all that redirects unauthenticated app routes to `/`.
- The `401` for unauthenticated `/api/admin/*`.
- The `x-straumvakt-admin-verified` header strip-and-restamp. **Note the strip
  is part of the same dead code** — the header is documented as
  "stripped from all incoming requests so clients cannot spoof it", and that
  strip is not happening either. Anything that ever learns to trust that
  header must not ship before the file is live.
- Both `/staff` rules added on `dev/employee-landing` (section 2).

Concretely: `/home` is reachable with no session on every relaunch branch right
now.

### Side note picked up on the way

Next 16.2 also warns that the `middleware` filename convention is deprecated in
favour of `proxy`:

```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
```

Not urgent, and deliberately **not** bundled into the relocation — one move at
a time. Worth a follow-up ticket.

---

## 2. The exact change `dev/employee-landing` made

Commit `f0eecb2`, `+56/-0`, purely additive: one contiguous block plus one call
line. Output of `git show f0eecb2 -- middleware.ts`:

```diff
diff --git a/middleware.ts b/middleware.ts
index 8f37c71..6497405 100644
--- a/middleware.ts
+++ b/middleware.ts
@@ -23,6 +23,59 @@ function isPublicAsset(pathname: string): boolean {
   );
 }
 
+// ── Straumvakt-employee entrance (/staff) ───────────────────────────────
+// Added with the employee landing page. Kept as one self-contained block
+// with a single call site below, on purpose: the org-facing entrance is
+// being added to this same file in parallel, and a contiguous addition
+// merges next to another contiguous addition without a fight.
+//
+// Two rules, both scoped to this prefix and nothing else:
+//
+//   • "/staff" is public. It *is* the sign-in page, so it has to be
+//     reachable without a session; a visitor who already has one skips
+//     straight past it, exactly like the "/" special-case below.
+//   • Everything under "/staff/" is session-gated and, when the session is
+//     missing, bounces to "/staff" rather than the generic "/". Staff whose
+//     session lapsed should get their own door back, not the org login.
+//
+// Note this only proves a *session* exists. Whether it carries platform
+// scope is decided by GET /api/admin/me inside src/app/staff/overview —
+// middleware cannot tell the two login paths apart, and shouldn't try.
+//
+// CAVEAT, verified 2026-08-08 and NOT introduced here: this file does not
+// currently execute. Next 16 resolves the convention to src/middleware.ts
+// when a src/ directory exists, so nothing below runs and /home is already
+// reachable without a session on this branch. Copying this file to
+// src/middleware.ts makes every rule here (including the two above) take
+// effect immediately — confirmed against `next dev`. That move is left
+// undone deliberately: it is a whole-file relocation, and the org-facing
+// entrance is being added to this same file in parallel. /staff/overview
+// therefore does not lean on middleware for its gate — it verifies the
+// session server-side and renders nothing it cannot fetch.
+const STAFF_LANDING = "/staff";
+const STAFF_HOME = "/staff/overview";
+
+function staffRouteResponse(
+  pathname: string,
+  session: Awaited<ReturnType<typeof verifyAdminSession>>,
+  req: NextRequest,
+  headers: Headers,
+): NextResponse | null {
+  if (pathname !== STAFF_LANDING && !pathname.startsWith(`${STAFF_LANDING}/`)) {
+    return null; // not ours — let the existing rules run
+  }
+  if (pathname === STAFF_LANDING) {
+    return session
+      ? NextResponse.redirect(new URL(STAFF_HOME, req.url))
+      : NextResponse.next({ request: { headers } });
+  }
+  if (!session) {
+    return NextResponse.redirect(new URL(STAFF_LANDING, req.url));
+  }
+  headers.set(ADMIN_HEADER, "1");
+  return NextResponse.next({ request: { headers } });
+}
+
 export async function middleware(req: NextRequest) {
   const { pathname } = req.nextUrl;
 
@@ -57,6 +110,9 @@ export async function middleware(req: NextRequest) {
     return NextResponse.next({ request: { headers: sanitisedHeaders } });
   }
 
+  const staff = staffRouteResponse(pathname, session, req, sanitisedHeaders);
+  if (staff) return staff;
+
   if (PUBLIC_PATHS.has(pathname)) {
     return NextResponse.next({ request: { headers: sanitisedHeaders } });
   }
```

The call site sits **after** the `"/"` special-case and **before** the
`PUBLIC_PATHS` check. That ordering is deliberate but not load-bearing: the
function returns `null` for every non-`/staff` path, so it is inert wherever it
sits among the pre-session-check branches.

---

## 3. The other branch — the conflict is real but not textual

The original expectation was that `dev/n1-org-landing` would carry a competing
edit to the same file. **It does not.** Verified read-only at commit
`6681876`:

```
$ git diff --name-only dev/straumvakt-org-relaunch dev/n1-org-landing -- middleware.ts
(no output)
```

That branch adds `src/app/org/[slug]/*`, `src/app/org/page.tsx`,
`src/lib/org-context.ts`, `src/lib/org-tenant.ts` and edits
`src/app/home/page.tsx` — and touches no middleware at all. So **`git merge`
will not report a conflict in `middleware.ts`.** That is precisely what makes
this dangerous: the merge looks clean while leaving a real gap.

Both branches independently reached the same conclusion — don't trust the
middleware, verify in the server component:

| Branch | Route | How it actually gates |
| --- | --- | --- |
| `dev/employee-landing` | `/staff/overview` | `GET /api/admin/me` in the RSC; renders a sign-in prompt on `401`, and a diagnostic on anything else |
| `dev/n1-org-landing` | `/org/[slug]/*` | `requireOrgContext()` → `GET /api/admin/me` + `/api/admin/orgs/:orgId`, per its own layout comment: "adds no auth of its own" |

**So the reconciliation is semantic, not textual.** Two things are missing that
no merge tool will surface:

1. `/org/[slug]` has **no** middleware rule of any kind. Under the current
   (dead) file, the catch-all would redirect any unauthenticated non-`/api`
   route to `/`. The moment the file goes live, `/org/[slug]` inherits that
   behaviour by default — which may or may not be what the org landing wants,
   and nobody has decided. It needs an explicit rule, same shape as
   `staffRouteResponse()`.
2. `/staff` **must** keep its exception. Relocating the file without the
   `f0eecb2` block live would make the staff sign-in page redirect to `/`,
   i.e. the sign-in page becomes unreachable for exactly the people who need
   to sign in.

Caveat on freshness: `dev/n1-org-landing` was an active branch when this was
written. Re-run the `git diff --name-only` above before trusting the
"no middleware change" claim — it may have gained one since.

---

## 4. Recommended order — relocate **last**

Do these as one deliberate sequence, ideally in one sitting by one person.
Steps 1–3 change no runtime behaviour at all, because the file is dead until
step 4. That is the whole point: it makes the risky part a single, reviewable,
revertible commit.

1. **Merge both feature branches** into the relaunch branch. Expect no
   conflict in `middleware.ts`. Confirm `staffRouteResponse()` survived.
2. **Add the `/org/[slug]` rule** alongside it, in the same shape — a function
   returning `NextResponse | null` plus one call site. Decide explicitly
   whether the org landing is public, session-gated, or slug-public /
   subpage-gated. Write the decision down in the comment; do not leave it to
   the catch-all.
3. **Re-read the whole file as one piece.** Three sets of rules written
   independently, none ever executed, are now going to run for the first time
   together. Check the ordering of the `"/"` case, the two route functions, and
   `PUBLIC_PATHS`. Check `matcher` still covers what you think
   (`/((?!.*\..*).*)` — no dots, so every extensionless path).
4. **Only then** relocate:

   ```
   git mv middleware.ts src/middleware.ts
   ```

   Do it as its own commit with nothing else in it, so it can be reverted
   alone if it goes wrong. Then verify against `next dev` — this is the first
   time any of these rules will have executed in production code:

   - `GET /` signed out → `200`; signed in → `307` `/home`
   - `GET /home` signed out → `307` `/`  ← the current hole closing
   - `GET /staff` signed out → `200`; signed in → `307` `/staff/overview`
   - `GET /staff/overview` signed out → `307` `/staff`
   - `GET /org/<slug>` → whatever step 2 decided
   - `GET /api/admin/me` signed out → `401`
   - A request sending `x-straumvakt-admin-verified: 1` by hand → header
     stripped, not honoured

### Why not just relocate now

Because step 4 is the only step that changes behaviour, and it changes it for
**every** route at once — including routes owned by branches that have never
had their gating rules reviewed. Doing it before steps 1–3 turns a merge into
an outage: `/staff` becomes unreachable and `/org/[slug]` silently inherits a
default nobody chose. The current state is a known, documented hole; the
half-relocated state would be an unknown one.

---

## 5. What is safe to rely on in the meantime

Both landing pages gate themselves server-side and do not depend on middleware.
`/staff/overview` in particular returns before rendering anything when
`GET /api/admin/me` fails, and distinguishes `401` ("you are not signed in" —
the ordinary case while the gate is dead) from real faults. So the pages are
not exposed by this bug.

What **is** exposed: `/home` — the interim placeholder from the relaunch
commit — is reachable with no session on every branch. It shows only static
text, so the practical impact today is nil, but it should not be given real
content until step 4 lands.
