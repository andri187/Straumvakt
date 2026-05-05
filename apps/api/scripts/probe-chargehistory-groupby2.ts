#!/usr/bin/env tsx
/**
 * Single focused call to /api/chargehistory with GroupBy=2 for
 * Dalvegur, last 30 days. Dumps the raw response so we can see
 * directly what user-grouped sessions look like.
 *
 * Usage:
 *   $env:ZAPTEC_PASSWORD = "<paste>"
 *   npx tsx scripts/probe-chargehistory-groupby2.ts
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const ZAPTEC_BASE = "https://api.zaptec.com";

(async () => {
  const password = process.env.ZAPTEC_PASSWORD;
  if (!password) {
    console.error("ZAPTEC_PASSWORD env var required.");
    process.exit(1);
  }

  // Username + Dalvegur install id from DB if not provided.
  let username = process.env.ZAPTEC_USERNAME;
  let installationId = process.env.DALVEGUR_INSTALLATION_ID;
  if (!username || !installationId) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    if (!username) {
      const r = await c.query(
        `select username from hardware.vendor_credentials where status='active' limit 1`,
      );
      username = r.rows[0]?.username;
    }
    if (!installationId) {
      const r = await c.query(
        `select id from properties.installations
         where display_name ilike '%dalvegur%' limit 1`,
      );
      installationId = r.rows[0]?.id;
    }
    await c.end();
  }
  if (!username) {
    console.error("No ZAPTEC_USERNAME and none in DB.");
    process.exit(1);
  }

  // OAuth
  console.log("→ OAuth password grant");
  const tokenRes = await fetch(`${ZAPTEC_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username,
      password,
    }),
  });
  if (!tokenRes.ok) {
    console.error(`OAuth failed: ${tokenRes.status} ${await tokenRes.text()}`);
    process.exit(1);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  console.log("  ok");

  // Call with GroupBy=2 for last 30d
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Important: when installationId is undefined we still want the
  // call to fire, but Zaptec returns nothing without a filter (the
  // bug we found earlier). Use what we have or fail loudly.
  if (!installationId) {
    console.error(
      "No installation id — neither DALVEGUR_INSTALLATION_ID nor DB lookup matched.",
    );
    console.error(
      "This call needs an installation filter to return data.",
    );
    process.exit(1);
  }

  const params = new URLSearchParams({
    InstallationId: installationId,
    From: from.toISOString(),
    To: to.toISOString(),
    GroupBy: "2",
    DetailLevel: "1",
    PageSize: "100",
  });
  const url = `${ZAPTEC_BASE}/api/chargehistory?${params}`;
  console.log(`→ GET ${url}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  console.log(`  ${res.status} ${res.statusText}`);

  const json = await res.json();
  console.log("\n──────── Response ────────\n");
  console.log(JSON.stringify(json, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
