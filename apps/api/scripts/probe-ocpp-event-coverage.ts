#!/usr/bin/env tsx
/**
 * Read-only probe — confirms the projection-coverage gap:
 * which OCPP eventTypes are landing in event_log today, and
 * whether any have a registered projection handler firing.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const SINCE = "2026-05-11 07:00:00+00";

const REGISTERED_HANDLERS = new Set([
  "charger.booted",
  "charger.heartbeat",
  "charger.status_updated",
  "connector.status_updated",
  "session.started",
  "session.meter_value_recorded",
  "session.stopped",
  "ocpp.command_result",
  "ocpp.raw.MeterValues",
]);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`=== OCPP event_log coverage  (since ${SINCE}) ===\n`);

  const byType = await c.query(
    `select event_type, count(*)::int n, max(occurred_at) latest
       from events.event_log
      where occurred_at >= $1::timestamptz
      group by event_type
      order by n desc`,
    [SINCE],
  );

  console.log("  eventType                              count    latest                       handler?");
  for (const row of byType.rows) {
    const has = REGISTERED_HANDLERS.has(row.event_type) ? "✓" : "✗ NO HANDLER";
    console.log(
      `  ${row.event_type.padEnd(38)} ${String(row.n).padStart(6)}    ${row.latest.toISOString()}    ${has}`,
    );
  }

  // For Dalvegur specifically — what frame actions has the gateway
  // received from Dalvegur chargers today?
  const dalvActions = await c.query(
    `select el.event_type, count(*)::int n
       from events.event_log el
       join ocpp.ocpp_identities oi on oi.id = el.aggregate_id
       join assets.charging_stations cs on cs.site_asset_id = oi.charging_station_id
       join properties.installations i on i.id = cs.installation_id
      where i.display_name ilike 'Dalvegur%'
        and el.occurred_at >= $1::timestamptz
        and el.aggregate_type = 'ocpp_identity'
      group by el.event_type
      order by n desc`,
    [SINCE],
  );
  console.log(`\n  Dalvegur-only event_log breakdown:`);
  for (const row of dalvActions.rows) {
    const has = REGISTERED_HANDLERS.has(row.event_type) ? "✓" : "✗";
    console.log(`    ${row.event_type.padEnd(38)} ${String(row.n).padStart(6)}    ${has}`);
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
