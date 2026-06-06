#!/usr/bin/env tsx
/**
 * Reset the FAKE/dev N1 driver password so the mobile driver app can log in
 * on staging (the pilot password is unknown). Idempotent. Operator-approved
 * 2026-06-06 ("fake the users, wire email chain later").
 *
 * Targets the existing driver user n1@n1.is (audience=driver). Only the
 * credential is upserted — the user + driver-group membership are untouched.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { hashPassword } from "../src/lib/password";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const EMAIL = "n1@n1.is";
const DEV_PASSWORD = "Hladan-N1-2026!";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const u = await c.query(
      `select id, audience::text from identity.users where email=$1`,
      [EMAIL],
    );
    if (u.rowCount !== 1) throw new Error(`driver ${EMAIL} not found`);
    const userId = u.rows[0].id as string;
    console.log(`Driver: ${EMAIL} (${u.rows[0].audience}) -> ${userId}`);

    const passwordHash = await hashPassword(DEV_PASSWORD);
    await c.query(
      `insert into identity.user_credentials (user_id, password_hash)
       values ($1, $2)
       on conflict (user_id) do update set password_hash = excluded.password_hash`,
      [userId, passwordHash],
    );
    console.log("\n=== DONE ===");
    console.log(`Driver login (mobile app):`);
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${DEV_PASSWORD}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});
