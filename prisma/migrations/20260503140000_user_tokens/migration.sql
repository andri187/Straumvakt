-- Sprint 5.6 / ADR 0017 — UserToken table for one-shot
-- authentication artefacts (invite, magic-link, password-reset).
--
-- Pure additive migration: new enum, new table, no changes to
-- existing UserCredential or User. Backwards-compatible — existing
-- code that doesn't know about UserToken keeps working.

CREATE TYPE "identity"."UserTokenKind" AS ENUM ('invite', 'magic_link', 'password_reset');

CREATE TABLE "identity"."user_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "identity"."UserTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "identity"."user_tokens"("token_hash");

CREATE INDEX "user_tokens_user_id_kind_expires_at_idx" ON "identity"."user_tokens"("user_id", "kind", "expires_at");

ALTER TABLE "identity"."user_tokens"
    ADD CONSTRAINT "user_tokens_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "identity"."users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
