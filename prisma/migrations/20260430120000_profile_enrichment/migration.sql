-- Profile enrichment round 2 — Sprint 3 / ADR 0013.
-- All additive (Rule 4). Default values keep existing rows in valid
-- state without rewrites: nullable columns stay null, JSONB defaults to
-- empty object so reads can dot-access without null guards.

-- ── identity.users ──────────────────────────────────────────────────
ALTER TABLE "identity"."users"
  ADD COLUMN "first_name"     TEXT,
  ADD COLUMN "middle_name"    TEXT,
  ADD COLUMN "last_name"      TEXT,
  ADD COLUMN "date_of_birth"  DATE,
  ADD COLUMN "photo_url"      TEXT,
  ADD COLUMN "address"        JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── properties.sites ────────────────────────────────────────────────
ALTER TABLE "properties"."sites"
  ADD COLUMN "opening_hours"  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "access_note"    TEXT,
  ADD COLUMN "photo_url"      TEXT;

-- ── assets.charging_stations ────────────────────────────────────────
-- BootNotification fields (1.6 §6.2) populated by the charger.booted
-- projection. Operator-domain fields edited directly on detail page.
ALTER TABLE "assets"."charging_stations"
  ADD COLUMN "charge_box_serial_number" TEXT,
  ADD COLUMN "meter_type"               TEXT,
  ADD COLUMN "meter_serial_number"      TEXT,
  ADD COLUMN "iccid"                    TEXT,
  ADD COLUMN "imsi"                     TEXT,
  ADD COLUMN "location_note"            TEXT,
  ADD COLUMN "mounting_type"            TEXT,
  ADD COLUMN "photo_url"                TEXT,
  ADD COLUMN "ip_rating"                TEXT,
  ADD COLUMN "breaker_amps"             INTEGER;

-- ── assets.connectors ───────────────────────────────────────────────
-- StatusNotification.errorCode + vendorErrorCode mirror (OCPP 1.6 §4.9).
ALTER TABLE "assets"."connectors"
  ADD COLUMN "error_code"        TEXT,
  ADD COLUMN "vendor_error_code" TEXT;
