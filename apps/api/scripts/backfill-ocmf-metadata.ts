#!/usr/bin/env tsx
/**
 * Sprint 9 / 2026-05-08 — backfill OCMF metadata onto charging.sessions
 * for sessions that were imported via the legacy /chargehistory path
 * (pre-AMQP-723). The signed OCMF envelope already lives in
 * charging.imported_cdr_refs.raw_payload.SignedSession; we just parse
 * it and persist the broken-out columns added in
 * 20260508160000_charge_sessions_completed_session_capture.
 *
 * Idempotent: only touches sessions where completed_session_seen_at
 * is NULL.
 *
 * Identity fields (auth_id_*) stay NULL — historical Zaptec firmware
 * (3.2.x) doesn't populate IS/IT/ID in OCMF. They'll start landing
 * organically via AMQP 723 once that path is live.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { parseOcmf } from "../src/lib/ocmf";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

interface Row {
  session_id: string;
  raw_payload: Record<string, unknown> | null;
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const dbHost = (process.env.DATABASE_URL ?? "").match(/@([^/]+)\//)?.[1] ?? "(unknown)";
  console.log(`Connected to ${dbHost}`);

  const refs = await c.query<Row>(
    `select icr.session_id, icr.raw_payload
       from charging.imported_cdr_refs icr
       join charging.sessions cs on cs.id = icr.session_id
      where icr.source_kind = 'zaptec'
        and cs.completed_session_seen_at is null
        and icr.raw_payload ? 'SignedSession'
      order by icr.imported_at`,
  );
  console.log(`Found ${refs.rowCount ?? 0} sessions to backfill.\n`);

  let updated = 0;
  let skippedNoParse = 0;
  let skippedNoReadings = 0;

  for (const row of refs.rows) {
    const payload = row.raw_payload;
    if (!payload) continue;
    const signed = payload["SignedSession"];
    if (typeof signed !== "string" || signed.length === 0) continue;

    const parsed = parseOcmf(signed);
    if (!parsed) {
      skippedNoParse++;
      continue;
    }

    const first = parsed.readings[0];
    const last = parsed.readings[parsed.readings.length - 1];
    const firstKwh = first?.cumulativeKwh ?? null;
    const lastKwh = last?.cumulativeKwh ?? null;
    const signedKwh =
      firstKwh !== null && lastKwh !== null ? Number((lastKwh - firstKwh).toFixed(4)) : null;

    if (parsed.readings.length === 0) skippedNoReadings++;

    await c.query(
      `update charging.sessions
          set ocmf_signed_session       = $2,
              ocmf_format_version       = $3,
              ocmf_gateway_id           = $4,
              ocmf_gateway_serial       = $5,
              ocmf_gateway_version      = $6,
              ocmf_first_reading_kwh    = $7,
              ocmf_last_reading_kwh     = $8,
              ocmf_signed_session_kwh   = $9,
              auth_id_status            = $10,
              auth_id_level             = $11,
              auth_id_type              = $12,
              auth_id_value             = $13,
              auth_id_flags             = $14,
              completed_session_seen_at = now(),
              updated_at                = now()
        where id = $1`,
      [
        row.session_id,
        signed,
        parsed.formatVersion,
        parsed.gatewayId,
        parsed.gatewaySerial,
        parsed.gatewayVersion,
        firstKwh,
        lastKwh,
        signedKwh,
        parsed.identity?.identified ?? null,
        parsed.identity?.level ?? null,
        parsed.identity?.idType ?? null,
        parsed.identity?.idValue ?? null,
        parsed.identity?.flags ?? null,
      ],
    );
    updated++;
    if (updated % 25 === 0) console.log(`  ${updated}/${refs.rowCount} …`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Sessions updated:               ${updated}`);
  console.log(`  Skipped (OCMF parse failed):    ${skippedNoParse}`);
  console.log(`  Updated with no readings:       ${skippedNoReadings}`);

  // Sanity: surface distribution of gateway versions + any identity hits
  const versions = await c.query(
    `select ocmf_gateway_version as v, count(*)::int as n
       from charging.sessions
      where ocmf_gateway_version is not null
      group by 1 order by 2 desc`,
  );
  console.log(`\n=== Gateway firmware distribution ===`);
  for (const r of versions.rows) console.log(`  ${r.v}: ${r.n}`);

  const identityHits = await c.query(
    `select count(*)::int as n
       from charging.sessions
      where auth_id_type is not null`,
  );
  console.log(`\n=== Identity captures (auth_id_type populated) ===`);
  console.log(`  ${identityHits.rows[0]?.n ?? 0} session(s)`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
