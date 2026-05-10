#!/usr/bin/env tsx
// Sprint 9 / 2026-05-10 — Flip N1 Drivers User to audience='driver'
// so the driver-app login route accepts them. Operator-only one-shot.
//
// No password is set here — operator does that via the admin UI's
// new "Sign-in password" panel on the user detail page. This script
// only flips audience.

import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_DRIVERS_USER_ID = "91a2fae3-8fb0-467a-be99-d613e6d3fd78";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const before = await c.query(
    `select id, email, audience, status from identity.users where id = $1`,
    [N1_DRIVERS_USER_ID],
  );
  if (before.rowCount !== 1) {
    console.error(`ABORT: user ${N1_DRIVERS_USER_ID} not found.`);
    await c.end();
    process.exit(1);
  }
  console.log("Before:", JSON.stringify(before.rows[0]));

  const after = await c.query(
    `update identity.users set audience = 'driver', updated_at = now()
      where id = $1
      returning id, email, audience, status`,
    [N1_DRIVERS_USER_ID],
  );
  console.log("After: ", JSON.stringify(after.rows[0]));

  await c.end();
  console.log("\n✅ Done. Set their password via the admin UI's Sign-in password panel,");
  console.log("   then log into the driver app at /api/driver/login.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
