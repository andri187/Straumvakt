# 20A — Integration addendum

Follows [20](20-scratch-verification-survival-matrix.md). Two new slices on the
same scratch branch, plus the apply/hold decision table the hardening lane needs
before any of this reaches `dev`.

**Branch:** `scratch/claude-a-backend-verification-2026-08-09` ·
**from** `4812a00` · **to** `0899f4b`. Nothing pushed, no database touched.

## Four of the six requested slices were already done

The apply-now list in the integration brief overlapped substantially with work
that landed in the previous run. Rather than redo it, it was re-verified green
and the effort went to the two genuinely new slices.

| Brief | Status | Where |
|---|---|---|
| **A1** RFID tap-intent attribution | **new — done here** | `6f35ba6` |
| A2 derived role lists | already done | `a06661d` |
| A3 permission provenance | already done | `a2cdee6` |
| A4 S2 invite guard | already done | `850bfbc` + `1380807` |
| **A5** org-scope convergence | **new — done here** | `0899f4b` |
| A6 support-context shadow | already done | `7e3d870` |

A6's stated precondition is worth repeating because it has not changed: **there
is no feature-flag store anywhere in the system**, so observation mode is
implemented as a structured log rather than a flag-gated behaviour switch. That
was the honest option and it remains the only one.

## Integration matrix — this run

| Slice | Files | Tests | Risk | Rollback |
|---|---|---|---|---|
| **A1** enrolled token is never an anonymous tap | `ocpp-authorize.ts` +test | +6 (35 → 41 in file) | **Medium** — touches the authorize hot path; adds one indexed point lookup on the tap path | single commit revert; no schema, no data |
| **A5** withhold identity documents from platform-derived readers | `auth-middleware.ts`, `require-permission.ts`, `admin-users.ts` +new test | +5 (route's first) | **Low** — additive context variable; redaction is response-shaping only | single commit revert; `PermissionBasis` is optional so nothing else breaks |

**Verified after both:** `tsc --noEmit -p apps/api` clean · **52 files, 707
tests, 1 skipped, all green** (from 696) · `npm run check` **9 of 10**, with
`work-view` the only failure, unchanged and pre-existing.

## A1 — what the brief asked for versus what is possible

The brief asked to "ensure tap intent consumption includes idTag/token identity
when resolving a driver-specific intent". **That is not available, and the reason
matters.**

A phone's UID is regenerated on **every tap** — nine taps, nine values, all
`08`-prefixed. There is no value to bind an intent to in advance; the intent
exists *precisely because* the tag carries no identity. Binding intents to idTag
would mean the feature could not work at all.

What is available is the **negative** discriminator: a tag that resolves to an
enrolled `IdToken` is a person's card, therefore not an anonymous tap. That is
what shipped — the tap branch is now gated on `!token`.

Cost, stated because the source comment previously claimed the opposite: the
IdToken lookup is hoisted **above** the tap branch, so a random UID now burns one
indexed point lookup it previously skipped. Correctness over a query; the comment
in source now says so rather than silently reversing the prior intent.

**Fool-tested.** Removing `!token` fails exactly three tests. The first reports
`expected 'driver-b' to be 'driver-a'` — the misattribution, reproduced. The
third reports `expected 'driver-b' not to be 'driver-b'` — a shared
installation-technical token becoming a driver identity. The contrast test (an
unenrolled random UID still consumes the intent) stays green, so the fix cannot
pass by quietly disabling tap-and-auth.

## A5 — the route inventory, and what redaction does and does not fix

Routes gated on `member.*` with **no `orgIdParam`** — so `orgId` resolves null,
the membership lookup is skipped, and only the platform expansion can satisfy
the verb:

| File | Routes | Verbs |
|---|---|---|
| `domains/identity/routes/admin-users.ts` | 7 | `member.read` ×3, `member.write` ×4 |
| `domains/identity/routes/admin-id-tokens.ts` | 4 | `member.read` ×1, `member.write` ×3 |
| `routes/admin/vehicles.ts` | 3 | `member.read` ×3 |

**14 routes.** `domains/identity/routes/admin-memberships.ts` is the
counter-example that shows the correct shape — it passes
`{ orgIdParam: "orgId" }`.

The two halves of ND-1 are now closed by different mechanisms, and the
difference is worth being precise about:

- **Password mutation** — closed by **denial**. The membership-administration
  carve-out (`b1ab0c3`) removed `member.write` from the platform expansion, so
  `PUT/DELETE /:id/password` are unreachable by any platform grant. Asserted in
  `effective-permissions.test.ts`. This is real, but it is denial rather than
  scoping, and it has a functional cost recorded at the call site.
- **Sensitive read** — closed by **redaction**, not scoping. `kennitala`,
  `dateOfBirth`, `address` and `notes` are withheld when access is
  platform-derived; identity, memberships and tokens still come back so support
  keeps working.

**Redaction is not the real fix and must not be recorded as one.** Org scope plus
a support context is. Both are blocked: the route has no org in its URL to scope
by, and `support_contexts` does not exist. What redaction buys is the removal of
a bulk-PII surface today, without inventing either.

The first real consumer of the provenance work is here: a Straumvakt employee who
is **also a genuine member** of the tenant still sees the full record. A
`platformRole !== null` check would have redacted them; the difference is exactly
what `satisfiedOnlyByPlatformGrant` exists to express, and there is a test for it.

## Corrected assumptions — this run

**B1 — "match the intent on idTag" is impossible by design**, not merely
unimplemented (above). The brief's framing carried over from the overstated ND-2.

**B2 — the tap-intent defect needs a live intent to occur at all.** Confirmed
again in the tests: with no armed intent, an `08`-shaped tag has always fallen
through to the normal lookup. Severity stays where doc 20 put it —
misattribution, conditional, not lockout.

**B3 — `UserSummary` is not an index-signature type.** A generic
`<T extends Record<string, unknown>>` redactor does not compile against it; the
helper is typed against the real DTO. Caught by `tsc`, not by tests — the third
instance this branch has produced of the two gates catching disjoint failures.

**B4 — the carve-out already satisfied half of A5 before this run started.** The
brief listed cross-tenant password mutation as open; it was closed by `b1ab0c3`.
Verified rather than assumed, and re-tested here.

## Apply / hold

### Apply now — green, fool-tested, no decision required

| Commit | Slice |
|---|---|
| `89f08cb` | RFID mint avoids the reserved `08` space |
| `a2cdee6` | additive permission provenance |
| `850bfbc` | S2 invite guard before the token claim |
| `1380807` | static guard on the invite ordering |
| `47e0214` | `resolveOrgScope` convergence + first tests |
| `7e3d870` | support-context observation, both seams |
| `a06661d` | derived exhaustive role lists |
| `6f35ba6` | **A1** — enrolled token is never an anonymous tap |
| `0899f4b` | **A5** — identity-document redaction |

### Apply after approval

| Commit | Slice | Blocked on |
|---|---|---|
| `b1ab0c3` | no platform grant confers membership administration | the password-route decision — it denies a route real operators may still need |
| `dbc76ae` | the reachability note recording that consequence | ships with `b1ab0c3` |
| `fdf7cdd` | `npm test` in CI | `work-view` being resolved — CI is already red, so the step's value is invisible until it is |

### Do not apply

Nothing. No slice on this branch was found unsafe.

### Needs a database migration

- `support_contexts` — without it, the guard can only observe.
- `audit.actions`: `support_context_id`, `on_behalf_of_org_id`, `reason`.
- `ActorKind` enum value for a bearer actor — `ALTER TYPE … ADD VALUE`, one-way.
- `IdToken.userId` nullable — the **code** tolerates it with zero type errors
  (doc 20 A2, positive-control verified); the migration is the blocker.

### Needs a product decision

1. **The admin password routes** — gate on an explicit platform verb, require a
   support context, or drop admin-set-password for the existing reset-email
   flow. Recorded at the call site in `admin-users.ts`.
2. **`work-view`** — its target `src/app/(app)/admin/work/page.tsx` no longer
   exists; fix or drop. Until then CI is red on every branch.
3. **Host self-service** — decides whether up to 85 routes need `orgIdParam`,
   and whether the 14 above get real org scope instead of redaction.
4. **Support-context rollout mode** — shadow first (recommended) or enforce.
   Needs a feature-flag mechanism, which does not exist.
5. Carried: **D-01**, **D-02** (kennitala), **D-04**, **D-10**.

## Reverting

```
git -C E:\Claude\Straumvakt-onboarding-domain log --oneline e66a10c..scratch/claude-a-backend-verification-2026-08-09
git cherry-pick <sha>          # take one slice
git branch -D scratch/claude-a-backend-verification-2026-08-09   # discard all
```

The branch is clean and has no upstream. **Do not `git stash pop` in this
worktree** — two stashes belonging to `feat/agreement-architecture` sit at the
top of the stack.
