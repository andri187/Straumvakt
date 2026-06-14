# ADR 0019 — Agreement + BearerRule Architecture

**Status:** Proposed
**Date:** 2026-05-07
**Sprint:** Sprint 9 — design lands now; schema in milestone A.2; resolver + debug UI across A.5–A.6.
**Supersedes (in scope):** the contract-resolution half of [ADR 0008](./0008-cost-center-splitting.md). The cost-factor catalog (DSOF/REPF/USRF/USRF_PREM/XTRRF/SPVIVF/CHRGRF/WRKPF) is itself superseded — the operator's revised catalog (DSO/ELE/ACS/PRM/TRF/SRF/RNT/MTR) lands as part of A.2 seed.
**Relates to:** [ADR 0007](./0007-circuit-asset-tier-back.md) (Circuit tier), [ADR 0008](./0008-cost-center-splitting.md) (legacy contract model — kept additive, not removed by this ADR), [ADR 0014](./0014-identity-tenancy-and-authorization.md) (driver identity model — drivers are admin-created only).
**Supporting material:** [`docs/architecture/contract-architecture-v2.svg`](../architecture/contract-architecture-v2.svg).
**Rollback anchor:** `dev/sprint-08-tariff-and-billing` HEAD (state immediately before this ADR).

---

## Context

ADR 0008 introduced inherited `Contract` rows scoped per asset tier
(`org → site → installation → circuit → charger`) with `parent_contract_id`
self-references and a `ContractFactorAssignment` junction table. The model
is sound on paper but two pilot-shaped frictions surfaced once we tried to
encode Dalvegur:

1. **A "contract row per scope" mental model fights the operator's mental
   model.** Operators don't think in terms of *"create a Contract row at
   the Site tier with parent → org Contract"*. They think *"this driver
   group covers ELE for its members, everywhere except Charger 7 where
   it doesn't."* The diff is what's stored in their head; the storage
   model should reflect that.

2. **Two orthogonal axes — scope and audience — were collapsed into one
   tree.** ADR 0008 placed contracts on the asset tree; driver-side
   variation was relegated to `DriverContract` + `DriverContractFactorOverride`.
   But a workplace's terms naturally vary along *both* dimensions —
   "Sjóvá staff at Circuit C2" is a single intuitive concept that ADR
   0008 expressed only as the cross-product of two separate rows.

Concurrently, the Dalvegur conversation surfaced four constraints the
ADR 0008 model did not cleanly handle:

3. **Lazy materialization.** A driver group whose terms match the parent
   agreement should not require a row. ADR 0008 required an explicit
   Contract per scope tier even when terms were unchanged.

4. **Field-level copy-on-write.** When the parent agreement updates a
   default bearer or rate, child overrides should *cascade through*
   un-overridden fields and *stick* on overridden ones. ADR 0008 stored
   `ContractFactorAssignment` rows wholesale — modifying the parent
   forced touching every child or losing the cascade.

5. **Allocation richness.** Cost bearing is not binary. An organisation
   may pay 100% / 50% / 0% of a factor, and may add a markup on top
   that becomes CPO revenue. ADR 0008's `allocation_rule` field was
   never specified beyond a string enum — pricing-side and bearer-side
   logic ran together.

6. **Rate-reference indirection.** DSO and electricity prices change
   quarterly. ADR 0008 had no notion of a versioned rate book —
   updating a price required walking every Contract row's
   TariffDefinition pointer.

This ADR re-bases contract storage and resolution on three primitives:
**Agreement**, **BearerRule**, **RateReference**. The legacy `Contract`
/ `DriverContract` / `ContractFactorAssignment` tables remain
untouched for now (see "Coexistence" below).

## Decision

Land a new contract architecture in the `agreements` schema namespace,
additive against the existing `billing.contracts*` tables. The new
model is a clean break in semantics; coexistence is a transitional
concession until session-stop migrates and the legacy tables can be
retired in a follow-up ADR.

### Three primitives

| Primitive | What it is | Cardinality |
|---|---|---|
| **Agreement** | The legal contract between Straumvakt and a counterparty ORG (CPO or workplace). Enlists which cost factors apply to this counterparty, with a default bearer + default allocation per factor. | One per (Straumvakt, counterparty_org, effective_period). |
| **BearerRule** | A *diff* against the agreement defaults at the intersection of a scope (Site / Installation / Circuit / Charger) and an audience (DriverGroup / User). Each overridable field is independently nullable — `NULL` means inherit from the next walk step. | Zero or many per Agreement. The empty set is legal. |
| **RateReference** | A versioned rate book entry. Carries (code, factor_id, supplier_org_id, price_per_*, effective_from, effective_until). Rules and Agreement defaults reference rates by **code** (stable identifier), not by row id. | Many per code over time. New supplier rates land as new rows; resolver picks the version active at session_time. |

### Two orthogonal override axes

```
SCOPE       Site → Installation → Circuit → Charger        (5 levels incl. null)
AUDIENCE    All  → DriverGroup  → Driver                   (3 levels)
```

A `BearerRule` row exists at one cell of the (scope × audience) grid.
The grid is a *render conceit* — there is no physical 5×3 = 15-row
allocation per agreement; only the cells operators actually need carry
rows.

### Resolution algorithm (session-stop, per enlisted factor F)

```
inputs: User U, ChargingStation C, time T
walk:   audience precedence  (Driver → DriverGroup → All)
        × scope precedence   (Charger → Circuit → Installation → Site → null)
        = 13-step ladder ending at Agreement default

for each attribute (bearer_type, bearer_ref, rate_ref_code, allocation_json):
    take the first non-null value found while walking the ladder

resolve the rate via RateReference where (code = rate_ref_code AND effective_from ≤ T < effective_until)
compute raw amount via Allocation.passthrough.splits + Allocation.markup
emit one billing_line per (factor, kind∈{passthrough, markup}) with bearer + recipient
```

Per-attribute walking (rather than per-rule) is the load-bearing
choice. It's what makes parent changes cascade through un-overridden
fields without rule rewrites.

### Allocation primitive (stored as JSONB on each rule and on agreement defaults)

```jsonc
{
  "passthrough": {
    "splits": [
      { "bearer_type": "USR", "share_pct": 100 },
      { "bearer_type": "ORG", "share_pct": 0 },
      { "bearer_type": "WRK", "share_pct": 0 },
      { "bearer_type": "TRD", "share_pct": 0, "bearer_ref": "<user_id>" }
    ]
  },
  "markup": null | {
    "basis": "percent" | "fixed_per_kwh" | "fixed_per_minute" | "fixed_per_session",
    "value": <decimal>,
    "payer_type":     "USR" | "ORG" | "WRK" | "TRD",
    "recipient_type": "ORG" | "WRK" | "<user_id-bearing>"
  }
}
```

JSONB is deliberate. The allocation shape is still settling; locking
into normalised `bearer_rule_splits` + `bearer_rule_markup` tables now
would make iteration painful. We normalise once the shape is
empirically stable (post-A.6).

### Cost-factor catalog (revised — supersedes ADR 0008's enum)

| Code | Icelandic | English | Default bearer in CPO Agreement |
|---|---|---|---|
| **DSO** | Dreifing | DSO grid fee | USR |
| **ELE** | Rafmagn | Retailer energy price | USR |
| **ACS** | Notendagjald | User access fee | USR |
| **PRM** | Premium | Premium user access fee | USR |
| **TRF** | Tímagjald | Extra tariffs (idle, surge) | ORG |
| **SRF** | Þjónustugjald | Service / installer / vendor fee | ORG |
| **RNT** | Leiga | Charger rental fee | ORG |
| **MTR** | Mælagjald | E-meter daily fee | ORG |

Defaults are illustrative; per-Agreement enlistment can pick any
default. ACS / PRM are typically `enlisted = false` in pilot
agreements (ADR 0006 deferred user access fees).

### Bearer types

| Code | Icelandic | Resolves to |
|---|---|---|
| **ORG** | Kerfiseigandi | Counterparty ORG of the parent Agreement (the CPO). |
| **USR** | Notandi | The driver (User) running the session. |
| **WRK** | Vinnan | The DriverGroup's `owner_org_id` (workplace). Stored once on the group, not on each rule. |
| **TRD** | Þriðji aðili | A specific other User, identified by `bearer_ref` on the rule (mom-pays-for-child case). |

### Effective dating

Every primitive carries `effective_from` (required) and `effective_until`
(nullable = open-ended). The resolver always passes the session's
`stopped_at` timestamp through to rate and rule lookups. Past sessions
resolve against historical rules; future agreements may be staged in
advance and activate on the date.

### Coexistence with ADR 0008 tables

No drops, no renames, no FKs into the legacy schema:

- `billing.contracts`, `billing.driver_contracts`,
  `billing.contract_factor_assignments`,
  `billing.driver_contract_factor_overrides`,
  `billing.contract_period_accumulators`,
  `billing.tariff_definitions`, `billing.cost_factors` — all stay,
  untouched, queryable via the existing `apps/api/src/lib/tariff/*`
  resolver.
- New tables live in the `agreements` Postgres schema and are
  unreferenced by the legacy resolver.
- The session-stop integration (separate sprint, separate ADR) decides
  the cutover. Until that point, the new model is exercised only via
  the `/agreements/_debug` admin page (milestone A.6).

The legacy `cost_factors` rows (`DSOF`, `REPF`, etc.) are not deleted;
the new model uses *its own* `agreements.cost_factors` table seeded
with the revised codes (`DSO`, `ELE`, etc.). Two coexisting catalogs
during transition is uncomfortable but contained.

## Implementation milestones

| # | Scope | Notes |
|---|---|---|
| **A.1** | This ADR | (here) |
| **A.2** | Prisma schema additions in `agreements.*` namespace: `Agreement`, `AgreementClause`, `BearerRule`, `RateReference`, `BillingLine`, `agreements.cost_factors`. JSONB `allocation_json` on AgreementClause + BearerRule. Effective-from/until on all four primitives. Indexes on (agreement_id, factor_id), (rule walk lookup), (rate code + effective_from). |
| **A.3** | Migration SQL + `prisma generate` (UI + API) + `npx tsc --noEmit` clean. |
| **A.4** | Seed for Dalvegur: Agreement (Straumvakt ↔ Dalvegur Eignir), three DriverGroups (Sjóvá / Klettás / Daltækni), eight cost-factor rows in `agreements.cost_factors`, two RateReferences (Veitur DSO + retailer ELE for Q2 2026), a handful of BearerRule diffs covering the four allocation scenarios. |
| **A.5** | Pure resolver: `resolveBearersForSession({ user, charger, time }) → BillingLineDraft[]` in `apps/api/src/lib/agreement/`. No I/O — takes already-loaded entities. Unit tests cover (a) full absorb / forward / partial / markup, (b) parent cascade through `NULL`, (c) sticky child override, (d) RateReference versioning. |
| **A.6** | Read-only admin page `/agreements/_debug` — pick (driver, charger, time), see resolved billing_lines + which rule won each attribute. Internal validation tool only; not part of the operator UI. |

After A.6 the model is operationally validated against Dalvegur
without touching session-stop or the legacy resolver. Cutover is a
separate ADR.

## Consequences

### Positive

- **Storage matches the operator mental model.** A new tenant's
  contract is "agreement + 0–N diffs" — not "create N contract rows
  per scope tier."
- **Parent edits don't churn children.** Updating an Agreement default
  cascades through every rule that left the field `NULL`. ADR 0008
  required walking every `Contract` row.
- **Rate updates are O(1).** New supplier rate = one `INSERT` into
  `agreements.rate_references`. Every rule and default referencing
  the code picks it up at the next session.
- **Pricing and bearing are separable.** Allocation answers *who pays*
  and *how much*; RateReference answers *cost basis*. They compose.
- **Auditability.** Every billing_line carries `rule_id` (the rule
  that won at session-stop). Replays against historical rules are
  correct because of effective-dating.
- **Tenancy stays clean.** Each Agreement is scoped to one
  counterparty ORG; multi-tenant queries filter by the same `org_id`
  used everywhere else.

### Negative

- **Two coexisting models for the duration of transition.** The
  legacy resolver still services `/api/admin/billing/sessions` reads
  until cutover. Operators see one source of truth, but engineers see
  two during the gap.
- **Cost-factor enum diverges briefly.** `agreements.cost_factors`
  carries `DSO/ELE/...` while `billing.cost_factors` still carries
  `DSOF/REPF/...`. Code that bridges the two (none yet) must be
  explicit about which catalog it's reading.
- **JSONB allocation is not queryable as cleanly as a normalised
  table.** Reports like "list every contract where Sjóvá covers
  ≥50% of ELE" require a JSONB filter rather than a plain join. We
  accept this for the iteration window.
- **Per-attribute walk has 13 lookup steps in the worst case.** With
  proper indexing on (agreement_id, audience_type, audience_id,
  scope_type, scope_id, factor_id) the resolver is ~10–15ms; without
  indexes it's much worse. A.2 commits the indexes explicitly.

### Neutral / deferred

- **Session-stop integration is a separate ADR.** Cutting over from
  the legacy resolver to the new one needs evidence from A.6 first.
- **Invoicing rollup (billing_lines → invoice) is not in scope here.**
  ADR 0005 tag E (post-pilot) still owns invoice generation. This ADR
  ends at `BillingLine` rows.
- **OCPI tariff translation** (CDR export) maps to `BillingLine`
  rows the same way it would have mapped to ADR 0008's
  `ContractFactorAssignment`. No change.

## Open questions

1. **Should the resolver short-circuit on the first rule that fully
   specifies all attributes, or always walk the full ladder?** Walking
   the full ladder is simpler and the cost is ≤13 indexed lookups.
   A.5 implements full-walk; revisit only if profiling demands.

2. **How are mid-session agreement changes handled?** The session
   uses the rules effective at `started_at`, OR walks the rules
   active at each meter-value tick? Current intent: `stopped_at`
   wins for the whole session. If an agreement changes mid-session,
   the new terms apply to the next session. Document in A.5 tests.

3. **Can a single `BearerRule` cover multiple factors via `factor_id =
   NULL`?** No. One rule per factor, for auditability. UI may offer
   "apply to all enlisted factors" as a convenience that fans out
   into per-factor rows.

These are revisited at the cutover ADR after A.6 evidence lands.

---

## Addendum 2026-05-08 — five-agreement rethink (supersedes 2026-05-07 addendum)

Filed the day after the original ADR + first addendum, after a deeper
walk-through that surfaced the conflation of "Straumvakt's revenue from
the CPO" with "the CPO's installation operating costs." This addendum
**supersedes** the 2026-05-07 addendum below — the original addendum's
content is preserved verbatim afterwards for archaeological clarity, but
**the model that's authoritative as of 2026-05-08 is this one**.

The original implementation (commits 4157952 → 7fb3786, branch
`feat/agreement-architecture`) reflects the superseded model. A
consolidated revised migration replaces the two `agreements_v1` /
`agreements_cpo_org_id_and_str_factor` migrations before any rows land
anywhere. See `docs/architecture/agreement-schema-plan.md` for the
migration shape.

### Why the rethink

The 2026-05-07 model had a single `agreement_type=cpo` that mixed:

- Straumvakt's commercial revenue from the CPO (e.g. STR platform fee), and
- The CPO's operational costs at each installation (DSO, ELE, etc.).

Those are decided by completely different parties, on different
cadences, with different counterparties. Putting them on one row means
the operator UI for "edit your CPO agreement" has to cover both, which
doesn't match how either side of the business is run. Splitting them
fixes the conceptual problem and matches how the operator actually
authors contracts.

### Five agreement types (was two)

| Type | Parties | Anchored to | Holds |
|---|---|---|---|
| **service_cpo** | Straumvakt ↔ CPO | CPO ORG | Straumvakt's per-CPO revenue (INT, USRF, CNR, RVN, PRM). |
| **service_contractor** | Straumvakt ↔ Contractor | Contractor ORG | Straumvakt's per-contractor revenue (AGN, RVN). |
| **service_workplace** | Straumvakt ↔ Workplace ORG | Workplace ORG | Straumvakt's per-workplace revenue (WRK). |
| **installation** | CPO ↔ themselves | An Installation row | Operational cost factors (DSO, ELE, MTR, RNT, TRF + IDL/NET in MDU). |
| **workplace** | CPO ↔ Workplace, mediated by Straumvakt | An Installation (or set thereof) | No new factors — only `BearerRule` overrides on installation factors that the workplace absorbs. |

A workplace covering employees at multiple CPOs has **one**
`service_workplace` agreement (with Straumvakt) and **N** `workplace`
agreements (one per CPO). A contractor providing service across
multiple CPOs likewise has one `service_contractor`.

### Cost-factor catalog (15 factors — supersedes the 9-factor catalog)

Drop ACS (replaced by USRF on the commercial side) and STR
(decomposed into INT/USRF/CNR/RVN/PRM by counterparty fee model).

| Code | Icelandic | English | Lives on | Default bearer | Recipient |
|---|---|---|---|---|---|
| **INT** | Hleðslukerfagjald | Price per installation | service_cpo | ORG (CPO) | Straumvakt |
| **USRF** | Notendagjald | Per-user-on-installation | service_cpo | ORG (CPO) — CPO can forward | Straumvakt |
| **CNR** | Tenglagjald | Per-connector | service_cpo | ORG (CPO) | Straumvakt |
| **RVN** | Veltutengd gjöld | % of kWh charges | service_cpo + service_contractor | ORG | Straumvakt |
| **PRM** | Premium | Premium user fee (opt-in) | service_cpo | ORG (CPO) or USR | Straumvakt |
| **AGN** | Per Contractor Agent access | Per-agent | service_contractor | ORG (Contractor) | Straumvakt |
| **WRK** | Vinnan | Workplace service fee | service_workplace | ORG (Workplace) | Straumvakt |
| **DSO** | Dreifing | DSO grid fee | installation | USR | DSO supplier |
| **ELE** | Rafmagn | Retailer energy | installation | USR | Retailer |
| **MTR** | Mælagjald | E-meter daily fee | installation | ORG (CPO) — CPO can split | DSO supplier |
| **RNT** | Leiga | Charger rental | installation | ORG (CPO) | Hardware owner |
| **TRF** | Álag | Idle / extra tariff | installation | USR | CPO |
| **IDL** | Idlepower | Idle power loss | installation (MDU only) | ORG (CPO) — CPO can split | CPO |
| **NET** | Internet | Internet / SIM cost | installation (MDU only) | ORG (CPO) — CPO can split | CPO |
| **SRF** | Þjónustugjald | Service line item | issues engine (deferred) | ORG (CPO) | Contractor |

### Eleven locked decisions

1. **Five-value `agreement_type` enum.** `service_cpo · service_contractor · service_workplace · installation · workplace`.
2. **WRK basis** = 75 ISK per workplace-covered driver per month, **once per service_workplace agreement** (not duplicated per CPO the workplace covers them at).
3. **ORG bearer guardrail.** `bearer_ref` must point at an ORG with at least one active `service_*` agreement. Enforced in the rule-authoring API (Zod), not in DB. `bearer_ref = NULL` defaults to the agreement's `counterparty_org_id`.
4. **TRD bearer scope.** User-only · MDU-only · the named user must already have an active `DriverGroupMembership` covering this installation at billing time. **Fail closed** if invalid — never silent fallback to USR.
5. **RVN base** = `pct × kWh × (ELE_rate + DSO_rate)`. Excludes platform / service / fixed / penalty fees. Internal name: `kwh_charges`.
6. **`installation_type` is required and load-bearing.** Values: `workplace · mdu · public · private · mixed`. Gates: factor enlistment (IDL/NET MDU-only), audience flavors, TRD applicability, public access semantics.
7. **PRM lives on `service_cpo`.** Straumvakt revenue. CPO chooses absorb or forward to drivers. Future "premium features" are feature flags, not billing.
8. **`billing_lines` future-proofed for non-session events.** `session_id` becomes nullable; new `billable_event_type` discriminator (values now: `session`; later: `service_invoice`, `subscription`, `manual_adjustment`).
9. **Keep `agreement_type` as a single 5-value enum** for now. Don't decompose into kind+role until filtering by kind gets painful.
10. **Public access requires an explicit Direct Customers DriverGroup** under the installation contract. `installation_type = public` requires a default group set on the installation. No implicit anonymous default — matches the "explicit memberships only" rule from the original ADR.
11. **`RateReference` is enough now; `RateTable` is a deferred follow-up.** No schema burden today. Add `rate_table_id` later if/when a CPO subscribes to a published bundle.

### Schema-shape implications (for the consolidated migration)

The consolidated migration replaces both `agreements_v1` and
`agreements_cpo_org_id_and_str_factor`. Key changes from those:

- `AgreementType` enum: `cpo, workplace` → `service_cpo, service_contractor, service_workplace, installation, workplace`.
- `Agreement.installation_id` (nullable, FK → `assets.installations`) — required for `installation` type.
- `Agreement.cpo_org_id` (kept) — required for `workplace` type.
- `Agreement` CHECK constraint covers all five typed-anchor combinations.
- `assets.installations.installation_type` enum + column. Default: `workplace`.
- `agreements.cost_factors` re-seeded with the 15-factor catalog (no rows currently exist; safe to re-create).
- `agreements.billing_lines.session_id` becomes nullable.
- `agreements.billing_lines.billable_event_type` (text, NOT NULL, default `session`).
- `installation_type = 'public'` requires a `default_driver_group_id` at the installation contract — enforced by Zod / app, not DB CHECK (would require a circular FK).

### What carries over from 2026-05-07 unchanged

- "Drivers gain access via explicit memberships only" — same rule, just clarified at the installation level instead of the CPO level.
- "Operational data is admin-created" — still true. Seed only loads the 15-factor catalog.
- The resolver's per-attribute walk semantics — same code, same tests. The only thing that changes is which agreements the route handler aggregates clauses + rules from (now up to four agreement rows: service_cpo + installation + workplace + service_workplace).

---

## Addendum 2026-05-07 — `cpo_org_id`, STR factor, admin-only operational data  (SUPERSEDED)

Filed the same day as the original ADR after the operator walked through
the Krónan / N1 scenarios and pruned the model. Three narrowing changes.

### Drivers gain access via explicit memberships only

There is no implicit "audience-null clause = anyone can charge" grant.
A charging session resolves only when the driver is a member of a
`DriverGroup` whose Agreement covers the charger's CPO. The route
handler's session-context builder denies access before the resolver
runs if no membership matches.

This collapses resolution to two concepts (no separate "L3 driver
policy" tier):

- The **Agreement** (`agreement_type=cpo` or `workplace`) — sets which
  factors apply, default bearer per factor, default rate references.
- **Driver memberships** in groups under that Agreement — the access
  grant. Direct customers of a CPO go in a group under the CPO
  Agreement; workplace employees go in a group under the workplace
  Agreement. A driver may hold both kinds of membership at once.

Per-driver overrides (the case ADR drafts called "L3") are just
`BearerRule` rows with `audience=user`. No separate primitive.

### Schema delta — `Agreement.cpo_org_id`

Workplace agreements name which CPO ORG they bind at via a new
nullable column with a CHECK pairing it to `agreement_type`:

| `agreement_type` | `cpo_org_id` |
|---|---|
| `cpo` | NULL — the counterparty IS the CPO |
| `workplace` | NOT NULL — names the CPO this workplace deal binds at |

Migration `20260507190000_agreements_cpo_org_id_and_str_factor` —
additive on top of `agreements_v1`; safe to apply because no rows
exist yet.

The session-context builder uses this column directly to find the
applicable workplace agreements for a session, no JSONB inspection
required.

### New cost factor — STR (Straumvaktargjald)

The original eight-factor catalog had no factor that pays Straumvakt
itself. Added as the 9th catalog row in `agreements.cost_factors`. STR's
**recipient is structurally pinned to Straumvakt's own ORG row** via
the `RateReference.supplier_org_id`. No new bearer type required.

Default bearer depends on agreement type the operator authors:

- On a CPO agreement: `ORG` (the CPO covers the platform fee out of
  revenue) or `USR` if the CPO opts to surface it to the driver.
- On a workplace agreement: `WRK` (workplace pays the per-session
  mediation fee).

Default basis at pilot is `per_session`. Per-kWh stays supported via
a different RateReference code under the same factor.

### Per-driver overrides cannot reduce a workplace's commitment

A `BearerRule` whose audience is more specific than the workplace
group cannot leave the workplace bearing less than the agreement's
audience-null clause already commits. The dial only goes one way: the
workplace can absorb MORE for a specific driver, never LESS.

Operator-side discipline — enforced by Zod validation in the
rule-authoring API. Not enforced in the DB. The resolver doesn't need
to know.

### Operational data is admin-created

Agreements, DriverGroups, DriverGroupMemberships, BearerRules, and
RateReferences are all created through admin UI / API. The seed
populates **only the cost factor catalog** (`agreements.cost_factors`,
nine rows) — that's the only universal reference data. No
tenant-specific or pilot-specific bootstrap script ships in the
repository; the operator builds those rows manually.

### What this addendum does NOT change

- The resolver in `apps/api/src/lib/agreement/resolve.ts` is unchanged.
  STR walks the same ladder as every other factor; recipient pinning
  happens via `RateReference.supplier_org_id`.
- The `BearerRule` table is unchanged.
- The `AgreementBillingLine.agreement_id` convention from the original
  open-question list (always = CPO Agreement; workplace contribution
  recoverable via `rule_id`) stands.

---

## Addendum 2026-05-09 — pilot-scope narrowing (operator UI shape)

Filed after the operator walked through the 5-agreement / 15-factor model
again and asked to "dumb down" what the operator-facing surface looks like
for the pilot. **This addendum does not supersede the 2026-05-08 model
for the schema** — the 5-type, JSONB-allocation, BearerRule-grid model
remains authoritative on disk. It narrows what the **operator UI**
exposes, what the **seed** contains, and what factor codes are in scope
for pilot agreements.

The schema is deliberately more general than the pilot needs. Hiding
unused capability from the operator costs nothing and reactivating any
of it later (contractor agreements, workplace mediation, MDU IDL/NET) is
a UI change, not a migration.

### Pilot transport scope — OCPP 1.6 only

Straumvakt is transport-agnostic in principle (Native vendor portal /
Webhooks vendor callback / OCPP-as-CSMS), but the pilot operates **only
the OCPP 1.6 path**. Concretely:

- **In scope:** Dalvegur and follow-on installs configured for OCPP 1.6
  with Straumvakt as the CSMS. Real-time auth via `Authorize.req`.
- **Out of scope (this addendum):**
  - Native-mode installs (vendor portal owns auth; Straumvakt observes
    via API CDR import + bus enrichment) — no Native-customer in pilot.
  - Webhooks-mode installs — no vendor-webhook customer in pilot.
  - OCPP 2.0.1 — not deployed; `GroupIdToken`, expanded
    `AuthorizationStatus` values (`NoCredit / NotAtThisLocation /
    NotAtThisTime`) are aspirational, not in scope.
  - OCPI 2.2.x roaming — no roaming counterparty; Token / Location /
    Session / CDR / Tariff endpoints not implemented.

Recommendations in this addendum are sized for OCPP 1.6 + single
transport. Wider transport-agnostic abstractions (a shared
`canDriverChargeHere(...)` primitive callable from multiple invocation
points; a `Decision` type that translates to per-transport response
shapes) are deferred until the second transport actually lands. Wiring
the membership check directly into the existing `resolveAuthorize()`
handler is the right size for now.

### Two agreement types in operator UI scope

Out of the five enum values, only two are exposed to the operator for
pilot:

| Type | Parties | Anchor |
|---|---|---|
| `service_cpo` | Straumvakt ↔ Org (the CPO) | counterparty Org |
| `installation` | CPO ↔ Drivers | Installation |

`service_contractor`, `service_workplace`, and `workplace` remain in the
DB enum but are filtered out of the operator UI's agreement-type picker
and not constructable through the authoring API. Documented as
"deferred — reactivate when the first contractor / workplace tenant
lands."

### Factor codes in operator UI scope

Out of the 15 factor codes, only six are user-editable in pilot
agreements. The operator never sees the codes — UI labels read in
operator-friendly terms:

| Operator label | Factor | Bearer | Notes |
|---|---|---|---|
| Driver fee (75 ISK / driver / month) | `USRF` | toggle: `org` or `usr` | Org always remits to Straumvakt; toggle decides whether org recovers from drivers in its own statement. |
| Installation fee (1190 ISK / install / month) | `INT` | `org` always | No toggle. |
| DSO per kWh | `DSO` | toggle: `org` or `usr` | From rate reference. |
| E-meter daily fee | `MTR` | `org` always | No toggle. Iceland DSOs charge a daily standing fee for the meter. |
| Retailer per kWh | `ELE` | toggle: `org` or `usr` | From rate reference. |
| Charge-time fee (ISK/min while charging) | `TRF_CHG` (NEW) | `usr` always | Optional. Org-defined surcharge. |
| Idle-time fee (ISK/min plugged but not drawing) | `TRF_IDLE` (NEW) | `usr` always | Optional. Doubles as the SOC-cap proxy — once a car stops drawing, the idle clock starts. |

`CNR`, `RVN`, `PRM`, `AGN`, `WRK`, `RNT`, `IDL`, `NET`, `SRF` and the
generic `TRF` umbrella stay in the catalog but are not surfaced as
clauses in pilot agreement forms.

### Catalog change — split `TRF` into `TRF_CHG` and `TRF_IDLE`

`TRF` (Álag — generic surcharge bucket) is replaced for clause use by
two narrower factors. The original `TRF` row stays in the catalog
(unused, status remains `active` for backward-compat — no clauses
reference it). Future surcharge variants (`TRF_PEAK`, `TRF_WKND`, etc.)
land as additional factor rows, not as JSONB sub-fields.

Seed delta on `prisma/seed.ts`:

```ts
{ code: "TRF_CHG",  displayNameIs: "Hleðslutímagjald", displayNameEn: "Charge-time fee",
  description: "Per-minute fee while the car is actively drawing power. CPO-set." },
{ code: "TRF_IDLE", displayNameIs: "Biðtímagjald",    displayNameEn: "Idle-time fee",
  description: "Per-minute fee while the car is plugged in but not drawing. CPO-set. Doubles as the SOC-cap proxy." },
```

Existing `TRF` row left in place; no migration required.

### Bearer is a bool in the operator UI

Each user-editable clause exposes a single `driver_pays: bool` toggle
(or no toggle at all when the bearer is fixed). The UI serialises that
to the existing `allocation_json` shape:

```jsonc
// driver_pays = true
{ "passthrough": { "splits": [ { "bearer_type": "USR", "share_pct": 100 } ] }, "markup": null }

// driver_pays = false
{ "passthrough": { "splits": [ { "bearer_type": "ORG", "share_pct": 100 } ] }, "markup": null }
```

Multi-bearer splits and markup are not exposed in pilot UI but remain
expressible in the schema for future operators.

### Rate-reference scope for pilot

Pilot uses `rate_references` with `effective_from` / `effective_until`
only. Rates are flat per the entire effective window. The operator
flagged that some Iceland tariffs have time-of-day or seasonal
variation, but no in-scope tariff currently does — deferred.

Planned extension shape — **match OCPI 2.2.1 `TariffRestrictions`
verbatim** so that future OCPI export is a direct shape map, not a
translation step:

```sql
ALTER TABLE "agreements"."rate_references"
  ADD COLUMN "pattern_json" JSONB;
-- shape mirrors OCPI 2.2.1 TariffRestrictions:
--   start_time     "HH:MM" (local)
--   end_time       "HH:MM" (local)
--   start_date     "YYYY-MM-DD"
--   end_date       "YYYY-MM-DD"
--   day_of_week    ("MONDAY" | "TUESDAY" | ... | "SUNDAY")[]
--   min_kwh        number
--   max_kwh        number
--   min_power      number (kW)
--   max_power      number
--   min_duration   number (seconds)
--   max_duration   number
--   reservation    "RESERVATION" | "RESERVATION_EXPIRES"
```

Resolver picks the rate where `effective_from ≤ T < effective_until`
**and** `pattern_json` is `NULL` or matches `T`. Adding the column
later does not break any existing row. Choosing the OCPI shape now
costs nothing and saves a migration when the first roaming tenant
lands.

### Access — explicit memberships only (unchanged from earlier addendums)

No public / walk-up access in pilot. The `default_driver_group_id`
column on `agreements.agreements` remains in the schema but is not
exposed in the operator UI for pilot installations. Driver onboarding
flow (email request / QR scan / access request) is a separate sprint.

### Locked decisions (this addendum)

1. **Org is always Straumvakt's counterparty.** When the operator
   chooses "driver pays the 75 kr," Straumvakt still invoices the org
   for `N × 75`. The org recovers from drivers in its own monthly
   statement — Straumvakt has no direct billing relationship with
   drivers.
2. **MTR (e-meter daily fee) is always org-paid.** No toggle. Iceland
   DSOs charge a daily standing fee for the meter; pilot operators
   absorb it.
3. **No SOC-based fee.** Idle-time fee (`TRF_IDLE`) is the SOC-cap
   proxy. If the car/charger reports SOC, that's nice-to-have telemetry
   on session detail; it does not feed billing.
4. **No public/walk-up.** Access via approved memberships only. The
   onboarding flow itself (email/QR/request) is out of scope here.

### Implementation milestones (this addendum)

| # | Scope | Notes |
|---|---|---|
| **A.7** | Seed update — add `TRF_CHG` and `TRF_IDLE` rows. | One PR. No schema change. |
| **A.8** | Operator UI: agreement list + edit forms for `service_cpo` and `installation` only. Hidden enum values filtered at the route level. | Builds on `/agreements/debug` (A.6). |
| **A.9** | Authoring API + Zod validation: clause writes serialise the `driver_pays` bool to `allocation_json`. Reject `service_contractor` / `service_workplace` / `workplace` types until reactivated. | Same handler used by the UI. |
| **A.10** | Seed Dalvegur as a real `service_cpo` + `installation` agreement pair. Smoke-test by replaying past sessions through the resolver and comparing against legacy `billing.contracts` totals. | Pilot validation. |
| **A.11** | Membership check at OCPP Authorize. Inside `resolveAuthorize()` ([apps/api/src/routes/internal/ocpp-authorize.ts](../../apps/api/src/routes/internal/ocpp-authorize.ts)), after the existing token-status checks, look up `DriverGroupMembership` for `(token.userId, driverGroup.agreement.installation_id = chargerInstallationId)`. Missing → return `Blocked` with internal `reason: "no_contract"`. OCPP 1.6 has no richer status — `Blocked` is the wire-level answer. The richer reason is for our logs / debug page. Gated by per-installation `enforceAuthorize` — same shadow-mode safety as the existing token checks. New `AuthorizeReason` value: `no_contract`. | Closes the gap between Gate 1 (Authorize) and Gate 2 (billing-time membership check in `persist.ts`). One additional indexed query per Authorize. |

After A.11 the cutover ADR (separate filing) decides when session-stop
moves from the legacy resolver to the new one. A.11 is independent of
cutover — it can ship alongside A.10 without legacy interference.

---

## Addendum 2026-05-31 — Pilot-scope flag pattern (Phase 1 CRUD)

Filed during Sprint 9 Phase 1, when authoring CRUD landed for cost
factors, tariff definitions, and rate references. The pilot scope (two
agreement types, eight factor codes, two compute-rule kinds) is now
explicit code rather than implicit convention.

### The pattern

`apps/api/src/lib/billing/pilot-scope.ts` is the single file that
defines the set of values permitted at authoring time during the pilot:

```
PILOT_AGREEMENT_TYPES   — ["service_cpo", "installation"]
PILOT_FACTOR_CODES      — ["USRF","INT","DSO","MTR","ELE","TRF_CHG","TRF_IDLE","TRF_PLUG"]
PILOT_COMPUTE_RULE_KINDS — ["flat_per_kwh","flat_per_session"]
```

Each constant carries a `// TODO: when extending past pilot, add: ...`
comment naming the deferred values. Every authoring endpoint that
enforces pilot scope imports from this file — grep `pilot-scope` to find
all gates.

`TRF_PLUG` (per-minute fee while plugged in, regardless of activity,
with optional grace period) is added to the pilot factor list here;
the catalog seed row lands when the first agreement clause needs it
(Phase 4 resolver work).

### Where to flip each gate when extending

| Gate | File | Action |
|---|---|---|
| Agreement type | `pilot-scope.ts` `PILOT_AGREEMENT_TYPES` | Add the new type string |
| Factor code | `pilot-scope.ts` `PILOT_FACTOR_CODES` | Add the new code string |
| Compute rule kind | `pilot-scope.ts` `PILOT_COMPUTE_RULE_KINDS` | Add the new kind string |
| Zod enum validators | `apps/api/src/lib/billing/zod-common.ts` | `pilotAgreementTypeSchema` / `pilotFactorCodeSchema` re-derive automatically from the constants |
| Seed reference data | `prisma/seed.ts` | Add an upsert for the new `CostFactor` row |

### Migration cost when extending past pilot

**Zero schema work.** `agreements.cost_factors` already exists; agreement
type and factor code are stored as `TEXT` and validated at the
application layer. Extending requires:

1. Edit `pilot-scope.ts` — 3-minute change.
2. Run `npx prisma db seed` for any new factor rows.
3. Update UI dropdowns that enumerate agreement types or factor codes
   (UI-only, no migration).
4. Deploy — no schema migration, no downtime.

### References

- `apps/api/src/lib/billing/pilot-scope.ts` — the gate file
- `apps/api/src/lib/billing/zod-common.ts` — shared Zod validators
- `apps/api/src/lib/permissions.ts` — `billing.read` / `billing.write` slugs
- Sprint 9 commits: Phase 1 Tracks A–D landed 2026-05-31

## Amendment 2026-06-14 — agreements are the sole determinant of bearer/terms

Decision (operator, 2026-06-14): the economic terms of every session are
defined **entirely by the contracts**, never by a property of the site.

- The **Straumvakt ↔ Host** agreement (`service_cpo` / `service_contractor`
  / `service_workplace`) sets Straumvakt's terms with the host.
- The **Host ↔ Driver** agreement (host-authored) sets what the driver
  bears, the **bearer** (driver / a covering org / a third party), the
  rates, and the scope (clauses, bearer rules, driver groups).

`Site.siteType` (`standard` / `workplace` / `mdu` / `hotel` / `fleet` /
`retail`) is therefore **descriptive metadata only** — reporting / UX
labels. It has **no role** in billing or access resolution. The bearer is
whatever an `AgreementClause` / `BearerRule` names, regardless of site
type.

**Resolver realignment (do during the P1 cutover — no code change yet):**

1. `lib/agreement/persist.ts` — find the covering party by "an agreement
   whose clause names a bearer org," not by an `agreementType: "workplace"`
   lookup keyed off site type.
2. `BearerType.trd` — drop the "MDU only" constraint; third-party billing
   is valid whenever the host's contract specifies it.

Supersedes the site-type-as-billing-archetype reading. Related: ADR 0031
(cost model), ADR 0025 (billing cutover).

