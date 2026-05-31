#!/usr/bin/env tsx
import { Client } from "pg";
import { config as d } from "dotenv";
import { resolve } from "node:path";
d({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `select table_schema, table_name from information_schema.tables
      where table_name ilike 'site%' or table_name ilike '%asset%'
      order by 1,2`,
  );
  for (const row of r.rows) console.log(row.table_schema + "." + row.table_name);
  await c.end();
})();
