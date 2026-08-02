#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const r = await c.query(
    `select id, charging_station_id, ocpp_identity_id, id_tag,
            started_at, ended_at, status, energy_wh,
            ocmf_signed_session is not null as has_ocmf,
            ev_plc_mac, auth_id_value, pnc_attempted,
            created_at, updated_at
       from charging.sessions
      where created_at > '2026-05-09 11:00:00+00'::timestamptz
      order by created_at`,
  );
  console.log(`=== ${r.rowCount} session(s) created since 11:00 UTC ===`);
  for (const row of r.rows) {
    console.log(JSON.stringify(row, null, 2));
    console.log("---");
  }

  // Check OCPP MeterValues raw payloads for any OCMF blob
  const mv = await c.query(
    `select occurred_at, aggregate_id, payload
       from events.event_log
      where event_type = 'ocpp.raw.MeterValues'
        and occurred_at > '2026-05-09 11:00:00+00'::timestamptz
      order by occurred_at`,
  );
  console.log(`\n=== ${mv.rowCount} MeterValues events since 11:00 UTC ===`);
  for (const row of mv.rows) {
    const payload = row.payload as Record<string, unknown>;
    const req = (payload.request as Record<string, unknown>) ?? {};
    const meterValue = req.meterValue as unknown[] ?? [];
    let signedDataCount = 0;
    let ocmfCount = 0;
    for (const mv of meterValue) {
      if (typeof mv !== "object" || mv === null) continue;
      const sampledValue = (mv as { sampledValue?: unknown[] }).sampledValue ?? [];
      for (const sv of sampledValue) {
        if (typeof sv !== "object" || sv === null) continue;
        const svo = sv as Record<string, unknown>;
        if (svo.format === "SignedData") signedDataCount++;
        if (typeof svo.value === "string" && svo.value.startsWith("OCMF|")) ocmfCount++;
      }
    }
    console.log(`  ${row.occurred_at?.toISOString?.()}  aggregate=${(row.aggregate_id as string).slice(0,8)}  signedData=${signedDataCount}  ocmf=${ocmfCount}  txId=${req.transactionId}`);
  }

  // Sample one MeterValues payload's sampledValue array
  if (mv.rowCount && mv.rowCount > 0) {
    console.log(`\n=== First MeterValues payload (truncated) ===`);
    console.log(JSON.stringify(mv.rows[0].payload, null, 2).slice(0, 1500));
  }

  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
