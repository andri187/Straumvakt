-- Sprint 9 / ADR 0019 follow-up — three-layer model schema delta.
--
-- Adds a single nullable column + CHECK to agreements.agreements:
--
--   cpo_org_id  — names which CPO ORG a *workplace* agreement (L2)
--                 binds at. NULL for type=cpo agreements (the
--                 counterparty IS the CPO, so the column would be
--                 redundant).
--
-- Per ADR 0019 addendum: a workplace's commercial deal is always with
-- a specific CPO. The route-handler's session-context builder uses
-- cpo_org_id to filter applicable workplace agreements per session
-- without inspecting JSONB scope filters.
--
-- The STR cost factor (Straumvaktargjald — Straumvakt platform fee)
-- is not seeded by this migration; it lands via prisma/seed.ts so the
-- factor catalog stays under the seed's control.
--
-- Migration is additive on top of agreements_v1; no rows exist yet.

ALTER TABLE "agreements"."agreements"
  ADD COLUMN "cpo_org_id" UUID;

ALTER TABLE "agreements"."agreements"
  ADD CONSTRAINT "agreements_cpo_org_id_fk"
  FOREIGN KEY ("cpo_org_id") REFERENCES "tenancy"."organizations"("id")
  ON DELETE RESTRICT;

ALTER TABLE "agreements"."agreements"
  ADD CONSTRAINT "agreements_cpo_org_id_consistency"
  CHECK (
    (agreement_type = 'cpo'       AND cpo_org_id IS NULL)
    OR
    (agreement_type = 'workplace' AND cpo_org_id IS NOT NULL)
  );

CREATE INDEX "agreements_cpo_org_id_idx"
  ON "agreements"."agreements" ("cpo_org_id");
