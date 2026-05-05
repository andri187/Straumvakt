#!/usr/bin/env tsx
/**
 * Inspect one imported Zaptec session's rawPayload to see what fields
 * /api/chargehistory actually returned for Dalvegur. Authoritative
 * answer to "what data does this endpoint give us" — no docs guessing.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const r = await c.query(
    `select source_cdr_id, raw_payload, imported_at
     from charging.imported_cdr_refs
     where source_kind = 'zaptec'
     order by imported_at desc
     limit 3`,
  );

  console.log(`Inspecting ${r.rowCount} most-recent Zaptec import(s):\n`);
  for (const row of r.rows) {
    console.log("─".repeat(70));
    console.log(`Imported: ${row.imported_at.toISOString()}`);
    console.log(`Zaptec session id: ${row.source_cdr_id}`);
    console.log(`\nKeys present in rawPayload:`);
    const keys = Object.keys(row.raw_payload).sort();
    for (const k of keys) {
      const v = row.raw_payload[k];
      const display =
        v === null
          ? "null"
          : typeof v === "string"
            ? v.length > 60
              ? `"${v.slice(0, 60)}…" (${v.length} chars)`
              : `"${v}"`
            : typeof v === "object"
              ? `${JSON.stringify(v).slice(0, 60)}…`
              : String(v);
      console.log(`  ${k.padEnd(30)} ${display}`);
    }
    console.log("");
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
