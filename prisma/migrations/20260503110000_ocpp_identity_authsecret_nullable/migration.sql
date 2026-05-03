-- Make ocpp.ocpp_identities.auth_secret_hash nullable.
--
-- NULL semantics: "this identity accepts WebSocket upgrades without
-- Basic Auth." Operator opts in per installation by submitting an
-- empty plaintext through the installation OCPP password manager.
-- Default for newly-onboarded chargers stays populated; only the
-- explicit empty-set path nulls this column.
--
-- Backward-compatible: existing populated rows stay populated and
-- pass auth as before. Only newly-set NULLs activate the no-auth
-- path on the gateway side.

ALTER TABLE "ocpp"."ocpp_identities"
  ALTER COLUMN "auth_secret_hash" DROP NOT NULL;
