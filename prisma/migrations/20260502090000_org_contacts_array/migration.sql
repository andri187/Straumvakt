-- Bring back contacts JSONB on organizations — typed array shape
-- per ADR 0014 follow-up. Shape:
--   [{ role, name, email?, phone?, notes? }]
-- Default empty array. Additive (Rule 4 OK).
ALTER TABLE "tenancy"."organizations"
  ADD COLUMN IF NOT EXISTS "contacts" JSONB NOT NULL DEFAULT '[]'::jsonb;
