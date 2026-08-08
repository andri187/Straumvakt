# ADR 0026 — Host-managed driver enrollment + invoice-as-agent billing model

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Proposed
**Date:** 2026-06-03
**Supersedes:**
[ADR 0022 — Driver self-onboarding (the 2026-05-31 addendum)](./0022-driver-self-onboarding.md)
in its driver-side conclusions. The kennitala-required + virtual-RFID
constants from 0022 carry forward unchanged.
**Related:**
[ADR 0017 — Pre-pilot rescope (going-public pivot context)](./0017-prepilot-rescope-for-4k-charger-target.md),
[ADR 0020 — Driver access via DriverGroups](./0020-driver-access-via-driver-groups.md),
[ADR 0025 — Billing cutover](./0025-billing-cutover-from-legacy-to-agreements.md)

## Context

The 2026-06-03 "going public + RFQs" pivot left ten open questions about
the customer / driver / billing model. ADR 0022's 2026-05-31 addendum had
already prescribed driver *self*-onboarding (the path that produced
ENROLL-1/2/3 backend work), but in the 2026-06-03 product conversation
the operator confirmed Straumvakt is intended for **private charging at
multi-dwelling residences or companies** — i.e. closed-population B2B —
which makes self-signup the wrong primary path.

The pre-2026-05-31 memory `drivers_admin_created_only.md` was correct
after all. The 2026-05-31 addendum to ADR 0022 was a wrong turn driven by
the going-public framing being interpreted as "open consumer signup"
when it actually meant "publish marketing material + accept RFQs from
prospective host customers." Those are very different surfaces.

This ADR locks the corrected model.

## Decision

### 1. Customer = Host organization

The Straumvakt customer is a **host organization**, never a driver. Two
host types are in scope for pilot + going-public phase:

- **Multi-dwelling host** — HOA boards, residents' associations,
  building owners with shared charging infrastructure.
- **Company host** — employers operating charging for employees, fleet
  operators charging fleet vehicles.

Both map to `tenancy.organizations` rows with `kind ∈ {multi_dwelling, company}`.
Operator (Straumvakt staff) onboards the host org through a sales
process; hosts never self-provision.

### 2. Host admin manages their drivers

Each host org has one or more **host-admin** users (HOA board members,
HR managers, facility managers). They use the operator portal under a
scoped view that exposes only their org's chargers, DriverGroups, and
billing. The portal is the same Next.js app — RBAC + tenancy gates the
view per `Membership.role`.

### 3. Driver enrollment is invite-only

No public driver self-signup. Removed surfaces (rolled back tonight):

- `/register` page — deleted
- `/verify-email/[token]` page — deleted
- `/api/public/register` endpoint — left in place but dormant
- `/api/public/verify-email/[token]` endpoint — left in place but dormant
- ENROLL-2 access-request inbox — left in place; possible future use
  for self-request-into-existing-host edge cases (out of scope for now)
- ENROLL-3 OrgEmailDomain — left in place; possible future use for
  auto-approve invites from a verified company domain (out of scope)

Driver enters the system through one of three invite forms emitted by
the host admin:

- **Invite code** — short alphanumeric string the host shares verbally,
  via SMS, or printed.
- **QR code** — same code rendered for scan, suitable for charger
  station signage, building lobby, or printed permanently on a station.
- **Email invite** — direct send to the prospective driver's email
  address; contains both the code and a deep link.

QR codes are configurable per host with **two optional additional
security layers** (chosen at QR generation time by the host admin):

- **Password key** — a secondary string the host distributes
  separately (e.g. by SMS, printed in a different location). The
  scanner enters it after scanning. Defeats the "stolen photo of the
  QR code on the wall" attack.
- **Host-admin allow-term** — after scanning, the redemption attempt
  lands in the host's access-request inbox (the ENROLL-2 surface,
  which re-activates for this flow) and waits for an explicit host
  approval before activating the membership. Used when QR codes are
  posted publicly (e.g. on a charging station visible from the
  street) and the host wants per-driver review.

A bare QR (no password, no allow-term) is also valid for low-risk
scenarios — e.g. a QR poster inside an HOA's locked stairwell where
physical access is already gated.

ENROLL-4 (`POST /api/admin/orgs/:orgId/driver-group-memberships`) is the
ultimate write target for all three forms once an invite is consumed.

### 4. Driver identity: email + password + kennitala

Driver registers (via invite redemption, not self-signup) with:

- **Email** — login identifier
- **Password** — credential (PBKDF2 / Argon2 per existing user-credentials)
- **Kennitala** — Iceland national ID, required for billing. The
  driver's kennitala is captured at invite-redemption time, not at host
  invite time (the host invites by email, not by kennitala).

Auðkenni (national eID) is **not in scope for this ADR**. When it lands
in a future ADR it becomes an alternative login path that asserts the
kennitala automatically (eliminating the kennitala field at redemption);
the model below doesn't change shape.

### 5. Driver enrollment surface is the mobile app

The Straumvakt mobile app is the only redemption surface. An invited
driver:

1. Downloads the mobile app from Google Play / App Store (or, for an
   already-installed user, opens it).
2. Opens the app to an **empty state** — no chargers visible, only an
   "Enter invite code" or "Scan QR" call to action.
3. Pastes the code / scans QR / taps the email deep link.
4. Sets a password and confirms their kennitala.
5. Lands on the regular app shell with the host's chargers visible.

The mobile app has no web equivalent for redemption. The web-side flow
ends at "we sent an email — install the app to continue."

The empty-state-as-redemption-funnel is a deliberate UX choice. A driver
who has no access to chargers is not shown a misleading empty Hlaða tab;
they see only the action that would get them somewhere.

### 6. Inbound lead capture via public apply form

A public form lives at `/apply` on `straumvakt.org` (Next.js public
route, allow-listed in `middleware.ts` via `isPublicApplyPath`). The
form captures:

- Company / association name
- Contact name + email + phone
- Kennitala (optional at this stage — operator collects formally on
  contract signing)
- Site type (`multi_dwelling` | `company`) — drives form labels
- **One or more sites**, each with: address, estimated number of
  chargers, estimated number of drivers
- Free-text description of the network and any specific requirements

Submission persists to `tenancy.host_applications` and sends a Resend
email notification to the operator inbox. The form is the front door
for inbound RFQs; outbound deals signed via direct sales bypass it (see
ADR 0027 — host onboarding by operator, pending).

Status field on `host_applications`: `new` | `in_review` | `offered` |
`won` | `lost`. Tracked in an operator-side inbox at `/applications`.

### 7. Operator-initiated host creation

Straumvakt staff can create a host customer directly from the operator
portal — bypassing the `/apply` lead funnel — when a deal is signed
externally (lunch meeting, phone call, RFQ response). This page lives in
the existing operator UI under accounts/organizations, requires a
`straumvakt_staff` or `operator` Membership role, and creates the org +
sends an admin invite link to the supplied contact email so the host
admin can set their password. Detailed in a follow-up ADR (probably
0027) since it depends on the host-admin invite mechanism (item 3
extension above) that doesn't yet exist.

### 8. Billing model: Straumvakt invoices on behalf of the host

Straumvakt acts as **billing agent** for the host. Charging sessions
produced at a host's installations roll up into invoices that are sent
from Straumvakt's billing entity, but represent charging at the host's
network and use the host's tariff structure.

The invoice recipient is determined by:

- **Company hosts** — invoice goes to the company (single billable
  entity per host org).
- **Multi-dwelling hosts** — invoice goes to the **child-object owner**
  (item 10 below — owner of the unit / apartment / parking stall
  associated with the charging session, NOT necessarily the driver).

Straumvakt's billing entity, fee structure, VAT treatment, and remit
flow back to the host are out of scope for this ADR — see ADR 0025 +
follow-ups.

### 9. One driver, multiple installations across hosts

A single driver identity may hold memberships in **multiple
DriverGroups**, including DriverGroups belonging to **different host
organizations**. The schema supports this today (DriverGroupMembership
is a join with no uniqueness constraint that would prevent it). The
billing system must handle cross-host attribution carefully:

- A given ChargeSession is bound to exactly one Installation (so exactly
  one host) — there's no ambiguity at the session level.
- A driver's bills may therefore come from multiple Straumvakt invoices
  in a single month, one per host where they charged.
- Past-session history in the mobile app surfaces all sessions
  regardless of host but groups them by host in the UI.

Concretely: Alice lives at Dalvegur (multi-dwelling host) AND works at
N1 (company host). Alice has DriverGroupMemberships in `dalvegur/residents`
and `n1/employees`. Charges at Dalvegur invoice to Alice's apartment
owner; charges at N1 invoice to N1.

### 10A. Kennitala = immutable identity; email = mutable login channel

A kennitala can only ever be registered **once** in the whole system,
across all hosts. The kennitala is the immutable national identity; the
email behind it is a mutable contact + login channel.

- `identity.users.kennitala` is `UNIQUE NOT NULL`. Already enforced at
  the schema level per ADR 0022.
- `identity.users.email` is `UNIQUE` per non-deleted row but **may be
  changed by the user**. Email change requires verifying the new
  address (POST to a `/me/email-change-request` endpoint sends a
  verification link to the new address; the change applies only when
  the link is clicked from the new mailbox). The old email is moved to
  an audit row and is no longer a valid login identifier.
- Driver cannot change their own kennitala. If a kennitala correction
  is needed (Hagstofa correction, data entry error), it requires
  Straumvakt staff action with an audit log entry.
- **One kennitala may use multiple devices** (phone, tablet, phone
  replacement, etc.) — the user ↔ device relation is one-to-many on
  the user side. The inverse — **one device linked to multiple
  kennitölur** — is the abuse signal worth alerting on. Captured for
  the upcoming device-registry ADR (ADR 0030).
- Login lookup is **always by current email + kennitala**. An old
  email cannot log in, period. Stale magic-link / password-reset
  emails sent to an old address before the change still work (token
  validity is on the token row, not on the email address at
  click-time), but only briefly until they expire.
- Edge case — non-Icelandic users without a kennitala — **out of
  scope for V3 / pilot**. Foreigners require their employer/host to
  request a kennitala for them, or wait for a post-pilot ADR that
  introduces a proxy-identity model. **When that ADR lands, it must
  include host-side verification of the foreigner's billing
  arrangement** (who pays, in what currency, against which contract)
  — Straumvakt cannot accept a foreign driver without the host
  formally attesting that they're authorized to charge at this
  network and a billing path exists.
- **Carve-out — dependent children in a group context.** Per
  [ADR 0031 item 18](./0031-cost-model-and-money-flow.md), a User row
  without a kennitala IS permitted if the user is bound to a group
  (HOA group, family group) whose owner has a kennitala — the group
  owner receives the full aggregated invoice for the group's drivers.
  Use case: HOA invites an apartment owner whose teenage child also
  needs to charge. The child has no personal kennitala but is bound
  to the apartment's group; charges aggregate to the apartment
  owner's monthly invoice.

### 10B. Driver identity is separate; the household (or unit / cost-center) is the billing unit

Drivers are individual identities — Alice and Bob are two separate User
rows even when they share a household. **Billing does NOT roll up to
the driver — it rolls up to the household / unit / cost-center as a
single billable entity, with the owner-of-record of that entity as the
invoice recipient.**

The model is therefore: **per-person identity, per-household billing**.
The two are intentionally decoupled — a single household has one
invoice line per month aggregating its drivers' charging, but each
driver retains their own session history, login, eID identity (when
Auðkenni lands), and audit trail.

For a multi-dwelling host, the child-object hierarchy is:

```
Host org (Dalvegur HOA)
└── Installation (Dalvegur 10–14)
    └── Child object: apartment / unit / stall (Apt 304)
        └── Owner: the person or entity who pays for what happens
            on this child object (the owner record on file)
```

A ChargeSession attributable to Apt 304 → invoice line item on Apt 304's
owner's monthly statement. Apt 304 owner = a separate billing entity
(could be Alice if she owns her apartment, could be the HOA itself if
it's a rental, could be a landlord). Multiple drivers can be associated
with Apt 304 (Alice + Bob both live there) — both their charges roll up
to the same owner record.

For a company host the child object can be conceptually flat ("N1"
itself is the single billable entity) or hierarchical (department,
cost-center, individual employee — to support reimbursement
workflows). Pilot model: flat — the company is the single billable
entity, employee-level cost allocation is reporting only.

The schema implication: `billing.bill_to` resolves through
`charging.sessions → installations → child_objects (parking_stalls? units?) → owners`.
The exact table name + cardinality for the child-object layer is
deferred to the implementation ADR; the conceptual decision (separate
driver identity, owner-rolled-up invoicing) is what's pinned here.

### 11. Operator-wide driver view in the admin portal

Straumvakt staff (not host admins) get a top-level **Drivers** page in
the operator portal that lists every driver across every host with
their status. The view is operator-scoped — host admins see only their
own host's drivers, not the global list.

Columns:

- Kennitala
- Display name
- Current email
- Status — one of `pending_invite` | `active` | `suspended` |
  `inactive` | `deleted`
- Host memberships count (and a drill-down link)
- Last login (or "never")
- Registered date
- Most recent ChargeSession date

Filters: by status, by host org, by last-active range, by free-text
(name / email / kennitala).

Sort: registered date desc by default.

Actions per row: view full profile (drill-down page), suspend / reactivate
(staff-only), trigger password reset, view audit log.

This page is also the natural home for **install-base / conversion
analytics** once the device-registry work lands (queued as ADR 0030
follow-up — see the open question on device tracking).

The page route is `/drivers` (top-level under the operator portal),
gated by Membership.role in (`straumvakt_staff`, `operator`).

## Consequences

### Enabled

- **Clean B2B funnel.** Operator-as-gatekeeper, host-as-customer,
  driver-as-end-user maps onto real-world private charging.
- **Apply form generates real RFQ inflow** without overpromising
  consumer-grade self-signup.
- **Auðkenni layers cleanly** on top later — replaces the kennitala
  field at redemption without changing the host invite mechanism.
- **Multi-installation drivers are first-class** — natural model for
  residents who also work at a Straumvakt customer.

### Disabled / out of scope (explicitly)

- **Public consumer signup**. Random EV owners who land on
  straumvakt.org cannot create an account. They see "Apply for your
  building or company."
- **OCPI roaming** as a driver entry point. Drivers entering Straumvakt
  via a roaming partner is a separate ADR (post-pilot, per ADR 0017).
- **Pay-as-you-go credit card at the charger.** No anonymous payment
  flow. Every session attributes to a known driver identity tied to a
  known billing target.

### Required follow-up work

- **ADR 0027** — Host onboarding (operator-initiated host create + host-admin
  invite) — depends on extending the invite system for host-admin role.
- **ADR 0028** — Driver invite mechanism (code / QR / email) — extends
  the Sprint 5.8 invite schema for `kind='driver'`.
- **ADR 0029** — Child-object model for multi-dwelling billing
  attribution (table names, cardinality, owner resolution).
- **ADR 0030** — Device registry + install analytics + abuse signals.
  `identity.app_devices` table, anonymous install telemetry,
  conversion funnel from install → invite-redeem, alert on the
  one-device-many-kennitölur abuse pattern. One driver may have many
  devices; one device may have one current `linked_user_id` (last
  signed-in user) with a separate audit table for history.
- **Mobile app: empty state** — `mobile-app-driver` redesign already
  has the carousel; an "empty / no access" state needs to land as a
  prerequisite for invite redemption.
- **Mobile app: invite redeem screen** — paste code or scan QR, set
  password, confirm kennitala, log in.
- **Mobile app: API wiring** — `mobile-app-driver` is visual-only
  today; redeem needs the real API client (`api.dart` style from the
  CPMS-era app, rewritten cleanly).

### Reverted / repurposed

- ENROLL-1 register + verify-email endpoints — left in place but
  marked dormant. Their UI (`/register`, `/verify-email/[token]`) is
  deleted as of this ADR's date.
- **ENROLL-2 access-request inbox — repurposed.** Originally for
  driver self-request approvals from email-domain mismatches; now
  the natural backend for the **QR-with-host-admin-approval flow**
  in item 3. When a driver scans a QR configured with
  `allow_term=true`, the resulting redemption attempt lands in this
  inbox for explicit host approval before the membership activates.
- ENROLL-3 OrgEmailDomain — left in place; future "auto-approve
  invites from verified domain" optimization may revive it.
- ENROLL-4 driver-group-membership endpoint — **still load-bearing**;
  it's the eventual write target of any invite consume path.

## Open implementation questions (not blocking this ADR)

These are tactical decisions that don't change the model but need
answering before the work in ADR 0027/0028/0029 starts:

- **Apply form** — Captcha (Cloudflare Turnstile) on submission, or
  trust low volume initially?
- **Host admin invite** — Same `kind='invite'` token row in the
  existing `identity.user_tokens`, or new table?
- **Driver invite codes** — Length, entropy, single-use enforcement,
  expiry default (24h? 7 days?).
- **QR code rendering** — Server-render PNG endpoint, or client-side
  library?
- **Email deep links** — Universal Links / App Links scheme for the
  invite tap-to-redeem path on Android + iOS.
- **Mobile app — single account across reinstalls** — if a driver
  uninstalls and reinstalls, they log in with email/password and
  everything restores. No new invite needed.

## Rejected alternatives

- **Open self-signup at /register** — what ENROLL-1 + tonight's first
  /register page were aiming at. Wrong-direction for a B2B private
  charging operator; produces unqualified signups + creates security
  surface for spam / kennitala stuffing attacks.
- **Shared household account** (one identity per household with
  multiple humans behind it) — rejected; per-person identity stays
  per item 10B so each driver retains their own session history,
  login, and (later) eID identity. Note that *household billing as a
  single line item* is **NOT** rejected — that's the model — what's
  rejected is conflating multiple humans into one User row.
- **Straumvakt as full marketplace** (drivers freely browse and join
  any host) — rejected; model is host-managed. **However**, a
  controlled discovery surface DOES exist via QR codes posted at
  charging stations or in host common areas (per item 3). A driver
  who scans a QR is not "discovering" a host in the marketplace
  sense — they're presented with a host-issued credential which the
  host has explicitly chosen to publish at that physical location,
  optionally gated by password key and/or host-admin approval. The
  difference is that the host always controls who can redeem; the
  driver doesn't enumerate or search.
- **Pay-as-you-go anonymous payment at the charger** — no app,
  credit card tap, drive away. Rejected — every session attributes
  to a known driver identity tied to a known billing target per item
  8 (Straumvakt invoices on behalf of the host; there's no acquirer
  relationship for anonymous credit cards).
