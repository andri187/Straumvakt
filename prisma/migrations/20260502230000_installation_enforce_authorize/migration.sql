-- Sprint 4 milestone 4.6 — Installation.enforceAuthorize flag.
--
-- Per-installation gate: when true, the OCPP gateway honours the
-- verdict returned by /api/internal/ocpp-authorize for every
-- Authorize.req at chargers under this installation. When false
-- (default), gateway logs the verdict for observability but always
-- replies Accepted (today's shadow-mode behaviour).
--
-- Additive only — Rule 4 OK. Default false preserves current
-- behaviour for every existing row; operator flips per-installation
-- once the IdToken table is verified seeded.

ALTER TABLE "properties"."installations"
  ADD COLUMN IF NOT EXISTS "enforce_authorize" BOOLEAN NOT NULL DEFAULT false;
