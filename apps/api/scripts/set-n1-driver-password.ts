#!/usr/bin/env tsx
// Sprint 9 / 2026-05-10 — One-shot: set N1 Drivers' password to '12345678'
// for pilot login testing. Operator-only; this is a weak password and
// must be rotated via the admin UI's Sign-in password panel before any
// non-pilot traffic.

import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { hashPassword } from "../src/lib/password.ts";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_DRIVERS_USER_ID = "91a2fae3-8fb0-467a-be99-d613e6d3fd78";
const PASSWORD = "1234";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const passwordHash = await hashPassword(PASSWORD);
  const r = await c.query(
    `insert into identity.user_credentials (user_id, password_hash, created_at)
     values ($1, $2, now())
     on conflict (user_id) do update set password_hash = excluded.password_hash
     returning user_id`,
    [N1_DRIVERS_USER_ID, passwordHash],
  );
  console.log(`✅ Password set for user ${r.rows[0].user_id}`);
  console.log(`   email:    n1@n1.is`);
  console.log(`   password: ${PASSWORD}  (PILOT ONLY — rotate before production)`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
