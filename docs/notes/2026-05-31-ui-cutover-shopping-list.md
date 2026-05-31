# UI Rewrite Shopping List — Billing Cutover to `agreements.*`

**Date:** 2026-05-31
**Context:** ADR 0025 sequences the session-stop cutover from `billing.tariff_definitions`
to `agreements.*`. Once the resolver flip lands and the legacy tables are retired, every
billing UI surface that reads or writes those tables must be retargeted. This document
is the canonical checklist for that post-cutover UI sprint.

**Scope:** files in `src/app/(app)/billing/`, `apps/api/src/routes/admin/billing*.ts`,
and their corresponding repositories. Files are grouped by status.

---

## Group A — Already on new model (no change needed)

These pages and API routes already target `agreements.*` and require no modification
after the cutover.

| Surface | File | Model |
|---|---|---|
| Rate book list + CRUD | `src/app/(app)/billing/rate-references/page.tsx` | `agreements.rate_references` |
| Rate reference detail | `src/app/(app)/billing/rate-references/[id]/page.tsx` | `agreements.rate_references` |
| Rate reference new form | `src/app/(app)/billing/rate-references/new/page.tsx` | `agreements.rate_references` |
| Contracts (Agreement catalogue) | `src/app/(app)/billing/contracts/page.tsx` | `agreements.agreements` |
| Driver contracts (membership view) | `src/app/(app)/billing/driver-contracts/page.tsx` | `agreements.driver_group_memberships` |
| Rate references API | `apps/api/src/routes/admin/billing-rate-references.ts` | `agreements.rate_references` |
| Contracts API | `apps/api/src/routes/admin/billing-contracts.ts` | `agreements.agreements` |
| Driver contracts API | `apps/api/src/routes/admin/billing-driver-contracts.ts` | `agreements.driver_groups`, `agreements.driver_group_memberships` |

---

## Group B — On legacy model, need retarget

Each entry below shows the file path, what it currently reads or writes, and what
the new-model equivalent is. Effort estimates: S = < 2 hours, M = half-day, L = full day+.

### B.1 — Tariff surfaces (highest priority; blocked directly by legacy table drop)

| File | Today targets | After cutover targets | Effort |
|---|---|---|---|
| `src/app/(app)/billing/tariffs/page.tsx` | `billing.tariff_definitions` list, grouped by org, with sites/installs/stations usage counts and orphan flags | `agreements.agreement_clauses` rolled up per installation, grouped by counterparty org. The "tariff" concept becomes a clause: factor code + rate reference code + compute rule kind. | M |
| `src/app/(app)/billing/tariffs/[id]/page.tsx` | `TariffDefinition` detail — single rate row, attached factor, usage FKs | `AgreementClause` detail — factor code, rate_reference_code, allocation_json, effective dates, bearer | M |
| `src/app/(app)/billing/tariffs/[id]/edit/page.tsx` | Edit form for a `TariffDefinition` (display name, price, VAT, status) | Edit form for an `AgreementClause` (rate_reference_code, driver_pays toggle, effective dates). Note: immutability constraint — clause edits that change the rate must stage a new `RateReference` row, not mutate the existing one. | L |
| `src/app/(app)/billing/tariffs/[id]/action-buttons.tsx` | Deactivate / reactivate a `TariffDefinition`; shows tariff usage count | Deactivate / reactivate an `AgreementClause`; shows active session count on that clause | S |
| `src/app/(app)/billing/tariffs/new/page.tsx` | Create a new `TariffDefinition` (org, factor, compute rule, price, VAT) | Create a new `AgreementClause` on an existing Agreement — picks factor code from pilot scope list, references a `RateReference` code, sets driver_pays bool | M |
| `src/app/(app)/billing/tariffs/create-form.tsx` | Form component for new `TariffDefinition` | Form component for new `AgreementClause` (driver-pays toggle, rate reference picker) | M |
| `apps/api/src/routes/admin/billing.ts` | Root billing handler + `/tariffs` list endpoint reading `billing.tariff_definitions` | `/tariffs` route retargeted to `agreements.agreement_clauses` + join to `agreements.agreements`. Or merged into `billing-contracts.ts` if the list is absorbed into the contracts page. | S–M |
| `apps/api/src/routes/admin/billing-tariff-detail.ts` | Single `TariffDefinition` read | Single `AgreementClause` read | S |
| `apps/api/src/routes/admin/billing-tariff-mgmt.ts` | Create / update / deactivate `TariffDefinition` | Create / update / deactivate `AgreementClause`. Must enforce the rate-immutability rule (mutating price on an active clause is blocked; must stage new `RateReference`) | M |

### B.2 — Cost-factor catalogue (medium priority; the old `billing.cost_factors` table drops)

Note: `agreements.cost_factors` already exists and is the cutover target. It uses
different codes (DSO/ELE/... vs DSOF/REPF/...). The UI needs to read from the new
table and drop references to `anchorTier` (which was an ADR 0008 concept; in ADR 0019,
factor scope is determined by which `agreement_type` enlists it).

| File | Today targets | After cutover targets | Effort |
|---|---|---|---|
| `src/app/(app)/billing/cost-factors/page.tsx` | `billing.cost_factors` — grouped by `anchorTier`, orphan flags, tariff usage counts | `agreements.cost_factors` — grouped by default bearer or factor category, clause usage counts instead of tariff usage counts | M |
| `src/app/(app)/billing/cost-factors/new/page.tsx` | Create a new `billing.cost_factors` row | Create a new `agreements.cost_factors` row. Note: in practice the catalog is seed-managed; the operator UI for new factors may simply be removed (see Group C) | S–M |
| `src/app/(app)/billing/cost-factors/[id]/edit/page.tsx` | Edit `billing.cost_factors` row (display name, VAT, currency, status) | Edit `agreements.cost_factors` row (same fields, different table) | S |
| `src/app/(app)/billing/cost-factors/status-toggle.tsx` | Inline toggle for `billing.cost_factors.status` | Inline toggle for `agreements.cost_factors.status` | S |
| `apps/api/src/routes/admin/billing-cost-factors.ts` | CRUD against `billing.cost_factors` | CRUD against `agreements.cost_factors` | S |

### B.3 — DSO / electricity informational pages (lower priority; these are read-only views)

Both pages combine a static reference catalogue with a live DB query against `billing.cost_factors`.
Post-cutover, the DB query retargets to `agreements.cost_factors` (which uses DSO/ELE codes
rather than DSOF/REPF). The reference catalogue panel is unaffected.

| File | Today targets | After cutover targets | Effort |
|---|---|---|---|
| `src/app/(app)/billing/dso/page.tsx` | `billing.cost_factors` where `anchorTier=site` | `agreements.cost_factors` where factor code matches DSO-family (DSO, MTR). Remove `anchorTier` filter; filter by code prefix instead | S |
| `src/app/(app)/billing/electricity/page.tsx` | `billing.cost_factors` where `anchorTier=installation` | `agreements.cost_factors` where factor code matches ELE/retailer family | S |
| `apps/api/src/routes/admin/billing-dso.ts` | Reads `billing.cost_factors` + joins to `billing.tariff_definitions` | Reads `agreements.cost_factors` + joins to `agreements.rate_references` | S |
| `apps/api/src/routes/admin/billing-electricity.ts` | Reads `billing.cost_factors` + joins to `billing.tariff_definitions` | Reads `agreements.cost_factors` + joins to `agreements.rate_references` | S |

### B.4 — Cost centers (separate domain; deferred pending ADR decision)

`billing.cost_centers` is not dropped by ADR 0025 — it is explicitly retained as a
separate domain. The UI work here is therefore not a cutover blocker. It is included
for completeness and because a future ADR (see ADR 0025 Open Question 4) may decide
to migrate or integrate it.

| File | Today targets | After cutover targets | Effort |
|---|---|---|---|
| `src/app/(app)/billing/cost-centers/page.tsx` | `billing.cost_centers` | If migrated to `agreements.*`: new model TBD. If retained: no change. | TBD |
| `apps/api/src/routes/admin/billing-cost-centers.ts` | `billing.cost_centers` | Same deferral | TBD |

### B.5 — Billing overview and summary (needs dual-read update during overlap window)

The billing overview page is not tied to a legacy table drop, but it needs an interim
update during the stability window (see ADR 0025 Consequence: dual-read window).

| File | Today targets | After cutover targets | Effort |
|---|---|---|---|
| `src/app/(app)/billing/page.tsx` | Reads from `billing-summary` API; displays "Tariffs total / anchored / orphan" health tiles | Health tiles should be re-framed around Agreements (e.g. "Agreements active / clauses / missing rate") once the legacy concept of "tariff orphan" disappears. During stability window: no change needed. | S (post-drop re-label only) |
| `apps/api/src/routes/admin/billing-summary.ts` | Queries `billing.billing_lines`, `billing.tariff_definitions` for health stats | **During overlap window:** UNION `billing.billing_lines` with `agreements.billing_lines` for the cutover month. After full retirement: query `agreements.billing_lines` only. | M (overlap union) + S (cleanup) |

---

## Group C — UI surfaces to delete or merge

These pages represent legacy-only concepts that either dissolve post-cutover or
should be consolidated with an existing new-model page.

### C.1 — `/billing/tariffs` → merge into `/billing/contracts`

The `/billing/tariffs` surface is a list of `TariffDefinition` rows. Post-cutover,
the equivalent concept is "AgreementClause" — a clause on an Agreement. A clause
is only meaningful in the context of its Agreement, so the natural home for clause
browsing is the Agreement detail view, not a standalone catalogue.

**Recommendation:** retire `/billing/tariffs` as a top-level section. Fold clause
display into the Agreement detail page (which does not yet exist as a UI surface —
see Group D). The BILLING_TABS navigation entry for "Tariffs" becomes "Agreements"
and routes to the enhanced contracts page.

### C.2 — `/billing/cost-factors` → downgrade to seed-management tool or retire

The cost-factor catalogue (`billing.cost_factors` today, `agreements.cost_factors`
post-cutover) is a platform-level reference table. The 17 factors in the new catalog
are managed via `prisma/seed.ts` and the pilot-scope constants in
`apps/api/src/lib/billing/pilot-scope.ts`. An operator UI for creating new factors
is only needed when the pilot scope is extended — a low-frequency operation.

**Recommendation:** retain the read-only catalogue view for observability (shows
which factors are active, how many clauses reference each). Remove the Create /
Edit / Deactivate CRUD forms from the operator surface; move those to an internal
admin-only route or document them as seed-script operations. This simplifies the
post-cutover UI without losing visibility.

### C.3 — `/billing/dso` and `/billing/electricity` — retain as informational panels

These pages serve a dual purpose: operational DB view + static reference catalogue.
The reference catalogue panel is unchanged. The operational panel becomes a view
of `agreements.cost_factors` + `agreements.rate_references` rather than
`billing.cost_factors` + `billing.tariff_definitions`. The concept (cross-reference
configured rates against the Iceland energy party catalogue) is valid and useful
regardless of which DB table backs it.

**Recommendation:** retain both pages. Retarget the DB panel (Group B.3 above).
The tab label and section header change from "billing.cost_factors" to
"agreements.cost_factors" but the operator value proposition is unchanged.

---

## Group D — New surfaces needed (not yet built)

These are net-new UI surfaces required by the `agreements.*` model that do not
exist today. They are not legacy retargets — they are the post-cutover authoring
surface that replaces the deprecated tariff CRUD.

| Surface | What it does | Priority |
|---|---|---|
| **Agreement editor** | Create and edit `service_cpo` and `installation` agreements. Fields: counterparty org, agreement type, display name, effective dates, status. Clause sub-form: add/edit clauses for the 8 pilot factor codes, with driver-pays toggle and rate-reference picker. | High — blocks operator ability to author new agreements without seed scripts |
| **BearerRule grid editor** | View and edit the (scope × audience) grid of BearerRule overrides on an Agreement. Pilot scope: only the cells that override the default bearer (driver_pays toggle per cell). Full allocation splits and markup are schema-complete but UI-hidden. | Medium — needed for workplace or per-driver overrides |
| **Membership management** | Assign and revoke drivers to/from DriverGroups under an Agreement. Shows current members, dormancy flags, token count. Assign button: pick a driver by email/name, select a group, set effective date. | High — without this, driver onboarding requires a seed script |
| **Agreement detail / clause list** | Read-only (then editable) view of a single Agreement: its clauses, bearer rules, driver groups, and effective dates. The `/billing/contracts` page today shows a summary row; this is the drill-down. | Medium — useful even before the editor is built |
| **Rate-reference picker (component)** | A reusable inline component that lets the operator pick an existing `rate_references` row by code, or navigate to `/billing/rate-references/new` to stage a new version first. Used by the Agreement editor's clause sub-form. | Low — can be a simple dropdown initially |

---

## Phasing recommendation

### Phase 1 (cutover sprint — resolver flip, no UI changes)

The resolver flip (ADR 0025 Steps 1–4) can land without touching any UI. The
legacy UI continues to work for the stability window — it just shows data from
tables that are still populated. The only required change is the billing-summary
dual-read update (Group B.5) so the overview stats stay accurate across the
cutover boundary.

**Files touched in Phase 1:**
- `apps/api/src/routes/admin/billing-summary.ts` (dual-read union)

Everything else is deferred until after the stability window confirms the new
resolver is correct.

### Phase 2 (post-stability, pre-drop — UI retargets)

Once the stability window passes and the legacy table drop is scheduled, retarget
the legacy-backed pages before the drop lands:

**In order:**
1. Group B.3 (DSO + electricity — small, self-contained, S effort each)
2. Group B.2 (cost-factors — M effort, but mostly mechanical find/replace across table and field names)
3. Group B.1 tariff API routes (billing.ts, billing-tariff-detail.ts, billing-tariff-mgmt.ts — S–M each)
4. Group B.1 tariff UI pages (tariffs list, detail, edit, new — M–L each)

**Total Phase 2 effort estimate:** 2–3 engineer-days

### Phase 3 (post-drop — new authoring surfaces)

With the legacy tables gone, the operator needs real authoring tools to replace
the seed-script workflow:

**In order:**
1. Agreement detail / clause list (read-only drill-down from contracts page)
2. Membership management (assign/revoke drivers — highest operator friction today)
3. Agreement editor (create/edit agreements and clauses)
4. BearerRule grid editor (lower priority; pilot uses default bearer for most clauses)

**Total Phase 3 effort estimate:** 4–6 engineer-days

### Phase 4 (deferred — cost centers)

Resolve the `billing.cost_centers` future (ADR 0025 Open Question 4) and execute
the resulting UI work. Size unknown until the architecture decision is made.

---

## Summary table — effort by group

| Group | Files | Effort | Sprint |
|---|---|---|---|
| A — Already new model | 8 files | 0 | — |
| B.1 — Tariff surfaces | 9 files | ~12h total | Phase 2 |
| B.2 — Cost factors | 5 files | ~5h total | Phase 2 |
| B.3 — DSO / electricity | 4 files | ~3h total | Phase 2 |
| B.4 — Cost centers | 2 files | TBD | Phase 4 |
| B.5 — Summary / overview | 2 files | ~3h (overlap) + 1h (cleanup) | Phase 1 + Phase 2 |
| C — Delete / merge | 2 pages retired, 2 retained | ~1h nav update | Phase 2 |
| D — New surfaces | 5 surfaces | ~20–30h | Phase 3 |

**Post-cutover UI sprint total (Phases 2+3):** approximately 5–8 engineer-days
