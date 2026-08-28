# Appendix 19G — review checklists

**15 checklists**, `RC-01`–`RC-15`, 10 pass/fail questions each — 150 questions.

Every question is answerable **yes or no** from named evidence. "Is this
secure?" is not a question here; "does `T-S2-1` fail when the guard is
reverted?" is.

Every checklist contains at least one **fool-test**: the thing you deliberately
break to prove the guard catches it. This is the rule the parity suite was
fixed by, and it is the reason those tests are trustworthy — *a guard that
cannot be made to fail is not evidence*. A reviewer who ticks a fool-test row
without having seen the test go red has not done the review.

| ID | Review | Blocking |
|---|---|---|
| `RC-01` | S2 security | yes |
| `RC-02` | invite compatibility | yes |
| `RC-03` | permission provenance | yes |
| `RC-04` | support context | yes |
| `RC-05` | `platform.impersonate` deletion | no |
| `RC-06` | attribution | yes |
| `RC-07` | OCPP authorization | yes |
| `RC-08` | privacy / legal | yes |
| `RC-09` | agreement writes | yes |
| `RC-10` | cost assignment | yes |
| `RC-11` | onboarding aggregate | no |
| `RC-12` | audit taxonomy | yes |
| `RC-13` | migration | yes |
| `RC-14` | Codex frontend wiring | no |
| `RC-15` | release readiness | yes |

**`RC-14` carries an explicit out-of-scope clause.** Straumvakt.org visual and
brand work is a separate lane; this checklist must not be applied to it and must
not block it. A mixed PR should be split, not rejected.

---

## Appendix 19G part 1 of 2 — review checklists RC-01..RC-08

Eight gates, one per review topic. Every question is yes/no answerable from the
named artefact; a "fails if" row is what a reviewer rejects on. Each checklist
carries at least one **fool-test**: a deliberate break that must turn the guard
red. A guard nobody could make fail is not evidence that it works.

Line anchors were read on `docs/singular-onboarding-domain-packet` at `fc071b3`.
They drift; the symbol name is the durable reference.

Fixture identities throughout: `driver-anna@example.test`,
`driver-bjorn@example.test`, `staff-carol@example.test`,
`admin-dagur@example.test`, orgs `org_alpha` / `org_beta` / `org_gamma`, codes
`ALFA-1111` / `BETA-2222`, passwords always `<redacted>`.

**Standing caveat for every "in CI" claim below.** `.github/workflows/check.yml`
runs three steps (`npm install`, `npm run db:generate`, `npm run check`) and
`scripts/check-all.mjs` lists nine offline checks — typecheck, schemas,
api-schema, schema-consistency, deps, deps-graph, api-endpoints, unused-exports,
work-view. None of them is vitest. `npm test` (`vitest run`) executes on no
branch. Any acceptance criterion reading "in CI, offline" needs a CI step
authored first, not just a test file.

---

### RC-01 — S2 security review
**Applies to** A01–A05, A08, A09, A13 (`apps/api/src/routes/public/invites.ts`) · **Reviewer** security · **Blocking** yes

| # | Pass/fail question | Evidence required | Fails if |
|---|---|---|---|
| 1 | Is the credential guard strictly above the token claim? | the diff hunk of `invites.ts`, showing the guard between the metadata parse (`:121-126`) and `tx.userToken.updateMany` (`:130-133`) | the guard sits below line 133, or in a second transaction |
| 2 | Does the guard test `passwordHash IS NOT NULL` rather than row existence? | the select clause in the same hunk | it selects only `userId` from `userCredential`. `clearUserPasswordHash` (`domains/identity/repositories/users.ts:381-386`) nulls the column and keeps the row, so a row-existence guard permanently locks out any account an admin deliberately cleared |
| 3 | Is `upsert` gone from the file? | `grep -n upsert apps/api/src/routes/public/invites.ts` returning zero hits | any `upsert` survives at `:142-146` or elsewhere |
| 4 | **Fool-test.** With the guard line deleted and `create` retained, does the suite go red on a unique-constraint violation? | T-S2-2 output from a branch with the guard deliberately removed | the run is green — then nothing exercises the second-credential path and A02 is untested |
| 5 | **Fool-test.** With the guard moved below the claim, does T-S2-5 fail? | T-S2-5 output from that branch plus a `SELECT used_at` on the invite row after the refused call | green — the anti-deadlock property (ADR 0053's repeat risk) is unasserted |
| 6 | Is `already_claimed` returned as 409 and not folded into 410? | the diff of the status map at `:179-182` | the map still reads `reason === "not_found" ? 404 : 410`, which is what ships today |
| 7 | Does the refusal audit row name an actor other than the invitee? | T-S2-3 output showing `actor_user_id` is not `driver-anna@example.test`'s id | the row reuses `row.userId`, which is actor laundering — the same shape as `:161-169` today |
| 8 | Does the chosen `actorKind` value exist in the database enum before the code ships? | `packages/shared/src/db/platform.ts:29` and `prisma/schema/platform.prisma:119-126` in the same commit as the writer | the diff passes `actorKind:"bearer"` with no Postgres `ALTER TYPE` and no Prisma enum edit. Today the enum is `user`, `system`, `vendor_webhook`, `ocpp_worker`, and all 24 literal call sites write `"user"` |
| 9 | Is the refusal auditable at all in the path where it fires? | the diff ordering: guard after the `orgId`/`email` parse | the guard runs before the metadata parse. `audit.actions.org_id` is `NOT NULL` (`packages/shared/src/db/platform.ts:95`), so a refusal with no resolved org cannot be logged — exactly the hole at `driver.ts:1206` where a malformed token's rejection goes unrecorded |
| 10 | Does `malformed_metadata` reach the client as 400 on **consume**, not only on peek? | the diff plus T-S2-6 output | only `:69` (the peek route's 500) changed. Consume currently returns 410 for that reason via the same collapse at `:180`; A13 as written cites the peek line only |

---

### RC-02 — invite compatibility review
**Applies to** A06, A07, A10, A11, A12, B08, B09, B10; scenarios 19–30 · **Reviewer** Andri (D-02 is a product decision) · **Blocking** yes

| # | Pass/fail question | Evidence required | Fails if |
|---|---|---|---|
| 1 | Does `ConsumeBody` stay non-strict until a mobile build that omits `kennitala` is live? | the diff of `invites.ts:36-39` plus the shipped app version that no longer sends the field | `.strict()` lands while `apps/mobile/lib/api/client.dart:101-105` still posts `{token, kennitala, password}`. Strictness turns every current mobile redemption into a 400 — that is scenario 20 failing, not passing |
| 2 | Is the kennitala question resolved as one documented behaviour? | an ADR or decision line naming exactly one of verify / drop / stop collecting | the server keeps silently stripping it while `consumeInvite` (`client.dart:93-97`) still declares `required String kennitala` |
| 3 | If verify is chosen, is a mismatch byte-identical to an unknown token? | T-SEC-3a and T-ABUSE-6b output comparing status and body bytes | a distinct `kennitala_mismatch` code exists — that is a national-ID oracle on an unauthenticated route |
| 4 | **Fool-test.** Force `.strict()` on and re-run the compatibility test: does it go red with a 400? | the run output from that branch | green — no test posts a third field, so scenario 13 and scenario 20 are both unprotected |
| 5 | Does the mobile client have an `already_claimed` branch? | the diff of `_inviteErrorMessage` (`client.dart:122-137`) | the switch still falls through to `Could not redeem invite (already_claimed)` |
| 6 | Is the archived web form named as out of scope rather than counted as coverage? | a line in the PR body citing `archive/straumvakt-org-console-2026-08-08/app/invite/[token]/accept-form.tsx` | scenario 19 is claimed as covered by a live route. `src/app` has `home`, `org/[slug]` and `staff/overview` only — there is no `/invite` page and no `src/app/api` at all |
| 7 | Does the capability-advertisement endpoint exist in the generated surface? | the diff of `docs/reference/api-endpoints.md` produced by `scripts/gen-api-endpoints.mjs --check` | the endpoint appears only in prose; `npm run check` would not have regenerated |
| 8 | Does the deprecation counter have a named reader? | the sink the counter writes to | "counted" means a `console.log` line. There is no metrics store and no alert sink anywhere — every current signal is a console line inside `ctx.waitUntil` (`apps/api/src/index.ts:354-473`) |
| 9 | Does the mobile contract test exist before A12 renames it? | `git ls-tree -r HEAD -- apps/mobile/test` | A12 is marked done. That path lists only `widget_test.dart`; `apps/mobile/test/api/client_contract_test.dart` is not on this branch |

---

### RC-03 — permission provenance review
**Applies to** C02, C03, D10, P04, P05 (`lib/auth/require-permission.ts`, `lib/auth/effective-permissions.ts`) · **Reviewer** security · **Blocking** yes

| # | Pass/fail question | Evidence required | Fails if |
|---|---|---|---|
| 1 | Does the resolver carry provenance out, rather than the guard re-deriving it? | the diff of `resolveEffectivePermissions` (`effective-permissions.ts:154-170`) returning membership-derived and platform-derived sets separately | the guard calls `expandPermissionsSync` a second time with a fabricated membership row to infer provenance. Today the function returns a flat `Permission[]` and the distinction is discarded at `:164-169` |
| 2 | **Discriminating fixture.** Does T-SC-5's fixture hold BOTH an active membership on `org_alpha` granting the verb AND an active platform grant? | the fixture rows in the test file, showing `staff-carol@example.test` with a `memberships` row and a `platform_grants` row | carol holds only one of the two. T-SC-5 is then vacuous: a membership-only fixture passes under the correct implementation **and** under the union bug, and a platform-only fixture fails under both. Only the dual-role row separates them |
| 3 | Does T-SC-5 assert both the 200 and the absence of a context row? | the T-SC-5 output plus a count query on the C01 table after the request, expecting 0 | only the status code is asserted — a guard that opens a context implicitly would still pass |
| 4 | **Fool-test.** Force `satisfiedOnlyByPlatformGrant` to return `true` unconditionally: does T-SC-5 go red while T-SC-1 stays green? | both runs on the sabotaged branch | T-SC-5 stays green. That proves the fixture is not discriminating, whatever question 2 answered on paper |
| 5 | Is the second enforcement seam covered? | the diff touching `assertPermission` (`require-permission.ts:106-134`) and its two live call sites `routes/admin/access-requests.ts:90` and `:178` | only the `requirePermission` factory changed. `assertPermission` duplicates the whole resolve-and-deny path and would bypass the guard |
| 6 | Is the god-mode early return removed, or retained with a written reason? | the diff at `require-permission.ts:55-59` and `:115-117` | the new guard is added *below* the early return. A session with `sub === "admin"` and no `userId` (`isBootstrapSession`, `:147-151`) then skips it entirely |
| 7 | Does the PR state what happens to the call sites that pass no `orgIdParam`? | a count of `requirePermission` sites naming a per-tenant verb with no `orgIdParam` (inventory: 85 of 117) | the PR claims "membership path unaffected" while on those routes `orgId` is `null` (`:69-71`), `getActiveMembership` is skipped (`effective-permissions.ts:160`), and only `expandPlatformTenantVerbs` can satisfy the verb — there is no membership path there to leave alone |
| 8 | Is the `sales_cs` expansion narrowed or the false comment deleted? | the diff of `expandPlatformTenantVerbs` (`:103-139`) or of `permissions.ts:268` | the comment "column-restricted in repo layer (org notes/tags only)" survives with no implementation. `sales_cs` holds `platform.tenant.write`, which `:111-120` expands into `member.invite`, `member.write`, `member.remove`, `billing.write`, `charger.remote_start`, `charger.remote_stop`, `charger.config` and `billing.export` in every org |
| 9 | Does a test assert that no per-tenant verb composes upward into a platform verb? | the D10 test output, run against the output of `expandPlatformTenantVerbs`, not against the bundle maps | the assertion reads `MEMBERSHIP_ROLE_PERMISSIONS` only. The expansion is the direction that actually moves verbs |

---

### RC-04 — support context review
**Applies to** C01, C04–C15; scenarios 47–62; pack 18F §1 · **Reviewer** security · **Blocking** yes

| # | Pass/fail question | Evidence required | Fails if |
|---|---|---|---|
| 1 | Is expiry read from the database on every request? | the diff showing the C01-table read inside the guard body | expiry is read from `SessionPayload` (`lib/admin-session.ts:10-21`), a 12h HMAC cookie with no revocation path — the context would outlive its own exit |
| 2 | Does the context bind exactly one org, in its own table? | the C01 migration | the binding is stashed in `identity.platform_grants.scope` jsonb. That table has `user_id` as PRIMARY KEY (`packages/shared/src/db/identity.ts:386-389`), so it cannot hold two contexts and cannot be org-bound |
| 3 | **Fool-test.** Invert the expiry comparison and re-run: does T-SC-3 go red? | the run output from the sabotaged branch | green — expiry is never exercised and scenario 51 is decorative |
| 4 | Can a client distinguish `support_context_required` from plain `forbidden`? | the response body plus `src/lib/api-client.ts:72-84` | `apiFetchJson` flattens every error to a message string, so the code cannot survive to the UI and C04's "UI can offer entry" is unbuildable |
| 5 | Is `platform.support.action` enforced at the enter route? | the diff of the new route plus a grep proving it is the first call site | the route gates on `platform.tenant.read`. The verb has zero enforcement sites today (one of 17 verified-unenforced verbs) |
| 6 | Are `support_context_id` and `on_behalf_of_org_id` real columns on `audit.actions`? | the migration diff plus a select of those columns after T-SC-2 | the values live inside the `metadata` jsonb (`platform.ts:99`). They cannot then be indexed or filtered, and N03's projection cannot answer "show me staff actions" |
| 7 | Is the org notification an outbox row rather than a direct send? | the diff of the enter handler | it calls `sendEmail` (`lib/email.ts:41-101`), which fails open on a warn and whose callers log-and-continue. Scenario 54 would be unverifiable by construction |
| 8 | Is break-glass TTL numerically shorter than the standard TTL? | T-SC-7 output comparing the two `expiresAt` deltas | the flag is recorded but both paths use one constant |
| 9 | Does the bootstrap operator still work after the guard lands, and was that decided? | T-SC-1 run as the bootstrap admin, whose access comes from the `super_user` grant created at `repositories/admin-bootstrap.ts:86-95` | the operator now needs a context for every tenant read and nobody chose that. The old escape hatch is already dead: `routes/admin/auth.ts:134-137` always stamps `userId`, so `isBootstrapSession` returns false for a real login |

---

### RC-05 — impersonate deletion review
**Applies to** D01, D07–D09, P05; scenarios 71–74 · **Reviewer** backend · **Blocking** no

| # | Pass/fail question | Evidence required | Fails if |
|---|---|---|---|
| 1 | Is `platform.impersonate` absent from the catalogue? | `grep -rn platform.impersonate apps packages src` returning zero hits | any hit remains outside `docs/` |
| 2 | Are all three literal occurrences removed in one commit? | `git show --stat` covering `permissions.ts:82` (catalogue), `:249` (`platform_admin`), `:261` (`support_agent`) | one list still names it. `super_user` needs no edit — `:243` is `[...PLATFORM_PERMISSIONS]` and follows the catalogue automatically |
| 3 | Does the bundle test change land in the same commit? | the same commit touching `permissions.test.ts:192`, currently `expect(bundle.has("platform.impersonate")).toBe(true)` | it is split across two commits; the intermediate commit is red, which is what scenario 68 exists to prevent |
| 4 | **Fool-test.** Re-add the string to `PLATFORM_PERMISSIONS` only: does anything fail? | the typecheck and `npm test` output from that branch | nothing fails. `super_user: [...PLATFORM_PERMISSIONS]` means any catalogue addition silently re-grants the verb to `super_user`, and the catalogue-size assertion at `permissions.test.ts:50-54` only bounds the count between 10 and 25 |
| 5 | Are there genuinely zero enforcement sites to remove? | a grep for `requirePermission("platform.impersonate")` and `assertPermission(c, "platform.impersonate"` | any hit exists — then this is a behaviour change, not a catalogue edit, and Blocking must be re-rated |
| 6 | Is the PR free of a "clean up minted grants" migration? | the diff of `prisma/migrations/` | such a migration exists. `platform_grants` stores a role, not a verb list (`identity.ts:386-399`), and `SessionPayload` carries no permissions — there is nothing minted to revoke, so scenario 74 is satisfied by construction |
| 7 | Do the generated artefacts stay fresh? | `npm run check` output, specifically `api-endpoints` and `work-view` | either goes stale, or `docs/domain/onboarding/16-permission-matrix.md` still lists the verb |
| 8 | Is the "T-SC-6 runs in CI" claim true? | the steps listed in `.github/workflows/check.yml:55-70` | the acceptance says "in CI" while CI runs only `npm install`, `npm run db:generate`, `npm run check` — and `scripts/check-all.mjs:14-36` contains no vitest entry |

---

### RC-06 — attribution review
**Applies to** E01–E14, E17, M02, M04; scenarios 75–86, 91–98; pack 18F §2 · **Reviewer** backend · **Blocking** yes

| # | Pass/fail question | Evidence required | Fails if |
|---|---|---|---|
| 1 | Is `id_tokens.user_id` made nullable in both schema descriptions in one PR? | the diff touching `packages/shared/src/db/identity.ts` and `prisma/schema/identity.prisma:215,:239`, plus `npm run check:schema-consistency` output | only one is edited. That check compares table and column **names** only (`scripts/check-schema-consistency.mjs:120-132`) — no types, no nullability — so it passes on the drift |
| 2 | Does the E05 CHECK exist as SQL, not only as an ORM declaration? | the new directory under `prisma/migrations/` containing the constraint | it is declared in the schema files only. Precedent: `per_connector` is in `prisma/schema/commercial.prisma:406` and `packages/shared/src/db/commercial.ts:46` with no migration anywhere, so the schemas are already ahead of the database |
| 3 | **Fool-test.** Insert a row with attribution `installation` and a non-null subject directly over SQL: is it rejected by Postgres? | the parity run output showing the constraint name in the error | only the repository refuses. Application-level invariants are bypassable by any script — `apps/api/scripts/backfill-session-costs.ts` is exactly such a script and is runnable today |
| 4 | Is there one attribution writer after the change? | the diff naming which of `projections.ts:406-416`, `projections.ts:971-978`, `routes/webhooks/zaptec.ts:211/:335`, `repositories/zaptec-session-sync.ts:329/:347` now write attribution | the new table is written by one family while `session_ledger.driver_user_id` keeps being written by the other. The split-brain is live today: the OCPP writers never set `charging.sessions.user_id`, so `/api/driver/sessions/current` returns nothing for a session `/sessions/history` shows |
| 5 | Is a downgrade rejected and the original preserved? | T-ATTR-5 output plus a select showing the original row and the correction row both present | the correction is an UPDATE. Scenario 86 requires the prior value to survive |
| 6 | Does a tap-authorised session persist the `userId` the resolver already computed? | the diff wiring `match.userId` from `ocpp-authorize.ts:183-199` into a durable row | the gateway still only logs it (`gateway/src/identity-do.ts:680`). A random emulated UID can never match an `IdToken.value` (`lib/tap-intent/random-uid.ts:55-65`), so the stop-time re-resolve at `projections.ts:408-415` returns null and every tap session lands with `driver_user_id = NULL` |
| 7 | Is the aurar/króna bug fixed or explicitly frozen in the same PR? | the diff of `minorToIsk` (`repositories/driver-sessions.ts:95-98`) and of `driver-sessions.test.ts:246`, which asserts `costIsk: 64988` for a row worth 649.88 kr | attribution changes ship while the driver app still renders aurar as krónur at `apps/mobile/lib/screens/active_session.dart:208-209` — a corrected attribution then points at a 100x cost |
| 8 | Does the correction path leave the settled ledger row intact? | the M02 test output plus a before/after read of `cost_isk_minor` | the change reuses the `upsert` shape at `backfill-session-costs.ts:176-199`, which passes one object as both `create` and `update` |
| 9 | Is that backfill script fenced off? | a guard in the script or an explicit line in the PR body | it stays runnable. A `--commit` run sets `driverUserId: s.userId` — NULL for every OCPP-origin session — and `driverIdTag: s.ocppIdentity?.identityString` (`:185`), writing the charger's identity string into the driver column |

---

### RC-07 — OCPP authorization review
**Applies to** E03, E15, E16, F01–F04, F09; scenarios 75–90 · **Reviewer** backend · **Blocking** yes

| # | Pass/fail question | Evidence required | Fails if |
|---|---|---|---|
| 1 | Is `attribution` purely additive on the wire? | the diff of `AuthorizeResult` (`routes/internal/ocpp-authorize.ts:42-54`) plus the gateway's parse in `gateway/src/identity-do.ts` | an existing field changes type or becomes required. The gateway is a separately-deployed Worker; an old build must keep working (E16) |
| 2 | Does `enforceAuthorize` stay false everywhere this PR touches? | a count of installations with `enforce_authorize = true` before and after, from the approved disposable branch only | a migration changes the default. Every gate at `ocpp-authorize.ts:275-306` (contract) and `:320-330` (`no_billable_clauses`) is inert until that flag flips, and flipping it fleet-wide is F02's staged runbook, not a code change |
| 3 | **Fool-test.** Force the resolver to return `attribution: "installation"` together with a non-null `userId`: does the suite go red? | `ocpp-authorize.test.ts` run on the sabotaged branch | green — the E04 invariant is asserted nowhere, and `ocpp-authorize.test.ts` currently only pins verdict, reason and `enforceAuthorize` |
| 4 | Does revocation invalidate the gateway's verdict cache? | the diff adding a call from `revokeIdToken` (`domains/identity/repositories/id-tokens.ts:229`) to `POST /invalidate-authorize` | absent. `AUTHORIZE_CACHE_TTL_MS = 60_000` (`identity-do.ts:275`) keeps a revoked token authorising for a minute, and indefinitely inside a charger's local list — `pushIdTokenToCharger` has no removal counterpart. Grepping `apps/api/src` for `invalidate-authorize` returns zero hits today |
| 5 | Is the contract gate still one rule, or now a fourth copy? | the diff across `ocpp-authorize.ts:275-306`, `repositories/local-auth-list-push.ts:165-188`, `repositories/charger-technical-read.ts:255-266` | a fourth copy is added. Note the third copy already omits the zero-clause check, so the three disagree today |
| 6 | Does the classifier stop contradicting the tap detector before any UI reads attribution? | `idtag-classifier.test.ts` asserting the value `085ACDF6` | `classifyIdTagFormat` still returns `iso14443_4byte` with `high` confidence (`lib/idtag-classifier.ts:96-98`) while `isRandomEmulatedUid` calls the identical string a phone tap (`lib/tap-intent/random-uid.ts:38`). Any operator UI reading `detectedKind` mislabels every phone tap as a physical card |
| 7 | Is a deny distinguishable from an availability refusal on the wire? | the gateway diff | F03 is claimed satisfied by an OCPP `idTagInfo` value. `AVAILABILITY_REFUSAL_STATUS` is literally `"Blocked"` (`identity-do.ts:326`), separated from a real deny only by a log field at `:698` — the reason needs an out-of-band surface |
| 8 | Does `local-auth-list-push.ts` have a test file before E15 changes it? | the existence of a test beside `apps/api/src/repositories/local-auth-list-push.ts` | E15 lands with the status, scope and contract guards at `:118-188` still uncovered. `tap-intents.ts`, `random-uid.ts`, `ocpp-internal-auth.ts` and `admin-id-tokens.ts` are in the same state |
| 9 | Are H1–H4 answered before any `enforceAuthorize` flip? | the recorded F05–F08 bench answers | the runbook is executed with free-vend idTag behaviour and one-token-two-EVSE concurrency still unknown. The gateway also invents transaction ids (`identity-do.ts:961`) and the projection closes sessions by `(ocppIdentityId, status='in_progress')` (`projections.ts:828-833`), so scenario 78 has no way to disambiguate two concurrent sessions today |

---

### RC-08 — privacy and legal review
**Applies to** A11, I02, I10, N03, N04, N07, N08, C10, C11; scenarios 96, 155, 156 · **Reviewer** Andri · **Blocking** yes

| # | Pass/fail question | Evidence required | Fails if |
|---|---|---|---|
| 1 | Can a caller who is neither the subject nor an admin of the subject's org read a kennitala? | the response body of `GET /api/admin/users/:id` for `driver-anna@example.test` | the route stays gated on `member.read` with no `orgIdParam` (`domains/identity/routes/admin-users.ts:67`). `orgId` resolves to null, so only `expandPlatformTenantVerbs` can satisfy it — every platform role holds `platform.tenant.read`, and `UserSummary` returns `kennitala`, `dateOfBirth`, `address`, `phone` and `notes` (`domains/identity/repositories/users.ts:78,:109`) for any user in any tenant |
| 2 | Is `kennitala_taken` still returned to an unauthenticated caller? | the 409 body from `POST /api/public/register`, built at `routes/public/register.ts` as `{ error: result.reason }` from `repositories/registration.ts:147-151` | yes. That is a national-ID enumeration oracle, throttled only by `ADMIN_LOGIN_RATE_LIMITER` — and `rateLimit` fails **open** with a `console.warn` when the binding is missing (`lib/rate-limit.ts:121-129`) |
| 3 | Does the kennitala the mobile app collects have a stated purpose? | the decision from RC-02 question 2, alongside the app's consent copy | the app requires it (`apps/mobile/lib/api/client.dart:95`) and the server discards it unread — collection with no purpose and no disclosure |
| 4 | **Fool-test.** Add a `console.log` of the invite `tokenHash` and run the N08 redaction check: does it go red? | the run output from that branch | green — scenario 156 ("no hash, DSN, token or personal identifier in any log line") is asserted by nothing today |
| 5 | Does the audit projection scope rows to the requesting org and strip third-party identifiers from `metadata`? | the N03 response for `org_alpha`, inspected field by field | `metadata` is returned verbatim. `driver_invite.redemption_rejected` writes `boundUserId` and `attemptedByUserId` into it (`routes/public/driver.ts:1217-1228`), so an org admin would see the identity of someone who is not their member |
| 6 | Can the organisation see staff actions taken inside its tenancy? | scenario 55 output against the N03 route | `audit.read` is enforced but nothing reads the table. The only reader in the whole repo is `repositories/installation-ocpp.ts:272,:330`, and it reads exactly three action names to derive a rotation timestamp |
| 7 | Is a support agent's **read** of driver PII itself audited? | a select on `audit.actions` immediately after a context-scoped read of `driver-anna@example.test` | no row appears. All 14 `recordAuditAction` callers are mutations; a support agent can read a person's national ID and leave no trace |
| 8 | Is a retention period stated for `audit.actions`? | the written N07 policy plus `POSTGRES_RETENTION_DAYS` and `DROPPABLE_PARENTS` (`lib/db/partition-cron.ts:191-197,:226-231`) | N07 is closed as done. Only `raw_protocol` has a number (7 days); `financial`, `operational`, `aggregate` are all `null`, and `audit.actions` is not a droppable parent at all — it is retained forever by default |
| 9 | Does account deletion define the fate of the kennitala and of session history? | the I10 decision text | `status='deleted'` plus `clearUserPasswordHash` (`domains/identity/repositories/users.ts:381-386`) is presented as deletion. The kennitala column survives and is unique, so the same person can never re-register — and `sessionLedger.driver_user_id` still points at the row |
| 10 | Does the bearer-only peek route disclose more than I05's table allows? | the `GET /api/public/invites/peek` response (`routes/public/invites.ts:75-83`) | it keeps returning `email` and `orgDisplayName` to anyone holding the token while the disclosure table says a pending invite reveals name only. That route also carries no rate limit — `publicInvites` registers no middleware |
## Appendix 19G part 2 of 2 — review checklists: agreement writes, cost assignment, onboarding aggregate, audit taxonomy, migration, Codex frontend wiring, release readiness

Seven checklists, RC-09..RC-15. Every question is yes/no and names the file the
reviewer opens to answer it. Line numbers were read on branch
`docs/singular-onboarding-domain-packet` (tip `fc071b3`) in the worktree
`E:/Claude/Straumvakt-onboarding-domain`.

Each checklist carries at least one **fool test** — a question whose honest
answer today is "no", or one that catches a reviewer restating a comment instead
of reading the code the comment describes. Fool tests are marked in the question
text.

A "no" on any row is a blocking finding unless the checklist header says
otherwise. "Unverified" is an acceptable answer only where the row says so.

---

### RC-09 — Agreement write surface (Group K, scenarios 137–143)

**Applies to** any PR that adds create/update/activate/retire on
`agreements.agreements`, `agreements.agreement_clauses` or `agreements.bearer_rules`
· **Reviewer** backend owner who is not the PR author · **Blocking** yes
(K01–K05, K07, K10 are P0)

Group K is **greenfield**. `apps/api/src/repositories/agreements.ts:1-7` declares
itself read-only, and a grep of `apps/api/src` for `.agreement.create`,
`agreementClause.` and `bearerRule.` writes returns zero hits. The only writer in
the repo is the one-off script `apps/api/scripts/supersede-orphan-b6771541.ts`.
Review this as new construction, not as hardening.

| # | Question (yes/no) | Evidence required | Fails if |
|---|---|---|---|
| 1 | Does the diff amend or replace the read-only header at `apps/api/src/repositories/agreements.ts:1-7` in the same commit that adds writes? | The header hunk in the diff | Writes land in a new sibling module while `agreements.ts` still tells the next reader the repository is read-only |
| 2 | Is activation gated on an **org-scoped** verb resolved from the target agreement's `counterpartyOrgId`? | The `requirePermission(...)` call on the activate route showing an `orgIdParam` option | The route copies the bare shape used at `apps/api/src/routes/admin/agreements-resolve.ts:27`, `requirePermission("billing.write")` with no `orgIdParam` — `require-permission.ts:69-74` then resolves `orgId = null` and `effective-permissions.ts:159-169` skips the membership lookup entirely |
| 3 | **Fool test.** Does the PR include a negative test in which a `sales_cs` platform grant attempts activation and receives 403 (scenario 141)? | The named test case | Only the positive "org admin can activate" case is asserted. `sales_cs` holds `platform.tenant.write` (`apps/api/src/lib/auth/permissions.ts:268`) and `expandPlatformTenantVerbs` (`apps/api/src/lib/auth/effective-permissions.ts:103-138`) expands it into `billing.write`, `org.write`, `member.remove`, `charger.remote_start` and `charger.remote_stop` in **every** org — a positive-only suite goes green while K07 is broken |
| 4 | Does overlap rejection (K05, scenario 139) land as a Postgres constraint — `btree_gist` extension plus an `EXCLUDE` over a `tstzrange` — in a new `prisma/migrations/` directory? | The migration SQL | Rejection is a SELECT-then-INSERT pre-check in the repository. Grep of `prisma/migrations/` for `EXCLUDE`, `btree_gist` and `tstzrange` returns zero hits today, and `prisma/schema/commercial.prisma:483-513` gives `Agreement` four plain `@@index` declarations and no range constraint |
| 5 | Does the PR state what happens to the existing read-time mitigation at `apps/api/src/lib/agreement/persist.ts:143-165` (a `console.warn` on `installationMatchCount > 1` plus a deterministic `effectiveFrom desc, id asc` order)? | A line in the PR description, or its removal in the diff | The warn is left in place with no statement, so two mechanisms now disagree about what an overlap means |
| 6 | Does update reject edits to price-resolution fields on a row whose `status` is `active`, using the error code already established for the sibling surface, `active_row_immutable`? | The error branch, compared against `apps/api/src/routes/admin/billing-rate-references.ts:6-12` | A new error code is invented, or the guard keys off `effectiveFrom > now` rather than `status` |
| 7 | Does the activate/supersede path auto-close the prior row's `effectiveUntil` inside a single transaction, matching the shape already built at `billing-rate-references.ts:90-101`? | The transaction block | A second staged-version pattern is invented alongside the one that already works |
| 8 | Is the activation audit snapshot (scenario 142) produced by calling the existing resolver rather than by hand-walking clauses in the write path? | The call into `resolveBillingLines` (`packages/commercial/src/agreement/resolve.ts:34`) or into `POST /debug-resolve` (`apps/api/src/routes/admin/agreements-debug.ts:89`) | The snapshot is assembled inline — that is a fourth pricing implementation, see RC-10 Q4 |
| 9 | If the PR claims K11 ("verbs live"), does at least one route file contain `requirePermission("contract.write")` or `requirePermission("tariff.write")`? | The route file | Only the catalogue declarations at `permissions.ts:69` and `:72` and the ADMIN/FINANCE bundles are cited. Both verbs guard zero routes today |
| 10 | Does the PR avoid any backfill of legacy tariff rows into the agreements tables (K14)? | Absence of INSERT statements in the migration directories | Any migration INSERTs into `agreements.agreements` or `agreements.agreement_clauses` |

---

### RC-10 — Cost-factor assignment and pricing implementations (Group L, scenarios 137–140, 144–146)

**Applies to** any PR that writes a cost factor, a rate reference, a clause scope,
or that adds a price preview · **Reviewer** billing owner · **Blocking** yes for
L01, L02; advisory for L09, L12

| # | Question (yes/no) | Evidence required | Fails if |
|---|---|---|---|
| 1 | Does the PR name which of the two cost-factor tables it writes? | The Drizzle symbol in the diff: `billingCostFactors` (`packages/shared/src/db/commercial.ts:89`, schema `billing.cost_factors`) or `agreementsCostFactors` (`:255`, schema `agreements.cost_factors`) | The PR says "cost factors" without a schema. The two tables are unrelated: `billing.cost_factors` is anchored by `CostFactorAnchor` and referenced by `TariffDefinition`; `agreements.cost_factors` is what `RateReference` and `AgreementClause` point at |
| 2 | If the write targets `billing.cost_factors`, does the PR explain how the agreements resolver ever sees it? | The read path in `resolveFactor` (`packages/commercial/src/agreement/resolve.ts:45`) | The PR claims a resolved price changes while touching only the catalogue that `apps/api/src/routes/admin/billing-cost-factors.ts` CRUDs. That router is the L06 surface and it does not feed the resolver |
| 3 | Is the clause scope limited to org, driver group, installation and charger, with no per-driver tier (L01, scenario 146)? | The scope union in `packages/commercial/src/agreement/types.ts` (`allocationSchema` :91) | A driver-level scope is added. Scenario 146 requires the attempt to be **rejected** for beta |
| 4 | Does the PR avoid adding a fourth pricing implementation (K08 acceptance "no second pricing impl")? | The call graph of the new preview or summary code | A fourth path appears. Three exist today: the legacy chain `apps/api/src/lib/tariff/compute-session-cost.ts:112` reached from the OCPP `session.stopped` projection (this is the price of record), the agreements resolver `packages/commercial/src/agreement/resolve.ts:141`, and the driver-pricing summarisers `summarisePerKwhForList` (`apps/api/src/repositories/driver-pricing.ts:175`) and `summariseForCharger` (`:208`) |
| 5 | **Fool test.** Does the PR include a test asserting the preview number equals what `resolveAndPersistForSession` (`apps/api/src/lib/agreement/persist.ts:335`) would write for the same session context, rather than a snapshot of the preview against itself? | The assertion, with both sides named | Preview is tested only against fixtures. The driver preview walks clause defaults and never applies `BearerRule` overrides — `driver-pricing.ts:25-34` says so in the source — so a self-consistent snapshot test passes on a wrong number |
| 6 | Does assignment write exactly one audit row carrying actor, scope type and scope id, inside the same transaction as the write (L08)? | The `recordAuditAction` call site | No audit is written. Neither `apps/api/src/routes/admin/billing-cost-factors.ts` nor `apps/api/src/repositories/billing-cost-factors.ts` calls `recordAuditAction` today, so there is no local precedent to copy — this is new |
| 7 | Is assignment gated on something other than the bare `billing.write` used by every existing billing mutation (`billing-cost-factors.ts:50`, `:97`, `:163`, `:188`)? | The permission call | Same bare gate. See RC-09 Q2 and Q3 — the platform expansion makes `billing.write` org-wide for `sales_cs` |
| 8 | Does retirement preserve historical resolution with no row delete (L03)? | The status transition, compared with `deactivateCostFactor` (`apps/api/src/repositories/billing-cost-factors.ts:252`) | Any DELETE. Historical lines resolve through the factor row |
| 9 | Do effective-dating fields (L10) get enforced in the repository layer and not only in zod? | The repository guard, plus the schema change in `apps/api/src/lib/billing/cost-factor-zod.ts` (`createCostFactorSchema` :67, `updateCostFactorSchema` :94, which have no date fields today) | Enforcement is zod-only, so any non-route caller bypasses it |
| 10 | Is the overlap-rejection test (L11) in a file matched by `vitest.config.ts:19-24`? | The test path | The test lands under `apps/api/test/parity/`, which matches none of those globs and only runs via `npm run test:parity --workspace apps/api` with `vitest.parity.config.ts` — and see RC-15 Q1, no vitest runs in CI at all |

---

### RC-11 — Organisation onboarding aggregate (Group G, scenarios 99–112)

**Applies to** any PR adding `onboarding_workflow`, `onboarding_step`,
`onboarding_substep` or `/api/admin/orgs/:orgId/onboarding` · **Reviewer** backend
owner plus whoever owns the Codex contract · **Blocking** yes for G01–G09

Greenfield. A repo-wide grep for `onboarding_workflow`, `onboarding_step`,
`onboarding_substep` and `onboardingWorkflow` across `.prisma`, `.ts`, `.sql` and
`.dart` returns nothing outside `docs/`. `apps/api/src/routes/admin/orgs.ts`
registers no `/onboarding` sub-route.

| # | Question (yes/no) | Evidence required | Fails if |
|---|---|---|---|
| 1 | Does the PR create the tables rather than alter existing ones? | The migration directory contents | The PR description calls this "hardening" or cites an existing endpoint. Nothing exists to harden |
| 2 | Is "one open workflow per org" (G02, scenario 100) enforced by a partial unique index in SQL? | The `CREATE UNIQUE INDEX ... WHERE status IN (...)` statement | Enforcement is a repository-layer existence check, which two concurrent starts both pass |
| 3 | Is the version bump (G08, scenario 102) a compare-and-set `UPDATE ... WHERE version = $n` returning 409 `version_conflict` with the current aggregate? | The UPDATE and its rowcount branch | Read-then-write. A stale `If-Match` then wins the race silently |
| 4 | Is the Idempotency-Key (G07, scenario 101) persisted? | The table it writes to | The key is compared in memory only. Note `events.idempotency_keys` exists and is used for OCPP event dedupe (`apps/api/src/lib/db/raw.ts:257`, `:288`) — it is not an HTTP idempotency layer, and no route in `apps/api/src` reads an `Idempotency-Key` header today |
| 5 | Does the G09 invariant ("only `active` confers access", scenario 107) land as a check inside the redemption handler? | The new guard in `apps/api/src/routes/public/invites.ts` | The invariant is only written in the aggregate's docs. The consume handler performs no org-status check today |
| 6 | Does the PR state whether `POST /api/admin/onboarding/chains` (`apps/api/src/routes/admin/onboarding.ts:13`) is replaced, wrapped or left alone? | A line in the PR description | Unstated. The chain creates Org through OcppIdentity in one 60s transaction (`apps/api/src/repositories/onboarding-chains.ts:51-199`) and returns the OCPP password once (`:198`), so left alone it bypasses every step gate the aggregate adds |
| 7 | **Fool test.** Do the new write routes pass the session actor into the repository? | The call site | The PR repeats the existing bug: `routes/admin/onboarding.ts:20` calls `createOnboardingChain(db, parsed.data, null)` and `routes/admin/chargers.ts:68` and `:272` pass `null` as `actorUserId` while `c.get("session")` is live. The audit row at `onboarding-chains.ts:183-197` therefore records a null actor. `apps/api/src/routes/admin/installations.ts:137`, `:163`, `:191` do it correctly — that is the pattern to copy |
| 8 | Does the aggregate produce an Installation row for chargers it provisions? | The create path | It does not, matching the chain: `onboarding-chains.ts:117-127` sets no `installationId`, so every charger is an orphan in the site tree (`apps/api/src/repositories/site-tree.ts:721-725`) and cannot use the per-installation OCPP password surface at all |
| 9 | Is the new route gated with `requirePermission(..., { orgIdParam: "orgId" })`? | The permission call | The gate is bare. Then only platform grants or the bootstrap session reach it, and nothing checks that the body's org matches the caller's (scenario 113's consistency requirement) |
| 10 | Is there a test proving suspension does not revoke memberships (G12, scenario 108)? | The named test | Only the status flip is asserted |

---

### RC-12 — Audit taxonomy and integrity (Group N, scenarios 155–156)

**Applies to** any PR that writes an audit row, adds an `actorKind`, or claims an
action is auditable · **Reviewer** backend owner · **Blocking** yes for N01, N02

Single writer: `recordAuditAction` (`apps/api/src/lib/audit.ts:58-86`), fourteen
non-test callers, one reader in the whole repo, no route. No `audit.test.ts`
exists.

| # | Question (yes/no) | Evidence required | Fails if |
|---|---|---|---|
| 1 | Does every new `recordAuditAction` call derive `actorUserId` from the session rather than from the parsed request body (N01)? | Each call site in the diff | Any call reads an actor field out of the body. `AuditActionInput` (`audit.ts:26-34`) will accept whatever it is handed |
| 2 | If the PR claims `bearer` actions are distinguishable (N02, scenario 6), does it change **all three** declarations — a Postgres `ALTER TYPE`, the Drizzle enum at `packages/shared/src/db/platform.ts:29`, and the Prisma enum in `prisma/schema/platform.prisma`? | The three hunks | Only a TypeScript union changes. `ActorKind` is a Postgres enum with exactly `user`, `system`, `vendor_webhook`, `ocpp_worker` |
| 3 | **Fool test.** Does the PR write any `actorKind` other than `"user"` at a real call site? | The literal in the diff | It does not, while the PR claims taxonomy coverage. All 24 `actorKind:` literals in the repo today are `"user"`; the other three enum values are dead |
| 4 | For a rejection with no resolvable org, does the PR say what is written? | The branch, or a PR note | The PR claims "every rejection is audited" without addressing `audit.actions.org_id` being NOT NULL with an FK — which is why `apps/api/src/routes/public/driver.ts:1206` wraps its `driver_invite.redemption_rejected` write in `if (row.driverGroup)`, so a malformed token's rejection goes unlogged entirely |
| 5 | Are event names (N05) drawn from one exported constant that the writer type-checks against? | The constant and the type change | Names stay free strings. `AuditActionInput.action` is `string` (`audit.ts:31`), so a typo is a new taxonomy entry |
| 6 | If the PR claims to expose the log (N03), does it add a repository read and a route? | The new route file | It points at `apps/api/src/repositories/installation-ocpp.ts:272` and `:330`, the only reader in the repo, which matches exactly three action names to derive one timestamp |
| 7 | Is append-only (N06) enforced at the database level? | The grant or trigger in the migration | Enforcement is convention only, stated in a comment |
| 8 | Is there a test asserting **exactly one** audit row per state change (scenario 155), with a count and not just "was called"? | The assertion | `toHaveBeenCalled` without a count. There is no `audit.test.ts` today; the only incidental coverage is a Prisma fake in `apps/api/src/repositories/driver-access-requests.test.ts:487-488` |
| 9 | Is the audit row written inside the same transaction as the state change, with side effects such as email outside it? | The transaction boundary | A new path writes the audit row outside the transaction. `driver-access-requests.ts` puts audit at `:263` inside and email at `:289` outside — that ordering is the precedent |
| 10 | Does any new `metadata` field carry a token, token hash, DSN or personal identifier (N08, scenario 156)? | The metadata object literal | Any of those appear. `metadata` is unbounded `jsonb` (`packages/shared/src/db/platform.ts`, `actions` table) and nothing redacts it |

---

### RC-13 — Migration and schema change (Group Q)

**Applies to** any PR adding or altering a table, column, enum value or index
· **Reviewer** whoever owns the staging database · **Blocking** yes

Two migration systems run in parallel: `prisma/migrations/` holds 47 directories
plus `migration_lock.toml`, and `apps/api/drizzle/meta/_journal.json` holds two
entries (`0000_baseline`, `0001_regular_talos`).

| # | Question (yes/no) | Evidence required | Fails if |
|---|---|---|---|
| 1 | Does the PR touch both migration systems, or state in writing why only one? | The diff file list, plus a PR note | A new table appears in `packages/shared/src/db/*.ts` (authoritative per ADR 0051) with no corresponding Prisma migration, while ~500 un-ported Prisma calls still read the same database |
| 2 | **Fool test.** Does any part of the PR or its description refer to `prisma/schema.prisma`? | The text | It does. That file does not exist. The schema is the folder `prisma/schema/` (8 `.prisma` files) and `prisma.config.ts:30` points at the directory. Anyone naming the single file has not opened the schema |
| 3 | Was `apps/api/prisma/schema/` regenerated by `node scripts/sync-api-prisma-schema.mjs` rather than hand-edited? | A green `npm run check:api-schema` (which is `sync-api-prisma-schema.mjs --check`, `package.json:23`) | The generated copy was edited directly. It is a generated artifact, and `check:api-schema` is one of the nine checks in `scripts/check-all.mjs:14-36` |
| 4 | If the PR adds `per_connector` support, does it include the `ALTER TYPE ... ADD VALUE 'per_connector'` migration? | The migration SQL | The value stays declared-only. `prisma/schema/commercial.prisma:406` and `packages/shared/src/db/commercial.ts:46` both declare it and grep of `prisma/migrations/` returns nothing — the schema files are ahead of the database, and the next `prisma migrate` run by anyone will generate that ALTER bundled with whatever else they were doing |
| 5 | If the PR wires `npm run check:migrations` into CI (Q09), have `20260807003000_drop_issues_scaffold` and `20260807120000_drop_never_used_tables` been reconciled against staging first (Q10)? | The reconciliation record | The step is added while those two are on disk but unrecorded. `check:migrations` now exits non-zero while migrations are pending, so CI turns red on every branch immediately — the reason it is deliberately excluded, documented at `.github/workflows/check.yml:10-44` |
| 6 | If a `DATABASE_URL` secret is added for that step, is the workflow trigger narrowed? | The `on:` block | It is not. `.github/workflows/check.yml:47-50` triggers on `push: branches ["**"]` and on `pull_request`, so a staging credential becomes reachable from every branch and every PR run. See D-5 in `docs/notes/2026-08-09-release-decision-register.md` |
| 7 | Are the expand-phase migrations additive only (Q01)? | The SQL | Any `DROP COLUMN`, `DROP TABLE`, or `SET NOT NULL` without a default on a populated table |
| 8 | Does each new migration directory have a stated reverse (Q05), given Prisma has no down-migrations? | The rollback note naming the mechanism | "Roll back by restoring a branch" with no branch named and no owner |
| 9 | **Fool test 2.** Does the PR cite a green `npm run check` as evidence that Drizzle and Prisma agree on types or nullability? | The claim in the PR | It does. `scripts/check-schema-consistency.mjs:120-132` compares table and column **names** only — no types, no nullability, no defaults. A green run proves neither |
| 10 | Does the PR avoid any data backfill or import job (Q11)? | Absence of INSERT/UPDATE in migration SQL | Any data migration appears where the packet's direction 8 says new tables start empty |

---

### RC-14 — Codex frontend wiring (Group O, scenarios 149–154)

**Applies to** PRs under `src/` (the Next app) that add, gate or disable a
control · **Reviewer** Codex lane owner · **Blocking** yes for O01–O04

**Out of scope, explicitly:** Straumvakt.org visual and brand work is a separate
lane. This checklist must not be applied to it and must not block it. If a PR
mixes the two, the correct outcome is a split, not a rejection.

The web app has **no** Next.js API route handlers (`src/app/api` does not exist)
and **no** test files under `src/` at all.

| # | Question (yes/no) | Evidence required | Fails if |
|---|---|---|---|
| 1 | For each control the PR touches, does the diff say whether it is **disabled** (rendered with copy) or **hidden** (not rendered), and does that match the acceptance? | The component branch | The two are mixed. O08 requires cost factors "Not rendered"; O06 and O07 require visible copy. A greyed-out cost-factor card with a "soon" tag satisfies neither |
| 2 | Does the gating decision hang off `BUILT_SECTIONS` (`src/lib/org-tenant.ts:204-207`), the only "is this shipped" switch in the app? | The import | A second, parallel flag is introduced, so two sources of truth decide what is live |
| 3 | Does any new test start a mock server or intercept `fetch` for an endpoint that does not exist under `apps/api/src/routes/` (O04, scenario 154)? | The test file | It does. The rule is: absent endpoint means assert the disabled state. Nothing local can serve a stub anyway — `src/app/api/` does not exist and every request leaves via `apiFetch` (`src/lib/api-client.ts:52-65`) or `apiFetchServer` (`src/lib/api-client-server.ts:26-63`) |
| 4 | Do the required strings appear literally — "This isn't tracked yet" (scenario 150) and "Managed through driver groups" (scenario 151)? | The copy in the diff | Progress is derived from charger or installation counts instead. Today the only disabled affordance in the app is the literal "soon" / "væntanlegt" at `src/app/org/[slug]/page.tsx:296-299` |
| 5 | **Fool test.** Does the PR or the review claim an Icelandic state was seen rendered? | The claim | It does. `src/components/language-provider.tsx:20` sets `FORCED_LANGUAGE = "en"` and `:26` accepts `initialLanguage` and never uses it, so every `language === "is"` branch — including all Icelandic labels in `orgSectionLabel` and `TENANT_REGISTRY` — is unreachable. Anyone reporting the Icelandic view has not run it |
| 6 | Is the demo-mode kill switch (O02, scenario 153) a **build failure** — a command that exits non-zero — rather than a runtime warning, banner or redirect, default-off, and scoped to fire only against a beta or production config? | The failing command, wired into `npm run check` (`scripts/check-all.mjs:14-36`) or into the build, plus the config condition | The guard logs, warns, or renders a banner; or it fires unconditionally, which makes local demo work impossible and gets switched off. `NEXT_PUBLIC_DEMO_MODE` appears nowhere in the repo outside `docs/`, so this is new code with nothing to hook into — `next.config.mjs` has no such check today |
| 7 | Are all fixtures in the `demo-*` or `*@example.test` namespace (O03)? | The fixture files | Any real address, org name or person appears |
| 8 | If a component switches on an API error code to choose a disabled state, does that code survive the client? | The error path in `src/lib/api-client.ts:72-84` | It does not. `apiFetchJson` flattens every error to a string message, so a coded 403 cannot be distinguished downstream without changing that function |
| 9 | Is the new test file matched by `vitest.config.ts:19` (`src/**/*.test.ts`)? | The test path | It lands outside that glob. There are zero test files under `src/` today, so a directory has to be created rather than extended |
| 10 | Does the PR mix Straumvakt.org visual work with Group O contract work? | The diff file list | They are bundled. Split them; the visual lane is not gated by this checklist |

---

### RC-15 — Release readiness before a customer touches it

**Applies to** any decision to expose the system to a non-fixture user
· **Reviewer** release owner, with the answers written down and dated
· **Blocking** yes — every row is a stop

This checklist is about what must be **true**, not what must be planned. A row
answered from a comment rather than from the code it describes is a fail.
Outbound-command retry has no terminal state either (`apps/api/src/lib/dispatcher.ts:161-164`
leaves retriable rows `pending`, three dead-letter queues at `apps/api/wrangler.jsonc:87`,
`:109`, `:116` have no consumer, and `maxAttempts` appears nowhere in `apps/api/src`) —
that belongs to the Group R observability review, not here.

| # | Question (yes/no) | Evidence required | Fails if |
|---|---|---|---|
| 1 | Does a CI step exist that runs the test suite at all? | The workflow file | It does not. `.github/workflows/check.yml:64-70` has three steps — `npm install`, `npm run db:generate`, `npm run check` — and `scripts/check-all.mjs:14-36` lists nine offline checks, none of them vitest. No test suite runs in CI on any branch, so every "tests pass" claim in the packet is a claim about someone's laptop |
| 2 | Is the bootstrap god-mode path unreachable in the customer-facing environment? | The credential's absence from the deployed environment, verified, not assumed | The answer cites the comment at `apps/api/src/lib/auth/require-permission.ts:56-57` ("Sprint 5 invite flow flips this off"). The early return at `:55-59` and the matching branch in `assertPermission` at `:115-117` still bypass every permission check for a session with no `userId` |
| 3 | Does the join and redeem path fail **closed** when the rate-limit binding is missing (scenario 127)? | The branch | It fails open. `apps/api/src/lib/rate-limit.ts:121-128` warns and returns `next()` when the binding is absent or malformed, so a misconfigured deploy silently removes the limiter |
| 4 | **Fool test.** Is the `sales_cs` blast radius bounded by code rather than by a comment? | The restriction, in the repository layer | It is not. `apps/api/src/lib/auth/permissions.ts:268` grants `platform.tenant.write` with the trailing comment "column-restricted in repo layer (org notes/tags only)", and `expandPlatformTenantVerbs` (`apps/api/src/lib/auth/effective-permissions.ts:128-133`) expands it into every per-tenant write verb — `member.remove`, `charger.remote_start`, `charger.remote_stop`, `billing.write`, `org.write` — in every org. The restriction the comment names does not exist |
| 5 | Do the release notes avoid listing any verb that guards zero routes? | A grep of `apps/api/src` for each claimed verb | `platform.impersonate`, `platform.support.action`, `contract.write` or `tariff.write` are described as capabilities. All four appear only in `permissions.ts` and `permissions.test.ts` — zero `requirePermission` call sites |
| 6 | Is the shipped mobile client compatible with the deployed invite contract? | `apps/mobile/lib/api/client.dart:101-105` against `ConsumeBody` (`apps/api/src/routes/public/invites.ts:36-39`) | The release makes `ConsumeBody` strict. The app posts a third field, `kennitala`, that the non-strict `z.object` silently strips today; strictness turns every shipped redemption into a 400 |
| 7 | Does customer-facing copy avoid implying that agreements pricing is in effect? | The screens, against the money path | It implies it. The price of record is the legacy chain (`apps/api/src/lib/tariff/compute-session-cost.ts:112`, invoked from the OCPP `session.stopped` projection into `reports.session_ledger`); the agreements resolver has priced zero sessions, and the driver preview is legended "indicative" precisely because nothing enforces agreement between them (`apps/api/src/repositories/driver-pricing.ts:25-34`) |
| 8 | Is the Worker serving the customer domain a dedicated production Worker? | The deploy target | It is `staging`. See D-1 and D-2 in `docs/notes/2026-08-09-release-decision-register.md`: `straumvakt.org`, `www` and `hlada-staging.straumvakt.workers.dev` return byte-identical bodies, and CPMS declares the same Worker names on the same account |
| 9 | Does any failure route somewhere other than a console line, and can an operator answer "who did this, when" without tailing a Worker? | The alert sink, plus a UI or API over `audit.actions` | Neither exists. Every cron branch in `apps/api/src/index.ts:357-500` is `ctx.waitUntil` with a swallowed catch and the one real detector reports via `console.error("[ocpp-silence] FLEET-WIDE ...")` at `:449` and `console.warn` at `:458`; and fourteen files write `audit.actions` while the only reader in the repo is `apps/api/src/repositories/installation-ocpp.ts:272` and `:330`, matching three action names |
| 10 | Are invite redemption and driver join reachable only by fixture tenants until Group A ships (O09, scenario 152)? | The guard | Real users can redeem while the S2 hardening is unshipped. `ConsumeBody` has no already-claimed branch, and `apps/mobile/lib/api/client.dart:122-137` has no branch for `already_claimed` either |
