# 2026-08-03 — Prisma schema audit

Read-only structural audit of `prisma/schema.prisma` and the diverged
`apps/api/prisma/schema.prisma`, cross-referenced against actual query
shapes in `apps/api/src/repositories/**`. Nothing changed.

## F23 was overstated — amend ADR 0035

**The two schemas are semantically identical.** Normalised (comments
stripped, whitespace collapsed) and compared per-model field sets:

| | root | apps/api |
|---|---|---|
| Enums | 59 | 59 — identical, including value order |
| Models | 98 | 97 — 97 byte-identical field/attribute sets |
| Only model difference | `ArchiveWatermark` (root-only) | — |

All ~982 raw diff lines are **comments and field ordering**. And
`ArchiveWatermark`'s absence is not load-bearing: it is reached only via
raw SQL (`lib/db/archive-watermark.ts`), outside the ORM boundary per ADR
0018.

So F23's risk is **prospective, not present**. The fix is a CI
normalise-and-diff check, not the schema merge the finding implied.

## Findings, most severe first

**1. ADR 0031 §18's conditional-kennitala rule is entirely unenforced.**
Rule 5. `users.kennitala String? @unique` (`schema.prisma:58`) shipped
the nullable half; **`group_owner_user_id` does not exist** — zero grep
hits across `prisma/`, `apps/api/prisma/`, `apps/api/src/`. ADR 0031:584
explicitly calls for the FK. `DriverGroup.ownerUserId` is itself
nullable, so even a bound user can sit in an ownerless group. A
NULL-kennitala user with no binding is insertable and nobody owns their
invoice. **Exploitable now.** Fix: partial unique on `users(id) WHERE
kennitala IS NOT NULL`, then the FK.

**2. `charging.tap_intents` has zero foreign keys — and feeds
access-grant resolution.** Rule 5. `org_id`, `user_id`,
`charging_station_id`, `evse_id` are bare `@db.Uuid` with no `@relation`
and no FK in the migration. Unlike `protocol_log`, which carries a
6-line justification for its missing FK, **nothing explains this**.
Worse, `org_id` is written but never filtered on — the BLE resolver
(`tap-intents.ts:266`) keys on `(chargingStationId, consumedIdTag,
consumedAt)` only, so the column is decorative. A deleted user leaves
live intents that still authorise a charge.
**LATENT — the migration says "NOT YET APPLIED."** Cheapest high-value
fix in the audit: three FKs cost nothing today, a data-repair migration
tomorrow.

**3. `OcppIdentity` has no unique on `(vendor, vendorResourceId)`** —
yet four call sites treat it as canonical, with no `orderBy` and **no
`orgId` filter**: `webhooks/zaptec.ts:452` (its comment calls it "the
canonical path"), `internal/zaptec-state-event.ts:90`,
`zaptec-session-sync.ts:149`, `zaptec-charger-status-sync.ts:154`. Two
rows sharing a Zaptec UUID → state written to an arbitrary one,
silently, **cross-tenant**. No index on the pair either, so it is a
correctness *and* hot-path gap.

**4. `agreements.rate_references` has no non-overlap constraint, and its
two readers disagree.** Rule 5. `driver-pricing.ts:137` orders by
`effectiveFrom desc`; `billing-rate-references.ts:229` has **no
orderBy**, calls its result "the currently-active row", then auto-closes
it. Overlapping intervals → pricing picks the newest, admin closes
whichever Postgres returns by heap order. Tariff resolution and tariff
administration silently disagree.

**5. `ocpp-authorize.ts:277` — an arbitrary agreement pick decides who is
billed.** Rule 5. `findFirst`, no `orderBy`, and not an existence check:
it selects `driverGroup.agreementId` and counts clauses to decide
Accept/Block. A driver in two groups under two agreements gets an
arbitrary payer. **This exact bug class was already fixed in
`lib/agreement/persist.ts:155`** (orderBy + count warn, reasoning in its
test). The pattern exists and was not applied here.

**6. Financial tables carry user/recipient refs with no FK.**
`invoices.user_id` (NOT NULL, no relation), `billing_transactions.user_id`,
and `agreements.billing_lines.recipient_org_id / recipient_user_id /
rate_ref_id / rule_id` — the migration declares FKs for `agreement_id`
and `session_id` only. Money rows become unattributable with no
DB-level way to detect it. Rule 5 for `billing_lines`.

**7. `event_log` still cascades from Organization — and holds the
7-year financial rows.** We reasoned about exactly this for
`protocol_log` and applied it half-way: `protocol_log` omits the org FK
because *"cascading an org delete across every day partition of a
2M-rows/day table is the same heavy operation D1 exists to avoid"* — but
`event_log` is likewise daily-partitioned, still carries
`event_log_org_id_fkey`, and unlike `protocol_log` holds
`retention_class = financial` rows ADR 0018 requires kept 7 years for
Iceland VAT. Same shape for `charging.meter_values`. **Latent** — no
`organization.delete` call site exists. Fix: `RESTRICT` on the org edge
for `invoices`, `billing_lines`, `event_log`; make offboarding an
explicit archival routine.

**8. `charging_stations.org_id` is unindexed** while `chargers.ts:95`
filters on it with six includes — the multi-operator charger list. A
Postgres FK does not index the referencing side. Full scan on every
console load; at the 4k target this is the primary tenant query.
Performance only. Fix: `@@index([orgId, updatedAt desc])`.

**9. `DriverAccessRequest` has no partial unique on the pending state.**
Duplicate pending requests; approving one leaves the sibling pending
forever — invisible rather than resolved.

**10. Lower severity.** `zaptec-trigger-sync.ts:71` picks a vendor
credential with **no org filter at all** — the documented cross-tenant
design covers `credentialsRef`-direct reads, not a global "any active
credential" pick. ~48 free-text `status`/`kind` columns — checked, **no
competing enum exists**, so not drift; the risk is a typo'd value
silently never matching. `registration.ts:135` soft-delete-vs-unique
tension. Bare `membership.findFirst` in `driver.ts:176/212` means a
multi-org user's displayed org **can differ between the login and
profile responses**.

## Checked and sound — do not re-audit

- **Money is clean.** All 24 monetary columns are `BigInt` minor units;
  **zero `Float` in the schema**. `Decimal` only for quantities, rates,
  percentages, coordinates. *Doc gap: the convention is stated only in
  the schema header, not in ADR 0031, whose sole currency rule is "ISK
  only."*
- **Agreement CHECK constraints exist in the DB**, invisible to Prisma:
  typed-anchor consistency, scope/audience pairing, `bearer_ref` required
  for `trd`, `session_id` required for session-billable,
  `bill_objects_owner_at_most_one`. Do not re-flag as missing.
- `ChargeSession` tenant indexing correct, and its `chargingStation`
  relation defaults to `Restrict` — **deleting a charger cannot erase
  sessions**.
- `protocol_log`'s missing FK and `credentialsRef`'s free-form
  cross-tenant lookup are both deliberate and documented.
- `IdToken.value @unique` global across tenants — correct for an OCPP
  idTag. `VendorCredential` properly tenant-scoped.
- **All 41 models without `org_id` checked individually.** Each is scoped
  through a parent, documented global per ADR 0014, or uses a
  differently-named tenant column. **No new missing-scope finding**
  beyond TENANT_ISOLATION_AUDIT §D.
- `EnterpriseLicense`, `CapabilityProfile`, `ControlRoutingPolicy`,
  `ProtocolTransactionRef`, `ImportedCdrRef`, `MeterValue` have
  unindexed `org_id` **and that is fine** — none is filtered by orgId
  anywhere; each is reached by its own unique key.

## Rule 5 — do not "fix" casually

Findings **1, 2, 4, 5**, the `billing_lines` half of **6**, and the
billing-line cascade in **7** all touch billing math, tariff resolution
or access-grant resolution. Each needs stop-and-summarise before code.

## Recommended first action

**Finding 2.** `tap_intents` is unapplied, so adding its three FKs is
free today and a data-repair migration once it ships.
