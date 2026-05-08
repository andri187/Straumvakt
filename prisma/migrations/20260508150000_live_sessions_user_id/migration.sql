-- Sprint 9 / 2026-05-08 — real-time driver enrichment via AMQP StateId 722.
--
-- Zaptec's StateId 722 (`ChargerCurrentUserUuid`) carries the active
-- driver's Zaptec UUID. Mapping it to a Straumvakt User via
-- identity.user_vendor_refs (vendor_slug='zaptec') gives us userId on
-- live_sessions in real time — no waiting for the every-5-min
-- /chargehistory cron.
--
-- Nullable + ON DELETE SET NULL: if the operator removes a User row
-- mid-session, the live_session keeps running but loses the user_id
-- attribution. Defensive — won't break the session.

ALTER TABLE "charging"."live_sessions"
  ADD COLUMN "user_id" UUID,
  ADD CONSTRAINT "live_sessions_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL;

CREATE INDEX "live_sessions_user_idx"
  ON "charging"."live_sessions" ("user_id");
