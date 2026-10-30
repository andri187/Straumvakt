-- Restores 11 constraints (plus btree_gist) that existed in the retired
-- migrations 0005, 0006 and 0007 (apps/api/drizzle.old/) and were dropped when
-- 0000-0008 were collapsed into the cold baseline 0000_cold_hex.sql.
--
-- Hand-written: drizzle-kit cannot express EXCLUDE or CHECK in the table DSL,
-- so its snapshot does not know these exist and a future `generate` will not
-- recreate them. apps/api/src/lib/migration-constraints.test.ts asserts every
-- definition below against the active migration chain.
--
-- This is a follow-on rather than an edit to 0000_cold_hex.sql so that the
-- baseline's content hash (sha256, see scripts/drizzle-baseline.mjs) does not
-- change: if 0000 was ever recorded as applied anywhere, editing it would make
-- drizzle-kit and the recorded hash disagree.
--
-- NOT APPLIED to any database. Run only against a disposable database first;
-- see docs/agent-runs/2026-10-26/ for the catalog and negative-check plan.

CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- Well-formed periods. `empty && anything` is false, so an exclusion
-- constraint can never fire on an empty range; and an unbounded lower bound
-- makes "since when" meaningless. Both must be rejected before the EXCLUDEs
-- below can be trusted.
ALTER TABLE "assets"."placements"
  ADD CONSTRAINT "placements_period_well_formed"
  CHECK (NOT isempty("period") AND NOT lower_inf("period"));--> statement-breakpoint
ALTER TABLE "assets"."device_identities"
  ADD CONSTRAINT "device_identities_period_well_formed"
  CHECK (NOT isempty("period") AND NOT lower_inf("period"));--> statement-breakpoint
ALTER TABLE "agreements"."agreement_clauses"
  ADD CONSTRAINT "agreement_clauses_period_well_formed"
  CHECK (NOT isempty("period") AND NOT lower_inf("period"));--> statement-breakpoint
ALTER TABLE "agreements"."driver_group_memberships"
  ADD CONSTRAINT "driver_group_memberships_period_well_formed"
  CHECK (NOT isempty("period") AND NOT lower_inf("period"));--> statement-breakpoint

-- No overlapping periods. Form A (EXCLUDE ... USING GIST) works on every
-- supported PostgreSQL. Form B (UNIQUE (..., period WITHOUT OVERLAPS)) is
-- PostgreSQL 18+ only and is deliberately not used.
ALTER TABLE "assets"."placements"
  ADD CONSTRAINT "placements_one_place_at_a_time"
  EXCLUDE USING GIST ("device_id" WITH =, "period" WITH &&);--> statement-breakpoint
ALTER TABLE "assets"."device_identities"
  ADD CONSTRAINT "device_identities_one_identity_per_device_at_a_time"
  EXCLUDE USING GIST ("device_id" WITH =, "period" WITH &&);--> statement-breakpoint
ALTER TABLE "assets"."device_identities"
  ADD CONSTRAINT "device_identities_one_device_per_identity_at_a_time"
  EXCLUDE USING GIST ("identity_string" WITH =, "period" WITH &&);--> statement-breakpoint
ALTER TABLE "agreements"."agreement_clauses"
  ADD CONSTRAINT "agreement_clauses_one_clause_per_factor_at_a_time"
  EXCLUDE USING GIST ("agreement_id" WITH =, "cost_factor_id" WITH =, "period" WITH &&);--> statement-breakpoint
ALTER TABLE "agreements"."driver_group_memberships"
  ADD CONSTRAINT "driver_group_memberships_one_membership_at_a_time"
  EXCLUDE USING GIST ("driver_group_id" WITH =, "user_id" WITH =, "period" WITH &&);--> statement-breakpoint

-- OCPP 1.6 status vocabulary (+ 'unknown', the column default). NOT VALID:
-- no database was read when this was written, so existing rows are unscanned.
-- New and updated rows are checked immediately; existing rows are not until,
-- after a census of distinct status values shows nothing outside the list:
--   ALTER TABLE assets.connectors VALIDATE CONSTRAINT connectors_status_is_ocpp_vocabulary;
--   ALTER TABLE assets.evses      VALIDATE CONSTRAINT evses_status_is_ocpp_vocabulary;
-- VALIDATE takes only SHARE UPDATE EXCLUSIVE, so it does not block reads or writes.
ALTER TABLE "assets"."connectors"
  ADD CONSTRAINT "connectors_status_is_ocpp_vocabulary"
  CHECK ("status" IN (
    'Available', 'Preparing', 'Charging', 'SuspendedEV', 'SuspendedEVSE',
    'Finishing', 'Reserved', 'Unavailable', 'Faulted',
    'unknown'
  )) NOT VALID;--> statement-breakpoint
ALTER TABLE "assets"."evses"
  ADD CONSTRAINT "evses_status_is_ocpp_vocabulary"
  CHECK ("status" IN (
    'Available', 'Preparing', 'Charging', 'SuspendedEV', 'SuspendedEVSE',
    'Finishing', 'Reserved', 'Unavailable', 'Faulted',
    'unknown'
  )) NOT VALID;