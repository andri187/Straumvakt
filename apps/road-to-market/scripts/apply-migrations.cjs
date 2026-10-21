const { Client } = require('pg');
const fs = require('fs'), path = require('path');
const DIR = 'E:/Claude/Straumvakt-connected-test/apps/api/drizzle';
const order = ['0000_baseline','0002_powerful_warbird','0003_handy_stranger','0004_tough_reaper','0005_supreme_psylocke','0006_heavy_cobalt_man','0007_mean_overlord','0008_worthless_mimic'];
(async () => {
  const c = new Client({ connectionString: process.env.TEST_DB_DIRECT, ssl: { rejectUnauthorized: false } });
  await c.connect();
  // 1. reset: drop all non-system schemas (clean slate, re-runnable)
  const { rows } = await c.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast','public') AND nspname NOT LIKE 'pg_%'`);
  for (const r of rows) await c.query(`DROP SCHEMA IF EXISTS "${r.nspname}" CASCADE`);
  await c.query(`DROP TABLE IF EXISTS public.__drizzle_migrations CASCADE`);
  // 2. extensions the baseline assumes
  await c.query(`CREATE EXTENSION IF NOT EXISTS citext`);
  await c.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
  console.log(`reset: dropped ${rows.length} schemas; citext + btree_gist ready`);
  // 3. apply migrations in order
  for (const name of order) {
    const sql = fs.readFileSync(path.join(DIR, name + '.sql'), 'utf8');
    const stmts = sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
    let i = 0;
    for (const st of stmts) {
      i++;
      try { await c.query(st); }
      catch (e) {
        console.log(`ERROR in ${name} stmt ${i}/${stmts.length}: ${e.message}`);
        console.log('  head:', st.slice(0,160).replace(/\s+/g,' '));
        await c.end(); process.exit(1);
      }
    }
    console.log(`OK ${name} (${stmts.length} statements)`);
  }
  await c.end();
  console.log('ALL MIGRATIONS APPLIED');
})().catch(e=>{ console.log('FATAL', e.message); process.exit(1); });
