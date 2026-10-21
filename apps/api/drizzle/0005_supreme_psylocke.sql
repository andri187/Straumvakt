CREATE TABLE "assets"."device_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"identity_string" text NOT NULL,
	"period" "tstzrange" NOT NULL,
	"assigned_by_user_id" uuid,
	"note" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets"."devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor" text,
	"model" text,
	"serial_number" text,
	"charge_box_serial_number" text,
	"meter_type" text,
	"meter_serial_number" text,
	"firmware_version" text,
	"firmware_observed_at" timestamp (6) with time zone,
	"hardware_version" text,
	"iccid" text,
	"imsi" text,
	"lifetime_kwh" numeric(14, 3),
	"lifetime_kwh_observed_at" timestamp (6) with time zone,
	"lifetime_session_count" integer,
	"lifetime_session_count_observed_at" timestamp (6) with time zone,
	"warranty_expires" date,
	"manufactured_at" date,
	"retired_at" timestamp (6) with time zone,
	"retired_reason" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets"."placements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"site_id" uuid,
	"circuit_id" uuid,
	"period" "tstzrange" NOT NULL,
	"attached_by_user_id" uuid,
	"detached_by_user_id" uuid,
	"detach_reason" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "device_identities_device_id_index" ON "assets"."device_identities" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_identities_identity_string_index" ON "assets"."device_identities" USING btree ("identity_string");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_vendor_serial_number_index" ON "assets"."devices" USING btree ("vendor","serial_number");--> statement-breakpoint
CREATE INDEX "devices_serial_number_index" ON "assets"."devices" USING btree ("serial_number");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_public_id_index" ON "assets"."placements" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "placements_device_id_index" ON "assets"."placements" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "placements_org_id_index" ON "assets"."placements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "placements_installation_id_index" ON "assets"."placements" USING btree ("installation_id");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- HAND-WRITTEN BELOW THIS LINE. NOT PRODUCED BY drizzle-kit.
--
-- Drizzle cannot express a temporal key at all: it has no range type and no
-- syntax for WITHOUT OVERLAPS or EXCLUDE. The COLUMN is declared in
-- packages/shared/src/db/assets.ts and generated above; the CONSTRAINT is
-- only here.
--
-- CONSEQUENCE, STATED RATHER THAN DISCOVERED LATER: the drizzle-kit snapshot
-- does not know these constraints exist. A future `drizzle-kit generate` will
-- not drop them — a snapshot only diffs what it can see — but it will never
-- recreate them either. This block is their ONLY definition and must travel
-- with the tables. Anyone who regenerates the schema from snapshots alone
-- gets three tables and a silent double-invoice.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- ── The interval is well-formed, under BOTH forms below ────────────────────
--
-- Applied to both so that the version fork does not change behaviour on this
-- axis. It matters most for the EXCLUDE form: `empty && anything` is FALSE in
-- Postgres, so an exclusion constraint can NEVER fire on an empty range and an
-- empty placement would slip past it entirely.
--
-- Bounded below, unbounded above: open-ended is `[from,)`. A placement whose
-- START is unknown cannot be billed for any period, so lower_inf is refused;
-- upper_inf is the ordinary "still there" and is allowed.
ALTER TABLE "assets"."placements"
  ADD CONSTRAINT "placements_period_well_formed"
  CHECK (NOT isempty("period") AND NOT lower_inf("period"));--> statement-breakpoint
ALTER TABLE "assets"."device_identities"
  ADD CONSTRAINT "device_identities_period_well_formed"
  CHECK (NOT isempty("period") AND NOT lower_inf("period"));--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- THE TEMPORAL KEY — TWO FORMS, AND WHICH ONE TO APPLY
--
-- ADR 0054 decision 3 asks for `UNIQUE (device_id, period WITHOUT OVERLAPS)`.
-- That syntax is PostgreSQL 18 or newer. Nothing in this repository records
-- which version Neon serves, and that question was NOT waited on. Both forms
-- are written out; FORM A is active, FORM B is present and commented.
--
-- APPLY FORM A UNLESS THE SERVER IS CONFIRMED 18 OR NEWER.
--   Form A runs on every version this project could plausibly be on. If the
--   server turns out to be 18+, migrating A -> B later is a DROP CONSTRAINT
--   and an ADD CONSTRAINT over the same column — cheap, and it takes an
--   ACCESS EXCLUSIVE lock on three small tables.
--
-- Run this to decide:  SELECT current_setting('server_version_num')::int;
--   >= 180000  ->  Form B is available. Prefer it, for reason 2 below.
--   <  180000  ->  Form A is the only option.
--
-- WHAT ACTUALLY DIFFERS — three things, none of them cosmetic:
--
--   1 · ERROR SIGNATURE. Form A raises exclusion_violation, SQLSTATE 23P01.
--       Form B raises unique_violation, SQLSTATE 23505. Any handler that
--       classifies a write failure by SQLSTATE must be told which one is
--       deployed. `attachDevice` therefore treats BOTH as the same refusal —
--       see repositories/placements.ts — so that switching forms is a
--       migration and not a code change.
--
--   2 · WHAT CAN REFERENCE IT. Form B creates a real UNIQUE constraint, and
--       is therefore a valid target for a temporal foreign key
--       (`FOREIGN KEY (...) REFERENCES ... PERIOD`, also 18+). Form A creates
--       an exclusion constraint, which no foreign key can reference. Nothing
--       in this round needs a temporal FK; if one is ever wanted — sessions
--       referencing the placement that was live at session start is the
--       obvious candidate — that need is what forces the move to Form B.
--
--   3 · EMPTY RANGES. Form A cannot fire on one, because `empty && anything`
--       is FALSE. The well-formedness CHECK above closes that hole, which is
--       why it is applied unconditionally rather than only under Form A.
--
-- What does NOT differ: both forbid exactly the same overlapping rows, both
-- are enforced at WRITE time, and both are backed by a GiST index that serves
-- the `&&` lookups the billing predicate makes. The billing predicate reads
-- the same under either.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── FORM A — active. Any PostgreSQL with btree_gist. ───────────────────────

ALTER TABLE "assets"."placements"
  ADD CONSTRAINT "placements_one_place_at_a_time"
  EXCLUDE USING GIST ("device_id" WITH =, "period" WITH &&);--> statement-breakpoint

ALTER TABLE "assets"."device_identities"
  ADD CONSTRAINT "device_identities_one_identity_per_device_at_a_time"
  EXCLUDE USING GIST ("device_id" WITH =, "period" WITH &&);--> statement-breakpoint

-- The half that matters on the wire: the gateway resolves an inbound
-- connection by its identity string, so two devices answering to one identity
-- at the same instant is an authentication ambiguity, not just untidy data.
ALTER TABLE "assets"."device_identities"
  ADD CONSTRAINT "device_identities_one_device_per_identity_at_a_time"
  EXCLUDE USING GIST ("identity_string" WITH =, "period" WITH &&);--> statement-breakpoint

-- ── FORM B — PostgreSQL 18+. Apply INSTEAD OF Form A, never alongside. ─────
--
-- ALTER TABLE "assets"."placements"
--   DROP CONSTRAINT "placements_one_place_at_a_time";
-- ALTER TABLE "assets"."placements"
--   ADD CONSTRAINT "placements_one_place_at_a_time"
--   UNIQUE ("device_id", "period" WITHOUT OVERLAPS);
--
-- ALTER TABLE "assets"."device_identities"
--   DROP CONSTRAINT "device_identities_one_identity_per_device_at_a_time";
-- ALTER TABLE "assets"."device_identities"
--   ADD CONSTRAINT "device_identities_one_identity_per_device_at_a_time"
--   UNIQUE ("device_id", "period" WITHOUT OVERLAPS);
--
-- ALTER TABLE "assets"."device_identities"
--   DROP CONSTRAINT "device_identities_one_device_per_identity_at_a_time";
-- ALTER TABLE "assets"."device_identities"
--   ADD CONSTRAINT "device_identities_one_device_per_identity_at_a_time"
--   UNIQUE ("identity_string", "period" WITHOUT OVERLAPS);

-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES NOT DO
--
-- `assets.charging_stations` and `protocol.ocpp_identities` are the
-- predecessors of these three tables. This migration does NOT touch either:
-- no ALTER, no DROP, no backfill, no data movement. They are MARKED FOR
-- RETIREMENT in docs and in code comments only.
--
-- Adding a successor and dropping a predecessor in one migration cannot be
-- rolled back without losing every row written in between. The retirement is
-- a separate, separately-approved migration that runs after a backfill has
-- been written, reviewed and reconciled.
-- ═══════════════════════════════════════════════════════════════════════════
