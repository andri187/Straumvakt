-- Correct 20260804010000, which was wrong and made things worse.
--
-- credentials_ref is TEXT, and the column holds two different conventions:
--
--   ocpp_identities  — a hardware.vendor_credentials UUID (set by
--                      attach-vendor; the one identity that worked)
--   installations    — a Zaptec USERNAME ('andrith187@gmail.com')
--
-- The previous migration resolved identities via the installation chain,
-- assuming both meant the same thing. They do not. It copied the username
-- into 30 identities, which is strictly worse than the NULL it replaced:
-- the application fallback chain only fires on NULL, so a non-NULL value
-- that resolves to nothing bypasses the fallback and fails without one.
--
-- Sets all identities to the actual credential UUID, which is what the
-- identity column means. Guarded on there being exactly one active
-- credential; with two or more this refuses rather than guesses, matching
-- the application's own refusal.
--
-- Not addressed here: installations.credentials_ref still holds a
-- username. Whether that column is meant to hold a username or a
-- credential id is a real question — one text column carrying two
-- conventions is how this happened, and a shared name made them look
-- interchangeable when they are not.

UPDATE "ocpp"."ocpp_identities" oi
   SET credentials_ref = (SELECT id::text FROM "hardware"."vendor_credentials" WHERE status = 'active'),
       updated_at      = now()
 WHERE (SELECT count(*) FROM "hardware"."vendor_credentials" WHERE status = 'active') = 1
   AND (oi.credentials_ref IS NULL
        OR NOT EXISTS (SELECT 1 FROM "hardware"."vendor_credentials" vc
                        WHERE vc.id::text = oi.credentials_ref));
