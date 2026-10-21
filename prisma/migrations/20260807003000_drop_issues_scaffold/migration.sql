-- Drop the issues scaffold.
--
-- ── STATUS — corrected 2026-08-08, read the whole thing before acting ──
--
-- This file has never run as a migration on any branch, and is recorded in
-- _prisma_migrations nowhere. The previous header said exactly that ("NOT
-- APPLIED TO STAGING") and was, narrowly, true — but it read as though all
-- six statements were still outstanding, and that has not been true since
-- 2026-08-07. Measured directly against both Neon branches on 2026-08-08:
--
--   DROP TABLE x3 -- MOOT. All three tables are already gone from staging
--                    (br-tiny-river-abgpqq37) AND test
--                    (br-withered-hat-abtc5gzi). They were removed by
--                    20260807120000_drop_never_used_tables, which drops the
--                    same three among its 32. Re-running them is a no-op.
--
--   DROP TYPE x3  -- GENUINELY OUTSTANDING, ON STAGING ONLY.
--                    issues."IssueStatus", issues."IssueSeverity" and
--                    issues."IssueSubject" still exist on staging. Nothing
--                    else in the migration set drops them. They have zero
--                    dependent columns, so the drop is unblocked. On test
--                    they are already gone.
--
-- So staging and test disagree about this file, and this file is the only
-- thing that closes the gap.
--
-- Consequence for reconciliation: `migrate resolve --applied` on this
-- migration WITHOUT running it would record something untrue and strand
-- three enum types with no history entry that explains them. `migrate
-- deploy` is idempotent here -- every statement is IF EXISTS -- and leaves
-- history and database agreeing. The three DROP TYPEs are the only real DDL
-- in the file; IF EXISTS against an absent table takes no lock at all.
--
-- The original caution still stands: this runs against a database with 21
-- continuously-writing chargers, so it needs an explicit go-ahead.
--
-- Do not edit this header once the migration has been recorded. Prisma pins
-- a checksum per migration in _prisma_migrations; changing the file after a
-- row exists makes every later `migrate status` / `migrate deploy` fail.
-- While it remains unrecorded -- as now -- editing is free.
--
-- ── WHY THE SCAFFOLD GOES ─────────────────────────────────────────────
--
-- Measured 2026-08-07, before anything was dropped:
--   issues.tickets          0 rows
--   issues.ticket_events    0 rows
--   issues.detection_rules  0 rows
--   code references         0
--   endpoints               0
--
-- The issues engine is undesigned, and deliberately will not follow AMPECO's
-- or Driivz's shape. So scaffolding modelled on neither was holding a place
-- for a design that does not exist — and the domain rules were being argued
-- around it: the whole "platform imports nothing is wrong for issues" debate
-- was reasoning about three empty tables nobody had written a line against.
--
-- Schema declarations were removed in the same commit. This drops what was
-- left behind. Recreating them when the engine is designed costs one
-- migration; keeping them costs a permanent wrong answer to "what does
-- platform own".

DROP TABLE IF EXISTS "issues"."ticket_events";
DROP TABLE IF EXISTS "issues"."detection_rules";
DROP TABLE IF EXISTS "issues"."tickets";

DROP TYPE IF EXISTS "issues"."IssueStatus";
DROP TYPE IF EXISTS "issues"."IssueSeverity";
DROP TYPE IF EXISTS "issues"."IssueSubject";
