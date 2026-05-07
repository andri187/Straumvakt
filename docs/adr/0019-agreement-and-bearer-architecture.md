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

## Addendum 2026-05-07 — `cpo_org_id`, STR factor, admin-only operational data

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

