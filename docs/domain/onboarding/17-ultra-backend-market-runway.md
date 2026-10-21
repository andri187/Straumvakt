# Ultra runway: decisions, support-context enforcement, state machines

Continues [15-product-to-market-backend-runway](15-product-to-market-backend-runway.md)
and [16-permission-matrix](16-permission-matrix.md).

Verified at start — **all five tips matched**: mine `1e9bfb8`, RC `4b69d0f`,
Codex web `d228f53` (16 dirty), Codex mobile `75beb3c` (9 dirty), Claude B
`563b554`. Codex has active uncommitted work in both UI trees; read-only for me,
untouched.

---

## 1. D-01 / Q-02 decision pack — answerable without Andri at the keyboard

The Critical (S2) is blocked on one product question. This makes it decidable.

### 1.1 What `consume` means today

`SOURCE-FACT` `invites.ts:99-176` does five things in one transaction: resolve
token → claim token → **write credential** → flip `Membership` to `active` →
set `emailVerifiedAt` → audit.

Three jobs fused: **account activation**, **password creation**, **membership
acceptance**.

### 1.2 Should it ever reset a password?

**No.** A password reset requires proof that the requester is the account
holder. A bearer token is proof of *possession of a link*, not of identity. The
two are only equivalent if the link never leaves the intended recipient — and
invite links travel by email, chat and screenshot **by design**.

There is also a working alternative: a real reset flow gated on inbox control,
which is a different and stronger proof.

### 1.3 Blast radius of each answer

| Answer | Who breaks | Severity of breaking them | Reversibility |
|---|---|---|---|
| **No** (recommended) | anyone re-consuming an invite to set a new password | they use password reset instead, or an admin re-invites | one line, instant |
| **Yes** (keep) | nobody | — | the Critical stays open indefinitely |

Asymmetric. "No" has a bounded, recoverable cost; "Yes" has an unbounded,
silent one.

### 1.4 What Q-02 must return

Two counts against **staging** (read-only):

1. `userToken` rows where `kind='invite'`, `usedAt IS NULL`,
   `expiresAt > now()` — **outstanding invites**.
2. Of those, how many have a bound `userId` that **already has a
   `userCredential` row** — **the exploitable set**.

Optionally: any `userCredential` whose `updatedAt` is later than its user's
`createdAt` **and** coincides with an invite consume — evidence the reset
behaviour has actually been used.

### 1.5 How to run Q-02 safely

Read-only `SELECT` with `COUNT` only, against the **staging** branch, returning
**numbers, not rows** — no emails, no token hashes, no user ids. It must not run
against production, and it must not `SELECT *`.

**Not run here.** This track forbids live database access; it belongs to Claude
B or to Andri.

### 1.6 What numbers change the decision

| Exploitable set | Reading | Action |
|---|---|---|
| **0** | no live exposure | ship S2 immediately; pure hardening, zero user impact |
| **1–20** | small, nameable | ship S2, notify those accounts, re-invite if needed |
| **> 20** | reset behaviour may be load-bearing | ship S2 **and** a real reset flow together |

Note that **every band ships S2.** The count changes the *accompaniment*, never
the decision. That is what makes this decidable without Andri: the recommended
action is invariant.

### 1.7 Recommendation and confidence

**Ship S2. Confidence: high.**

The only scenario where "no" is wrong is if consume is a deliberate, documented
password-reset mechanism — and `SOURCE-FACT` the in-code comment calls a
pre-existing credential "unusual for an invite flow, but **defensive**", which
is the opposite of deliberate.

### 1.8 Fallback if the decision is delayed

Ship the **detection** half now, which needs no decision: alert when a consume
writes a credential for a user that already had one. It is strictly additive,
cannot break a client, and converts a silent Critical into a monitored one while
the product answer is pending.

---

## 2. Support-context enforcement — the largest authorization gap

### 2.1 The gap, measured

`SOURCE-FACT` **43 route call sites** are gated by `platform.tenant.read`,
`platform.tenant.write` or `platform.tenant.delete` — across chargers, circuits,
contracts, groups, host-applications, installations, org-email-domains,
org-invites, orgs and more.

Every one is a **tenant-scoped action performed by platform staff** with:
no support context, no target-organisation declaration, no reason, no expiry,
and no `onBehalfOfOrgId` in the audit row.

### 2.2 The seam already exists — this is the important finding

`SOURCE-FACT` `require-permission.ts:25-74`: `requirePermission` already accepts
an `orgIdParam` option, resolves `const orgId = c.req.param(...)`, and calls
`resolveEffectivePermissions(db, userId, orgId)`.

**The middleware already knows both the actor and the target organisation.**

So support-context enforcement does **not** require touching 43 call sites. It
is one change inside one function:

```
requirePermission(verb, { orgIdParam })
  → resolve (userId, orgId)                      [exists today]
  → resolve effective permissions                 [exists today]
  → NEW: if the verb is satisfied ONLY by a platform grant (not by a
         tenant membership), require an open, unexpired SupportContext
         for (userId, orgId); otherwise 403 support_context_required
  → NEW: stash context id on c for the audit writer
```

The distinction that makes this safe: a Straumvakt person who is *also* a member
of that organisation is acting as a member and needs no context. Only the
**platform-grant-derived** path demands one. That is computable from the data
`resolveEffectivePermissions` already returns.

### 2.3 The object

```
SupportContext
  id, staffUserId, targetOrgId, reason (required)
  grantedPermissions[]        -- subset; never OWNER-equivalent
  openedAt, expiresAt         -- absolute, not sliding
  closedAt?, closedReason?
  breakGlass                  -- labelled, not a separate mechanism
```

Storage is **new** — one table plus a `support_context_id` column on audit rows.
No change to existing tables.

### 2.4 Audit events

`support_context.opened` (actor, target org, reason, expiry, breakGlass) ·
`support_context.closed` (actor, reason) · `support_context.expired` (system) ·
and every existing tenant action gains `onBehalfOfOrgId` + `supportContextId`.

**The organisation must be able to see all of these** — that is the promise in
doc 05 §3 rule 6, and it is what makes non-impersonation meaningful rather than
merely stated.

### 2.5 UI banner contract for Codex

Persistent, non-dismissible while a context is open:

> **Support mode — acting on _{Organisation}_**
> Signed in as _{staff email}_. Every action is recorded and visible to the
> organisation. Reason: _{reason}_. Ends at _{time}_.  **[Exit support mode]**

Rules: never hide the banner behind a menu; exit is always one click; when
`expiresAt` passes, the UI must stop offering mutations rather than letting the
server reject them one by one.

### 2.6 `platform.impersonate` — how to neutralise

`SOURCE-FACT` `platform_admin` holds it; **zero** route call sites.

**Recommendation: delete the verb.** It is unenforced, so removal breaks
nothing, and its presence in a bundle invites a future implementer to wire it
up — which would contradict accepted direction 2 in a single commit that looks
like a feature.

`SOURCE-FACT` `permissions.ts:239-240` notes the catalogue is exhaustive and its
test "will fail until super_user's bundle is updated" — so removal is a guided
change, not a blind one. If it must stay for contractual reasons, redefine it in
the same commit as the support-context verb and document that it grants
*context entry*, not identity substitution.

### 2.7 Tests

`T-SC-1` platform-grant-only actor without context → `403 support_context_required` ·
`T-SC-2` same actor with an open context → allowed, audit carries context id ·
`T-SC-3` context expired → refused server-side even if the UI still offers it ·
`T-SC-4` context for org A does not authorise org B ·
`T-SC-5` a Straumvakt person who is also a member acts **without** a context ·
`T-SC-6` `platform.impersonate` grants nothing anywhere.

`T-SC-5` is the one that prevents an over-strict fix from locking out legitimate
dual-role users.

---

## 3. State machines

Twelve of the thirteen requested. Each marked **CURRENT** (implemented) or
**PROPOSED**. Not all thirteen are written: #13 audit/event preservation is a
retention policy rather than a state machine, and is covered in doc 11 A7 —
inventing states for it would be fantasy.

### 3.1 Invite consume/claim — **CURRENT**

States: `issued → claimed? → consumed | expired | superseded`

| Transition | Actor | Permission | Command | Idempotency | Compensation | Audit |
|---|---|---|---|---|---|---|
| mint | org admin/staff | `member.invite` ✅ | `POST …/invites` | — | revoke | `invite.created` |
| claim credential | bearer | none | `POST /claim-invite` | token+user | none | `driver_invite.claimed` |
| consume | bearer | none ⚠️ | `POST /invites/consume` | conditional claim on `usedAt` | **none — the bug** | `membership.invite_accepted` |
| redeem | **bound driver** | session | `POST /redeem-invite` | conditional claim | none needed | `driver_invite.redeemed` |
| reject | — | — | — | — | leaves token unconsumed ✅ | `driver_invite.redemption_rejected` |
| expire | system | — | — | — | — | none today ⚠️ |

**UI states:** driver sees pending / accepted / expired / *"already claimed"*
(new, from S2). **Tests:** T-S2-1..5.

### 3.2 Support context — **PROPOSED** (§2)

`none → open → closed | expired`. Opening requires
`platform.support.action` + reason; closing is explicit; expiry is system and
absolute. Compensation: none — a closed context does not undo its actions, it
bounds them.

### 3.3 Organisation onboarding — **PROPOSED**

`draft → in_progress → blocked ↔ in_progress → ready → active → suspended ↔ active`,
plus `cancelled` from any pre-active state and `cancelled → in_progress`
(reopen, new version). Full detail in doc 02 §3; vocabulary per doc 10 §1.

**Only `active` may confer driver access** — the invariant that stops
half-onboarded organisations granting charging.

### 3.4 Driver membership / access — **CURRENT (partial)**

`none → pending → granted | rejected | withdrawn → revoked`

`SOURCE-FACT` `pending`/`granted`/`rejected` exist via `AccessRequest` +
`PATCH /api/admin/access-requests/:id`, but **no caller on any branch**, so the
flow is unproven end to end. `withdrawn` and `revoked` are `PROPOSED`.

### 3.5 Installation access credential — **PROPOSED**

`active → rotated (grace) → expired`, and `active → revoked` at any time.
**Revocation does not revoke grants already made** — otherwise rotating a
sticker ejects every driver who ever used it.

### 3.6 Charger onboarding — **CURRENT**

`created → vendor_attached → ocpp_provisioned → operational`.
`SOURCE-FACT` all four transitions have routes today (`POST /api/admin/chargers`,
`attach-vendor`, `ocpp-password` + `rotate`/`disable`, remote commands). This is
the one machine that is fully implemented.

### 3.7 Driver onboarding — **CURRENT, unsafe**

`invited → placeholder_created → credential_set → member`.
`SOURCE-FACT` `host-invites.ts:175-183` creates the placeholder as
`status:"active"` with no credential — doc 04 §5 proposes `status:"invited"`
until first authentication.

### 3.8 Visibility-by-membership — **CURRENT, no machine**

There are no visibility states. A charger is visible iff a membership path
exists **and** the installation agreement is active and in window. Two
transitions, both indirect: membership add/remove, agreement activate/expire.
This is the state machine — and the argument for doc 15 §2's rejection.

### 3.9 Cost-factor assignment — **PROPOSED**

`draft → active → retired`. Draft is editable; active is immutable; retirement
sets `effectiveUntil`. No deletes, ever — historical sessions must remain
re-resolvable.

### 3.10 Charging session attribution — **PROPOSED**

`unknown → installation → driver`, upgrade-only, each with a recorded basis.
Downgrade or re-assignment requires an explicit correction event. `unknown` is
terminal-legitimate.

### 3.11 Billing / dispute correction — **PROPOSED**

`resolved → disputed → corrected | upheld`. A correction never overwrites a CDR;
it emits a correction record. `SOURCE-FACT`
`POST /api/admin/agreements/sessions/:sessionId/resolve` already exists and is
the natural re-resolution command.

### 3.12 Authenticated join / access request — **PROPOSED**

`submitted → pending → approved | rejected | withdrawn | superseded`.
Policy is evaluated **at decision time**, not submission — so a mid-flight
policy change yields `pending`, not an error.

---

## 4. Codex enablement contract v2

Supersedes doc 15 §4 where they differ.

| Tier | Meaning | Surfaces |
|---|---|---|
| **Interactive now** | real backend, enforced permissions | org/property/site/installation CRUD; charger onboarding + OCPP credentials; remote start/stop; membership add/remove; driver login, charger list, start/stop |
| **Interactive with disposable fixture only** | works, but exercises a Critical or unproven flow | invite redemption; access-request approve/reject |
| **Read-only** | endpoint exists, no write surface | agreements, tariffs, tariff-chain, billing sessions |
| **Disabled** | control exists in design, not in backend | onboarding progress; support-mode banner (until §2) |
| **Hidden** | no backend and none planned | cost-factor editing (until Phase 5 lands); audit projection |
| **Unsafe** | must not ship to real users | invite redemption for real accounts, until S2 |

### Exact copy

- Not built: **"Not available yet."**
- No backing data: **"This isn't tracked yet."**
- No such control: **"Managed through driver groups."**
- Pending a fix: **"Temporarily unavailable."**
- Fixture-backed: **"Demo data — not connected to a live system."**

### Fixture rules

Namespace every fixture `demo-*` / `*@example.test`; gate on
`NEXT_PUBLIC_DEMO_MODE`, **default off**, and fail the build if it is set in a
configuration pointing at beta or production. **No-backend-workaround rule:** a
UI test may not stub an endpoint that does not exist in order to claim a feature
works — if the endpoint is absent, the test asserts the *disabled state*.

---

## 5. Market MVP — ruthless

| | Must before demo | Must before beta | Must before first real customer | Later | **Rejected** |
|---|---|---|---|---|---|
| **Straumvakt admin** | org + charger CRUD | **support context** (§2) | onboarding aggregate; agreement write | break-glass review | — |
| **CPO admin** | driver list, groups | membership admin | cost-factor assignment; access-request proven | pricing preview | **visibility toggle** |
| **Driver app** | login, chargers, start/stop | **S2**; honest pending/rejected | **attribution truthful** | multi-session chooser | per-driver pricing |
| **Backend** | — | **S2**; detection alert | **T2/A10**; agreement writes | dispute correction | `platform.impersonate` |
| **Release/ops** | — | staging evidence | rollback runbook | — | — |
| **OCPP/charger safety** | — | shadow-mode evidence | `enforceAuthorize` staged per installation | 2.0.1 parity | global enforce flip |

**Three hard gates before a paying customer**, in order: **S2**, **support
context**, **truthful attribution**. Everything else can ship late or ugly. Those
three cannot ship late, because each produces a wrong answer that is *believed*:
a stolen account, an unattributable staff action, and a charge billed to the
wrong person.
