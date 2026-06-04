# ADR 0027 — Host onboarding (operator-initiated create + host-admin invite)

**Status:** Proposed
**Date:** 2026-06-04
**Sprint:** Going-public critical path P2.0 (gates P2 onboarding —
[GOING_PUBLIC_CRITICAL_PATH.md](../architecture/GOING_PUBLIC_CRITICAL_PATH.md))
**Implements:** [ADR 0026 §7](./0026-host-managed-driver-enrollment-and-billing-model.md)
(operator-initiated host creation), the follow-up ADR 0026 named.
**Related:**
[ADR 0026](./0026-host-managed-driver-enrollment-and-billing-model.md),
[ADR 0031](./0031-cost-model-and-money-flow.md) (per-host negotiated terms),
[ADR 0014](./0014-identity-tenancy-and-authorization.md) (roles/RBAC),
[ADR 0028](./0028-driver-invite-mechanism.md) (the driver-side sibling).

## Context

ADR 0026 makes the **host organization** the customer; hosts never
self-provision. Two entry routes:
1. **Inbound** — a prospect submits `/apply`; operator works the lead in
   the `/applications` inbox; on "won," converts it to a host.
2. **Outbound** — a deal signed externally (call, lunch, RFQ response);
   operator creates the host directly, bypassing `/apply`.

Both routes converge on **one host-create mechanism** + a **host-admin
invite** so the host's own person (HOA board member, HR/facilities
manager) can set a password and start managing their drivers.

The existing invite system (`repositories/invites.ts`, `kind='invite'`,
`/invite/[token]`) is operator/staff-audience and role-bundle aware. This
ADR extends it for the **host-admin** role and defines the create flow.

## Decision

### 1. Host = `tenancy.organizations` row, operator-created

A host is an Organization with `kind ∈ {multi_dwelling, company}` (ADR
0026 §1). Operator creates it from the portal (`/accounts/organizations/
new`, extended), capturing:

- Legal identity — name, kennitala, legal form, VSK, addresses, contacts.
- `kind` — drives downstream labels (units/apartments vs departments).
- **Negotiated commercial terms** (ADR 0031 Q2/Q3 — per-host negotiated):
  the monthly service fee, optional per-OCPP-identity/charger fee, and any
  factor-code set. Stored against the host's Agreement (ADR 0019), not
  hard-coded.

No charger/driver data at create — those arrive via Zaptec import (existing)
and driver invites (ADR 0028).

### 2. One create path, two entry routes

- **Outbound:** operator fills the create form directly.
- **Inbound:** the `/applications` inbox "convert to host" action
  pre-fills the same create form from the `tenancy.host_applications` row,
  then marks the application `won`.

Same code path; the application is just a pre-fill source. (`/apply` form +
`host_applications` table land in P2.3/P2.4; this ADR assumes them.)

### 3. Host-admin role + invite

- **New role `host_admin`** — a first-class post-ADR-0014 MembershipRole
  bundle (additive; does **not** revive any deprecated role removed in the
  Sprint 9 RLS rebuild). Capabilities: manage the host's own drivers
  (invite/suspend), read the host's billing/invoices, read the host's
  chargers/sites. **Excludes:** platform/cross-org surfaces, charger
  config beyond their org, tariff *authoring* (operator sets negotiated
  terms), and any `straumvakt_staff` capability.
- **Scoped to the host org only** — RBAC + tenancy gate every view by
  `Membership.orgId` + role (the scoped portal itself is P2.8).
- **Invite** — reuse the existing invite token (`kind='invite'`) with the
  `host_admin` role and the host org as target. Operator triggers it at
  host-create (or later). The recipient lands on `/invite/[token]`, sets a
  password (existing consume flow), and the Membership flips `active`.
- **Multiple host-admins per host** are allowed (board has several members);
  invites are per-person.

### 4. What create produces

A single operator action yields:
- the Organization (`kind`, legal identity),
- its Agreement carrying the negotiated commercial terms,
- a default Site/Property scaffold *(open — §Open: auto-scaffold or wait
  for Zaptec import?)*,
- one or more pending `host_admin` invites to the supplied contact emails.

## Consequences

### Enabled
- Symmetric inbound/outbound onboarding through one mechanism.
- Host self-management without platform exposure — `host_admin` is tenancy-
  bounded by construction.
- Commercial terms live on the Agreement (ADR 0019/0031), so billing reads
  them rather than re-deriving.

### Costs / risks
- **`host_admin` is a new RBAC bundle** — must be defined in the permission
  catalogue and covered by the P4 tenant-isolation tests; a scope leak here
  exposes one host's data to another.
- **Terms-at-create couples onboarding to billing** — the create form needs
  the ADR 0031 factor-code + service-fee model present (P1) to be fully
  functional; a create before P1 captures terms as data without a billing
  engine to apply them (acceptable — terms are recorded, billed later).

### Schema implications (additive)
- `tenancy.MembershipRole` += `host_admin` (additive enum value).
- `tenancy.host_applications` (the `/apply` sink) — defined in P2.3; this
  ADR only references it.
- Negotiated terms persisted on the host Agreement (existing ADR 0019
  models; may need additive fields for the service-fee/charger-fee).

## Open questions (resolve during P2)
1. **`host_admin` bundle composition** — define exact permission slugs, or
   compose from `manager` + `finance.read`? Leaning: explicit `host_admin`
   bundle for clarity.
2. **Host-admin invite token table** — reuse `identity.user_tokens`
   (`kind='invite'`) as today, or a distinct `kind='host_admin_invite'`?
   Leaning: reuse with the role on the token (matches ADR 0026 open Q).
3. **Site auto-scaffold at create** — create an empty Site/Property, or
   wait for Zaptec import to create them? Leaning: wait; avoid orphan
   scaffolds.
4. **Application → host linkage** — keep an FK from the created org back to
   its `host_applications` row for funnel analytics? Leaning: yes.

## Rejected alternatives
- **Host self-signup / self-provision** — rejected by ADR 0026; hosts are
  operator-gated.
- **Reuse the deprecated `admin`/`owner` MembershipRole** — those are being
  removed in the Sprint 9 RLS rebuild; `host_admin` is the clean post-0014
  successor.
- **Bake commercial terms into code/config** — terms are per-host
  negotiated (ADR 0031 Q3); they must be data on the Agreement.
