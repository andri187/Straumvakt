-- SR-1 and SR-2 — the effective-dated interval on clauses and memberships.
--
-- ── THIS FILE IS NOT WHAT drizzle-kit GENERATED, AND THAT IS THE POINT ─────
--
-- drizzle-kit emitted, for both tables, one statement each:
--
--     ALTER TABLE ... ADD COLUMN "period" "tstzrange"
--       DEFAULT tstzrange(now(), NULL, '[)') NOT NULL;
--
-- That APPLIES CLEANLY and is WRONG, which is the worse of the two failure
-- modes. The default fills every pre-existing row with an interval starting
-- at the instant the migration ran — so every membership and every clause
-- that has existed for months would claim to have begun at migration time.
-- Decision 5 bills by overlap, so a billing run over any earlier period would
-- then find those rows invalid and count nobody. No error, no warning, a
-- smaller invoice.
--
-- (An earlier draft of this schema had no default at all. That version failed
-- LOUDLY — `column "period" contains null values` — on any table with rows,
-- and cleanly on an empty dev database, which is its own trap. The default is
-- needed for a different reason, in step 4; it is not a backfill.)
--
-- Rewritten as: add with the default, then OVERWRITE the pre-existing rows
-- from evidence. The default is left in place for new inserts.
--
-- VERB CENSUS, stated because this is the first migration this round that is
-- not CREATE-only: 2 UPDATE (both backfills, both bounded — see step 2), 2
-- DROP INDEX (both named below, both replaced by a plain index on the same
-- columns), 6 ALTER TABLE, 2 CREATE INDEX. No DROP TABLE, no DROP COLUMN, no
-- TRUNCATE, no DELETE.
--
-- Requires migration 0005, which creates the `btree_gist` extension.

-- ── 1 · Add the column ────────────────────────────────────────────────────
ALTER TABLE "agreements"."agreement_clauses" ADD COLUMN "period" "tstzrange" DEFAULT tstzrange(now(), NULL, '[)') NOT NULL;--> statement-breakpoint
ALTER TABLE "agreements"."driver_group_memberships" ADD COLUMN "period" "tstzrange" DEFAULT tstzrange(now(), NULL, '[)') NOT NULL;--> statement-breakpoint

-- ── 2 · Overwrite the pre-existing rows from evidence, not from `now()` ───
--
-- `[created_at, )` and `[added_at, )` are the honest lower bounds: the row
-- exists, so it was valid from at least the moment it was written, and it has
-- never been ended because until now nothing could end it. Both source
-- columns are NOT NULL, so neither UPDATE can produce a NULL.
--
-- Backdating further — to the agreement's start, or the group's creation —
-- would be a claim about the past that no evidence supports, and a fabricated
-- early bound is a fabricated charge. Backdating LESS, which is what the bare
-- generated statement does, silently un-bills real history.
--
-- BOUNDED BY `lower(period) >= <this transaction's start>`: the UPDATE touches
-- only rows still carrying the default just written, so re-running the
-- migration cannot re-stamp a row whose interval has since been managed.
UPDATE "agreements"."agreement_clauses"
   SET "period" = tstzrange("created_at", NULL, '[)')
 WHERE lower("period") >= now() AND upper_inf("period");--> statement-breakpoint
UPDATE "agreements"."driver_group_memberships"
   SET "period" = tstzrange("added_at", NULL, '[)')
 WHERE lower("period") >= now() AND upper_inf("period");--> statement-breakpoint

-- ── 3 · Well-formedness, same as 0005 ─────────────────────────────────────
ALTER TABLE "agreements"."agreement_clauses"
  ADD CONSTRAINT "agreement_clauses_period_well_formed"
  CHECK (NOT isempty("period") AND NOT lower_inf("period"));--> statement-breakpoint
ALTER TABLE "agreements"."driver_group_memberships"
  ADD CONSTRAINT "driver_group_memberships_period_well_formed"
  CHECK (NOT isempty("period") AND NOT lower_inf("period"));--> statement-breakpoint

-- ── 4 · The pair uniques come off ─────────────────────────────────────────
--
-- WHY EACH ONE HAS TO GO, rather than merely why the new one is nicer:
--
--   agreement_clauses (agreement_id, cost_factor_id)
--     said "one clause per factor, EVER". A rate that changed in July is two
--     clauses for one factor, so this index is the thing that makes changing
--     a rate impossible without rewriting what a settled period cost — which
--     FOCUS rule 4 forbids outright.
--
--   driver_group_memberships (driver_group_id, user_id)
--     made move-out-then-move-in inexpressible: the second row collided with
--     the first, so the only way to re-add a driver was to DELETE the record
--     of their first stay. ADR 0054 decision 4 exactly.
--
-- Each is replaced by a plain index on the same columns, so every existing
-- lookup keeps its access path. Only the uniqueness moves.
DROP INDEX "agreements"."agreement_clauses_agreement_id_cost_factor_id_index";--> statement-breakpoint
DROP INDEX "agreements"."driver_group_memberships_driver_group_id_user_id_index";--> statement-breakpoint
CREATE INDEX "agreement_clauses_agreement_id_cost_factor_id_index" ON "agreements"."agreement_clauses" USING btree ("agreement_id","cost_factor_id");--> statement-breakpoint
CREATE INDEX "driver_group_memberships_driver_group_id_user_id_index" ON "agreements"."driver_group_memberships" USING btree ("driver_group_id","user_id");--> statement-breakpoint

-- ── 5 · The temporal keys ─────────────────────────────────────────────────
--
-- Same two forms and the same choice as migration 0005; the block there
-- explains what differs between them. Form A is active.
--
-- THESE VALIDATE CLEANLY BECAUSE OF THE INDEXES STEP 4 REMOVED. Step 2 gives
-- every pre-existing row an open-ended period, so any two rows sharing a key
-- would now overlap — and the pair unique is precisely the guarantee that no
-- such pair exists. The old constraint is what makes the new one applicable.
--
-- Steps 4 and 5 must therefore run in ONE transaction, which is how the
-- migrator runs a file. Splitting them across two deployments opens a window
-- in which a duplicate can land and step 5 then refuses to validate.

ALTER TABLE "agreements"."agreement_clauses"
  ADD CONSTRAINT "agreement_clauses_one_clause_per_factor_at_a_time"
  EXCLUDE USING GIST ("agreement_id" WITH =, "cost_factor_id" WITH =, "period" WITH &&);--> statement-breakpoint

ALTER TABLE "agreements"."driver_group_memberships"
  ADD CONSTRAINT "driver_group_memberships_one_membership_at_a_time"
  EXCLUDE USING GIST ("driver_group_id" WITH =, "user_id" WITH =, "period" WITH &&);--> statement-breakpoint

-- ── FORM B — PostgreSQL 18+. Apply INSTEAD OF the two above. ──────────────
--
-- ALTER TABLE "agreements"."agreement_clauses"
--   DROP CONSTRAINT "agreement_clauses_one_clause_per_factor_at_a_time";
-- ALTER TABLE "agreements"."agreement_clauses"
--   ADD CONSTRAINT "agreement_clauses_one_clause_per_factor_at_a_time"
--   UNIQUE ("agreement_id", "cost_factor_id", "period" WITHOUT OVERLAPS);
--
-- ALTER TABLE "agreements"."driver_group_memberships"
--   DROP CONSTRAINT "driver_group_memberships_one_membership_at_a_time";
-- ALTER TABLE "agreements"."driver_group_memberships"
--   ADD CONSTRAINT "driver_group_memberships_one_membership_at_a_time"
--   UNIQUE ("driver_group_id", "user_id", "period" WITHOUT OVERLAPS);

-- ── SR-1's key, and where it differs from what was asked ──────────────────
--
-- SR-1 asked for `(agreement_id, factor_code, period WITHOUT OVERLAPS)`.
-- There is no `factor_code` column on `agreement_clauses`; the clause points
-- at a cost factor by `cost_factor_id`, and the code lives on the cost-factor
-- row. Serviced on the real column. If the intent was that two DIFFERENT
-- cost-factor rows sharing a code must also not overlap, that is a different
-- constraint, it needs a join, and it wants its own SR.
