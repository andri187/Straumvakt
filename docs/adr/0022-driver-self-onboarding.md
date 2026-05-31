# ADR 0022 — Driver self-onboarding

**Status:** Proposed — primary decisions locked 2026-05-31. See addendum at bottom.
**Created:** 2026-05-10
**Last addendum:** 2026-05-31 — locks Auðkenni + email/pass, virtual_rfid =
User.id, per-org email-domain policy, kennitala-required.
**Triggered by:** "do we have user onboarding on the timeline?"
conversation (2026-05-10) — confirmed driver self-onboarding has
slipped from Sprint 5 → Sprint 8 (parallel track) → out of pilot scope
entirely, and isn't currently scheduled on any sprint.

## Problem

Pilot go-live (Sprint 11) ships with **admin-created drivers only**.
That's correct for the pilot — N1 / Dalvegur / etc. all have known
driver rosters that an operator seeds via the admin console + RFID
provisioning. But it doesn't scale beyond pilot:

- Every new driver requires an operator action.
- Drivers can't manage their own credentials (add/remove RFID, view
  active tokens, view billing history beyond what the operator shares).
- No path for opportunistic / public-charger drivers (post-pilot when
  public installations land).

This ADR scopes the work to take drivers from "admin-created" to
"self-onboarding" so it can land on a sprint after pilot stabilises.

## Status today (2026-05-10)

| Capability | Where |
|---|---|
| Admin creates `User` row | Operator console — `/people/users/new` |
| Admin issues `IdToken` (manual / RFID) | `/people/users/[id]` token panel |
| Admin scopes IdToken to an installation | Via `scope_installation_id` |
| Admin grants access via `Agreement → DriverGroup → Membership` | Per ADR 0020 + manual seed scripts (e.g. `seed-dalvegur-n1-access.ts`, `seed-vcp-sandbox.ts`) |
| Driver password set | `set-n1-driver-password.ts` (bcrypt at `users.password_hash`) |
| Driver authenticates against API | `/api/auth/driver/login` (per `apps/mobile/lib/api/client.dart`) |
| Driver views chargers / starts session | `/api/driver/chargers`, `/api/driver/sessions/start` |

What does **not** exist:

- Public driver-creation endpoint
- Email / SMS / Auðkenni signup flow
- OTP infra
- Terms-acceptance audit
- Self-service credential management (add own RFID, revoke a tag)
- Account recovery / password reset
- Driver-side billing self-view (beyond per-session detail)

## Open design questions

1. **Authentication transport for sign-up**
   Email + password? OTP (SMS / email)? Auðkenni (Iceland's national
   eID, already used operator-side per Sprint 4)? Apple Sign-In /
   Google for the mobile app? Likely combo: Auðkenni primary, email
   fallback for non-Iceland drivers.

2. **What does "self-onboarding" actually deliver?**
   - **(A) Just the User row + login** — driver can create an account
     but has zero access until an operator manually adds them to a
     DriverGroup. Useful if installations are membership-only.
   - **(B) Self-claim a public installation** — driver creates account
     and immediately has access to all `installation_type='public'`
     installations. Requires public installations to exist (post-pilot).
   - **(C) Self-add credentials only** — User row exists (admin
     created); driver can add their own RFID via mobile app and have
     it auto-route to their User. Closest to today's model + minimal
     change.

3. **Vetting / abuse prevention**
   - Email verification step? Phone? Auðkenni gives strong identity
     for free in Iceland.
   - Rate-limiting on driver creation (Cloudflare Turnstile? IP rate
     limit?).
   - Manual operator approval queue for unknown installations?

4. **Billing-attribution path on first session**
   When a self-onboarded driver plugs in for the first time, how does
   their plug-in attribute? Today every session attributes via IdToken
   (`charging.charge_sessions.user_id` resolved through `id_tokens`).
   New driver has no IdToken yet. Two paths:
   - Pre-issue a "virtual RFID" on signup (UUID-based IdToken auto-
     generated, stored in mobile app keystore, sent via Authorize.req
     when starting a session)
   - Mobile app uses the start-session endpoint with the user's session
     token directly (skip IdToken; charge_sessions.user_id set from
     the auth context). Already partially supported per
     `apps/mobile/lib/screens/charger_detail_sheet.dart`.

5. **Driver-side credential management UX**
   - Add own RFID via tap (NFC scan in-app)
   - Revoke a tag they reported lost
   - View active tokens + last-used-at
   - Where in the mobile app? Drawer item ("My credentials") or
     dedicated screen?

6. **Account recovery**
   - Auðkenni: trivially "log in again with eID" — no recovery flow
     needed for that path
   - Email + password: needs reset-token + email transport (Resend?
     Postmark?). Pilot has no email infra.
   - Phone OTP: needs SMS provider (Twilio? Nexmo? Local Iceland
     provider?).

7. **GDPR / data retention**
   Self-signup brings consent flow + right-to-deletion endpoints.
   Currently no `users.deleted_at` audit trail; deletion would need
   schema work (or hard-delete with cascading IdToken / Membership /
   ChargeSession.user_id null-out). Soft-delete the cleaner path.

## Sketch — what a sprint would look like

Roughly two sprints, depending on how aggressively (B) is included:

**Sprint A — Self-signup foundation (~2 weeks)**
- Auðkenni driver-side flow (re-use Sprint 4 operator-side groundwork)
- Email + password fallback (Resend integration, password reset)
- Public driver-creation endpoint with rate limiting (Turnstile)
- Terms-acceptance audit row
- Soft-delete `users.deleted_at` + cascade rules
- Mobile app sign-up screen

**Sprint B — Self-service credential + access (~2 weeks)**
- Add-RFID-by-NFC-tap flow in mobile app
- Revoke own credential
- "My credentials" screen with active tokens + last-used
- Public-installation self-claim (if installations of that type exist)
- DriverGroup self-join request → operator approval queue (for
  membership installations)

## Out of scope for this ADR

- Operator-admin-user onboarding (separate flow, partially covered by
  Sprint 5's invite-flow MVP).
- Billing-side changes (driver-paid sessions, Stripe etc.) — a
  separate ADR / sprint.
- White-label re-skin of the driver app — Sprint 9-deferred per the
  delivery plan.

## Decision

**Not made.** Park until pilot stabilises (post-Sprint 11). Re-open
when:
1. Pilot is live with at least 50 chargers and 30 days of operation.
2. Stakeholders signal demand for self-onboarding (likely from a
   second customer wanting to onboard their own drivers without
   operator help).

When re-opened, this ADR splits into a real decision document plus an
edit to `STRAUMVAKT_V3_DELIVERY_PLAN.md` adding the sprints above.

---

## Addendum 2026-05-31 — Decisions locked, status flipped to Proposed

Filed while wiring up the Resend email pipeline (`apps/api/src/lib/email.ts`
live 2026-05-31). Triggered by the operator's "soon we will have new users
registering themselves, how do you propose we do it then?" — confirmed that
the pieces this ADR was waiting on (email transport, password-reset, rate
limiting) are now in place, so several open questions resolve.

### Decisions

| ADR Q | Decision | Rationale |
|---|---|---|
| Auth transport | **Auðkenni primary, email + password fallback** | Auðkenni gives kennitala + name + email for free for Icelandic citizens. Email fallback covers tourists and non-Iceland drivers. |
| Kennitala | **Required at registration** (NOT NULL) | Invoice prerequisite — Icelandic VAT compliance needs kennitala on every issued invoice. Auðkenni provides it; email-flow users self-type, UNIQUE catches dupes. Locks pilot to Iceland-resident drivers, acceptable. |
| Delivery option (A / B / C) | **Hybrid: A + per-org domain-auto-join + request-approve** | Pure option A is too operator-heavy for fleets. Pure option B (public claim) requires infrastructure that doesn't exist in pilot. Hybrid: registration creates account (A); domain rule auto-joins fleet drivers OR queues a request; operator approves from inbox. |
| Virtual RFID identity | **User.id is the canonical driver identifier across all sessions, chargers, installations, reports** | Operator requirement: "mutual through all the charging sessions in all reports between chargers/installations." One ID per driver everywhere. |
| OCPP wire format | **First 20 hex chars of User.id, uppercased, hyphens stripped** | OCPP 1.6 idTag is 20 alphanumeric chars max. Truncation collision over a 1M-user fleet is statistically zero. Driver sees a recognizable slice of their own User.id. Deterministic — no extra storage, no sync drift. |
| Multi-token coexistence | **Both virtual_rfid and physical rfid stay active after enrollment** | Driver can tap a physical card OR use app-start; both resolve to the same User.id. Resilient to lost cards / phone offline. |
| Per-installation enforcement | **`enforce_authorize` flag stays per-installation (A.11, already shipped)** | No change. Self-registered drivers without a DriverGroupMembership get Blocked at Authorize at enforcing installations exactly like admin-created drivers. |
| Account recovery | **Email + password-reset via Resend (live 2026-05-31)** | The infra question is closed. Implementation uses the same `user_tokens.kind="password_reset"` pattern as Sprint 5's invite flow. |
| Rate-limiting / anti-abuse | **Reuse FIX-2 `rateLimit` middleware on `/register` + Cloudflare Turnstile on web form** | Both already exist; Turnstile is CF-native, zero-cost. |
| Soft-delete cascade | **TBD — defer to a dedicated GDPR ADR** | Out of scope for the registration flow itself. Pilot can ship without; deletion is admin-only until then. |

### Schema additions (additive, Rule 4 — operator instruction obtained 2026-05-31)

Three changes, all in `prisma/schema.prisma`:

**1. `IdTokenKind` enum gets one new value: `virtual_rfid`**

The virtual RFID is auto-issued on User row creation. One per user (enforced
at the application layer; no DB UNIQUE constraint added because the existing
`id_tokens.value` UNIQUE already prevents duplicates and we may want history
if a virtual_rfid is ever rotated).

**2. New table: `tenancy.org_email_domains`**

Encodes the per-org domain rule:

```prisma
model OrgEmailDomain {
  id                       String                @id @default(uuid()) @db.Uuid
  orgId                    String                @map("org_id") @db.Uuid
  domain                   String                                  // lowercased, e.g. "n1.is"
  policy                   OrgEmailDomainPolicy  @default(request_approval)
  // For policy=auto_join only: which DriverGroup new users land in.
  defaultDriverGroupId     String?               @map("default_driver_group_id") @db.Uuid
  createdAt                DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime              @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization             Organization          @relation(fields: [orgId], references: [id], onDelete: Cascade)
  defaultDriverGroup       DriverGroup?          @relation(fields: [defaultDriverGroupId], references: [id], onDelete: SetNull)

  @@unique([domain])  // one org owns each domain; no overlap
  @@index([orgId])
  @@map("org_email_domains")
  @@schema("tenancy")
}

enum OrgEmailDomainPolicy {
  auto_join          // verified email matching this domain auto-grants membership in defaultDriverGroup
  request_approval   // verified email queues a row in driver_access_requests for operator review
  disabled           // ignore — used to temporarily pause auto-join without deleting the row
  @@schema("tenancy")
}
```

**3. New table: `agreements.driver_access_requests`**

Operator inbox for the request-approve path:

```prisma
model DriverAccessRequest {
  id                       String                       @id @default(uuid()) @db.Uuid
  userId                   String                       @map("user_id") @db.Uuid
  installationId           String                       @map("installation_id") @db.Uuid
  // How was this row created?
  triggeredBy              DriverAccessRequestTrigger
  // If triggered by domain match, point back to that rule for audit.
  orgEmailDomainId         String?                      @map("org_email_domain_id") @db.Uuid
  status                   DriverAccessRequestStatus    @default(pending)
  reviewedByUserId         String?                      @map("reviewed_by_user_id") @db.Uuid
  reviewedAt               DateTime?                    @map("reviewed_at") @db.Timestamptz(6)
  denialReason             String?                      @map("denial_reason")
  // Once approved, link back to the membership we created (audit).
  resultingMembershipId    String?                      @map("resulting_membership_id") @db.Uuid
  createdAt                DateTime                     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime                     @updatedAt @map("updated_at") @db.Timestamptz(6)

  user                     User                         @relation(fields: [userId], references: [id], onDelete: Cascade)
  installation             Installation                 @relation(fields: [installationId], references: [id], onDelete: Cascade)
  orgEmailDomain           OrgEmailDomain?              @relation(fields: [orgEmailDomainId], references: [id], onDelete: SetNull)
  reviewedBy               User?                        @relation("DriverAccessRequestReviewer", fields: [reviewedByUserId], references: [id], onDelete: SetNull)

  @@index([status, installationId])  // operator inbox query
  @@index([userId, status])           // "my requests" driver-side query
  @@map("driver_access_requests")
  @@schema("agreements")
}

enum DriverAccessRequestTrigger {
  self_request          // driver clicked "Request access to this charger"
  email_domain_match    // domain rule fired at email-verify time
  @@schema("agreements")
}

enum DriverAccessRequestStatus {
  pending
  approved
  denied
  withdrawn             // user changed their mind / deleted account
  @@schema("agreements")
}
```

Both tables are **additive**. No DROP, no RENAME, no ALTER TYPE on existing
columns. Existing rows survive unchanged (these are net-new tables).

### Phasing (revised from original sketch)

| Phase | Scope | Notes |
|---|---|---|
| **R0** | Migration: schema additions above. Auto-create `virtual_rfid` IdToken in the existing `createUser` repo path so every new User row (incl. operator-created) gets one. | One commit. Rule 4 carve-out. |
| **R1** | Auðkenni driver-side flow (reuse Sprint 4 operator-side groundwork) + `POST /api/public/register` (email+pass fallback) + `GET /verify-email/:token` + `POST /api/public/password-reset[/confirm]`. Domain-rule check fires at email-verify. | Backend sprint. ~1 week. |
| **R2** | Email templates: verify-email, access-request-submitted, access-request-approved, access-request-denied, access-request-inbound (to operator), password-reset. | Half sprint, builds on `apps/api/src/lib/email.ts` live 2026-05-31. |
| **R3** | Operator UI: `/people/access-requests` inbox + `/accounts/organizations/[id]/email-domains` CRUD. | Parallel-agent batch like recent sprints. Half sprint. |
| **R4** | `POST /api/admin/.../driver-group-memberships` create endpoint (gap that's been pending; approval path writes through it). | Few hours. |
| **R5** | Flutter app: registration screen, Auðkenni button, verify-waiting state, request-access flow with installation picker, "My credentials" screen. | Full sprint. Depends on R1-R3 live. |
| **R6** | Anti-abuse: apply `rateLimit` middleware to `/register` and `/password-reset`. Cloudflare Turnstile on the web register form. | Half day. |
| **R7** | Soft-delete + GDPR cascade (separate ADR). | Out of scope here. |

### Open questions still parked

- **Soft-delete cascade rules** — covered in a separate ADR when GDPR right-to-be-forgotten becomes urgent. Pilot ships without (admin-only delete).
- **"My credentials" Flutter UX** — wireframes happen during R5 scoping.
- **Bulk fleet import (CSV)** — separate sprint, builds on R4's POST memberships endpoint.

### Why this isn't waiting until pilot stabilises (the original "Decision: Not made")

Three things changed since the original 2026-05-10 status:

1. **Email pipeline is live** (`apps/api/src/lib/email.ts` + Resend verified
   `straumvakt.org` 2026-05-31). The single biggest blocker the ADR called
   out ("pilot has no email infra") is gone.
2. **The two membership tables and A.11 enforcement code are shipped**
   (Sprint 9 cutover + GAP-2). The registration flow no longer needs to
   invent a new access-grant primitive — it just writes through to
   `agreements.driver_group_memberships` like every other path.
3. **The two pilot customers (N1, Dalvegur) signalled that bulk-onboarding
   their fleets via operator action doesn't scale to 50+ drivers.** The
   "wait for a second customer to demand it" gate has effectively been
   met by the first customer's own scaling pain.

Phases R0–R4 are bounded backend + UI work, no new infrastructure. R5 (Flutter)
is the heaviest lift and naturally splits into its own sprint.
