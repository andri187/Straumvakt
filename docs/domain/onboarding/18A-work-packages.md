# Appendix 18A — backend work packages

**171 non-duplicate packages** across 18 groups. Continues
[17-ultra-backend-market-runway](17-ultra-backend-market-runway.md) from
`4dea004`.

## How to read this

Each group states its **defaults** once — approval, external-mutation flag,
rollback shape, observability and Codex impact are near-identical within a
group, and repeating them 160 times would bury the per-package content that
actually differs.

Each package then carries: **ID · title · evidence · scope · non-goals · likely
files · deps · acceptance · tests**, with any *deviation* from the group default
called out inline as `⚑`.

**Global defaults, all groups unless overridden:**
`approval` = Andri · `external mutation` = **none** (docs/code only; no
cloud/DB/hardware) · `rollback` = revert the commit; no data migration to undo ·
`observability` = existing audit + structured logs unless stated.

Priority: **P0** blocks a paying customer · **P1** blocks beta · **P2** blocks
demo polish · **P3** later.

---

## Group A — S2 invite/password hardening (14)

*Defaults: files `apps/api/src/routes/public/invites.ts` + its tests; Codex
impact = invite redemption may move from "unsafe" to "interactive"; rollback =
one conditional.*

| ID | P | Title | Evidence | Scope / non-goals | Acceptance | Tests |
|---|---|---|---|---|---|---|
| A01 | P0 | Guard credential existence **before** token claim | `invites.ts:130` claim precedes `:142` write | Add `findUnique` on `userCredential` above the claim. **Non-goal:** identity binding | Bearer + existing credential → `409`, `usedAt` still null | T-S2-1, T-S2-5 |
| A02 | P0 | Replace `upsert` with `create` | `:142-147` update branch overwrites | Swap to `create`. **Non-goal:** schema change | Unique constraint raises if guard removed | T-S2-2 |
| A03 | P0 | Add `already_claimed` → 409 mapping | `:180` maps only 404/410 | Extend status map | 409 returned, not 410 | T-S2-1 |
| A04 | P0 | Audit refused consume with `actorKind:"bearer"` | `:165` names invitee as actor | New audit branch | Refusal audited, actor ≠ invitee | T-S2-3, T-AUD-1 |
| A05 | P0 | Detection alert: credential written for user who had one | no detection today | Metric + alert. **Ships without D-01** | Alert fires in staging test | T-OBS-1 |
| A06 | P1 | Mobile copy for `already_claimed` | app has no branch | Codex-facing copy contract ⚑ *Codex implements* | Copy approved | UI snapshot |
| A07 | P1 | Web copy for `already_claimed` | archived form has no branch | As A06 ⚑ *Codex* | Copy approved | UI snapshot |
| A08 | P1 | Anti-deadlock regression test | ADR 0053 repeat risk | `T-S2-5` as a permanent test | Refusal leaves invite usable | T-S2-5 |
| A09 | P1 | Concurrency test for conditional claim | `:130-132` CAS | Two concurrent consumes | Exactly one winner | T-S2-4 |
| A10 | P1 | Make `ConsumeBody` strict | `:36-39` non-strict | Reject unknown fields **or** verify | Unknown field → 400 | T-SEC-3a |
| A11 | P1 | Decide kennitala: verify or drop | `client.dart:97-107` vs server | Product decision + impl ⚑ *needs D-02* | One behaviour, documented | T-SEC-3a/b |
| A12 | P1 | Rename mobile contract test | test asserts "serializes identity" falsely | Rename + assert real shape ⚑ *Codex* | Test name matches reality | T-SEC-3b |
| A13 | P2 | `malformed_metadata` 500 → 400 | `:69` returns 500 for client-side fault | Status change | 400 returned | T-S2-6 |
| A14 | P2 | Document consume's three jobs in-file | header understates | Comment update | Reviewer sees the three jobs | — |

## Group B — invite/join/membership migration (14)

*Defaults: files `routes/public/driver.ts`, `routes/public/invites.ts`, new
`routes/public/join.ts`; Codex impact = new join surface; rollback = route
returns 404, clients fall back.*

| ID | P | Title | Evidence | Scope | Acceptance | Tests |
|---|---|---|---|---|---|---|
| B01 | P1 | `POST /api/driver/join` skeleton, auth required | doc 10 §3.4 | Route + handler, method dispatch | Unauthenticated → 401 | T-SEC-1a |
| B02 | P1 | `join` method `invite` | `redeem-invite` exists | Delegate to existing logic | Bound user → 200 | T-SEC-1c |
| B03 | P1 | `join` method `accessCode` | doc 03 §3 | Code+passphrase verify | Correct pair → granted | T-JOIN-1 |
| B04 | P1 | `join` method `request` | `AccessRequest` exists | Create pending request | Returns `pending` | T-JOIN-2 |
| B05 | P1 | Single generic rejection `not_available` | doc 09 §6 | One error for all failure causes | Identical body+status | T-ABUSE-6b |
| B06 | P1 | Idempotency-Key on join | doc 10 §2 | Header + store | Replay → same result | T-RACE-3 |
| B07 | P1 | Already-a-member returns existing grant | doc 10 §3.4 | No duplicate row | 200 + existing grantId | T-RACE-4 |
| B08 | P1 | Capability advertisement endpoint | doc 11 D stage 2 | Server lists supported methods | New client detects | T-COMPAT-2 |
| B09 | P1 | Client version header | stage 2 | Parse + log | Version in telemetry | T-OBS-2 |
| B10 | P1 | Deprecation counter on legacy entries | doc 04 §4 | Metric per route+version | Counts visible | T-OBS-3 |
| B11 | P2 | Adoption-gate dashboard query | stage 5 | Query spec, not a dashboard | Gate computable | — |
| B12 | P2 | Identity-bind `consume` (rows 4–5) | doc 15 §1.2 | Require session, compare bound user ⚑ *gated on adoption* | Wrong identity → 404 | T-SEC-1b |
| B13 | P3 | Retire `invites/consume` | G1–G5 | Remove route ⚑ *needs G1–G5 + Andri* | Route gone | T-COMPAT-3 |
| B14 | P2 | Placeholder user `status:"invited"` | `host-invites.ts:175-183` | Status until first auth ⚑ *check status semantics* | Placeholder distinguishable | T-DRV-1 |

## Group C — support-context enforcement (15)

*Defaults: files `apps/api/src/lib/auth/require-permission.ts`, new
`lib/auth/support-context.ts`, new table; Codex impact = support banner becomes
real; rollback = feature flag off → current behaviour.*

| ID | P | Title | Evidence | Scope | Acceptance | Tests |
|---|---|---|---|---|---|---|
| C01 | P0 | `SupportContext` table + model | doc 17 §2.3 | New table only ⚑ *migration* | Table exists | T-SC-0 |
| C02 | P0 | Guard inside `requirePermission` | `require-permission.ts:25-74` seam | Platform-derived access requires context | 43 routes gated by one change | T-SC-1 |
| C03 | P0 | Tenant-member path unaffected | doc 17 §2.2 | Membership-derived access needs no context | Dual-role user unblocked | **T-SC-5** |
| C04 | P0 | `403 support_context_required` code | new | Distinct from `forbidden` | UI can offer entry | T-SC-1 |
| C05 | P0 | Absolute expiry enforced server-side | doc 05 §3 | Per-request check | Expired → 403 | T-SC-3 |
| C06 | P0 | Context binds one org | doc 05 §5 | Reject cross-org use | Org B → 403 | T-SC-4 |
| C07 | P1 | `POST /support-contexts` enter | doc 10 §3.9 | Requires `platform.support.action` + reason | Context opened+audited | T-SC-2 |
| C08 | P1 | `GET /support-contexts/current` | doc 10 §3.9 | Read own context | Returns or 404 | T-SC-2 |
| C09 | P1 | `POST /:id/exit` | doc 10 §3.9 | Explicit close | Closed+audited | T-SC-2 |
| C10 | P1 | `support_context_id` on audit rows | doc 17 §2.4 | Column + writer | Every staff action carries it | T-AUD-2 |
| C11 | P1 | `onBehalfOfOrgId` on audit rows | doc 09 §8 | Column + writer | Populated in context | T-AUD-2 |
| C12 | P1 | Wire `platform.support.action` | defined-never-enforced | First call site | Verb enforced | T-SC-1 |
| C13 | P1 | Break-glass flag + shorter TTL | doc 05 §6 | Same table, labelled | Flag set, TTL shorter | T-SC-7 |
| C14 | P1 | Notify org on context open | doc 17 §2.4 | Outbox row ⚑ *needs G-outbox* | Notification enqueued | T-SC-8 |
| C15 | P2 | Extend-context command | operational need | Re-reason + new expiry | Extension audited | T-SC-9 |

## Group D — permission model cleanup (10)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| D01 | P1 | Delete `platform.impersonate` | zero call sites; contradicts direction 2 | Verb absent; bundle test updated |
| D02 | P1 | Enforce `member.remove` | defined-never-enforced | Removal route gated |
| D03 | P1 | Enforce `audit.read` | no projection yet | Gate lands with G-audit |
| D04 | P2 | Enforce `billing.export` or delete | unused | One or the other |
| D05 | P2 | Resolve `tariff.write`/`contract.write` | no write routes | Enforced when Group K lands |
| D06 | P2 | Decide `platform.finance.*` fate | unused | Kept or deleted |
| D07 | P2 | Decide `platform.grant.*` fate | unused | Kept or deleted |
| D08 | P2 | Decide `platform.feature_flag.*` fate | unused | Kept or deleted |
| D09 | P2 | Decide `platform.migration.run` fate | unused | Kept or deleted |
| D10 | P1 | Test: no tenant verb composes into platform | doc 05 §7 | Assertion exists |

## Group E — token class and attribution (17)

*Defaults: files `routes/internal/ocpp-authorize.ts`, `repositories/id-tokens*`,
Drizzle schema; Codex impact = session UI may show attribution honestly;
rollback = additive fields ignored.*

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| E01 | P0 | `IdToken.tokenClass` column | doc 11 A6 | Column exists, defaulted |
| E02 | P0 | Classify existing tokens | `UNKNOWN` Q-04 | Classification decided ⚑ *may need operator input* |
| E03 | P0 | `attribution` in authorize response | `ocpp-authorize.ts:17-19` | Field present, additive |
| E04 | P0 | Technical token ⇒ `userId: null` | doc 09 §9 | Invariant enforced in resolver |
| E05 | P0 | CHECK: installation/unknown ⇒ null subject | doc 11 A6 | Constraint rejects violation |
| E06 | P1 | `session_attribution` table | doc 11 A6 | Table exists |
| E07 | P1 | `basis` recorded per attribution | doc 12 B3 | Basis stored |
| E08 | P1 | Upgrade-only rule | doc 12 B4 | Downgrade requires correction event |
| E09 | P1 | Correction event type | doc 12 B4 | Event recorded, original preserved |
| E10 | P1 | `authorization_decision` log table | doc 11 A6 | Decisions recorded |
| E11 | P1 | Tap-intent correlation window | doc 06 §5 | Window defined + tested |
| E12 | P1 | Autocharge/EVCCID binding model | doc 12 B1 | Vehicle-to-person binding explicit |
| E13 | P1 | Physical card binding model | doc 12 B1 | Card-to-person binding revocable |
| E14 | P1 | Unknown attribution is billable to installation | doc 12 B4 | No fabricated subject |
| E15 | P2 | Local-auth-list implications | `local-auth-list/push` exists | Class respected in list push |
| E16 | P2 | Gateway contract note for verdict fields | additive | Old gateway unaffected |
| E17 | P1 | Test: concurrent sessions on one technical token | doc 09 §9 | Neither names a user |

## Group F — OCPP authorization / session attribution (10)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| F01 | P1 | Shadow-mode evidence report | `ocpp-authorize.ts:23-24` | Per-installation verdict counts |
| F02 | P0 | Staged `enforceAuthorize` runbook | doc 06 §6 | One installation first ⚑ *ops, external* |
| F03 | P1 | Reject-path UX contract | availability risk | Driver sees a reason |
| F04 | P2 | `enforceAuthorize` move to ChargingStation | `chargers.ts:230` ADR 0047 | Field relocated |
| F05 | P1 | H1 bench: free-vend idTag requirement | doc 12 B5 | Answer recorded ⚑ *hardware* |
| F06 | P1 | H2 bench: concurrent technical token | doc 12 B5 | Answer recorded ⚑ *hardware* |
| F07 | P1 | H3 bench: RemoteStart idTag echo | doc 12 B5 | Answer recorded ⚑ *hardware* |
| F08 | P2 | H4 bench: 1.6 vs 2.0.1 idTagInfo | doc 12 B5 | Answer recorded ⚑ *hardware* |
| F09 | P1 | Never infer EVCCID/EMAID in meter data | doc 12 B5 | Assertion + doc |
| F10 | P2 | Signed meter retention independent of attribution | doc 12 B4 | Evidence kept when unknown |

## Group G — organisation onboarding aggregate (12)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| G01 | P1 | `onboarding_workflow` table | doc 11 A1 | Table + partial unique index |
| G02 | P1 | Partial unique: one open workflow per org | doc 11 A1 | Second open rejected |
| G03 | P1 | `onboarding_step` (7 keys) | doc 10 §1 | Steps persisted |
| G04 | P1 | `onboarding_substep` (13 keys) | doc 10 §1 | Substeps persisted |
| G05 | P1 | Event log table | doc 11 A1 ⚑ *D-10 open* | Decision recorded |
| G06 | P1 | `GET …/onboarding` summary | doc 10 §3.1 | Matches Codex shape |
| G07 | P1 | `POST …/onboarding` start/resume | doc 10 §3.2 | Idempotent |
| G08 | P1 | `PATCH …/steps/:key` | doc 10 §3.3 | If-Match enforced |
| G09 | P1 | Invariant: only `active` confers access | doc 02 §3 | Invite pre-activation cannot redeem |
| G10 | P1 | Skip-with-reason | doc 02 §2 | Reason required |
| G11 | P2 | Cancel/reopen with version bump | doc 02 §3 | Reopen audited |
| G12 | P2 | Suspend/reinstate | doc 10 §1 | Suspension does not revoke memberships |

## Group H — charger onboarding hardening (8)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| H01 | P2 | Charger availability status model | doc 15 §2.4 | `operational/maintenance/retired` |
| H02 | P2 | Availability respected in driver list | `driver.ts:238-260` | Maintenance hidden from list |
| H03 | P1 | OCPP password rotation audit | routes exist | Rotation audited with actor |
| H04 | P1 | OCPP password never in response body | secret hygiene | Assert redaction |
| H05 | P2 | Vendor attach idempotency | `attach-vendor` | Replay safe |
| H06 | P2 | Technical-read failure surfacing | `technical-read` | Error legible |
| H07 | P2 | Charger delete → soft delete | `DELETE /:id` | History preserved |
| H08 | P2 | Station/EVSE/connector identity doc | doc 12 B1 | Identity model written |

## Group I — driver onboarding (10)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| I01 | P1 | Driver registration path proven | `public/register` no caller | End-to-end test |
| I02 | P1 | Kennitala uniqueness semantics | `register.ts:19` | `kennitala_taken` behaviour documented |
| I03 | P1 | Driver profile read/update | `PATCH /me` exists | Fields documented |
| I04 | P1 | Unaffiliated `join-state` endpoint | doc 10 §3.11 | No org data leaked |
| I05 | P1 | Disclosure table enforced | doc 03 §2 | Pending invite reveals name only |
| I06 | P2 | Guest → registered upgrade path | direction 4 | Local data migrates or is dropped explicitly |
| I07 | P1 | Multiple active sessions supported | direction 6 | Chooser contract |
| I08 | P2 | Driver-visible session history scope | `sessions/history` | Own sessions only |
| I09 | P1 | Driver cannot read org inventory | doc 03 §2 | Assertion |
| I10 | P2 | Account deletion/soft-delete | doc 05 §7 | Behaviour defined ⚑ *legal* |

## Group J — installation access credentials (8)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| J01 | P1 | `installation_access_credential` table | doc 11 A2 | Table + unique `code` |
| J02 | P1 | Passphrase hashing (PBKDF2, per-cred salt) | doc 03 §3 | Never plaintext |
| J03 | P1 | Create endpoint returns passphrase **once** | doc 10 §3.8 | Not retrievable after |
| J04 | P1 | Rotate = new row + grace on old | doc 03 §3 | Both valid in window |
| J05 | P1 | Revoke immediate; grants survive | doc 03 §3 | Memberships unaffected |
| J06 | P1 | Fail-closed rate limit on join | `rate-limit.ts:23-25,116` | Missing binding → refuse |
| J07 | P1 | Code check digit, client-side reject | doc 10 §3.5 | Bad QR never hits server |
| J08 | P2 | Emergency revoke-all for an installation | doc 03 §3 | One call, one event per credential |

## Group K — agreement write surface (14)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| K01 | P0 | Agreement create (draft) | repo read-only | Draft persists |
| K02 | P0 | Agreement update (draft only) | — | Active rejects edit |
| K03 | P0 | Agreement activate | doc 15 §3.1 | Transition audited + snapshot |
| K04 | P0 | Agreement retire | — | `effectiveUntil` set, no delete |
| K05 | P0 | Overlap prevention (exclusion constraint) | doc 15 §3.2 | Overlapping active rejected |
| K06 | P1 | Effective dating required | doc 15 §3.2 | Open-ended rejected |
| K07 | P1 | Activation permission = org admin only | doc 15 §3.5 | Staff cannot activate |
| K08 | P1 | Pricing preview reuses `debug-resolve` | doc 15 §3.3 | No second pricing impl |
| K09 | P1 | Repository write functions | `agreements.ts` read-only | CRUD exists, tenant-scoped |
| K10 | P1 | Audit events for all four transitions | — | Events emitted |
| K11 | P1 | `contract.write`/`tariff.write` enforced | D05 | Verbs live |
| K12 | P2 | Draft clause add/remove | doc 15 §3.1 | Draft-only |
| K13 | P2 | Supersede chain visible | doc 15 §3.2 | Prior agreement linked |
| K14 | P2 | Migration: no legacy backfill | direction 8 | New tables start empty |

## Group L — cost-factor assignment (12)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| L01 | P0 | Clause scope enum (org/group/installation/charger) | doc 15 §3.1 | No per-driver scope |
| L02 | P0 | Assign cost factor to scope | no write surface | Assignment persists |
| L03 | P1 | Retire assignment | — | Historical resolution intact |
| L04 | P1 | Conflict handling within a scope | — | Deterministic winner |
| L05 | P1 | Preview shows resolved breakdown | doc 15 §3.3 | Matches resolver |
| L06 | P1 | Cost-factor catalogue read | `billing-cost-factors.ts` | Catalogue exposed |
| L07 | P1 | Permission checks on assignment | doc 16 | Org admin/staff-draft |
| L08 | P1 | Audit on assignment | — | Actor + scope recorded |
| L09 | P2 | Bulk assignment | — | Idempotent |
| L10 | P2 | Assignment effective dating | doc 15 §3.2 | Dates enforced |
| L11 | P1 | Test: overlap rejected | required test | Rejection asserted |
| L12 | P2 | Driver-visible cost explanation | direction 6 | Honest breakdown |

## Group M — billing / dispute correction (8)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| M01 | P1 | Dispute state machine | doc 17 §3.11 | States implemented |
| M02 | P1 | Correction never overwrites a CDR | ADR 0049 | Correction record emitted |
| M03 | P1 | Re-resolve named sessions | route exists | Re-resolution audited |
| M04 | P1 | Attribution correction feeds billing subject | doc 12 B4 | Subject updated via event |
| M05 | P2 | Dispute evidence bundle | — | Bundle assembled |
| M06 | P2 | Operator dispute queue | — | Queue readable |
| M07 | P1 | Billing subject ≠ audit actor ≠ auth credential | doc 12 §1 | Three fields distinct |
| M08 | P2 | Replay policy documented | doc 15 §3.4 | Policy written |

## Group N — audit taxonomy and integrity (8)

| ID | P | Title | Evidence | Acceptance |
|---|---|---|---|---|
| N01 | P0 | Actor never from request input | doc 09 §8 | Assertion |
| N02 | P0 | `actorKind` incl. `bearer` | doc 09 §8 | Bearer actions distinguishable |
| N03 | P1 | Audit projection endpoint | doc 10 §3.10 | Org-visible |
| N04 | P1 | Org-visible staff actions | doc 05 §3 r6 | Org sees staff activity |
| N05 | P1 | Event name taxonomy | Phase 8 | Names fixed |
| N06 | P1 | Immutable evidence fields | — | Append-only |
| N07 | P2 | Retention policy | doc 05 §7 ⚑ *legal* | Policy set |
| N08 | P1 | Redaction rules (no hashes/DSNs) | hard stop | Assert absent from logs |

## Group O — Codex UI enablement (10)

*⚑ All packages: Codex implements; backend supplies contract only.*

| ID | P | Title | Acceptance |
|---|---|---|---|
| O01 | P1 | Disabled-state copy library | Copy matches doc 17 §4 |
| O02 | P1 | Demo-mode kill switch, default off | Build fails if set against beta/prod |
| O03 | P1 | Fixture namespace `demo-*`/`*@example.test` | Enforced by lint |
| O04 | P1 | No-backend-workaround test rule | Absent endpoint → assert disabled state |
| O05 | P1 | Support-mode banner contract | Matches doc 17 §2.5 |
| O06 | P1 | Onboarding progress = "not tracked yet" | No derived progress |
| O07 | P1 | Visibility = "managed through driver groups" | No toggle |
| O08 | P1 | Cost factors hidden until Group K/L | Not rendered |
| O09 | P1 | Invite redemption gated to disposable tenants | Guard present |
| O10 | P2 | Attribution display rules | Never names a person on `installation`/`unknown` |

## Group P — tests and CI (12)

| ID | P | Title | Acceptance |
|---|---|---|---|
| P01 | P0 | S2 suite (T-S2-1..6) | In CI, offline |
| P02 | P0 | Support-context suite (T-SC-1..9) | In CI |
| P03 | P0 | Attribution suite (T-ATTR-1..7) | In CI |
| P04 | P1 | Permission-matrix test from source | Drift fails CI |
| P05 | P1 | Enforced-verb inventory test | New unenforced verb fails CI |
| P06 | P1 | Client parity suite | Old/new matrix |
| P07 | P1 | Agreement overlap tests | Rejection asserted |
| P08 | P1 | Audit integrity tests | Actor immutability |
| P09 | P1 | Rate-limit fail-closed test | Join refuses |
| P10 | P2 | Migration rehearsal ⚑ *DB* | Disposable branch only |
| P11 | P1 | Parity harness stays offline-loadable | Existing smoke test |
| P12 | P2 | Contract fixtures shared web/mobile | One source of truth |

## Group Q — migration / rollout / compatibility (12)

| ID | P | Title | Acceptance |
|---|---|---|---|
| Q01 | P1 | Expand phase migration set | Additive only |
| Q02 | P1 | Migrate phase dual-write | Both paths work |
| Q03 | P2 | Contract phase ⚑ *gated G1–G5* | Nothing dropped early |
| Q04 | P1 | Preflight checklist | Checklist executed pre-migration |
| Q05 | P1 | Rollback plan per phase | Each reverses independently |
| Q06 | P1 | Adoption gate definition ⚑ *D-04* | "Supported version" defined |
| Q07 | P1 | Stop conditions monitored | Alerts wired |
| Q08 | P2 | Old-app tail model | Users-blocked metric |
| Q09 | P1 | `migrations.path` guard in CI | Already shipped in RC |
| Q10 | P2 | Reconcile two pending staging migrations ⚑ *external* | Recorded |
| Q11 | P2 | Zero-legacy-backfill assertion | No import job exists |
| Q12 | P2 | Compatibility matrix maintained | Updated per release |

## Group R — observability and support runbooks (10)

| ID | P | Title | Acceptance |
|---|---|---|---|
| R01 | P0 | Alert: credential overwrite attempt | Fires (A05) |
| R02 | P1 | Alert: technical token resolving to user | Fires |
| R03 | P1 | Alert: staff action without support context | Fires |
| R04 | P1 | Metric: join outcomes by method | Dashboard-ready |
| R05 | P1 | Metric: legacy consume calls by version | Gate input |
| R06 | P1 | Runbook: invite failure | Written |
| R07 | P1 | Runbook: attribution dispute | Written |
| R08 | P1 | Runbook: cost-factor error | Written |
| R09 | P1 | Runbook: wrong membership | Written |
| R10 | P1 | Runbook: blocked charger access | Written |

---

## Counts

A 14 · B 14 · C 15 · D 10 · E 17 · F 10 · G 12 · H 8 · I 10 · J 8 · K 14 ·
L 12 · M 8 · N 8 · O 10 · P 12 · Q 12 · R 10 = **171**

Every required group minimum is met or exceeded.

## Critical path through the backlog

**A01–A04** (S2) → **C01–C06** (support context, one seam) → **E01–E05**
(attribution invariant) → **K01–K05 + L01–L02** (write surface) → **G01–G09**
(aggregate).

Packages flagged ⚑ *hardware*, *external*, *legal* or *DB* cannot be completed
in this track and are named so they are not mistaken for engineering work that
is merely undone.
