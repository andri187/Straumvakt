-- Sprint 9 / 2026-05-08 — capture Zaptec StateId 723 (CompletedSession)
-- payload onto charging.sessions when the AMQP handler observes session-end.
--
-- The 723 observation carries the full session JSON with embedded OCMF
-- SignedSession blob — the same shape as a /api/chargehistory entry. By
-- capturing it from AMQP we:
--   1. Stop waiting up to 5 min for the /chargehistory cron to enrich
--      ChargeSession (lower billing latency).
--   2. Persist OCMF IS / IT / ID / IL / IF identity fields. The IT/ID
--      pair is RFID UID today (IT='ISO14443') and will surface vehicle
--      MAC (IT='EVCCID') or PnC contract (IT='EMAID') the moment Zaptec
--      ships ISO 15118 firmware — no schema change required, just data
--      flowing through the same parser.
--   3. Stash the raw blob (completed_session_raw_json) so any future
--      Zaptec-added fields land automatically and can be exposed by a
--      parser update without re-fetching from /chargehistory.
--
-- All columns nullable / additive — backfill not required.

ALTER TABLE "charging"."sessions"
  ADD COLUMN "completed_session_raw_json"  JSONB,
  ADD COLUMN "ocmf_signed_session"         TEXT,
  ADD COLUMN "ocmf_format_version"         TEXT,
  ADD COLUMN "ocmf_gateway_id"             TEXT,
  ADD COLUMN "ocmf_gateway_serial"         TEXT,
  ADD COLUMN "ocmf_gateway_version"        TEXT,
  ADD COLUMN "auth_id_status"              BOOLEAN,                  -- OCMF IS
  ADD COLUMN "auth_id_level"               TEXT,                     -- OCMF IL
  ADD COLUMN "auth_id_type"                TEXT,                     -- OCMF IT (ISO14443 / EVCCID / EMAID / ...)
  ADD COLUMN "auth_id_value"               TEXT,                     -- OCMF ID
  ADD COLUMN "auth_id_flags"               TEXT[],                   -- OCMF IF
  ADD COLUMN "ocmf_first_reading_kwh"      NUMERIC(14, 4),
  ADD COLUMN "ocmf_last_reading_kwh"       NUMERIC(14, 4),
  ADD COLUMN "ocmf_signed_session_kwh"     NUMERIC(14, 4),           -- ocmf_last - ocmf_first
  ADD COLUMN "completed_session_seen_at"   TIMESTAMPTZ(6);           -- when 723 arrived

-- Index on auth_id_type + auth_id_value for "find sessions by RFID UID
-- / EVCCID / EMAID" lookups (partial — most rows have NULL on these).
CREATE INDEX "sessions_auth_id_type_value_idx"
  ON "charging"."sessions" ("auth_id_type", "auth_id_value")
  WHERE "auth_id_type" IS NOT NULL;
