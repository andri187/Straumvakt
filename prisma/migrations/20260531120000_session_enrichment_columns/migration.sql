-- Sprint 9 / ENRICH-1 — per-source enrichment columns + verifiedSource.
--
-- Three feeds converge into charging.sessions today: the OCPP gateway
-- (StartTransaction / MeterValues / StopTransaction), Zaptec REST
-- /chargehistory (CDR sync), and Zaptec AMQP (StateId 723
-- CompletedSession). Before this migration the later writers silently
-- overwrote the OCPP-side `energy_wh` and `ended_at` — billing had no
-- audit trail of which source produced the final number.
--
-- This migration is PURELY ADDITIVE per Rule 4 + Rule 5:
--   * Six nullable mirror columns on charging.sessions (one per source
--     × energy / stopped_at, plus an OCMF blob reference).
--   * Two nullable provenance columns on reports.session_ledger
--     (verified_source + enrichment_status) — TEXT not enum per
--     ADR 0019 convention; validation enforced at the application
--     layer.
--
-- No DROP, no RENAME, no ALTER TYPE on existing columns. Canonical
-- columns (sessions.energy_wh, sessions.ended_at) stay intact;
-- billing reads unchanged. Existing rows survive without backfill —
-- the new columns are NULL until the next session write touches them.
--
-- Operator applies via `prisma migrate deploy` — see ENRICH-1 task
-- spec. The application-layer writers in this same commit populate
-- the new columns without changing cost-math behaviour.

ALTER TABLE "charging"."sessions"
  ADD COLUMN "ocpp_energy_kwh" DECIMAL(10, 4),
  ADD COLUMN "cdr_energy_kwh"  DECIMAL(10, 4),
  ADD COLUMN "amqp_energy_kwh" DECIMAL(10, 4),
  ADD COLUMN "ocpp_stopped_at" TIMESTAMPTZ(6),
  ADD COLUMN "cdr_stopped_at"  TIMESTAMPTZ(6),
  ADD COLUMN "ocmf_blob_ref"   TEXT;

ALTER TABLE "reports"."session_ledger"
  ADD COLUMN "verified_source"   TEXT,
  ADD COLUMN "enrichment_status" TEXT;
