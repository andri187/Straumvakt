# Appendix 18B — issue-ready bodies (top 50)

Fifty packages from [18A](18A-work-packages.md), written so another agent can
start from the body alone.

**Shared preamble, true of every issue below:** repo `Straumvakt`; branch from
the RC line; docs-and-code only, no cloud/DB/hardware mutation without a named
approval; every mutating endpoint writes an audit event; every repository
function takes tenant as its first argument; run `npm run check` and
`npm --prefix apps/api run typecheck` before opening a PR.

Lanes: **BE-Sec** · **BE-Domain** · **BE-Data** · **BE-OCPP** · **QA** ·
**Codex-UI** · **Ops**.

---

## Tier 1 — the Critical (A01–A05)

### A01 — Guard credential existence before token claim
**Lane** BE-Sec · **Blocked by** D-01 · **P0**

**Problem.** `POST /api/public/invites/consume` writes a credential with
`upsert(update:{passwordHash})`, so a bearer of an invite link can set the
password of an account that already has one. Full account takeover, and the
audit row names the victim.

**Source evidence.** `apps/api/src/routes/public/invites.ts:142-147` (upsert);
`:4-6` ("possession … is the only authorisation required"); `:130-132`
(conditional claim, which runs **before** the credential write).

**Proposed change.** Inside the transaction, after metadata resolution and
**before** the conditional claim, look up `userCredential` for `row.userId`. If
present, return `{ ok:false, reason:"already_claimed" }`.

**Why the ordering matters.** Refusing *after* the claim would set `usedAt`,
burning the invite and stranding the real invitee — the ADR 0053 failure in a
different file. The guard must precede the claim.

**Implementation outline.**
1. `const existing = await tx.userCredential.findUnique({ where:{userId: row.userId}, select:{userId:true} })`
2. `if (existing) return { ok:false, reason:"already_claimed" }`
3. Map the reason to HTTP 409 (see A03).

**Tests.** T-S2-1 (409, hash byte-identical, `usedAt` still null); T-S2-5
(anti-deadlock: the real invitee can still complete afterwards).

**Rollout.** Ship alone; no client change needed. **Rollback:** delete the
conditional.

**Acceptance.** Bearer + existing credential → 409, password unchanged, invite
still usable by the bound user.

---

### A02 — Replace `upsert` with `create`
**Lane** BE-Sec · **Blocked by** A01 · **P0**

**Problem.** Once A01 lands, `upsert`'s update branch is unreachable — but it
remains as a loaded weapon for the next refactor.

**Proposed change.** `tx.userCredential.create({ data:{ userId, passwordHash } })`.

**Rationale.** If the A01 guard is ever removed, the unique constraint raises and
the regression **fails loudly** instead of silently overwriting a password
again. Defence in depth for exactly this bug.

**Tests.** T-S2-2. **Acceptance.** Path unchanged for first-time invitees;
constraint violation observable if the guard is bypassed.

---

### A03 — `already_claimed` → HTTP 409
**Lane** BE-Sec · **P0**

`invites.ts:180` maps only `not_found`→404 and everything else→410. Add a 409
branch. Reuses the code `driver.ts:1090` already returns for the identical
situation — **no new vocabulary**. **Tests** T-S2-1.

---

### A04 — Audit the refusal with `actorKind:"bearer"`
**Lane** BE-Sec · **P0**

`invites.ts:165` records `membership.invite_accepted` naming the *invitee* as
actor even when a bearer acted. A refusal must be audited without asserting the
invitee did it. **Tests** T-S2-3, T-AUD-1. **Acceptance** refusal audited, actor
≠ invitee.

---

### A05 — Detection alert for credential overwrite attempts
**Lane** Ops · **Blocked by** nothing · **P0**

**Ships without D-01.** Emits a metric when a consume targets a user that
already has a credential. Converts a silent Critical into a monitored one while
the product decision is pending. **Acceptance** alert fires in a staging test.

---

## Tier 2 — support context (C01–C06, C10–C12)

### C02 — Support-context guard inside `requirePermission`
**Lane** BE-Sec · **Blocked by** C01 · **P0**

**Problem.** 43 route call sites are gated by `platform.tenant.*`. Every one is
a tenant-scoped action a Straumvakt operator can perform with no context, no
declared target, no reason, no expiry, and no `onBehalfOfOrgId` in the audit row.

**Source evidence.** `apps/api/src/lib/auth/require-permission.ts:25-74` —
already accepts `orgIdParam`, resolves `(userId, orgId)`, calls
`resolveEffectivePermissions`.

**Proposed change.** One change in one function, not 43. After resolving
permissions, determine whether the verb is satisfied **only** by a platform
grant; if so, require an open unexpired `SupportContext` for `(userId, orgId)`,
else `403 support_context_required`. Stash the context id for the audit writer.

**The distinction that keeps it safe.** A Straumvakt person who is *also* a
member of that organisation is acting as a member and needs no context. Only the
platform-grant-derived path demands one.

**Tests.** T-SC-1 (platform-only without context → 403); **T-SC-5** (dual-role
member still works — the test that stops an over-strict fix locking people out);
T-SC-3 (expiry server-side); T-SC-4 (context for org A ≠ org B).

**Rollout.** Behind a flag; enable per environment. **Rollback:** flag off
restores current behaviour exactly.

---

### C01 — `SupportContext` table
**Lane** BE-Data · **P0** · ⚑ migration

Fields per doc 17 §2.3: `staffUserId`, `targetOrgId`, `reason` (required),
`grantedPermissions[]`, `openedAt`, `expiresAt` (absolute), `closedAt?`,
`closedReason?`, `breakGlass`. New table only; no change to existing tables.

### C03 — Tenant-member path unaffected
**Lane** BE-Sec · **P0** — the guard must not require a context for
membership-derived access. **Test T-SC-5.**

### C04 — `403 support_context_required`
Distinct from generic `forbidden` so the UI can offer entry rather than a dead
end.

### C05 — Absolute expiry, enforced per request
Sliding expiry makes a support session permanent by accident.

### C06 — One context binds one organisation
Cross-org use rejected, not silently filtered — a silent filter turns a
cross-tenant bug into a partial write.

### C10/C11 — `support_context_id` and `onBehalfOfOrgId` on audit rows
Without these the enforcement is invisible in the log, which is most of the
point.

### C12 — Wire `platform.support.action`
Already defined, **zero call sites** — adopting it grants nothing retroactively.
First call site is the context-enter endpoint.

---

## Tier 3 — attribution (E01–E05, E17)

### E04 — Technical token must never resolve to a `userId`
**Lane** BE-OCPP · **Blocked by** E01 · **P0**

**Problem.** `ocpp-authorize.ts:17-21` returns `userId` with the verdict and has
no notion of token class. A shared installation token that resolves to a person
attributes **every session at that installation** to them — corrupting billing
and disputes while leaving no trace of being wrong.

**Proposed change.** With `tokenClass = installation_technical`, return
`Accepted` with `userId: null` and `attribution: "installation"`. Enforce in the
resolver, not by convention.

**Tests.** T-ATTR-1, T-ATTR-2 (concurrent sessions on one technical token name
nobody), T-ATTR-9c (driver tokens still attribute).

**Rollout.** Additive response fields; an old gateway ignoring them behaves
exactly as today.

### E01 — `IdToken.tokenClass`
`driver | physical_card | installation_technical`. **The single highest-value
field in the packet.**

### E02 — Classify existing tokens ⚑ *may need operator input*
`UNKNOWN` whether classification is derivable from data alone (Q-04). Blocks the
migrate phase; call it out rather than assume.

### E03 — `attribution` in the authorize response
`driver | installation | unknown`. `unknown` is legitimate and terminal.

### E05 — CHECK constraint
`attribution IN ('installation','unknown') ⇒ subject_user_id IS NULL`. Database-
enforced, because application-only invariants drift.

### E17 — Concurrent-session attribution test
Two sessions, one technical token, neither names a user.

---

## Tier 4 — write surface (K01–K05, K07, K08, L01, L02, L11)

### K05 — Overlap prevention via exclusion constraint
**Lane** BE-Data · **P0**

Two active agreements for the same `(type, counterparty, installation)` with
overlapping effective ranges make pricing non-deterministic. Enforce with a
database exclusion constraint, **not** application check-then-insert, which
races. **Test** T-AGR-overlap.

### K03 — Agreement activate
The audited moment. Draft edits are cheap; activation carries actor, reason and
a pricing snapshot. **Never mutate an active agreement's pricing** — retire and
supersede, so historical sessions stay re-resolvable.

### K07 — Activation permission is org admin only
Staff may prepare, **not** activate. An organisation accepting pricing it never
saw, recorded as accepted because staff clicked, is the failure that survives
into billing disputes.

### K08 — Pricing preview reuses `debug-resolve`
`POST /api/admin/agreements/debug-resolve` already exists and does this. **Do
not write a second pricing implementation** — a second implementation is how
four generations of pricing logic happened.

### K01/K02/K04 — create / update-draft-only / retire
No deletes, ever.

### L01/L02 — clause scope and assignment
Scopes: org, driver group, installation, charger. **No per-driver scope for
beta** — it multiplies the resolution matrix with no evidenced demand.

### L11 — Overlap rejection test
Required explicitly by the test matrix.

---

## Tier 5 — the rest of the top 50

Each below is one issue; the body is the row plus the shared preamble.

| ID | Lane | One-line issue |
|---|---|---|
| A08 | QA | Permanent anti-deadlock regression test (T-S2-5) |
| A10 | BE-Sec | Make `ConsumeBody` strict, or verify the extra field |
| A11 | BE-Sec | Decide kennitala: verify against invitee, or stop collecting ⚑ D-02 |
| A12 | Codex-UI | Rename the mobile contract test; assert the real server shape |
| B01 | BE-Domain | `POST /api/driver/join` skeleton, session required for every method |
| B03 | BE-Domain | `join` method `accessCode` |
| B05 | BE-Sec | One generic `not_available` for every join failure cause |
| B06 | BE-Domain | Idempotency-Key on join |
| B10 | Ops | Deprecation counter on legacy invite entries |
| B12 | BE-Sec | Identity-bind `consume` ⚑ gated on adoption |
| D01 | BE-Sec | Delete `platform.impersonate` (zero call sites) |
| D02 | BE-Sec | Enforce `member.remove` |
| D10 | QA | Test: no tenant verb composes into a platform verb |
| E06 | BE-Data | `session_attribution` table |
| E08 | BE-Domain | Upgrade-only attribution; downgrade needs a correction event |
| E14 | BE-Domain | Unknown attribution billable to installation, never a fabricated person |
| F01 | Ops | Shadow-mode evidence report per installation |
| F02 | Ops | Staged `enforceAuthorize` rollout runbook ⚑ external |
| F09 | BE-OCPP | Never infer EVCCID/EMAID presence in signed meter data |
| G01 | BE-Data | `onboarding_workflow` table + partial unique index |
| G06 | BE-Domain | `GET …/onboarding` summary matching Codex's shape |
| G09 | BE-Domain | Only `active` workflows confer driver access |
| J01 | BE-Data | `installation_access_credential` table |
| J03 | BE-Domain | Create returns the passphrase exactly once |
| J06 | BE-Sec | Fail-closed rate limiting on join |
| N01 | BE-Sec | Actor never derived from request input |
| N03 | BE-Domain | Audit projection endpoint, org-visible |
| O01 | Codex-UI | Disabled-state copy library |
| O04 | Codex-UI | No-backend-workaround rule in UI tests |
| P04 | QA | Permission-matrix test generated from source |
| P05 | QA | Enforced-verb inventory test — a new unenforced verb fails CI |
| Q06 | Ops | Define "supported client version" ⚑ D-04 |
| R01 | Ops | Alert on credential-overwrite attempts |

**Count: 17 full bodies + 33 row-form = 50.**
