# ADR 0028 — Driver invite mechanism (code / QR / email)

**Status:** Accepted (2026-06-04) — core model is canon; the open
questions resolve during P2 implementation, reversible by supersession.
**Date:** 2026-06-04
**Sprint:** Going-public critical path P2.0 (gates P2 onboarding —
[GOING_PUBLIC_CRITICAL_PATH.md](../architecture/GOING_PUBLIC_CRITICAL_PATH.md))
**Implements:** [ADR 0026 §3](./0026-host-managed-driver-enrollment-and-billing-model.md)
(invite-only driver enrollment), the follow-up ADR 0026 named.
**Related:**
[ADR 0026](./0026-host-managed-driver-enrollment-and-billing-model.md),
[ADR 0027](./0027-host-onboarding-operator-create-and-host-admin-invite.md)
(host-admin who issues these),
[ADR 0029](./0029-child-object-billing-attribution.md) (billing home set at
redemption),
[ADR 0019](./0019-agreement-and-bearer-architecture.md) +
[ADR 0020](./0020-driver-access-via-driver-groups.md) (DriverGroup access).

## Context

ADR 0026 §3 mandates **invite-only** driver enrollment — no public
self-signup. A host-admin (ADR 0027) emits one of three invite forms:
**code**, **QR**, or **email**. ENROLL-4
(`POST /api/admin/orgs/:orgId/driver-group-memberships`) is the eventual
write target once an invite is consumed. QR codes carry two **optional**
security layers (password key; host-admin allow-term via the ENROLL-2
access-request inbox). The redemption surface is the mobile app (ADR 0026
§5; built in P3).

Critically, redemption is where a driver acquires **both spines**:
- **access** — a DriverGroupMembership (what they may charge at), and
- **billing** — a BillObjectMember (which unit/owner pays; ADR 0029).

## Decision

### 1. One invite token, `kind='driver'`

Reuse `identity.user_tokens` with `kind='driver'` (consistent with the
existing `kind='invite'` host/staff path). The token row carries:

- `code` — the short shareable string (also what the QR encodes).
- `org_id` + `driver_group_id` — the access grant the invite confers.
- `bill_object_id` *(nullable — see §5)* — the billing home to attach.
- `security` — `none | password_key | allow_term` (§3).
- `password_key_hash` — when `security='password_key'`.
- `expires_at`, `consumed_at`, `single_use` (default true).

One token → one driver enrollment. Bulk issuance mints many tokens.

### 2. Three delivery forms, one token

- **Code** — the `code` string, shared verbally / SMS / printed.
- **QR** — a server-rendered PNG (`GET /api/.../invites/:id/qr.png`)
  encoding a deep link that carries the `code`. Server-render keeps the
  encoding canonical and lets us add the security layer prompts.
- **Email** — Resend send containing both the code and the deep link.

All three resolve to the **same** `code` → same redemption path. The form
is a distribution choice, not a different flow.

### 3. Optional QR security layers (ADR 0026 §3)

Chosen by the host-admin at QR generation:

- **`password_key`** — a secondary string the host distributes separately.
  The scanner must enter it after scanning; checked against
  `password_key_hash`. Defeats the "stolen photo of the wall QR" attack.
- **`allow_term`** — after scan, the redemption attempt lands in the
  **ENROLL-2 access-request inbox** for explicit host-admin approval before
  the membership activates. For publicly-posted QR codes.

A bare QR (`security='none'`) is valid for low-risk, physically-gated
locations (locked stairwell).

### 4. Redemption (consume) flow

On the mobile app (P3), the driver pastes code / scans QR / taps the email
link, then:

1. Token validated (`kind='driver'`, not expired, not consumed,
   single-use intact).
2. Security gate, if any (`password_key` entry, or `allow_term` → park in
   ENROLL-2 inbox, await host approval, then continue).
3. Identity captured (ADR 0026 §4) — **email + password + kennitala**
   (kennitala at redemption, not at invite). Find-or-create the User by
   kennitala (unique, ADR 0026 §10A).
4. **Access** — write the DriverGroupMembership (ENROLL-4 target) for
   `driver_group_id`.
5. **Billing** — write the BillObjectMember for `bill_object_id` (ADR 0029),
   if set (§5).
6. Mark token `consumed_at`; audit-log the enrollment.

Single transaction; partial enrollment must not leave a driver with access
but no billing home (or vice-versa) unless §5 deferral is chosen.

### 5. Billing-home assignment — at invite or deferred

A driver invite **should** name the `bill_object_id` so redemption sets
both spines atomically. But a host-admin may not know the unit yet.
**Decision:** `bill_object_id` is **nullable** on the token; if null at
redemption, the driver lands in the host's **"Unattributed" bill-object**
(ADR 0029 §3 fallback) and the host-admin is flagged to assign a real unit.
Access is never blocked on billing-home assignment.

## Consequences

### Enabled
- One token model spans all three delivery forms — simpler than per-form
  schemas.
- Redemption wires access **and** billing in one step (or defers billing
  safely), so a public-launch driver is fully set up from a single scan.
- The two QR security layers reuse existing infrastructure (password hash;
  ENROLL-2 inbox) rather than new mechanisms.

### Costs / risks
- **Two writes at redemption** (DriverGroupMembership + BillObjectMember) —
  transactional integrity matters; the §5 nullable-billing path is the
  safety valve.
- **QR posted publicly** is a discovery surface — mitigated by
  `password_key` / `allow_term`; a bare public QR is the host-admin's
  explicit risk choice.
- **Kennitala-at-redemption** for foreigners without one is out of scope
  (ADR 0026 §10A) — those drivers can't redeem until the proxy-identity ADR.

### Schema implications (additive)
- `identity.user_tokens` += `kind='driver'` + columns `driver_group_id`,
  `bill_object_id` (nullable, FK ADR 0029), `security`, `password_key_hash`,
  `single_use`. Additive only.
- No new redemption table — reuses ENROLL-2 (`access_requests`) for the
  `allow_term` path and ENROLL-4 for the write.

## Open questions (resolve during P2)
1. **Code entropy / length / expiry default** — e.g. 8–10 char base32,
   24h for email, 7d for printed QR? Per-form expiry?
2. **QR rendering** — server PNG endpoint (leaning) vs client-side library;
   deep-link scheme (Universal Links / App Links) for Android + iOS.
3. **Single-use vs multi-use codes** — printed station QR may want
   multi-use (many residents, one poster) → then it's a *join request*, not
   a one-shot. Leaning: a `max_redemptions` int (1 = single-use, N or null =
   shared poster) rather than a boolean.
4. **`allow_term` UX** — how the driver learns they're pending approval; how
   the host-admin approves (existing ENROLL-2 inbox surface).

## Rejected alternatives
- **Separate token tables per form** — code/QR/email are the same token
  delivered differently; one row, three renderings.
- **Public self-signup** — rejected by ADR 0026; every driver enters via a
  host-issued credential.
- **Capture kennitala at invite time** — the host invites by email and may
  not hold the driver's kennitala; capture at redemption (ADR 0026 §4).
- **Set billing home as mandatory at invite** — too rigid; §5 nullable +
  Unattributed fallback keeps onboarding unblocked.
