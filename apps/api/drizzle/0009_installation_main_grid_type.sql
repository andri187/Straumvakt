-- Installation supply system (TN / IT) on the main protection row. Additive and nullable: every existing installation
-- keeps NULL ("not specified"); nothing is backfilled and nothing is inferred from voltage or phase count.
-- NOT APPLIED to any database. Rehearse in a rolled-back transaction before any rollout.
ALTER TABLE "properties"."installations" ADD COLUMN "main_grid_type" text;--> statement-breakpoint
ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_main_grid_type_known_values"
  CHECK ("main_grid_type" IS NULL OR "main_grid_type" IN ('TN', 'IT'));
