-- Add system-wide unique constraint on assets.charging_stations.serial_number.
-- Operator-facing semantics: a charger's serial is its global UID — two
-- chargers can never share the same serial in the platform. Prisma's
-- @@unique on the model side mirrors this constraint at the type layer.
--
-- Backfill ran out-of-band before this migration via the operator's
-- Sprint 3 session (see chat history): serial_number was set to
-- UPPER(ocpp_identity.identity_string) for every Zaptec-vendor
-- charger so the column reflects the Zaptec DeviceId rather than the
-- previously-stored operator-editable display name. Pre-migration
-- check confirmed zero duplicates.
--
-- NULLs remain allowed; Postgres treats multiple NULLs as distinct in
-- unique constraints by default, so chargers without a serial coexist
-- without conflict.

ALTER TABLE assets.charging_stations
ADD CONSTRAINT charging_stations_serial_number_key UNIQUE (serial_number);
