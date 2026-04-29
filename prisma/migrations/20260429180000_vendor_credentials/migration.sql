-- VendorCredential — per-org vendor portal credentials (Zaptec, Easee,
-- Kempower, etc). Password is AES-GCM-encrypted with a Worker-side
-- KEK (OCPP_CRED_KEK secret) before insert; DB never holds plaintext.
-- ownerOrgId is the org that "owns" the relationship — operators use
-- this for the access-control predicate (org members see their org's
-- credentials, platform admin sees all).

CREATE TABLE "hardware"."vendor_credentials" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_org_id"    UUID NOT NULL,
  "vendor_id"       UUID NOT NULL,
  "username"        VARCHAR(200) NOT NULL,
  "password_cipher" BYTEA,
  "password_iv"     BYTEA,
  "status"          TEXT NOT NULL DEFAULT 'active',
  "last_used_at"    TIMESTAMPTZ(6),
  "notes"           VARCHAR(500),
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "vendor_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_credentials_owner_org_id_fkey"
    FOREIGN KEY ("owner_org_id") REFERENCES "tenancy"."organizations" ("id")
    ON DELETE CASCADE,
  CONSTRAINT "vendor_credentials_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "hardware"."vendors" ("id")
);

CREATE UNIQUE INDEX "vendor_credentials_owner_org_id_vendor_id_username_key"
  ON "hardware"."vendor_credentials" ("owner_org_id", "vendor_id", "username");

CREATE INDEX "vendor_credentials_owner_org_id_idx"
  ON "hardware"."vendor_credentials" ("owner_org_id");

-- Installation gets a typed FK to vendor_credentials. The legacy
-- credentials_ref TEXT column stays in place (additive only per
-- Rule 4) so existing rows / readers are unaffected. New imports
-- populate credentials_id; future cleanup pass can drop credentials_ref.

ALTER TABLE "properties"."installations"
  ADD COLUMN "credentials_id" UUID;

ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_credentials_id_fkey"
    FOREIGN KEY ("credentials_id") REFERENCES "hardware"."vendor_credentials" ("id")
    ON DELETE SET NULL;
