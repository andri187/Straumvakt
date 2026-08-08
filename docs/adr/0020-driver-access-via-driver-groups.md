# ADR 0020 — Driver access resolution via DriverGroups

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Proposed
**Date:** 2026-05-08
**Sprint:** Sprint 10 — schema + resolver land in S10; backfill + UI follow in S10.x.
**Relates to:** [ADR 0014](./0014-identity-tenancy-and-authorization.md) (drivers are admin-created only), [ADR 0019](./0019-agreement-and-bearer-architecture.md) (Agreement + DriverGroup schema), [docs/reference/integrations/zaptec.md](../reference/integrations/zaptec.md) §8 (Zaptec Default ID tag behaviour).
**Rollback anchor:** `dev/sprint-08-tariff-and-billing` HEAD on the day this ADR was written.

---

## Context

The OCPP `Authorize.req` resolver at
[apps/api/src/routes/internal/ocpp-authorize.ts](../../apps/api/src/routes/internal/ocpp-authorize.ts)
gates charger access on a single check: `IdToken.scope_installation_id`. NULL
scope = globally usable. With `enforceAuthorize=false` on every installation
(shadow mode), the verdict is currently advisory and not enforced anywhere —
but as a steady-state production model it has two structural problems:

1. **Permissive by default.** Any active IdToken row authorizes at every
   installation in the system unless the operator explicitly scopes the
   token. The expected default for a charging operator is the inverse:
   no access unless a grant exists.

2. **Bypasses the Agreement chain.** ADR 0019 introduced
   `agreements.driver_groups` and `agreements.driver_group_memberships`
   precisely to encode per-Org / per-installation driver enrollment.
   The resolver doesn't read either table. The chain
   `User → DriverGroupMembership → DriverGroup → Agreement → scope` is
   designed but unwired.

A third constraint is operational: Zaptec sends `Authorize.req` for every
plug-in, including on installations configured for free vend. With
`Authorisation required = OFF` and `Initial device password = blank` in
the Portal, Zaptec substitutes a per-installation **Default ID tag**
(7-byte ISO-14443-shaped UID, e.g. `EE43C609263CC7` at Dalvegur 10) into
every `Authorize.req`. Our CSMS must respond `Accepted` for that value
without attributing the session to any specific human driver.

A fourth need is QA pragmatism: a *single, controllable* token that
authorizes everywhere is invaluable for staging ergonomics — but must
never authorize in production.

## Decision

Resolver becomes a six-step decision tree gated on `IdToken.kind`. Two
new kinds make system-token roles explicit. One new boolean on
Installation gates vendor-default acceptance.

### 1. Extend `IdTokenKind` enum

Two new values alongside existing `rfid` (and any future `emaid` /
`virtual` variants):

| Kind | Semantics |
|---|---|
| `rfid` *(existing)* | Real human driver token. Walks the DriverGroup chain. |
| `test_master` *(new)* | QA convenience. Bypasses access checks. **Gated by `Env.ALLOW_TEST_TOKENS=true`** — production worker has the flag false; resolver treats `test_master` rows as `Invalid / test_token_disabled` there. |
| `vendor_default` *(new)* | Vendor-issued free-vend marker (e.g. Zaptec Default ID tag). Per-installation row. Authorizes only at installations where `Installation.acceptsVendorDefault=true`. Sessions attribute to a per-Org anonymous placeholder driver. |

### 2. Add `Installation.acceptsVendorDefault` boolean

Default `false`. Operator opts in per-installation when the install is
running in free-vend mode. Off → unknown vendor-default tags are
rejected with `Invalid / vendor_default_not_permitted` even if the
IdToken row exists.

### 3. Per-Org anonymous driver placeholder

When an Org first owns an Installation that flips
`acceptsVendorDefault=true`, ensure a sentinel User exists tagged in
metadata as the "anonymous free-vend driver" for that Org. One per Org
across all that Org's installations. Example:

```
Krónan ehf.
└── User "Krónan — Anonymous Free-Vend" (kind=anonymous, scoped to org)
    └── Used by every free-vend session at any Krónan installation
```

Driver attribution at session level remains via `session.installation_id`
for per-installation reporting — the per-Org anonymous user keeps the
driver list compact (1 placeholder vs. N).

### 4. Auto-create default DriverGroup per Installation

Per the operator's principle "if an Organization owns an Installation a
DriverGroup should exist by default":

When an `Installation` row is created with a non-null `ownerOrgId`,
synchronously create:

- An `Agreement` of type `installation`, owned by `ownerOrgId`, scoped to
  that single installation, with default terms (cost factor catalog seeded
  per ADR 0019)
- A `DriverGroup` attached to that Agreement, displayName like
  `"Default — {Installation.displayName}"`, owned by `ownerOrgId`

Drivers added to the default group inherit the default terms; operators
who need different terms create additional Agreements + Groups manually.

### 5. Resolver decision tree

```
1. Lookup IdToken by value (case-insensitive).
   not found  → Invalid / unknown_id_tag

2. Status check.
   revoked    → Blocked / revoked
   suspended  → Blocked / suspended
   expired    → Expired / expired_status
   active     → continue

3. Expiry check.
   expiresAt < now  → Expired / expiry_passed

4. Kind dispatch.
   test_master:
     env.ALLOW_TEST_TOKENS == true  → Accepted / test_master_bypass
     else                           → Invalid / test_token_disabled

   vendor_default:
     installation.acceptsVendorDefault == true  → Accepted / vendor_default
     else                                       → Invalid / vendor_default_not_permitted

   rfid (or other real-driver kinds):
     fall through to step 5.

5. Token-level scope check (existing).
   token.scopeInstallationId set AND ≠ charger.installationId
       → Invalid / scope_mismatch

6. DriverGroup walk.
   Resolve every DriverGroupMembership for token.userId.
   For each, evaluate Agreement scope filter against the charger's
   installation/site/charger.
   Any match  → Accepted / ok with { idTokenId, userId, driverGroupId, agreementId }
   No match   → Invalid / no_access_grant
```

The verdict shape extends to optionally carry `driverGroupId` and
`agreementId` so the session-ledger projection knows which Agreement
governs cost rules for the session.

### 6. Operator UI surfaces

- **User detail page**: replace the bare token list with a "Driver group
  memberships" section showing each group's name, owning Org, and
  resolved installation/site coverage. Tokens become a sub-list under
  the group memberships.
- **Token row**: show `kind` badge ("rfid" / "test_master" / "vendor_default"),
  `scope_installation_id` resolved to a name, and a yellow flag if the
  kind is `test_master` while the env flag is off (so operators see
  "this token won't authorize anywhere in this environment").
- **Installation page**: surface the `acceptsVendorDefault` toggle and
  show which `vendor_default` IdToken row is bound to it.

## Consequences

**Benefits:**

- Restrictive-by-default access. Adding a new IdToken does NOT grant
  charger access until the driver is enrolled in a DriverGroup.
- Free-vend semantics expressed cleanly per-installation (`acceptsVendorDefault`)
  rather than via a permissive resolver.
- Test-master token is a first-class, typed concept gated by env flag —
  not a magic string in code.
- The DriverGroup → Agreement chain ADR 0019 designed becomes load-bearing.
- Future per-charger and per-site access semantics ride on the same
  `Agreement.scopeFilterJson` lever — no new resolver work needed.

**Costs:**

- Migration touches `IdTokenKind` enum (additive) and adds one boolean
  column on `Installation` (additive). No data destruction.
- Backfill required for existing Installations on staging to create their
  default DriverGroup + Agreement.
- Resolver gets non-trivially more complex — five new test cases at
  minimum.
- Free-vend behaviour now requires explicit per-installation operator
  opt-in (`acceptsVendorDefault=true`). Forgetting to flip it on a new
  free-vend install means every plug-in fails closed.

**Risks:**

- **Lockout on cutover.** If we flip the resolver from permissive to
  restrictive in one shot before the backfill runs, every charger refuses
  every session. Mitigation: resolver upgrade ships *after* backfill
  confirms every existing Installation has a default DriverGroup and
  every IdToken-holding driver is in at least one group.
- **`enforceAuthorize` flag still gates whether the verdict is honoured.**
  Until an operator flips an Installation's `enforceAuthorize=true`, the
  gateway still falls through to the stub `Accepted` regardless of what
  the resolver says. New verdicts are observable in logs but not
  enforced. This is intentional — the operator opts into enforcement
  per-installation after verifying their access grants are correct.
- **`ALLOW_TEST_TOKENS` must never be true in production.** Mitigation:
  hard-coded check in the API Worker boot path that throws if
  `env.ENVIRONMENT === "production" && env.ALLOW_TEST_TOKENS === "true"`.

## Implementation order

1. Migration: extend `IdTokenKind` enum (`test_master`, `vendor_default`),
   add `Installation.acceptsVendorDefault` (default false).
2. Repository helpers: `ensureDefaultDriverGroupForInstallation(installationId)`,
   `findDriverGroupsCoveringInstallation(installationId, userId)`,
   `getOrCreateAnonymousDriverForOrg(orgId)`.
3. Backfill script: walk `properties.installations` and create the default
   Agreement + DriverGroup for any installation that lacks one. Idempotent.
4. Resolver rewrite per §5 above. Tests covering every verdict reason.
5. Boot-time guard for `ALLOW_TEST_TOKENS` in production.
6. UI: user-detail-page DriverGroup memberships panel; token-row kind/scope
   badges; Installation page `acceptsVendorDefault` toggle.
7. Seed scripts: vendor-default IdToken per Zaptec installation
   (value = the per-installation Default ID tag from the Portal),
   test-master IdToken on staging only.
8. Operator: flip `acceptsVendorDefault=true` for Dalvegur 10 (and any
   other current free-vend installs). Add a real human driver to
   Dalvegur 10's default DriverGroup as a smoke test. Probe the resolver
   against zpr042727 with both `EE43C609263CC7` and that human driver's
   real RFID UID — confirm both Accepted, with the right
   `userId` / `driverGroupId` attribution.

Steps 1–5 are a single coherent commit set; steps 6–8 follow in
operator-paced subsequent commits.

---

## Decisions confirmed during 2026-05-08 design pass

The four design questions addressed before this ADR was written:

1. **Test-master token gated by env flag** — yes (§5 step 4, §"Risks").
2. **`vendor_default` tokens are per-installation** — yes (each Zaptec
   installation has its own Default ID tag string in the Portal; one
   IdToken row per installation, scoped via `scopeInstallationId`).
3. **Per-Org anonymous user** (not per-installation) — yes (§3).
4. **ADR-first, then implementation** — this document is that ADR.
