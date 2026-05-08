-- Sprint 9 / 2026-05-08 — ADR 0021 Autocharge Step A
-- Vehicle identity capture across transport layers.
--
-- Three confidence tiers, all stored on charging.sessions alongside the
-- existing OCMF identity columns (auth_id_*) added on 2026-05-08:
--
--   Link layer        ev_plc_mac, ev_plc_mac_oui_vendor, ev_plc_pib_version
--                     (StateId 953, 921 — populated by AMQP consumer once Fly is back)
--
--   Protocol layer    pnc_attempted, pnc_succeeded, pnc_rejected_uuid
--                     (StateId 724, 725 — also AMQP-fed)
--
--   Application layer auth_id_* (already exists; populated by AMQP 723 OR
--                     OCPP MeterValues OCMF projection — Autocharge Step C)
--
--   Plus cable_type   (StateId 714) — Mode 3 / Type 2 / etc.
--
-- All columns are nullable. Per ADR 0021 §3, the rollout is the AMQP
-- consumer extension (Step B) for link/protocol-layer columns, and the
-- OCPP MeterValues projection (Step C) for application-layer.
--
-- Privacy: ev_plc_mac is treated as PII (ADR 0021 §9). UI gates surface
-- it only to operators with member.read permission, with last-3-bytes
-- redaction in non-privileged views. GDPR right-to-be-forgotten path
-- anonymizes via HMAC-SHA256 with per-installation salt — implemented
-- in code, not via this migration.

ALTER TABLE "charging"."sessions"
  ADD COLUMN "ev_plc_mac"            TEXT,
  ADD COLUMN "ev_plc_mac_oui_vendor" TEXT,
  ADD COLUMN "ev_plc_pib_version"    TEXT,
  ADD COLUMN "cable_type"            TEXT,
  ADD COLUMN "pnc_attempted"         BOOLEAN,
  ADD COLUMN "pnc_succeeded"         BOOLEAN,
  ADD COLUMN "pnc_rejected_uuid"     TEXT;

-- Partial index for the vehicle-recurrence lookup (Autocharge Step G —
-- "this same EV PLC MAC has plugged in N times across these chargers").
-- Partial because the vast majority of historical rows will have
-- ev_plc_mac NULL until the AMQP path lights up; partial keeps the index
-- compact.
CREATE INDEX "sessions_ev_plc_mac_idx"
  ON "charging"."sessions" ("ev_plc_mac")
  WHERE "ev_plc_mac" IS NOT NULL;
