-- Drop the issues scaffold.
--
-- NOT APPLIED TO STAGING. Written so the drop is reviewable and ready; it
-- needs an explicit go-ahead, because every migration against staging runs
-- under 21 continuously-writing chargers.
--
-- Measured 2026-08-07 before writing this:
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
