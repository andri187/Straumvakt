#!/usr/bin/env tsx
/**
 * Seed a FAKE/dev N1 host_admin so the /host portal can be logged into on
 * staging before the real email-invite chain is wired (ADR 0027 path (b),
 * operator-approved 2026-06-06). Idempotent.
 *
 * Creates, under N1 ehf (b9f6a897…):
 *   1. identity.users        — host@n1.is, audience=operator, active
 *   2. identity.user_credentials — PBKDF2 hash of DEV_PASSWORD (app's hashPassword)
 *   3. tenancy.memberships   — role=host_admin, status=active
 *
 * Login: POST /api/admin/login {email, password} (Path B / UserCredential)
 * mints a session with userId; /api/admin/me then resolves persona=host_admin
 * and the /host portal opens scoped to N1.
 *
 * Reversible: delete the membership + user (cascade drops the credential).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { hashPassword } from "../src/lib/password";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_EHF_ORG = "b9f6a897-2401-45a3-9cde-b89d32fdb326";
const EMAIL = "host@n1.is";
const DISPLAY_NAME = "N1 Host Admin";
// Fake/dev credential — replaced by the real invite-set password later.
const DEV_PASSWORD = "Hladan-N1-2026!";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    // 0. confirm N1 exists + is a company host (sanity)
    const org = await c.query(
      `select display_name, kind::text from tenancy.organizations where id=$1`,
      [N1_EHF_ORG],
    );
    if (org.rowCount !== 1) throw new Error(`N1 org ${N1_EHF_ORG} not found`);
    console.log(`Org: ${org.rows[0].display_name} (kind=${org.rows[0].kind})`);

    // 1. user (find-or-create by email)
    let userId: string;
    const found = await c.query(
      `select id from identity.users where email=$1`,
      [EMAIL],
    );
    if (found.rowCount && found.rowCount > 0) {
      userId = found.rows[0].id;
      console.log(`User exists: ${EMAIL} -> ${userId}`);
    } else {
      const ins = await c.query(
        `insert into identity.users (email, display_name, audience, status)
         values ($1, $2, 'operator', 'active') returning id`,
        [EMAIL, DISPLAY_NAME],
      );
      userId = ins.rows[0].id;
      console.log(`User created: ${EMAIL} -> ${userId}`);
    }

    // 2. credential (upsert on user_id PK)
    const passwordHash = await hashPassword(DEV_PASSWORD);
    await c.query(
      `insert into identity.user_credentials (user_id, password_hash)
       values ($1, $2)
       on conflict (user_id) do update set password_hash = excluded.password_hash`,
      [userId, passwordHash],
    );
    console.log(`Credential set (PBKDF2).`);

    // 3. membership host_admin (upsert on (org_id,user_id) PK)
    await c.query(
      `insert into tenancy.memberships (org_id, user_id, role, status, accepted_at)
       values ($1, $2, 'host_admin', 'active', now())
       on conflict (org_id, user_id)
       do update set role='host_admin', status='active'`,
      [N1_EHF_ORG, userId],
    );
    console.log(`Membership: host_admin @ N1 ehf (active).`);

    console.log("\n=== DONE ===");
    console.log(`Login at /login (hlada-staging) with:`);
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${DEV_PASSWORD}`);
    console.log(`Then you land on /host scoped to N1 ehf.`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});
