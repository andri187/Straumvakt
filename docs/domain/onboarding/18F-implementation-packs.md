# Appendix 18F — implementation packs, audit taxonomy, executive packet

Completion-rule items 7–12.

---

## 1. Support-context middleware pack (item 7)

**Source inventory.** `lib/auth/require-permission.ts` (the seam, `:25-74`) ·
`lib/auth/permissions.ts` (`platform.support.action` defined, zero call sites) ·
`lib/auth/effective-permissions.ts` (composes membership + platform grants) ·
`lib/audit.ts` (`recordAuditAction`) · **43** route call sites gated by
`platform.tenant.*` — none of which need editing.

**Intended files.** *New:* `lib/auth/support-context.ts`,
`routes/admin/support-contexts.ts`, Drizzle `support_context` table, audit
columns `support_context_id` + `on_behalf_of_org_id`. *Changed:*
`require-permission.ts`, `lib/audit.ts`.

**Pseudocode.**

```ts
// support-context.ts
export async function openContextFor(db, userId, orgId, now) { … }   // returns null if none

export function satisfiedOnlyByPlatformGrant(resolved, verb) {
  // resolveEffectivePermissions must expose PROVENANCE, not just a Set.
  // membership-derived  -> no context needed
  // platform-derived    -> context required
  return resolved.provenanceOf(verb) === "platform";
}
```

```ts
// require-permission.ts, after the existing perms check
if (orgId && satisfiedOnlyByPlatformGrant(perms, verb)) {
  const ctx = await openContextFor(db, userId, orgId, new Date());
  if (!ctx) return json({ error: "support_context_required" }, 403);
  c.set("supportContextId", ctx.id);
}
```

**The one real prerequisite.** `resolveEffectivePermissions` currently returns a
permission **set**. The guard needs **provenance** — which grant satisfied the
verb. That is the only non-trivial refactor in this pack, and it must land
first or the guard cannot distinguish a member from an operator.

**Tests.** T-SC-1..9, with T-SC-5 (member path unaffected) as the gate on
merging.

**Rollout.** Flag-gated, per environment: log-only → enforce in staging →
enforce in production. **Rollback:** flag off restores today's behaviour exactly;
no data migration to undo.

**Review checklist.** ☐ provenance exposed, not inferred from role names ☐
guard runs after the permission check, not before ☐ member path proven by
T-SC-5 ☐ expiry absolute and server-side ☐ context id reaches every audit row ☐
`403 support_context_required` distinct from `forbidden` ☐ no route file edited.

---

## 2. Attribution / token-class pack (item 8)

**Source inventory.** `routes/internal/ocpp-authorize.ts` (`:17-24` contract,
shadow mode) · `repositories/agreements.ts:44,201,257` and
`repositories/chargers.ts:230-232` (`enforceAuthorize`, moving to
`ChargingStation` per ADR 0047) · `IdToken` model · `local-auth-list/push`.

**Intended files.** *New:* `session_attribution`, `authorization_decision`
tables; `IdToken.tokenClass` column. *Changed:* `ocpp-authorize.ts` (additive
response fields), id-token repository, gateway contract doc.

**Pseudocode.**

```ts
const cls = idToken.tokenClass;                  // driver | physical_card | installation_technical
const attribution =
  cls === "installation_technical" ? "installation"
  : cls === "driver"               ? "driver"
  : cardBinding ? "driver" : "installation";
const subjectUserId = attribution === "driver" ? resolveSubject() : null;

// INVARIANT, enforced here AND by a CHECK constraint:
assert(!(attribution !== "driver") || subjectUserId === null);

return { verdict, reason, enforceAuthorize, idTokenId,
         tokenClass: cls, attribution, userId: subjectUserId };
```

**Migration concept.** Expand (add column + tables, nullable) → migrate
(classify existing tokens — **blocked on Q-04**, may need operator input) →
contract (make `tokenClass` non-null). No legacy backfill of sessions.

**Rollback.** Additive fields; an old gateway ignoring them behaves exactly as
today. The CHECK constraint is the only piece needing a considered drop.

**Tests.** T-ATTR-1..7, T-ATTR-17.

**Review checklist.** ☐ technical token can never produce a `userId` ☐ CHECK
exists ☐ `unknown` reachable and terminal ☐ upgrade-only enforced ☐ correction
event preserves the original ☐ meter evidence retained for `unknown` ☐ no
EVCCID/EMAID assumption anywhere.

---

## 3. Agreement / cost-factor write-surface pack (item 9)

**Source inventory.** `repositories/agreements.ts` — **no** create/update/
upsert/delete · `routes/admin/agreements*.ts` — GET plus `debug-resolve` and
`sessions/:id/resolve` · `repositories/billing-cost-factors.ts` ·
`tariff.write` / `contract.write` defined-never-enforced.

**Intended files.** *Changed:* `repositories/agreements.ts` (add writes),
`routes/admin/agreements.ts` (add commands). *New:* clause write repository,
exclusion constraint migration.

**Command model.** `createDraft → updateDraft* → activate → retire`. Clauses are
draft-only. Nothing deletes.

**The two invariants that carry the design.**
1. **Active agreements are immutable in pricing.** Retire and supersede — this
   is what keeps historical sessions re-resolvable.
2. **Overlap is prevented by an exclusion constraint**, not application code.
   Check-then-insert races, and the failure mode is non-deterministic pricing,
   which is discovered months later in a dispute.

**Preview reuses `debug-resolve`.** Do not write a second resolver. A second
pricing implementation is how four generations happened.

**Rollout.** Ship read + draft first (harmless), then activate behind
`contract.write`, then clause assignment. **Rollback:** drafts are inert; drop
the routes.

**Review checklist.** ☐ no write path mutates an active agreement's pricing ☐
exclusion constraint present ☐ activation is org-admin-only ☐ preview shares the
resolver ☐ no per-driver scope ☐ every transition audited with actor and reason.

---

## 4. Organisation onboarding aggregate pack

**Intended files.** *New:* `onboarding_workflow`, `onboarding_step`,
`onboarding_substep`, event table (**D-10 open**); `routes/admin/onboarding.ts`;
`repositories/onboarding.ts`.

**Key invariants.** Partial unique index → one open workflow per organisation is
*unrepresentable*, not merely discouraged · only `active` confers driver access ·
`If-Match` on the aggregate version · `Idempotency-Key` per step submit ·
required steps cannot be `skipped`.

**Tests.** Scenarios 99–112. **Rollback:** tables unused by any other feature;
drop.

---

## 5. Migration / preflight / rollback pack (item 10)

**Preflight, before any migration runs.** ☐ `npm run check` green (includes the
`migrations-visible` Tier-0 guard already shipped in the RC) ☐ target branch
confirmed **not** production ☐ expected migration count matches disk ☐ backup or
disposable branch confirmed ☐ rollback statement written **before** applying ☐
Andri's approval recorded.

**Order.** Expand (additive, nullable) → migrate (dual-write; backfill only
derivable facts) → contract (gated on G1–G5).

**Per-pack rollback.**

| Change | Rollback | Irreversible? |
|---|---|---|
| `support_context` table | drop | no |
| audit columns | drop | loses context linkage only |
| `IdToken.tokenClass` | drop | no |
| `session_attribution` | drop | loses attribution history |
| CHECK constraint | drop | no |
| exclusion constraint | drop | no |
| onboarding tables | drop | no |
| contract phase | **none** | **yes — last, and gated** |

**Two pending staging migrations remain unreconciled** (`drop_issues_scaffold`,
`drop_never_used_tables`) — both applied by hand, neither recorded. ⚑ external.

---

## 6. Audit taxonomy (item 11)

**Event names** — `domain.action`, past tense, stable:

`invite.created` · `invite.consume_refused` **(new)** ·
`membership.invite_accepted` · `driver_invite.claimed` ·
`driver_invite.redeemed` · `driver_invite.redemption_rejected` ·
`join.granted` · `join.pending` · `join.rejected` ·
`access_request.created|approved|rejected|withdrawn` ·
`support_context.opened|closed|expired|extended` ·
`agreement.created|updated|activated|retired` ·
`clause.added|removed` ·
`attribution.assigned|upgraded|corrected` ·
`session.resolved|re_resolved` ·
`charger.created|updated|deleted` ·
`ocpp_password.rotated|disabled` ·
`membership.granted|revoked`

**Fields on every event.**

| Field | Meaning |
|---|---|
| `actorUserId` | the authenticated principal — **never from request input** |
| `actorKind` | `user` \| `staff` \| `bearer` \| `system` |
| `onBehalfOfOrgId` | tenant affected |
| `supportContextId` | set iff inside a context |
| `subjectUserId` | who it was *about* — distinct from actor |
| `targetType`/`targetId` | the record |
| `reason` | required for destructive/sensitive |
| `occurredAt` | immutable |

**Three fields never conflated:** *audit actor* (who acted), *billing subject*
(who pays), *authorization credential* (what opened the plug).

**Redaction.** Never log: password hashes, salts, token hashes, passphrases,
DSNs, OCPP passwords, kennitala. Codes may be logged; passphrases never.

**Metrics.** `invite.consume.refused_existing_credential` (→ alert R01) ·
`authorize.technical_token_with_user` (→ R02, should be **zero**) ·
`support.action_without_context` (→ R03, should be **zero** post-C02) ·
`join.outcome{method,state}` · `legacy.consume.calls{client_version}` ·
`attribution.unknown_ratio`.

**Alerts.** R01 any occurrence · R02 any occurrence · R03 any occurrence ·
attribution-unknown ratio rising week-on-week.

**Incident evidence retention.** Audit rows and `authorization_decision` are
append-only and retained beyond ordinary identity retention; a dispute may be
raised long after a session. ⚑ legal input required for exact periods.

---

## 7. Executive packet (item 12)

**Where the backend is.** Three of six market workflows are testable today.
Charger onboarding is genuinely strong. Two workflows — charger visibility and
cost factors — have **no backend at all**, and one is reachable only through an
open Critical.

**Three gates before a paying customer**, in order:

1. **S2** — an unconsumed invite is currently a standing password-reset
   capability against the invited account. One line, no client change,
   invariant to the data.
2. **Support context** — every Straumvakt action inside a tenant is presently
   unaudited and unconditional. Cheaper than feared: one seam, not 43 routes.
3. **Truthful attribution** — a shared technical token can attribute every
   session at an installation to one person, and nothing distinguishes a true
   attribution from a false one.

Each produces a wrong answer that is **believed**: a stolen account, an
unattributable staff action, a charge billed to the wrong person.

**Top 10 risks.** password overwrite (Critical) · unaudited staff access ·
false attribution · no cost-factor write surface · `claim-invite` never adopted
· old-app tail during migration · rate limiter fails open · `platform.impersonate`
in a bundle · four unverified hardware assumptions · two unreconciled staging
migrations.

**Top 10 unblockers.** D-01 (**invariant — ship S2 regardless**) · Q-02 counts ·
provenance in `resolveEffectivePermissions` · `IdToken.tokenClass` · exclusion
constraint · delete `platform.impersonate` · D-04 supported-version definition ·
Q-04 token classification · bench H1–H4 · D-10 event-log decision.

**What Codex can show today.** Org and charger admin, membership management,
driver login/list/charge — all real. Everything else is read-only, disabled,
hidden or fixture-backed per [18E](18E-codex-contract-v3.md).

---

## 8. Second-pass contradiction audit (item 13, Phase 10)

Re-read of docs 14–18.

| # | Issue | Resolution |
|---|---|---|
| 1 | Doc 05 §3 proposed **`platform.support.enter`**; doc 16 withdrew it for **`platform.support.action`** | **Doc 16 wins.** Doc 05 is superseded; corrected here rather than edited, to preserve the record. |
| 2 | Doc 02 used 13 step keys; doc 10 adopted 7 + substeps | **Doc 10 wins.** |
| 3 | Doc 02 `AwaitingValidation` / `done` / `pending`; doc 10 `ready` / `complete` / `not_started` | **Doc 10 wins.** |
| 4 | Doc 01 implied mobile was the only consume client | **Corrected in doc 08** — an archived web form exists with a different payload. |
| 5 | Doc 15 §4 and doc 17 §4 both give Codex tiers | **18E v3 supersedes both.** |
| 6 | "Support context" vs "support mode" used interchangeably | **Terminology:** *support context* = server object; *support mode* = UI state. Both are correct in their place. |
| 7 | Doc 14 called charger onboarding "ready"; doc 18A adds 8 hardening packages | Not a contradiction — ready ≠ finished. Clarified. |
| 8 | Doc 11 numbered `11-persistence-and-rollout` but linked as `11-rollout-programme` | Fixed in `54c7155`. |
| 9 | D-10 (event log table vs `audit.actions`) still open, but G05 assumes a table | **Unresolved.** Flagged in G05. |
| 10 | "Unsafe" used for both the Critical and for unproven flows | **Ambiguous.** 18E splits them: *Unsafe* = Critical; *Fixture* = unproven. |

**Nothing was silently edited.** Superseded recommendations are recorded as
superseded so the reasoning trail survives.
