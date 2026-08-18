# Appendix 19B — implementation task map

**303 source-linked tasks** across 20 groups. Phase 2 of the readiness packet.
The brief asked for 180; the group minimums summed to 232 and the authors found
more real work than that.

Every task names files that were read on this branch at `fc071b3`, cites work
packages from [18A](18A-work-packages.md) and scenarios from
[18C](18C-scenarios.md), and classifies itself **do-now**, **do-later** or
**blocked**. A blocker does not mean the task was skipped — it means the task is
written in its blocked state, with the missing prerequisite named.

| Group | Area | Tasks |
|---|---|---|
| `IT-S2` | S2 password-overwrite hardening | 18 |
| `IT-CMP` | invite claim/join compatibility | 16 |
| `IT-KEN` | kennitala / identity binding | 11 |
| `IT-PROV` | permission provenance refactor | 18 |
| `IT-SCTX` | support-context guard | 22 |
| `IT-IMP` | `platform.impersonate` removal | 10 |
| `IT-ATTR` | attribution / token class | 21 |
| `IT-OCPP` | OCPP authorization truth | 14 |
| `IT-SESS` | charge-session attribution and dispute | 13 |
| `IT-ONB` | organisation onboarding aggregate | 14 |
| `IT-CHG` | charger onboarding safety | 10 |
| `IT-DAR` | driver access requests | 14 |
| `IT-CODE` | installation code / passphrase contract | 16 |
| `IT-AGR` | agreement write surface | 18 |
| `IT-COST` | cost-factor assignment | 16 |
| `IT-AUD` | audit taxonomy and read model | 16 |
| `IT-UI` | Codex / frontend wiring | 13 |
| `IT-CI` | CI and static guardrails | 13 |
| `IT-MIG` | migration / preflight / rollback | 16 |
| `IT-OBS` | observability and support runbooks | 14 |
| | **Total** | **303** |

**Read `IT-CI-01` first.** It adds a vitest step to CI. Until it lands, every
task whose acceptance says "fails CI" is unenforced text.

---

# Appendix 19B — implementation task map, part 1 of 5

Source of truth: `docs/domain/onboarding/19A-source-inventory.md` (A01, A02, A03),
`18A-work-packages.md` (Groups A, B, C, D), `18C-scenarios.md` (1–74), and the
files named in each task, all read on branch `docs/singular-onboarding-domain-packet` @ `fc071b3`.

---

## S2 — Invite consume password-overwrite hardening (18)

Hardening, not greenfield: `apps/api/src/routes/public/invites.ts` exists, is mounted at
`apps/api/src/index.ts:206`, and the exact guard the packet asks for is already written
900 lines away in `apps/api/src/routes/public/driver.ts:1089-1098` (`already_claimed` +
`userCredential.create`). Two packet claims are wrong and the tasks below correct them:
`consume` does **not** return 500 for `malformed_metadata` — the status map at `invites.ts:180`
sends everything except `not_found` to 410, so it is a 410 today; the 500 is in `peek` at
`invites.ts:69`. And A04's `actorKind:"bearer"` is not "a new audit branch": `ActorKind` has
exactly four values (`packages/shared/src/db/platform.ts:29`) and `bearer` is not one.

**IT-S2-01** — Guard credential existence before the token claim
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A01 · **Scen** 1-4 · **When** blocked · **Approval** Andri
- **Accept:** A `findUnique` on `userCredential` sits between the expiry check (`:117`) and the `updateMany` claim (`:130`); a consume against a user with a password returns 409 and `user_tokens.used_at` for that row is still NULL after the request. Blocked on decision **D-01** (`docs/domain/onboarding/13-decision-packet.md:13`) — nothing in the repo records whether consume is deliberately a password-reset path.
- **Tests:** T-S2-1, T-S2-5 · **Pre/mig:** none, read-only query added inside the existing `$transaction` · **Rollback:** delete the conditional; behaviour returns to today's · **Codex:** a `409 already_claimed` branch becomes reachable, so the mobile and archived-web copy tasks unblock.

**IT-S2-02** — Test passwordHash IS NOT NULL, not row existence
`apps/api/src/routes/public/invites.ts` `prisma/schema/identity.prisma` `apps/api/src/domains/identity/repositories/users.ts` · **Change** edit · **Pkg** A01 · **Scen** 1,4 · **When** do-now · **Approval** none
- **Accept:** The guard's predicate is `passwordHash !== null`, not `row !== null`. `UserCredential.passwordHash` is `String?` (`identity.prisma:343`) and `clearUserPasswordHash` (`users.ts:381-386`) sets it to NULL while leaving the row, so a row-existence test permanently locks out any user whose password an admin deliberately cleared. Checkable: seed a credential row with `passwordHash: null`, consume succeeds with 200.
- **Tests:** T-S2-1 plus a new case "cleared password still consumable" · **Pre/mig:** none · **Rollback:** n/a, folded into IT-S2-01 · **Codex:** none.

**IT-S2-03** — Replace userCredential.upsert with create
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A02 · **Scen** 4 · **When** blocked · **Approval** Andri
- **Accept:** `:142-146` reads `tx.userCredential.create({ data: { userId, passwordHash } })` with no `update` branch; grepping the file for `upsert` returns zero hits. With IT-S2-01 temporarily removed, the same request raises a unique-constraint error rather than silently overwriting. Blocked with IT-S2-01 on D-01 — this is the half that makes the overwrite structurally impossible rather than merely guarded.
- **Tests:** T-S2-2 · **Pre/mig:** none; `user_credentials.user_id` is already the PK (`identity.prisma:341`) · **Rollback:** restore the `upsert` call · **Codex:** none.

**IT-S2-04** — Map already_claimed to 409 in the consume status map
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A03 · **Scen** 1 · **When** do-now · **Approval** none
- **Accept:** `:179-182` no longer collapses every non-`not_found` reason to 410; `already_claimed` returns 409. Observable: response status is 409 and body `{"error":"already_claimed"}`. Mirrors `driver.ts:1138-1144`, which already returns 409 for the same reason string.
- **Tests:** T-S2-1 · **Pre/mig:** none · **Rollback:** one line in the status map · **Codex:** clients can distinguish "someone already set this up" from "already redeemed".

**IT-S2-05** — Decide the refusal-audit actorKind: migrate the enum or reuse system
`packages/shared/src/db/platform.ts` `prisma/schema/platform.prisma` `apps/api/src/lib/audit.ts` · **Change** decision · **Pkg** A04 · **Scen** 6 · **When** blocked · **Approval** Andri
- **Accept:** A recorded choice between (a) adding `bearer` to the `audit.ActorKind` Postgres enum, or (b) writing the refusal with `actorKind: "system"` and `actorUserId: null` and putting the bearer fact in `metadata`. Observable: whichever is chosen, `AuditActionInput.actorKind` (`audit.ts:29`) type-checks without a cast. Blocked because 18A scopes A04 as "New audit branch" and it is not — the enum has four values (`platform.ts:29`) and adding a fifth is a DB migration on a live column.
- **Tests:** T-S2-3, T-AUD-1 · **Pre/mig:** option (a) is an `ALTER TYPE ... ADD VALUE` against test and staging; option (b) is zero migration · **Rollback:** Postgres enum values cannot be dropped in place — option (a) is effectively one-way, which is the reason this is a decision · **Codex:** none.

**IT-S2-06** — Write the refusal audit row with a non-invitee actor
`apps/api/src/routes/public/invites.ts` `apps/api/src/lib/audit.ts` · **Change** edit · **Pkg** A04 · **Scen** 5,6 · **When** blocked · **Approval** none
- **Accept:** A refused consume writes `action: "invite.consume_refused"` and the row's `actor_user_id` is NOT the invitee's `row.userId`. Today `:161-169` names the invitee as actor on the success path only, and a refusal writes nothing at all. Blocked on IT-S2-05 — the actor field cannot be filled until the enum question is settled.
- **Tests:** T-S2-3 · **Pre/mig:** `audit.actions.org_id` is NOT NULL with an FK, so the refusal can only be logged once `metadata.orgId` has resolved; a refusal on malformed metadata stays unlogged and that must be stated in-file · **Rollback:** remove the audit call · **Codex:** none.

**IT-S2-07** — consume malformed_metadata: 410 becomes 400
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A13 · **Scen** 16 · **When** do-now · **Approval** none
- **Accept:** `:180` maps `malformed_metadata` to 400, not 410. Note this contradicts 18D §1.1's annotation "[was 500]" — for `consume` it was 410, because the ternary at `:180` only special-cases `not_found`. Observable: response status 400.
- **Tests:** T-S2-6 · **Pre/mig:** none · **Rollback:** one line · **Codex:** `malformed_metadata` already has mobile copy (`apps/mobile/lib/api/client.dart:132-133`), so no client change is needed.

**IT-S2-08** — peek malformed_metadata: 500 becomes 400
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A13 · **Scen** 16 · **When** do-now · **Approval** none
- **Accept:** `:69` returns 400 rather than 500. This is the line 18D actually described. Observable: `GET /peek?token=…` on a token whose metadata lacks `orgId`/`role`/`email` returns 400.
- **Tests:** T-S2-6 (second case) · **Pre/mig:** none · **Rollback:** one line · **Codex:** peek stops producing a 5xx that alerting would treat as a server fault.

**IT-S2-09** — Extract the consume transaction into a testable repository function
`apps/api/src/repositories/invite-consume.ts` `apps/api/src/routes/public/invites.ts` · **Change** new · **Pkg** A01,A02,A03 · **Scen** 1-12 · **When** do-later · **Approval** none
- **Accept:** A new module exports `consumeOrgInvite(db, { tokenHash, password })` returning the same discriminated union the route builds today, and `invites.ts` becomes parse + call + status map. Observable: `invites.ts` contains no `$transaction` call. Rationale: the whole flow is inline in the handler, so the only way to cover it offline is to fake a Prisma tx object — `apps/api/src/routes/public/register.test.ts:14-20` shows the alternative (mock the repository, test the route thinly), and that pattern needs a repository to mock.
- **Tests:** enables T-S2-1..6 to run offline in the main suite · **Pre/mig:** none · **Rollback:** inline it back · **Codex:** none.

**IT-S2-10** — Add offline route tests for invites.ts
`apps/api/src/routes/public/invites.test.ts` · **Change** test · **Pkg** A01,A03,A13 · **Scen** 11,12,16 · **When** do-later · **Approval** none
- **Accept:** File exists and is picked up by the root suite — `vitest.config.ts:20-24` includes `apps/api/src/**/*.test.ts`, so a test under `src/` runs on `npm test` while anything under `apps/api/test/` does not. Covers: unknown token → 404, `kind !== "invite"` → 404 (not a distinct code), malformed metadata → 400. Depends on IT-S2-09 for a mockable seam. Today `invites.ts` has no unit test of any kind.
- **Tests:** T-S2-6; new IDs for scen 11/12 · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-S2-11** — Anti-deadlock parity test: refusal leaves the invite usable
`apps/api/test/parity/driver-invite-redemption-parity.test.ts` · **Change** test · **Pkg** A08 · **Scen** 2,3 · **When** do-later · **Approval** none
- **Accept:** A permanent case asserting that after a refused consume, `user_tokens.used_at` is NULL and a subsequent legitimate consume by the same invitee returns 200. This is the exact failure mode ADR 0053 hit on the driver side; the equivalent driver case already exists at `:730` ("refuses with 409 already_claimed … and does not overwrite it"). Requires `PARITY_DATABASE_URL`; the file is `describe.skipIf(!hasDb)`.
- **Tests:** T-S2-5 · **Pre/mig:** none; the harness rolls back via `trackUser`/`trackOrg`/`cleanupAll` · **Rollback:** n/a · **Codex:** none.

**IT-S2-12** — Concurrency parity test for the conditional claim
`apps/api/test/parity/driver-invite-redemption-parity.test.ts` · **Change** test · **Pkg** A09 · **Scen** 7,8 · **When** do-later · **Approval** none
- **Accept:** Two concurrent `callConsumeOrgInvite` calls on one token yield exactly one 200 and one 410 `already_used`; `user_credentials` has one row. The CAS is already written (`invites.ts:130-136`) — this proves it under real Postgres rather than asserting the code shape.
- **Tests:** T-S2-4 · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-S2-13** — Assert the hash is byte-identical by reading the column
`apps/api/test/parity/driver-invite-redemption-parity.test.ts` `apps/api/src/lib/password.ts` · **Change** test · **Pkg** A01 · **Scen** 1 · **When** do-later · **Approval** none
- **Accept:** The refusal test captures `user_credentials.password_hash` before and after and compares the two strings. It must NOT re-run `hashPassword` and compare: the stored format is `pbkdf2:sha256:<iter>:<salt>:<hash>` with a fresh random salt per call (`apps/api/src/lib/password.ts`), so re-hashing the same password never reproduces the stored string and the assertion would fail even when nothing was overwritten.
- **Tests:** T-S2-1 · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-S2-14** — Rate-limit POST /consume and GET /peek
`apps/api/src/routes/public/invites.ts` `apps/api/src/lib/rate-limit.ts` `apps/api/src/bindings.ts` · **Change** edit · **Pkg** A01 · **Scen** 11,12 · **When** do-now · **Approval** none
- **Accept:** `publicInvites` registers `rateLimit(...)` on both routes. Today it registers no middleware at all, so `POST /consume` and `GET /peek` are unthrottled token oracles — the only two bindings that exist are `ADMIN_LOGIN_RATE_LIMITER` and `DRIVER_LOGIN_RATE_LIMITER` (`bindings.ts:95-100`). Observable: an 11th request inside 60s returns 429 with a `Retry-After` header. Note the limiter **fails open** when the binding is absent (`rate-limit.ts:121-129`), so this is defence in production only, not in tests.
- **Tests:** new; T-RL-failclosed is a separate, contradictory item — see the notes · **Pre/mig:** reuses an existing binding; no wrangler change if `ADMIN_LOGIN_RATE_LIMITER` is chosen · **Rollback:** remove the middleware · **Codex:** clients must handle 429 on the invite screens, which they do not today.

**IT-S2-15** — Detection signal for a credential overwrite
`apps/api/src/lib/audit.ts` · **Change** decision · **Pkg** A05 · **Scen** 17 · **When** blocked · **Approval** Andri
- **Accept:** A named sink exists for the signal. Blocked: there is no metrics surface in the worker — `apps/api/src/bindings.ts` declares no Analytics Engine, no queue and no logging binding beyond the two rate limiters, and `apps/api/src/lib/` contains no metrics module. So A05 cannot "ship without D-01" as 18A claims; the only zero-infrastructure option is an audit row plus a manual query, which is not an alert. Decision needed: add a binding, or downgrade A05 to a documented query.
- **Tests:** T-OBS-1 (beta) · **Pre/mig:** a new binding is a `wrangler.jsonc` change and a deploy · **Rollback:** remove the binding · **Codex:** none.

**IT-S2-16** — Offline check that upsert cannot return to the password write paths
`scripts/check-all.mjs` `scripts/check-password-write-paths.mjs` · **Change** ci · **Pkg** A02 · **Scen** 18 · **When** do-later · **Approval** none
- **Accept:** A tenth entry in the `CHECKS` array at `scripts/check-all.mjs:14` fails when `userCredential.upsert` or `onConflictDoUpdate` on `userCredentials` appears outside an allowlist. This is the only enforcement layer available: `.github/workflows/check.yml` runs `npm install`, `npm run db:generate`, `npm run check` and nothing else — **no vitest suite runs in CI at all**, so "a test guards this" is not a rollback story on this repo.
- **Tests:** the check is its own test; `scripts/check-schema-consistency.test.mjs` is the precedent for testing a check script · **Pre/mig:** none · **Rollback:** remove the array entry · **Codex:** none.

**IT-S2-17** — Record why password-reset/confirm is exempt from the S2 guard
`apps/api/src/routes/public/password-reset.ts` `docs/domain/onboarding/13-decision-packet.md` · **Change** decision · **Pkg** A01 · **Scen** 9,10 · **When** do-now · **Approval** none
- **Accept:** An in-file comment at `password-reset.ts:90` states that `POST /confirm/:token` deliberately has no credential-existence guard because overwriting an existing password is its entire purpose, and that D-01 answers the opposite question for `consume`. Without this, the next reviewer reads the two files as inconsistent and "fixes" the reset path. Observable: the comment exists and names D-01.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-S2-18** — Document consume's three jobs in-file
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A14 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** The header at `:1-24` enumerates the three state changes the route makes in one transaction — sets a password, activates a membership, stamps `emailVerifiedAt` — and says which of the three the token actually authorises. Today the header describes the mechanics but frames all three as one act, which is how the overwrite got written.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

---

## CMP — Invite claim/join compatibility (16)

Partly hardening, mostly measurement that has never existed. Two invite surfaces run
in parallel: the bearer-only org path (`invites.ts` `POST /consume`) and the driver path
(`driver.ts` `/claim-invite` `:1029` + `/redeem-invite` `:1158`), the latter already
identity-bound and already covered by a real-DB parity suite. The packet's compatibility
story assumes a measured client population; there is none — **no client-version header
exists anywhere**, in the API or in the Flutter client. And the compatibility break the
packet has not noticed is larger than the ones it lists: the mobile app posts host-minted
driver codes to the org route, which cannot resolve them.

**IT-CMP-01** — Record the cross-route break: mobile driver codes hit the org route
`apps/mobile/lib/api/client.dart` `apps/api/src/routes/public/invites.ts` `apps/api/src/repositories/host-invites.ts` · **Change** decision · **Pkg** B02,B08 · **Scen** 20,21 · **When** do-now · **Approval** Andri
- **Accept:** A written finding that `consumeInvite` (`client.dart:93-107`) posts to `/api/public/invites/consume`, that the route resolves only `kind === "invite"` (`invites.ts:111`), and that `createDriverInvite` mints `kind: "driver"` (`host-invites.ts:189`) with `inviteUrl: "/invite/{code}"`. Therefore a host-minted driver code entered in the app's redeem screen returns 404 `not_found` today — before any S2 change. Observable: the finding names all three line numbers and states which of the twelve endpoints in `client.dart` is involved (exactly one).
- **Tests:** T-COMPAT-1 · **Pre/mig:** none · **Rollback:** n/a · **Codex:** determines whether the fix is client-side (call `/claim-invite` then `/redeem-invite`) or server-side (dispatch by kind).

**IT-CMP-02** — Decide: route mobile to the driver pair, or teach consume to dispatch by kind
`apps/mobile/lib/api/client.dart` `apps/api/src/routes/public/invites.ts` · **Change** decision · **Pkg** B02 · **Scen** 20,26 · **When** blocked · **Approval** Andri
- **Accept:** One of two recorded choices. (a) Client change: `redeem_invite.dart` calls `POST /api/driver/claim-invite` then logs in then `POST /api/driver/redeem-invite`, matching the loop the parity test at `driver-invite-redemption-parity.test.ts:757` already proves end to end. (b) Server change: `consume` branches on `row.kind` and delegates driver tokens. Blocked on IT-CMP-01. Note (b) reintroduces a bearer-only path for driver codes and undoes ADR 0053's identity binding, which is why it needs Andri.
- **Tests:** T-COMPAT-1, T-SEC-1c · **Pre/mig:** (a) ships a new app build; (b) is a server deploy · **Rollback:** (a) cannot be rolled back for installed clients · **Codex:** (a) is entirely a Codex/Flutter task once the decision lands.

**IT-CMP-03** — Add a client-version request header
`apps/mobile/lib/api/client.dart` · **Change** new · **Pkg** B09 · **Scen** 24 · **When** do-now · **Approval** none
- **Accept:** Every request built in `client.dart` carries `x-straumvakt-client: <platform>/<version>`. Today the file sets only `content-type` and `_authHeaders`; a repo-wide grep for `x-client`, `clientVersion` and `client-version` across `apps/api/src` returns zero hits, and the only `user-agent` reads are in the OCPP discovery paths (`routes/internal/ocpp-auth.ts:107`, `routes/internal/pending-discovery.ts:78`). Observable: header present on all twelve endpoints.
- **Tests:** new client test · **Pre/mig:** none · **Rollback:** n/a for shipped builds · **Codex:** this is a Codex-side change; the server task below depends on it.

**IT-CMP-04** — Parse and record the client-version header server-side
`apps/api/src/routes/public/invites.ts` `apps/api/src/routes/public/driver.ts` · **Change** edit · **Pkg** B09 · **Scen** 24,27 · **When** blocked · **Approval** none
- **Accept:** The invite routes read the header and include it in the audit `metadata` of the outcome row. Blocked on IT-CMP-03 — until clients send it there is nothing to parse, and blocked again on IT-S2-15's finding that there is no metrics sink, so audit metadata is the only durable place a version can land today.
- **Tests:** T-OBS-2 · **Pre/mig:** none; `audit.actions.metadata` is JSONB · **Rollback:** remove the field · **Codex:** none.

**IT-CMP-05** — Deprecation counter per legacy route and client version
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** B10 · **Scen** 27 · **When** blocked · **Approval** none
- **Accept:** Legacy `consume` calls are countable per client version. Blocked twice: on IT-CMP-03 for the version, and on IT-S2-15 for a sink — an audit row per call is not a counter, and `audit.actions` is a tenant-scoped table with an FK-bound NOT NULL `org_id`, so calls that fail before metadata resolves cannot be counted there at all.
- **Tests:** T-OBS-3 · **Pre/mig:** none until a sink is chosen · **Rollback:** n/a · **Codex:** none.

**IT-CMP-06** — Write the adoption-gate query as a specification
`docs/domain/onboarding/` (new note) · **Change** new · **Pkg** B11 · **Scen** 28,29 · **When** blocked · **Approval** none
- **Accept:** A query spec that, given the IT-CMP-05 counter, computes "legacy share below 1% for 14 consecutive days". Blocked on IT-CMP-05. The task is worth writing in its blocked state because it fixes what the counter must record (route, version, day bucket) before the counter is built, rather than after.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-CMP-07** — Capability advertisement endpoint
`apps/api/src/routes/public/capabilities.ts` `apps/api/src/index.ts` · **Change** new · **Pkg** B08 · **Scen** 25,26 · **When** do-later · **Approval** none
- **Accept:** `GET /api/public/capabilities` returns the join methods the server supports. It must report reality, not aspiration: today the honest answer is `["consume","claim-invite","redeem-invite"]` — `POST /api/driver/join` does not exist, and `apps/api/src/routes/public/` contains exactly eight files, none named `join.ts`. Observable: the response array contains no method that has no route.
- **Tests:** T-COMPAT-2 · **Pre/mig:** new mount line in `index.ts` alongside `:206`/`:220`/`:240` · **Rollback:** unmount the route · **Codex:** lets a new client pick a path instead of probing for 404s.

**IT-CMP-08** — Cross-route invariant test: a refused attempt never burns the invite
`apps/api/test/parity/driver-invite-redemption-parity.test.ts` · **Change** test · **Pkg** B05,A08 · **Scen** 2,35 · **When** do-later · **Approval** none
- **Accept:** One parameterised case asserting `used_at IS NULL` after a refusal on each of the three surfaces. The driver side already holds: `/redeem-invite` checks identity at `:1207` before the claim at `:1254`, and `/claim-invite` never claims at all (its header at `:1015` says so). Only `consume` violates it, and only until IT-S2-01 lands. Observable: three assertions, one currently red.
- **Tests:** T-S2-5, T-SEC-1b · **Pre/mig:** requires `PARITY_DATABASE_URL` against the test branch · **Rollback:** n/a · **Codex:** none.

**IT-CMP-09** — Align error codes across the three invite surfaces
`apps/api/src/routes/public/invites.ts` `apps/api/src/routes/public/driver.ts` · **Change** edit · **Pkg** B05 · **Scen** 39,40 · **When** do-later · **Approval** Andri
- **Accept:** A written table of which code each surface may return, and the routes match it. Today they diverge: `consume` emits `not_found`/`already_used`/`expired`/`validation`; the driver pair adds `security_unsupported` (409, `driver.ts:1132`) and `already_claimed` (409, `driver.ts:1138`), and `/redeem-invite` returns `malformed` with a **500** at `driver.ts:1297` for a token with no driver group — a server status for a data fault, the same class of error IT-S2-07 fixes on the other route. Needs Andri because collapsing codes changes a public contract.
- **Tests:** T-ABUSE-6b · **Pre/mig:** none · **Rollback:** revert the status map · **Codex:** a single error vocabulary the clients can switch on.

**IT-CMP-10** — Mobile copy for already_claimed
`apps/mobile/lib/api/client.dart` · **Change** edit · **Pkg** A06 · **Scen** 1 · **When** do-later · **Approval** none
- **Accept:** `_inviteErrorMessage` (`client.dart:122-137`) gains an `already_claimed` case. Today the switch covers `not_found`, `already_used`, `expired`, `validation`, `malformed_metadata` and falls through to `'Could not redeem invite ($code).'` — so the moment IT-S2-04 ships, shipped builds render the literal string "Could not redeem invite (already_claimed)." to drivers. Observable: that string cannot be produced for this code.
- **Tests:** UI snapshot · **Pre/mig:** none · **Rollback:** n/a for shipped builds · **Codex:** Codex owns this file.

**IT-CMP-11** — Web copy for already_claimed, and mark the form as archived
`archive/straumvakt-org-console-2026-08-08/app/invite/[token]/accept-form.tsx` · **Change** decision · **Pkg** A07 · **Scen** 19 · **When** do-now · **Approval** none
- **Accept:** A recorded statement that A07 has no deployed target. The form exists only under `archive/`, posts `{token,password}` (`accept-form.tsx:52`), branches on `expired`/`already_used`/`not_found` and would render `already_claimed` as a raw `HTTP 409`. There is no live `/invite/[token]` route: `src/app/` contains `home`, `org`, `staff`, `layout.tsx`, `page.tsx` and assets — nothing else. Scenario 19 therefore tests a page that is not served.
- **Tests:** none until a page exists · **Pre/mig:** none · **Rollback:** n/a · **Codex:** tells Codex not to spend a cycle on a dead form.

**IT-CMP-12** — Fix or retire the invite deep link that points at no page
`apps/api/src/repositories/host-invites.ts` `apps/api/src/routes/admin/org-invites.ts` · **Change** decision · **Pkg** B08 · **Scen** 19,22 · **When** do-now · **Approval** Andri
- **Accept:** Either an `/invite/[token]` route exists under `src/app/`, or both link builders stop emitting one. `createDriverInvite` returns `inviteUrl: "/invite/{code}"` (`host-invites.ts:231`) and the org-invite mail builds `{origin}/invite/{plaintext}` — both currently land on a 404. Observable: every URL any invite path emits resolves to a served route.
- **Tests:** T-COMPAT-1 · **Pre/mig:** none · **Rollback:** revert the string · **Codex:** if a page is chosen, Codex builds it and the archived form is the starting point.

**IT-CMP-13** — Rate-limit the two unthrottled invite entry points
`apps/api/src/routes/public/driver.ts` · **Change** edit · **Pkg** B05 · **Scen** 11,12 · **When** do-now · **Approval** none
- **Accept:** `POST /redeem-invite` (`:1158`) carries a `rateLimit` middleware. It is the asymmetric case: `/claim-invite` is limited at `:1031-1036` with `DRIVER_LOGIN_RATE_LIMITER`, `/redeem-invite` takes none, and `consume`/`peek` take none (IT-S2-14). Observable: all invite-adjacent POSTs return 429 past their limit.
- **Tests:** new · **Pre/mig:** reuses `DRIVER_LOGIN_RATE_LIMITER`; no wrangler change · **Rollback:** remove the middleware · **Codex:** clients need a 429 branch on the redeem screen.

**IT-CMP-14** — Identity-bind consume behind the adoption gate
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** B12 · **Scen** 21,23 · **When** blocked · **Approval** Andri
- **Accept:** `consume` requires a session and compares the bound `row.userId` to the caller, returning the byte-identical `not_found` shape on mismatch — the pattern at `driver.ts:1207-1229`. Blocked on IT-CMP-06's gate: this change breaks every currently-shipped client, since `client.dart:99-105` sends no `Authorization` header on this call. Scenario 23 is explicitly "failing by design"; the acceptance criterion is that it is only attempted after the gate is satisfiable, not that it passes.
- **Tests:** T-SEC-1b, T-COMPAT-3 · **Pre/mig:** none · **Rollback:** remove the session requirement · **Codex:** requires the app to log in before redeeming, which is a flow change, not a copy change.

**IT-CMP-15** — Retire POST /api/public/invites/consume
`apps/api/src/index.ts` `apps/api/src/routes/public/invites.ts` · **Change** delete · **Pkg** B13 · **Scen** 30 · **When** blocked · **Approval** Andri
- **Accept:** The mount at `index.ts:206` is gone and the route 404s. Blocked on IT-CMP-14 and on the gate; also blocked on IT-CMP-02, because if the mobile app keeps posting driver codes here, retiring the route removes the only invite surface an installed build can reach.
- **Tests:** T-COMPAT-3 · **Pre/mig:** any unconsumed `kind='invite'` token becomes unredeemable at the moment of removal — the blast radius is a DB read, not a guess · **Rollback:** re-add the mount line · **Codex:** none.

**IT-CMP-16** — Placeholder invitee status: do not flip it without the claim check
`apps/api/src/repositories/host-invites.ts` `apps/api/src/routes/public/driver.ts` `prisma/schema/identity.prisma` · **Change** decision · **Pkg** B14 · **Scen** 32,33 · **When** blocked · **Approval** DBA
- **Accept:** A recorded decision on how a placeholder invitee is distinguished. B14 asks for `status:"invited"`, which is not a value `UserStatus` has — the enum is `active | suspended | deleted` (`identity.prisma:133-139`). `createDriverInvite` writes `status: "active"` (`host-invites.ts:181`) and `/claim-invite` rejects anything not `"active"` (`driver.ts:1092`), so adding the value and using it without touching that check breaks the claim path in the same commit. Options: enum migration plus a matching edit at `:1092`, or mark placeholders by `passwordHash IS NULL` instead, which needs no migration.
- **Tests:** T-DRV-1 · **Pre/mig:** the enum option is `ALTER TYPE ... ADD VALUE` on a live column and is not reversible in place · **Rollback:** the no-migration option is fully reversible · **Codex:** none.

---

## KEN — Kennitala and identity binding at redemption (11)

Hardening with a shipped-client trap. `ConsumeBody` (`invites.ts:36-39`) is a plain
`z.object` of `{token, password}`; the Flutter client posts a third field, `kennitala`
(`client.dart:101-105`), and zod silently drops it. The app's own comment says the
backend captures it (`client.dart:88-90`) and its UI validates ten digits and labels the
field (`redeem_invite.dart:230-245`, `i18n/strings.dart:74-75,94-95`) — so the app tells
the driver an identity check happens that does not. That is D-02's subject.

**IT-KEN-01** — Prove the field is dropped and record the blast radius
`apps/api/src/routes/public/invites.ts` `apps/mobile/lib/api/client.dart` · **Change** test · **Pkg** A10,A11 · **Scen** 13 · **When** do-now · **Approval** none
- **Accept:** A test posts `{token, password, kennitala}` to consume and asserts 200 with `kennitala` absent from every write. Contrast with `RegisterBody` (`register.ts:41-56`), which **is** `.strict()` and **requires** a ten-digit kennitala — the two public onboarding entry points disagree about the same field, and only one of them is honest about it.
- **Tests:** T-SEC-3a · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-KEN-02** — Decide D-02: verify, drop, or keep silently ignoring
`docs/domain/onboarding/13-decision-packet.md` · **Change** decision · **Pkg** A11 · **Scen** 13,14,15 · **When** do-now · **Approval** Andri
- **Accept:** One of three recorded outcomes, with the loser options struck out. The packet recommends "verify it against the invited user" (`13-decision-packet.md:25-35`). Note before choosing: `User.kennitala` is `String? @unique` (`identity.prisma:25`) and `createInvite` (`apps/api/src/repositories/invites.ts:99-106`) creates the invitee with **email and audience only** — no kennitala — so for every org invite the stored value is NULL and there is nothing to verify against on first use.
- **Tests:** T-SEC-3a, T-SEC-3b · **Pre/mig:** none · **Rollback:** n/a · **Codex:** decides whether the app keeps the field at all.

**IT-KEN-03** — Option A: make ConsumeBody strict
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A10 · **Scen** 13,23 · **When** blocked · **Approval** Andri
- **Accept:** `ConsumeBody` at `:36` ends in `.strict()` and an unknown field returns 400 `validation`. Blocked on IT-KEN-02, and it is the option with the worst blast radius: it 400s **every** redemption from every installed build, because the client always sends `kennitala` (`client.dart:101-105`, non-optional parameter at `:95`). This is scenario 23, and it lands on shipped clients, not archived ones.
- **Tests:** T-SEC-3a · **Pre/mig:** none · **Rollback:** delete `.strict()`; installed clients recover immediately · **Codex:** would require a new app build before the server change, not after.

**IT-KEN-04** — Option A-minus: strict with kennitala allowlisted and ignored
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A10 · **Scen** 13 · **When** blocked · **Approval** none
- **Accept:** The schema declares `kennitala: z.string().optional()` and is `.strict()`, so unknown fields 400 but the one field the shipped client sends does not. Observable: `{token,password,kennitala}` → 200; `{token,password,junk}` → 400. Blocked on IT-KEN-02. This is the only strictness option that does not need a client release first.
- **Tests:** T-SEC-3a · **Pre/mig:** none · **Rollback:** one line · **Codex:** none — the app is unchanged.

**IT-KEN-05** — Option B: verify against the invited user, trust-on-first-use
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A11 · **Scen** 14,15 · **When** blocked · **Approval** Andri
- **Accept:** When `User.kennitala` is non-NULL, a mismatch fails with the same generic shape as an unknown token; when NULL, the submitted value is stored on the user in the same transaction. Blocked on IT-KEN-02. The NULL branch is unavoidable for org invites — see IT-KEN-02 — so "verify" in practice means "capture on first use, verify thereafter", and that distinction must be written into the decision rather than discovered later.
- **Tests:** T-SEC-3b · **Pre/mig:** writes to `identity.users.kennitala`, which carries a UNIQUE index; a collision must be handled, not thrown · **Rollback:** stop verifying; captured values stay · **Codex:** the app's "we check this" copy becomes true.

**IT-KEN-06** — Handle the unique-collision case on capture
`apps/api/src/routes/public/invites.ts` `prisma/schema/identity.prisma` · **Change** edit · **Pkg** A11 · **Scen** 15 · **When** blocked · **Approval** none
- **Accept:** Two different invited users submitting the same kennitala produce a defined outcome, not a raw Postgres 23505 surfacing as a 500. `User.kennitala` is `@unique` (`identity.prisma:25`), and `registerDriver` already has a modelled answer for this — it pre-checks and returns `kennitala_taken` (`apps/api/src/repositories/registration.ts:147-151`). Blocked on IT-KEN-05. Observable: the response is a 4xx with a defined code.
- **Tests:** T-SEC-3b · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-KEN-07** — Mismatch must be indistinguishable from an unknown token
`apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A11 · **Scen** 15 · **When** blocked · **Approval** none
- **Accept:** The mismatch response is byte-identical to the unknown-token response — same status, same body, no timing branch that returns early before the hash comparison. The precedent is `driver.ts:1207-1228`, which returns `not_found` for an identity mismatch and records the real reason only in audit; the parity suite already asserts byte-identity for that route (`driver-invite-redemption-parity.test.ts:547`). Blocked on IT-KEN-05.
- **Tests:** T-SEC-3b, T-ABUSE-6b · **Pre/mig:** none · **Rollback:** n/a · **Codex:** the client cannot tell the driver *which* field was wrong, which is intended.

**IT-KEN-08** — Audit the kennitala mismatch without storing the submitted value
`apps/api/src/lib/audit.ts` `apps/api/src/routes/public/invites.ts` · **Change** edit · **Pkg** A11,A04 · **Scen** 15 · **When** blocked · **Approval** Andri
- **Accept:** The refusal audit records that a kennitala mismatch occurred and does **not** put the submitted digits in `metadata`. A kennitala is personal data and `audit.actions.metadata` is a JSONB column with no redaction layer. Observable: the metadata object contains a boolean or a reason string, no ten-digit value. Blocked on IT-KEN-05 and on IT-S2-05's actorKind question.
- **Tests:** T-S2-3 · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-KEN-09** — Option C: remove the field from the client
`apps/mobile/lib/api/client.dart` `apps/mobile/lib/screens/redeem_invite.dart` `apps/mobile/lib/i18n/strings.dart` · **Change** edit · **Pkg** A11 · **Scen** 13 · **When** blocked · **Approval** Andri
- **Accept:** `consumeInvite` drops the `kennitala` parameter, the form field and its four i18n strings go, and `apps/mobile/lib/api/types.dart:159`'s comment stops claiming the app "sends them up". Blocked on IT-KEN-02. Cheapest option, and it makes IT-KEN-03 safe on the next release — but it discards a signal the driver is already typing.
- **Tests:** UI snapshot · **Pre/mig:** none · **Rollback:** n/a for shipped builds · **Codex:** Codex owns all three files.

**IT-KEN-10** — Correct the mobile contract-test claim
`apps/mobile/test/` · **Change** test · **Pkg** A12 · **Scen** 13 · **When** do-now · **Approval** none
- **Accept:** A12 says "rename the mobile contract test because it falsely asserts identity serialization". There is no such test to rename: `apps/mobile/test/` contains exactly one file, `widget_test.dart`, and `apps/mobile/test/api/` does not exist. The task is therefore to **write** `apps/mobile/test/api/client_contract_test.dart` asserting the real posted body for whichever of IT-KEN-03/04/05/09 is chosen. Observable: the file exists and its assertion matches `client.dart`'s actual `jsonEncode` payload.
- **Tests:** T-SEC-3b · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** Codex writes it.

**IT-KEN-11** — Make register and consume agree on kennitala in one place
`apps/api/src/routes/public/register.ts` `apps/api/src/routes/public/invites.ts` `packages/shared/src/inputs` · **Change** decision · **Pkg** A10,A11 · **Scen** 13,14 · **When** do-later · **Approval** none
- **Accept:** One shared zod fragment defines the kennitala rule and both routes import it, or a comment in each route states why they deliberately differ. Today `register.ts:45` enforces `/^\d{10}$/` and rejects the request without it, while `consume` ignores the field entirely — the same identity concept with two contradictory contracts on the same public API.
- **Tests:** T-SEC-3a · **Pre/mig:** none · **Rollback:** inline the rule again · **Codex:** one validation rule for both screens.

---

## PROV — Permission provenance refactor (18)

Hardening of a live system, not a stub: `requirePermission` is wired at 163 non-comment
call sites across 38 route files (per 19A §A03). The defect is narrow and structural —
`resolveEffectivePermissions` (`effective-permissions.ts:154`) returns a flat
`Permission[]`, so by the time any caller sees the answer it can no longer tell whether a
verb came from a membership in *this* org or from a platform grant that applies to *every*
org. Provenance is destroyed at two distinct points, and one of them silently gives
`sales_cs` member-management rights in every tenant. Note the packet's premise about
support context is right that C01 is greenfield, but the tasks below are only about
provenance — they are the prerequisite that makes any context guard enforceable.

**IT-PROV-01** — Return a provenance-tagged permission set from the resolver
`apps/api/src/lib/auth/effective-permissions.ts` · **Change** edit · **Pkg** C02,C03,D10 · **Scen** 52,63,64 · **When** do-now · **Approval** none
- **Accept:** `resolveEffectivePermissions` returns entries carrying a source discriminant (`"membership"` or `"platform"`), not bare strings. Observable: the function's return type is no longer `Promise<Permission[]>` and `hasPermission` (`permissions.ts:354`) can no longer be called on the result without a projection. That compile error at every call site is the point — it is what forces each of the 163 gates to be looked at.
- **Tests:** `apps/api/src/lib/auth/effective-permissions.test.ts` — all 13 `expandPermissionsSync` cases · **Pre/mig:** none, pure in-memory · **Rollback:** revert the type; no data touched · **Codex:** none yet.

**IT-PROV-02** — Stop merging membership and platform verbs into one seen-set
`apps/api/src/lib/auth/permissions.ts` · **Change** edit · **Pkg** C03,D10 · **Scen** 52,67 · **When** do-now · **Approval** none
- **Accept:** `effectivePermissions` (`:324-348`) no longer uses a single `seen: Set<Permission>` across both loops. Today a verb present in both bundles is emitted once with no record of which loop produced it, so a dual-role user (org member *and* platform staff) is indistinguishable from a platform-only user for every overlapping verb — which is exactly scenario 52. Observable: the function returns two lists, or one list of tagged entries, and a `{role:"admin"}` + `{role:"support_agent"}` input yields `org.read` twice, once per source.
- **Tests:** `permissions.test.ts`; `effective-permissions.test.ts:73-114` (the combined-source cases) · **Pre/mig:** none · **Rollback:** restore the single set · **Codex:** none.

**IT-PROV-03** — Tag the verbs expandPlatformTenantVerbs injects
`apps/api/src/lib/auth/effective-permissions.ts` · **Change** edit · **Pkg** C02,C03 · **Scen** 52,63,64 · **When** do-now · **Approval** none
- **Accept:** Every verb added inside `expandPlatformTenantVerbs` (`:103-139`) is marked platform-derived. Today the function takes `Permission[]`, adds `READS`/`WRITES`/`DELETES` into a plain `Set` and returns `Array.from(set)` at `:138`, so a per-tenant verb minted from a platform grant is byte-identical to one earned by membership. This is the second and larger provenance loss — the first only merges, this one manufactures.
- **Tests:** `effective-permissions.test.ts:40-71` (platform_admin, sales_cs, super_user expansions) · **Pre/mig:** none · **Rollback:** revert to the flat set · **Codex:** none.

**IT-PROV-04** — Rewrite requirePermission against the tagged set
`apps/api/src/lib/auth/require-permission.ts` · **Change** edit · **Pkg** C02 · **Scen** 47,63,64 · **When** do-now · **Approval** none
- **Accept:** `:76` no longer reads `perms.includes(verb)`; it inspects the matching entry and can answer "how did this caller get this verb". Observable: the middleware can return a distinct denial reason for platform-derived access without a second DB query.
- **Tests:** `require-permission.test.ts` · **Pre/mig:** none · **Rollback:** revert to `.includes` · **Codex:** a distinguishable 403 reason becomes available.

**IT-PROV-05** — Rewrite assertPermission against the tagged set
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/routes/admin/access-requests.ts` · **Change** edit · **Pkg** C02 · **Scen** 50,64 · **When** do-now · **Approval** none
- **Accept:** `assertPermission` (`:106-134`) applies the identical rule as `requirePermission`, and the two live call sites (`access-requests.ts:90` and `:178`, both `member.write`) go through it. This is the second enforcement seam: `assertPermission` duplicates the whole session/userId/resolve/deny sequence, so any rule added only to the middleware factory leaves the approve and deny paths of the driver-access-request flow ungoverned.
- **Tests:** `apps/api/test/parity/driver-access-request-flow.test.ts` · **Pre/mig:** none · **Rollback:** revert both functions together · **Codex:** none.

**IT-PROV-06** — Extract the shared decision so the two seams cannot drift
`apps/api/src/lib/auth/require-permission.ts` · **Change** edit · **Pkg** C02 · **Scen** 47,50 · **When** do-later · **Approval** none
- **Accept:** One exported function decides allow/deny; `requirePermission` and `assertPermission` both call it and contain no independent copy of the session-shape, userId or provenance logic. Observable: the string `"session_missing_user_id"` appears once in the file, not at both `:66` and `:121`.
- **Tests:** `require-permission.test.ts` · **Pre/mig:** none · **Rollback:** re-inline · **Codex:** none.

**IT-PROV-07** — Any new guard must sit before the bootstrap early return
`apps/api/src/lib/auth/require-permission.ts` · **Change** edit · **Pkg** C02 · **Scen** 47,63 · **When** do-now · **Approval** Andri
- **Accept:** The `isBootstrapSession` early returns at `:55-59` and `:115-117` either move below any provenance check, or are deleted. Both fire on `sub === "admin"` AND no `userId` (`:147-151`) and call `next()` / return `null` with **no permission check at all**. The login route now always stamps `userId` (`routes/admin/auth.ts:134-137`), so fresh cookies take the real path — but a guard added anywhere after these lines is bypassed by any session of that shape, and the cookie is a 12h HMAC with no revocation path (`lib/admin-session.ts`).
- **Tests:** `require-permission.test.ts:67-93` exercises a session shape production no longer mints and will need rewriting · **Pre/mig:** none · **Rollback:** restore the early return · **Codex:** none.

**IT-PROV-08** — Decide the fate of the bootstrap god-mode branch
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/repositories/admin-bootstrap.ts` · **Change** decision · **Pkg** C02,C03 · **Scen** 63,74 · **When** do-now · **Approval** Andri
- **Accept:** A recorded decision to keep or delete the branch. Deleting it is safe on the evidence: `bootstrapAdminUser` (`admin-bootstrap.ts:46-105`) creates a `super_user` PlatformGrant, so the bootstrap admin passes through the ordinary DB path anyway. Keeping it means keeping a permanent unchecked path that any future guard sits behind. Observable: the decision names which, and the code matches.
- **Tests:** `apps/api/test/parity/admin-bootstrap.test.ts` · **Pre/mig:** none · **Rollback:** total, it is a conditional · **Codex:** none.

**IT-PROV-09** — Carve member.* out of the platform.tenant.write expansion
`apps/api/src/lib/auth/effective-permissions.ts` · **Change** edit · **Pkg** C03,D02 · **Scen** 64,65 · **When** do-now · **Approval** Andri
- **Accept:** `member.invite`, `member.write` and `member.remove` are no longer in the `WRITES` list at `:111-120`. Today they are, so **every** holder of `platform.tenant.write` — `super_user`, `platform_admin` and `sales_cs` — can invite, edit and remove members in every organisation. The file's own comment at `:96-101` proposed this carve-out and deferred it from Sprint 4.3. Observable: `expandPermissionsSync(null, {role:"sales_cs"})` no longer contains any `member.` verb.
- **Tests:** `effective-permissions.test.ts:55-63` (the sales_cs case) will need updating in the same commit · **Pre/mig:** none in the DB, but it removes access that platform staff have today · **Rollback:** re-add the three entries · **Codex:** staff tooling that assumed cross-tenant member management stops working.

**IT-PROV-10** — Fix or remove the sales_cs platform.tenant.write grant
`apps/api/src/lib/auth/permissions.ts` · **Change** decision · **Pkg** D01,C03 · **Scen** 64 · **When** do-now · **Approval** Andri
- **Accept:** Either `sales_cs` loses `platform.tenant.write` at `:268`, or the comment on that line stops claiming a restriction that does not exist. The comment reads "column-restricted in repo layer (org notes/tags only)" — there is no such restriction anywhere; `expandPlatformTenantVerbs` hands `sales_cs` `member.remove`, `charger.remote_start`, `charger.remote_stop`, `charger.config`, `billing.write`, `tariff.write`, `contract.write` and `org.write` in every org. Observable: the claim in the comment is either enforced in code or deleted.
- **Tests:** `effective-permissions.test.ts:55` · **Pre/mig:** none · **Rollback:** restore the verb · **Codex:** none.

**IT-PROV-11** — Delete platform.impersonate in one commit
`apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/permissions.test.ts` · **Change** delete · **Pkg** D01 · **Scen** 71,72,73,74 · **When** do-now · **Approval** Andri
- **Accept:** The verb is absent from `PLATFORM_PERMISSIONS` (`:82`), from `platform_admin` (`:249`) and from `support_agent` (`:261`), and `permissions.test.ts:192` no longer asserts `support_agent` has it. `super_user` picks it up only via the spread at `:243`, so removing the catalogue entry removes it there automatically. It guards **zero** routes — a repo-wide search finds it only in the catalogue and its own test. All four edits must land together or the exhaustive bundle test fails.
- **Tests:** T-SC-6, `permissions.test.ts` · **Pre/mig:** none; the verb is never persisted, only computed · **Rollback:** re-add the four references · **Codex:** none.

**IT-PROV-12** — Wire or delete platform.support.action
`apps/api/src/lib/auth/permissions.ts` · **Change** decision · **Pkg** C12,D01 · **Scen** 59,71 · **When** blocked · **Approval** Andri
- **Accept:** The verb has a call site or it is gone. Like `impersonate`, it is declared (`:83`) and bundled into `support_agent` (`:262`) and guards nothing. Blocked: its intended first call site is the support-context enter endpoint (C07), and `SupportContext` does not exist in any form — no table, no module, no column, no migration. So the honest state today is "declared, unenforced, and its consumer is greenfield".
- **Tests:** T-SC-1 once C07 exists · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-PROV-13** — Resolve tariff.write and contract.write
`apps/api/src/lib/auth/permissions.ts` · **Change** decision · **Pkg** D05 · **Scen** 65,66 · **When** blocked · **Approval** Andri
- **Accept:** Both verbs guard a route or are removed from `ADMIN_BUNDLE` (`:152-153`) and `FINANCE_BUNDLE` (`:174`). Both currently guard zero routes. Blocked on Group K, which the inventory establishes is **greenfield, not hardening**: no agreement write surface exists anywhere in `apps/api/src`, `apps/api/src/repositories/agreements.ts` declares itself read-only, and the only writer is a one-off script. These verbs get their first call site when that surface is built, or never.
- **Tests:** T-PERM-inventory · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-PROV-14** — Give org-scope resolution the same provenance rule
`apps/api/src/lib/auth/org-scope.ts` · **Change** edit · **Pkg** C03,C06 · **Scen** 50,63,64 · **When** do-later · **Approval** none
- **Accept:** `resolveOrgScope` (`:38-63`) uses the tagged resolver rather than calling `expandPermissionsSync(null, {role})` at `:54` and testing for `platform.tenant.read`. This is the third site that reasons about provenance and the only one that already models it correctly at the data layer — it returns `{all:true}` for platform staff and `{all:false, orgIds:[...]}` for members. The refactor should converge the two rather than leave a second definition of "platform-derived" in the tree. Note this module has **no test file** — it is the only module in `lib/auth/` without one.
- **Tests:** new `org-scope.test.ts` · **Pre/mig:** none · **Rollback:** revert · **Codex:** none.

**IT-PROV-15** — Audit the 85 gates that name a tenant verb with no orgIdParam
`apps/api/src/routes` `apps/api/src/domains` · **Change** decision · **Pkg** C03,D10 · **Scen** 52,64 · **When** do-now · **Approval** Andri
- **Accept:** A list of every `requirePermission` call site that names a per-tenant verb and passes no `orgIdParam`, each marked "deliberate cross-tenant surface" or "bug". This is the finding that decides whether C03 is even expressible: with no `orgIdParam`, `require-permission.ts:69-71` sets `orgId = null`, `effective-permissions.ts:160` skips `getActiveMembership` entirely, and the gate is satisfiable **only** through the platform expansion — so on those routes there is no membership-derived path to leave alone, and a `host_admin` can never pass. 19A §A03 counts 85 such sites against 32 that pass the param. `admin-users.ts:67` and `:102` (`member.read` / `member.write`, no param) are the clearest examples.
- **Tests:** T-PERM-matrix, T-PERM-inventory · **Pre/mig:** none, this is a read · **Rollback:** n/a · **Codex:** determines which admin screens a host_admin can ever be shown.

**IT-PROV-16** — Assert no tenant verb composes into a platform verb
`apps/api/src/lib/auth/effective-permissions.test.ts` · **Change** test · **Pkg** D10 · **Scen** 67 · **When** do-now · **Approval** none
- **Accept:** A case asserting that for every `MembershipRole`, `expandPermissionsSync({role}, null)` contains no string starting with `platform.`. The expansion only runs one way today (`:125-136` reads platform verbs and writes tenant verbs), but nothing pins that, and the deprecated-role aliases at `permissions.ts:226-229` map old roles into new bundles without any such check.
- **Tests:** T-PERM-matrix · **Pre/mig:** none · **Rollback:** delete the case · **Codex:** none.

**IT-PROV-17** — Offline check that a declared verb without a call site fails the build
`scripts/check-all.mjs` `scripts/check-permission-inventory.mjs` · **Change** ci · **Pkg** P05,D10 · **Scen** 65,66 · **When** do-later · **Approval** none
- **Accept:** A new entry in the `CHECKS` array at `scripts/check-all.mjs:14` cross-references `PER_TENANT_PERMISSIONS` and `PLATFORM_PERMISSIONS` against `requirePermission(` / `assertPermission(` call sites and fails on any verb with zero sites that is not on an explicit allowlist. This must be a check script, not a vitest test: `.github/workflows/check.yml` runs three steps and `npm run check` invokes nine offline checks, **none of them vitest** — a test asserting this would never run in CI. The current unenforced set is 17 verbs per 19A §A03.
- **Tests:** the check tests itself; `scripts/check-schema-consistency.test.mjs` is the precedent · **Pre/mig:** none · **Rollback:** remove the array entry · **Codex:** none.

**IT-PROV-18** — Surface provenance on GET /api/admin/me
`apps/api/src/routes/admin/me.ts` `src/lib/org-context.ts` · **Change** edit · **Pkg** C08 · **Scen** 52,60,64 · **When** do-later · **Approval** none
- **Accept:** The response distinguishes "you can act here because you are a member" from "you can act here because you are platform staff". Today the persona fork at `me.ts:71-78` returns `operator` whenever a platform grant exists — `isPlatform` short-circuits before membership is considered — so a user who is both a platform grantee and an org member reports as `operator` and the UI (`src/lib/org-context.ts:39-45`) cannot tell scenario 52's case from scenario 63's. Depends on IT-PROV-01.
- **Tests:** none exist for `me.ts` today · **Pre/mig:** none · **Rollback:** revert the response shape; it is additive if the existing fields stay · **Codex:** the UI can finally decide whether to show a support banner without guessing.
# Appendix 19B part 2 — SCTX, IMP, ATTR, OCPP

Source of truth: `docs/domain/onboarding/19A-source-inventory.md` sections A03, A05, A06;
`18A-work-packages.md` groups C, D, E, F; `18C-scenarios.md` 47-98. Every path below was
opened on branch `docs/singular-onboarding-domain-packet`. Paths marked `new` do not exist
yet and are proposals.

Repo facts that shape all four groups:
- No vitest runs in CI. `.github/workflows/check.yml` has three steps (`npm install`,
  `npm run db:generate`, `npm run check`); `scripts/check-all.mjs:14-35` lists nine offline
  checks, none of them a test runner. Every `Tests:` line below is a file you can run by
  hand — none of them gate a merge today.
- Prisma schema is the folder `prisma/schema/` (9 files incl. `schema.prisma`);
  `apps/api/prisma/schema/` is a generated copy kept in step by
  `scripts/sync-api-prisma-schema.mjs` and gated by `check:api-schema`.
- Drizzle is authoritative for tables (`scripts/check-schema-consistency.mjs` is the gate),
  Prisma still serves ~500 un-ported calls. Any new table needs BOTH plus a raw migration.

---

## SCTX — support-context guard (22)

Fully greenfield. The inventory's grep for `SupportContext`, `support_context`,
`supportContext`, `onBehalfOfOrgId` and `platform.support.action` hits exactly two files —
`apps/api/src/lib/auth/permissions.ts:83` (the catalogue entry) and its test. There is no
table, no module, no column, no route, no call site. 18A frames C02 as "guard inside
`requirePermission`" as if it were a one-line insertion into a working seam; it is not. Two
structural facts make the guard as specified unbuildable without prior decisions: (a) the
bootstrap early return at `require-permission.ts:55-59` sits *above* any insertion point, so
a guard placed after it is bypassed by any session with `sub === "admin"` and no `userId`;
(b) the bootstrap admin created by `repositories/admin-bootstrap.ts:84-95` holds a
`super_user` PlatformGrant and **no membership in any org**, so an org-scoped guard demands a
support context for every routine staff action that operator performs — including the ones
that are not support at all.

**IT-SCTX-01** — Create the support_contexts table in all three schema surfaces
`packages/shared/src/db/identity.ts` `prisma/schema/identity.prisma` `apps/api/prisma/schema/identity.prisma` `prisma/migrations/<ts>_support_contexts/migration.sql` · **Change** schema · **Pkg** C01 · **Scen** 47,48 · **When** do-now · **Approval** DBA
- **Accept:** `npm run check:schema-consistency` and `npm run check:api-schema` both exit 0 with the new table present in Drizzle and both Prisma copies; columns at minimum `id`, `staff_user_id`, `org_id`, `reason`, `opened_at`, `expires_at`, `closed_at`, `break_glass`. `information_schema` verification is out of scope here — no DB connection in this workstream.
- **Tests:** `apps/api/test/parity/schema-columns.test.ts` extended · **Pre/mig:** new table, additive, no backfill · **Rollback:** `DROP TABLE identity.support_contexts` — safe while nothing writes it · **Codex:** none until IT-SCTX-11 lands

**IT-SCTX-02** — Decide where the guard sits relative to the bootstrap early return
`apps/api/src/lib/auth/require-permission.ts` · **Change** decision · **Pkg** C02 · **Scen** 47,63 · **When** do-now · **Approval** Andri
- **Accept:** a written decision recorded in the packet naming one of three options — (1) delete the `isBootstrapSession` branch at `:55-59` and `:115-117` outright, (2) move the guard above it, (3) keep god-mode and accept that a `sub === "admin"` + no-`userId` cookie skips the context requirement. Option 3 must state in writing that any pre-Sprint-5.5 cookie still validating under `verifyAdminSession` is an unguarded path.
- **Tests:** none — this is the prerequisite for IT-SCTX-03/04 · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-SCTX-03** — Delete the bootstrap god-mode early return from both seams
`apps/api/src/lib/auth/require-permission.ts` · **Change** edit · **Pkg** C02 · **Scen** 63,69 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-SCTX-02. Once decided: `isBootstrapSession` no longer appears in `requirePermission` (`:55-59`) or `assertPermission` (`:115-117`); a session with `sub === "admin"` and no `userId` receives 403 `session_missing_user_id` instead of `next()`. `grep -n "isBootstrapSession" apps/api/src/lib/auth/require-permission.ts` returns only the definition at `:147` and the `org-scope.ts` import.
- **Tests:** `apps/api/src/lib/auth/require-permission.test.ts:67-93` currently asserts the god-mode pass and must be rewritten in the same commit · **Pre/mig:** none, but any still-valid pre-5.5 cookie loses access at deploy — 12h TTL means the blast radius closes within half a day · **Rollback:** revert the commit; no state change · **Codex:** none

**IT-SCTX-04** — Return access provenance from resolveEffectivePermissions
`apps/api/src/lib/auth/effective-permissions.ts` · **Change** edit · **Pkg** C02,C03 · **Scen** 52,63,64 · **When** do-now · **Approval** none
- **Accept:** the resolver returns which source satisfied each verb (membership bundle vs `expandPlatformTenantVerbs`), not a flat `Permission[]`. Concretely: a caller can ask "was `member.read` granted by the membership row or by the platform expansion" and get a definite answer for a user who holds both. Existing callers keep compiling because the flat list stays available as a field.
- **Tests:** `apps/api/src/lib/auth/effective-permissions.test.ts` — add a dual-source case (active membership AND active grant) asserting membership provenance wins · **Pre/mig:** none · **Rollback:** revert; the added field is unread until IT-SCTX-05 · **Codex:** none

**IT-SCTX-05** — Add the support-context guard to requirePermission
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/lib/auth/support-context.ts` (new) · **Change** edit · **Pkg** C02 · **Scen** 47,48,52 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-SCTX-01 (table) and IT-SCTX-04 (provenance). Once unblocked: a request whose verb is satisfied ONLY by `expandPlatformTenantVerbs` and which carries no open context for the resolved org returns 403 with `reason: "support_context_required"`; the same request with an open context proceeds. A request satisfied by an active membership row is untouched and issues no extra query.
- **Tests:** new `apps/api/test/parity/support-context-guard.test.ts` (real DB, rolled back, mirroring `_harness.ts`) · **Pre/mig:** the guard adds one query per platform-derived request — measure before arming · **Rollback:** feature-flag the guard off, or revert · **Codex:** UI can start distinguishing "you need a context" from "you are not allowed"

**IT-SCTX-06** — Mirror the guard into assertPermission
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/routes/admin/access-requests.ts` · **Change** edit · **Pkg** C02 · **Scen** 50,64 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-05. `assertPermission` (`:106-134`) applies the identical context check. Verified by driving `POST /api/admin/access-requests` decision paths (`access-requests.ts:90` and `:178`, both `member.write`) with a platform-only session and no context: both return 403 `support_context_required`. Without this, the guard has exactly two live bypasses.
- **Tests:** `apps/api/test/parity/driver-access-request-flow.test.ts` extended with a platform-only actor · **Pre/mig:** none · **Rollback:** revert · **Codex:** none

**IT-SCTX-07** — Introduce the support_context_required 403 body shape
`apps/api/src/lib/auth/require-permission.ts` · **Change** edit · **Pkg** C04 · **Scen** 47,61 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-05. Response body is `{ error: "forbidden", reason: "support_context_required", orgId: "<uuid>" }` with status 403 — structurally the same envelope as the existing `permission_missing` at `:77-84` so no client parser breaks, and distinguishable by `reason` alone.
- **Tests:** unit assertion in `require-permission.test.ts` on the exact body · **Pre/mig:** none · **Rollback:** revert · **Codex:** UI branches on `reason` to offer the "open a support context" affordance instead of a dead end

**IT-SCTX-08** — Enforce absolute expiry on every request, not at open time
`apps/api/src/lib/auth/support-context.ts` (new) · **Change** new · **Pkg** C05 · **Scen** 51 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-01. A context whose `expires_at` is in the past yields 403 mid-session on the very next request, with no cache and no grace. Copy the working precedent: `effective-permissions.ts:84` already does per-request `expiresAt` filtering on `platform_grants`.
- **Tests:** parity test that opens a context, back-dates `expires_at`, and asserts the next call 403s · **Pre/mig:** none · **Rollback:** revert · **Codex:** UI can trust that an expired banner means the server is already refusing

**IT-SCTX-09** — Bind a context to exactly one org and reject cross-org use
`apps/api/src/lib/auth/support-context.ts` (new) `apps/api/src/lib/auth/org-scope.ts` · **Change** edit · **Pkg** C06 · **Scen** 50 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-01. A context for org A used against org B returns 403. Note the constraint the inventory found: `identity.platform_grants` has `user_id` as PRIMARY KEY (`packages/shared/src/db/identity.ts:386-389`), so one grant per user and it cannot be org-bound — the binding MUST live on the new table, not the grant. `resolveOrgScope` (`org-scope.ts:38-63`) currently returns `{ all: true }` for any `platform.tenant.read` holder; with a context open it must narrow to the bound org.
- **Tests:** `org-scope.ts` has no test file at all — a new `apps/api/src/lib/auth/org-scope.test.ts` is part of this task · **Pre/mig:** none · **Rollback:** revert; `resolveOrgScope` returns to unrestricted · **Codex:** org switcher can grey out orgs outside the open context

**IT-SCTX-10** — Add POST /api/admin/support-contexts (enter)
`apps/api/src/routes/admin/support-contexts.ts` (new) · **Change** new · **Pkg** C07,C12 · **Scen** 48,53,59 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-01. Gated by `requirePermission("platform.support.action")` — this is the verb's FIRST enforcement call site anywhere in the repo (currently declared at `permissions.ts:83`, bundled at `:262`, zero call sites). Missing or empty `reason` returns 400. A caller without the verb returns 403. Success returns 201 with the context id and `expiresAt`, and writes one `audit.actions` row.
- **Tests:** new `apps/api/test/parity/support-contexts-route.test.ts` · **Pre/mig:** must be mounted — see IT-SCTX-14 · **Rollback:** unmount the route · **Codex:** the "start support session" dialog becomes real

**IT-SCTX-11** — Add GET /api/admin/support-contexts/current
`apps/api/src/routes/admin/support-contexts.ts` (new) · **Change** new · **Pkg** C08 · **Scen** 60,61 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-10. Returns 200 with `{ id, orgId, orgDisplayName, staffEmail, reason, expiresAt, breakGlass }` when a context is open, 404 when not. Scenario 60 requires all four of org, staff email, reason and expiry in one payload — a 200 missing any one of them fails this task.
- **Tests:** same parity file as IT-SCTX-10 · **Pre/mig:** none · **Rollback:** unmount · **Codex:** the persistent support banner can render without a second call

**IT-SCTX-12** — Add POST /api/admin/support-contexts/:id/exit
`apps/api/src/routes/admin/support-contexts.ts` (new) · **Change** new · **Pkg** C09 · **Scen** 56 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-10. Sets `closed_at`, writes an audit row, and the very next guarded request for that org 403s with `support_context_required`. Idempotent: exiting an already-closed context is 200, not 409.
- **Tests:** parity assertion that a post-exit request 403s · **Pre/mig:** none · **Rollback:** unmount · **Codex:** an explicit "end support session" button that actually ends it

**IT-SCTX-13** — Add POST /api/admin/support-contexts/:id/extend
`apps/api/src/routes/admin/support-contexts.ts` (new) · **Change** new · **Pkg** C15 · **Scen** 51,57 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-10. Requires a fresh `reason`; writes a new `expires_at` and an audit row naming both the old and new expiry. Extending an already-expired or closed context is refused with 409 — extension is not resurrection.
- **Tests:** parity assertion on the audit row carrying both timestamps · **Pre/mig:** none · **Rollback:** unmount · **Codex:** "extend by 30 min" affordance in the banner

**IT-SCTX-14** — Mount the support-contexts router in index.ts
`apps/api/src/index.ts` · **Change** edit · **Pkg** C07 · **Scen** 48 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-10. `app.route("/api/admin/support-contexts", adminSupportContexts)` appears alongside the existing mounts at `index.ts:125-200`, and `npm run check:api-endpoints` (`scripts/gen-api-endpoints.mjs --check`) regenerates clean. This is a standalone task on purpose: `apps/api/src/routes/admin/org-email-domains.ts` is fully implemented and DB-tested (`apps/api/test/parity/org-email-domains.test.ts`) yet appears nowhere in `index.ts` — an unmounted router in this repo is a proven failure mode, not a hypothetical.
- **Tests:** `check:api-endpoints` · **Pre/mig:** none · **Rollback:** remove the line · **Codex:** the endpoints become reachable

**IT-SCTX-15** — Add support_context_id and on_behalf_of_org_id to audit.actions
`packages/shared/src/db/platform.ts` `prisma/schema/platform.prisma` `apps/api/prisma/schema/platform.prisma` `prisma/migrations/<ts>_audit_support_context/migration.sql` · **Change** schema · **Pkg** C10,C11 · **Scen** 49,55 · **When** blocked · **Approval** DBA
- **Accept:** blocked on IT-SCTX-01 (FK target). Both columns nullable, added to the `actions` table defined at `packages/shared/src/db/platform.ts:91-108`; `check:schema-consistency` exits 0. Nullable is mandatory — every historical row and every non-support action legitimately has NULL.
- **Tests:** `apps/api/test/parity/schema-columns.test.ts` · **Pre/mig:** additive columns on a table with two existing indexes; no backfill · **Rollback:** drop both columns · **Codex:** none

**IT-SCTX-16** — Teach recordAuditAction to carry the context, on both client branches
`apps/api/src/lib/audit.ts` · **Change** edit · **Pkg** C10,C11 · **Scen** 49 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-15. `AuditActionInput` (`audit.ts:26-34`) gains two optional fields and BOTH writers persist them — the Drizzle branch at `:63-73` and the Prisma branch at `:76-86`. A change to only one branch is a silent half-fix: the file is dual-client by design (`:5-19`) and callers pick the branch, so half the fourteen call sites would write NULL.
- **Tests:** unit test driving both a Drizzle handle and a Prisma handle through one input · **Pre/mig:** none · **Rollback:** revert; columns stay NULL · **Codex:** none

**IT-SCTX-17** — Thread the open context from the request into every audit call site
`apps/api/src/lib/audit.ts` `apps/api/src/routes/admin/access-requests.ts` · **Change** edit · **Pkg** C10,C11 · **Scen** 49,55,70 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-16. Every `recordAuditAction` call made while a context is open carries the context id and `onBehalfOfOrgId`. The observable: for a staff action performed under a context, `actor_user_id`, `on_behalf_of_org_id` and `support_context_id` are three distinct populated columns (scenario 70). The actor is read from the verified session only, never from request input (scenario 69) — no call site may accept an actor id from the body.
- **Tests:** parity test asserting all three columns on one row · **Pre/mig:** none · **Rollback:** revert · **Codex:** an org-visible audit view can show "who from Straumvakt, why, when"

**IT-SCTX-18** — Add break-glass flag with a shorter TTL
`apps/api/src/routes/admin/support-contexts.ts` (new) `packages/shared/src/db/identity.ts` · **Change** edit · **Pkg** C13 · **Scen** 57,58 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-SCTX-10. A break-glass context stores `break_glass = true` and an `expires_at` strictly earlier than the default TTL; both values are readable back from the row. The review queue of scenario 58 is a read over this flag, not a separate table.
- **Tests:** parity assertion comparing the two TTLs · **Pre/mig:** none if the column landed with IT-SCTX-01; otherwise a second additive migration · **Rollback:** ignore the flag; contexts fall back to default TTL · **Codex:** a distinct visual treatment for break-glass sessions

**IT-SCTX-19** — Notify the organisation when a context opens
`apps/api/src/routes/admin/support-contexts.ts` (new) `apps/api/src/lib/dispatcher.ts` · **Change** new · **Pkg** C14 · **Scen** 54 · **When** blocked · **Approval** none
- **Accept:** blocked on the outbox/notification package (18A marks C14 as needing G-outbox) AND on IT-SCTX-10. State when blocked: opening a context enqueues exactly one notification row addressed to the org, and enqueue failure does not fail the context open — the context is the security record, the mail is a courtesy.
- **Tests:** assertion that one row is enqueued per open, zero per read · **Pre/mig:** none · **Rollback:** stop enqueuing · **Codex:** none

**IT-SCTX-20** — Resolve the 85 orgId-less gates that the guard cannot bind
`apps/api/src/lib/auth/require-permission.ts` `apps/api/src/domains/identity/routes/admin-users.ts` · **Change** decision · **Pkg** C02,C03,D10 · **Scen** 63,64,66 · **When** do-now · **Approval** Andri
- **Accept:** a decision covering the 85 `requirePermission` call sites that name a per-tenant verb and pass no `orgIdParam` — `require-permission.ts:69-71` sets `orgId = null`, `effective-permissions.ts` then skips the membership lookup entirely, so those gates are satisfiable ONLY through the platform expansion. Two consequences to rule on: (1) a support context cannot be matched against an org on those routes because there is no org to match; (2) C03's "membership-derived access needs no context" is vacuous there — there is no membership-derived path to exempt. Concrete example to decide first: `admin-users.ts:67` and `:102` gate `member.read`/`member.write` with no `orgIdParam`.
- **Tests:** an inventory test enumerating orgId-less per-tenant gates and failing when the count grows (scenario 66) · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-SCTX-21** — Rule on the bootstrap admin, who has a grant and no membership
`apps/api/src/repositories/admin-bootstrap.ts` `apps/api/src/routes/admin/auth.ts` · **Change** decision · **Pkg** C02,C03 · **Scen** 63 · **When** do-now · **Approval** Andri
- **Accept:** a written decision on the operational consequence the packet never states. `bootstrapAdminUser` (`admin-bootstrap.ts:84-95`) creates a `super_user` PlatformGrant and no membership anywhere; `routes/admin/auth.ts:134-137` always stamps `userId`, so that operator takes the ordinary DB path. With the IT-SCTX-05 guard armed, EVERY tenant-scoped action by the day-to-day operator — reading a site, pushing a config, checking a session — demands a support context, because platform expansion is their only source of tenant verbs. Decide one of: give the operator real memberships, exempt `super_user` from the guard (and say so in the audit trail), or accept context-per-action. The acceptance is the decision being recorded before IT-SCTX-05 arms, not after.
- **Tests:** none — decision · **Pre/mig:** none · **Rollback:** n/a · **Codex:** determines whether the support banner is an exception or the normal operator state

**IT-SCTX-22** — Surface the open context on GET /api/admin/me
`apps/api/src/routes/admin/me.ts` `src/lib/org-context.ts` · **Change** edit · **Pkg** C08 · **Scen** 60,61 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-SCTX-11. The `/me` payload gains an optional `supportContext` object; when absent the response is byte-identical to today's (`me.ts:33-81` returns `email, role, userId, persona, isPlatform, orgs`). The web consumer `src/lib/org-context.ts:39-45` (`AdminMe`) compiles unchanged because the field is optional.
- **Tests:** shape assertion that the no-context response is unchanged · **Pre/mig:** none · **Rollback:** revert; UI falls back to the dedicated endpoint · **Codex:** the banner renders on first paint with no extra round trip

---

## IMP — platform.impersonate removal (10)

Straightforward deletion, correctly framed by 18A/D01 — the verb has zero enforcement call
sites anywhere. The whole change is four edits plus a static guard; `super_user` needs no
separate edit because `PLATFORM_ROLE_PERMISSIONS.super_user` is the spread
`[...PLATFORM_PERMISSIONS]` at `permissions.ts:243`, so removing the catalogue entry removes
it from super_user automatically. The one thing the packet omits: the word survives in the
Prisma enum comments in both schema copies, and nothing stops the verb being re-added.

**IT-IMP-01** — Delete platform.impersonate from the permission catalogue
`apps/api/src/lib/auth/permissions.ts` · **Change** delete · **Pkg** D01 · **Scen** 71 · **When** do-now · **Approval** Andri
- **Accept:** `"platform.impersonate"` is gone from `PLATFORM_PERMISSIONS` at `permissions.ts:82`. `grep -n "platform.impersonate" apps/api/src/lib/auth/permissions.ts` returns nothing. Because `PlatformPermission` is derived as `(typeof PLATFORM_PERMISSIONS)[number]`, `npm run typecheck` becomes the enforcement: any surviving string literal is a compile error, not a runtime surprise.
- **Tests:** `npm run typecheck` via `npm run check` · **Pre/mig:** none — the verb is not stored anywhere; `platform_grants` stores a role enum, not verb lists · **Rollback:** re-add the string · **Codex:** none

**IT-IMP-02** — Remove impersonate from the platform_admin bundle
`apps/api/src/lib/auth/permissions.ts` · **Change** delete · **Pkg** D01 · **Scen** 71,73 · **When** do-now · **Approval** Andri
- **Accept:** the entry at `permissions.ts:249` inside `PLATFORM_ROLE_PERMISSIONS.platform_admin` is gone; the bundle keeps its remaining ten verbs unchanged. Must land in the same commit as IT-IMP-01 — `PlatformPermission[]` will not typecheck otherwise.
- **Tests:** `permissions.test.ts` bundle-shape assertions · **Pre/mig:** none · **Rollback:** re-add · **Codex:** none

**IT-IMP-03** — Remove impersonate from the support_agent bundle
`apps/api/src/lib/auth/permissions.ts` · **Change** delete · **Pkg** D01 · **Scen** 71,73 · **When** do-now · **Approval** Andri
- **Accept:** the entry at `permissions.ts:261` is gone. `support_agent` keeps `platform.tenant.read`, `platform.support.action` and `platform.audit.read` — three verbs, not two: `platform.support.action` is explicitly NOT part of this deletion, it is the verb C12/IT-SCTX-10 is about to wire up for the first time.
- **Tests:** `permissions.test.ts` · **Pre/mig:** none · **Rollback:** re-add · **Codex:** none

**IT-IMP-04** — Update the support_agent assertion in permissions.test.ts, same commit
`apps/api/src/lib/auth/permissions.test.ts` · **Change** test · **Pkg** D01 · **Scen** 68,73 · **When** do-now · **Approval** none
- **Accept:** the test at `permissions.test.ts:190-195` — currently titled "support_agent can impersonate but cannot write tenants" and asserting `bundle.has("platform.impersonate")` is `true` at `:192` — is renamed and inverted to assert absence. Scenario 68 requires this in the SAME commit as IT-IMP-01; a red suite between commits is a failure of this task even though no CI runs it.
- **Tests:** this file · **Pre/mig:** none · **Rollback:** revert with the deletion commit · **Codex:** none

**IT-IMP-05** — Verify super_user needs no edit and the exhaustive test still passes
`apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/permissions.test.ts` · **Change** test · **Pkg** D01,D10 · **Scen** 73 · **When** do-now · **Approval** none
- **Accept:** no change to `permissions.ts:243`. `PLATFORM_ROLE_PERMISSIONS.super_user` is `[...PLATFORM_PERMISSIONS]`, so the verb leaves that bundle by construction. The test at `permissions.test.ts:176-181` ("super_user gets every platform.* verb") iterates `PLATFORM_PERMISSIONS` and therefore stays green with no edit — confirm by running it, and record the confirmation. The inventory's open question on SI-PERMISSIONS-01 ("deleting breaks the literal super_user list at :243") is answered here: it is a spread, not a literal list.
- **Tests:** `permissions.test.ts:176` · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-IMP-06** — Add a static check that stops the verb coming back
`scripts/check-no-impersonate.mjs` (new) `scripts/check-all.mjs` `package.json` · **Change** ci · **Pkg** D01 · **Scen** 72 · **When** do-now · **Approval** none
- **Accept:** a new offline check greps `apps/`, `packages/`, `gateway/`, `src/` and `prisma/` for `platform.impersonate` and `impersonate` in permission position, exits non-zero on any hit, and is registered in the `CHECKS` array in `scripts/check-all.mjs:14-35` so `npm run check` runs it. This is the only durable guard available: `.github/workflows/check.yml` runs `npm run check` and nothing else, so a check not in that array is a check that does not run.
- **Tests:** the script itself, run against a deliberately reintroduced string · **Pre/mig:** none · **Rollback:** remove from the CHECKS array · **Codex:** none

**IT-IMP-07** — Scrub the surviving impersonate wording from both Prisma schema copies
`prisma/schema/identity.prisma` `apps/api/prisma/schema/identity.prisma` · **Change** edit · **Pkg** D01 · **Scen** 71,72 · **When** do-now · **Approval** none
- **Accept:** the `PlatformRole` enum comment `support_agent // read all tenants + impersonate + password-reset; no tenant writes` at `prisma/schema/identity.prisma:840` and its generated twin at `apps/api/prisma/schema/identity.prisma:850` no longer describe impersonation. `check:api-schema` exits 0 (edit the source copy and re-run `scripts/sync-api-prisma-schema.mjs`, never hand-edit the generated copy). Without this task, a repo-wide grep for `impersonate` still returns hits and IT-IMP-06 either fails or has to be weakened.
- **Tests:** `npm run check:schemas`, `npm run check:api-schema` · **Pre/mig:** comment-only, no DDL · **Rollback:** revert · **Codex:** none

**IT-IMP-08** — Confirm no persisted state grants impersonation after removal
`packages/shared/src/db/identity.ts` · **Change** decision · **Pkg** D01 · **Scen** 74 · **When** blocked · **Approval** Andri
- **Accept:** blocked — no DB connection is available in this workstream. The static half is already established and can be recorded now: `identity.platform_grants` stores `role` (an enum) plus an unused `scope` jsonb (`packages/shared/src/db/identity.ts:386-399`), never a verb list, so a grant minted before removal cannot carry the string. The live half — confirming `scope` is empty on every row and holds no verb array — needs one read-only query against staging and Andri's go-ahead. Unverified until then.
- **Tests:** none offline · **Pre/mig:** read-only query, no migration · **Rollback:** n/a · **Codex:** none

**IT-IMP-09** — Keep platform.support.action and record why it is not deleted with its sibling
`apps/api/src/lib/auth/permissions.ts` · **Change** decision · **Pkg** D01,C12 · **Scen** 59,71 · **When** do-now · **Approval** none
- **Accept:** a one-line record that `platform.support.action` (`permissions.ts:83`, bundled at `:262`) stays despite also having zero call sites today, because C12/IT-SCTX-10 makes it the gate on context creation. The two verbs sit adjacent in the catalogue and share the "declared, never enforced" property — deleting both in one sweep would remove the guard the support-context work depends on.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-IMP-10** — Correct the unenforced-verb list in the permission matrix doc
`docs/domain/onboarding/16-permission-matrix.md` · **Change** edit · **Pkg** D01,D02 · **Scen** 65,66 · **When** do-now · **Approval** none
- **Accept:** the doc's claim that `member.remove` is unenforced (`16-permission-matrix.md:56` and `:100`) is corrected — it IS enforced at `apps/api/src/domains/identity/routes/admin-memberships.ts:33`. The verified-unenforced set after impersonate removal is 16 verbs: `tariff.read`, `tariff.write`, `contract.write`, `audit.read`, `billing.export`, `platform.support.action` (until IT-SCTX-10), `platform.audit.read`, `platform.tariff_catalogue.read`/`.write`, `platform.finance.read`/`.write`, `platform.grant.read`/`.write`, `platform.feature_flag.read`/`.write`, `platform.migration.run`. `tariff.read` is unenforced and was missing from the doc's list.
- **Tests:** none — doc · **Pre/mig:** none · **Rollback:** revert · **Codex:** none

---

## ATTR — attribution and token class (21)

Greenfield with a hard schema prerequisite the packet skips. `tokenClass`, `token_class`,
`session_attribution` and `authorization_decision` return zero hits across `*.ts`, `*.prisma`
and `*.sql`. E04 ("technical token implies `userId: null`") is presented as a resolver change
but `IdToken.userId` is NOT NULL with a cascading FK (`prisma/schema/identity.prisma:205`,
`:230`; `packages/shared/src/db/identity.ts:131`) — it is a column migration first. The
governing invariant for the whole group: **a shared technical token must never name a
person**, which today is violated in the other direction — `projections.ts` re-resolves
`idTag` to a user at stop time and writes `session_ledger.driver_user_id` with no notion of
class at all.

**IT-ATTR-01** — Add id_tokens.token_class in all three schema surfaces
`packages/shared/src/db/identity.ts` `prisma/schema/identity.prisma` `apps/api/prisma/schema/identity.prisma` `prisma/migrations/<ts>_id_token_class/migration.sql` · **Change** schema · **Pkg** E01 · **Scen** 75,81,82 · **When** do-now · **Approval** DBA
- **Accept:** a new enum column on `identity.id_tokens` (Drizzle table at `packages/shared/src/db/identity.ts:127-151`) with a non-null default so no existing row is invalidated. Values must express what the eight-value `IdTokenKind` enum cannot — `identity.prisma:240-252` has `rfid`, `app_jwt`, `magic_link`, `zaptec_proxy`, `ocpi_token`, `manual`, `evccid`, `virtual_rfid`, and none of them means "belongs to the installation, not a person". `check:schema-consistency` exits 0.
- **Tests:** `apps/api/test/parity/schema-columns.test.ts` · **Pre/mig:** additive with default; no rewrite of existing rows · **Rollback:** drop the column while nothing reads it · **Codex:** token list can show a class badge

**IT-ATTR-02** — Make id_tokens.user_id nullable
`prisma/schema/identity.prisma` `apps/api/prisma/schema/identity.prisma` `packages/shared/src/db/identity.ts` `prisma/migrations/<ts>_id_token_user_nullable/migration.sql` · **Change** schema · **Pkg** E04 · **Scen** 75,83 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-ATTR-01 (the class column is what makes a null owner meaningful). `user_id` becomes nullable in Drizzle (`identity.ts:131` drops `.notNull()`) and in both Prisma copies (`identity.prisma:205` becomes `String?`, relation at `:230` becomes optional). This is a contract change: `createIdToken` (`apps/api/src/domains/identity/repositories/id-tokens.ts:119`) takes a required `userId`, and `IdTokenRow.userId` is typed `string` at `:57` — both must widen in the same commit or typecheck fails.
- **Tests:** `apps/api/src/domains/identity/repositories/id-tokens.test.ts` · **Pre/mig:** `ALTER COLUMN DROP NOT NULL` is fast and non-rewriting; the reverse is not — re-adding NOT NULL after any null row exists requires a data fix first · **Rollback:** only while zero rows have a null owner · **Codex:** UI must stop assuming every token has an owner

**IT-ATTR-03** — Add the CHECK constraint rejecting a subject on a non-driver token
`prisma/migrations/<ts>_id_token_class_check/migration.sql` (new) · **Change** schema · **Pkg** E05 · **Scen** 83 · **When** blocked · **Approval** DBA
- **Accept:** blocked on IT-ATTR-01 and IT-ATTR-02. A raw-SQL `ALTER TABLE identity.id_tokens ADD CONSTRAINT ... CHECK (...)` such that inserting an installation-class or unknown-class row with a non-null `user_id` fails at the database, not in application code. Neither Drizzle nor Prisma models table-level CHECKs here — this must be hand-written SQL in the migration, and `check:schema-consistency` must be confirmed not to flag the drift it cannot see.
- **Tests:** parity test asserting the insert raises · **Pre/mig:** constraint validates existing rows on creation — any pre-existing violation blocks the migration, so IT-ATTR-04 runs first · **Rollback:** `DROP CONSTRAINT` · **Codex:** none

**IT-ATTR-04** — Classify every existing id_token and record the decision
`apps/api/scripts/classify-id-tokens.ts` (new) · **Change** new · **Pkg** E02 · **Scen** 81,82 · **When** blocked · **Approval** Andri
- **Accept:** blocked on operator input — 18A flags E02 as "may need operator input" and the inventory records `UNKNOWN Q-04`. Dry-run by default (follow the `--commit` convention in `apps/api/scripts/backfill-session-costs.ts`), printing a per-class count before any write. The specific unanswered question to put to the operator: the Zaptec Default ID tag synthesised in free-vend mode (a 14-hex value, e.g. the Dalvegur one named in `idtag-classifier.ts:100-102`) is installation-class, but the same shape is also a legitimate DESFire card — shape alone cannot decide it.
- **Tests:** dry-run output reviewed before commit · **Pre/mig:** must complete before IT-ATTR-03 or the CHECK fails to validate · **Rollback:** the script must record prior values so a reverse run is possible · **Codex:** none

**IT-ATTR-05** — Stop the classifier calling every phone tap a physical card
`apps/api/src/lib/idtag-classifier.ts` `apps/api/src/lib/tap-intent/random-uid.ts` · **Change** edit · **Pkg** E02,F09 · **Scen** 79,84 · **When** do-now · **Approval** none
- **Accept:** `classifyIdTagFormat("085ACDF6")` no longer returns `iso14443_4byte` with `high` confidence. Today it does: the 8-hex branch at `idtag-classifier.ts:96-98` fires, while `isRandomEmulatedUid` (`random-uid.ts:67-70`, pattern `^08[0-9A-F]{6}$` at `:38`) calls the identical string a phone tap. The classifier imports only `./oui/lookup` at `:29`. Add a random-UID branch ahead of the 8-hex branch, plus a matching `IdTagKind` and label in `idTagKindLabel` (`:153-168`). Observable: the session detail UI stops labelling taps as cards.
- **Tests:** `apps/api/src/lib/idtag-classifier.test.ts` — add the `08`-prefix case · **Pre/mig:** none, pure function · **Rollback:** revert · **Codex:** `idTagClassification.detectedKindLabel` (consumed at `apps/api/src/repositories/session-full-detail.ts:563-568`) becomes honest for taps

**IT-ATTR-06** — Rule on whether detectedKind may seed tokenClass
`apps/api/src/lib/idtag-classifier.ts` · **Change** decision · **Pkg** E02 · **Scen** 81,82 · **When** do-now · **Approval** Andri
- **Accept:** a recorded ruling answering the inventory's open question on SI-OCPP-03. The file's own header (`idtag-classifier.ts:25-27`) states the classifier is heuristic-only and that downstream code should treat confidence as advisory. Deciding "yes, seed it" means an advisory heuristic starts deciding who is billed. Recommendation to record: seeding permitted only as a suggested default in the operator UI, never as an automatic write.
- **Tests:** none — decision · **Pre/mig:** none · **Rollback:** n/a · **Codex:** determines whether the token editor pre-fills the class field

**IT-ATTR-07** — Add attribution as an additive field on the authorize response
`apps/api/src/routes/internal/ocpp-authorize.ts` · **Change** edit · **Pkg** E03,E16 · **Scen** 76,77,79 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-ATTR-01. `AuthorizeResult` (`ocpp-authorize.ts:42-54`) gains `attribution` with values covering driver, installation and unknown. Additive only: the gateway's own `AuthorizeVerdict` interface (`gateway/src/identity-do.ts:80-86`) is a separate structural declaration filled by `(await resp.json()) as AuthorizeVerdict` at `:944`, so an unknown extra field is carried and ignored. Verify by asserting an old-shaped gateway build still produces identical wire replies.
- **Tests:** `apps/api/src/routes/internal/ocpp-authorize.test.ts` · **Pre/mig:** none · **Rollback:** remove the field; nothing reads it until IT-ATTR-11 · **Codex:** session detail can show attribution from the decision rather than inferring it

**IT-ATTR-08** — Return userId only for driver-class tokens
`apps/api/src/routes/internal/ocpp-authorize.ts` · **Change** edit · **Pkg** E04 · **Scen** 75,76,78 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-ATTR-02. The terminal accept at `ocpp-authorize.ts:333-339` currently always returns `userId: token.userId`. After this change an installation-class token returns `attribution: installation` and NO `userId`, even if the column still holds one. This is the group's core invariant made executable — a shared technical token must never name a person.
- **Tests:** `ocpp-authorize.test.ts` — a case per class · **Pre/mig:** none · **Rollback:** revert · **Codex:** none

**IT-ATTR-09** — Create the session_attribution table
`packages/shared/src/db/charging.ts` `prisma/schema/charging.prisma` `apps/api/prisma/schema/charging.prisma` `prisma/migrations/<ts>_session_attribution/migration.sql` · **Change** schema · **Pkg** E06 · **Scen** 84,85,86 · **When** blocked · **Approval** DBA
- **Accept:** blocked on IT-ATTR-14 (the supersede-or-shadow decision). Table with at minimum `session_id`, `subject_kind`, `subject_user_id` nullable, `basis`, `decided_at`, and a CHECK mirroring IT-ATTR-03 so an installation attribution cannot carry a subject. `check:schema-consistency` exits 0.
- **Tests:** `apps/api/test/parity/domain-schemas.test.ts` · **Pre/mig:** new table; no backfill in this task · **Rollback:** drop while unwritten · **Codex:** none

**IT-ATTR-10** — Record the basis on every attribution row
`packages/shared/src/db/charging.ts` `apps/api/src/lib/ocpp/projections.ts` · **Change** edit · **Pkg** E07 · **Scen** 84 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-ATTR-09. Every row carries a basis distinguishing at least: token lookup, tap intent, vendor CDR, and operator correction. The four bases are already distinguishable at their sources — `ocpp-authorize.ts:183-199` returns `tap_intent` / `tap_intent_replayed`, `projections.ts:406-416` does the token lookup, `routes/webhooks/zaptec.ts:211` is the vendor path — but none of them is persisted as such today.
- **Tests:** `apps/api/src/lib/ocpp/projections.test.ts` · **Pre/mig:** none beyond IT-ATTR-09 · **Rollback:** revert writer · **Codex:** session detail can say why it thinks this is your session

**IT-ATTR-11** — Write attribution at session start, not only at stop
`apps/api/src/lib/ocpp/projections.ts` · **Change** edit · **Pkg** E06,E07 · **Scen** 78,84 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-ATTR-09. `onSessionStarted` (`projections.ts:151`) creates the `chargeSession` row at `:185-199` with `idTag` but no attribution and no `userId`; this task writes one attribution row at start. Observable: a session that is still `in_progress` has an attribution row, which today is impossible — nothing is attributed until stop.
- **Tests:** `projections.test.ts` · **Pre/mig:** none · **Rollback:** revert; stop-time path still populates the ledger · **Codex:** the live-session view can name the driver before the session ends

**IT-ATTR-12** — Reconcile the stop-time re-resolve against the start-time record
`apps/api/src/lib/ocpp/projections.ts` · **Change** edit · **Pkg** E06,E08 · **Scen** 84,85 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-ATTR-11. Both stop-time re-resolves — `onSessionStopped` at `projections.ts:406-416` and `onOcppRawStopTransaction` at `:971-978`, which run the identical `idToken.findFirst({ where: { value: idTag, status: "active" } })` — either agree with the start-time attribution or emit a correction (IT-ATTR-15). Silent disagreement is the failure this task forbids. Note both currently write only `session_ledger.driver_user_id`.
- **Tests:** `projections.test.ts` with a token revoked mid-session · **Pre/mig:** none · **Rollback:** revert · **Codex:** none

**IT-ATTR-13** — Persist the tap-intent identity the gateway currently discards
`apps/api/src/routes/internal/ocpp-authorize.ts` `gateway/src/identity-do.ts` `apps/api/src/lib/ocpp/projections.ts` · **Change** edit · **Pkg** E11 · **Scen** 84 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-ATTR-09. Today `resolveAuthorize` returns a real `userId` from `matchAndConsumeTapIntent` (`ocpp-authorize.ts:183-199`), the gateway uses it as a log field only (`identity-do.ts:680`, inside the `authorize.evaluated` console.log), and nothing persists it. Because a random emulated UID can never equal an `IdToken.value` by construction (`random-uid.ts:38`), the stop-time re-resolve returns null and every tap session lands with `driver_user_id = NULL`. Accept when a tap-authorised session has an attribution row naming the driver with basis `tap`.
- **Tests:** `projections.test.ts` plus `gateway/src/identity-do.test.ts` · **Pre/mig:** none · **Rollback:** revert; taps return to anonymous · **Codex:** tap-and-charge sessions appear in the driver's own history

**IT-ATTR-14** — Decide whether session_attribution supersedes the two existing columns
`apps/api/src/lib/ocpp/projections.ts` `apps/api/src/repositories/driver-sessions.ts` `apps/api/src/repositories/driver-invoices.ts` `apps/api/src/routes/webhooks/zaptec.ts` · **Change** decision · **Pkg** E06,E14 · **Scen** 95,96 · **When** do-now · **Approval** Andri
- **Accept:** a ruling on a live split-brain, recorded before IT-ATTR-09 is built. The OCPP writers never set `charging.sessions.user_id` (`projections.ts:185-199` and `:859-872` both omit it); only the Zaptec webhook (`routes/webhooks/zaptec.ts:211`, `:335`) and the CDR sync (`repositories/zaptec-session-sync.ts:329`, `:347`) do. Meanwhile `session_ledger.driver_user_id` is written only at stop. Consequence today: `GET /api/driver/sessions/current` and `/invoices` filter `sessions.user_id` (`driver-sessions.ts:114`, `driver-invoices.ts:53`) and return nothing for an OCPP-origin session, while `/sessions/history` (ledger-scoped) returns it. Decide: new table is canonical and both columns become derived, or the new table shadows them.
- **Tests:** none — decision · **Pre/mig:** determines whether a backfill is needed · **Rollback:** n/a · **Codex:** determines which endpoint the app should trust

**IT-ATTR-15** — Implement the upgrade-only rule with an explicit correction event
`packages/shared/src/db/charging.ts` `apps/api/src/lib/ocpp/projections.ts` · **Change** new · **Pkg** E08,E09 · **Scen** 84,85,86 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-ATTR-09. Unknown to driver is accepted with the basis recorded; driver to unknown, or driver A to driver B, is refused unless accompanied by a correction event that preserves the original value as a readable row. Observable: after a correction, both the old and new subject are retrievable — no in-place overwrite.
- **Tests:** new test file beside the writer · **Pre/mig:** none · **Rollback:** revert; attribution becomes last-write-wins again · **Codex:** a dispute UI can show the history rather than the current state

**IT-ATTR-16** — Create the authorization_decision log table
`packages/shared/src/db/charging.ts` `prisma/schema/charging.prisma` `apps/api/prisma/schema/charging.prisma` `prisma/migrations/<ts>_authorization_decision/migration.sql` · **Change** schema · **Pkg** E10,F01 · **Scen** 75-79 · **When** blocked · **Approval** DBA
- **Accept:** blocked on IT-ATTR-07. One row per authorize decision carrying the idTag, the `AuthorizeReason` (the union at `ocpp-authorize.ts:56-73`, thirteen values today), the verdict, `enforceAuthorize`, and whether the gateway served it from cache. Today this data exists only as a `console.log` in the gateway (`identity-do.ts:670-704`) — Cloudflare tail output, not queryable state. This table is also the precondition for IT-OCPP-01.
- **Tests:** `apps/api/test/parity/domain-schemas.test.ts` · **Pre/mig:** high-write table on the charger hot path — decide retention before arming · **Rollback:** drop while unwritten · **Codex:** an operator can review verdicts before flipping enforcement

**IT-ATTR-17** — Bill an unknown-attribution session to the installation, never to a person
`apps/api/src/repositories/session-ledger.ts` `apps/api/src/repositories/driver-invoices.ts` · **Change** edit · **Pkg** E14 · **Scen** 79,96 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-ATTR-14. A session with unknown attribution resolves to the installation as billing subject and NO person appears anywhere in its ledger row or invoice line. Note the current leak this must close: `session_ledger` stores `driverIdTag` alongside `driverUserId` (`projections.ts:423-432`), so a row with a null user still carries a raw tag value.
- **Tests:** `apps/api/src/repositories/session-ledger.test.ts` · **Pre/mig:** none · **Rollback:** revert · **Codex:** invoices stop showing a blank driver field

**IT-ATTR-18** — Make local-auth-list push respect token class
`apps/api/src/repositories/local-auth-list-push.ts` `apps/api/src/routes/admin/chargers.ts` · **Change** edit · **Pkg** E15 · **Scen** 75,78 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-ATTR-02. Two things break the moment `user_id` is nullable: the contract gate at `local-auth-list-push.ts:165-188` queries `driverGroupMembership.findFirst({ where: { userId: token.userId } })`, which with a null owner matches nothing and throws `no_contract` for every technical token; and `PushIdTokenError` (`:57-72`) has no code for "class not pushable". Decide and implement whether an installation-class token may enter a charger's local list at all, and note the route passes `requestedBy: null` hardcoded (`chargers.ts:509`) so the audit actor is absent either way.
- **Tests:** none exist — `local-auth-list-push.ts` has no test file; one is part of this task · **Pre/mig:** none · **Rollback:** revert · **Codex:** the push button can disable itself for non-pushable classes

**IT-ATTR-19** — Collapse the three divergent copies of the contract gate
`apps/api/src/routes/internal/ocpp-authorize.ts` `apps/api/src/repositories/local-auth-list-push.ts` `apps/api/src/repositories/charger-technical-read.ts` · **Change** edit · **Pkg** E15 · **Scen** 75-77,81 · **When** do-now · **Approval** none
- **Accept:** one shared function replaces three hand-copied implementations of the same rule: `ocpp-authorize.ts:275-330` (membership plus the zero-clause refusal `no_billable_clauses`), `local-auth-list-push.ts:165-188` (membership only), and `charger-technical-read.ts:255-266` `decideVerdict` (membership only, via a `hasContract` boolean). The observable divergence: a token under a zero-clause agreement is refused by the resolver, accepted by the push path, and reported `would_authorize` by the technical-read page. After this task all three agree.
- **Tests:** `apps/api/src/repositories/charger-technical-read.test.ts` plus the new push test from IT-ATTR-18 · **Pre/mig:** none · **Rollback:** revert · **Codex:** the technical-read page stops contradicting the runtime

**IT-ATTR-20** — Test that two concurrent sessions on one technical token name nobody
`apps/api/src/lib/ocpp/projections.test.ts` · **Change** test · **Pkg** E17 · **Scen** 78 · **When** blocked · **Approval** none
- **Accept:** blocked on a real disambiguator. The gateway invents its transaction id — `stubResponseFor("StartTransaction")` returns `Math.floor(Math.random() * 2_000_000_000)` (`identity-do.ts:961`) — and that id is never ingested; `onOcppRawStartTransaction` closes prior sessions by `(ocppIdentityId, status = 'in_progress')` instead (`projections.ts:828-833`). So two concurrent sessions on one token cannot be told apart today, and the second start closes the first. Write the test in its blocked form asserting the current behaviour, and name the blocker in the test's own comment.
- **Tests:** this file · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-ATTR-21** — Stop the cost backfill script from clobbering attribution
`apps/api/scripts/backfill-session-costs.ts` · **Change** edit · **Pkg** M02 · **Scen** 91,92,97 · **When** do-now · **Approval** Andri
- **Accept:** the script no longer passes one object as both `create` and `update` to `sessionLedger.upsert` (`backfill-session-costs.ts:176-199`). Two concrete corruptions to eliminate: it sets `driverUserId: s.userId`, which is NULL for every OCPP-origin session (see IT-ATTR-14), and `driverIdTag: s.ocppIdentity?.identityString` at `:185` — the CHARGER's OCPP identity string written into the driver column. A `--commit` run against attributed rows silently nulls the driver and writes a charger id where a token belongs. Accept when the update branch touches cost fields only and leaves both attribution columns alone.
- **Tests:** dry-run diff on a fixture row · **Pre/mig:** if the script has already been run with `--commit`, affected rows need identifying before this task is closed — unverified whether it has · **Rollback:** n/a, the script is the rollback risk · **Codex:** none

---

## OCPP — authorization truth on the wire (14)

Hardening, and the packet's framing is broadly right — this is the one group of my four that
is not greenfield. `resolveAuthorize` (`apps/api/src/routes/internal/ocpp-authorize.ts:130-340`)
is a real, complete resolver, and the gateway honours it. Two corrections: the contract gate
and the zero-clause refusal that F-group tasks assume are missing already exist at `:275-330`,
both inert until an operator sets `enforceAuthorize`; and the response is safely extensible
because the gateway re-declares `AuthorizeVerdict` structurally (`gateway/src/identity-do.ts:80-86`)
and casts the JSON onto it, so unknown fields are carried and ignored.

**IT-OCPP-01** — Build the shadow-mode evidence report
`apps/api/src/routes/admin/ocpp-verdicts.ts` (new) `gateway/src/identity-do.ts` · **Change** new · **Pkg** F01 · **Scen** 75-79 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-ATTR-16 — there is nothing to report over. Verdicts exist today only as the `[ocpp-gw] authorize.evaluated` console.log at `identity-do.ts:670-704`; nothing in `apps/api` or the database records a decision. Once the table lands: per-installation counts by `AuthorizeReason` over a chosen window, with the `cached` flag broken out separately, because a verdict served from the DO's 60 s cache (`AUTHORIZE_CACHE_TTL_MS` at `:275`) is not fresh evidence of anything.
- **Tests:** new route test · **Pre/mig:** depends on the retention decision in IT-ATTR-16 · **Rollback:** unmount · **Codex:** the pre-flip review screen F02 needs

**IT-OCPP-02** — Prove additive verdict fields do not disturb the deployed gateway
`gateway/src/identity-do.ts` `apps/api/src/routes/internal/ocpp-authorize.ts` · **Change** test · **Pkg** E16 · **Scen** 79,90 · **When** do-now · **Approval** none
- **Accept:** a test feeds a verdict payload carrying fields the gateway has never heard of and asserts the wire reply is byte-identical to the same payload without them. The mechanism holding: `requestAuthorizeVerdict` does `(await resp.json()) as AuthorizeVerdict` (`identity-do.ts:944`) against a five-field interface at `:80-86`, and `responseFor` (`:725-757`) reads only `verdict` and `enforceAuthorize`. Worth pinning now, before IT-ATTR-07 adds the first extra field — note the whole object is also written to DO storage as `CachedAuthorizeVerdict` (`:151-155`), so extra fields do persist there unread.
- **Tests:** `gateway/src/identity-do.test.ts` · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-OCPP-03** — Extend AuthorizeReason without widening the wire verdict
`apps/api/src/routes/internal/ocpp-authorize.ts` · **Change** edit · **Pkg** E03,F03 · **Scen** 76,79 · **When** blocked · **Approval** none
- **Accept:** blocked on IT-ATTR-07. New reasons join the union at `ocpp-authorize.ts:56-73` while the four wire verdicts stay exactly Accepted, Blocked, Expired, Invalid (`:40`). The existing design already separates the two — `no_contract` and `no_billable_clauses` are distinct reasons that both return Blocked — and this task must not break that separation. A reason is operator-facing metadata; OCPP 1.6 has no field for it.
- **Tests:** `apps/api/src/routes/internal/ocpp-authorize.test.ts` · **Pre/mig:** none · **Rollback:** revert · **Codex:** richer reason strings on the debug page

**IT-OCPP-04** — Invalidate the gateway verdict cache when a token is revoked
`apps/api/src/domains/identity/repositories/id-tokens.ts` `apps/api/src/lib/dispatch-targets.ts` · **Change** edit · **Pkg** E13,F03 · **Scen** 82,85 · **When** do-now · **Approval** none
- **Accept:** `revokeIdToken` (`id-tokens.ts:229-238`) currently flips status and returns. The endpoint to call already exists and works — `POST /invalidate-authorize/:id` (`gateway/src/index.ts:72-87`, handler `identity-do.ts:869-898`, idempotent, accepts `{ idTag }` or `{ all: true }`) — but grepping `apps/api/src` for `invalidateAuthorize` or `invalidate-authorize` returns zero hits, and `env.OCPP_GATEWAY` is bound only in `lib/dispatch-targets.ts:137`. Accept when revocation triggers the call and a revoked token stops authorising immediately rather than after up to 60 s of DO cache.
- **Tests:** `id-tokens.test.ts` plus `gateway/src/identity-do.test.ts` invalidation cases · **Pre/mig:** none · **Rollback:** revert; behaviour returns to 60 s staleness · **Codex:** the revoke button can honestly claim immediate effect

**IT-OCPP-05** — Give the local auth list a removal counterpart
`apps/api/src/repositories/local-auth-list-push.ts` `apps/api/src/routes/admin/chargers.ts` · **Change** new · **Pkg** E15,F03 · **Scen** 82 · **When** do-now · **Approval** Andri
- **Accept:** `pushIdTokenToCharger` (`local-auth-list-push.ts:74`) has no inverse anywhere in the repo. A token pushed to a charger's local list keeps authorising during offline windows indefinitely after revocation — the push path's own comment acknowledges the mechanism (`:117-121`, `LocalAuthorizeOffline=true` on Zaptec defaults). Accept when a Differential removal can be enqueued and the roster read (`charger-technical-read.ts:139` `getLocalAuthRosterForInstallation`) reflects it. IT-OCPP-04 alone does NOT close this hole.
- **Tests:** the new push/remove test file from IT-ATTR-18 · **Pre/mig:** none · **Rollback:** stop offering removal; state does not regress · **Codex:** the roster view can offer per-entry removal

**IT-OCPP-06** — Write the staged enforceAuthorize runbook
`docs/runbooks/enforce-authorize.md` (new) · **Change** decision · **Pkg** F02 · **Scen** 87-90 · **When** blocked · **Approval** Andri
- **Accept:** blocked on IT-OCPP-01 (there is no evidence to review before flipping). The runbook must name one installation to go first, the verdict-count thresholds that permit the flip, the rollback command, and the cache consequence: flipping the flag does not clear cached verdicts, so `POST /invalidate-authorize` with `{ all: true }` is a required step — the F21 enforcement memo is deliberately NOT cleared by that call (`identity-do.ts:875-880`) and refreshes only on the next successful lookup.
- **Tests:** none — ops · **Pre/mig:** changes live charger behaviour at one site · **Rollback:** set the flag false and invalidate again · **Codex:** none

**IT-OCPP-07** — Define the reject-path contract the driver actually sees
`apps/api/src/routes/public/driver.ts` `gateway/src/identity-do.ts` · **Change** decision · **Pkg** F03 · **Scen** 79 · **When** do-now · **Approval** Andri
- **Accept:** a ruling that acknowledges OCPP 1.6 `idTagInfo` carries a status and nothing else — `responseFor` returns `{ idTagInfo: { status } }` for Authorize (`identity-do.ts:750`) and there is no field for a reason. So "driver sees a reason" cannot be delivered on the OCPP wire and needs an out-of-band surface (app push, or a driver-facing endpoint the app polls after a failed start). Decide which, or record that drivers get no reason at pilot.
- **Tests:** none — decision · **Pre/mig:** none · **Rollback:** n/a · **Codex:** determines whether the app can explain a refusal at all

**IT-OCPP-08** — Separate an availability refusal from a real deny
`gateway/src/identity-do.ts` · **Change** edit · **Pkg** F03,R02 · **Scen** 79 · **When** do-now · **Approval** Andri
- **Accept:** `AVAILABILITY_REFUSAL_STATUS` is literally `"Blocked"` (`identity-do.ts:326`), identical on the wire to a genuine deny; the only separation is the `availabilityRefusal` log field at `:698`. Either accept this permanently in writing (with alerting keyed on that log field, as the comment at `:695-698` already proposes) or choose a different OCPP status for the outage case. The observable either way: an operator reading a charger's replies can tell an outage from a fraud signal.
- **Tests:** `gateway/src/identity-do.test.ts` · **Pre/mig:** changing the status changes charger behaviour during outages — do not do this silently · **Rollback:** revert the constant · **Codex:** a distinct "we could not verify you" message

**IT-OCPP-09** — Never infer EVCCID or EMAID from meter data
`apps/api/src/repositories/session-full-detail.ts` `apps/api/src/repositories/vehicle-id-sessions.ts` · **Change** test · **Pkg** F09 · **Scen** 79,98 · **When** do-now · **Approval** none
- **Accept:** an assertion that vehicle identity is only ever read from the dedicated columns and never inferred from meter samples. Current state supports this: `buildVehicleIdentity` (`session-full-detail.ts:519`) builds `confidenceTier` from `evPlcMac` / `pnc*` columns plus `classifyIdTagFormat(idTag)`, and `listVehicleIdSessions` filters on `ev_plc_mac`, `auth_id_value` or `pnc_attempted` (`vehicle-id-sessions.ts:85-91`) — neither touches sample rows. Freeze it with a test, because the classifier's EMAID branch (`idtag-classifier.ts:129-143`) makes inference tempting.
- **Tests:** new test file beside `session-full-detail.ts` — none exists today · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-OCPP-10** — Retain signed meter values regardless of attribution
`apps/api/src/lib/ocmf.ts` `apps/api/src/repositories/session-full-detail.ts` · **Change** test · **Pkg** F10 · **Scen** 80 · **When** do-now · **Approval** none
- **Accept:** an assertion that a session with unknown attribution keeps its signed meter evidence — retention is not conditioned on knowing who charged. This is the counterweight to IT-ATTR-17: refusing to name a person must not become a reason to discard evidence.
- **Tests:** new test file · **Pre/mig:** none · **Rollback:** n/a · **Codex:** the evidence bundle stays complete for anonymous sessions

**IT-OCPP-11** — Move enforceAuthorize from Installation to ChargingStation
`apps/api/src/routes/admin/chargers.ts` `apps/api/src/routes/internal/ocpp-authorize.ts` `prisma/schema/assets.prisma` · **Change** schema · **Pkg** F04 · **Scen** 87-90 · **When** blocked · **Approval** Andri
- **Accept:** blocked behind IT-OCPP-06 — relocating the flag before the first staged rollout changes the unit of rollout mid-flight. The resolver walks `ocppIdentity -> chargingStation -> installation -> enforceAuthorize` (`ocpp-authorize.ts:139-153`), so the relocation shortens that chain by one hop and touches the default-to-false behaviour at `:152` that keeps unwired identities in shadow mode. Accept when a per-station flag governs and no installation-level read remains.
- **Tests:** `ocpp-authorize.test.ts` plus `apps/api/test/parity/chargers-repository.test.ts` · **Pre/mig:** column move with a backfill from the parent installation · **Rollback:** keep both columns during transition and prefer the installation value · **Codex:** per-charger enforcement toggle in the UI

**IT-OCPP-12** — Run bench H1 and H2 and record the answers
`docs/domain/onboarding/12-verification-and-hardware.md` · **Change** decision · **Pkg** F05,F06 · **Scen** 87,88 · **When** blocked · **Approval** Andri
- **Accept:** blocked on hardware access. H1: does a charger in free-vend mode demand a non-empty idTag? H2: what happens when one technical token is presented on two EVSEs at once? H2 in particular is the empirical half of IT-ATTR-20 — the software half cannot disambiguate because the gateway invents its transaction id (`identity-do.ts:961`) and never ingests it. Record answers as observations with charger firmware version, not as inferences.
- **Tests:** none — bench · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-OCPP-13** — Run bench H3 and H4 and record the answers
`docs/domain/onboarding/12-verification-and-hardware.md` · **Change** decision · **Pkg** F07,F08 · **Scen** 89,90 · **When** blocked · **Approval** Andri
- **Accept:** blocked on hardware access. H3: does a RemoteStartTransaction with a marker idTag echo that idTag back on StartTransaction? H4: how do OCPP 1.6 and 2.0.1 differ in `idTagInfo` handling with `enforceAuthorize` true? H3 decides whether app-initiated starts can be attributed at all through the `virtual_rfid` token kind (`prisma/schema/identity.prisma:247-252`).
- **Tests:** none — bench · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none

**IT-OCPP-14** — Wire a test runner into CI so any of these tests can gate a merge
`.github/workflows/check.yml` `scripts/check-all.mjs` `package.json` · **Change** ci · **Pkg** P-group · **Scen** 65,66 · **When** blocked · **Approval** Andri
- **Accept:** blocked on a decision Andri must make, and it blocks the acceptance criteria of most tasks in all four of my groups. Today `.github/workflows/check.yml` runs exactly `npm install`, `npm run db:generate`, `npm run check`, and `scripts/check-all.mjs:14-35` lists nine offline checks with no test runner among them — so `ocpp-authorize.test.ts`, `permissions.test.ts`, `projections.test.ts` and every parity test under `apps/api/test/parity/` are run by hand or not at all. The DB-backed parity tests additionally need a `DATABASE_URL` secret, which the workflow's own comment block explains does not exist and should not be added casually: it triggers on `push: **` and on `pull_request`, so a staging credential would be reachable from every branch. Accept when either offline vitest runs in CI, or the packet records in writing that "in CI" is not available and each acceptance criterion names its manual runner instead.
- **Tests:** the workflow itself · **Pre/mig:** none · **Rollback:** remove the step · **Codex:** none
# Appendix 19B — part 3 of 5: implementation task map

Groups covered: **SESS** (charge-session attribution / dispute correction),
**ONB** (organisation onboarding aggregate), **CHG** (charger onboarding safety),
**DAR** (driver access requests).

Branch `docs/singular-onboarding-domain-packet`, tip `fc071b3`. Every path below was
opened and read at that tip. Line numbers are from that read.

---

## SESS — Charge-session attribution and dispute correction (13)

Half hardening, half greenfield. The **read** side exists and works — `listSessionLedger`,
`getSessionDetail`, `getSessionFullDetail`, `listDriverActualSessions` — but its tenant
scoping is a `TODO` in a comment (`billing.ts:51-56`) and the repository openly says it
trusts its caller (`session-ledger.ts:16-18`). The **correction** side does not exist at
all: greps for `session_correction`, `correctionEvent` and `ledger_correction` across
`*.ts`, `*.prisma` and `*.sql` return zero hits outside `docs/`, and the only thing in the
repo that mutates a settled ledger row is `apps/api/scripts/backfill-session-costs.ts`,
which passes one object as both `create` and `update` to `sessionLedger.upsert` — an
unaudited in-place overwrite. The packet's framing of M02 as "make corrections not
overwrite" is backwards: there is nothing to make non-overwriting, there is only an
overwrite to forbid and a correction path to build. One packet correction is itself
wrong — `apps/api/src/repositories/session-ledger.test.ts` **does** exist (179 lines,
scope-translation and filter coverage); it is `session-detail.ts`, `session-full-detail.ts`,
`driver-invoices.ts`, `routes/admin/billing.ts` and `routes/public/driver.ts` that have none.

**IT-SESS-01** — Scope the billing session list to the caller's orgs
`apps/api/src/routes/admin/billing.ts` `apps/api/src/lib/auth/org-scope.ts` · **Change** edit · **Pkg** M06,M07 · **Scen** 95,96 · **When** do-now · **Approval** Andri
- **Accept:** `scopeFromQuery` (`billing.ts:57-67`) no longer returns a scope built from raw query params. A session whose only grant is `billing.read` in org A, calling `GET /api/admin/billing/sessions?orgId=<orgB>`, gets `403 {"error":"forbidden"}` and a body containing zero occurrences of the substring `driverIdTag`. Same session with no `orgId` param gets `{kind:"org"}` over its own orgs, never `{kind:"admin"}`. Pattern to copy verbatim: `active-sessions.ts:23` + `:48` (`resolveOrgScope` then `inArray(...orgIds)`).
- **Tests:** T-SESS-01a scope denial, T-SESS-01b implicit-scope default · **Pre/mig:** none, code only · **Rollback:** revert the commit; the old behaviour is strictly more permissive so no data migrates · **Codex:** the charge-log filter bar can finally be driven by user-supplied orgId without the frontend having to pre-validate.

**IT-SESS-02** — Deny cross-tenant reads on the two session-detail endpoints
`apps/api/src/routes/admin/billing.ts` · **Change** edit · **Pkg** M06 · **Scen** 96,98 · **When** do-now · **Approval** Andri
- **Accept:** `GET /api/admin/billing/sessions/:id` (`:86-95`) and `/sessions/:id/full` (`:101-111`) resolve the session's `orgId` before returning and answer `404 {"error":"not_found"}` — byte-identical to the existing miss branch — when the caller's `resolveOrgScope` excludes it. Never 403: a 403 leaks that the session id is real. `?include=raw` stays operator-only and additionally requires the scope to be `{all:true}`.
- **Tests:** T-SESS-02a foreign-session 404, T-SESS-02b 404 body equals unknown-id 404 byte for byte · **Pre/mig:** none · **Rollback:** revert · **Codex:** the session-detail modal can be opened from any list row without a client-side ownership pre-check.

**IT-SESS-03** — Add the missing unit test file for `session-detail.ts`
`apps/api/src/repositories/session-detail.test.ts` · **Change** test · **Pkg** M05,P-tests · **Scen** 98 · **When** do-now · **Approval** none
- **Accept:** New file exists and covers, against a hand-rolled fake Prisma client in the style of `session-ledger.test.ts`: (a) ledger cost wins over `session.costIncVatMinor` (`:156-159`); (b) `energyKwh` falls back to `energyWh/1000` at 3 dp when the ledger row is absent (`:150-154`); (c) OCMF `SignedSession` is preferred over `EnergyDetails` and sets `timeSeriesSource:"ocmf"` (`:118-131`); (d) `projectEnergyDetails` treats `Energy` as interval energy, so a `[1.012, 0.957, 0.954]` series yields a monotonically rising `cumulativeKwh`, not a falling one; (e) `chargeTimeSec + idleTimeSec === sum(intervals.durationSec)`.
- **Tests:** T-SESS-03 (five cases above) · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-SESS-04** — Add the missing unit test file for `session-full-detail.ts`
`apps/api/src/repositories/session-full-detail.test.ts` · **Change** test · **Pkg** M05,E12,F09 · **Scen** 98 · **When** do-now · **Approval** none
- **Accept:** Covers `buildVehicleIdentity` (`:519-570`) tier computation for all eight reachable `confidenceTier` strings including `"none"`; `ocmf.provenance` returns `"live"` iff `completedSessionRawJson` is non-null and `"backfilled"` otherwise (`:367-369`); `signedSessionRaw` and `rawCompletedSession` are `null` unless `opts.includeRaw` is true (`:361`, `:437-440`); `identityTypeLabel` returns the raw type string for an unmapped value (`:466`).
- **Tests:** T-SESS-04 · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-SESS-05** — Add the missing unit test file for `driver-invoices.ts`
`apps/api/src/repositories/driver-invoices.test.ts` · **Change** test · **Pkg** M07,E14 · **Scen** 95,96 · **When** do-now · **Approval** none
- **Accept:** Covers `listDriverActualSessions` (`:30`): the ledger cost overrides `sessions.cost_inc_vat_minor` when present and only when present (`:66-70`); `costIsk` is `null`, not `0`, for a never-costed session; `durationSec` is `null` when `endedAt` is null; `billingHomeName` is fed from `organizations.displayName` (`:83`) — assert that mapping explicitly, because the field name says "billing home" and the source is the session's org, which is not the same concept.
- **Tests:** T-SESS-05 · **Pre/mig:** none, this is the only Drizzle repo on the driver path so the fake must be a Drizzle query-builder stub · **Rollback:** delete the file · **Codex:** none.

**IT-SESS-06** — Route-level tests for the three admin session endpoints
`apps/api/src/routes/admin/billing.test.ts` · **Change** test · **Pkg** M06,P-tests · **Scen** 95,96 · **When** do-now · **Approval** none
- **Accept:** New file mounts `adminBilling` on a bare Hono app the way `apps/api/test/parity/org-email-domains.test.ts:52-68` mounts its router, and asserts the scope denials from IT-SESS-01 and IT-SESS-02 at the HTTP boundary, not just at the repo. Directory currently holds exactly one test file (`charging-stations.test.ts`) — this is the second.
- **Tests:** T-SESS-06 · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-SESS-07** — Bound the telemetry-sample window to the session
`apps/api/src/repositories/session-full-detail.ts` · **Change** edit · **Pkg** M05,E12 · **Scen** 98 · **When** do-now · **Approval** none
- **Accept:** The `liveSessionSample.findMany` at `:249-262` matches on `chargerId` plus `observedAt` between `startedAt` and `endedAt`. When `endedAt` is null it currently falls back to `new Date()`, so an in-progress or never-closed session absorbs every later sample on that charger — including samples belonging to the next driver's session. After the change, a null `endedAt` caps the window at `startedAt + N` (N a named constant, not an inline literal) or at the `startedAt` of the next session on the same `chargingStationId`, whichever is earlier. Observable: given two sequential sessions on one charger where the first has `endedAt = null`, `getSessionFullDetail(first).samples` contains no sample whose `observedAt >= second.startedAt`.
- **Tests:** T-SESS-07 sample-bleed case · **Pre/mig:** none · **Rollback:** revert; the previous behaviour returns a superset so no stored data changes · **Codex:** the session power chart stops showing a second car's draw on the first car's session.

**IT-SESS-08** — Stop rounding invoice energy to one decimal place
`apps/api/src/repositories/driver-invoices.ts` · **Change** edit · **Pkg** M07,E14 · **Scen** 95,96 · **When** do-now · **Approval** Andri
- **Accept:** `whToKwh` (`:28`) computes `Math.round(Number(wh)/100)/10` — one decimal. `reports.session_ledger.energy_kwh` is `Decimal(10,3)` (`prisma/schema/commercial.prisma:307`) and `getSessionDetail` returns three (`session-detail.ts:153`). After the change, for a session with `energy_wh = 12130`, `/api/driver/invoices` returns `12.13` and `/api/driver/sessions/:id` returns `"12.130"` — the two surfaces agree to three decimals. `DriverInvoiceSession.energyKwh` stays `number`; only the precision changes. This is a wire-visible change to a shipped endpoint, hence Andri.
- **Tests:** T-SESS-08 cross-surface precision equality · **Pre/mig:** none, read-side only · **Rollback:** revert · **Codex:** invoice line totals stop failing to reconcile against the session list by up to 0.05 kWh per row.

**IT-SESS-09** — Decide the wire unit of `costIsk` on driver surfaces
`apps/api/src/repositories/driver-sessions.ts` `apps/api/src/repositories/driver-invoices.ts` `apps/api/src/lib/tariff/compute-session-cost.ts` · **Change** decision · **Pkg** M07,E14 · **Scen** 95,96 · **When** do-now · **Approval** Andri
- **Accept:** A written decision, recorded as an ADR, that resolves the contradiction: `compute-session-cost.ts` documents `cost_isk_minor` as aurar and its `formatIskMinor` divides by 100, while `driver-sessions.ts:95-98` `minorToIsk` returns `Number(minor)` undivided under the comment "ISK has no minor unit". `driver-invoices.ts:21` documents aurar correctly and still returns the raw value under the same `costIsk` key. The decision must name which of the two is the contract, and must explicitly dispose of `driver-sessions.test.ts:246`, which asserts `costIsk: 64988` and therefore locks the current behaviour in place. Do not change code under this task — the fix is a follow-on that also touches the Flutter renderer, which is outside this repo.
- **Tests:** none — the deliverable is the ADR · **Pre/mig:** none · **Rollback:** n/a · **Codex:** until this lands, no driver-facing money figure can be trusted to a factor of 100.

**IT-SESS-10** — Create the ledger-correction table
`prisma/schema/commercial.prisma` `packages/shared/src/db/commercial.ts` `prisma/migrations/<ts>_session_ledger_corrections/migration.sql` · **Change** schema · **Pkg** M02,E09 · **Scen** 91,92,94 · **When** do-now · **Approval** DBA
- **Accept:** A new append-only table in the `reports` schema keyed by `session_id`, carrying at minimum: the previous and the new value of each corrected field, `reason`, `actor_user_id` (NOT NULL), `actor_kind`, `created_at`, and a monotonic `sequence` per session. Declared in **both** `prisma/schema/commercial.prisma` and `packages/shared/src/db/commercial.ts` — `scripts/check-all.mjs` runs `check:schema-consistency`, which compares the two, so a single-sided declaration fails the offline gate. No `UPDATE` or `DELETE` grant is required by any code path. Note that `session_ledger` is keyed `sessionId @id` (`commercial.prisma:298`) with no version column, so the correction row is the only history that will exist.
- **Tests:** T-SESS-10 schema-consistency passes; `apps/api/test/parity/schema-columns.test.ts` extended with the new columns · **Pre/mig:** forward-only migration, additive, no backfill · **Rollback:** drop table; nothing references it until IT-SESS-11 · **Codex:** none yet.

**IT-SESS-11** — Add the correction command endpoint
`apps/api/src/routes/admin/billing.ts` `apps/api/src/repositories/session-corrections.ts` · **Change** new · **Pkg** M02,M03,M04 · **Scen** 91,92,93,94,97 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-SESS-10 (the table does not exist) and on IT-SESS-01 (without tenant scoping this endpoint would let any `billing.read` holder rewrite another tenant's money). Once unblocked: `POST /api/admin/billing/sessions/:id/corrections` writes one correction row and one `audit.actions` row via `recordAuditAction` with `actorUserId` = the operator (never the driver — scenario 94), then applies the new values to `session_ledger`. Observable: after the call, the correction table holds a row whose `previous_*` fields equal the pre-call ledger values, and `SELECT count(*)` on the correction table for that session equals the number of calls made. Replaying the identical body is a no-op that returns the existing correction, not a second row.
- **Tests:** T-SESS-11a correction emitted, T-SESS-11b replay is idempotent, T-SESS-11c actor is the operator · **Pre/mig:** requires IT-SESS-10 migration applied · **Rollback:** unmount the route; correction rows already written stay and remain readable · **Codex:** the dispute UI gets a real write surface; M06's queue becomes a list over this table.

**IT-SESS-12** — Make the cost-backfill script refuse to touch attribution columns
`apps/api/scripts/backfill-session-costs.ts` · **Change** edit · **Pkg** M02,M08 · **Scen** 91,92 · **When** do-now · **Approval** Andri
- **Accept:** The script builds one `data` object and passes it as both `create` and `update` to `sessionLedger.upsert` (`:176-199`), so a `--commit` run rewrites `driver_user_id` from `s.userId` — null for every OCPP-origin session — and `driver_id_tag` from `s.ocppIdentity?.identityString` (`:185`), which is the charger's identity, not a driver token. After the change the `update` branch is a distinct object listing only cost and energy fields; `driverUserId` and `driverIdTag` appear in the `create` branch only. Observable: run with `--commit` against a row that already has a non-null `driver_user_id` and the value is unchanged afterwards. Andri because this reverses how a script that has been run against real data behaves.
- **Tests:** T-SESS-12 update-branch field set asserted against a fixture · **Pre/mig:** no migration; any row already clobbered by a past run is not repaired by this task — repair needs IT-SESS-11 · **Rollback:** revert; the previous behaviour is destructive so rolling back is not advisable · **Codex:** none.

**IT-SESS-13** — Reconcile the ledger after a CDR/OCPP cost mismatch
`apps/api/src/repositories/zaptec-session-sync.ts` `apps/api/src/repositories/session-detail.ts` · **Change** edit · **Pkg** M02,M03 · **Scen** 91,93 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-SESS-11 — the fix must emit a correction, not an overwrite, and the correction path does not exist yet. The defect: `zaptec-session-sync.ts:306-332` overwrites `sessions.energy_wh`, `stop_reason` and both cost columns with CDR figures, while the paired `sessionLedger.upsert` update block (`:467-470`) sets only `verifiedSource` and `enrichmentStatus`. Both detail readers then prefer the stale ledger value (`session-detail.ts:156-159`, `session-full-detail.ts:318-321`), so one session shows two costs. Re-running does not help: `importOne` short-circuits on `already_imported` (`:138-145`). Observable after the fix: for any session with `enrichment_status = 'mismatch'`, `getSessionDetail(...).costIskMinor` equals `sessions.cost_inc_vat_minor`, and a correction row records the transition.
- **Tests:** T-SESS-13 mismatch reconciliation, plus an extension to the existing `zaptec-session-sync.test.ts` · **Pre/mig:** existing mismatch rows need a one-off reconciliation pass — treat as a separate authorised run, not part of this task · **Rollback:** revert the reader preference first, then the writer · **Codex:** the charge-log stops showing a cost that contradicts the CDR the operator can see in the Zaptec portal.

---

## ONB — Organisation onboarding aggregate (14)

Entirely greenfield, and the packet's framing as hardening is wrong. There is no
`onboarding_workflow`, `onboarding_step` or `onboarding_substep` anywhere — the grep
returns nothing outside `docs/`. There is no `/onboarding` sub-route on
`apps/api/src/routes/admin/orgs.ts`, no status machine, no version column, no `If-Match`
handling anywhere in `apps/api/src` (the only `etag` hit in the whole tree is a string
literal in `queues/archive-events.test.ts:63`), and no HTTP idempotency-key store. What
exists instead is `POST /api/admin/onboarding/chains` — one 60-second transaction that
creates Org through OcppIdentity and hands back a plaintext OCPP password once
(`onboarding-chains.ts:51-199`). It is a creation shortcut, not a workflow, and it has
zero test coverage. Two structural facts shape every task below: the chain sets no
`installationId` on the ChargingStation it creates (`:117-127`), so every chain-born
charger renders in the orphan bucket of the site tree (`site-tree.ts:722-725`); and
`assets.installations.onboarding_status` already exists as an enum
(`prisma/schema/assets.prisma:160`, values at `:229-236`) with nothing driving it.

**IT-ONB-01** — Create the `onboarding_workflow` table with a one-open-per-org index
`prisma/schema/identity.prisma` `packages/shared/src/db/identity.ts` `prisma/migrations/<ts>_onboarding_workflow/migration.sql` · **Change** schema · **Pkg** G01,G02 · **Scen** 99,100 · **When** do-now · **Approval** DBA
- **Accept:** Table carries `org_id`, `status`, `version INT NOT NULL DEFAULT 1`, `created_at`, `updated_at`, and actor columns. A partial unique index on `(org_id)` `WHERE status IN ('draft','ready','active','suspended')` exists in the migration SQL. Observable: two inserts for one org with `status='draft'` — the second raises a unique violation, not a second row. Declared in both Prisma and Drizzle so `npm run check:schema-consistency` (one of the nine checks in `scripts/check-all.mjs`) stays green.
- **Tests:** T-ONB-01 second-open rejected; `test/parity/schema-columns.test.ts` extended · **Pre/mig:** additive forward-only migration, no backfill — existing orgs simply have no workflow · **Rollback:** drop table and index; nothing reads it until IT-ONB-06 · **Codex:** none yet.

**IT-ONB-02** — Create `onboarding_step` with the seven step keys
`prisma/schema/identity.prisma` `packages/shared/src/db/identity.ts` · **Change** schema · **Pkg** G03 · **Scen** 99,103,104,105 · **When** do-now · **Approval** DBA
- **Accept:** One row per (workflow, step key), unique on that pair, carrying `state`, `required BOOLEAN`, `skip_reason TEXT NULL`, `completed_at`, `completed_by_user_id`. The seven keys are enumerated in one exported const in `packages/shared` and nowhere else — no string literals in route or repo code. Per ADR 0019 convention as stated at `prisma/schema/commercial.prisma:324-325`, use TEXT with application-layer validation rather than a Postgres enum.
- **Tests:** T-ONB-02 unique pair enforced, key list is single-sourced · **Pre/mig:** additive · **Rollback:** drop table · **Codex:** none yet.

**IT-ONB-03** — Create `onboarding_substep` with the thirteen substep keys
`prisma/schema/identity.prisma` `packages/shared/src/db/identity.ts` · **Change** schema · **Pkg** G04 · **Scen** 99,105 · **When** do-now · **Approval** DBA
- **Accept:** Same shape as IT-ONB-02, parented to `onboarding_step`, with `ON DELETE CASCADE`. A step cannot reach `complete` while a required substep under it is not complete — enforced in the repository, asserted by test, not by a DB trigger.
- **Tests:** T-ONB-03 parent-completion invariant · **Pre/mig:** additive · **Rollback:** drop table · **Codex:** none yet.

**IT-ONB-04** — Decide whether step provenance is a new event log or `audit.actions`
`apps/api/src/lib/audit.ts` `packages/shared/src/db/platform.ts` · **Change** decision · **Pkg** G05 · **Scen** 99,109,110 · **When** do-now · **Approval** Andri
- **Accept:** A written decision resolving 18A's open flag on G05. The existing `recordAuditAction` (`lib/audit.ts:58`) already writes `orgId`, `actorUserId`, `actorKind`, `action`, `targetType`, `targetId`, `metadata` and accepts either a Prisma or a Drizzle handle, so a separate event table needs a reason to exist. The decision must state which of the two carries the reopen event required by scenario 109 and the `nextActor` provenance required by scenario 110, and must be made **before** IT-ONB-05 through IT-ONB-13, because every one of them writes provenance.
- **Tests:** none — the deliverable is the decision · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-ONB-05** — Build the workflow repository with an explicit state machine
`apps/api/src/repositories/onboarding-workflow.ts` · **Change** new · **Pkg** G07,G11,G12 · **Scen** 105,106,108,109 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-ONB-01/02/03 (tables) and IT-ONB-04 (provenance sink). The legal transitions are a single exported const map, not scattered `if`s: `draft→ready` only when every required step is `complete`; `ready→active`; `active→suspended`; `suspended→active`; any→`cancelled`; `cancelled→draft` on reopen with a version bump. An illegal transition returns a typed failure like the `AttachVendorError` pattern (`chargers.ts:775-783`), never throws a raw Prisma error. Observable: the transition map is exhaustively enumerated in one test that fails if a new status is added without a rule.
- **Tests:** T-ONB-05 exhaustive transition matrix · **Pre/mig:** none beyond the tables · **Rollback:** delete the file · **Codex:** none yet.

**IT-ONB-06** — Add `GET /api/admin/orgs/:orgId/onboarding`
`apps/api/src/routes/admin/orgs.ts` · **Change** new · **Pkg** G06 · **Scen** 111,112 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-ONB-05. Returns the summary shape with `status`, `version`, `steps[]`, `substeps[]` and `nextActor`. When no workflow row exists it returns `404 {"error":"no_workflow"}` — **not** a synthesised zero-progress summary, because scenario 112 requires the UI to say "this isn't tracked yet" rather than derive progress. Gated `requirePermission("org.write", {orgIdParam:"orgId"})` so the membership lookup actually runs; a verb with no `orgIdParam` resolves with `orgId = null` (`require-permission.ts:69-74`) and silently degrades to platform-grants-only.
- **Tests:** T-ONB-06a shape, T-ONB-06b absent-workflow 404 · **Pre/mig:** none · **Rollback:** unmount the route · **Codex:** the onboarding progress panel gets its read model, including the honest "not tracked" state.

**IT-ONB-07** — Add `POST /api/admin/orgs/:orgId/onboarding` (start or resume)
`apps/api/src/routes/admin/orgs.ts` `apps/api/src/lib/idempotency.ts` · **Change** new · **Pkg** G07 · **Scen** 99,101 · **When** blocked · **Approval** none
- **Accept:** Blocked twice over — on IT-ONB-05, and on the fact that **no HTTP idempotency-key infrastructure exists**. The only idempotency code in the repo is `batchInsertIdempotencyKeys` / `findExistingIdempotencyKeys` in `apps/api/src/lib/db/raw.ts`, which is the OCPP ingest key space and is not reusable here. So this task carries the cost of building a general `Idempotency-Key` store. Observable when done: two POSTs with the same `Idempotency-Key` header yield one workflow row and two byte-identical response bodies; a POST while an open workflow exists returns that workflow with `200`, not a `409` from the partial unique index.
- **Tests:** T-RACE-3 replay identity, T-ONB-07 resume-returns-existing · **Pre/mig:** new idempotency table — additive migration, DBA approval folded into IT-ONB-01's batch if they land together · **Rollback:** unmount route; idempotency table can stay · **Codex:** the "Start onboarding" button becomes safely double-clickable.

**IT-ONB-08** — Add `PATCH …/onboarding/steps/:stepKey` with If-Match
`apps/api/src/routes/admin/orgs.ts` `apps/api/src/lib/http/if-match.ts` · **Change** new · **Pkg** G08 · **Scen** 102 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-ONB-05 and on there being no `If-Match` handling anywhere in `apps/api/src` — this task introduces the first. The workflow `version` column from IT-ONB-01 is the ETag source. Observable: a PATCH carrying a stale `If-Match` returns `409 {"error":"version_conflict"}` and the body includes the current aggregate so the client can rebase without a second round trip; a PATCH with no `If-Match` at all returns `428` rather than silently succeeding. Every successful PATCH increments `version` by exactly one.
- **Tests:** T-ONB-08a stale 409 carries current aggregate, T-ONB-08b missing header 428, T-ONB-08c version monotonic · **Pre/mig:** none beyond IT-ONB-01 · **Rollback:** unmount route · **Codex:** concurrent operators editing one org's checklist stop overwriting each other.

**IT-ONB-09** — Enforce skip-with-reason and step requiredness
`apps/api/src/repositories/onboarding-workflow.ts` · **Change** new · **Pkg** G10,G03 · **Scen** 103,104 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-ONB-05. A skip on a step whose `required` is true returns `422 {"error":"step_not_skippable"}`. A skip on an optional step with an empty or whitespace-only reason returns `400`; the trim-then-check pattern already used by `denyRequest` (`driver-access-requests.ts:695-698`) is the reference. A successful skip persists the reason — a skipped step with a null `skip_reason` must be unreachable through the API.
- **Tests:** T-ONB-09a required-skip 422, T-ONB-09b blank-reason 400, T-ONB-09c persisted reason non-null · **Pre/mig:** none · **Rollback:** revert · **Codex:** the skip dialog can require a reason and trust the server to agree.

**IT-ONB-10** — Enforce that only an `active` workflow confers access
`apps/api/src/routes/public/driver.ts` `apps/api/src/repositories/driver-access-requests.ts` `apps/api/src/repositories/invites.ts` · **Change** edit · **Pkg** G09 · **Scen** 107,108 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-ONB-05. Two halves, and they must not be conflated. (a) Redemption of an invite into an org whose workflow is not `active` is refused — `POST /api/driver/redeem-invite` (`driver.ts:1158`) returns the same generic `not_found` body it already returns for a bad token, so refusal reason is not observable. (b) Suspending an active workflow must **not** revoke existing `DriverGroupMembership` rows — scenario 108 is explicit. Observable: after suspend, `SELECT count(*)` on `agreements.driver_group_memberships` for that org is unchanged, while a fresh redemption is refused. Andri because (a) changes the outcome of a shipped endpoint for orgs that have no workflow row at all — decide explicitly whether "no workflow" means allow or deny.
- **Tests:** T-ONB-10a pre-activation redemption refused, T-ONB-10b suspend preserves memberships · **Pre/mig:** the allow-or-deny choice for workflow-less orgs is a rollout gate, not a migration · **Rollback:** feature-flag the check off; it is a pure guard · **Codex:** none.

**IT-ONB-11** — Record staff-vs-org actor on every workflow transition
`apps/api/src/repositories/onboarding-workflow.ts` `apps/api/src/lib/auth/org-scope.ts` · **Change** new · **Pkg** G05,G11 · **Scen** 110 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-ONB-04 and IT-ONB-05. Each transition records whether the actor reached the org through a Membership or through a PlatformGrant — `resolveOrgScope` (`org-scope.ts:38`) and `resolveEffectivePermissions` already distinguish these, and `recordAuditAction` already has an `actorKind` field. The summary's `nextActor` is derived from the step definition, not from who happened to touch it last. Observable: a transition performed by a platform-grant holder produces provenance that names staff, and the same transition by an org member does not.
- **Tests:** T-ONB-11 staff vs member provenance · **Pre/mig:** none · **Rollback:** revert · **Codex:** the audit trail can show "Straumvakt staff advanced this step" honestly.

**IT-ONB-12** — Give the onboarding chain an Installation
`apps/api/src/repositories/onboarding-chains.ts` `packages/contracts/src/inputs/onboarding-chains.ts` `packages/shared/src/inputs/onboarding-chains.ts` · **Change** edit · **Pkg** G07 · **Scen** 113,116 · **When** do-now · **Approval** Andri
- **Accept:** `tx.chargingStation.create` (`onboarding-chains.ts:117-127`) sets no `installationId`, and `OnboardingChainInput` has no installation field, so every chain-born charger lands in `site-tree.ts:722-725`'s orphan bucket and can never use the per-installation OCPP password surface at `routes/admin/installations.ts:129-198`. After the change the chain creates an Installation inside the same transaction and links the station to it. Observable: `listSiteTree` for a chain-created site returns the new charger under an installation node, and `orphanChargers` is empty. `installationId` on ChargingStation is nullable (`prisma/schema/assets.prisma:254`) so no migration is needed. Andri because it changes the response shape and the semantics of an endpoint that already ran against real data — and because chargers already created by the chain stay orphaned unless a separate repair is authorised.
- **Tests:** T-ONB-12 chain output appears under an installation node · **Pre/mig:** no schema change; existing orphan rows are **not** repaired by this task · **Rollback:** revert; new rows keep their installation, which is harmless · **Codex:** chain-onboarded chargers become reachable from the installation OCPP-password UI.

**IT-ONB-13** — First tests for `createOnboardingChain`
`apps/api/src/repositories/onboarding-chains.test.ts` · **Change** test · **Pkg** G07 · **Scen** 99,113 · **When** do-now · **Approval** none
- **Accept:** `OnboardingChainInput` and `createOnboardingChain` have no test file at all — a grep for `OnboardingChainInput` outside `docs/` returns only the four source files. New file covers: all eight entities created in one transaction; `authSecretHash` is `sha256Hex(password)` and the plaintext appears only in the return value, never in an argument to a `create`; the audit row is written **outside** the transaction (`:183-196`) so an audit failure cannot roll back the chain; and the pending-discovery `deleteMany` is issued with the operator-supplied case (that is the bug IT-CHG-03 fixes — assert current behaviour here and update the assertion there).
- **Tests:** T-ONB-13 · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-ONB-14** — Publish the `OnboardingSummary` contract for Codex
`packages/contracts/src/inputs/onboarding-workflow.ts` · **Change** new · **Pkg** G06,O-codex · **Scen** 111,112 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-ONB-06 — there is nothing to describe until the endpoint exists, and blocked in a second sense too: the Next app under `src/app` contains only `home`, `org/[slug]`, `staff/overview` and the root page, so there is no surface to render this on. The former admin console lives under `archive/straumvakt-org-console-2026-08-08/`. Deliverable is a zod schema in `packages/contracts` plus a re-export shim in `packages/shared/src/inputs/` — the pattern every other input file in those two directories already follows — so the shape is checkable offline by `npm run check:schemas`.
- **Tests:** T-ONB-14 schema parses a golden fixture of the IT-ONB-06 response · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** this is the handoff artefact; without it the frontend is guessing.

---

## CHG — Charger onboarding safety (10)

Hardening, and further along than 18A's Group H assumes. **H05 is already done**:
`attachVendorToOcppIdentity` (`chargers.ts:800-940`) treats identical values as an
idempotent update, raises `conflict_vendor_resource_id` / `conflict_credentials_ref` on
divergence, the route maps both to 409 (`routes/admin/chargers.ts:349-351`), and
`routes/admin/charging-stations.test.ts` exercises every code — so scenario 114 is a
verification task, not a build. **H04 is not a defect but a disagreement**: three separate
code paths return the OCPP password on purpose, each with a comment saying so
(`onboarding-chains.ts:198`, `chargers.ts:645`, `installation-ocpp.ts:105-108`), and
patching them without a decision would break the only way an operator ever learns the
password. The genuinely broken things are smaller and unglamorous: a case-sensitivity bug
that leaves provisioned chargers in the pending pool, three write paths that throw away the
actor, and three hard-delete cascades with no audit row.

**IT-CHG-01** — Verify and lock in vendor-attach idempotency
`apps/api/src/repositories/chargers.ts` `apps/api/src/routes/admin/charging-stations.test.ts` · **Change** test · **Pkg** H05 · **Scen** 114 · **When** do-now · **Approval** none
- **Accept:** Do **not** implement H05 — it exists. This task confirms it and stops it regressing. Add the one case the existing suite does not cover: attach called twice with byte-identical `{vendor, vendorResourceId, credentialId}` returns `200` both times, the second call writes no second `audit.actions` row, and `ocpp_identities` shows one row unchanged between the two calls. Also assert all seven `AttachVendorErrorCode` values (`chargers.ts:766-773`) are reachable, so a new code cannot be added without a test.
- **Tests:** T-CHG-01 replay-safe attach, exhaustive error-code coverage · **Pre/mig:** none · **Rollback:** delete the added cases · **Codex:** the attach button can retry on network failure without a confirmation dialog.

**IT-CHG-02** — Decide the OCPP-password disclosure contract
`apps/api/src/repositories/onboarding-chains.ts` `apps/api/src/repositories/chargers.ts` `apps/api/src/repositories/installation-ocpp.ts` · **Change** decision · **Pkg** H04 · **Scen** 116 · **When** do-now · **Approval** Andri
- **Accept:** A written decision, recorded as an ADR, that either (a) keeps one-shot plaintext return and rewrites scenario 116 to "the password appears in exactly one response and never in a log line or an audit `metadata` blob", or (b) removes it and names the replacement delivery channel. Three implementations currently contradict H04 deliberately: `createOnboardingChain` returns `ocppPassword` (`:198`, surfaced at `routes/admin/onboarding.ts:21-28`), `createCharger` returns it (`chargers.ts:645`), and `rotateInstallationOcppPassword` returns `plaintext` (`installation-ocpp.ts:135`) under a comment that says the only recovery is another rotation. Option (b) has no replacement channel today, so choosing it creates work that is not yet scoped. Do not patch code under this task.
- **Tests:** none — the deliverable is the ADR · **Pre/mig:** none · **Rollback:** n/a · **Codex:** the "copy this password now" modal either stays or needs redesigning; the frontend cannot decide.

**IT-CHG-03** — Fix the pending-discovery case mismatch on both delete paths
`apps/api/src/repositories/onboarding-chains.ts` `apps/api/src/repositories/chargers.ts` `apps/api/src/repositories/pending-discoveries.ts` · **Change** edit · **Pkg** H-provisioning · **Scen** 113 · **When** do-now · **Approval** none
- **Accept:** `upsertPendingDiscovery` lowercases the key before writing (`pending-discoveries.ts:98`, with a comment explaining why), but both provisioning paths delete on the raw operator-supplied string: `onboarding-chains.ts:166-168` and `chargers.ts:579-581`. `IDENTITY_RE` (`packages/contracts/src/inputs/onboarding-chains.ts:5`) permits `A-Z`. Observable: seed a pending row for `zpr074002`, provision `ZPR074002`, then `listPendingDiscoveries` returns zero rows for that identity. Both call sites must lowercase — fixing one leaves the other broken.
- **Tests:** T-CHG-03 mixed-case provisioning clears the pending row, asserted through both the Prisma path and the Drizzle path · **Pre/mig:** existing stranded pending rows are not cleaned by this task; a one-off cleanup needs separate authorisation · **Rollback:** revert; the failure mode is a stale pending row, not data loss · **Codex:** the pending-chargers list stops showing chargers that were successfully onboarded.

**IT-CHG-04** — Pass the real actor on the charger and chain write paths
`apps/api/src/routes/admin/chargers.ts` `apps/api/src/routes/admin/onboarding.ts` · **Change** edit · **Pkg** H03,N-audit · **Scen** 113,115 · **When** do-now · **Approval** none
- **Accept:** Three call sites pass a literal `null` while a live session sits in `c.get("session")`: `createCharger(db, parsed.data, null)` (`chargers.ts:68`), `updateCharger(…, null)` (`:272`), and `createOnboardingChain(db, parsed.data, null)` (`onboarding.ts:20`). The correct pattern is already used three times over in `routes/admin/installations.ts:137`, `:163`, `:191` (`c.var.session.userId ?? null`). Observable: after a charger create by a logged-in non-bootstrap user, the `audit.actions` row for `charger.create` has a non-null `actor_user_id`. Note that a bootstrap session legitimately has no `userId` (`require-permission.ts:147-151`), so null must stay legal — the assertion is on the real-user case.
- **Tests:** T-CHG-04 actor recorded on create/update/chain · **Pre/mig:** none; past audit rows keep their null actor · **Rollback:** revert · **Codex:** the audit panel stops showing "unknown" against every charger creation.

**IT-CHG-05** — Audit and soft-delete the charger cascade
`apps/api/src/repositories/chargers.ts` `prisma/schema/assets.prisma` `packages/shared/src/db/assets.ts` · **Change** edit · **Pkg** H07 · **Scen** 117 · **When** do-now · **Approval** Andri
- **Accept:** `deleteCharger` (`chargers.ts:752-754`) is one `db.delete(siteAssets)` relying on FK cascade to wipe ChargingStation, EVSE, Connector and OcppIdentity, and — unlike `createCharger` (`:591-603`) and `updateCharger` (`:694-702`) — writes no `recordAuditAction`. Two changes: add the audit call, and add a soft-delete column so history survives. Observable: after a delete, `audit.actions` holds a `charger.delete` row naming the actor and listing the cascaded child ids in `metadata`, and the session rows referencing that station still resolve a charger display name in `session-ledger.ts:154-158`. Andri because it changes what "delete" means on a shipped endpoint. Do **not** reuse `decommissioned` as the anchor — that flag is derived from Zaptec on the list path and means something else.
- **Tests:** T-CHG-05a audit row written, T-CHG-05b historical session detail still names the charger · **Pre/mig:** additive nullable column; existing hard-deleted chargers are unrecoverable and stay so · **Rollback:** the audit call reverts cleanly; the column can stay unused · **Codex:** the delete confirmation can honestly say "hidden, not destroyed".

**IT-CHG-06** — Audit the installation and site delete cascades
`apps/api/src/repositories/installations.ts` `apps/api/src/repositories/sites.ts` · **Change** edit · **Pkg** H07 · **Scen** 117 · **When** do-now · **Approval** Andri
- **Accept:** `deleteInstallation` (`installations.ts:154-170`) deletes every SiteAsset under it plus its circuits, and `deleteSite` (`sites.ts:146-157`) deletes every SiteAsset in the site and lets the FK cascade reach Installation and Circuit — both inside 60-second transactions, both with no audit row. `sites.ts` already knows how to write one (`:476`), so the pattern is in the same file. Observable: one `installation.delete` / `site.delete` audit row per call, with the counts of cascaded children in `metadata`, written inside the same transaction so a rollback discards it too. Andri because these are irreversible operations whose blast radius is currently invisible after the fact.
- **Tests:** T-CHG-06 audit rows with accurate child counts · **Pre/mig:** none · **Rollback:** revert · **Codex:** the cascade warning dialog can quote real counts.

**IT-CHG-07** — Validate org and site consistency on charger create
`apps/api/src/routes/admin/chargers.ts` `apps/api/src/repositories/chargers.ts` · **Change** edit · **Pkg** H-tenancy · **Scen** 113 · **When** do-now · **Approval** none
- **Accept:** `requirePermission("charger.write")` is declared with no `orgIdParam`, so it resolves with `orgId = null` (`require-permission.ts:69-74`) and `resolveEffectivePermissions` skips the membership lookup entirely — only platform grants or a bootstrap session pass. Nothing then checks that `input.orgId` and `input.siteId` are consistent with each other or with the caller. Observable: `POST /api/admin/chargers` with an `orgId` that does not own the given `siteId` returns `400 {"error":"org_site_mismatch"}` instead of creating a charger whose `SiteAsset.orgId` contradicts its `Site.orgId`. Same check on the chain input.
- **Tests:** T-CHG-07 mismatched org/site rejected · **Pre/mig:** none; pre-existing inconsistent rows are not detected by this task · **Rollback:** revert · **Codex:** the create form can rely on server-side validation instead of pre-filtering site options.

**IT-CHG-08** — Add a charger availability status and honour it in the driver list
`prisma/schema/assets.prisma` `packages/shared/src/db/assets.ts` `apps/api/src/routes/public/driver.ts` · **Change** schema · **Pkg** H01,H02 · **Scen** 119 · **When** do-now · **Approval** DBA
- **Accept:** A three-value availability status (`operational` / `maintenance` / `retired`) on the charging station, TEXT with application-layer validation per the ADR 0019 convention noted at `prisma/schema/commercial.prisma:324-325`, defaulted to `operational` so no backfill is required. `GET /api/driver/chargers` (`driver.ts:238`) excludes anything not `operational`. Observable: a charger flipped to `maintenance` disappears from the driver list response while remaining present in `GET /api/admin/chargers`. Do not overload `assets.installations.onboarding_status` (`prisma/schema/assets.prisma:160`) — that is installation-level and means something different.
- **Tests:** T-CHG-08 maintenance hidden from drivers, visible to operators · **Pre/mig:** additive with a default; declare in both Prisma and Drizzle or `check:schema-consistency` fails · **Rollback:** stop filtering; the column can stay · **Codex:** the driver charger list stops offering chargers that are physically out of service.

**IT-CHG-09** — Surface technical-read failures legibly
`apps/api/src/routes/admin/chargers.ts` `apps/api/src/repositories/charger-technical-read.ts` · **Change** edit · **Pkg** H06 · **Scen** 118 · **When** do-later · **Approval** none
- **Accept:** `GET /api/admin/chargers/:id/technical-read` authenticates to the vendor portal and fetches live state — a slow path with several distinct failure modes (no credential, credential inactive, vendor auth rejected, vendor timeout). After the change each returns a distinct machine-readable `error` code rather than a generic failure, following the `AttachVendorErrorCode` precedent (`chargers.ts:766-773`). Observable: the four failure modes produce four different `error` values and none of them is `internal`.
- **Tests:** T-CHG-09 four distinguishable failure codes · **Pre/mig:** none · **Rollback:** revert · **Codex:** the charger detail page can tell the operator which thing to fix instead of "something went wrong".

**IT-CHG-10** — CI guard against password leakage into logs and audit metadata
`scripts/check-secret-hygiene.mjs` `scripts/check-all.mjs` · **Change** ci · **Pkg** H04 · **Scen** 116 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-CHG-02 — a guard cannot be written before the contract is decided, and if option (a) is chosen the guard must permit the three deliberate response paths while forbidding everything else. Note that adding a check to `scripts/check-all.mjs` is genuinely additive: that script runs nine **offline** checks (`typecheck`, `schemas`, `api-schema`, `schema-consistency`, `deps`, `deps-graph`, `api-endpoints`, `unused-exports`, `work-view`) and `.github/workflows/check.yml` runs only `npm install`, `npm run db:generate`, `npm run check` — **no vitest runs in CI at all**, so any acceptance criterion phrased as "asserted in CI" needs a test step that has never existed. Observable when unblocked: a commit that adds `password` or `plaintext` to a `console.log` or to an audit `metadata` object fails `npm run check` locally with a named file and line.
- **Tests:** T-CHG-10 the guard fails on a deliberately planted violation · **Pre/mig:** none · **Rollback:** remove the entry from the `CHECKS` array · **Codex:** none.

---

## DAR — Driver access request submit, status, cancel, approve, deny (14)

Hardening, and the operator half is in better shape than the driver half. `approveRequest`
(`driver-access-requests.ts:470-661`) and `denyRequest` (`:681-780`) are careful:
transactional, audited, idempotent at two levels, org-guarded via
`expectedInstallationOrgId`, and covered by both a unit suite
(`driver-access-requests.test.ts`, 18 cases) and a real-DB parity suite
(`test/parity/driver-access-request-flow.test.ts`, 11 cases). The driver half is one
endpoint: `POST /api/driver/access-requests` (`driver.ts:867-932`). There is no
driver-side read, no cancel, and no rate limit. The `withdrawn` status is declared in both
schemas and accepted as a **filter** at `routes/admin/access-requests.ts:71`, but no code
anywhere writes it — a write-dead enum value. There is no `If-Match` on the approve/deny
PATCH, and no partial unique index backing the pending-dedupe check, so the dedupe is a
read-then-write race.

**IT-DAR-01** — Add the driver-side request status endpoint
`apps/api/src/routes/public/driver.ts` `apps/api/src/repositories/driver-access-requests.ts` · **Change** new · **Pkg** I04,B04 · **Scen** 45,134 · **When** do-now · **Approval** none
- **Accept:** `GET /api/driver/access-requests` behind `requireDriver` returns this driver's own requests only. The response must not carry org internals: no `orgId`, no reviewer email, no `orgEmailDomain` — `AccessRequestSummary` (`driver-access-requests.ts:96-113`) carries all three and is therefore the wrong DTO to reuse. Observable: the response body for a driver with a request into org A contains zero occurrences of any org A identifier other than the installation display name they already saw when requesting. Every approval and denial email already links to `/account/access-requests` (`buildDriverStatusUrl`, `:126`), a page with no backing endpoint.
- **Tests:** T-DAR-01a own-requests-only, T-DAR-01b no org fields in body · **Pre/mig:** none · **Rollback:** unmount the route · **Codex:** the driver "my requests" screen becomes buildable; today the email links to a dead end.

**IT-DAR-02** — Add driver-side cancel and make `withdrawn` a real state
`apps/api/src/routes/public/driver.ts` `apps/api/src/repositories/driver-access-requests.ts` · **Change** new · **Pkg** B04,J01 · **Scen** 134 · **When** do-now · **Approval** none
- **Accept:** `POST /api/driver/access-requests/:id/withdraw` sets `status='withdrawn'` only when the row's `userId` equals the caller and the current status is `pending`; anything else returns `404`, never `403`, so another driver's request id is not confirmed. Writes an audit row (`driver_access_request.withdrawn`) with `actorKind:"user"` and the driver as actor. Observable: `withdrawn` transitions from write-dead to written — `listForOperator`'s totals (`:395-426`) show a non-zero `withdrawn` count, and `approveRequest`'s existing guard at `:531-536` already refuses to approve it, so no operator-side change is needed.
- **Tests:** T-DAR-02a withdraw by owner, T-DAR-02b foreign id 404, T-DAR-02c approve-after-withdraw refused · **Pre/mig:** none — the enum value already exists in both `packages/shared/src/db/commercial.ts:52` and `prisma/schema/commercial.prisma` · **Rollback:** unmount the route; rows already withdrawn stay valid because the operator path already handles the state · **Codex:** the request card gets a working Cancel button.

**IT-DAR-03** — Add the partial unique index behind pending-request dedupe
`prisma/schema/commercial.prisma` `packages/shared/src/db/commercial.ts` `prisma/migrations/<ts>_dar_pending_unique/migration.sql` · **Change** schema · **Pkg** B07 · **Scen** 45,130 · **When** do-now · **Approval** DBA
- **Accept:** `createSelfRequest` checks for an existing pending row with `findFirst` (`:220-230`) and then creates — a read-then-write with nothing underneath it. `DriverAccessRequest` has only two plain indexes (`prisma/schema/commercial.prisma:700-701`), no unique. Add `CREATE UNIQUE INDEX … ON agreements.driver_access_requests (user_id, installation_id) WHERE status = 'pending'`. Observable: two concurrent POSTs for the same (driver, installation) produce exactly one row; the loser hits the constraint rather than creating a duplicate. Prisma cannot express a partial unique index in the model, so the raw SQL is authoritative and the model gets a comment pointing at the migration.
- **Tests:** T-RACE-4 concurrent duplicate submit, extended in `test/parity/driver-access-request-flow.test.ts` which already runs against a real DB · **Pre/mig:** **preflight required** — the index creation fails if duplicate pending pairs already exist; count them before applying · **Rollback:** drop the index; application-level dedupe still works for the non-concurrent case · **Codex:** double-tap on Request Access stops creating two rows.

**IT-DAR-04** — Turn duplicate submit into 200-with-existing
`apps/api/src/routes/public/driver.ts` `apps/api/src/repositories/driver-access-requests.ts` · **Change** edit · **Pkg** B07 · **Scen** 45 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-DAR-03 — without the index this only narrows the race, it does not close it. Today `createSelfRequest` returns `{error:"already_requested", existingRequestId}` and the route maps it to `409` (`driver.ts:913-920`); scenario 45 requires `200` with the first request returned. After the change, a repeat submit returns `201`-shaped body with `200` and the original `createdAt`, and sends **no** second pair of emails. Andri because it inverts the status code of a shipped endpoint — any client branching on 409 breaks. Note the mobile client (`apps/mobile/lib/api/client.dart`) calls twelve driver endpoints and this is not one of them, so the blast radius is smaller than it looks, but confirm before shipping.
- **Tests:** T-DAR-04a repeat submit 200, T-DAR-04b no duplicate email send · **Pre/mig:** none beyond IT-DAR-03 · **Rollback:** revert to 409 · **Codex:** the request screen stops needing a special case for its own retry.

**IT-DAR-05** — Add If-Match to the approve/deny PATCH
`apps/api/src/routes/admin/access-requests.ts` `apps/api/src/lib/http/if-match.ts` · **Change** new · **Pkg** B07 · **Scen** 130,135 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on there being no `If-Match` or ETag handling anywhere in `apps/api/src` — this and IT-ONB-08 introduce the first, and they should share one helper rather than each growing their own. `DriverAccessRequest` has no version column but does have `updatedAt` with `@updatedAt` (`prisma/schema/commercial.prisma:693`), which is a usable weak ETag; decide between that and a real version column as part of the task. Observable: two operators loading the same pending request, both clicking Approve, produce one grant and one `409 version_conflict` — not two calls that both return `ok:true` because the second silently took the already-approved idempotent branch (`:513-527`). Andri because it adds a required request header to a shipped endpoint.
- **Tests:** T-DAR-05 stale If-Match 409 · **Pre/mig:** a version column would need an additive migration; `updatedAt` needs none · **Rollback:** make the header optional again · **Codex:** the inbox can show "someone else already handled this" instead of a misleading success.

**IT-DAR-06** — Make concurrent approval lose with a 409, not a raw constraint error
`apps/api/src/repositories/driver-access-requests.ts` · **Change** edit · **Pkg** B07 · **Scen** 129,130 · **When** do-now · **Approval** none
- **Accept:** `approveRequest` reads `driverGroupMembership.findUnique` (`:571-580`) then creates inside the transaction (`:585-593`). `DriverGroupMembership` **does** have `@@unique([driverGroupId, userId])` (`prisma/schema/commercial.prisma:575`), so the loser of a race gets a raw Prisma `P2002` that propagates as a 500. After the change the create is wrapped so `P2002` maps to the existing idempotent relink branch and the route returns `409` or `200`-with-existing per the IT-DAR-05 decision — never a 500. Observable: two concurrent approvals of one request produce exactly one row in `driver_group_memberships` and zero 5xx responses.
- **Tests:** T-RACE-4 concurrent approve, added to `test/parity/driver-access-request-flow.test.ts` where a real DB can actually race · **Pre/mig:** none, the constraint already exists · **Rollback:** revert · **Codex:** the approve button stops producing an unexplained error under double-click.

**IT-DAR-07** — Rate-limit the access-request submit path
`apps/api/src/routes/public/driver.ts` `apps/api/src/lib/rate-limit.ts` · **Change** edit · **Pkg** J06 · **Scen** 127,128 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on a decision this task must force: `rateLimit` **fails open** when the binding is missing (`rate-limit.ts:121-129` — logs a warn and calls `next()`), which is the opposite of scenario 127. Attaching it to `POST /api/driver/access-requests` (`driver.ts:867`) while it fails open buys almost nothing. Correction to the inventory: only **one** route in `driver.ts` is rate-limited today — `/claim-invite` at `:1031`; `POST /login` at `:121` takes no middleware at all despite the binding being named `DRIVER_LOGIN_RATE_LIMITER`. Observable when done: with the binding absent, the request is refused; with it present, N submits from one IP inside the window return `429`. Andri because flipping fail-open to fail-closed can take the driver app offline if a binding is missing in any environment.
- **Tests:** T-DAR-07a limiter attached, T-DAR-07b binding-absent refuses · **Pre/mig:** confirm the binding exists in every deployed environment **before** flipping, or the flip is an outage · **Rollback:** revert to fail-open · **Codex:** none.

**IT-DAR-08** — Remove the `any` escape hatch on the access-request model
`apps/api/src/repositories/driver-access-requests.ts` `apps/api/src/routes/admin/access-requests.ts` · **Change** edit · **Pkg** B04 · **Scen** 129-136 · **When** do-now · **Approval** none
- **Accept:** The repository reaches the model through `PrismaClient & { driverAccessRequest: any }` (`:53-73`) and the route repeats the trick with a hand-written structural type (`access-requests.ts:156-166`). Both comments say it goes away "once ENROLL-1 + ENROLL-3 land" — they have. The model is fully declared at `prisma/schema/commercial.prisma:673-704`. After the change `darDb`, the `(tx as any)` casts at `:246`, `:598`, `:731`, the `(r: any)` in the list mapper (`:427`) and the `(a: any, b: any)` sort (`:566`) are all gone and `npm run typecheck` passes. Observable: grep for `any` in both files returns zero hits.
- **Tests:** existing suites must pass unchanged — this is a pure typing change · **Pre/mig:** requires `npm run db:generate` to have run against the current schema · **Rollback:** revert · **Codex:** none, but every future task on this file stops typing against `any`.

**IT-DAR-09** — Route-level tests for the operator inbox
`apps/api/src/routes/admin/access-requests.test.ts` · **Change** test · **Pkg** B07,P-tests · **Scen** 129,133,135,136 · **When** do-now · **Approval** none
- **Accept:** The repository has 18 unit cases and 11 parity cases; the **route** has none. New file mounts `adminAccessRequests` on a bare Hono app and asserts the boundary behaviour the repo tests cannot see: the discriminated-union body parse (`:106-112`), the special-cased `denial_reason_required` detection (`:126-137`), the `401 session_missing_userid_relogin_required` branch when the session has no `userId` (`:140-148`), and the error-to-status mapping — `request_not_found`→404, `no_driver_group_for_installation`→422, everything else→409 (`:188-195`).
- **Tests:** T-DAR-09 · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-DAR-10** — Route-level tests for the driver submit endpoint
`apps/api/src/routes/public/driver.test.ts` · **Change** test · **Pkg** B04,P-tests · **Scen** 44,45 · **When** do-now · **Approval** none
- **Accept:** `routes/public/driver.ts` is 1300-plus lines with no test file. New file covers `POST /access-requests` (`:867-932`) at the boundary: the zod rejection of a non-uuid `installationId`, the four error-to-status mappings (`not_found`→404, `already_have_access`→409, `already_requested`→409, `user_not_found`→401), and the `Origin`/`Referer` header parse that feeds `baseUrl` (`:885-893`) — including that a malformed Origin falls back to undefined rather than throwing.
- **Tests:** T-DAR-10 · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-DAR-11** — Assert that policy is evaluated at decision time
`apps/api/src/repositories/driver-access-requests.test.ts` · **Change** test · **Pkg** B07 · **Scen** 135 · **When** do-now · **Approval** none
- **Accept:** `approveRequest` re-queries driver groups at approve time (`:544-560`), filtering on agreement `status='active'` and an effective window bounded by `now` — so a policy change between submit and decision **is** honoured. That is correct behaviour with no test proving it. Add: a request submitted while an agreement was active, approved after that agreement's `effectiveUntil` has passed, returns `no_driver_group_for_installation` and creates no membership. And the converse: an agreement that became active only after submit is eligible at approve time.
- **Tests:** T-DAR-11a expired-agreement approval refused, T-DAR-11b newly-active agreement eligible · **Pre/mig:** none · **Rollback:** delete the cases · **Codex:** none.

**IT-DAR-12** — Assert that closing an org does not auto-reject pending requests
`apps/api/test/parity/driver-access-request-flow.test.ts` · **Change** test · **Pkg** B07 · **Scen** 136 · **When** do-now · **Approval** none
- **Accept:** Scenario 136 requires that when an org closes, pending requests are **not** auto-rejected. No code anywhere couples organisation status to `driver_access_requests.status`, so the scenario passes by absence — which is exactly the kind of thing that regresses silently when someone later adds an org-status cascade. Add a case that flips the org's status, then asserts the pending row's `status` is still `pending` and no `driver_access_request.denied` audit row was written. Guard rail, not a fix.
- **Tests:** T-DAR-12 · **Pre/mig:** none · **Rollback:** delete the case · **Codex:** none.

**IT-DAR-13** — Decide whether `member.write` is the right gate for approvals
`apps/api/src/routes/admin/access-requests.ts` `apps/api/src/lib/auth/permissions.ts` `apps/api/src/lib/auth/effective-permissions.ts` · **Change** decision · **Pkg** B07,D-perms · **Scen** 129,133 · **When** do-now · **Approval** Andri
- **Accept:** A written decision. `assertPermission(c, "member.write", orgId)` is the only gate on both the inbox read (`:90`) and the approve/deny PATCH (`:178`). Two facts make this worth deciding rather than assuming: `sales_cs` holds `platform.tenant.write`, which `expandPlatformTenantVerbs` (`effective-permissions.ts:103-139`) expands into `member.remove` and six other verbs in **every** org — so the "column-restricted in the repo layer" mitigation claimed at `permissions.ts:268` is not implemented anywhere; and `assertPermission` has a bootstrap early return at `:115-117` that skips the check entirely for a session with `sub==="admin"` and no `userId`. The decision must say whether granting access to a charging installation is a `member.write`-grade action or needs its own verb.
- **Tests:** none — the deliverable is the decision · **Pre/mig:** none · **Rollback:** n/a · **Codex:** determines which roles the inbox is shown to.

**IT-DAR-14** — Decide the driver-group selection policy on approval
`apps/api/src/repositories/driver-access-requests.ts` · **Change** decision · **Pkg** B07 · **Scen** 129 · **When** do-later · **Approval** Andri
- **Accept:** A written decision on `approveRequest`'s group choice: of all DriverGroups under active agreements covering the installation, it picks the one with the **fewest members**, ties broken by `createdAt` ascending (`:544-568`, comment "spread load"). Load-spreading is a plausible default and a strange access-control policy — groups usually differ in what they grant, not in how full they are, and pricing follows the group. The decision must say whether this stays, becomes operator-selectable at approve time, or becomes deterministic on some other key. It is deterministic and re-runnable today, so this is not urgent — but it silently decides what a driver pays.
- **Tests:** none — the deliverable is the decision · **Pre/mig:** none · **Rollback:** n/a · **Codex:** if the choice becomes operator-selectable, the approve action needs a group picker.
# Appendix 19B — part 4 of 5

Groups: `IT-CODE` (installation access code), `IT-AGR` (agreement write surface),
`IT-COST` (cost-factor assignment), `IT-AUD` (audit taxonomy and read model).

Every path below was opened on branch `docs/singular-onboarding-domain-packet`
at tip `fc071b3`. Paths marked `new` do not exist and are proposals. Nothing was
executed: no SQL, no DB connection, no test run, no network call.

---

## CODE — installation access code / passphrase contract (16)

Greenfield in full. `installation_access_credential` exists in no Drizzle table,
no Prisma model, no migration and no route; `POST /api/driver/join` and
`apps/api/src/routes/public/join.ts` do not exist either — the `routes/public/`
directory holds only `driver.ts`, `driver-charger-pin.ts`, `driver-tap-intent.ts`,
`email-verification.ts`, `host-applications.ts`, `invites.ts`, `password-reset.ts`,
`register.ts`. The packet mis-framed two things. `credential-management.ts` /
`credential-crypto.ts` are *Zaptec vendor portal* credentials that share only the
word "credential" — `sealPassword`/`openPassword` are deliberately reversible
AES-GCM under `OCPP_CRED_KEK`, the wrong primitive for a join passphrase. And
`rate-limit.ts` fails **OPEN** (`:121-129`), the opposite of what J06 assumes.
What *is* usable: `packages/shared/src/db/identity.ts` `userTokens` :222-243
already carries `security`, `passwordKeyHash`, `maxRedemptions` and
`driverGroupId` — the columns for a code+passphrase flow exist, the flow does not.

**IT-CODE-01** — Decide: new credential table vs `userTokens.passwordKeyHash`
`packages/shared/src/db/identity.ts` `apps/api/src/repositories/host-invites.ts` · **Change** decision · **Pkg** J01,J02 · **Scen** 121-125 · **When** do-now · **Approval** Andri
- **Accept:** A written decision names one home. Reuse means `userTokens` gains no new columns and `driverInviteSecurityEnum` value `password_key` (identity.ts:57) becomes live for the first time; a new table means IT-CODE-02/03 proceed and `passwordKeyHash` is documented as dead. Either way the losing option is struck from this group before any migration is written.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** nothing yet — this unblocks the shape the join form posts.

**IT-CODE-02** — Declare `installation_access_credentials` in Drizzle and Prisma
`packages/shared/src/db/commercial.ts` `prisma/schema/commercial.prisma` · **Change** schema · **Pkg** J01 · **Scen** 121-126 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-CODE-01 choosing "new table". Then: table lives in `agreementsSchema` beside `driverAccessRequests` (commercial.ts:410), carries `installationId` (FK to `Installation`, prisma/schema/assets.prisma:148), `code`, `passphraseHash`, `status`, `maxRedemptions`, `effectiveFrom`, `revokedAt`, `supersededById`; `npm run check:schema-consistency` (one of the nine in `scripts/check-all.mjs`) passes with the table present in both descriptions.
- **Tests:** extend `apps/api/test/parity/domain-schemas.test.ts` · **Pre/mig:** declaration only, no DDL yet · **Rollback:** revert both files · **Codex:** none.

**IT-CODE-03** — Write the DDL migration with a partial unique index on `code`
`prisma/migrations/<ts>_installation_access_credentials/migration.sql` · **Change** new · **Pkg** J01 · **Scen** 121,125,128 · **When** blocked · **Approval** DBA
- **Accept:** Blocked on IT-CODE-02. The migration creates the table and a partial unique index on `code` `WHERE revoked_at IS NULL`, so a rotated-then-revoked code can be reissued but two live codes cannot collide. Note the standing hazard recorded in `.github/workflows/check.yml:30-35`: two migrations are already applied by hand and unrecorded against staging, so `prisma migrate status` exits non-zero before this one is added.
- **Tests:** none offline · **Pre/mig:** forward-only DDL; must be applied by hand in the same order as the two unrecorded ones · **Rollback:** `DROP TABLE` — safe only while the table is empty · **Codex:** none.

**IT-CODE-04** — Add a one-way passphrase helper; do not extend `credential-crypto`
`apps/api/src/lib/join-passphrase.ts` · **Change** new · **Pkg** J02 · **Scen** 121,122 · **When** do-now · **Approval** none
- **Accept:** New module exports `hashJoinPassphrase` / `verifyJoinPassphrase` built on the same PBKDF2-SHA256 Web Crypto shape as `apps/api/src/lib/password.ts` (prefix `pbkdf2:sha256:<iters>:<salt>:<hash>`, 16-byte per-credential salt). A grep of the new file for `OCPP_CRED_KEK`, `sealPassword` and `openPassword` returns zero hits — the reversible vendor primitive is not reused.
- **Tests:** `apps/api/src/lib/join-passphrase.test.ts` (new, offline) · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-CODE-05** — Add a check-digit join code generator and verifier
`apps/api/src/lib/join-code.ts` · **Change** new · **Pkg** J07 · **Scen** 121 · **When** do-now · **Approval** none
- **Accept:** `generateJoinCode()` emits the Crockford-style alphabet already used by `generateInviteCode` (`apps/api/src/repositories/host-invites.ts:85`, no `l/o/0/1`) plus one trailing check character; `verifyJoinCode()` returns false for every single-character substitution and every single adjacent transposition over a 1,000-code fixture. Offline, no DB.
- **Tests:** `apps/api/src/lib/join-code.test.ts` (new) · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** the client can reject a mistyped or misread QR before any request is sent.

**IT-CODE-06** — Build the credential lifecycle repository
`apps/api/src/repositories/installation-access-credentials.ts` · **Change** new · **Pkg** J03,J04,J05 · **Scen** 121-126 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-CODE-03. Exports `createCredential`, `rotateCredential`, `revokeCredential`, `revokeAllForInstallation`, `findLiveByCode`. `createCredential` returns the plaintext passphrase exactly once in its return value and never persists it; a repo-wide grep for the plaintext field name outside this function returns zero hits.
- **Tests:** `apps/api/test/parity/installation-access-credentials.test.ts` (new, real-DB via `apps/api/test/parity/_harness.ts`) · **Pre/mig:** needs IT-CODE-03 applied · **Rollback:** delete the file · **Codex:** none.

**IT-CODE-07** — Expose admin create returning the passphrase once
`apps/api/src/routes/admin/installation-access-credentials.ts` · **Change** new · **Pkg** J03 · **Scen** 121,122 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-CODE-06. `POST` returns 201 with `{ code, passphrase }`; `GET /:id` returns the same row with no `passphrase` key present at all (absent, not null). Gated by `requirePermission` with an `orgIdParam` — not one of the 85 orgId-less gates, so a `host_admin` membership can satisfy it.
- **Tests:** same parity file as IT-CODE-06 · **Pre/mig:** none beyond IT-CODE-03 · **Rollback:** unmount · **Codex:** the "create access code" screen can show the passphrase once with a copy button and a "you will not see this again" line.

**IT-CODE-08** — Mount the credential router in `index.ts`
`apps/api/src/index.ts` · **Change** edit · **Pkg** J03 · **Scen** 121 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-CODE-07. `app.route(...)` line added near the existing `/api/admin/installations` mount (index.ts:131) and the route answers non-404 in a local run. This exists as its own task because `apps/api/src/routes/admin/org-email-domains.ts` is fully implemented and DB-tested and has no mount line — the same omission is easy to repeat.
- **Tests:** `npm run check:api-endpoints` (already in `scripts/check-all.mjs`) · **Pre/mig:** none · **Rollback:** delete the line · **Codex:** none.

**IT-CODE-09** — Create `POST /api/driver/join`
`apps/api/src/routes/public/join.ts` `apps/api/src/index.ts` · **Change** new · **Pkg** B01,J03 · **Scen** 121-128 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-CODE-06. New file, mounted under `/api/driver`; accepts `{code, passphrase}`, resolves the credential, grants a `DriverGroupMembership` idempotently the way `driver.ts:1244-1253` already does, and audits. Public contract addition, hence Andri. The three existing entry paths (`/access-requests` driver.ts:867, `/redeem-invite` :1158, `/claim-invite` :1029) are left untouched by this task — whether `/join` replaces or wraps them is IT-CODE-16.
- **Tests:** parity file from IT-CODE-06 · **Pre/mig:** none · **Rollback:** unmount the route · **Codex:** the join screen can post a real request instead of rendering a disabled state.

**IT-CODE-10** — Collapse every join rejection to one byte-identical body
`apps/api/src/routes/public/join.ts` · **Change** new · **Pkg** J05 · **Scen** 125 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-CODE-09. Unknown code, bad check digit, wrong passphrase, revoked credential, expired credential and exhausted `maxRedemptions` all produce the same status and the same serialised JSON bytes; a test hashes the response body for all six cases and asserts one distinct hash. The distinct reason goes to `audit.actions.metadata`, never to the caller — the pattern `driver.ts:1201-1229` already uses for `not_found`.
- **Tests:** parity file from IT-CODE-06 · **Pre/mig:** none · **Rollback:** n/a · **Codex:** the client must show one generic message; it cannot branch on cause.

**IT-CODE-11** — Add a fail-closed mode to `rateLimit`, default unchanged
`apps/api/src/lib/rate-limit.ts` · **Change** edit · **Pkg** J06 · **Scen** 127 · **When** do-now · **Approval** none
- **Accept:** `RateLimitOptions` gains `failMode?: "open" | "closed"` defaulting to `"open"`. With `"closed"` and a missing or malformed binding, the middleware returns 503 and does **not** call `next()` — the current branch at :124-129 returns `next()` unconditionally. The two existing callers (`routes/admin/auth.ts` login and `driver.ts:1030-1035` claim-invite) pass no `failMode`, so their behaviour is byte-identical before and after.
- **Tests:** `apps/api/src/lib/rate-limit.test.ts` (new — no test file exists for this module today) · **Pre/mig:** none · **Rollback:** revert the option · **Codex:** none.

**IT-CODE-12** — Provision a per-code rate-limit bucket for the join route
`apps/api/src/lib/rate-limit.ts` `apps/api/src/bindings.ts` `apps/api/wrangler.jsonc` · **Change** edit · **Pkg** J06 · **Scen** 128 · **When** blocked · **Approval** Andri
- **Accept:** Blocked: there is no per-code bucket to key on. Only `ADMIN_LOGIN_RATE_LIMITER` (namespace 1001) and `DRIVER_LOGIN_RATE_LIMITER` (namespace 1002) are declared, at `apps/api/wrangler.jsonc:141-154` and `bindings.ts:95-100`, and both key on IP or email. This task adds a `keyBy: "code"` mode plus a third `unsafe.bindings` entry so many IPs hitting one code trip the limit. Note the platform constraint recorded in the same wrangler comment: `period` may only be 10 or 60 seconds.
- **Tests:** `rate-limit.test.ts` from IT-CODE-11 · **Pre/mig:** the binding only exists after a deploy · **Rollback:** remove the binding entry · **Codex:** none.

**IT-CODE-13** — Implement rotation with an explicit grace window
`apps/api/src/repositories/installation-access-credentials.ts` · **Change** new · **Pkg** J04 · **Scen** 123 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-CODE-06. `rotateCredential` inserts a new row and sets the prior row's `effectiveUntil` to `now + grace` inside one transaction — the shape `createRateReference` already uses at `apps/api/src/repositories/billing-rate-references.ts:227-260`. Within the window both codes authenticate; one second past it, only the new one does.
- **Tests:** parity file from IT-CODE-06, with a clock-controlled window · **Pre/mig:** none · **Rollback:** n/a · **Codex:** the rotate action can display both codes and the window expiry.

**IT-CODE-14** — Make revocation immediate and prove grants survive it
`apps/api/src/repositories/installation-access-credentials.ts` · **Change** new · **Pkg** J05 · **Scen** 124,125 · **When** blocked · **Approval** none
- **Accept:** Blocked on IT-CODE-06. After `revokeCredential`, a join with that code takes the IT-CODE-10 generic failure, and the `DriverGroupMembership` rows created earlier through that code are unchanged — asserted by row id, not by count.
- **Tests:** parity file from IT-CODE-06 · **Pre/mig:** none · **Rollback:** n/a · **Codex:** the revoke button can promise "existing drivers keep access" truthfully.

**IT-CODE-15** — Emergency revoke-all: one audit row per credential
`apps/api/src/repositories/installation-access-credentials.ts` `apps/api/src/routes/admin/installation-access-credentials.ts` · **Change** new · **Pkg** J08 · **Scen** 126 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-CODE-06. One call revokes every live credential on an installation and writes exactly N `audit.actions` rows for N credentials, not one summary row. Mass revocation of live access, hence Andri.
- **Tests:** parity file from IT-CODE-06 · **Pre/mig:** none · **Rollback:** revocation is not undoable — reissue instead · **Codex:** a confirm dialog showing the count of codes about to die.

**IT-CODE-16** — Decide what `/join` does to the three existing entry paths
`apps/api/src/routes/public/driver.ts` · **Change** decision · **Pkg** B01,B02,J03 · **Scen** 31-35,44,45 · **When** do-later · **Approval** Andri
- **Accept:** A written answer to SI-JOIN-01's open question: does `/join` replace `/access-requests`, `/redeem-invite` and `/claim-invite`, or wrap them. Constraint to respect: `/redeem-invite` is identity-bound per ADR 0053 (`driver.ts:1207`) and covered by `apps/api/test/parity/driver-invite-redemption-parity.test.ts:388-594` — a replacement must carry that guard forward, not re-derive it. Also note `apps/mobile/lib/api/client.dart` calls none of the three today.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** decides whether the app keeps two join affordances or one.

---

## AGR — agreement write surface (18)

Greenfield, not hardening — the packet had this backwards. A grep of `apps/api/src`
for `.agreement.create|update|delete|upsert`, `agreementClause.*` and `bearerRule.*`
returns zero hits; `apps/api/src/repositories/agreements.ts:1-7` declares itself
read-only, and the only agreement write in the repo is the one-off script
`apps/api/scripts/supersede-orphan-b6771541.ts`. The good news is that the exact
write shape K02/K04/K13 describe already ships for a sibling table:
`apps/api/src/routes/admin/billing-rate-references.ts` (`POST /` :97, `PATCH /:id`
:152, `POST /:id/retire` :206) with the invariant in its header at :6-12 —
resolution fields on an active row are immutable, and "stage new version"
auto-closes the prior row inside one transaction (`repositories/billing-rate-references.ts:227-280`).
Copy it. Overlap has no constraint to lean on: `prisma/schema/commercial.prisma:507-510`
gives `Agreement` four plain `@@index` lines and nothing else, and today the
collision is handled at READ time by a `console.warn` plus a deterministic
`orderBy` in `apps/api/src/lib/agreement/persist.ts:143-165`.

**IT-AGR-01** — Create the agreement write repository (draft create)
`apps/api/src/repositories/agreements-write.ts` · **Change** new · **Pkg** K01,K09 · **Scen** 137 · **When** do-now · **Approval** none
- **Accept:** New file — `agreements.ts` stays read-only, as its header claims. Exports `createDraftAgreement` writing `agreements.agreements` with `status` defaulting to `draft` (the column default at `packages/shared/src/db/commercial.ts:303`). A created draft is returned by `getAgreementDetail` with `status: "draft"`.
- **Tests:** `apps/api/test/parity/agreements-write.test.ts` (new, real-DB) · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none until IT-AGR-04 mounts a route.

**IT-AGR-02** — Add create/patch zod schemas with mandatory effective dating
`apps/api/src/lib/billing/agreement-zod.ts` · **Change** new · **Pkg** K06 · **Scen** 140 · **When** do-now · **Approval** none
- **Accept:** `CreateAgreementSchema` requires `effectiveFrom`; a body without it fails `safeParse` and the route returns 400 `validation_error`. Sibling shape to `apps/api/src/lib/billing/rate-reference-zod.ts`. Note `effectiveUntil` stays nullable — the column is nullable at commercial.ts:307 and open-ended-by-supersede is how the rate book works.
- **Tests:** `apps/api/src/lib/billing/agreement-zod.test.ts` (new, offline) · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** the form can require a start date client-side and match the server.

**IT-AGR-03** — Add an agreements write router without colliding with existing mounts
`apps/api/src/routes/admin/agreements-write.ts` `apps/api/src/index.ts` · **Change** new · **Pkg** K01 · **Scen** 137 · **When** do-now · **Approval** none
- **Accept:** Two routers already answer under this prefix — `adminAgreementsDebug` at `/api/admin/agreements` (index.ts:178) and `adminAgreementsResolve` at `/api/admin/agreements/sessions` (index.ts:184). The new router must not shadow either; in particular `GET /:id` in `agreements-debug.ts:42` guards itself with a UUID regex, so any new literal segment must be registered before it or be UUID-unlike. `npm run check:api-endpoints` passes.
- **Tests:** check:api-endpoints · **Pre/mig:** none · **Rollback:** delete the mount · **Codex:** none.

**IT-AGR-04** — `POST /api/admin/agreements` creates a draft
`apps/api/src/routes/admin/agreements-write.ts` · **Change** new · **Pkg** K01 · **Scen** 137 · **When** do-now · **Approval** none
- **Accept:** 201 with the created row; a second identical POST creates a second draft (no implicit idempotency — there is no HTTP idempotency-key infrastructure in this repo; the only `batchInsertIdempotencyKeys` lives in `apps/api/src/lib/db/raw.ts` for OCPP ingest and has a different key space).
- **Tests:** `agreements-write.test.ts` · **Pre/mig:** none · **Rollback:** unmount · **Codex:** the "new agreement" form can submit.

**IT-AGR-05** — `PATCH /:id` edits drafts only; active rows are immutable
`apps/api/src/routes/admin/agreements-write.ts` `apps/api/src/repositories/agreements-write.ts` · **Change** new · **Pkg** K02 · **Scen** 137,138 · **When** do-now · **Approval** none
- **Accept:** Patching `status: "draft"` succeeds; patching a row whose `status` is `active` returns 400 with `{ error: "active_row_immutable" }` and a `suggestion` field — byte-compatible with the shape `billing-rate-references.ts:178-188` already returns, so the console can share one error renderer.
- **Tests:** `agreements-write.test.ts` · **Pre/mig:** none · **Rollback:** unmount · **Codex:** the edit form can disable itself on active agreements using an error contract that already exists elsewhere.

**IT-AGR-06** — `POST /:id/activate` with a pricing snapshot in the audit row
`apps/api/src/routes/admin/agreements-write.ts` · **Change** new · **Pkg** K03,K10 · **Scen** 142 · **When** do-now · **Approval** none
- **Accept:** Transition `draft -> active` in one transaction with exactly one `audit.actions` row whose `metadata` carries the clause set and resolved rate-reference ids at activation time. The snapshot can be produced by calling `loadAgreementContext` (`apps/api/src/lib/agreement/persist.ts:86`) — no second resolver.
- **Tests:** `agreements-write.test.ts` · **Pre/mig:** none · **Rollback:** an activated agreement is retired, never un-activated · **Codex:** the activate button can show the snapshot it is about to freeze.

**IT-AGR-07** — `POST /:id/retire` sets `effectiveUntil`, never deletes
`apps/api/src/routes/admin/agreements-write.ts` · **Change** new · **Pkg** K04 · **Scen** 143 · **When** do-now · **Approval** none
- **Accept:** After retire, the row still exists with `effectiveUntil` set to a non-null timestamp and `status` unchanged from `active` unless the status machine says otherwise; no `DELETE` statement appears in the diff. Mirrors `retireRateReference` (`billing-rate-references.ts:206-234`) including its "this creates a resolution gap" warning in the response body.
- **Tests:** `agreements-write.test.ts` · **Pre/mig:** none · **Rollback:** clear `effectiveUntil` on the row · **Codex:** the retire action can surface the gap warning verbatim.

**IT-AGR-08** — Add the overlap exclusion constraint
`prisma/migrations/<ts>_agreement_overlap_exclusion/migration.sql` · **Change** new · **Pkg** K05 · **Scen** 139 · **When** blocked · **Approval** DBA
- **Accept:** Blocked: nothing to build on. A grep of all of `prisma/migrations/` for `EXCLUDE`, `btree_gist` and `tstzrange` returns zero hits, so this migration must `CREATE EXTENSION btree_gist` first, then add an `EXCLUDE USING gist` over `(installation_id WITH =, tstzrange(effective_from, effective_until) WITH &&) WHERE (status = 'active')`. Acceptance: inserting a second overlapping active agreement raises `23P01`, and the API turns that into 400 rather than 500.
- **Tests:** `agreements-write.test.ts` overlap case · **Pre/mig:** extension creation needs elevated DB rights; existing overlapping rows must be reconciled first or the constraint will not be created · **Rollback:** `DROP CONSTRAINT` · **Codex:** none.

**IT-AGR-09** — Application-level overlap check until the constraint lands
`apps/api/src/repositories/agreements-write.ts` · **Change** new · **Pkg** K05 · **Scen** 139 · **When** do-now · **Approval** none
- **Accept:** `activateAgreement` counts active agreements on the same `installationId` whose range intersects, inside the same transaction, and refuses with `active_row_would_overlap` — the code `createRateReference` already throws at `billing-rate-references.ts:246-251`. This is a race-prone guard by construction and the comment must say so; it is a stopgap for IT-AGR-08, not a substitute.
- **Tests:** `agreements-write.test.ts` · **Pre/mig:** none · **Rollback:** remove the check once IT-AGR-08 is live · **Codex:** the console gets a real 400 instead of a silent second active row.

**IT-AGR-10** — Keep the read-time overlap warning until the constraint proves out
`apps/api/src/lib/agreement/persist.ts` · **Change** decision · **Pkg** K05 · **Scen** 139,144 · **When** do-later · **Approval** none
- **Accept:** `loadAgreementContext` counts matching installation agreements and `console.warn`s when more than one matches (:143-153), then picks by `effectiveFrom desc, id asc` (:159-165). Decision to record: this stays after IT-AGR-08, because the deterministic `orderBy` is what stops a stale agreement pricing a session, and the constraint only prevents *new* overlaps, not ones already stored.
- **Tests:** `apps/api/src/lib/agreement/persist.test.ts` (exists) · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-AGR-11** — Gate activation on org admin with a real org scope
`apps/api/src/routes/admin/agreements-write.ts` · **Change** new · **Pkg** K07 · **Scen** 141 · **When** do-now · **Approval** Andri
- **Accept:** Activation passes `orgIdParam` to `requirePermission` so the membership bundle can satisfy it. Without `orgIdParam` the resolver sets `orgId = null` (`require-permission.ts:69-71`), `getActiveMembership` is skipped (`effective-permissions.ts:160`), and only `expandPlatformTenantVerbs` can pass the gate — which is exactly backwards for "org admin only, staff cannot activate". Acceptance: an `admin` membership on the counterparty org gets 200; a `support_agent` platform grant gets 403.
- **Tests:** `agreements-write.test.ts` plus a case in `apps/api/src/lib/auth/require-permission.test.ts` · **Pre/mig:** none · **Rollback:** revert the gate · **Codex:** the activate button can be permission-driven rather than hidden for everyone.

**IT-AGR-12** — Make `contract.write` guard something
`apps/api/src/routes/admin/agreements-write.ts` `apps/api/src/lib/auth/permissions.ts` · **Change** new · **Pkg** K11 · **Scen** 141 · **When** do-now · **Approval** Andri
- **Accept:** `contract.write` is declared at `permissions.ts:69` and bundled into ADMIN (:153) and FINANCE, and `requirePermission("contract.write")` appears in zero route files today — same for `tariff.write` (:72, :152). After this task, `grep -rn 'requirePermission("contract.write")' apps/api/src` returns at least the agreement write routes. Reverses the de-facto position that every billing mutation is `billing.write`, so Andri.
- **Tests:** `apps/api/src/lib/auth/permissions.test.ts` · **Pre/mig:** none · **Rollback:** revert to `billing.write` · **Codex:** role-gated UI for contract authoring becomes meaningful.

**IT-AGR-13** — Draft-only clause add and remove
`apps/api/src/repositories/agreements-write.ts` `apps/api/src/routes/admin/agreements-write.ts` · **Change** new · **Pkg** K12 · **Scen** 137,145 · **When** do-now · **Approval** none
- **Accept:** Clause writes hit `agreements.agreement_clauses`, which carries a unique index on `(agreement_id, cost_factor_id)` (`packages/shared/src/db/commercial.ts:335`), so a duplicate factor returns 409 rather than a raw unique violation. Adding or removing a clause on an `active` agreement returns the same `active_row_immutable` shape as IT-AGR-05.
- **Tests:** `agreements-write.test.ts` · **Pre/mig:** none · **Rollback:** unmount · **Codex:** the clause editor can be enabled on drafts and disabled on active agreements from one flag.

**IT-AGR-14** — Make the supersede chain explicit and readable
`packages/shared/src/db/commercial.ts` `prisma/schema/commercial.prisma` `apps/api/src/repositories/agreements.ts` · **Change** schema · **Pkg** K13 · **Scen** 139,143 · **When** do-later · **Approval** DBA
- **Accept:** `Agreement` has no supersede column today — `prisma/schema/commercial.prisma:483-513` carries none, and the relation is only inferrable from overlapping dates. Add `supersededByAgreementId` (nullable self-FK), set it in the activate transaction of IT-AGR-06, and surface it in `getAgreementDetail`. Acceptance: detail response for a superseded agreement names its successor id.
- **Tests:** `agreements-write.test.ts`, `apps/api/test/parity/domain-schemas.test.ts` · **Pre/mig:** column-add migration; nullable so no backfill required · **Rollback:** drop the column · **Codex:** the detail page can show "superseded by" as a link.

**IT-AGR-15** — One audit row per transition, all four transitions
`apps/api/src/repositories/agreements-write.ts` · **Change** new · **Pkg** K10 · **Scen** 142,155 · **When** do-now · **Approval** none
- **Accept:** create, update, activate and retire each write exactly one `audit.actions` row via `recordAuditAction` (`apps/api/src/lib/audit.ts:58`) inside the same transaction as the mutation — the pattern `host-invites.ts:205` uses. Acceptance: a four-step lifecycle produces exactly four rows with distinct `action` values.
- **Tests:** `agreements-write.test.ts` counting rows by action · **Pre/mig:** none · **Rollback:** n/a · **Codex:** an agreement history panel has data to read once IT-AUD-07 exposes it.

**IT-AGR-16** — Tenant-scope the agreement read repository
`apps/api/src/repositories/agreements.ts` · **Change** edit · **Pkg** K09 · **Scen** 137,138 · **When** do-now · **Approval** Andri
- **Accept:** `listAgreements` (:155) and `getAgreementDetail` (:188) take no org argument and filter only on `agreementType in (service_cpo, installation)` — any caller who passes the permission gate sees every tenant's agreements. Add an optional `orgId` scope honoured by both, and have the routes pass the caller's resolved org. Changes what an existing endpoint returns, hence Andri.
- **Tests:** `apps/api/test/parity/agreements-write.test.ts` cross-tenant case · **Pre/mig:** none · **Rollback:** revert to unscoped · **Codex:** the list stops showing other tenants' agreement names.

**IT-AGR-17** — Draft pricing preview that reuses the existing resolver
`apps/api/src/routes/admin/agreements-write.ts` · **Change** new · **Pkg** K08 · **Scen** 144 · **When** do-now · **Approval** none
- **Accept:** Preview calls `loadAgreementContext` + `resolveBillingLines` — the same pair `POST /api/admin/agreements/debug-resolve` uses (`agreements-debug.ts:89-168`) — and adds no new pricing arithmetic. Acceptance: a grep of the new code for `priceMinor *`, `vatRatePct` arithmetic or any import of `lib/tariff/compute-session-cost` returns nothing. K08's "no second pricing impl" is already false at the repo level (see IT-COST-14), so this criterion is scoped to "this endpoint adds no fourth".
- **Tests:** `agreements-write.test.ts` · **Pre/mig:** none · **Rollback:** unmount · **Codex:** the draft editor can show a priced example before activation.

**IT-AGR-18** — Retire the one-off supersede script once the endpoint exists
`apps/api/scripts/supersede-orphan-b6771541.ts` · **Change** decision · **Pkg** K14 · **Scen** 143 · **When** do-later · **Approval** Andri
- **Accept:** This script is the only agreement write in the repository. Once IT-AGR-06/07 are live, record a decision: delete it, or keep it and mark it superseded in its header. Deleting it removes the last uncontrolled write path; keeping it means a hand-run script can still bypass every guard added in this group. K14 ("no legacy backfill") is unaffected either way — the new tables are the existing tables and they are not empty.
- **Tests:** none · **Pre/mig:** none · **Rollback:** restore from git · **Codex:** none.

---

## COST — cost-factor assignment (16)

Half-built, and the packet's Group L straddles two tables that share a name and
nothing else. **`billing.cost_factors`** (`packages/shared/src/db/commercial.ts:88`,
anchored by `CostFactorAnchor`, referenced by `TariffDefinition`) is what
`apps/api/src/routes/admin/billing-cost-factors.ts` CRUDs and what L06 means.
**`agreements.cost_factors`** (`commercial.ts:255`, referenced by `RateReference`
and `AgreementClause`) is what the resolver actually walks, and its only write
surface is a read-only select-options endpoint at
`billing-rate-references.ts:43-55`. Every task below says which. Third fact worth
holding: three pricing implementations exist — the legacy chain
(`lib/tariff/resolve-tariff-chain.ts` + `compute-session-cost.ts`, invoked from
the `session.stopped` projection, which prices every session), the agreements
resolver (`packages/commercial/src/agreement/resolve.ts`, which has priced zero),
and the driver-facing summarisers `summarisePerKwhForList` :175 /
`summariseForCharger` :208 in `repositories/driver-pricing.ts`, which ignore
`BearerRule` overrides by design (`driver-pricing.ts:29-34`).

**IT-COST-01** — Write down which cost-factor table each Group L item means
`apps/api/src/routes/admin/billing-cost-factors.ts` `apps/api/src/routes/admin/billing-rate-references.ts` · **Change** decision · **Pkg** L01,L02,L06 · **Scen** 145,146 · **When** do-now · **Approval** Andri
- **Accept:** A table-by-table mapping is recorded: L06 is `billing.cost_factors`; L02/L03/L04/L05/L10 are `agreements.cost_factors` and its consumers. Acceptance is that no later task in this group is ambiguous about which table it touches. Consequence to state plainly: `updateCostFactor` on the billing table cannot affect resolution, because the resolver never reads it.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** stops the console from wiring the wrong catalogue into an agreement clause picker.

**IT-COST-02** — Give `agreements.cost_factors` a write surface
`apps/api/src/repositories/agreement-cost-factors.ts` `apps/api/src/routes/admin/agreement-cost-factors.ts` · **Change** new · **Pkg** L02,L06 · **Scen** 145 · **When** do-now · **Approval** none
- **Accept:** Today the only access to this table anywhere in `apps/api/src` is the `findMany` at `billing-rate-references.ts:48-52` filtered to `status: "active"`. New repository plus router giving create / patch / archive over `agreements.cost_factors`, with `code` immutable after create — the same 422 `immutable_field` response `billing-cost-factors.ts:110-118` already returns for the billing table.
- **Tests:** `apps/api/test/parity/agreement-cost-factors.test.ts` (new) · **Pre/mig:** none, table exists · **Rollback:** unmount · **Codex:** the clause editor can offer factor creation instead of a fixed list.

**IT-COST-03** — Build the assignment write surface as `BearerRule` CRUD
`apps/api/src/repositories/bearer-rules.ts` `apps/api/src/routes/admin/bearer-rules.ts` · **Change** new · **Pkg** L02 · **Scen** 145 · **When** do-now · **Approval** none
- **Accept:** "Assign a cost factor to a scope" is a `agreements.bearer_rules` row (`packages/shared/src/db/commercial.ts:433-455`), and no code writes that table. New repository exposes create/list/retire keyed on `(agreementId, costFactorId, scopeType, scopeId, audienceType, audienceId)`. Acceptance: a rule created for `scopeType: "charger"` is returned by `buildLadder` (`packages/commercial/src/agreement/resolve.ts:78`) for that charger and by no other.
- **Tests:** `apps/api/test/parity/bearer-rules.test.ts` (new) · **Pre/mig:** none · **Rollback:** unmount · **Codex:** the scope assignment UI can persist.

**IT-COST-04** — Reconcile L01's scope list with the real enum
`packages/shared/src/db/commercial.ts` `packages/commercial/src/agreement/types.ts` · **Change** decision · **Pkg** L01 · **Scen** 145,146 · **When** do-now · **Approval** Andri
- **Accept:** L01 asks for scopes `org/group/installation/charger`. The real enum is `ruleScopeTypeEnum` = `site, installation, circuit, charger` (`commercial.ts:44`, mirrored by `RULE_SCOPES` at `types.ts:16`), and "group" is not a scope at all — it is `ruleAudienceTypeEnum` = `driver_group, user` (`commercial.ts:45`). Decision to record: either L01 is restated in the real vocabulary, or an enum migration is scheduled. Do not build against L01's list as written.
- **Tests:** `packages/commercial/src/agreement/types.test.ts` · **Pre/mig:** an enum change would need a Postgres `ALTER TYPE` in both schema descriptions · **Rollback:** n/a · **Codex:** the scope picker's options are settled.

**IT-COST-05** — Reject per-driver scope at the write layer for beta
`apps/api/src/routes/admin/bearer-rules.ts` · **Change** new · **Pkg** L01 · **Scen** 146 · **When** do-now · **Approval** none
- **Accept:** `audienceType: "user"` is a legal enum value and the resolver honours it (`resolve.ts:88` matches `r.audienceId !== ctx.user.id`), so the rejection must be at the write layer, not by pretending the capability is absent. A create with `audienceType: "user"` returns 422 with a named reason; existing rows with that audience keep resolving.
- **Tests:** `bearer-rules.test.ts` · **Pre/mig:** none · **Rollback:** remove the check · **Codex:** the audience picker hides per-driver and the server agrees.

**IT-COST-06** — Retire an assignment without disturbing historical resolution
`apps/api/src/repositories/bearer-rules.ts` · **Change** new · **Pkg** L03 · **Scen** 145,147 · **When** do-now · **Approval** none
- **Accept:** Retire sets `effectiveUntil` on the rule; it never deletes. `buildLadder` filters on `effectiveUntil === null or > startedAt` (`resolve.ts:82-84`), so a session that started before the retirement still resolves through the rule. Acceptance: resolving the same historical session before and after retirement produces identical `BillingLineDraft` output.
- **Tests:** `bearer-rules.test.ts` plus a case in `packages/commercial/src/agreement/resolve.test.ts` · **Pre/mig:** none · **Rollback:** clear `effectiveUntil` · **Codex:** retire is safe to expose without a warning about rewriting history.

**IT-COST-07** — Enforce effective dating on assignments
`apps/api/src/lib/billing/bearer-rule-zod.ts` · **Change** new · **Pkg** L10 · **Scen** 140,145 · **When** do-now · **Approval** none
- **Accept:** `bearer_rules.effective_from` is `notNull` (`commercial.ts:447`) so the column already enforces presence; the zod layer must reject a missing or non-ISO value with 400 rather than letting a null reach Postgres. Also reject `effectiveUntil <= effectiveFrom`, the same guard `createRateReference` makes at `billing-rate-references.ts:218-222`.
- **Tests:** `apps/api/src/lib/billing/bearer-rule-zod.test.ts` (new, offline) · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** the assignment form can validate dates client-side against a matching server rule.

**IT-COST-08** — Pin the conflict-resolution order with a test, do not rebuild it
`packages/commercial/src/agreement/resolve.test.ts` · **Change** test · **Pkg** L04,L11 · **Scen** 145 · **When** do-now · **Approval** none
- **Accept:** L04 "deterministic winner" is already implemented: `buildLadder` sorts by `audienceTier` (user 1, driver_group 2, none 3) then `scopeTier` (charger 1, circuit 2, installation 3, site 4, none 5) at `resolve.ts:100-112`, and `resolveFactor` takes the first non-null per field independently for bearer, rate and allocation (:47-53). Add cases that would fail if either ordering were changed. Note the fork hazard: `apps/api/src/lib/agreement/resolve.test.ts` is a duplicate that has already drifted (it lacks the `per_connector` block), and both run under the root `vitest.config.ts`.
- **Tests:** `packages/commercial/src/agreement/resolve.test.ts` · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-COST-09** — Audit every assignment write
`apps/api/src/repositories/bearer-rules.ts` `apps/api/src/repositories/agreement-cost-factors.ts` · **Change** new · **Pkg** L08 · **Scen** 145,155 · **When** do-now · **Approval** none
- **Accept:** Both new repositories call `recordAuditAction` in the same transaction as the write, recording actor and the full scope tuple in `metadata`. Baseline to beat: `apps/api/src/repositories/billing-cost-factors.ts` writes **no** audit rows at all today — it is absent from the fourteen files that call `recordAuditAction`.
- **Tests:** `bearer-rules.test.ts`, `agreement-cost-factors.test.ts` · **Pre/mig:** none · **Rollback:** n/a · **Codex:** an assignment history panel becomes possible after IT-AUD-07.

**IT-COST-10** — Backfill audit writes into the existing billing cost-factor CRUD
`apps/api/src/repositories/billing-cost-factors.ts` · **Change** edit · **Pkg** L08 · **Scen** 155 · **When** do-later · **Approval** none
- **Accept:** `createCostFactor` :165, `updateCostFactor` :199, `deactivateCostFactor` :252 and `reactivateCostFactor` :293 each write exactly one audit row. Acceptance: the four-call lifecycle produces four rows. Note the obstacle — `audit.actions.org_id` is `NOT NULL` (`packages/shared/src/db/platform.ts:95`) and `billing.cost_factors` has no org column, so this task depends on IT-AUD-03 or must record a platform-level org id deliberately.
- **Tests:** new parity case · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-COST-11** — Move assignment gates off `billing.write`
`apps/api/src/routes/admin/bearer-rules.ts` `apps/api/src/routes/admin/agreement-cost-factors.ts` · **Change** new · **Pkg** L07,K11 · **Scen** 141 · **When** do-later · **Approval** Andri
- **Accept:** Every mutating route in `billing-cost-factors.ts` (:50, :97, :163, :188) and `billing-rate-references.ts` (:99, :154, :208) is gated on `billing.write`, and `tariff.write` guards nothing anywhere. Assignment routes use `tariff.write` with an `orgIdParam`. Reverses a de-facto convention across the billing surface, so Andri decides whether the existing routes follow.
- **Tests:** `apps/api/src/lib/auth/permissions.test.ts` · **Pre/mig:** none · **Rollback:** revert to `billing.write` · **Codex:** finance-only roles stop seeing assignment controls they cannot use.

**IT-COST-12** — Close L06: the billing catalogue read already exists
`apps/api/src/routes/admin/billing-cost-factors.ts` · **Change** decision · **Pkg** L06 · **Scen** 145 · **When** do-now · **Approval** none
- **Accept:** L06 "cost-factor catalogue read" is implemented — `GET /` at `billing-cost-factors.ts:40` returns the grouped summary from `listCostFactors` (`repositories/billing-cost-factors.ts:63`), mounted at `/api/admin/billing/cost-factors` (`routes/admin/billing.ts:274`). Mark the package done against `billing.cost_factors` and open a successor for `agreements.cost_factors` (IT-COST-02). Scenario 149 ("no cost-factor endpoint, UI hides the control") is therefore already false for this table.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** the cost-factor list control can be enabled now, not stubbed.

**IT-COST-13** — Idempotent bulk assignment
`apps/api/src/repositories/bearer-rules.ts` · **Change** new · **Pkg** L09 · **Scen** 145 · **When** do-later · **Approval** none
- **Accept:** A bulk call applying N assignments twice leaves N rows, not 2N. There is no unique constraint on `bearer_rules` — `commercial.ts:451-453` declares two plain indexes — so idempotency must come from an explicit match on the scope tuple inside the transaction, or from adding a unique index first. State which was chosen.
- **Tests:** `bearer-rules.test.ts` double-apply case · **Pre/mig:** a unique index would need a migration and a duplicate check first · **Rollback:** n/a · **Codex:** bulk apply can be retried safely after a timeout.

**IT-COST-14** — Decide which of the three pricing implementations is authoritative
`apps/api/src/lib/tariff/compute-session-cost.ts` `packages/commercial/src/agreement/resolve.ts` `apps/api/src/repositories/driver-pricing.ts` · **Change** decision · **Pkg** L05,K08 · **Scen** 144,147 · **When** do-now · **Approval** Andri
- **Accept:** The repo's own source contradicts the docs: `driver-pricing.ts:25-34` says "canonical is aspirational, not current" and that `agreement/resolve.ts` has priced 0 sessions, while `apps/api/src/lib/agreement/billing-tick.ts:62-87` records why (1,619 completed sessions, 8 with a `userId`, 0 inside the 30-day `RECENT_WINDOW_DAYS`, newest 2026-05-13). A decision must name one engine as the price of record and say what happens to the other two. Comparison infrastructure exists but is operator-run only: `apps/api/src/lib/billing-shadow/shadow-compare.ts` plus `apps/api/scripts/shadow-compare-resolvers.ts`.
- **Tests:** none · **Pre/mig:** widening `sinceDays` would emit agreement lines for sessions the legacy path already priced — a double-charge risk, not a config tweak · **Rollback:** n/a · **Codex:** determines whether the driver app's "indicative" legend can ever be dropped.

**IT-COST-15** — Make the driver preview apply `BearerRule` overrides
`apps/api/src/repositories/driver-pricing.ts` · **Change** edit · **Pkg** L12,L05 · **Scen** 144 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-COST-14. `summarisePerKwhForList` :175 and `summariseForCharger` :208 sum clause defaults where `defaultBearerType === "usr"` and never consult `bearer_rules`, which the header at :29-34 states as a deliberate limit. A driver with a group-scoped override sees a headline that does not match what the resolver would produce. Acceptance: for a fixture driver with an override, the preview number equals the resolver's `usr`-bearing total.
- **Tests:** `apps/api/src/repositories/driver-pricing.test.ts` · **Pre/mig:** none · **Rollback:** revert to clause defaults · **Codex:** the driver app can show a real per-kWh number instead of an indicative one.

**IT-COST-16** — Ship the `per_connector` enum migration or revert the declaration
`prisma/schema/commercial.prisma` `packages/shared/src/db/commercial.ts` · **Change** schema · **Pkg** L02 · **Scen** 145 · **When** blocked · **Approval** DBA
- **Accept:** Blocked: the schemas are ahead of the database. `rateBasisEnum` includes `per_connector` in both descriptions (`commercial.ts:46`, `prisma/schema/commercial.prisma:406`) and `RATE_BASES` carries it (`types.ts:44`), but grepping `prisma/migrations/` for `per_connector` returns nothing — the note at `types.ts:34-37` says so explicitly. Either add the `ALTER TYPE` migration, or the next `prisma migrate` run against staging generates it unreviewed. A rate reference cannot be stored with this basis until it lands.
- **Tests:** `packages/commercial/src/agreement/types.test.ts` · **Pre/mig:** `ALTER TYPE ... ADD VALUE` is not transactional in older Postgres and cannot be rolled back in the same transaction · **Rollback:** enum values cannot be dropped cleanly — this is one-way · **Codex:** the basis picker can offer per-connector once stored values are legal.

---

## AUD — audit taxonomy and read model (16)

Hardening plus one greenfield read model. The writer exists and works —
`recordAuditAction` (`apps/api/src/lib/audit.ts:58-86`) with its dual
Prisma/Drizzle shim (`isDrizzle` :54) — and fourteen files call it. What does
not exist: any API route over `audit.actions`, any `bearer` actor kind, any
`onBehalfOfOrgId` or `supportContextId` column, any retention policy, and any
test file for the writer. The single reader in the whole repo is
`apps/api/src/repositories/installation-ocpp.ts:272` and `:330`, which reads
three action names to derive one timestamp. So N03 and N04 are greenfield, not
hardening. Two structural constraints shape everything below: `audit.actions.org_id`
is `NOT NULL` (`packages/shared/src/db/platform.ts:95`), and `actorKindEnum`
(:29) is `user | system | vendor_webhook | ocpp_worker` with only `user` ever
written.

**IT-AUD-01** — Add `bearer` to `ActorKind` in both schema descriptions and Postgres
`packages/shared/src/db/platform.ts` `prisma/schema/platform.prisma` `prisma/migrations/<ts>_actorkind_bearer/migration.sql` · **Change** schema · **Pkg** N02 · **Scen** 6 · **When** do-now · **Approval** DBA
- **Accept:** `ALTER TYPE audit."ActorKind" ADD VALUE 'bearer'` plus the matching edit to `actorKindEnum` (platform.ts:29) and the Prisma enum. Acceptance: a row written with `actorKind: "bearer"` inserts; `npm run check:schema-consistency` passes. Scenario 6 cannot pass at all before this.
- **Tests:** `apps/api/test/parity/domain-schemas.test.ts` · **Pre/mig:** `ADD VALUE` is one-way and, on older Postgres, cannot run inside a transaction block · **Rollback:** enum values cannot be dropped — plan to leave it unused if reverted · **Codex:** the audit table can render a bearer badge distinct from a user.

**IT-AUD-02** — Add `on_behalf_of_org_id` and `support_context_id` columns
`packages/shared/src/db/platform.ts` `prisma/schema/platform.prisma` · **Change** schema · **Pkg** N02,N04 · **Scen** 47-52,155 · **When** blocked · **Approval** DBA
- **Accept:** Blocked, partially. `on_behalf_of_org_id` (nullable uuid) can land now. `support_context_id` cannot carry an FK because `support_contexts` does not exist — a repo-wide grep for `SupportContext`, `support_context` and `supportContext` hits only `apps/api/src/lib/auth/permissions.ts:83` and its test file. Land the column as a bare nullable uuid with no FK and a comment naming the missing table, or hold the whole task for C01. Say which in the commit.
- **Tests:** `apps/api/test/parity/schema-columns.test.ts` · **Pre/mig:** nullable column adds, no backfill · **Rollback:** drop the columns while unused · **Codex:** an "acting on behalf of" column becomes renderable.

**IT-AUD-03** — Resolve the `org_id NOT NULL` gap for unattributable events
`packages/shared/src/db/platform.ts` `apps/api/src/routes/public/driver.ts` · **Change** decision · **Pkg** N01,N05 · **Scen** 5,6,155 · **When** do-now · **Approval** Andri
- **Accept:** `audit.actions.org_id` is `NOT NULL` with an FK, which is why the rejection audit at `driver.ts:1214` is wrapped in `if (row.driverGroup)` (:1206) — a malformed token's rejection goes completely unlogged, and the source comment says so. Decide: make `org_id` nullable, or designate a platform org for unattributable events. Scenario 155 ("exactly one audit event per state change") is unachievable for public rejection paths until one is chosen.
- **Tests:** new case in `apps/api/test/parity/driver-invite-redemption-parity.test.ts` · **Pre/mig:** making the column nullable is a one-way relaxation; every existing reader must tolerate null · **Rollback:** re-tightening requires purging null rows · **Codex:** a rejection feed stops having invisible entries.

**IT-AUD-04** — Fix the taxonomy as a constant set, not free text
`apps/api/src/lib/audit-actions.ts` · **Change** new · **Pkg** N05 · **Scen** 155 · **When** do-now · **Approval** none
- **Accept:** `AuditActionInput.action` is a bare `string` (`audit.ts:30`), so every call site invents its own name — `driver_invite.redemption_rejected` (driver.ts:1214), `driver_invite.created` (host-invites.ts:208), `installation.ocpp_password.rotate` (read back at installation-ocpp.ts:272). New module exports a frozen union; `AuditActionInput.action` narrows to it. Acceptance: `npm run typecheck` fails on any string not in the set.
- **Tests:** typecheck via `scripts/check-all.mjs` · **Pre/mig:** existing DB rows keep whatever names they have; the union must include every name currently written or the build breaks · **Rollback:** widen the type back to `string` · **Codex:** the console can map action names to labels exhaustively.

**IT-AUD-05** — Prove the actor can never come from request input
`apps/api/src/lib/audit.ts` · **Change** test · **Pkg** N01 · **Scen** 5 · **When** do-now · **Approval** none
- **Accept:** A test asserts that no call site passes an `actorUserId` derived from a parsed request body. Mechanically checkable form: a lint or check-script rule that flags `actorUserId:` whose right-hand side traces to `parsed.data`, `body.` or `raw.` in the fifteen importing files. Today the session-derived path is convention only — nothing enforces it.
- **Tests:** `apps/api/src/lib/audit.test.ts` (new — no test file exists for this module) · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-AUD-06** — Build the audit read repository
`apps/api/src/repositories/audit-actions.ts` · **Change** new · **Pkg** N03 · **Scen** 155 · **When** do-now · **Approval** none
- **Accept:** New file exporting `listOrgActions({ orgId, since, until, action, actorUserId, cursor })` with keyset pagination on `(occurred_at, id)`. The existing index is `(org_id, occurred_at)` (`platform.ts:104`), so an org-scoped time-ordered query is already covered. Acceptance: the query plan uses that index rather than a sequential scan on a seeded table.
- **Tests:** `apps/api/test/parity/audit-actions.test.ts` (new, real-DB) · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none until IT-AUD-07.

**IT-AUD-07** — Expose `GET /api/admin/orgs/:orgId/audit` gated on `audit.read`
`apps/api/src/routes/admin/audit.ts` `apps/api/src/index.ts` · **Change** new · **Pkg** N03 · **Scen** 155 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-AUD-06. Gated `requirePermission("audit.read", { orgIdParam: "orgId" })` — `audit.read` is declared at `permissions.ts:74`, bundled into ADMIN at :158 and into `READ_ALL`/support at :119, and currently guards zero routes. The `orgIdParam` is not optional here: without it `orgId` resolves to null and only the platform expansion can pass, which would make an org's own admin unable to read their own log. New public read surface over sensitive data, hence Andri.
- **Tests:** `apps/api/test/parity/audit-actions.test.ts` plus a `require-permission.test.ts` case · **Pre/mig:** none · **Rollback:** unmount · **Codex:** the org activity page can render real rows instead of the "not tracked yet" state.

**IT-AUD-08** — Project staff actions into the org-visible feed
`apps/api/src/repositories/audit-actions.ts` · **Change** new · **Pkg** N04 · **Scen** 47-52,155 · **When** blocked · **Approval** Andri
- **Accept:** Blocked on IT-AUD-02's `on_behalf_of_org_id`. Rows written by platform staff acting into an org appear in that org's feed, flagged as staff-originated. Until the column exists there is no way to tell a staff action from a member action — `actorKind` is `user` for both, and every one of the 24 `actorKind:` literals in the repo is `"user"`. Do not ship a feed that silently omits staff activity; ship it flagged or ship it blocked.
- **Tests:** `audit-actions.test.ts` · **Pre/mig:** none beyond IT-AUD-02 · **Rollback:** filter the flag out of the projection · **Codex:** the org sees "changed by Straumvakt support" rather than an unattributed edit.

**IT-AUD-09** — Make `audit.actions` append-only at the database
`prisma/migrations/<ts>_audit_actions_append_only/migration.sql` · **Change** new · **Pkg** N06 · **Scen** 155 · **When** do-later · **Approval** DBA
- **Accept:** `REVOKE UPDATE, DELETE ON audit.actions` from the application role, or a trigger that raises on both. Acceptance: an `UPDATE audit.actions SET action = ...` as the app role fails. Nothing in `apps/api/src` issues either statement today, so the change is provably behaviour-neutral for current code — a grep for `auditAction.update` and `auditAction.delete` returns nothing.
- **Tests:** `apps/api/test/parity/audit-actions.test.ts` negative case · **Pre/mig:** the partition/retention cron must not need DELETE on this table — verify against `apps/api/src/lib/db/partition-cron.ts` `DROPPABLE_PARENTS` :226 before applying · **Rollback:** re-grant · **Codex:** none.

**IT-AUD-10** — Assert no hashes, DSNs, tokens or personal identifiers in logs
`apps/api/src/lib/audit.ts` `apps/api/src/repositories/audit-actions.ts` · **Change** test · **Pkg** N08 · **Scen** 156 · **When** do-now · **Approval** none
- **Accept:** An offline test scans `metadata` builders at every `recordAuditAction` call site for keys named `tokenHash`, `passwordHash`, `passwordKeyHash`, `passphrase`, `kennitala` and for anything matching a connection-string shape. Known live risk to check first: `driver.ts:1218-1223` writes `boundUserId` and `attemptedByUserId` into metadata — user ids, arguably fine, but the rule must be explicit either way rather than assumed.
- **Tests:** `apps/api/src/lib/audit.test.ts` · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-AUD-11** — Set a retention policy for `audit.actions`
`apps/api/src/lib/db/partition-cron.ts` · **Change** decision · **Pkg** N07 · **Scen** 155 · **When** do-later · **Approval** Andri
- **Accept:** `audit.actions` is not partitioned and appears in no retention path — `POSTGRES_RETENTION_DAYS` :191 and `DROPPABLE_PARENTS` :226 in `partition-cron.ts` cover the events tables, not this one. A written policy with a number of days and a legal owner. Flagged legal in 18A; do not pick a number unilaterally.
- **Tests:** none · **Pre/mig:** any future purge is irreversible · **Rollback:** n/a · **Codex:** none.

**IT-AUD-12** — Write the first unit test for the audit writer
`apps/api/src/lib/audit.test.ts` · **Change** test · **Pkg** N01,N05 · **Scen** 155 · **When** do-now · **Approval** none
- **Accept:** No `audit.test.ts` exists — a grep for `recordAuditAction` across all `*.test.ts` returns no file, and the only coverage is incidental via a Prisma fake in `apps/api/src/repositories/driver-access-requests.test.ts:487-488`. Cover both shim branches: a fake with `.insert` takes the Drizzle path, a fake with only `.auditAction` takes the Prisma path (`isDrizzle` :54). Offline, no DB.
- **Tests:** this file, picked up by the root `vitest.config.ts` include list · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.

**IT-AUD-13** — Add a harness for "exactly one event per state change"
`apps/api/test/parity/audit-single-event.test.ts` · **Change** test · **Pkg** N01 · **Scen** 155 · **When** do-later · **Approval** none
- **Accept:** A reusable helper that snapshots the `audit.actions` count for an org, runs one mutation, and asserts a delta of exactly one with the expected action name. Scenario 155 has no harness today. First subjects: the four agreement transitions from IT-AGR-15 and the assignment writes from IT-COST-09.
- **Tests:** this file, run via `npm run test:parity --workspace apps/api` with `vitest.parity.config.ts` — note the parity suite matches none of the root vitest globs · **Pre/mig:** needs a database · **Rollback:** delete the file · **Codex:** none.

**IT-AUD-14** — Decide the fate of the dual-client shim before Group N lands
`apps/api/src/lib/audit.ts` · **Change** decision · **Pkg** N01 · **Scen** 155 · **When** do-now · **Approval** none
- **Accept:** The header at :18-19 promises the Prisma branch is deleted "when the last Prisma caller is gone", and the count in the same comment (:8, "called from 15 files") is tracked by hand. Decide: freeze the shim for the duration of Group N, or port the remaining Prisma callers first. Every column added by IT-AUD-01/02 has to be added twice while both branches exist.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-AUD-15** — Close the email-without-audit gap
`apps/api/src/lib/email.ts` `apps/api/src/repositories/registration.ts` `apps/api/src/routes/admin/org-invites.ts` · **Change** edit · **Pkg** N01,R06 · **Scen** 155,156 · **When** do-later · **Approval** none
- **Accept:** `sendEmail` (`email.ts:41-101`) has seven call sites and fails open with a warn; of those, only `driver-access-requests.ts` also writes an audit row. Driver registration, email verification, password reset and host-application submission produce no `audit.actions` row at all. Acceptance: each of those four paths writes one row recording that a send was attempted and whether it succeeded — recipient address redacted per IT-AUD-10.
- **Tests:** `apps/api/src/lib/email.test.ts` (exists) plus parity cases · **Pre/mig:** none · **Rollback:** revert · **Codex:** a "verification email sent" state becomes readable instead of inferred.

**IT-AUD-16** — Replace the hand-counted caller comment with a check
`apps/api/src/lib/audit.ts` `scripts/check-all.mjs` · **Change** ci · **Pkg** N01 · **Scen** none · **When** do-later · **Approval** none
- **Accept:** The comment at `audit.ts:8` says 15 files; the real count of non-test importers is 15 including `audit.ts` itself, i.e. 14 callers — the checklist has already drifted once. Either delete the number or add a check to the nine in `scripts/check-all.mjs` that computes it. Note the standing constraint: no test suite runs in CI at all — `.github/workflows/check.yml:64-70` is `npm install`, `npm run db:generate`, `npm run check`, and none of the nine checks is vitest. Any new gate must be one of the nine offline checks.
- **Tests:** `npm run check` · **Pre/mig:** none · **Rollback:** revert the check entry · **Codex:** none.
# Appendix 19B — part 5 of 5

Source-linked implementation tasks for the four cross-cutting lanes: frontend
wiring, CI guardrails, migration/preflight/rollback, and observability.

Every path below was opened in the worktree at
`E:/Claude/Straumvakt-onboarding-domain` (branch `docs/singular-onboarding-domain-packet`).
Paths marked `new` do not exist and are proposals.

Scenario numbering follows `18C-scenarios.md`. Package IDs follow `18A-work-packages.md`.

---

## UI — Codex / frontend wiring (13)

This is a **wiring-contract** lane, not a UI lane. There is no `src/app/api/`
directory in the web app — `find src -name route.ts` returns nothing — so every
`/api/*` path the UI touches is a cross-origin request to the `apps/api` Hono
Worker, resolved by `HOSTNAME_TO_API` in `src/lib/api-client.ts:29-35` plus
`NEXT_PUBLIC_API_BASE_URL`. The packet's Group O reads as if it were hardening an
existing UI surface; it is not. There is no demo-mode flag anywhere in the repo,
no disabled-state copy library, and **zero** `*.test.ts` files under `src/`. Every
task here is greenfield except IT-UI-01, -02, -06, -07, -09, -13, which edit code
that exists. None of these gate the straumvakt.org visual lane — they are the
contracts that lane consumes, and the visual work can proceed against today's
behaviour while they land.

**IT-UI-01** — Preserve API error codes through apiFetchJson
`src/lib/api-client.ts` `src/lib/api-client-server.ts` · **Change** edit · **Pkg** C04,O04,O05 · **Scen** 149-154 · **When** do-now · **Approval** none
- **Accept:** `apiFetchJson` rejects with an error object carrying `.status` and `.code`, where `.code` is the raw `error` string from the body. A 403 body `{"error":"support_context_required"}` yields `err.code === "support_context_required"`; today `apiFetchJson` at `:72-84` throws `new Error(msg)` and the code is destroyed into a display string.
- **Tests:** `src/lib/api-client.test.ts` (new file — see IT-UI-03) · **Pre/mig:** none · **Rollback:** revert one file; callers that only read `.message` keep working because `.message` is unchanged · **Codex:** the UI can branch on a machine code (`already_claimed`, `support_context_required`, `not_available`) instead of string-matching English.

**IT-UI-02** — Add an explicit /org/[slug] rule to src/middleware.ts
`src/middleware.ts` · **Change** edit · **Pkg** G06,O06 · **Scen** 150,156 · **When** do-now · **Approval** none
- **Accept:** `middleware()` contains a named branch for paths beginning `/org/` that is reached before the catch-all at `:113-131`, and an unauthenticated GET `/org/anything` returns a 307 to `/` from that branch rather than by falling through. Observable in a unit test asserting the branch is hit, not just the status.
- **Tests:** `src/middleware.test.ts` — `redirects unauthenticated /org/<slug> from the org branch` · **Pre/mig:** none · **Rollback:** delete the branch; behaviour returns to the catch-all, which produces the same status today · **Codex:** `/org/[slug]` gating becomes a stated contract instead of an inherited default, so the tenant landing page can rely on being reached only with a session.

**IT-UI-03** — Create the first test file under src/
`src/middleware.test.ts` · **Change** new · **Pkg** P01,O04 · **Scen** 154 · **When** do-now · **Approval** none
- **Accept:** `npx vitest run src` reports at least one passing test. It reports "No test files found" today: `vitest.config.ts:19-24` already includes `src/**/*.test.ts`, and `find src -name "*.test.ts*"` is empty, so the glob currently matches nothing.
- **Tests:** this task is the test · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** gives O04 ("absent endpoint → assert disabled state") a harness to extend rather than a directory to invent.

**IT-UI-04** — Add NEXT_PUBLIC_DEMO_MODE and a build-time guard
`scripts/check-demo-mode.mjs` `wrangler.jsonc` `scripts/check-all.mjs` · **Change** new · **Pkg** O02,O03 · **Scen** 153 · **When** do-now · **Approval** Andri
- **Accept:** with `NEXT_PUBLIC_DEMO_MODE` truthy and `NEXT_PUBLIC_APP_ENV` in `{staging, production}`, `node scripts/check-demo-mode.mjs` exits 1; with either absent it exits 0. `grep -rn DEMO_MODE` over non-doc files returns zero hits today, so scenario 153 has nothing to hook into.
- **Tests:** `scripts/check-demo-mode.test.mjs` (matched by `vitest.config.ts:22` `scripts/**/*.test.mjs`) · **Pre/mig:** none · **Rollback:** remove the check from `scripts/check-all.mjs`; the var is inert on its own · **Codex:** a single flag the UI can read to render fixture data, with a guard proving it can never be on in staging or production.

**IT-UI-05** — Extract a disabled-state copy module
`src/lib/disabled-copy.ts` `src/app/org/[slug]/page.tsx` · **Change** new · **Pkg** O01,O06,O07 · **Scen** 149-151 · **When** do-now · **Approval** none
- **Accept:** the strings "This isn't tracked yet" and "Managed through driver groups" each appear exactly once in `src/`, in the new module, and `src/app/org/[slug]/page.tsx` imports them. Today the only disabled affordance in the whole app is the literal `t("væntanlegt", "soon")` at `:296-299` plus the `.soon` classes in `src/app/org/org-landing.css`; neither target string exists anywhere under `src/`.
- **Tests:** `src/lib/disabled-copy.test.ts` asserting one export per unbuilt section key · **Pre/mig:** none · **Rollback:** inline the strings again · **Codex:** one import for every "not built yet" surface, so copy changes are a one-file diff.

**IT-UI-06** — Resolve LanguageProvider's forced English
`src/components/language-provider.tsx` `src/lib/org-tenant.ts` · **Change** decision · **Pkg** O01 · **Scen** 149-151 · **When** do-now · **Approval** Andri
- **Accept:** either `FORCED_LANGUAGE` is removed and a test proves `initialLanguage="is"` renders an Icelandic tagline from `TENANT_REGISTRY`, or the `language === "is"` branches and the Icelandic entries in `TENANT_REGISTRY` are deleted with the decision recorded in-file. Both outcomes are checkable; the current state (a `FORCED_LANGUAGE = "en"` constant plus an `initialLanguage` prop declared and never read) is not.
- **Tests:** `src/components/language-provider.test.ts` · **Pre/mig:** none · **Rollback:** restore the constant · **Codex:** tells the visual lane whether Icelandic copy is worth writing. Right now every Icelandic string it produces is unreachable.

**IT-UI-07** — Refuse unknown org slugs instead of falling back
`src/lib/org-context.ts` · **Change** edit · **Pkg** G06,O06 · **Scen** 150 · **When** do-now · **Approval** Andri
- **Accept:** for a caller with two `host_admin` memberships and `slug="nope"`, `pickMembership` returns `null` and `requireOrgContext` redirects, rather than returning `hostAdminOrgs[0]` as it does at `:116`. Observable: the address bar never silently rewrites from an unknown slug to a different tenant's canonical URL.
- **Tests:** `src/lib/org-context.test.ts` — `unknown slug with multiple host_admin orgs resolves to null` · **Pre/mig:** none · **Rollback:** restore the fallback return · **Codex:** a wrong bookmark produces a visible refusal the UI can style, not a silent tenant swap.

**IT-UI-08** — Delete or wire src/lib/api-auth.ts
`src/lib/api-auth.ts` · **Change** delete · **Pkg** — · **Scen** — · **When** do-now · **Approval** none
- **Accept:** either the file is gone from `git ls-files src/lib`, or at least one file under `src/` imports it. It has zero importers today because the Next app serves no API routes at all (`src/app/api/` does not exist), so `requireAdmin`, `requireStraumvaktStaff`, `unauthorized` and `apiError` are unreachable.
- **Tests:** `check:unused-exports` does not cover `src/` (see IT-CI-11); a deletion needs no test · **Pre/mig:** none · **Rollback:** `git revert` · **Codex:** removes the strongest false signal in the web app — a file that looks like the auth seam for Next API routes that do not exist.

**IT-UI-09** — Fix or remove the permanent /tenants redirect
`next.config.mjs` · **Change** edit · **Pkg** O02 · **Scen** 153 · **When** do-now · **Approval** Andri
- **Accept:** no `redirects()` entry targets a path with no route segment under `src/app`. Both entries at `:19-32` send `/tenants*` to `/accounts*`, and `src/app/accounts` does not exist — the destination is a 404, cached by browsers because `permanent: true`.
- **Tests:** `src/app/redirects.test.ts` asserting every redirect destination prefix resolves to a directory under `src/app` · **Pre/mig:** none · **Rollback:** restore the entries — but note browsers that already cached the 301 will need the replacement redirect to un-stick them, which is why this needs Andri · **Codex:** stops the visual lane debugging a 404 that is config, not routing.

**IT-UI-10** — Give local dev a resolvable API base URL
`src/lib/api-client.ts` `src/lib/api-client-server.ts` · **Change** edit · **Pkg** O04 · **Scen** 152 · **When** do-now · **Approval** none
- **Accept:** with `NEXT_PUBLIC_API_BASE_URL` unset and `window.location.hostname` not in `HOSTNAME_TO_API`, `resolveBaseUrl()` returns a non-empty origin. Today it returns `""` (`src/lib/api-client.ts:48`), so `POST /api/admin/login` from `src/app/page.tsx:64-68` resolves same-origin and 404s, because the Next app serves no such route. `wrangler.jsonc:22` sets the production value to `""` as well.
- **Tests:** `src/lib/api-client.test.ts` — `falls back to a real origin when the env var is empty` · **Pre/mig:** none · **Rollback:** restore the empty-string fallback · **Codex:** login works against a local API without editing source, which is the current blocker for any UI work that needs a session.

**IT-UI-11** — Specify the support-mode banner contract (blocked)
`docs/domain/onboarding/contracts/support-banner.md` · **Change** new · **Pkg** O05,C04,C08 · **Scen** 47-62,154 · **When** blocked · **Approval** none
- **Accept:** the doc names the exact response body the banner keys off, and a test asserts the banner component renders nothing while no endpoint emits it. **Blocker:** nothing emits `403 support_context_required` — `SupportContext`, `support_contexts` and `GET /support-contexts/current` do not exist in any `.ts`, `.prisma` or `.sql` file in the repo, so C01/C04/C08 are greenfield. The contract can be written now; the banner cannot be verified.
- **Tests:** `src/components/support-banner.test.ts` asserting the null render · **Pre/mig:** none · **Rollback:** delete the doc · **Codex:** unblocks banner layout work immediately against a fixed shape, without waiting for C01.

**IT-UI-12** — Attribution display rule: never name a person on installation/unknown
`src/components/session-detail-view.tsx` · **Change** edit · **Pkg** O10,E14 · **Scen** 91-98,120 · **When** blocked · **Approval** none
- **Accept:** when the session's attribution is `installation` or `unknown`, `driverDisplayName` and `driverEmail` (rendered unconditionally at `:221-222`) are not rendered, and the row shows the installation instead. **Blocker:** the component has no attribution field to read — `session_attribution` does not exist in any schema file, and the detail type at `:30-33` carries only `driverIdTag`, `driverUserId`, `driverDisplayName`, `driverEmail`. Until E06 lands, the component cannot distinguish "attributed to a driver" from "an idTag happened to map to a user".
- **Tests:** `src/components/session-detail-view.test.ts` · **Pre/mig:** none · **Rollback:** revert one file · **Codex:** the display rule can be coded against a stub prop now and switched to the real field when E06 ships.

**IT-UI-13** — Correct the three stale "middleware never runs" comments
`src/middleware.ts` `src/app/staff/page.tsx` `src/app/staff/overview/page.tsx` `docs/relaunch-middleware-reconciliation.md` · **Change** edit · **Pkg** — · **Scen** 156 · **When** do-now · **Approval** none
- **Accept:** the string "does not currently execute" (and its variants) appears in none of the three source files, and `docs/relaunch-middleware-reconciliation.md:3` no longer reads `Status: open`. `src/app/staff/page.tsx:27-34` currently tells the reader the middleware "does not currently execute at all", which was true before the file moved into `src/` and is false now.
- **Tests:** none — comment-only · **Pre/mig:** none · **Rollback:** n/a · **Codex:** stops the next implementer re-deriving the staff gate from a false premise, which is the single largest doc-vs-reality gap in the web app.

---

## CI — CI and static guardrails (13)

Almost entirely greenfield, and the packet mis-frames it badly. Group P says "in
CI, offline" for its P0 items as if a test runner existed there: it does not.
`.github/workflows/check.yml:64-70` has exactly three steps — `npm install`,
`npm run db:generate`, `npm run check` — and `scripts/check-all.mjs:14-36` lists
nine checks, none of them vitest. **No test in this repository has ever run in
CI.** IT-CI-01 must land before any other task in the packet that says "fails CI",
or those acceptance criteria are unenforceable prose. The four new guards the
brief asks for (permission-matrix drift, unenforced-verb inventory,
no-upsert-in-consume, impersonate-absent) are all writable offline today.

**IT-CI-01** — Add a vitest step to the check workflow
`.github/workflows/check.yml` · **Change** ci · **Pkg** P01,P02,P03 · **Scen** 153-156 · **When** do-now · **Approval** Andri
- **Accept:** the `check` job contains `- run: npm test`, and a deliberately failing assertion added to any file matching `vitest.config.ts:19-24` turns the job red. Today no test file affects the job's exit status at all.
- **Tests:** the whole existing suite becomes the test · **Pre/mig:** none — `npm test` is `vitest run`, needs no database · **Rollback:** delete the step · **Codex:** every "fails CI" acceptance criterion elsewhere in this packet becomes real. Nothing else in Group P is worth writing until this lands.

**IT-CI-02** — Decide whether apps/api/test/ runs at all
`vitest.config.ts` `apps/api/test/parity/_harness.ts` · **Change** ci · **Pkg** P10,P11 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** either `apps/api/test/**/*.test.ts` is added to the include globs and `npx vitest run` skips (not fails) every parity file when `hasDb` is false, or a comment in `vitest.config.ts` records that the parity suite is run by hand only. The include list today is `src/**`, `apps/api/src/**`, `packages/**`, `scripts/**/*.test.mjs` — `apps/api/test/parity/*.test.ts` matches none of them, so those files do not run locally either, not merely in CI.
- **Tests:** `npx vitest run --reporter=verbose` output names the parity files as skipped · **Pre/mig:** none · **Rollback:** revert the glob · **Codex:** none.

**IT-CI-03** — Permission-matrix drift check derived from source
`apps/api/src/lib/auth/permissions.test.ts` `packages/shared/src/db/identity.ts` · **Change** test · **Pkg** P04,D10 · **Scen** 63-70 · **When** do-now · **Approval** none
- **Accept:** the role list under test is derived from `membershipRoleEnum` (`packages/shared/src/db/identity.ts:61`) rather than hand-written, and adding a value to that enum without a bundle fails the test without anyone editing the test. `ALL_MEMBERSHIP_ROLES` at `permissions.test.ts:26-38` is hand-kept and is **missing `host_admin`**, which is in the Drizzle enum, in the domain union and in `PLATFORM_ROLE_PERMISSIONS`' sibling bundle map — so the "every role has a bundle" assertion has never seen it.
- **Tests:** `permissions.test.ts` — `every membership role in the enum has a bundle` · **Pre/mig:** none · **Rollback:** restore the literal array · **Codex:** none.

**IT-CI-04** — Unenforced-verb inventory guard
`scripts/check-enforced-verbs.mjs` `scripts/check-all.mjs` `.enforced-verbs-known.json` · **Change** new · **Pkg** P05,D01-D09,K11 · **Scen** 63-74 · **When** do-now · **Approval** none
- **Accept:** the script parses `PER_TENANT_PERMISSIONS` and `PLATFORM_PERMISSIONS` from `apps/api/src/lib/auth/permissions.ts`, greps `requirePermission("…")` and `assertPermission(…, "…")` call sites across `apps/api/src`, and exits 1 on any verb absent from both the call sites and the committed baseline. The baseline it must ship with, verified by grep on this branch: `platform.impersonate` (`:82`), `platform.support.action` (`:83`), `tariff.write` (`:69`), `contract.write` (`:72`) — four verbs, zero guard sites each.
- **Tests:** `scripts/check-enforced-verbs.test.mjs` · **Pre/mig:** none · **Rollback:** remove from `check-all.mjs` · **Codex:** none.
- *Correction to 18A:* **D02 is already done.** `member.remove` is enforced at `apps/api/src/domains/identity/routes/admin-memberships.ts:33`. It must not go in the baseline.

**IT-CI-05** — Static guard: no upsert in the invite consume path
`scripts/check-no-upsert-in-consume.mjs` `scripts/check-all.mjs` · **Change** new · **Pkg** A02,P01 · **Scen** 1-18 · **When** do-now · **Approval** none
- **Accept:** the script exits 1 while `apps/api/src/routes/public/invites.ts` contains `.upsert(`. It exits 1 **today** — `tx.userCredential.upsert` sits inside the consume transaction at roughly `:142`, with a comment calling it "defensive". Wire it into `check-all.mjs` only in the same commit as A02, or CI goes red on every branch immediately.
- **Tests:** `scripts/check-no-upsert-in-consume.test.mjs` with both a clean and a dirty fixture · **Pre/mig:** none · **Rollback:** remove from `check-all.mjs` · **Codex:** none.

**IT-CI-06** — Guard that platform.impersonate stays deleted (blocked)
`scripts/check-enforced-verbs.mjs` `apps/api/src/lib/auth/permissions.test.ts` · **Change** ci · **Pkg** D01 · **Scen** 71-74 · **When** blocked · **Approval** Andri
- **Accept:** `grep -c "platform.impersonate" apps/api/src` returns 0, and a guard fails if the literal reappears. **Blocker:** the verb is still declared at `permissions.ts:82`, bundled into `platform_admin` at `:249` and `support_agent` at `:261`, reaches `super_user` through the spread at `:243`, and is positively asserted at `permissions.test.ts:192` (`support_agent can impersonate but cannot write tenants`). Deleting it means editing that test, which is a recorded expectation — hence Andri.
- **Tests:** `permissions.test.ts:192` must be rewritten or removed, not left passing · **Pre/mig:** none · **Rollback:** restore the verb in all four places · **Codex:** none.

**IT-CI-07** — Wire check:migrations into CI behind a secret (blocked)
`.github/workflows/check.yml` · **Change** ci · **Pkg** Q09,Q10 · **Scen** — · **When** blocked · **Approval** Andri
- **Accept:** the workflow runs `npm run check:migrations` with `DATABASE_URL` from a secret, and the job is green. **Two blockers, both named in `check.yml:10-44` itself:** (a) `20260807003000_drop_issues_scaffold` and `20260807120000_drop_never_used_tables` are on disk and unrecorded against staging, so the check exits non-zero the moment it is wired (see IT-MIG-01); (b) the workflow triggers on `push: branches ["**"]` and on `pull_request`, so a staging credential would be reachable from every branch — that is a decision, not a wiring chore.
- **Tests:** none · **Pre/mig:** depends on IT-MIG-01 · **Rollback:** delete the step and rotate the secret · **Codex:** none.

**IT-CI-08** — Run the mobile Dart tests somewhere
`.github/workflows/check.yml` `apps/mobile/test/` · **Change** ci · **Pkg** P06,P12,A12 · **Scen** 19-30 · **When** blocked · **Approval** none
- **Accept:** `flutter test` runs in a job and its exit status gates the workflow. **Blocker:** there is nothing to run. `apps/mobile/test/` contains only `widget_test.dart`; `apps/mobile/test/api/client_contract_test.dart`, which `08-evidence-ledger.md:61` cites, is not on this branch. A12 ("rename mobile contract test") has no file to rename — it is a *write* task, not a rename.
- **Tests:** a new `apps/mobile/test/api/client_contract_test.dart` asserting the three-field body `client.dart:101-105` actually sends · **Pre/mig:** none · **Rollback:** delete the job · **Codex:** none.

**IT-CI-09** — Decide the lockfile question
`.gitignore` `.github/workflows/check.yml` · **Change** decision · **Pkg** P11 · **Scen** — · **When** do-now · **Approval** Andri
- **Accept:** either `package-lock.json` is committed and the workflow uses `npm ci` with `cache: npm`, or the comment at `check.yml:57-62` is kept and a rationale is recorded. Today the lockfile is gitignored deliberately and CI runs `npm install --no-audit --no-fund` with no cache, so no two CI runs are guaranteed to install the same dependency tree — which makes "green in CI" a weaker statement than it reads.
- **Tests:** none · **Pre/mig:** none · **Rollback:** re-add the ignore rule · **Codex:** none.

**IT-CI-10** — Redaction guard for log lines
`scripts/check-log-redaction.mjs` `scripts/check-all.mjs` · **Change** new · **Pkg** N08 · **Scen** 156 · **When** do-now · **Approval** none
- **Accept:** the script exits 1 if any `console.*` call in `apps/api/src` or `gateway/src` interpolates an identifier matching `/passwordHash|passphraseHash|salt|DATABASE_URL|apiKey|RESEND_API_KEY|token(?!Class)/`. It must pass on the current tree or ship with an explicit baseline listing each exemption.
- **Tests:** `scripts/check-log-redaction.test.mjs` with a dirty fixture · **Pre/mig:** none · **Rollback:** remove from `check-all.mjs` · **Codex:** none.

**IT-CI-11** — Extend the unused-export guard to packages/
`scripts/check-unused-exports.mjs` · **Change** edit · **Pkg** P11,Q03 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** the walk covers `packages/*/src` in addition to `apps/api/src` and `apps/api/test`, and the baseline is regenerated. It walks only `SRC = apps/api/src` and `TEST = apps/api/test` today (`:34-39`), so nothing in `packages/contracts` or `packages/shared` is covered by any dead-code guard — which matters because `packages/contracts` has zero consumers outside its own 31 re-export shims.
- **Tests:** existing `scripts/check-schema-consistency.test.mjs` pattern; add `scripts/check-unused-exports.test.mjs` · **Pre/mig:** none · **Rollback:** revert the walk list · **Codex:** none.

**IT-CI-12** — Delete the duplicated agreement resolver test
`apps/api/src/lib/agreement/resolve.test.ts` · **Change** delete · **Pkg** P07,K08 · **Scen** 137-148 · **When** do-now · **Approval** none
- **Accept:** `npx vitest run` executes the resolver assertions once, not twice. `apps/api/src/lib/agreement/resolve.ts` is a 15-line shim over `packages/commercial/src/agreement/resolve.ts`, and both `apps/api/src/lib/agreement/resolve.test.ts` and `packages/commercial/src/agreement/resolve.test.ts` match the include globs and both run — any headline test count for Group P is inflated by that pair.
- **Tests:** the surviving `packages/commercial/src/agreement/resolve.test.ts` must still cover `per_connector` (`:508-559`) · **Pre/mig:** none · **Rollback:** `git revert` · **Codex:** none.

**IT-CI-13** — Guard that every route module is mounted
`scripts/gen-api-endpoints.mjs` · **Change** edit · **Pkg** P05,Q12 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** `npm run check:api-endpoints` fails when a file under `apps/api/src/routes` exports a Hono app that no `app.route(...)` in `apps/api/src/index.ts` mounts. It passes today while `apps/api/src/routes/admin/org-email-domains.ts` — fully implemented and DB-tested — is unreachable in production, because the generator walks mounts and never asks the inverse question.
- **Tests:** `scripts/gen-api-endpoints.test.mjs` (new) with an unmounted fixture · **Pre/mig:** none · **Rollback:** revert · **Codex:** none.

---

## MIG — Migration, preflight and rollback (16)

Hardening in shape, greenfield in content. Two migration systems run in parallel:
`prisma/migrations/` holds 47 directories plus `migration_lock.toml`, and
`apps/api/drizzle/meta/_journal.json` holds two entries (`0000_baseline`,
`0001_regular_talos`). Only the Prisma set is checked, only by hand, only with a
live `DATABASE_URL`. Two migrations dated 20260807 are on disk and unrecorded
against staging, so `check:migrations` exits non-zero today. **No SQL is executed
by any task below — they specify it.** Anything that touches a real database
carries an explicit approval.

**IT-MIG-01** — Reconcile the two unrecorded staging migrations
`prisma/migrations/20260807003000_drop_issues_scaffold/` `prisma/migrations/20260807120000_drop_never_used_tables/` · **Change** decision · **Pkg** Q10 · **Scen** — · **When** blocked · **Approval** DBA
- **Accept:** `npm run check:migrations` against staging prints no pending migrations and exits 0. Both directories exist on disk; the DDL was applied by hand and never recorded in `_prisma_migrations`, so `migrate status` lists them as pending and `migrate deploy` would attempt to re-run drops. **Blocker:** requires a live connection to staging, which is out of scope for this track and is Andri's call.
- **Tests:** none — this is a database state change · **Pre/mig:** the reconciliation *is* the migration step; use `prisma migrate resolve --applied` per directory, never `migrate deploy` · **Rollback:** none needed — `resolve --applied` only writes the ledger row · **Codex:** none.

**IT-MIG-02** — Author the missing per_connector Prisma migration
`prisma/migrations/<ts>_rate_basis_per_connector/migration.sql` · **Change** schema · **Pkg** Q01 · **Scen** 137-148 · **When** do-now · **Approval** DBA
- **Accept:** `prisma migrate diff --from-migrations --to-schema-datamodel` produces empty output for the `agreements.RateBasis` enum. Today `per_connector` is declared in `packages/shared/src/db/commercial.ts:46`, `prisma/schema/commercial.prisma:406` and the generated copy `apps/api/prisma/schema/commercial.prisma:416`, and the only SQL for it is `apps/api/drizzle/0001_regular_talos.sql:1` — there is **no** Prisma migration, so the next `prisma migrate dev` will generate its own `ALTER TYPE` and try to add a value that already exists.
- **Tests:** none offline · **Pre/mig:** `ALTER TYPE … ADD VALUE` cannot run inside a transaction block on PostgreSQL below 12; state the server version in the migration header · **Rollback:** enum values cannot be dropped — this one is forward-only, which is why it needs DBA sign-off before it is written, not after · **Codex:** none.

**IT-MIG-03** — Write the two-schema authoring rule down
`docs/domain/onboarding/contracts/schema-change-order.md` · **Change** new · **Pkg** Q01,Q02 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** the doc states the order (Drizzle declaration in `packages/shared/src/db/*.ts` first, `drizzle-kit generate`, then the matching `prisma/schema/*.prisma` edit, then `npm run sync:api-schema`) and names the guard for each step. It must state that `prisma/schema.prisma` is **not a file** — the schema is the folder `prisma/schema/` with nine `.prisma` files, and `apps/api/prisma/schema/` is generated, never hand-edited.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-MIG-04** — Specify the expand-phase table set
`docs/domain/onboarding/contracts/expand-phase.md` · **Change** new · **Pkg** Q01,C01,E01,E06,E10,G01-G05,J01 · **Scen** 47-62,75-98,99-112,121-128 · **When** do-now · **Approval** none
- **Accept:** every table listed carries a "does not exist today" line verified by grep. All of them do: `support_contexts`, `onboarding_workflow`, `onboarding_step`, `onboarding_substep`, `onboarding_event`, `session_attribution`, `authorization_decision`, `installation_access_credential`, `notification_outbox`, and the column `IdToken.token_class` return zero hits across `.ts`, `.tsx`, `.prisma`, `.sql`, `.mjs` and `.dart`. Additive-only: no drops, no NOT NULL without a default.
- **Tests:** none · **Pre/mig:** this doc *is* the migration spec for Q01 · **Rollback:** each table reverses by `DROP TABLE`; state that per table · **Codex:** none.

**IT-MIG-05** — Specify the one-open-workflow-per-org partial unique index
`docs/domain/onboarding/contracts/expand-phase.md` · **Change** schema · **Pkg** G01,G02 · **Scen** 99-112 · **When** blocked · **Approval** none
- **Accept:** the spec contains a partial unique index on `(organisation_id) WHERE state NOT IN ('active','cancelled')`, and a stated test that a second open workflow raises a unique violation rather than being rejected by application code. **Blocker:** `onboarding_workflow` does not exist (IT-MIG-04); this is the index specification, not the index.
- **Tests:** `apps/api/test/parity/onboarding-workflow.test.ts` (new, DB-gated) · **Pre/mig:** part of expand · **Rollback:** `DROP INDEX` · **Codex:** none.

**IT-MIG-06** — Specify the attribution CHECK constraint
`docs/domain/onboarding/contracts/expand-phase.md` · **Change** schema · **Pkg** E05,E14 · **Scen** 91-98 · **When** blocked · **Approval** none
- **Accept:** the spec contains `CHECK (attribution NOT IN ('installation','unknown') OR subject_user_id IS NULL)` on `session_attribution`, and states that the constraint — not the resolver — is what rejects a violation. **Blocker:** `session_attribution` does not exist.
- **Tests:** a DB-gated insert asserting the constraint raises `23514` · **Pre/mig:** part of expand · **Rollback:** `ALTER TABLE … DROP CONSTRAINT` · **Codex:** lets IT-UI-12 be written against a guaranteed invariant rather than a hoped-for one.

**IT-MIG-07** — Specify the agreement overlap exclusion constraint
`docs/domain/onboarding/contracts/expand-phase.md` · **Change** schema · **Pkg** K05,P07 · **Scen** 139 · **When** blocked · **Approval** DBA
- **Accept:** the spec includes `CREATE EXTENSION IF NOT EXISTS btree_gist` and an `EXCLUDE USING gist` over the counterparty/installation key plus a `tstzrange(effective_from, effective_until)`. Verified absent: `grep -rn "btree_gist\|tstzrange\|EXCLUDE USING" prisma/migrations apps/api/drizzle` returns nothing, so K05's "the exclusion constraint rejects the second" describes nothing that exists. **Blocker:** the extension needs superuser or a managed-platform allowlist entry — that is a DBA question on Neon, answered before the migration is written.
- **Tests:** a DB-gated test asserting the second overlapping active agreement raises `23P01` · **Pre/mig:** extension creation is a separate, earlier migration from the constraint · **Rollback:** drop the constraint; leave the extension · **Codex:** none.

**IT-MIG-08** — Build the preflight script, counts only
`scripts/preflight.mjs` · **Change** new · **Pkg** Q04 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** every line the script prints is a table name plus an integer or a boolean. A test asserts the output contains no value from any user-data column — no emails, no kennitölur, no tokens, no hashes. The current probe scripts under `apps/api/scripts/` (`probe-migration-state.ts`, `probe-integrity.ts` and ~30 others) print rows; none of them is a preflight and none is safe to paste into a ticket.
- **Tests:** `scripts/preflight.test.mjs` running the formatter over a fixture result set and asserting the redaction property · **Pre/mig:** the script is read-only SQL; it must refuse to run if `DATABASE_URL` names anything other than an explicitly passed branch · **Rollback:** n/a · **Codex:** none.

**IT-MIG-09** — Write a per-phase rollback plan
`docs/domain/onboarding/contracts/rollback.md` · **Change** new · **Pkg** Q05 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** each of expand, migrate and contract has a named reverse step, and the doc states which are irreversible. Two are already known irreversible and must be called out by name: the `per_connector` enum value (IT-MIG-02 — PostgreSQL cannot drop an enum value) and the contract phase itself.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-MIG-10** — Reconcile the two migration ledgers
`scripts/check-migration-parity.mjs` `docs/domain/onboarding/contracts/schema-change-order.md` · **Change** new · **Pkg** Q01,Q12 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** the script exits 1 when a `.sql` file in `apps/api/drizzle/` has no corresponding `prisma/migrations/` directory and no entry in a committed exemption list. It exits 1 today on `0001_regular_talos.sql` (the `per_connector` ALTER), which is exactly the divergence IT-MIG-02 fixes. Runs offline — it reads `apps/api/drizzle/meta/_journal.json` and `ls prisma/migrations`, no database.
- **Tests:** `scripts/check-migration-parity.test.mjs` · **Pre/mig:** none · **Rollback:** remove from `check-all.mjs` · **Codex:** none.

**IT-MIG-11** — Close the drizzle-kit schemaFilter blind spot
`apps/api/drizzle.config.ts` · **Change** edit · **Pkg** Q01 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** the `schemaFilter` list at `:36-39` either matches the Postgres schema list on the Prisma datasource exactly, or carries a per-omission comment. It lists 18 schemas; the Prisma datasource header (`prisma/schema/schema.prisma`) documents 20, with `hosts` explicitly declared-but-empty. The config's own comment warns that "a table it cannot see is a table it will happily propose creating on top of the one already there" — the omission needs to be a stated exemption, not an oversight.
- **Tests:** `scripts/check-migration-parity.test.mjs` can assert the two lists agree · **Pre/mig:** none — config only, no DDL · **Rollback:** revert the list · **Codex:** none.

**IT-MIG-12** — Assert zero legacy backfill
`scripts/check-no-backfill.mjs` · **Change** new · **Pkg** Q11,K14 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** the script exits 1 if any file under `prisma/migrations/` added after a stated date contains `INSERT INTO` against a table named in the expand set (IT-MIG-04). Accepted direction 8 is zero legacy backfill — new tables start empty — and nothing enforces it today.
- **Tests:** `scripts/check-no-backfill.test.mjs` · **Pre/mig:** none · **Rollback:** remove from `check-all.mjs` · **Codex:** none.

**IT-MIG-13** — Rehearse the expand phase on a disposable branch
`docs/domain/onboarding/contracts/rehearsal.md` · **Change** decision · **Pkg** P10,Q04 · **Scen** — · **When** blocked · **Approval** DBA
- **Accept:** the rehearsal runs on a branch created for the purpose and deleted after, and its record names the branch id, the preflight counts before and after, and the elapsed time per statement. **Blocker:** external — it needs a database, and the Neon default branch is not the one to use. The doc must state the target branch explicitly rather than relying on whatever `DATABASE_URL` happens to hold.
- **Tests:** none · **Pre/mig:** rehearsal only; nothing lands on staging from it · **Rollback:** delete the branch · **Codex:** none.

**IT-MIG-14** — Restore NOT NULL on tenancy.organizations.roles
`packages/shared/src/db/identity.ts` `prisma/schema/identity.prisma` · **Change** schema · **Pkg** Q01,P10 · **Scen** — · **When** blocked · **Approval** DBA
- **Accept:** the column is `NOT NULL DEFAULT ARRAY[]::"OrganizationRole"[]` in the database, and the Drizzle declaration at `identity.ts:284` and the Prisma model at `identity.prisma:457` agree with it. Today Prisma types it as a non-null list while the column permits NULL — the constraint was lost when the 2026-05-01 `org_profile_iceland_reshape` migration re-added `roles` as `roles_new` without it. The declaration's own comment says restoring it "needs an operator decision". **Blocker:** that decision.
- **Tests:** `apps/api/test/parity/schema-columns.test.ts` gains a nullability assertion — note it compares names only today · **Pre/mig:** a `SET NOT NULL` needs a full-table scan and a prior `UPDATE … WHERE roles IS NULL` · **Rollback:** `DROP NOT NULL` · **Codex:** none.

**IT-MIG-15** — Specify the pending-access-request partial unique
`docs/domain/onboarding/contracts/expand-phase.md` · **Change** schema · **Pkg** Q01,B04 · **Scen** 31-46 · **When** do-now · **Approval** none
- **Accept:** the spec adds a partial unique on `(installation_id, user_id) WHERE status = 'pending'` to the existing `AccessRequest` model, and states that this replaces the application-level dedupe, which races. Unlike the rest of the expand set this one targets a table that **does** exist — `apps/api/src/repositories/driver-access-requests.ts` (`createSelfRequest` :164) is live today.
- **Tests:** a DB-gated concurrent-insert test asserting one row and one `23505` · **Pre/mig:** needs a duplicate sweep first — the preflight (IT-MIG-08) must report the count of `(installation_id, user_id)` pairs with more than one pending row · **Rollback:** `DROP INDEX` · **Codex:** none.

**IT-MIG-16** — Specify the ActorKind enum extension
`packages/shared/src/db/platform.ts` `prisma/schema/platform.prisma` · **Change** schema · **Pkg** N02,A04 · **Scen** 5-6,155 · **When** do-now · **Approval** DBA
- **Accept:** `actorKindEnum` carries a `bearer` value in both declarations and in the database. It carries `user | system | vendor_webhook | ocpp_worker` today (`platform.ts:29`, `platform.prisma:119-126`), and a scan of `actorKind: "…"` literals across the repo returns 24 hits, **all** of them `"user"` — so three of the four existing values are already dead, and scenario 6 cannot pass.
- **Tests:** `apps/api/src/lib/audit.test.ts` (does not exist — see IT-OBS-13) · **Pre/mig:** `ALTER TYPE … ADD VALUE`, same transaction caveat as IT-MIG-02 · **Rollback:** forward-only; enum values cannot be dropped · **Codex:** none.

---

## OBS — Observability and support runbooks (14)

Greenfield with one usable precedent. Every "alert" in the system today is a
`console.log`/`console.error` line inside a Worker, wrapped in
`ctx.waitUntil((async () => { try … catch { console.error } })())` — there is no
sink, no metrics store, no dashboard, and a partial cron failure is invisible.
The one real detector, `apps/api/src/lib/ocpp-silence-watch.ts`, is the pattern
to copy: a pure exported predicate (`isFleetWide` :72-76) that can be tested
without a database, a threshold with its reasoning written next to it, and a
single call site in `apps/api/src/index.ts`. Group R's repeated acceptance word
"Fires" describes a mechanism that does not exist — IT-OBS-02 is the one that
makes the rest of the word mean something.

**IT-OBS-01** — Credential-overwrite detector
`apps/api/src/lib/credential-overwrite-watch.ts` `apps/api/src/index.ts` · **Change** new · **Pkg** R01,A05 · **Scen** 1-18 · **When** do-now · **Approval** none
- **Accept:** a pure exported predicate decides "a credential row was written for a user who already had one" from counts alone, and is unit-testable with no database — same shape as `isFleetWide`. The cron branch emits `[cred-overwrite]` with counts only, never an email, a hash or a user id. Ships without waiting for A02, per 18A A05.
- **Tests:** `apps/api/src/lib/credential-overwrite-watch.test.ts` — the predicate at the boundary, both sides · **Pre/mig:** none — reads `identity.user_credentials` timestamps · **Rollback:** remove the `ctx.waitUntil` block · **Codex:** none.

**IT-OBS-02** — Give alerts somewhere to fire
`apps/api/src/lib/alert-sink.ts` `apps/api/wrangler.jsonc` · **Change** new · **Pkg** R01,R02,R03,Q07 · **Scen** — · **When** do-now · **Approval** Andri
- **Accept:** one exported `emitAlert(env, {severity, code, counts})` that every detector calls, and a test asserting its payload contains no free-text field. Today `[ocpp-silence] FLEET-WIDE` at `apps/api/src/index.ts` roughly `:449` and its warn sibling at `:458` go to `console` only — a three-month fleet outage would still only be caught by someone tailing logs. **Approval Andri:** choosing the destination is an external-service decision.
- **Tests:** `apps/api/src/lib/alert-sink.test.ts` · **Pre/mig:** none · **Rollback:** make `emitAlert` a console shim again — every caller keeps compiling · **Codex:** none.

**IT-OBS-03** — Support-context expiry monitoring (blocked)
`apps/api/src/lib/support-context-watch.ts` · **Change** new · **Pkg** R03,C05,C13 · **Scen** 47-62 · **When** blocked · **Approval** none
- **Accept:** a detector reports the count of contexts past `expires_at` that were used in the last interval, and the count of break-glass contexts opened. **Blocker:** `support_contexts` does not exist in any schema file — C01 is greenfield (IT-MIG-04). Write the predicate and its unit test now against a plain input shape; the query is the only part that has to wait.
- **Tests:** `apps/api/src/lib/support-context-watch.test.ts` on the pure predicate · **Pre/mig:** depends on IT-MIG-04 · **Rollback:** remove the cron branch · **Codex:** none.

**IT-OBS-04** — Attribution-invariant violation alarm (blocked)
`apps/api/src/lib/attribution-invariant-watch.ts` · **Change** new · **Pkg** R02,E04,E05 · **Scen** 75-98 · **When** blocked · **Approval** none
- **Accept:** the detector counts rows where `attribution IN ('installation','unknown') AND subject_user_id IS NOT NULL` and alerts on any non-zero. **Blocker:** `session_attribution` does not exist, and neither does `IdToken.tokenClass` — so "an `installation_technical` token resolving to a `userId`", one of doc 11's named stop conditions, is not currently detectable at all. Note the alarm is belt-and-braces: IT-MIG-06 makes the state unrepresentable, and this catches a constraint that was dropped.
- **Tests:** `apps/api/src/lib/attribution-invariant-watch.test.ts` · **Pre/mig:** depends on IT-MIG-06 · **Rollback:** remove the cron branch · **Codex:** none.

**IT-OBS-05** — Staff action without support context alarm (blocked)
`apps/api/src/lib/staff-action-watch.ts` · **Change** new · **Pkg** R03,C10,C11 · **Scen** 47-62 · **When** blocked · **Approval** none
- **Accept:** counts audit rows whose actor holds a platform role and whose `support_context_id` is null. **Two blockers:** the columns `support_context_id` and `on_behalf_of_org_id` do not exist on `audit.actions` (`packages/shared/src/db/platform.ts:91-108`), and — the more dangerous one — `requirePermission` returns early for bootstrap sessions at `require-permission.ts:55-59` (and `assertPermission` at `:115-117`), so a session with `sub==="admin"` and no `userId` never reaches any guard placed inside. An alarm on staff actions cannot see actions that bypass the resolver.
- **Tests:** `apps/api/src/lib/staff-action-watch.test.ts` · **Pre/mig:** depends on C10/C11 columns · **Rollback:** remove the cron branch · **Codex:** none.

**IT-OBS-06** — Runbook: invite redemption failure
`docs/runbooks/invite-failure.md` · **Change** new · **Pkg** R06,A01-A04 · **Scen** 1-30 · **When** do-now · **Approval** none
- **Accept:** the runbook names each error code the route can emit and what the operator does for each. It must state the current mapping honestly: `apps/api/src/routes/public/invites.ts` maps `not_found` to 404 and **everything else to 410**, so `already_used` and `malformed_metadata` are indistinguishable to a caller by status, and `already_claimed` does not exist yet. It must also record that the mobile client sends a `kennitala` field that the non-strict `ConsumeBody` (`:36-39`) silently strips.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** gives support a script for the single most common driver-facing failure.

**IT-OBS-07** — Runbook: attribution dispute
`docs/runbooks/attribution-dispute.md` · **Change** new · **Pkg** R07,M01-M04 · **Scen** 91-98 · **When** do-now · **Approval** none
- **Accept:** the runbook states what evidence exists today and what does not. Today: `events.protocol_log` and the archive objects exist; `authorization_decision` and `session_attribution` do not, so there is no record of *why* a session was attributed to anyone. The runbook must say "the answer is not recoverable" for pre-E06 sessions rather than describing a lookup that cannot be performed.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-OBS-08** — Runbook: driver blocked at a charger
`docs/runbooks/blocked-charger-access.md` · **Change** new · **Pkg** R10,F03 · **Scen** 75-90,113-120 · **When** do-now · **Approval** none
- **Accept:** the runbook distinguishes the four causes an operator can actually tell apart with today's data — OCPP silence (`checkOcppSilence`), a stuck outbound command, a missing driver-group membership, and an `enforceAuthorize` rejection — and names the query for each. It must state that the outbound command may be stuck **forever**: `apps/api/src/lib/dispatcher.ts` marks a row `failed` only for "no target" or a permanent result, a retriable result leaves it `pending`, and a grep of `apps/api/src` for `maxAttempts`/`max_attempts`/`attempts >` returns nothing.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-OBS-09** — Runbook: wrong membership or wrong org
`docs/runbooks/wrong-membership.md` · **Change** new · **Pkg** R09,B07,D02 · **Scen** 129-136 · **When** do-now · **Approval** none
- **Accept:** the runbook records the blast radius of `platform.tenant.write` before describing any fix. `expandPlatformTenantVerbs` (`apps/api/src/lib/auth/effective-permissions.ts:103-139`) expands that one verb into `member.remove`, `charger.remote_start`, `charger.remote_stop`, `charger.config`, `billing.write`, `tariff.write`, `contract.write` and `org.write` in **every** org, and `sales_cs` holds it (`permissions.ts:268`). The "column-restricted in repo layer (org notes/tags only)" comment on that line describes a restriction that is not implemented anywhere.
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-OBS-10** — Runbook: cost-factor or pricing error (blocked)
`docs/runbooks/cost-factor-error.md` · **Change** new · **Pkg** R08,K01-K05,L01-L05 · **Scen** 137-148 · **When** blocked · **Approval** none
- **Accept:** the runbook names the corrective action for a mispriced session. **Blocker:** there is none available through the product. No agreement write surface exists anywhere in `apps/api/src` — `apps/api/src/repositories/agreements.ts:1-7` declares itself read-only and the only writer is a one-off script under `apps/api/scripts/`. Group K is create, not harden. Until K01-K04 land the runbook's only honest content is "escalate; the fix is a script run by an engineer".
- **Tests:** none · **Pre/mig:** none · **Rollback:** n/a · **Codex:** none.

**IT-OBS-11** — Bound the outbound-command retry loop
`apps/api/src/lib/dispatcher.ts` `apps/api/src/index.ts` `apps/api/wrangler.jsonc` · **Change** edit · **Pkg** R04,H05 · **Scen** 118 · **When** do-now · **Approval** Andri
- **Accept:** a command row reaches a terminal `failed` state after a stated attempt count, and the alert carries the count of rows that did. Today `claimById` pushes `not_before` 30s forward while `sweepStuckPending` re-publishes anything older than 60s on a `* * * * *` cron, so a permanently unreachable charger produces a row re-dispatched forever with a growing `attempts` counter. Three dead-letter queues are declared in `apps/api/wrangler.jsonc` (`:87`, `:109`, `:116`) and `apps/api/src/index.ts:324-352` has **no consumer branch for any of them**.
- **Tests:** `apps/api/src/lib/dispatcher.test.ts` (does not exist today) · **Pre/mig:** none — no schema change if the cap is a constant · **Rollback:** raise the cap to Infinity; behaviour returns to today's · **Codex:** the UI can finally show "this command failed" instead of a spinner that never resolves.

**IT-OBS-12** — Reconcile the partition-drop gate with the archive fan-out
`apps/api/src/lib/db/partition-cron.ts` `apps/api/src/queues/ocpp-events.ts` · **Change** edit · **Pkg** N06,N07 · **Scen** — · **When** do-now · **Approval** Andri
- **Accept:** `decidePartitionDrop` either excludes heartbeat rows from its row count or the archive fan-out stops excluding them, and a test asserts a fully-archived partition becomes droppable. Today `fanOutToArchive` (`ocpp-events.ts:154-157`) filters heartbeats out of the archive queue per ADR 0040 D4, while `readPartitionGroups` (`partition-cron.ts:445`) counts every row and `decidePartitionDrop` (`:389-391`) blocks on `archived < g.rows` — so `protocol_log` will emit `watermark_shortfall` permanently and no partition will ever be dropped. This is two ADRs that do not compose, not a threshold to tune; hence Andri.
- **Tests:** `apps/api/src/lib/db/partition-cron.test.ts` gains a heartbeat-dominated fixture · **Pre/mig:** none · **Rollback:** revert the predicate · **Codex:** none.

**IT-OBS-13** — Test the audit writer, then make failed sends auditable
`apps/api/src/lib/audit.test.ts` `apps/api/src/lib/email.ts` · **Change** test · **Pkg** N01,N05,R06 · **Scen** 155 · **When** do-now · **Approval** none
- **Accept:** `audit.test.ts` exists and asserts (a) `recordAuditAction` takes the Drizzle branch when the handle exposes `insert` and the Prisma branch otherwise (`isDrizzle` :54), and (b) `actorKind` is never read from request input. There is no `audit.test.ts`, `dispatcher.test.ts` or `dispatch-targets.test.ts` in the repo — the only coverage of an audit write is incidental, through a Prisma fake in `driver-access-requests.test.ts`. Scenario 155 ("exactly one audit event per state change") has no harness at all today.
- **Tests:** this task is the test · **Pre/mig:** none · **Rollback:** delete the file · **Codex:** none.
- *Second half:* `sendEmail` (`apps/api/src/lib/email.ts:41`) fails open with a warn and has seven call sites, of which only `driver-access-requests.ts` also writes an audit row — driver registration, email verification, password reset and host-application submission produce no audit row at all, so a Resend outage is invisible outside the Worker tail.

**IT-OBS-14** — Stop swallowing cron failures
`apps/api/src/index.ts` · **Change** edit · **Pkg** R04,Q07 · **Scen** — · **When** do-now · **Approval** none
- **Accept:** each `scheduled()` branch increments a per-branch failure counter that `emitAlert` (IT-OBS-02) reports, and a test asserts a throwing branch produces exactly one alert. Today every branch is `ctx.waitUntil((async () => { try … catch { console.error } })())` — including the silence watch's own `catch` — so a detector that has been throwing for a month looks identical to a fleet that is healthy.
- **Tests:** `apps/api/src/index.test.ts` (new) exercising `scheduled()` with one throwing branch · **Pre/mig:** none · **Rollback:** restore the bare catch · **Codex:** none.
