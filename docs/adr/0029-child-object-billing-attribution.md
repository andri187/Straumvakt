# ADR 0029 — Child-object model for billing attribution

**Status:** Accepted (2026-06-04) — core model is canon; the 6 open
questions below resolve during P1 implementation and any single call is
reversible by supersession.
**Date:** 2026-06-04
**Sprint:** Going-public critical path P1.0 (gates P1 billing —
[GOING_PUBLIC_CRITICAL_PATH.md](../architecture/GOING_PUBLIC_CRITICAL_PATH.md))
**Implements:** the table-name + cardinality + owner-resolution decision
that [ADR 0026 §10B](./0026-host-managed-driver-enrollment-and-billing-model.md)
deferred to "the implementation ADR."
**Related:**
[ADR 0026](./0026-host-managed-driver-enrollment-and-billing-model.md)
(per-person identity / per-household billing),
[ADR 0031](./0031-cost-model-and-money-flow.md) (cost model; item 18
group-owner carve-out),
[ADR 0019](./0019-agreement-and-bearer-architecture.md) +
[ADR 0020](./0020-driver-access-via-driver-groups.md) (DriverGroups —
**access**, orthogonal to billing here).

## Context

ADR 0026 pinned the conceptual model — **per-person identity, per-household
billing** — but explicitly left the table shape open:

> The schema implication: `billing.bill_to` resolves through
> `charging.sessions → installations → child_objects (parking_stalls?
> units?) → owners`. The exact table name + cardinality for the
> child-object layer is deferred to the implementation ADR.

The billing target of a ChargeSession is **not the driver**. It is the
**household / unit / cost-center** the driver belongs to, invoiced to that
unit's **owner of record**. Examples from ADR 0026:

```
Host org (Dalvegur HOA)
└── Installation (Dalvegur 10–14)
    └── Child object: apartment / unit / stall (Apt 304)
        └── Owner: person or entity who pays (Alice, or the HOA, or a landlord)
```

Multiple drivers can map to one unit (Alice + Bob both live in Apt 304);
both their charges roll up to Apt 304's owner. Company hosts are flat —
"N1" is one billable entity. ADR 0031 item 18 adds dependent children
(no kennitala) bound to a group whose owner has a kennitala.

**Crucial distinction:** this is the **billing** spine. It is *orthogonal*
to the **access** spine (DriverGroup → Agreement → scope, ADR 0019/0020).
A driver has both: a DriverGroupMembership (what they may charge at) **and**
a billing-object association (who pays). The two must not be conflated.

## Decision

### 1. One generic `billing.bill_objects` table (not per-type tables)

A single billing-object node with a `kind` discriminator, rather than
separate `apartments` / `stalls` / `departments` tables. Multi-dwelling
units and company cost-centers are the same shape: *a thing that
accumulates charging cost and resolves to an owner*.

```prisma
model BillObject {
  id            String         @id @default(uuid()) @db.Uuid
  orgId         String         @map("org_id") @db.Uuid          // host org
  installationId String?       @map("installation_id") @db.Uuid // null for company-flat
  kind          BillObjectKind                                  // apartment | unit | stall | company | department | cost_center | other
  label         String                                          // "Apt 304", "N1", "Sales dept"
  parentId      String?        @map("parent_id") @db.Uuid       // self-FK for company hierarchy (dept under company)
  // owner of record — polymorphic, exactly one set (CHECK):
  ownerUserId   String?        @map("owner_user_id") @db.Uuid   // a person (kennitala-bearing)
  ownerOrgId    String?        @map("owner_org_id") @db.Uuid    // an org (HOA itself / landlord co / company)
  status        BillObjectStatus @default(active)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  @@index([orgId, installationId])
  @@schema("billing")
}
```

- **Owner is polymorphic, exactly-one** (`ownerUserId` XOR `ownerOrgId`,
  DB CHECK). Covers Alice-owns-her-flat (User), HOA-covers-a-rental (Org),
  landlord-company (Org).
- `parentId` self-FK supports company department/cost-center trees later
  without a new table; multi-dwelling units are flat (parent null).

### 2. Driver ↔ bill-object association (the attribution join)

Which unit a driver's charging rolls up to:

```prisma
model BillObjectMember {
  id            String   @id @default(uuid()) @db.Uuid
  billObjectId  String   @map("bill_object_id") @db.Uuid
  userId        String   @map("user_id") @db.Uuid     // the driver
  effectiveFrom DateTime @default(now())
  effectiveTo   DateTime?                              // history-preserving; null = current
  @@index([userId, effectiveTo])
  @@schema("billing")
}
```

- **N drivers → 1 bill-object** (Alice + Bob → Apt 304).
- A driver's *current* association is the row with `effectiveTo IS NULL`.
  Ownership/occupancy changes close the old row and open a new one — past
  sessions stay attributed to who paid *then* (see §4).
- **Dependent-child carve-out (ADR 0031 item 18):** a no-kennitala
  dependent User is a `BillObjectMember` of the apartment's bill-object
  whose `ownerUserId` has a kennitala. Charges aggregate to that owner. No
  special-case needed — the join already expresses it.

### 3. `bill_to` resolver

For a ChargeSession, resolve the invoice recipient:

```
session
  → driver (userId, via the Authorize/IdToken → DriverGroupMembership chain)
  → BillObjectMember active at session.startedAt          (§4 temporal)
  → BillObject
  → owner (ownerUserId XOR ownerOrgId)   ── the invoice recipient
```

- **Company-flat host:** one `BillObject{kind: company, installationId:
  null, ownerOrgId: host}`; every driver at the host is a member of it.
  `bill_to` = the company org. Department/cost-center reporting rides
  `parentId` later (ADR 0026: "employee-level cost allocation is reporting
  only" for pilot).
- **Unattributed fallback (open, §Open):** a session whose driver has **no
  active BillObjectMember** must not silently vanish from billing. Default
  proposal: attribute to a per-installation `kind: other` "Unattributed"
  bill-object owned by the host org, and flag it for operator resolution.

### 4. Temporal correctness — attribute to who paid *then*

`bill_to` resolves against the membership/ownership **as of
`session.startedAt`**, not "now." When Alice sells Apt 304 to Carol:
- close Alice's ownership / membership rows with `effectiveTo = sale date`,
- open Carol's,
- a session from before the sale still invoices Alice; after, Carol.

This is why both `BillObjectMember` and owner changes are
history-preserving rather than mut-in-place. (Owner-history table for
`BillObject.owner*` is deferred — §Open — but the principle is pinned.)

### 5. Relationship to access, agreements, and the access fee

- **Access stays separate.** DriverGroupMembership/Agreement decide *what a
  driver may charge at*; BillObject decides *who pays*. A driver charging
  at a host where they have access but no bill-object → unattributed (§3).
- **Tariff still resolves via the agreement chain** (ADR 0019/0031 Q1 open
  factor-code namespace). BillObject changes *recipient*, not *rate*.
- **Driver access fee (ADR 0031 Q2, P0.7):** when its mechanics are pinned,
  it attaches at this layer — either to the driver directly or to their
  bill-object owner. Not resolved here; the model leaves room for both.

## Consequences

### Enabled
- Single attribution spine for both multi-dwelling and company hosts.
- ADR 0031 item-18 dependents work with no special case.
- Correct historical invoicing across ownership/occupancy changes.
- Billing decoupled from access — a driver can move apartments (billing)
  without touching their charger access (DriverGroup), and vice-versa.

### Costs / risks
- **Two associations per driver** (access + billing) — onboarding must set
  both; UI/UX in P2/P3 must make the billing one explicit or it defaults to
  unattributed.
- **Polymorphic owner** needs a CHECK constraint + careful query joins.
- **Temporal resolution** makes the `bill_to` query non-trivial (as-of
  joins); needs test coverage on boundary dates.

### Schema implications (additive)
- New `billing.bill_objects`, `billing.bill_object_members` + enums
  `BillObjectKind`, `BillObjectStatus`.
- No change to `charging.sessions`; attribution is resolved, not stored
  (or optionally denormalized onto the session ledger at projection time —
  §Open).

## Open questions (resolve during P1, not blocking this ADR)
1. **Naming** — `bill_objects` vs `cost_objects` vs `billing_units`.
2. **Store vs resolve** — denormalize `bill_object_id` + `bill_to` onto
   `reports.session_ledger` at projection time (fast, immutable record of
   who-paid-then), or resolve live on invoice run? Leaning **denormalize at
   projection** for an immutable financial record.
3. **Owner-history table** — needed if owners change often; deferred unless
   P1 shows churn.
4. **Unattributed policy** — auto-create "Unattributed" bill-object + flag,
   vs block the session from billing entirely.
5. **Driver in two units** — can one driver be an active member of >1
   bill-object (e.g. owns a flat *and* rents a stall)? Default: **no**, one
   active billing home per host; revisit if a real case appears.
6. **Access fee attachment** (P0.7) — driver-level vs bill-object-level.

## Rejected alternatives
- **Per-type tables** (`apartments`, `stalls`, `departments`) — more
  schema, same shape; the `kind` discriminator is simpler and the company
  tree rides `parentId`.
- **Bill the driver directly** — contradicts ADR 0026 (per-household
  billing); breaks the multi-driver-per-unit and dependent-child cases.
- **Reuse DriverGroup as the billing unit** — conflates access and billing;
  a DriverGroup is about charger reach, not who-pays, and one group spans
  many units/owners.
