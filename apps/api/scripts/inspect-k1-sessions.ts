#!/usr/bin/env tsx
/**
 * Show every Zaptec rawPayload we have for ZPR042344 (K1) and
 * union every key across all sessions. Definitive answer to
 * "what user data do we have today for K1?" from existing imports.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Find K1's chargingStationId via OcppIdentity (DeviceId-based isn't
  // direct — use the rawPayload DeviceId instead).
  const r = await c.query(
    `select source_cdr_id, raw_payload, imported_at
     from charging.imported_cdr_refs
     where source_kind = 'zaptec'
       and raw_payload->>'DeviceId' = 'ZPR042344'
     order by raw_payload->>'StartDateTime' desc`,
  );

  console.log(`Found ${r.rowCount} K1 (ZPR042344) session(s) in our DB.\n`);

  // Union all keys across all sessions
  const allKeys = new Set<string>();
  for (const row of r.rows) {
    for (const k of Object.keys(row.raw_payload)) allKeys.add(k);
  }
  console.log(`Union of all keys present in any K1 session payload:`);
  for (const k of [...allKeys].sort()) {
    console.log(`  ${k}`);
  }

  // Highlight user-like keys
  const userKeys = [...allKeys].filter((k) => /user|driver|rfid|card|tag|auth/i.test(k));
  console.log(
    `\nUser/auth-related keys present: ${userKeys.length > 0 ? userKeys.join(", ") : "(none)"}`,
  );

  // Show one full sample for visual confirmation
  if (r.rows.length > 0) {
    console.log(`\nMost-recent K1 session (full payload):`);
    console.log(JSON.stringify(r.rows[0].raw_payload, null, 2));
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
