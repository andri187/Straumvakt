-- Drop 32 tables that have never held a row and that no code touches.
--
-- ADR 0050 decision 3. Measured on staging (br-tiny-river-abgpqq37) on
-- 2026-08-07: 61 of 98 tables had zero rows. This drops only the subset that
-- is ALSO unreferenced by any code, which is a much smaller and much safer
-- set than "empty".
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────
--
-- 17 empty tables have live writers and are merely idle. Dropping any of
-- them would break ingest for 21 chargers that write continuously:
--
--   charging.live_sessions      9 writes — empty only when nothing is charging
--   charging.meter_values       3 writes — empty through retention, not disuse
--   charging.tap_intents        5 writes — the tap-and-auth flow
--   identity.user_tokens       11 writes
--   ... and 13 more.
--
-- agreements.bearer_rules is empty and looked unreferenced, but the LIVE
-- billing engine reads it: persist.ts loads `include: { bearerRules: true }`
-- and resolve.ts's buildLadder walks the result. A grep for
-- `.bearerRule.findMany` finds nothing because Prisma relation loads do not
-- look like model accessors. Kept.
--
-- people.vehicles and agreements.driver_access_requests are empty but about
-- to be used (ADR 0044; the driver access flow is due for real-world test).
-- Kept.
--
-- Four more were excluded only because they matched generic relation names
-- (`memberships`, `members`, `lines`, `tariffs`) during the reference scan.
-- billing.invoice_lines was then re-included after confirming `invoiceLine`
-- appears nowhere in the codebase; the other three stay for now. Conservative
-- on purpose — this statement is not reversible.
--
-- ── ORDER ──────────────────────────────────────────────────────────────
-- Children before parents. The only cross-set FK is
-- billing.invoice_lines -> billing.invoices; everything else is either
-- self-contained or references a table that survives.

BEGIN;

-- billing: the fourth generation (ADR 0048 D3) plus legacy children that
-- never received a row. reports.session_ledger is the protected billing
-- record and is NOT touched.
DROP TABLE IF EXISTS billing.invoice_lines;
DROP TABLE IF EXISTS billing.invoices;
DROP TABLE IF EXISTS billing.statements;
DROP TABLE IF EXISTS billing.billing_transactions;
DROP TABLE IF EXISTS billing.subscriptions;
DROP TABLE IF EXISTS billing.customer_plans;
DROP TABLE IF EXISTS billing.contract_factor_assignments;
DROP TABLE IF EXISTS billing.contract_period_accumulators;
DROP TABLE IF EXISTS billing.driver_contract_factor_overrides;

-- issues: the Prisma models were removed in the Sprint 12 scaffold cleanup
-- but the tables were never dropped, because that migration was written and
-- never applied.
DROP TABLE IF EXISTS issues.ticket_events;
DROP TABLE IF EXISTS issues.tickets;
DROP TABLE IF EXISTS issues.detection_rules;

-- energy: site/property policies and planning results. Never wired.
DROP TABLE IF EXISTS energy.energy_planning_results;
DROP TABLE IF EXISTS energy.property_energy_policies;
DROP TABLE IF EXISTS energy.site_energy_policies;

-- entitlements: feature flags and enterprise licences.
DROP TABLE IF EXISTS entitlements.feature_flags;
DROP TABLE IF EXISTS entitlements.enterprise_licenses;

-- roaming: OCPI. roaming.external_cpms_refs SURVIVES — sites.ts writes it.
DROP TABLE IF EXISTS roaming.cdr_queue;
DROP TABLE IF EXISTS roaming.hub_connections;
DROP TABLE IF EXISTS roaming.ocpi_tokens;

-- webhooks: outbound delivery infrastructure, never used.
DROP TABLE IF EXISTS webhooks.deliveries;
DROP TABLE IF EXISTS webhooks.dead_letters;
DROP TABLE IF EXISTS webhooks.subscriptions;

-- vendors: multi-vendor adapter health and contract tests. One vendor.
-- vendors.vendor_asset_refs SURVIVES — it is written, and ADR 0047 moves
-- the vendor columns onto it.
DROP TABLE IF EXISTS vendors.adapter_health;
DROP TABLE IF EXISTS vendors.contract_tests;

-- reports: rollups nothing ever computed. reports.session_ledger SURVIVES.
DROP TABLE IF EXISTS reports.billing_period_summary;
DROP TABLE IF EXISTS reports.charger_uptime_daily;
DROP TABLE IF EXISTS reports.command_history;
DROP TABLE IF EXISTS reports.site_energy_daily;

-- assets: part of the protocol-neutral physical model (ADR 0012) that was
-- never populated. capability_profiles and control_routing_policies SURVIVE
-- — both still have writers. modems is kept with them for the same reason.
DROP TABLE IF EXISTS assets.controllers;
DROP TABLE IF EXISTS assets.meters;

-- ocpp: configuration keys were never persisted. The get/change-configuration
-- endpoints enqueue outbound commands and never store the result — which is
-- worth knowing separately from this migration.
DROP TABLE IF EXISTS ocpp.configuration_keys;

COMMIT;
