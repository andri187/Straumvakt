# Appendix 19C — test specifications

**76 source-linked specifications**, `TS-01`–`TS-68` plus the extensions noted
in each part. The brief asked for 60.

Classifications: `unit` · `route` · `contract` · `integration-db` · `migration` ·
`mobile-contract` · `web-contract` · `offline-static` · `future-hardware-beta`.

**No test was run in this session.** Everything below is a specification.

Three facts govern how to read this appendix, and all three were verified in
source:

1. **Nothing runs in CI.** `.github/workflows/check.yml` has three steps and
   `scripts/check-all.mjs:14-36` lists nine offline static checks, none of them
   vitest. A spec marked "unattended-safe" means *safe to run*, not *currently
   running*.
2. **`apps/api/test/**` is not in the root vitest include.** `vitest.config.ts`
   covers `src/**`, `apps/api/src/**`, `packages/**`, `scripts/**/*.test.mjs` —
   so the parity suite runs **only** under `apps/api/vitest.parity.config.ts`
   with a live `PARITY_DATABASE_URL`. Any new offline test must live under
   `apps/api/src/` to run at all.
3. **`gateway/` has its own runner** (`npm --prefix gateway test`, five test
   files including a 1,485-line `identity-do.test.ts`) that no root script and
   no CI step invokes.

Every DB-bound spec requires an **approved disposable branch**. The parity suite
**mutates**; it must never be pointed at staging or production.

---

## Appendix 19C part 1 of 2 — test specifications: S2, invite compatibility, kennitala, permission provenance, support context, impersonate removal

38 specifications, TS-01..TS-38, grouped by subject. Every source path below was
opened on branch `docs/singular-onboarding-domain-packet` at tip `fc071b3`. No
test was run, no database was contacted, no file under the worktree was written.

**Two runner facts that constrain every spec here.** (1) The root suite is
`vitest.config.ts`, whose `include` is exactly `src/**/*.test.ts`,
`apps/api/src/**/*.test.ts`, `packages/**/*.test.ts`, `scripts/**/*.test.mjs`.
A new test placed anywhere else — notably `apps/api/test/` — will not run under
`npm test`, silently. (2) `apps/api/test/parity/*.test.ts` runs only under
`apps/api/vitest.parity.config.ts` (`npm --prefix apps/api run test:parity`),
needs `PARITY_DATABASE_URL`, and its own header states it is read-only against
the Neon test branch. Every S2 spec below writes rows, so it needs a disposable
branch, not the read-only one the harness was built for.

Classification legend: `unit` pure function, `route` Hono `app.request` with
mocked clients, `contract` schema/DTO shape, `integration-db` real Postgres,
`migration` DDL, `mobile-contract` Dart, `web-contract` Next.js or archived
console, `offline-static` repo scan with no runtime, `future-hardware-beta`
needs a beta environment or bench hardware.

---

### Group 1 — S2 invite consume hardening (scenarios 1–18, packages A01–A14)

Anchor file: `apps/api/src/routes/public/invites.ts`. It has **no test file
today** — `apps/api/src/routes/public/` contains `email-verification.test.ts`,
`password-reset.test.ts` and `register.test.ts`, and nothing for `invites.ts`.
`register.test.ts:10-21` is the pattern to copy: `vi.hoisted` mocks plus
`vi.mock("../../lib/prisma", () => ({ makePrisma: () => ({}) }))`.

**TS-01** `route` — a bearer holding an invite for a user who already has a password is refused with 409 and the token is left unclaimed.
`apps/api/src/routes/public/invites.ts` `apps/api/src/routes/public/invites.test.ts` · **Scen** 1-3 · **Pkg** A01, A03 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** mock `makePrisma` to return `{ $transaction: (cb) => cb(tx) }` where `tx.userToken.findUnique` yields `{ id, userId, kind: "invite", usedAt: null, expiresAt: <future>, metadata: { orgId, email } }` and `tx.userCredential.findUnique` yields `{ passwordHash: "pbkdf2:sha256:100000:AAA:BBB" }` · **Assert:** status 409, body `{ error: "already_claimed" }`, and `tx.userToken.updateMany` was never called (today the conditional claim at `invites.ts:130-133` runs before the credential write at `:142-146`) · **Failure means:** possession of an invite link overwrites the password of an established account, and burns the invite doing it.

**TS-02** `route` — the clean path writes the credential with `create`, never `upsert`.
`apps/api/src/routes/public/invites.ts` `apps/api/src/routes/public/invites.test.ts` · **Scen** 4 · **Pkg** A02 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** same transaction stub, `tx.userCredential.findUnique` yields `null` · **Assert:** status 200; `tx.userCredential.create` called exactly once with a `passwordHash` matching `/^pbkdf2:sha256:100000:/` (the shape `hashPassword` emits at `apps/api/src/lib/password.ts:78`); `tx.userCredential.upsert` is not a called method on the stub · **Failure means:** the update branch survives and TS-01's guard is the only thing standing between a bearer and an account takeover — defence in depth is gone.

**TS-03** `route` — a user whose password an admin deliberately cleared can still redeem.
`apps/api/src/routes/public/invites.ts` `apps/api/src/domains/identity/repositories/users.ts` `apps/api/src/routes/public/invites.test.ts` · **Scen** 4 · **Pkg** A01 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** `tx.userCredential.findUnique` yields `{ passwordHash: null }` — the exact state `clearUserPasswordHash` leaves behind (`apps/api/src/domains/identity/repositories/users.ts:381-386`, called from `admin-users.ts:162`); `UserCredential.passwordHash` is nullable at `prisma/schema/identity.prisma:343` · **Assert:** status 200 and the hash is written · **Failure means:** the guard was written as "does a credential row exist" and permanently locks out every user an operator reset. Note the guard already shipped at `apps/api/src/routes/public/driver.ts:1089` tests `row.user.credentials !== null` — porting it verbatim, as the packet suggests, reintroduces exactly this bug.

**TS-04** `route` — the consume status map is total and each reason has its own status.
`apps/api/src/routes/public/invites.ts` `apps/api/src/routes/public/invites.test.ts` · **Scen** 9-12, 16 · **Pkg** A03, A13 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** table-driven, one transaction stub per reason: unknown hash, `kind: "driver"`, `usedAt` set, `expiresAt` in the past, `metadata: {}`, and the TS-01 already-claimed case · **Assert:** `not_found` 404, `kind` mismatch 404 with the identical body, `already_used` 410, `expired` 410, `malformed_metadata` 400, `already_claimed` 409. Today `invites.ts:180` is `reason === "not_found" ? 404 : 410`, so three of these six are wrong · **Failure means:** clients cannot distinguish "try again with the right code" from "this account already exists", and the mobile switch at `apps/mobile/lib/api/client.dart:122-137` keeps showing the wrong sentence.

**TS-05** `route` — `GET /peek` answers 400 for malformed metadata and 404 for a non-invite token.
`apps/api/src/routes/public/invites.ts` `apps/api/src/routes/public/invites.test.ts` · **Scen** 12, 16 · **Pkg** A13 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** `db.userToken.findUnique` yields a row with `metadata: { orgId: "…" }` and no `role`/`email`; second case yields `kind: "magic_link"` · **Assert:** first case 400 (today `invites.ts:69` returns **500**), second case 404 with the same body as an unknown token · **Failure means:** a client-side fault is reported as a server fault, so it never reaches an error budget or an alert, and the peek endpoint distinguishes token kinds to an unauthenticated caller.

**TS-06** `unit` — the "hash is byte-identical after refusal" assertion must read the stored string, not re-hash.
`apps/api/src/lib/password.ts` `apps/api/src/lib/password.test.ts` · **Scen** 1 · **Pkg** A01 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/password.test.ts`
- **Fixture:** call `hashPassword("correct horse battery")` twice · **Assert:** the two strings differ (16 random salt bytes, `password.ts:75-76`) while `verifyPassword` returns true against both · **Failure means:** whoever writes scenario 1 compares a re-hash to the stored value, the test fails for the wrong reason, and the real assertion — the stored column is unchanged — never gets written.

**TS-07** `integration-db` — a refused consume leaves the invite usable by its rightful recipient.
`apps/api/src/routes/public/invites.ts` `apps/api/test/parity/invite-consume-hardening.test.ts` · **Scen** 2, 3 · **Pkg** A01, A08 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** seed a user with a credential, an `identity.user_tokens` row `kind='invite'` bound to them, and a `tenancy.memberships` row at `status='invited'`; run the runner as `npm --prefix apps/api run test:parity` against a writable branch (the existing harness at `apps/api/test/parity/_harness.ts:25-29` is documented read-only, so it cannot host this as-is) · **Assert:** after the 409, `used_at` is still NULL and a second consume by the legitimate flow succeeds · **Failure means:** the ADR 0053 deadlock repeats — a refusal consumes the only artefact the user needs to recover.

**TS-08** `integration-db` — two concurrent consumes of one token produce exactly one winner.
`apps/api/src/routes/public/invites.ts` `apps/api/test/parity/invite-consume-hardening.test.ts` · **Scen** 7, 8 · **Pkg** A09 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** two `Promise.all` requests against one token hash, driving the conditional `updateMany` at `invites.ts:130-133` · **Assert:** one 200, one 410 `already_used`, exactly one credential row, exactly one `audit.actions` row · **Failure means:** the CAS is not a CAS and the loser gets a raw unique-violation instead of a modelled status.

**TS-09** `integration-db` — a refused consume writes an audit row whose actor is not the invitee.
`apps/api/src/lib/audit.ts` `apps/api/src/routes/public/invites.ts` `apps/api/test/parity/invite-consume-hardening.test.ts` · **Scen** 5, 6 · **Pkg** A04 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** trigger the TS-01 refusal, then read `audit.actions` for the org · **Assert:** a row exists with `action` naming the refusal and `actor_user_id` NOT equal to the invited user's id. Blocked on TS-10 for the `actorKind` half: `ActorKind` is exactly `user, system, vendor_webhook, ocpp_worker` (`prisma/schema/platform.prisma:119-126`), so `"bearer"` is not writable today and the spec must assert `system` until the enum migrates · **Failure means:** the log says the victim did it, which is the single most misleading thing an audit trail can say.

**TS-10** `migration` — `audit.actions.actor_kind` gains a `bearer` value.
`prisma/schema/platform.prisma` `packages/shared/src/db/platform.ts` `apps/api/src/lib/audit.ts` · **Scen** 6 · **Pkg** A04 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** apply the new migration under `prisma/migrations/`, then insert through `recordAuditAction` on both branches of `apps/api/src/lib/audit.ts:62-85` (Drizzle at `:63`, Prisma at `:75`) · **Assert:** the enum has five values; both branches accept `actorKind: "bearer"`; the Drizzle table definition in `packages/shared/src/db/platform.ts` matches, so `check:schema-consistency` stays green · **Failure means:** 18A scoped A04 as "new audit branch" when it is an enum migration; shipping the branch without the migration throws at runtime on the first refusal.

**TS-11** `offline-static` — `userCredential.upsert` cannot reappear in the consume path.
`apps/api/src/routes/public/invites.ts` `apps/api/src/routes/public/invites.guard.test.ts` · **Scen** 18 · **Pkg** A02, A05 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/routes/public/invites.guard.test.ts`
- **Fixture:** read the sibling source with `node:fs` — the technique `scripts/check-schema-consistency.test.mjs` already uses for a check script · **Assert:** the file text contains `userCredential.create` and contains neither `userCredential.upsert` nor `upsert(` · **Failure means:** the fix regresses in a later refactor with nothing to catch it; scenario 18 asks for review to flag it, and review does not run on every commit.

**TS-12** `route` — the two public invite endpoints carry a rate limiter.
`apps/api/src/routes/public/invites.ts` `apps/api/src/lib/rate-limit.ts` `apps/api/src/routes/public/invites.test.ts` · **Scen** 11, 12 · **Pkg** A05 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** `vi.mock("../../lib/rate-limit")` with a spy factory, then request `/peek` and `/consume`. Today `invites.ts` does not import `rate-limit` at all (zero matches) while `register.ts:74-79` and `driver.ts:1031` do · **Assert:** the `rateLimit` factory was invoked for both routes. Do **not** assert fail-closed behaviour here: `apps/api/src/lib/rate-limit.ts:121-129` fails **open** with a `console.warn` when the binding is absent, which is the opposite of what `T-RL-failclosed` and scenario 127 assume · **Failure means:** `not_found` versus `already_used` on an unthrottled endpoint is a free token-validity oracle.

---

### Group 2 — invite compatibility (scenarios 19–30, packages A06, A07, A12, B08–B13)

**TS-13** `web-contract` — the archived console form's body still succeeds for a first-time invitee after S2.
`archive/straumvakt-org-console-2026-08-08/app/invite/[token]/accept-form.tsx` `apps/api/src/routes/public/invites.test.ts` · **Scen** 19 · **Pkg** A07 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** post the literal body the archived form sends, `{ token, password }` (`accept-form.tsx:49-52`), against the TS-02 clean-path stub · **Assert:** 200. Also assert the form has no `already_claimed` branch today — it handles only `expired` and `already_used` — so A07's copy work is real and not already done · **Failure means:** S2 breaks the only web redemption implementation that exists. Note this form is **not deployed**: `src/app/` contains only `home`, `org`, `staff`, and no `/invite/[token]` route, so scenario 19 tests an archived artefact.

**TS-14** `contract` — `ConsumeBody` strictness is decided once, and both branches are asserted.
`apps/api/src/routes/public/invites.ts` `apps/api/src/routes/public/register.ts` `apps/api/src/routes/public/invites.test.ts` · **Scen** 13, 20 · **Pkg** A10 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** parse `{ token, kennitala, password }` through the schema at `invites.ts:36-39` · **Assert:** exactly one of two committed expectations, chosen by the A11 decision — strict gives `400 { error: "validation" }`, non-strict gives a 200 with `kennitala` absent from everything the handler touches. `RegisterBody` at `register.ts:41-56` **is** `.strict()`, so today the two public onboarding routes disagree · **Failure means:** flipping consume to strict returns 400 to **every** current mobile redemption (`apps/mobile/lib/api/client.dart:101-105` always sends the third field), which is scenario 23's "failing by design" landing on shipped clients rather than archived ones.

**TS-15** `mobile-contract` — the Dart client posts exactly three keys to consume, and kennitala is mandatory client-side.
`apps/mobile/lib/api/client.dart` `apps/mobile/lib/screens/redeem_invite.dart` `apps/mobile/test/api/client_contract_test.dart` · **Scen** 20 · **Pkg** A12 · **Unattended-safe** no · **Codex may rely** yes
- **Command:** none — `flutter test` requires a `pub get` fetch; run under an approved network step
- **Fixture:** the test file does **not** exist on this branch (`apps/mobile/test/` contains only `widget_test.dart`). Create it with an injected HTTP client capturing the request body · **Assert:** the JSON body has exactly the keys `token`, `kennitala`, `password` (`client.dart:101-105`); the form validator rejects an empty or non-10-digit kennitala (`redeem_invite.dart:243-244`) · **Failure means:** the client contract that A10 and A11 are deciding about is asserted nowhere, so the decision is made against a reading of the source rather than a test.

**TS-16** `mobile-contract` — `already_claimed` has driver-facing copy.
`apps/mobile/lib/api/client.dart` `apps/mobile/test/api/client_contract_test.dart` · **Scen** 23 · **Pkg** A06 · **Unattended-safe** no · **Codex may rely** yes
- **Command:** none — `flutter test` requires a `pub get` fetch; run under an approved network step
- **Fixture:** call `_inviteErrorMessage("already_claimed")` (the switch at `client.dart:122-137`) · **Assert:** the returned string is not the default template, which today interpolates the raw code as "Could not redeem invite (already_claimed)." · **Failure means:** the first user to hit the new 409 sees a machine code in a consumer app.

**TS-17** `offline-static` — the endpoint inventory stays in step with the route surface.
`scripts/gen-api-endpoints.mjs` `docs/reference/api-endpoints.md` `apps/api/src/index.ts` · **Scen** 25 · **Pkg** B08 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `node scripts/gen-api-endpoints.mjs --check`
- **Fixture:** none — the script walks `apps/api/src/index.ts` mounts and each sub-app · **Assert:** exit 0, and the committed doc contains no `/api/driver/join` today (Group B is greenfield; `apps/api/src/routes/public/` has no `join.ts`). When B08's capability endpoint lands it must appear in the same commit · **Failure means:** the route surface Codex reads from moves without a diff anyone reviews. This check is already in `scripts/check-all.mjs:28`, so it is the one CI-enforced item in this appendix.

**TS-18** `future-hardware-beta` — old app against hardened server on beta.
`apps/api/src/routes/public/invites.ts` `apps/mobile/lib/api/client.dart` (no test file — runbook) · **Scen** 21, 23 · **Pkg** B13 gate · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs a beta environment
- **Fixture:** a build of the shipped app pointed at a beta API carrying S2 · **Assert:** a first-time invitee still completes; an already-claimed invitee gets a 409 the old app renders without crashing (it falls to the default branch, so this is a copy failure, not a crash) · **Failure means:** stage 6 retirement is attempted before the adoption gate, and existing installs break in the field.

---

### Group 3 — kennitala (scenarios 13–15, 20, 23; packages A10, A11, A12, I02)

Grounding: `identity.users.kennitala` is `String? @unique` (`prisma/schema/identity.prisma:25`); `register.ts:45` enforces `/^\d{10}$/`; `apps/api/src/repositories/host-invites.ts:174` states in a comment that "the redemption captures kennitala (ADR 0028 §4)" — and no redemption path reads it. `apps/api/src/routes/public/driver.ts` contains **zero** occurrences of `kennitala`.

**TS-19** `unit` — one normaliser, shared shape with the mobile client and the register route.
`apps/api/src/lib/kennitala.ts` (greenfield — does not exist) `apps/api/src/lib/kennitala.test.ts` · **Scen** 13, 14 · **Pkg** A11 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/kennitala.test.ts`
- **Fixture:** a table including `"1234567890"`, `"123456-7890"`, `"12 3456 7890"`, `"123456789"`, `""` · **Assert:** the normaliser strips non-digits exactly as `_digits` does in `apps/mobile/lib/screens/redeem_invite.dart:78-87`, then accepts only 10 digits, matching `register.ts:45`. Checksum validation is **unverified** as a requirement — do not invent one · **Failure means:** the app sends a dashed form the server rejects, or two routes disagree about what a kennitala is.

**TS-20** `contract` — verify-or-drop is implemented as exactly one behaviour and asserted against the real mobile payload.
`apps/api/src/routes/public/invites.ts` `apps/mobile/lib/api/client.dart` `apps/api/src/routes/public/invites.test.ts` · **Scen** 14 · **Pkg** A11, I02 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/public/invites.test.ts`
- **Fixture:** post the three-key body with a kennitala matching the invited user's stored value and once with a different one · **Assert:** under "verify", match gives 200 and mismatch gives the generic failure of TS-21; under "drop", both give 200 and the field is never read. The test file must contain only one of these two describe blocks — a repo carrying both is the ambiguity A11 exists to end · **Failure means:** the field is collected in the app, shown to the user as required, and silently discarded — a consent and data-minimisation problem as much as a correctness one.

**TS-21** `integration-db` — a mismatched kennitala is indistinguishable from an unknown token.
`apps/api/src/routes/public/invites.ts` `apps/api/test/parity/invite-consume-hardening.test.ts` · **Scen** 15 · **Pkg** A11 · **Unattended-safe** no · **Codex may rely** yes
- **Command:** none — needs approved disposable DB branch
- **Fixture:** one valid token with a mismatched kennitala, one wholly unknown token · **Assert:** the two responses are byte-identical in status and body, and the mismatch leaves `used_at` NULL · **Failure means:** an attacker with a stolen invite link can enumerate whether a given kennitala belongs to the invited person.

**TS-22** `integration-db` — a kennitala collision surfaces as a modelled failure, not a 500.
`prisma/schema/identity.prisma` `apps/api/src/repositories/registration.ts` `apps/api/test/parity/invite-consume-hardening.test.ts` · **Scen** 15 · **Pkg** I02 · **Unattended-safe** no · **Codex may rely** yes
- **Command:** none — needs approved disposable DB branch
- **Fixture:** user A already holds kennitala K; redeem an invite bound to user B supplying K, under the "verify **and write**" reading of A11 · **Assert:** the response is the same generic failure as TS-21 and never a Postgres unique-violation. `register.ts:19` already documents a `kennitala_taken` 409 for the registration route, so the two routes must agree deliberately · **Failure means:** the unique index at `identity.prisma:25` turns a data conflict into a 500 and the invite is burned.

---

### Group 4 — permission provenance (scenarios 63–70; packages C02, C03, D10)

Verified counts on this branch: **163** non-comment `requirePermission(` call sites under `apps/api/src/routes` and `apps/api/src/domains`, of which **32** pass `orgIdParam`; **2** `assertPermission(` call sites, both in `apps/api/src/routes/admin/access-requests.ts` (`:90`, `:178`).

**TS-23** `unit` — the resolver reports *why* a verb is held, not just that it is.
`apps/api/src/lib/auth/effective-permissions.ts` `apps/api/src/lib/auth/effective-permissions.test.ts` · **Scen** 52, 63, 64 · **Pkg** C02, C03 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/auth/effective-permissions.test.ts`
- **Fixture:** extend `expandPermissionsSync` (`effective-permissions.ts:177-186`) with a provenance-returning sibling; call it with membership `admin` plus grant `support_agent`, and with grant only · **Assert:** `member.remove` is tagged `membership` in the first case and `platform_expansion` in the second, with the expansion originating at `expandPlatformTenantVerbs:103-139` · **Failure means:** C02 and C03 are not implementable. The resolver returns a flat `Permission[]`, so `requirePermission` cannot tell a tenant admin from platform staff and the support-context guard has nothing to branch on.

**TS-24** `unit` — the breadth of the `sales_cs` expansion is pinned in a test, not in a comment.
`apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/effective-permissions.ts` `apps/api/src/lib/auth/effective-permissions.test.ts` · **Scen** 67 · **Pkg** D10, C03 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/auth/effective-permissions.test.ts`
- **Fixture:** `expandPermissionsSync(null, { role: "sales_cs" })` · **Assert:** the set contains `member.remove`, `member.invite`, `member.write`, `org.write`, `billing.write`, `tariff.write`, `contract.write`, `charger.config`, `charger.remote_start`, `charger.remote_stop` — in every organisation, since no org filter exists at this layer. The existing test at `effective-permissions.test.ts:54-60` only checks read and write on `site.*` and stops · **Failure means:** the claim at `permissions.ts:268` that `platform.tenant.write` is "column-restricted in repo layer (org notes/tags only)" stays believed. **It is not implemented anywhere** — no repo-layer column restriction was found — so a sales role can remove members and start chargers in every tenant.

**TS-25** `unit` — no per-tenant verb ever composes into a platform verb.
`apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/effective-permissions.test.ts` · **Scen** 66, 67 · **Pkg** D10 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/auth/effective-permissions.test.ts`
- **Fixture:** iterate every `MembershipRole` through `expandPermissionsSync({ role }, null)` · **Assert:** no returned verb starts with `platform.`; and for every `PlatformRole`, the platform-prefixed subset of the expansion equals `PLATFORM_ROLE_PERMISSIONS[role]` exactly — the expansion adds per-tenant verbs only · **Failure means:** a contractor or host_admin bundle acquires a platform capability by composition, which is the one direction the model must never allow. This spec passes against today's code and is pure regression insurance.

**TS-26** `unit` — the "exhaustive" role-coverage test is actually exhaustive.
`apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/permissions.test.ts` · **Scen** 65, 66 · **Pkg** D10 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/auth/permissions.test.ts`
- **Fixture:** derive the role list from `Object.keys(MEMBERSHIP_ROLE_PERMISSIONS)` instead of the hand-written `ALL_MEMBERSHIP_ROLES` literal at `permissions.test.ts:26-38` · **Assert:** the derived list has 12 entries and includes `host_admin`. Today the literal lists 11 and **omits `host_admin`**, so the bundle at `permissions.ts:186-192` — the going-public host role — is covered by none of the four "exhaustive" assertions in that describe block · **Failure means:** the test that is supposed to catch an unbundled role silently skips the newest one, which is precisely the failure mode it was written to prevent.

**TS-27** `route` — a gate declared without `orgIdParam` resolves with a null org, whatever the URL contains.
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/lib/auth/require-permission.test.ts` · **Scen** 52, 63, 64 · **Pkg** C03 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/auth/require-permission.test.ts`
- **Fixture:** the file's existing `vi.mock("./effective-permissions")` at `:29-37`, upgraded to record the `orgId` argument; mount `requirePermission("member.read")` with **no** options on `/test/:orgId` and request `/test/org-A` · **Assert:** the resolver was called with `orgId === null` (`require-permission.ts:69-71`), so `getActiveMembership` is skipped entirely at `effective-permissions.ts:160` and only the platform expansion can satisfy the verb · **Failure means:** C03's premise collapses. On the 131 gates that pass no `orgIdParam` there is no membership-derived path to leave alone — a `host_admin` can never pass them, and every caller who does is platform staff who will need a support context.

**TS-28** `route` — the bootstrap early return sits above any new guard, on both enforcement seams.
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/lib/auth/require-permission.test.ts` · **Scen** 63, 69 · **Pkg** C02 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/auth/require-permission.test.ts`
- **Fixture:** the bootstrap-shaped session already constructed at `require-permission.test.ts:67-78` (`sub: "admin"`, no `userId`); add the same case for `assertPermission` · **Assert:** with a support-context guard installed, the bootstrap-shaped session still reaches the handler — documenting the bypass — and a session carrying `userId` does not. `isBootstrapSession` (`:147-151`) requires `sub === "admin"` **and** no `userId`; the early returns are at `:55-59` and `:115-117`, both **above** where a guard would land · **Failure means:** C02 is bypassable by any session of the pre-Sprint-5.5 shape. The login route at `apps/api/src/routes/admin/auth.ts:134-137` always stamps `userId` now, so fresh cookies take the real path — but the cookie is a 12h HMAC with no revocation (`apps/api/src/lib/admin-session.ts:6, :79-100`), so an old one remains valid until it expires.

---

### Group 5 — support context (scenarios 47–62; packages C01–C15, all greenfield)

Grepping the tree for `SupportContext`, `support_context`, `supportContext`, `onBehalfOfOrgId` returns hits in exactly two files: `apps/api/src/lib/auth/permissions.ts:83` and `apps/api/src/lib/auth/permissions.test.ts`. There is no module, no table, no column, no call site. `apps/api/src/lib/auth/org-scope.ts` is the only module in `lib/auth/` with **no test file at all**.

**TS-29** `migration` — the `support_contexts` table exists with the columns the guard reads per request.
`prisma/schema/identity.prisma` `packages/shared/src/db/identity.ts` `prisma/migrations/` · **Scen** 47, 48 · **Pkg** C01 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** add the model to the schema **folder** — `prisma/schema.prisma` is not a file here; the schema is `prisma/schema/` with eight `.prisma` files, and `apps/api/prisma/schema/` is a generated copy kept in step by `npm run check:api-schema` · **Assert:** columns for staff user, bound org, reason, opened-at, absolute expiry, closed-at and a break-glass flag; a partial unique index preventing two open contexts for one staff user; `npm run check:schema-consistency` still passes because the Drizzle table in `packages/shared/src/db/identity.ts` matches · **Failure means:** C05 and C06 have nowhere to store expiry or the org binding. `identity.platform_grants` cannot substitute — its PRIMARY KEY is `user_id` (`packages/shared/src/db/identity.ts:386-389`), so a user has at most one grant and it cannot be org-bound.

**TS-30** `migration` — every staff action carries its context on the audit row.
`prisma/schema/platform.prisma` `apps/api/src/lib/audit.ts` `packages/shared/src/db/platform.ts` · **Scen** 49, 55 · **Pkg** C10, C11 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** add `support_context_id` and `on_behalf_of_org_id` to `audit.actions` (model at `prisma/schema/platform.prisma:99-117`), then write through both branches of `recordAuditAction` · **Assert:** `AuditActionInput` (`apps/api/src/lib/audit.ts:26-34`) carries both fields; the Drizzle insert at `:63-71` and the Prisma create at `:75-85` both persist them; a write with an open context populates both and a tenant-member write leaves both NULL · **Failure means:** scenario 55 — the org seeing staff access in its own audit view — has no data behind it, and the C10 acceptance "every staff action carries it" is unverifiable.

**TS-31** `route` — platform-derived access with no context returns a distinct `support_context_required`.
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/routes/admin/access-requests.ts` `apps/api/src/lib/auth/require-permission.test.ts` · **Scen** 47 · **Pkg** C02, C04 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/auth/require-permission.test.ts`
- **Fixture:** a session with `userId`, a mocked resolver returning a platform-expansion provenance from TS-23, and no open context · **Assert:** 403 with `{ error: "support_context_required" }` — distinguishable from the existing `{ error: "forbidden", reason: "permission_missing", required }` at `require-permission.ts:76-85`. Repeat through `assertPermission`, whose own denial at `:127-132` is a separate code path · **Failure means:** the UI cannot offer a context-entry affordance because it cannot tell "you need to open a context" from "you are not allowed at all" — and a guard added only to the middleware factory leaves `access-requests.ts:90` and `:178` open.

**TS-32** `route` — a dual-role caller is never asked for a context.
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/lib/auth/require-permission.test.ts` · **Scen** 52, 64 · **Pkg** C03 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/auth/require-permission.test.ts`
- **Fixture:** membership `admin` at org-A plus a `support_agent` platform grant; gate declared **with** `orgIdParam` (one of the 32 that pass it) · **Assert:** 200 with no context present, because the verb is satisfied by the membership bundle · **Failure means:** staff who are also customers of their own product are locked out of their own organisation, which is the regression C03 exists to prevent. Note this can only be asserted on `orgIdParam`-bearing gates — see TS-27.

**TS-33** `integration-db` — a context binds one org and dies at its absolute expiry.
`apps/api/src/lib/auth/support-context.ts` (greenfield) `apps/api/test/parity/support-context.test.ts` · **Scen** 50, 51, 56 · **Pkg** C05, C06, C09 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** open a context for org_alpha; act on org_beta; then set `expires_at` into the past and repeat on org_alpha; then close and repeat · **Assert:** 403 in all three cases, and the pre-expiry org_alpha action succeeds. `getActivePlatformGrant` already does per-request expiry (`effective-permissions.ts:84`) and is the pattern to copy · **Failure means:** a context becomes an ambient cross-tenant grant, which is worse than the platform grant it was meant to constrain.

**TS-34** `route` — `platform.support.action` gets its first enforcement call site, and a reason is mandatory.
`apps/api/src/lib/auth/permissions.ts` new `apps/api/src/routes/admin/support-contexts.ts` and its test · **Scen** 53, 59 · **Pkg** C07, C12 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/admin/support-contexts.test.ts`
- **Fixture:** two sessions, one holding `platform.support.action` and one not; bodies with and without a reason · **Assert:** missing verb 403, missing reason 400, valid 201 with the context id. The verb is declared at `permissions.ts:83` and bundled at `:262` and via the `super_user` spread at `:243`, and has **zero** enforcement call sites today · **Failure means:** anyone who can reach the endpoint can open a context, and the role distinction between `support_agent` and every other platform role is decorative.

---

### Group 6 — impersonate removal (scenarios 71–74; package D01)

`platform.impersonate` has **zero** enforcement call sites. Its only code occurrences are `apps/api/src/lib/auth/permissions.ts:82` (catalogue), `:249` (`platform_admin`), `:261` (`support_agent`), plus the `super_user` spread at `:243`, and one assertion at `apps/api/src/lib/auth/permissions.test.ts:192`.

**TS-35** `unit` — the verb is absent from the catalogue and from every bundle.
`apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/permissions.test.ts` · **Scen** 71, 73 · **Pkg** D01 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/auth/permissions.test.ts`
- **Fixture:** none — pure catalogue read · **Assert:** `PLATFORM_PERMISSIONS` does not contain `"platform.impersonate"`, and no value of `PLATFORM_ROLE_PERMISSIONS` contains it. The existing assertion at `permissions.test.ts:192` (`support_agent` has it) must be deleted in the **same commit**, or the removal ships red · **Failure means:** the verb stays live in the type union, and any future route can gate on a capability the product decided not to build.

**TS-36** `unit` — `super_user` stays a literal exhaustive list after the removal.
`apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/permissions.test.ts` · **Scen** 73 · **Pkg** D01 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/auth/permissions.test.ts`
- **Fixture:** none · **Assert:** `PLATFORM_ROLE_PERMISSIONS.super_user` has the same length and membership as `PLATFORM_PERMISSIONS` — it is written as the spread `[...PLATFORM_PERMISSIONS]` at `permissions.ts:243`, so removal shrinks it automatically, and the existing test at `:176-181` should keep passing · **Failure means:** the deliberate-decision property the file's own header claims for `super_user` is lost, and a future platform verb is granted by accident.

**TS-37** `offline-static` — no code anywhere references the verb.
`apps/api/src/**` `packages/**` `src/**` `scripts/**` new `scripts/check-retired-verbs.test.mjs` · **Scen** 72 · **Pkg** D01 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run scripts/check-retired-verbs.test.mjs`
- **Fixture:** walk the four source trees with `node:fs`, excluding `docs/`, `archive/` and `node_modules/` · **Assert:** zero occurrences of the string `platform.impersonate`. Today there are 4 in code (three in `permissions.ts`, one in `permissions.test.ts`) and 9 in `docs/` — ADR 0014, ADR 0016, `SPRINT_04_TASKS.md`, `SPRINT_08_TASKS.md`, the delivery plan and the hierarchy-review note — which the exclusion deliberately leaves alone as historical record · **Failure means:** the verb creeps back through a copy-paste of a bundle, and scenario 72's "no call site references it" is asserted by nothing.

**TS-38** `integration-db` — a grant minted before the removal confers nothing.
`apps/api/src/lib/auth/effective-permissions.ts` `apps/api/test/parity/permission-resolution.test.ts` · **Scen** 74 · **Pkg** D01 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** an existing `identity.platform_grants` row with `role='support_agent'` and `status='active'`, resolved through `resolveEffectivePermissions` · **Assert:** the returned set contains no `platform.impersonate` and the resolution does not throw on the historical row — the bundle map is keyed by role, not by stored verbs, so no data migration is required and this must be proven rather than assumed · **Failure means:** the removal is believed to need a backfill it does not need, or worse, stored verbs exist somewhere unexamined. The `scope` jsonb column on `platform_grants` (`packages/shared/src/db/identity.ts:398`) is read by nothing today; confirm it holds no verb list before closing D01.

---

## First ten offline tests for CI

These ten need no database, no cloud binding and no hardware. They run against
the root `vitest.config.ts` include globs, so each new file must sit under
`apps/api/src/**`, `src/**`, `packages/**` or `scripts/**` — a file under
`apps/api/test/` will not be collected.

1. **TS-25** — no per-tenant verb composes into a platform verb. Passes against today's code; land it first so the model has a floor before anything moves.
2. **TS-26** — role-bundle coverage derived from the map, not a hand-written list. Fails today (`host_admin` is missing from `permissions.test.ts:26-38`); it is a one-line fix and it proves the suite is actually running.
3. **TS-24** — pin the `sales_cs` expansion breadth. Passes today and turns an unimplemented comment into a visible fact before Group C touches the resolver.
4. **TS-06** — hash comparison method. Cheap, and it stops TS-01 being written wrongly.
5. **TS-05** — peek returns 400 for malformed metadata. Smallest real product change in the group; a good first commit against `invites.ts`.
6. **TS-01** — 409 `already_claimed` with the token unclaimed. The P0.
7. **TS-02** — `create`, not `upsert`.
8. **TS-03** — cleared-password users still redeem. Must land with TS-01, not after; a guard shipped without it locks out every admin-reset account.
9. **TS-04** — status-map totality across all six reasons.
10. **TS-11** — static guard that `upsert` cannot return to `invites.ts`.

Runners-up, in order, once the ten are green: TS-14 (ConsumeBody strictness),
TS-12 (rate limiter present), TS-27 (null-org gates), TS-37 (retired-verb scan),
TS-35 and TS-36 (impersonate removal), TS-19 (kennitala normaliser).

**None of these are enforced.** `.github/workflows/check.yml` has three steps —
`npm install`, `npm run db:generate`, `npm run check` — and `npm run check` is
`node scripts/check-all.mjs`, which runs nine offline checks: `typecheck`,
`check:schemas`, `check:api-schema`, `check:schema-consistency`, `check:deps`,
`check:deps-graph`, `check:api-endpoints`, `check:unused-exports`,
`check:work-view`. **Vitest is not among them.** `npm test` exists in
`package.json` and no workflow calls it. Until a `npm test` step is added to
`check.yml`, every specification above is a document, not a gate — the only
CI-enforced item in this whole appendix is TS-17, which rides on the already-wired
`check:api-endpoints`.
## Appendix 19C part 2 of 2 — test specifications: attribution, OCPP, sessions/dispute, onboarding, charger, access requests, codes, agreements, cost factors, audit, UI, CI, migration

Source of truth: `docs/domain/onboarding/19A-source-inventory.md` sections A02, A04–A10, plus the files cited in each spec (all read on branch `docs/singular-onboarding-domain-packet`, tip fc071b3). 38 specs, TS-31..TS-68. Part 1 holds TS-01..TS-30 (invite consume, support context, permission model, driver join, mobile contract); nothing here repeats those topics.

Vocabulary used below:
- **greenfield** — the spec describes code that does not exist. The test cannot be written until the source is. Marked in the "what it proves" line.
- Commands are run from the repo root unless prefixed. `npx vitest run <path>` resolves through the root `vitest.config.ts` (include globs at `vitest.config.ts:19-24`: `src/**`, `apps/api/src/**`, `packages/**`, `scripts/**/*.test.mjs`). Anything under `apps/api/test/parity/` runs only via `npm --prefix apps/api run test:parity` and needs a live Postgres, so it is never an unattended command here. `gateway/` has its own runner (`npm --prefix gateway test`) that no root script and no CI step invokes.
- No spec below assumes a test step exists in CI. `.github/workflows/check.yml:64-70` runs `npm install`, `npm run db:generate`, `npm run check`; `scripts/check-all.mjs:14-36` lists nine offline checks and none is vitest.

---

### OCPP authorization and attribution (TS-31..TS-37)

**TS-31** `unit` — the idTag classifier and the tap detector disagree on the same string, so every phone tap is displayed as a physical card.
`apps/api/src/lib/idtag-classifier.ts` `apps/api/src/lib/tap-intent/random-uid.ts` `apps/api/src/lib/idtag-classifier.test.ts` · **Scen** 79, 84 · **Pkg** E02, F09 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/idtag-classifier.test.ts`
- **Fixture:** the literal `"085ACDF6"` and three siblings matching `RANDOM_UID_PATTERN` (`random-uid.ts:38`, `/^08[0-9A-F]{6}$/`), passed to both `classifyIdTagFormat` and `isRandomEmulatedUid`. · **Assert:** for every input where `isRandomEmulatedUid` is true, `classifyIdTagFormat(...).detectedKind` is NOT `iso14443_4byte` with `confidence: "high"`. Today it is — the 8-hex branch at `idtag-classifier.ts:94-98` fires first and the classifier imports only `./oui/lookup`. · **Failure means:** the operator console and `session-full-detail.ts:548-568` confidently label an anonymous phone tap as a specific RFID card, which is the exact fabricated-subject failure O10 forbids.

**TS-32** `route` — `resolveAuthorize` returns no `attribution` field, so the E03 contract has nothing to assert against (greenfield field on an existing route).
`apps/api/src/routes/internal/ocpp-authorize.ts` `apps/api/src/routes/internal/ocpp-authorize.test.ts` · **Scen** 75-77, 79 · **Pkg** E03, E16 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/routes/internal/ocpp-authorize.test.ts`
- **Fixture:** the existing Prisma-fake harness in `ocpp-authorize.test.ts`, three cases — driver-bound `IdToken`, unbound card, absent idTag. · **Assert:** the returned object carries `attribution` with values `driver`, `installation`, `unknown` respectively, and that the field is additive — every existing key (`verdict`, `reason`, `idTokenId`, `enforceAuthorize`, and `userId` on the tap paths at `:183-199`) keeps its current type. · **Failure means:** the gateway and the session projection have no machine-readable statement of who a session belongs to, and every downstream consumer re-derives it from the idTag string. Codex must not build UI against this field until it exists.

**TS-33** `migration` — the installation-technical token class cannot be expressed: `IdToken.userId` is NOT NULL, so E04/E05 are a schema change first (greenfield).
`prisma/schema/identity.prisma` `packages/shared/src/db/identity.ts` `apps/api/test/parity/schema-columns.test.ts` · **Scen** 75, 83 · **Pkg** E01, E04, E05 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** a migration adding `id_tokens.token_class`, relaxing `user_id` to nullable, and a CHECK that rejects a row whose class is installation-or-unknown while `user_id` is non-null. · **Assert:** the CHECK rejects the violating insert with a constraint error, and `schema-columns.test.ts` still passes for both Prisma copies after `npm run check:api-schema` regenerates `apps/api/prisma/schema/`. · **Failure means:** E04's "technical token implies userId null" is unenforceable in the resolver alone; a technical token keeps carrying a person, and scenario 83 has no constraint to violate. Note `prisma/schema.prisma` is not a file — the schema is the folder `prisma/schema/` (8 files) plus the generated copy under `apps/api/prisma/schema/`.

**TS-34** `unit` — the four guards protecting the local auth list push are currently unverified by any test.
`apps/api/src/repositories/local-auth-list-push.ts` `apps/api/src/repositories/local-auth-list-push.test.ts` (new) · **Scen** 75, 78 · **Pkg** E15 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/repositories/local-auth-list-push.test.ts`
- **Fixture:** a Prisma fake returning an `IdToken` in each of the five refusal states — `status: "revoked"`, `"suspended"`, `"expired"`, `expiresAt` in the past, and `scopeInstallationId` pointing at a different installation — plus one with no matching `DriverGroupMembership` under an active installation-type `Agreement`. · **Assert:** `pushIdTokenToCharger` throws `PushIdTokenError` with codes `id_token_revoked`, `id_token_suspended`, `id_token_expired` (twice), `scope_mismatch`, `no_contract` (`local-auth-list-push.ts:118-188`), and never reaches the `idTagInfo` build. · **Failure means:** a revoked or contract-less token gets written into a charger's offline list, where `LocalAuthorizeOffline` authorizes it during a CSMS outage — bypassing every online gate. There is no removal counterpart to this function, so the mistake is not reversible from the API.

**TS-35** `offline-static` — revoking a token does not invalidate the gateway's verdict cache, and nothing in the API ever calls the endpoint that would.
`apps/api/src/domains/identity/repositories/id-tokens.ts` `gateway/src/index.ts` `gateway/src/identity-do.ts` `apps/api/src/lib/ocpp-invalidate.test.ts` (new) · **Scen** 82 · **Pkg** E13, E16 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/ocpp-invalidate.test.ts`
- **Fixture:** a static scan of `apps/api/src` for the identifiers `invalidateAuthorize` and `invalidate-authorize`, plus a check that `env.OCPP_GATEWAY` is referenced by something other than `lib/dispatch-targets.ts`. · **Assert:** at least one call site exists in the revoke path. Today the scan returns zero hits while `POST /invalidate-authorize/:id` is implemented in the gateway, so this test starts red and stays red until E13 wires it. · **Failure means:** `revokeIdToken` flips a status and returns; the charger keeps authorizing that token for up to the DO cache TTL, and indefinitely from its local list. Scenario 82 cannot be satisfied by a status flip alone.

**TS-36** `unit` — the contract gate is implemented three times and the third copy is missing a rule.
`apps/api/src/routes/internal/ocpp-authorize.ts` `apps/api/src/repositories/local-auth-list-push.ts` `apps/api/src/repositories/charger-technical-read.ts` `apps/api/src/repositories/charger-technical-read.test.ts` · **Scen** 75-77, 81 · **Pkg** E15, F01 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/repositories/charger-technical-read.test.ts`
- **Fixture:** a token whose agreement is active and whose membership is live but whose agreement has zero `AgreementClause` rows. · **Assert:** `decideVerdict` (`charger-technical-read.ts:255-266`) does not report `would_authorize` for that token, matching `resolveAuthorize`'s `no_billable_clauses` refusal (`ocpp-authorize.ts:320-330`). It does today — `decideVerdict` takes only `status`, `expiresAt` and `hasContract`, with no clause count. · **Failure means:** the operator's technical-read screen promises a token will authorize when the runtime will block it, so F01's shadow-mode evidence report is built on a verdict that disagrees with the resolver.

**TS-37** `future-hardware-beta` — two concurrent sessions on one technical token cannot be disambiguated, because the gateway invents transaction ids that are never ingested.
`gateway/src/identity-do.ts` `apps/api/src/lib/ocpp/projections.ts` `apps/api/src/lib/ocpp/projections.test.ts` · **Scen** 78, 88 · **Pkg** E17, F06 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs bench hardware plus an approved disposable DB branch
- **Fixture:** one idTag presented at two EVSEs of the same station within a minute; capture the gateway's `StartTransaction` responses and the resulting `charging.sessions` rows. · **Assert:** two distinct sessions exist and neither names a user. Today `stubResponseFor("StartTransaction")` returns `Math.floor(Math.random() * 2_000_000_000)` (`identity-do.ts:961`) and `onOcppRawStartTransaction` closes prior sessions by `(ocppIdentityId, status='in_progress')` (`projections.ts:828-833`), so the second start closes the first. · **Failure means:** a shared technical token silently collapses two drivers' energy into one session record — the worst possible input to a dispute. Record the observed behaviour under F06 before changing anything.

---

### Sessions, ledger and dispute correction (TS-38..TS-43)

**TS-38** `unit` — the OCPP writers never populate `charging.sessions.user_id`, so the two driver-facing surfaces disagree about what the driver owns.
`apps/api/src/lib/ocpp/projections.ts` `apps/api/src/repositories/driver-sessions.ts` `apps/api/src/lib/ocpp/projections.test.ts` · **Scen** 95, 96 · **Pkg** E06, M07 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/ocpp/projections.test.ts`
- **Fixture:** drive `onSessionStarted` and `onOcppRawStartTransaction` through the existing Prisma fake with an idTag that resolves to an active `IdToken`. · **Assert:** the `chargeSession.create` payload contains `userId`. It does not today (`projections.ts:185-199`, `:859-872`); the only driver resolution happens at stop time into `session_ledger.driver_user_id` (`:406-416`, `:971-978`). The only writers that set `sessions.user_id` are the Zaptec webhook (`routes/webhooks/zaptec.ts:211`, `:335`) and the CDR sync (`zaptec-session-sync.ts:329`, `:347`). · **Failure means:** `GET /api/driver/sessions/current` and `GET /api/driver/invoices` (which filter on `sessions.user_id`) show nothing for a purely OCPP-originated session while `/sessions/history` (ledger-scoped) shows it. That split-brain is the real state of attribution, not the "unrecorded attribution" the 18-series assumes.

**TS-39** `unit` — the driver app renders session cost 100x too high, and an existing assertion locks the bug in.
`apps/api/src/repositories/driver-sessions.ts` `apps/api/src/lib/tariff/compute-session-cost.ts` `apps/api/src/repositories/driver-sessions.test.ts` · **Scen** 95, 96 · **Pkg** E14, M07 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/repositories/driver-sessions.test.ts`
- **Fixture:** a ledger row with `costIskMinor = 64988n`. · **Assert:** `listDriverSessionHistory` returns `costIsk: 649.88`, not `64988`. `driver-sessions.test.ts:246` currently asserts `costIsk: 64988` because `minorToIsk` (`driver-sessions.ts:95-98`) returns `Number(minor)` undivided under the comment "ISK has no minor unit". The unit is aurar — stated at `compute-session-cost.ts:12-16` and divided by 100 in `formatIskMinor` (`:211-219`). Fixing the code requires editing that assertion in the same commit. · **Failure means:** every price a driver sees is a hundred times the real one. `driver-invoices.ts:21` documents the unit correctly and still returns raw aurar under the same `costIsk` key, so the invoice surface has the same defect.

**TS-40** `route` — `GET /api/admin/billing/sessions` takes tenant scope straight from query parameters with no ownership check.
`apps/api/src/routes/admin/billing.ts` `apps/api/src/repositories/session-ledger.ts` `apps/api/src/routes/admin/billing.test.ts` (new) · **Scen** 96 · **Pkg** M06, M07 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/admin/billing.test.ts`
- **Fixture:** a session holding `billing.read` scoped to org A, calling `/api/admin/billing/sessions?orgId=<org B>` and `?driverUserId=<a driver of org B>`. · **Assert:** 403. Today `scopeFromQuery` (`billing.ts:58-67`) converts the parameter verbatim into a `LedgerScope`; the only gates are `requireAdmin` and `requirePermission("billing.read")`, neither resource-scoped, and `session-ledger.ts:16-18` documents that it trusts the caller. Contrast `routes/admin/active-sessions.ts:23,:48`, which does call `resolveOrgScope`. · **Failure means:** any `billing.read` holder reads another tenant's ledger including `driverIdTag`, so scenario 96 ("no person named anywhere") cannot hold. Note for the fix: a guard added inside `requirePermission` sits after the bootstrap early return at `lib/auth/require-permission.ts:55-59` and is bypassed by a `sub === "admin"` session with no `userId`.

**TS-41** `unit` — a CDR that disagrees with OCPP updates the session row and freezes the ledger, leaving two costs for one session.
`apps/api/src/repositories/zaptec-session-sync.ts` `apps/api/src/repositories/session-detail.ts` `apps/api/src/repositories/zaptec-session-sync.test.ts` · **Scen** 91, 93 · **Pkg** M02, M03 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/repositories/zaptec-session-sync.test.ts`
- **Fixture:** an OCPP-written session plus ledger row, then `importOne` with a CDR whose energy and cost differ. · **Assert:** after import, `session.cost_inc_vat_minor` and `sessionLedger.costIskMinor` agree, or a correction record explains the difference. Today the upsert's `update` block sets only `verifiedSource` and `enrichmentStatus` (`zaptec-session-sync.ts:467-470`) while the session row is overwritten at `:306-332`, and both detail readers prefer the stale ledger value (`session-detail.ts:156-159`, `session-full-detail.ts:318-321`). Re-running cannot repair it — `importOne` short-circuits on `already_imported` (`:138-145`). · **Failure means:** the invoice and the session screen show different money for the same charge, with no record of which is right. This is the concrete case M02 exists for.

**TS-42** `offline-static` — the only correction path in the repo overwrites the ledger in place and corrupts attribution while doing it.
`apps/api/scripts/backfill-session-costs.ts` `apps/api/scripts/backfill-session-costs.test.ts` (new) · **Scen** 91, 92, 97 · **Pkg** M02, M08 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/scripts/backfill-session-costs.test.ts` — note this path is outside the root `vitest.config.ts` include globs (`apps/api/src/**`, not `apps/api/scripts/**`); either move the test under `apps/api/src/lib/` or widen the glob, and say which in the PR.
- **Fixture:** import the module's row-builder with a session whose `userId` is null (every OCPP-origin session, per TS-38) and whose `ocppIdentity.identityString` is set. · **Assert:** the object passed as `update` is not the same object passed as `create`, and it does not set `driverUserId` or `driverIdTag`. Today one `data` object serves both (`backfill-session-costs.ts:176-199`), `driverUserId: s.userId` nulls the driver, and `driverIdTag: s.ocppIdentity?.identityString` (`:185`) writes the charger's OCPP identity string into the driver column. · **Failure means:** a `--commit` run silently destroys attribution on already-attributed rows and rewrites `cost_isk_minor` with no correction record — the exact inverse of M02. Until M02 lands, treat this script as unrunnable and say so in R07.

**TS-43** `integration-db` — a dispute correction must preserve the original value and never rewrite a CDR (greenfield; no dispute state machine, `session_attribution` or `authorization_decision` exists).
`apps/api/src/lib/ocpp/projections.ts` `packages/shared/src/db/charging.ts` `apps/api/test/parity/session-attribution.test.ts` (new) · **Scen** 86, 91, 92, 94, 98 · **Pkg** M01, M02, E07, E09 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** an unknown-attribution session, then an operator correction to a named driver, then an attempted silent downgrade back to unknown. · **Assert:** three rows exist after the sequence (original, correction, refused downgrade), the CDR-derived columns on `charging.sessions` are byte-identical throughout, the correction's audit actor is the operator and not the driver, and the downgrade without a correction event is rejected (E08 upgrade-only rule). · **Failure means:** attribution history is a single mutable column and a dispute has no evidence trail. The word "dispute" currently appears in three files, all as prose comments (`projections.ts:320-323`, `repositories/tap-intents.ts`, `packages/contracts/src/vendor/adapter.ts`) — there is nothing to modify, so this spec is a design contract for new code.

---

### Agreements write surface (TS-44..TS-48)

**TS-44** `route` — agreement draft create must persist and be tenant-scoped (greenfield: no agreement write exists anywhere in `apps/api/src`).
`apps/api/src/repositories/agreements.ts` `apps/api/src/routes/admin/agreements.test.ts` (new) · **Scen** 137 · **Pkg** K01, K09 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** an org-admin session for org A posting a draft agreement for an installation of org A, and a second post naming an installation of org B. · **Assert:** the first persists with `status: "draft"`; the second is refused. `apps/api/src/repositories/agreements.ts:1-7` declares itself read-only for the operator list and detail pages and has no org scoping at all; the only agreement write in the whole repo is the one-off script `apps/api/scripts/supersede-orphan-b6771541.ts`. · **Failure means:** every commercial term in the system is created by hand in SQL. Copy the shape from `apps/api/src/routes/admin/billing-rate-references.ts` (`POST /` :97, `PATCH /:id` :152, `POST /:id/retire` :206) — it is the same staged-version write surface for a sibling table, already working.

**TS-45** `route` — an active agreement must refuse edits to price-resolution fields (greenfield).
`apps/api/src/routes/admin/billing-rate-references.ts` `apps/api/src/routes/admin/agreements.test.ts` (new) · **Scen** 138 · **Pkg** K02 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** an agreement in `status: "active"`, then a PATCH changing `effectiveFrom` and a clause's rate reference. · **Assert:** 409 with a stable error code, and no row mutated. The invariant and its wording already exist for rate references — `billing-rate-references.ts:6-12` rejects with `{ error: "active_row_immutable" }` and auto-closes the prior row's `effectiveUntil` in one transaction. Reuse that code, do not invent a second one. · **Failure means:** a live price changes under sessions that were already quoted against it, and scenario 147 ("a closed session is not rewritten") loses its precondition.

**TS-46** `migration` — overlapping active agreements on one installation must be rejected by the database, not by a log line.
`prisma/schema/commercial.prisma` `packages/shared/src/db/commercial.ts` `apps/api/src/lib/agreement/persist.ts` `apps/api/test/parity/agreement-overlap.test.ts` (new) · **Scen** 139 · **Pkg** K05, P07, L11 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** two active agreements for one `installationId` with overlapping `[effectiveFrom, effectiveUntil)` ranges, inserted in sequence. · **Assert:** the second insert raises an exclusion-constraint violation. Nothing of the kind exists today: `packages/shared/src/db/commercial.ts:293-316` declares four plain indexes on `agreements` and no unique or range constraint, and grepping all 47 directories under `prisma/migrations/` for `EXCLUDE`, `btree_gist` or `tstzrange` returns nothing. The overlap is currently handled at read time by a `console.warn` plus a deterministic `orderBy` (`persist.ts:143-165`). · **Failure means:** two contradictory prices are both valid and the resolver silently picks the newest. K05 must add the `btree_gist` extension and the constraint in one migration; the warn stays as a backstop.

**TS-47** `unit` — open-ended agreements must be refused at the input boundary.
`packages/commercial/src/agreement/types.ts` `packages/commercial/src/agreement/types.test.ts` · **Scen** 140 · **Pkg** K06 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run packages/commercial/src/agreement/types.test.ts`
- **Fixture:** a create-input object with `effectiveFrom` absent, and one with `effectiveFrom` present but `effectiveUntil` null. · **Assert:** the first is rejected; the second is accepted only if the ADR explicitly allows open-ended tails. There is no create-input schema in `types.ts` today — `RATE_BASES` (:39), `allocationSchema` (:91), `SessionContext` (:148) and `BillingLineDraft` (:192) are all resolver-side. K06 needs a new zod shape before this test has a subject. · **Failure means:** an agreement with no start date resolves unpredictably and K05's exclusion constraint has a null bound to reason about. Beware the duplicate: `apps/api/src/lib/agreement/types.ts:14-15` is a re-export shim, and `apps/api/src/lib/agreement/types.test.ts` is a forked copy that also runs.

**TS-48** `unit` — the pricing preview and the price of record come from different engines, and the acceptance criterion "no second pricing impl" is already false three times over.
`apps/api/src/repositories/driver-pricing.ts` `apps/api/src/lib/tariff/compute-session-cost.ts` `packages/commercial/src/agreement/resolve.ts` `apps/api/src/lib/billing-shadow/shadow-compare.ts` `apps/api/src/repositories/driver-pricing.test.ts` · **Scen** 144 · **Pkg** K08, L05 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/repositories/driver-pricing.test.ts packages/commercial/src/agreement/resolve.test.ts`
- **Fixture:** one session context priced through all three paths — `resolveTariffChainWithIdsForSession` plus `computeSessionCost`, `resolveBillingLines` plus `computeBillingLines`, and `summariseForCharger` (`driver-pricing.ts:208`). · **Assert:** the three totals agree to the aurar. They are not currently compared anywhere in an automated test; the only comparison infrastructure is operator-run (`shadowCompare` at `shadow-compare.ts:85`, driven by `apps/api/scripts/shadow-compare-resolvers.ts`). · **Failure means:** the driver is quoted one number and billed another. `driver-pricing.ts:25-34` says so in the source: canonical is "aspirational, not current", and `apps/api/src/lib/agreement/billing-tick.ts:62-87` records that the agreements resolver has priced zero sessions because the newest attributable session ended 2026-05-13, outside `RECENT_WINDOW_DAYS = 30`. Do not plan around ADR 0025's `useAgreementsResolver` flag — `billing-tick.ts:8-31` states it does not exist in code.

---

### Cost factors (TS-49..TS-51)

**TS-49** `unit` — the clause scope enum must have no per-driver tier.
`packages/commercial/src/agreement/types.ts` `packages/commercial/src/agreement/resolve.test.ts` · **Scen** 145, 146 · **Pkg** L01 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run packages/commercial/src/agreement/resolve.test.ts`
- **Fixture:** a clause scoped to a single charger and a clause naming a driver id. · **Assert:** the charger-scoped clause resolves for that charger only; the driver-scoped clause fails to parse. `RuleScope` in `types.ts` has no org or driver-group tier today (per SI-AGREEMENTS-02), so L01 is adding tiers, not filtering them — write the negative case first so "per-driver" never becomes reachable. · **Failure means:** pricing becomes personal, which is both the beta scope line and a data-protection exposure. Two forked copies of this test run under the root config (`packages/commercial/src/agreement/resolve.test.ts` at 574 lines carries a `describe("per_connector basis")` block that `apps/api/src/lib/agreement/resolve.test.ts` lacks) — add the case to the packages copy and note the fork.

**TS-50** `offline-static` — cost factors live in two unrelated tables and only one has a write surface.
`apps/api/src/repositories/billing-cost-factors.ts` `packages/shared/src/db/commercial.ts` `apps/api/src/lib/billing/cost-factor-scope.test.ts` (new) · **Scen** 145 · **Pkg** L02, L06 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/billing/cost-factor-scope.test.ts`
- **Fixture:** import both table declarations and both repository modules; assert on identifiers, not on data. · **Assert:** the module that the agreements resolver reads (`agreements.cost_factors`, declared as `agreementsCostFactors` in `packages/shared/src/db/commercial.ts:255`) is the same one the CRUD surface writes. It is not — `apps/api/src/repositories/billing-cost-factors.ts` CRUDs `billing.cost_factors` (`billingCostFactors` :89), whose only relation is to `TariffDefinition`. The read-only select-options endpoint at `billing-rate-references.ts:43` is the sole surface over the agreements-side table. · **Failure means:** an operator edits a catalogue that the pricing engine never reads, and L02 ships against the wrong table. Decide which table L02 targets before writing any endpoint.

**TS-51** `unit` — cost-factor mutations are gated on the wrong verb, and the two verbs the packet names guard nothing.
`apps/api/src/routes/admin/billing-cost-factors.ts` `apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/permissions.test.ts` · **Scen** 145, 146 · **Pkg** L07, K11 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/auth/permissions.test.ts`
- **Fixture:** a static list of every `requirePermission("...")` argument found under `apps/api/src/routes`. · **Assert:** `contract.write` and `tariff.write` each appear at least once. They do not — both are declared (`permissions.ts:69`, `:72`) and bundled into ADMIN (`:152-153`) and FINANCE (`:175`) while every billing mutation, including all five cost-factor routes (`billing-cost-factors.ts:50`, `:97`, `:163`, `:188`), is gated on `billing.write`. · **Failure means:** K11's "verbs live" acceptance is half-true: the catalogue grows, enforcement does not, and a bundle grant conveys authority nobody can trace to a route. Same test file should carry the `sales_cs` case — `platform.tenant.write` expands through `expandPlatformTenantVerbs` (`effective-permissions.ts:103-139`) into `billing.write` and `tariff.write` in every org, and the "column-restricted in repo layer" mitigation claimed at `permissions.ts:268` is not implemented anywhere.

---

### Organisation onboarding aggregate (TS-52..TS-54)

**TS-52** `migration` — one open onboarding workflow per org, enforced by a partial unique index (greenfield: `onboarding_workflow` does not exist in any `.ts`, `.prisma` or `.sql`).
`prisma/schema/` `packages/shared/src/db/` `apps/api/test/parity/onboarding-workflow.test.ts` (new) · **Scen** 99, 100 · **Pkg** G01, G02 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** start a workflow for an org, then start a second while the first is open. · **Assert:** the first row lands in `draft`; the second insert violates the partial unique index. Nothing exists to test — `apps/api/src/routes/admin/orgs.ts` (411 lines) registers no `/onboarding` sub-route, and the three endpoints 18D names are all absent. What exists instead is the one-shot `POST /api/admin/onboarding/chains` (`routes/admin/onboarding.ts:13`). · **Failure means:** onboarding progress is derived from whatever rows happen to exist, which is exactly what scenario 112 and O06 forbid the UI from doing. Two schemas must be edited for every column until the ~500 remaining Prisma calls are ported: the Drizzle declarations under `packages/shared/src/db/` (authoritative per ADR 0051) and `prisma/schema/`, with `apps/api/prisma/schema/` regenerated by `npm run sync:api-schema`.

**TS-53** `route` — a stale `If-Match` on a step patch must return 409 with the current aggregate (greenfield).
`apps/api/src/routes/admin/orgs.ts` `apps/api/src/routes/admin/onboarding-workflow.test.ts` (new) · **Scen** 101, 102, 103, 104 · **Pkg** G07, G08, G10 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** read a workflow, bump its version through a second request, then PATCH a step with the first `If-Match`; separately, replay a start with the same `Idempotency-Key`; separately, skip a required step and skip an optional step with no reason. · **Assert:** 409 `version_conflict` carrying the current aggregate, the replay returns the existing workflow unchanged, 422 `step_not_skippable`, 400. · **Failure means:** two operators overwrite each other's onboarding state with no signal. Note there is no HTTP `Idempotency-Key` infrastructure anywhere in the API — the only idempotency-key code is `batchInsertIdempotencyKeys` and `findExistingIdempotencyKeys` in `apps/api/src/lib/db/raw.ts` for OCPP ingest, a different key space. G07 starts from nothing.

**TS-54** `integration-db` — provisioning does not clear the pending-discovery row, because two paths disagree about case.
`apps/api/src/repositories/pending-discoveries.ts` `apps/api/src/repositories/onboarding-chains.ts` `apps/api/src/repositories/chargers.ts` `apps/api/test/parity/pending-discovery-clear.test.ts` (new) · **Scen** 113 · **Pkg** G07, H05 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** `upsertPendingDiscovery` with `"ZPR074002"`, then provision the same identity through `createOnboardingChain` and, in a second case, through `createCharger`. · **Assert:** no pending row survives. Today one does: `upsertPendingDiscovery` lowercases the key before write (`pending-discoveries.ts:98`) while both provisioning paths delete on the raw operator-supplied string (`onboarding-chains.ts:166-168`, `chargers.ts:579-581`), and `IDENTITY_RE` at `packages/contracts/src/inputs/onboarding-chains.ts:5` permits `A-Z`. · **Failure means:** a successfully onboarded charger stays in the pending pool forever, and the operator's "unclaimed chargers" list never empties. One-line fix on each delete, but it needs a DB test to prove it.

---

### Charger onboarding (TS-55..TS-57)

**TS-55** `route` — H04 ("OCPP password never in a response body") contradicts three implemented, deliberately-commented designs.
`apps/api/src/repositories/onboarding-chains.ts` `apps/api/src/repositories/chargers.ts` `apps/api/src/repositories/installation-ocpp.ts` `apps/api/src/routes/admin/ocpp-password-redaction.test.ts` (new) · **Scen** 116 · **Pkg** H04 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/routes/admin/ocpp-password-redaction.test.ts`
- **Fixture:** the three JSON responses, built from repository fakes, for `POST /api/admin/onboarding/chains`, `POST /api/admin/chargers` and `POST /api/admin/installations/:id/ocpp-password/rotate`. · **Assert:** no plaintext credential appears in any body. All three return one today by design — `ocppPassword` at `onboarding-chains.ts:198` surfaced through `routes/admin/onboarding.ts:21-28`, `ocppPassword` from `chargers.ts:605-646` through the route at `:69-76`, and `plaintext` from `installation-ocpp.ts:135` through `routes/admin/installations.ts:129-142`, each with an explicit comment saying the one-shot return is intentional. · **Failure means:** nothing, until someone decides. This spec is a decision forcing function, not a bug report: write the test red, attach the three source comments, and get H04 ruled on before implementing either side. If the one-shot return stays, the assertion inverts to "appears exactly once, in the create response, and never in any read".

**TS-56** `integration-db` — deleting a charger must preserve history and must be audited.
`apps/api/src/repositories/chargers.ts` `apps/api/src/repositories/installations.ts` `apps/api/src/repositories/sites.ts` `apps/api/test/parity/charger-soft-delete.test.ts` (new) · **Scen** 117 · **Pkg** H07 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** a charger with completed sessions and ledger rows, then a delete. · **Assert:** the sessions and ledger rows survive, the charger is marked rather than removed, and one `audit.actions` row names the actor. Today `deleteCharger` (`chargers.ts:752-754`) is a single `db.delete(siteAssets)` relying on FK cascade with no `recordAuditAction` — unlike `createCharger` (:591-603) and `updateCharger` (:694-702), which do audit. `deleteInstallation` (`installations.ts:154-170`) and `deleteSite` (`sites.ts:146-157`) are the same unaudited hard cascades. · **Failure means:** a mis-click erases billing history with no trace of who did it. H07 needs a soft-delete column and the audit call together; either alone is worse than neither.

**TS-57** `unit` — the actor is dropped on the charger and chain write paths, so H03's "audited with the actor" is only true for installations.
`apps/api/src/routes/admin/chargers.ts` `apps/api/src/routes/admin/onboarding.ts` `apps/api/src/routes/admin/installations.ts` `apps/api/src/routes/admin/charging-stations.test.ts` · **Scen** 113, 115 · **Pkg** H03, N01 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/routes/admin/charging-stations.test.ts`
- **Fixture:** a live session in `c.get("session")` with a real `userId`, driving `POST /api/admin/chargers` and `POST /api/admin/onboarding/chains`. · **Assert:** the `actorUserId` reaching the repository equals the session's `userId`. It is hardcoded null in three places: `routes/admin/chargers.ts:68` calls `createCharger(db, parsed.data, null)`, `:272` calls `updateCharger(..., null)`, and `routes/admin/onboarding.ts:20` calls `createOnboardingChain(db, parsed.data, null)`. The installation routes do it correctly (`routes/admin/installations.ts:137`, `:163`, `:191` pass `c.var.session.userId ?? null`), so the fix is mechanical. · **Failure means:** the audit row for a charger creation names nobody, and N01's "actor never from request input" is satisfied only by having no actor at all.

---

### Access requests (TS-58..TS-59)

**TS-58** `integration-db` — two concurrent approvals of one access request must yield one grant and one 409, not a raw Postgres error.
`apps/api/src/repositories/driver-group-memberships.ts` `apps/api/src/repositories/driver-access-requests.ts` `apps/api/test/parity/driver-group-memberships-route.test.ts` · **Scen** 129, 130 · **Pkg** B07, J-adjacent · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** one pending request, two `PATCH /api/admin/access-requests/:id` with `action: "approve"` fired concurrently. · **Assert:** exactly one `DriverGroupMembership` exists and the loser receives a 409 with a stable error code. It will not hold as written: `createMembership` (`driver-group-memberships.ts:53-79`) does an explicit SELECT-then-INSERT with a comment rejecting upsert semantics, and `approveRequest` (`driver-access-requests.ts:576-599`) repeats the read-then-create inside its transaction. Confirm first whether `(driver_group_id, user_id)` is unique at all — if it is not, the failure is two grants, not an error. · **Failure means:** a double-approved driver holds two memberships, and revoking one leaves the other authorizing at the charger.

**TS-59** `route` — a repeat access request must return the first request with 200, and the `withdrawn` status must be reachable.
`apps/api/src/routes/public/driver.ts` `apps/api/src/repositories/driver-access-requests.ts` `packages/shared/src/db/commercial.ts` `apps/api/test/parity/driver-access-request-flow.test.ts` · **Scen** 45, 134, 136 · **Pkg** B04, J01 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** a driver with a pending request re-submitting; then the same driver withdrawing; then the org closing while a request is pending. · **Assert:** the re-submit returns 200 with the existing request id, the withdraw sets `status: "withdrawn"`, and the org closing leaves pending requests untouched. Today the re-submit returns `{ error: "already_requested", existingRequestId }` with 409 (`routes/public/driver.ts:911-919`) — precisely the 409 scenario 45 says must become a 200 — and `withdrawn` is a write-dead enum value: declared at `packages/shared/src/db/commercial.ts:52`, accepted as a filter at `routes/admin/access-requests.ts:71`, set by no code path, with no driver-side withdraw endpoint. · **Failure means:** a driver who changes their mind cannot close their own request, and the retry path looks like an error. Decide whether to build the withdraw endpoint or drop the enum value; do not ship both states.

---

### Installation access codes (TS-60..TS-61)

**TS-60** `unit` — the rate limiter fails OPEN, so the fail-closed acceptance criterion is currently inverted, and the join-adjacent routes have no limiter at all.
`apps/api/src/lib/rate-limit.ts` `apps/api/src/routes/public/driver.ts` `apps/api/src/lib/rate-limit.test.ts` (new) · **Scen** 127, 128 · **Pkg** J06, P09 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/rate-limit.test.ts`
- **Fixture:** a Hono context whose `env` lacks the named binding, and a second whose binding has no `limit` function. · **Assert:** the middleware refuses the request. It calls `next()` today after a `console.warn`, at `rate-limit.ts:121-129`, and the docstring at `:113-115` states failing open is deliberate ("exactly what dev environments need"). A second assertion should record that `POST /api/driver/access-requests` (`driver.ts:867`) and `POST /api/driver/redeem-invite` (`:1158`) take no `rateLimit` middleware — only `/login` and `/claim-invite` (`driver.ts:1030-1035`) do. · **Failure means:** a missing binding in a misconfigured environment removes the brute-force ceiling silently. Scenario 128 additionally has no binding to key on: the declared buckets are `ADMIN_LOGIN_RATE_LIMITER` and `DRIVER_LOGIN_RATE_LIMITER` (`apps/api/src/bindings.ts:95`, `apps/api/wrangler.jsonc:144` and `:150` — note the inventory's "bindings.ts" is `apps/api/src/bindings.ts`, not `apps/api/src/lib/bindings.ts`, which does not exist), neither per-code. Flipping to fail-closed globally will break local dev — scope the flip to the join surface or gate it on an env flag, and say which.

**TS-61** `unit` — the join passphrase needs a one-way primitive; the nearest existing helper is deliberately reversible and belongs to a different concern (greenfield).
`apps/api/src/lib/credential-crypto.ts` `apps/api/src/lib/join-passphrase.test.ts` (new) · **Scen** 121, 122 · **Pkg** J02, J03 · **Unattended-safe** yes · **Codex may rely** no
- **Command:** `npx vitest run apps/api/src/lib/join-passphrase.test.ts`
- **Fixture:** a new PBKDF2 helper with a per-credential salt, exercised with the right and wrong passphrase. · **Assert:** verification succeeds for the right passphrase, fails for the wrong one, and no function in the module can return the passphrase. Do not extend `credential-crypto.ts`: `sealPassword` and `openPassword` (`:40-61`) are AES-GCM under a single worker-secret KEK (`deriveAesKey` :19-31, `OCPP_CRED_KEK`) and are reversible on purpose, because Zaptec portal passwords must be replayed to a third party. `apps/api/src/repositories/credential-management.ts` is the same vendor concern despite the name collision that the seed docs create. · **Failure means:** a database read yields every installation's join passphrase in plaintext-equivalent form. Note `installation_access_credential` does not exist in any Drizzle table, Prisma model, migration or route — all of Group J is unbuilt from zero.

---

### Audit (TS-62..TS-64)

**TS-62** `unit` — `recordAuditAction` has no test at all, and it is the single writer for every audit row in the product.
`apps/api/src/lib/audit.ts` `apps/api/src/lib/audit.test.ts` (new) · **Scen** 155 · **Pkg** N01, N05, N06 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/audit.test.ts`
- **Fixture:** a Drizzle fake exposing `.insert()` and a Prisma fake exposing `.auditAction`, each passed the same `AuditActionInput`. · **Assert:** both branches write identical field sets, `metadata` defaults to `{}` rather than null on both, and `isDrizzle` (`audit.ts:54`) routes a Prisma *transaction* handle to the Prisma branch. · **Failure means:** the dual-client shim silently drops a field on one branch and half the audit log is shaped differently from the other half. There is no `audit.test.ts` today; the only coverage is incidental row-count assertions through a Prisma fake in `apps/api/src/repositories/driver-access-requests.test.ts:487-488` and `:621`.

**TS-63** `migration` — `actorKind` has no `bearer` value and only `user` is ever written, so scenario 6 cannot pass and a malformed-token rejection is not logged at all.
`prisma/schema/platform.prisma` `packages/shared/src/db/platform.ts` `apps/api/src/routes/public/driver.ts` `apps/api/test/parity/audit-actor-kind.test.ts` (new) · **Scen** 6, 155 · **Pkg** N02 · **Unattended-safe** no · **Codex may rely** no
- **Command:** none — needs approved disposable DB branch
- **Fixture:** insert an audit row with `actorKind: "bearer"`. · **Assert:** the insert succeeds after a Postgres `ALTER TYPE` plus matching Prisma and Drizzle enum edits. The enum is `user | system | vendor_webhook | ocpp_worker` in both declarations, and a scan of `actorKind: "…"` literals across the repo returns 24 hits, all `"user"`. · **Failure means:** a bearer's refused action is indistinguishable from the invited user's own action in the log. Second assertion for the same package: `driver.ts:1214` writes `driver_invite.redemption_rejected` with a hardcoded `actorKind: "user"` and is wrapped in `if (row.driverGroup)` at `:1206` because `audit.actions.org_id` is NOT NULL with an FK — so a malformed token's rejection produces no row whatsoever. That is a schema problem (nullable org, or a platform-scoped sentinel), not a call-site fix.

**TS-64** `unit` — the outbound-command dispatcher has no terminal failure state and no attempt ceiling, so an unreachable charger produces an eternal retry loop.
`apps/api/src/lib/dispatcher.ts` `apps/api/src/index.ts` `apps/api/src/lib/dispatcher.test.ts` (new) · **Scen** 118 · **Pkg** R04, N05 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run apps/api/src/lib/dispatcher.test.ts`
- **Fixture:** a Prisma fake and a `TargetRegistry` whose only target always returns `{ kind: "retriable" }`; run `processCommand` repeatedly against one command id. · **Assert:** after N attempts the row reaches a terminal `failed` state. It never does: `processCommand` (`dispatcher.ts:128-165`) marks `failed` only for "no target" or a `permanent` result, and the `retriable` branch (`:161-164`) leaves the row pending with a comment admitting a DLQ consumer would be needed. No DLQ consumer exists — `apps/api/wrangler.jsonc:87,109,116` declare three dead-letter queues and `apps/api/src/index.ts:324-352` has no branch for any of them. Meanwhile `claimById` pushes `not_before` 30s forward while `sweepStuckPending` re-publishes anything older than 60s on a per-minute cron. A grep for `maxAttempts`, `max_attempts` or `attempts >` across `apps/api/src` returns nothing. · **Failure means:** a decommissioned charger generates command traffic and log noise forever, and scenario 118's "recorded and correlated" is true only for the happy path.

---

### Web UI (TS-65..TS-66)

**TS-65** `web-contract` — there is not a single test file under `src/`, so O04's "assert the disabled state" has no harness; and the middleware doc that implementers will read is stale.
`src/middleware.ts` `src/app/org/[slug]/page.tsx` `src/components/language-provider.tsx` `src/app/org/disabled-states.test.ts` (new) · **Scen** 149, 150, 151, 154 · **Pkg** O01, O04, O06, O07 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run src/app/org/disabled-states.test.ts`
- **Fixture:** render the section-card list from `src/app/org/[slug]/page.tsx:289-320` with the onboarding and cost-factor endpoints absent. · **Assert:** the copy is the doc-17 disabled-state wording, not the literal "soon". Today the only disabled affordance is `"soon"`/`"væntanlegt"` at `page.tsx:296-299` plus the `.soon` classes in `src/app/org/org-landing.css:182,470,474`; the strings "not tracked yet" and "Managed through driver groups" appear nowhere in `src/`. `vitest.config.ts:19-24` already includes `src/**/*.test.ts`, so the directory is the only thing missing. · **Failure means:** the UI invents progress from whatever rows exist, which scenario 112 forbids. Two things an implementer must know before touching this area: `src/middleware.ts` is live (the relocation the reconciliation doc says to do last already happened) while `docs/relaunch-middleware-reconciliation.md:3` and three source comments (`src/middleware.ts:45-54`, `src/app/staff/page.tsx:27-34`, `src/app/staff/overview/page.tsx:221-231`) still claim it never executes; and `LanguageProvider` hard-forces English (`FORCED_LANGUAGE = "en"` at `language-provider.tsx:20`, `initialLanguage` accepted and ignored at `:26`), so only the English branch of any copy work is reachable.

**TS-66** `web-contract` — `apiFetchJson` flattens every error to a string, so no error *code* can reach the UI, and the `/org/[slug]` slug fallback shows the wrong tenant before redirecting.
`src/lib/api-client.ts` `src/lib/org-context.ts` `src/lib/api-client.test.ts` (new) · **Scen** 150, 152 · **Pkg** O04, O05 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run src/lib/api-client.test.ts`
- **Fixture:** a stubbed `fetch` returning `403 { error: "support_context_required" }`, and a `pickMembership` call with a slug matching no org for a caller holding two host_admin memberships. · **Assert:** the thrown value carries the machine-readable `error` code, not only a message; and `pickMembership` returns null for an unknown slug rather than `hostAdminOrgs[0]`. Today `apiFetchJson` (`api-client.ts:72-84`) builds `msg` from issues, then `e?.error`, then `HTTP ${status}` and throws a bare `Error`, discarding the code; `pickMembership` (`org-context.ts:104-117`) falls back to the first host_admin org, so a wrong slug renders another tenant and then rewrites the address bar to that tenant's canonical URL. · **Failure means:** the support-mode banner (O05) cannot distinguish "context required" from any other 403, and a multi-org operator can be shown a tenant they did not ask for. Related, unverified by any test: `apiFetchServer` (`src/lib/api-client-server.ts:49-54`) forwards the whole cookie jar to a cross-origin API host.

---

### CI and migration (TS-67..TS-68)

**TS-67** `offline-static` — no test suite runs in CI on any branch, so every "in CI" acceptance criterion in Group P is unmet by construction.
`.github/workflows/check.yml` `scripts/check-all.mjs` `scripts/check-all.test.mjs` (new) · **Scen** 153, 65, 66 · **Pkg** P01, P04, P05, P11 · **Unattended-safe** yes · **Codex may rely** yes
- **Command:** `npx vitest run scripts/check-all.test.mjs` — `scripts/**/*.test.mjs` is already in the root include list (`vitest.config.ts:22`) and `scripts/check-schema-consistency.test.mjs` is the existing precedent.
- **Fixture:** parse the `CHECKS` array in `scripts/check-all.mjs:14-36` and the steps in `.github/workflows/check.yml:64-70`. · **Assert:** a vitest step exists in one of them. Neither has one: the workflow runs `npm install`, `npm run db:generate`, `npm run check`, and `check-all.mjs` lists nine offline checks (typecheck, schemas, api-schema, schema-consistency, deps, deps-graph, api-endpoints, unused-exports, work-view). Note also that `npm test` at the root does not cover everything a reader assumes — `gateway/` has its own runner (`npm --prefix gateway test`, five test files including `identity-do.test.ts`) that no root script invokes, and `apps/api/test/parity/**` runs only under `apps/api/vitest.parity.config.ts` with a live `PARITY_DATABASE_URL`. · **Failure means:** P01, P02, P03, P04, P05, P07, P08 and P09 all claim "in CI" and none of them can be. Adding the step is one line; the reason it is absent should be written down before it is added, because the parity suites will not run there without a database secret and the workflow triggers on `push: branches ["**"]`.

**TS-68** `migration` — the two schema descriptions are compared by name only, one migration set is unchecked, and two migrations are on disk but unrecorded against staging.
`scripts/check-schema-consistency.mjs` `scripts/check-schema-consistency.test.mjs` `prisma.config.ts` `.github/workflows/check.yml` · **Scen** — · **Pkg** Q01, Q04, Q09, Q10, P10 · **Unattended-safe** partly — the static half yes, the `migrate status` half no · **Codex may rely** yes for the static half
- **Command:** `npx vitest run scripts/check-schema-consistency.test.mjs` for the static half; `npm run check:migrations` needs a live `DATABASE_URL` and is out of scope here.
- **Fixture:** feed the consistency checker a Prisma model and a Drizzle table that agree on every column *name* but disagree on nullability and on type. · **Assert:** the checker fails. It passes today — `check-schema-consistency.mjs:120-132` compares table and column names only, with a vacuous-pass guard at `:108-118` but no type, nullability or default comparison. Extend the existing test file rather than adding a new one. · **Failure means:** the two descriptions of the database drift in exactly the dimension that breaks at runtime while `npm run check` stays green. Two facts any Q-group work must carry: `prisma/migrations/` holds 47 migration directories plus `migration_lock.toml` while `apps/api/drizzle/meta/_journal.json` holds two entries (`0000_baseline`, `0001_regular_talos`), and only the Prisma set has a status check at all; and `check:migrations` is deliberately excluded from CI (`.github/workflows/check.yml:10-44`) and exits non-zero today because `20260807003000_drop_issues_scaffold` and `20260807120000_drop_never_used_tables` are applied by hand and unrecorded — that is Q10, and wiring the check in before reconciling them turns CI red on every branch.

---

### Specs that cannot exist yet

Eleven of the 38 above describe code that is not in the repo. Grouped so a reviewer can see the shape of the gap at a glance:

- **Agreement writes (K)** — TS-44, TS-45, TS-46, TS-47. `apps/api/src/repositories/agreements.ts:1-7` declares itself read-only; the only agreement write in the repo is the one-off script `apps/api/scripts/supersede-orphan-b6771541.ts`. Group K is greenfield, and `billing-rate-references.ts` is the working template to copy.
- **Onboarding aggregate (G)** — TS-52, TS-53. Zero hits for `onboarding_workflow` / `onboarding_step` outside `docs/`.
- **Attribution tables and token class (E)** — TS-32, TS-33, TS-43. No `tokenClass`, no `session_attribution`, no `authorization_decision` anywhere in `.ts`, `.prisma` or `.sql`.
- **Installation access credentials (J)** — TS-61. No table, no route, no code-plus-passphrase concept anywhere.

Each is still written as a spec because the assertion is the contract the new code must satisfy, and because writing it now prevents the second implementation of something that already exists elsewhere (K against rate references, J against the wrong crypto primitive, E against `session_ledger.driver_user_id`).
