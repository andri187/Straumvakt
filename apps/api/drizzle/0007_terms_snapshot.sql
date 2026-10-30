ALTER TABLE "charging"."ocpp_transactions" ADD COLUMN "terms_snapshot" jsonb;--> statement-breakpoint
-- Hand-written below. Additive (a new function and trigger); no data is read or written by this migration.
-- Once a transaction has a terms snapshot, it can never be changed: a priced session must always be explainable from
-- the terms captured at its start, however the agreement/rate/rule tables are edited afterwards. A NULL snapshot
-- (a transaction started before this contract) may be set exactly once.
CREATE FUNCTION "charging"."ocpp_transactions_terms_immutable"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD."terms_snapshot" IS NOT NULL AND NEW."terms_snapshot" IS DISTINCT FROM OLD."terms_snapshot" THEN
    RAISE EXCEPTION 'terms_snapshot is immutable once captured (transaction %)', OLD."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER "ocpp_transactions_terms_immutable"
  BEFORE UPDATE ON "charging"."ocpp_transactions"
  FOR EACH ROW
  WHEN (OLD."terms_snapshot" IS NOT NULL)
  EXECUTE FUNCTION "charging"."ocpp_transactions_terms_immutable"();
