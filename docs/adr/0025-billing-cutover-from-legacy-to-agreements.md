# ADR 0025 — Billing Cutover: Legacy Resolver to Agreements Resolver

**Status:** Proposed — **premises superseded.** Several factual claims below were
measured against the database on 2026-08-04 and are wrong in ways that change the
retirement plan. Read [§Verification (2026-08-04)](#verification-2026-08-04) before
acting on §Decision or §Step 6. The accept/reject decision itself is still open.
**Date:** 2026-05-31
**Sprint:** Sprint 9 (cutover gate) / Sprint 10 (legacy retirement)
**Supersedes (in scope):** the "Coexistence with ADR 0008 tables" resolution in [ADR 0019](./0019-agreement-and-bearer-architecture.md) — specifically the deferral that left session-stop on the legacy resolver pending A.6 evidence.
**Relates to:** [ADR 0008](./0008-cost-center-splitting.md) (legacy contract model — tables being retired), [ADR 0019](./0019-agreement-and-bearer-architecture.md) (agreements architecture — the cutover target), [ADR 0021](./0021-reference-catalogue-and-tariff-propagation.md) (rate-reference propagation)
**Rollback anchor:** `feat/agreement-architecture` HEAD before this cutover lands (tag `pre-cutover-co4` recommended at merge)

---

## Verification (2026-08-04)

Measured directly against the live database. **Branch: `staging`
(`br-tiny-river-abgpqq37`).** Read-only queries only; the CO-3 harness was
*not* run (Rule 5 — operator runs it).

> **Branch trap, read this first.** The Neon *default* branch is `production`
> (`br-fragrant-bonus-abrc01g6`, 37 MB) and it is **abandoned** — it carries an
> older PascalCase `public` schema (`Charger`, `Dso`, `Retailer`, `DsoRate`,
> `RateProfile`, …) and **has no `agreements` schema at all**. `staging`
> (518 MB) is the live database. Any tool, script, or MCP query that omits an
> explicit branch reads the abandoned generation and will describe a system
> that no longer exists. Two of the counts in §Context below have this shape.

### Corrections to §Context and §Step 6

| ADR claim | Measured 2026-08-04 |
|---|---|
| `billing.billing_lines` holds historical session costs; **"must not be dropped"** | **0 rows, and zero writers in the entire codebase.** The only billing-line write anywhere is `agreementBillingLine.createMany` (`persist.ts:401`). The table is dead, not merely empty. |
| (cost of record, implied to be `billing.billing_lines`) | **`reports.session_ledger.cost_isk_minor`** — 1555 rows, 1555 priced. This is the actual billing record of truth and ADR 0025 never names it. |
| "489 of 489 sessions priced in the past 30 days" | 451 priced in trailing 30 days (1555 lifetime). Direction of the claim holds; the number is stale. |
| Drop columns on `assets.sites` / `assets.installations` | Wrong schemas. They are **`properties.sites.dso_tariff_id`** and **`properties.installations.retailer_tariff_id`**. Only `assets.charging_stations.chrgrf_tariff_id` is correct as written. |
| "2 stub `agreements.agreements` rows with no clauses; 0 `rate_references`" | **4 agreements, 4 clauses, 2 rate_references, 1 driver group, 1 membership.** Partial A.10 seeding happened after this ADR was written and was not recorded. |
| "`billing.contracts*` designed but never populated" | **Confirmed.** `contracts`=1, `contract_factor_assignments`=0, `driver_contracts`=0, `driver_contract_factor_overrides`=0, `contract_period_accumulators`=0. |
| `billing.tariff_definitions` — 4 in active use | **Confirmed**, 4 rows. `billing.cost_factors`=8, `agreements.cost_factors`=17. |

### What actually happened instead of Steps 4–5

**The cutover was never implemented as designed.** `useAgreementsResolver` and
`resolver_kind` appear **only inside this ADR** — zero occurrences in code. There
is no feature flag, no per-installation rollout, no `resolver-flags.ts`.

What exists instead is an arrangement nobody wrote down: **both resolvers run
concurrently, ungated.**

- **Legacy** prices every session at session-stop via `computeSessionCost`, from
  all three session-creation paths (`projections.ts` ×2, `webhooks/zaptec.ts`,
  `zaptec-session-sync.ts`), writing cost to `reports.session_ledger`.
- **Agreements** runs as a per-minute cron (`runAgreementsBillingTick`,
  wired at `index.ts:435`) that picks up completed + user-enriched sessions
  and writes `agreements.billing_lines`.

This is *shadow mode without the comparison* — the safety property Step 2 made a
hard go-gate is absent, because nothing compares the two outputs.

**It has also never done anything.** `agreements.billing_lines` = 0 rows after
~2 months of running every minute. The tick's eligibility predicate currently
matches **0 sessions**, because it requires `user_id IS NOT NULL` and there is
1 driver-group membership in the system (cf. handoff §4 — essentially no real
drivers exist yet). The cron is a silent no-op, not a working parallel path.

### Consequence for the retirement plan

Step 6's protective carve-out is inverted. `billing.billing_lines` is named as
the thing that must survive, and it is the emptiest, deadest object in the set.
Meanwhile `reports.session_ledger` — which genuinely is the irreplaceable record
of 1555 priced sessions — is not mentioned in this ADR at all, and therefore has
no stated protection.

**A fourth generation exists that this ADR never mentions:** `billing.tariffs`,
`invoices`, `invoice_lines`, `billing_transactions`, `statements`,
`subscriptions`, `customer_plans`, `bill_objects`, `bill_object_members` — all
**0 rows**. Scoping a retirement from §Step 6 alone would leave these in place.

---

## Context

ADR 0019 introduced the `agreements.*` model as an additive replacement for
the `billing.*` contract-resolution chain, explicitly deferring the
session-stop cutover to "a separate ADR after A.6 evidence lands." That
evidence is now in:

- **489 out of 489 sessions** priced in the past 30 days resolved through
  the legacy chain (`billing.tariff_definitions → sites.dso_tariff_id /
  installations.retailer_tariff_id`). Not one session has ever touched the
  new resolver. The operator's summary of the situation: "two systems is
  ridiculous."

- **Four TariffDefinitions** are in active use (Veitur AD1 DSO rate + N1
  retailer energy rate, each for two orgs). The entire legacy resolution
  surface maps to a small, well-understood set of rates.

- **The legacy `billing.contracts*` family was designed but never
  populated.** There is 1 contract row, 0 assignments, 0 driver contracts.
  The contract-tree branch of ADR 0008 was never exercised in production.
  Retiring it is a mechanical drop with no data consequence.

- **17 cost factor rows** exist in `agreements.cost_factors` (new catalog,
  revised codes). 2 stub `agreements.agreements` rows exist with no
  clauses. 0 rows in `agreements.bearer_rules`, `agreements.rate_references`,
  or `agreements.billing_lines`. The new model is seeded but not yet live.

- Three parallel agents (CO-1, CO-2, CO-3) are running the prerequisite
  work: CO-1 probes existing agreement data and driver-group state, CO-2
  produces the A.10 seed script that creates real agreement + clause +
  rate-reference rows for the three known installations (Dalvegur, Reykjavík
  HQ, VCP Lab), and CO-3 builds the shadow-resolver harness that will
  confirm numerical parity before the flag flips.

The operator direction is clear: move forward, retire legacy. This ADR
sequences the cutover safely.

---

## Decision

Replace the `billing.tariff_definitions` resolution chain at session-stop
with the `agreements.*` resolver. The cutover is staged by installation
behind a per-installation feature flag to allow incremental validation and
instant per-installation rollback without a full deploy.

### Step 1 — Migration (A.10)

Run the CO-2 seed script (dry-run by default; requires `--execute` flag for
live apply). The script creates, for each of the three known installations:

- One `agreements.agreements` row of type `installation`
- `agreement_clauses` for the factor codes in scope for that installation
  (DSO, ELE, and optionally MTR, TRF_CHG, TRF_IDLE)
- `agreements.rate_references` rows mapping to the four current rate values
  (Veitur AD1 per-kWh DSO rate, N1 retailer per-kWh ELE rate)

The script is idempotent. It upserts on (installation_id, agreement_type,
effective_from), so re-running it after a partial apply is safe.

### Step 2 — Shadow comparison (CO-3 harness)

Before any flag flip, run the CO-3 shadow-resolver harness against the
last 30 days of sessions. The harness resolves each session through both
the legacy and new resolvers and compares the output per factor per session.

**Go-gate:** 100% numerical match across all 489 sessions. Any divergence
surfaces as a numbered finding; each finding must be resolved before the
relevant installation's flag is enabled.

### Step 3 — Membership enforcement (A.11)

Wire the `DriverGroupMembership` check into `resolveAuthorize()` as
specified in ADR 0019 §2026-05-09 addendum, gated by the per-installation
`enforceAuthorize` flag. A.11 is independent of the resolver flip — it can
and should land alongside the A.10 seed without affecting legacy billing.
This closes the access gap between Gate 1 (Authorize) and Gate 2
(billing-time membership check at session-stop).

### Step 4 — Resolver flip (this ADR's core decision)

In `apps/api/src/lib/tariff/compute-session-cost.ts`, replace the lookup
chain that reads `billing.tariff_definitions` (via `sites.dso_tariff_id` /
`installations.retailer_tariff_id` / `charging_stations.chrgrf_tariff_id`)
with a call to the new `agreements.*` resolver
(`apps/api/src/lib/agreement/resolve.ts`).

The switch is gated by a per-installation `useAgreementsResolver` boolean
field (to be added to `assets.installations` or to an in-code config map
as a lighter-weight alternative for the stability window). Rollout order:

1. **Dalvegur** — highest session volume; most validation surface.
2. **Reykjavík HQ** — second installation, different rate profile.
3. **VCP Lab** — third installation; synthetic / test environment.
4. **Default-on** — once all three pass their stability windows, flip the
   default so any future installation uses the new resolver automatically.

When `useAgreementsResolver = false` (the legacy path), the existing code
runs unchanged. When `true`, the new resolver is called and its output is
written to `agreements.billing_lines`. The legacy `billing.billing_lines`
table is not written during the new-resolver path.

### Step 5 — Stability window (~2 weeks per installation)

Both resolvers remain in the codebase. For each installation flagged to the
new resolver, the CO-3 shadow harness continues running in the background,
comparing new-resolver `billing_lines` output against what the legacy
resolver would have produced for the same sessions. Any numerical divergence
raises an alert.

During the stability window, the legacy resolver is behind the `false` path
of the feature flag — not called for flagged installations, but still
present and correct for un-flagged ones. An engineer can flip an
installation back to `false` in seconds without a deploy (if the flag is
stored in the database) or with a single-env-var deploy (if stored in
`wrangler.jsonc` vars).

### Step 6 — Legacy retirement (follow-up ADR or Sprint 10 commit)

Once all installations are stable on the new resolver for the full
stability window, retire the legacy layer in a single follow-up ADR or
dedicated Sprint 10 commit:

**Drop columns:** `assets.sites.dso_tariff_id`, `assets.installations.retailer_tariff_id`,
`assets.charging_stations.chrgrf_tariff_id`

**Drop tables (in dependency order):**
1. `billing.contract_period_accumulators`
2. `billing.driver_contract_factor_overrides`
3. `billing.contract_factor_assignments`
4. `billing.driver_contracts`
5. `billing.contracts`
6. `billing.tariff_definitions`
7. `billing.cost_factors` (the old-code DSOF/REPF/... catalog)

**Retain:** `billing.cost_centers` — this table serves a different domain
(cost-center routing for B2B splits) and has no dependency on the legacy
resolver. It may be migrated to `agreements.*` in a future ADR if the
`WRK` bearer pattern supersedes it, but that decision is deferred.

**Retain:** `billing.billing_lines` — historical session cost records from
the legacy resolver. These rows are the source of truth for already-closed
sessions and must not be dropped while any open invoice period references
them. Archival or migration is a separate decision (see Open Questions).

The UI and API routes that currently target the dropped tables are covered
by the UI Rewrite Shopping List (`docs/notes/2026-05-31-ui-cutover-shopping-list.md`).
Those retargets are a post-cutover UI sprint, not a prerequisite for the
resolver flip.

---

## Consequences

### Positive

- **One resolver, not two.** The operator mental model collapses to a single
  coherent surface: Agreements + Clauses + BearerRules + RateReferences.
  No more "which one is this session priced by?"
- **Rate changes are O(1).** Updating DSO or retailer prices requires one
  `INSERT` into `agreements.rate_references`. No more FK pointer surgery
  across `sites` and `installations`.
- **Audit trail per factor per session.** Every `agreements.billing_lines`
  row carries `rule_id` + `clause_id` + `rate_reference_id`. Replaying
  historical sessions against historical rules is exact.
- **The `billing.contracts*` tables were never populated.** Dropping them
  is a surgical cleanup with zero data consequence. No migration of live
  data, no data loss.
- **Feature-flag rollout is reversible mid-session-volume.** A single flag
  flip per installation, no deploy required (if stored in DB).

### Negative

- **Two resolvers in the codebase during the stability window.** The
  `compute-session-cost.ts` function will carry both paths behind the flag
  for approximately 2 weeks per installation, or ~6 weeks total before the
  default flips. Code reviewers must check the correct branch.
- **`agreements.billing_lines` and `billing.billing_lines` will diverge.**
  Historical sessions live in `billing.billing_lines`; post-cutover sessions
  land in `agreements.billing_lines`. Any report that spans the cutover date
  must union both tables. The billing summary API (`/api/admin/billing/summary`)
  must be updated to read from both during the overlap window.
- **The CO-3 harness is a prerequisite, not a nice-to-have.** Skipping the
  shadow comparison removes the numerical safety guarantee. The go-gate
  (100% match) is a hard precondition, not advisory.
- **`billing.cost_centers` remains legacy infrastructure** until explicitly
  migrated. It's a small table with clean FK boundaries, but it represents
  technical debt if the WRK bearer pattern in ADR 0019 eventually supersedes it.

### Neutral / deferred

- **Historical session re-pricing is explicitly out of scope.** Sessions in
  `reports.session_ledger` and `billing.billing_lines` are left at their
  legacy-computed cost. Re-pricing closed sessions would constitute an
  unannounced retroactive billing change — OCPI implications, operator
  signoff required. Deferred indefinitely.
- **Invoice generation is not affected.** ADR 0005 tag E (post-pilot) owns
  invoice rollup. The `agreements.billing_lines` table feeds future invoicing
  the same way `billing.billing_lines` would have.
- **The billing summary tile "Tariffs total / anchored / orphan"** on the
  overview page will need to be re-labelled post-cutover (the concept of
  an "orphan TariffDefinition" disappears). UI work tracked in the shopping
  list.

---

## Open questions

1. **Resolver flag storage: DB column vs in-code config map?**
   A DB column on `assets.installations` allows flag flips without a deploy.
   A config map in `apps/api/src/lib/tariff/resolver-flags.ts` is simpler
   to audit and version-control, but requires a deploy per flip. Recommend:
   DB column for the stability window, removed when the default-on step
   completes and the column is no longer needed.

2. **In-flight sessions at flip time.** If a session starts under the legacy
   resolver and the installation flag flips before `StopTransaction`, which
   resolver prices it? Recommend: resolver is chosen at `started_at`, not
   `stopped_at`. The session's `installation_id` is resolved at start; the
   flag value at that moment is stored on the session row as
   `resolver_kind = 'legacy' | 'agreements'`. Session-stop reads
   `resolver_kind` to pick the correct path. This prevents mid-session
   resolver switches.

3. **Billing summary dual-read window.** The `/api/admin/billing/summary`
   endpoint currently reads `billing.billing_lines`. Post-cutover, new
   sessions land in `agreements.billing_lines`. During the overlap window,
   the summary must union both tables. Recommend: add a UNION query for the
   month that contains the cutover date; retire the union once the cutover
   month is fully closed (i.e., no live sessions could still be on the
   legacy path).

4. **`billing.cost_centers` future.** The table is referenced by
   `/billing/cost-centers` and `billing-cost-centers.ts`. Its domain
   (payer/beneficiary routing) overlaps conceptually with the ADR 0019
   `WRK` bearer and `BearerRule` allocation splits. A decision on whether
   to retire or integrate it should be made before Sprint 11 at the latest
   to avoid carrying another legacy surface indefinitely.

---

## Rollback plan

**Per-installation flag rollback:** flip `useAgreementsResolver = false` for
the affected installation. The legacy resolver immediately resumes for all
subsequent sessions at that installation. Sessions already priced by the new
resolver are not retroactively re-priced (same logic as historical session
principle above).

**Full rollback before default-on:** flip all installation flags back to
`false`. The legacy resolver handles 100% of sessions. The `agreements.*`
tables are untouched and can be corrected and retried.

**Full rollback after legacy table drop:** restore from the latest Neon
point-in-time backup. The legacy tables are recreated with their data at the
backup point. Sessions that ran between the drop and the restore will have
been priced by the new resolver and are in `agreements.billing_lines` — those
records are valid. The restored legacy tables will have a gap for that window;
manual reconciliation required. This scenario is the reason the legacy tables
are not dropped until after the full stability window.
