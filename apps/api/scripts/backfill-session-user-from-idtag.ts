#!/usr/bin/env tsx

export {};

/**
 * Backfill charging.sessions.user_id from id_tag, where the tag already
 * resolves to an identity.id_tokens row.
 *
 * WHY
 * ---
 * Billing cannot price what it cannot attribute, and attribution was the
 * blocker — not the pricing model. Measured on staging 2026-08-07:
 *
 *   completed sessions        1,619
 *   ...with any id_tag           89
 *   ...already attributed         8
 *   ...RESOLVABLE right now      56   <- token exists, link never made
 *   ...tag unknown               25
 *   ...no tag at all          1,530   <- free vend, enforceAuthorize is false
 *
 * The 56 are not unknown drivers. EE43C609263CC7 maps to driver@n1.is in
 * id_tokens, status active, and 57 sessions carry that tag with a null
 * user_id. The resolution simply never ran.
 *
 * `sessions.id_tag` is EVIDENCE and `sessions.user_id` is ATTRIBUTION — the
 * 2026-08-04 decision says they are allowed to disagree, and a NULL user_id
 * is a legitimate state. This does not change that. It only fills in the
 * cases where the evidence resolves and nobody joined it up.
 *
 * SAFETY
 * ------
 * - Only touches rows where user_id IS NULL. Never overwrites attribution.
 * - Only matches an EXACT id_tokens.value. No fuzzy matching, no guessing.
 * - Ignores revoked/expired tokens by default: a card that was revoked after
 *   the session still identifies who tapped, but that is a judgement call, so
 *   --include-revoked has to be passed deliberately.
 * - --dry-run by default. Writing requires --apply.
 *
 * RULE 3: pass the connection string explicitly. This writes.
 *
 *   DATABASE_URL=... npx tsx scripts/backfill-session-user-from-idtag.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-session-user-from-idtag.ts --apply
 */

import { Pool } from "pg";

const apply = process.argv.includes("--apply");
const includeRevoked = process.argv.includes("--include-revoked");
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is required — this script writes, so it will not guess.");
  process.exit(1);
}

const statusFilter = includeRevoked ? "" : "and t.status = 'active'";

const PREVIEW = `
  select t.value as id_tag, u.email, count(*)::int as sessions,
         min(s.ended_at) as oldest, max(s.ended_at) as newest,
         sum(coalesce(s.energy_wh,0))::bigint as total_wh
    from charging.sessions s
    join identity.id_tokens t on t.value = s.id_tag ${statusFilter}
    join identity.users u on u.id = t.user_id
   where s.user_id is null and s.id_tag is not null
   group by t.value, u.email
   order by count(*) desc`;

const UPDATE = `
  update charging.sessions s
     set user_id = t.user_id
    from identity.id_tokens t
   where t.value = s.id_tag ${statusFilter}
     and s.user_id is null
     and s.id_tag is not null`;

(async () => {
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query(PREVIEW);
    if (rows.length === 0) {
      console.log("nothing to backfill — every resolvable session already carries a user.");
      return;
    }
    console.log(`${apply ? "APPLYING" : "DRY RUN"}${includeRevoked ? " (including revoked tokens)" : ""}\n`);
    let total = 0;
    for (const r of rows) {
      total += r.sessions;
      console.log(
        `  ${r.id_tag.padEnd(20)} ${String(r.email).padEnd(26)} ${String(r.sessions).padStart(4)} sessions` +
          `  ${(Number(r.total_wh) / 1000).toFixed(1)} kWh` +
          `  ${String(r.oldest).slice(0, 10)} .. ${String(r.newest).slice(0, 10)}`,
      );
    }
    console.log(`\n  ${total} sessions would be attributed.`);

    if (!apply) {
      console.log("\n  dry run — pass --apply to write.");
      return;
    }
    const res = await pool.query(UPDATE);
    console.log(`\n  updated ${res.rowCount} rows.`);
  } finally {
    await pool.end();
  }
})();
