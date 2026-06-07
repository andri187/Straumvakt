#!/usr/bin/env tsx
/**
 * Set the demo passwords for host@n1.is + driver@n1.is to a simple value
 * (staging only). Operator-requested 2026-06-07. Uses the app's PBKDF2 hashing.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { hashPassword } from "../src/lib/password";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const NEW_PASSWORD = "1234";
const EMAILS = ["host@n1.is", "driver@n1.is"];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    for (const email of EMAILS) {
      const u = await c.query(`select id from identity.users where email=$1`, [email]);
      if (u.rowCount !== 1) {
        console.log(`SKIP ${email} — not found`);
        continue;
      }
      const hash = await hashPassword(NEW_PASSWORD);
      await c.query(
        `insert into identity.user_credentials (user_id, password_hash)
         values ($1, $2)
         on conflict (user_id) do update set password_hash = excluded.password_hash`,
        [u.rows[0].id, hash],
      );
      console.log(`set password for ${email}`);
    }
    console.log(`\nDONE — host@n1.is + driver@n1.is password = ${NEW_PASSWORD}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
