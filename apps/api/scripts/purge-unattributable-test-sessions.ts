#!/usr/bin/env tsx

export {};

/**
 * Delete charging sessions that carry no id_tag, or an id_tag other than the
 * one real test card. Operator instruction 2026-08-07: this is logged test
 * data and carries no value.
 *
 * WHY IT IS SAFE TO DELETE AND WHY THAT IS NOT OBVIOUS
 * ---------------------------------------------------
 * Almost everything cascades from charging.sessions — meter_values (and all
 * ~100 daily partitions), protocol_transaction_refs, imported_cdr_refs, and
 * BOTH billing_lines tables. Those go automatically.
 *
 * reports.session_ledger does NOT. It has no foreign key to sessions, so a
 * plain DELETE leaves an orphaned priced row per session — and session_ledger
 * is the record ADR 0048 names as protected. There are already 2 orphans in
 * it, which is what that missing constraint looks like in practice.
 *
 * So the ledger rows are deleted explicitly, first, in the same transaction.
 *
 * WHAT SURVIVES
 * -------------
 * Sessions tagged EE43C609263CC7 — driver@n1.is, the card on the majority of
 * logged CDRs, at N1's Dalvegur installation. That is the one chain that can
 * actually be priced: user -> driver group -> active agreement -> matching
 * installation -> clauses for DSO (Veitur) and ELE (N1 as retailer).
 *
 * RULE 3: pass the connection string explicitly. This deletes.
 *
 *   DATABASE_URL=... npx tsx scripts/purge-unattributable-test-sessions.ts
 *   DATABASE_URL=... npx tsx scripts/purge-unattributable-test-sessions.ts --apply
 */

import { Pool } from "pg";

const apply = process.argv.includes("--apply");
const KEEP = process.env.KEEP_ID_TAG ?? "EE43C609263CC7";
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is required — this script deletes, so it will not guess.");
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const { rows: [before] } = await client.query(
      `select
         (select count(*) from charging.sessions)                                as sessions,
         (select count(*) from charging.sessions where id_tag = $1)              as keeping,
         (select count(*) from charging.sessions where id_tag is distinct from $1) as deleting,
         (select count(*) from reports.session_ledger)                            as ledger,
         (select count(*) from charging.meter_values)                             as meter_values`,
      [KEEP],
    );
    console.log(`${apply ? "APPLYING" : "DRY RUN"} — keeping id_tag = ${KEEP}\n`);
    console.log(`  sessions        ${before.sessions}  ->  ${before.keeping}   (deleting ${before.deleting})`);
    console.log(`  session_ledger  ${before.ledger}`);
    console.log(`  meter_values    ${before.meter_values}  (cascades)`);

    if (!apply) {
      console.log("\n  dry run — pass --apply to delete.");
      return;
    }

    await client.query("BEGIN");
    // session_ledger first: no FK, so a cascade will not reach it.
    const led = await client.query(
      `delete from reports.session_ledger l
        using charging.sessions s
        where s.id = l.session_id and s.id_tag is distinct from $1`,
      [KEEP],
    );
    const ses = await client.query(
      `delete from charging.sessions where id_tag is distinct from $1`,
      [KEEP],
    );
    await client.query("COMMIT");

    const { rows: [after] } = await client.query(
      `select
         (select count(*) from charging.sessions)      as sessions,
         (select count(*) from reports.session_ledger) as ledger,
         (select count(*) from charging.meter_values)  as meter_values,
         (select count(*) from reports.session_ledger l
            where not exists (select 1 from charging.sessions s where s.id = l.session_id)) as orphans`,
    );
    console.log(`\n  deleted ${led.rowCount} ledger rows, ${ses.rowCount} sessions.`);
    console.log(`  now: sessions ${after.sessions} · ledger ${after.ledger} · meter_values ${after.meter_values} · ledger orphans ${after.orphans}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})();
