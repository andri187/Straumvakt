-- Additive index only (no table rewrite, no data statement). Prepared locally; NOT applied to Neon.
-- Serves the driver live-access grant: a driver's OPEN sessions by user. Partial, so it holds only sessions in progress.
-- CREATE INDEX takes a brief write lock on charging.ocpp_transactions; apply in a quiet moment (the table is small today).
CREATE INDEX "ocpp_transactions_open_by_user_index" ON "charging"."ocpp_transactions" USING btree ("user_id") WHERE "charging"."ocpp_transactions"."stopped_received_at" IS NULL AND "charging"."ocpp_transactions"."user_id" IS NOT NULL;
