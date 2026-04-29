-- Pre-onboarding discoveries — gateway-side hook on unknown-identity
-- auth-fail upserts here so operators see chargers trying to connect
-- before any OcppIdentity row exists for them. Identity-string is PK
-- because the discovery is platform-wide before any org claims it.

CREATE TABLE "ocpp"."pending_discoveries" (
  "identity_string"      VARCHAR(64) NOT NULL,
  "first_seen_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "last_seen_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "attempt_count"        INTEGER NOT NULL DEFAULT 0,
  "remote_addr"          VARCHAR(64),
  "user_agent"           VARCHAR(255),
  "last_payload_summary" JSONB,

  CONSTRAINT "pending_discoveries_pkey" PRIMARY KEY ("identity_string")
);

CREATE INDEX "pending_discoveries_last_seen_at_idx"
  ON "ocpp"."pending_discoveries" ("last_seen_at" DESC);
