CREATE TABLE "assets"."vendor_config_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"observed_at" timestamp (6) with time zone NOT NULL,
	"charger_active" boolean,
	"authentication_type" integer,
	"is_authorization_required" boolean,
	"ocpp_default_id_tag" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets"."evses" ADD COLUMN "device_id" uuid;--> statement-breakpoint
CREATE INDEX "vendor_config_observations_device_id_observed_at_index" ON "assets"."vendor_config_observations" USING btree ("device_id","observed_at");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- HAND-WRITTEN BELOW THIS LINE. NOT PRODUCED BY drizzle-kit.
--
-- ADR 0054 item 11 — the connector status vocabulary is OCPP's, not ours.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The nine values are OCPP 1.6 §4.9 verbatim, capitalisation included. The
-- tenth permitted value, `unknown`, is NOT a protocol value: it is the stored
-- form of "no StatusNotification has ever been received", and it is
-- deliberately not `Unavailable`.
--
-- That distinction is the reason this constraint is worth having. OCPP HAS a
-- status called `Unavailable`, so writing it for a connector we have never
-- heard from would look like reporting rather than inventing. It is a
-- different claim — `Unavailable` means the charger told us it is out of
-- service — and a connector that has never reported is not one an operator
-- should be dispatched to.
--
-- ── WHY `NOT VALID`, WHICH IS NOT A HEDGE ────────────────────────────────
--
-- `NOT VALID` means Postgres enforces the constraint on every INSERT and
-- UPDATE from this moment on, and does NOT scan the existing rows. That is
-- exactly the right shape here for two reasons:
--
--   1 · No database in this lane has been read. `evses.status` and
--       `connectors.status` are plain `text` columns with a `'unknown'`
--       default and no constraint has ever governed them, so what is actually
--       in them is not known. A validating constraint would fail the whole
--       migration on the first non-conforming row and take everything after it
--       down with it.
--   2 · It stops the bleeding immediately. A house value written tomorrow is
--       refused whether or not yesterday's rows are clean.
--
-- TO FINISH IT, once a census has been run and any offenders corrected:
--
--   SELECT status, count(*) FROM assets.connectors GROUP BY 1;
--   SELECT status, count(*) FROM assets.evses GROUP BY 1;
--   ALTER TABLE assets.connectors VALIDATE CONSTRAINT connectors_status_is_ocpp_vocabulary;
--   ALTER TABLE assets.evses      VALIDATE CONSTRAINT evses_status_is_ocpp_vocabulary;
--
-- VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock, so it does not block
-- reads or writes. There is no reason to defer it beyond the census.

ALTER TABLE "assets"."connectors"
  ADD CONSTRAINT "connectors_status_is_ocpp_vocabulary"
  CHECK ("status" IN (
    'Available', 'Preparing', 'Charging', 'SuspendedEV', 'SuspendedEVSE',
    'Finishing', 'Reserved', 'Unavailable', 'Faulted',
    'unknown'
  )) NOT VALID;--> statement-breakpoint

-- `evses.status` carries the same vocabulary. OCPP 1.6 reports status per
-- connector and treats connectorId 0 as the station itself, so an EVSE's
-- status is the same alphabet read at a different level of the hierarchy —
-- not a second vocabulary that happens to look similar.
ALTER TABLE "assets"."evses"
  ADD CONSTRAINT "evses_status_is_ocpp_vocabulary"
  CHECK ("status" IN (
    'Available', 'Preparing', 'Charging', 'SuspendedEV', 'SuspendedEVSE',
    'Finishing', 'Reserved', 'Unavailable', 'Faulted',
    'unknown'
  )) NOT VALID;--> statement-breakpoint

-- ── What 0007 does NOT do ────────────────────────────────────────────────
--
-- `evses.device_id` is added NULLABLE and is NOT backfilled. Both parents
-- coexist until `charging_stations` retires: a backfill in the same migration
-- that adds the column would have to invent the device rows it points at, and
-- there is no reconciled mapping yet. See
-- docs/notes/2026-08-28-asset-model-retirement-plan.md.
--
-- Nothing here touches `assets.connectors`' shape. ADR 0054 decision 4 is
-- explicit that a connector is NOT a dated membership — it is a child of the
-- device and does not migrate between devices — so it gains no `period`.
