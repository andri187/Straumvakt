#!/usr/bin/env tsx
/**
 * Direct probe: hit Zaptec /api/chargehistory using the staging
 * credential, show what comes back over the last 26h. Confirms
 * whether sessions exist on Zaptec's side at all — independent
 * of our sync logic.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const ZAPTEC_BASE = "https://api.zaptec.com";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const cred = await c.query(
    `select id, owner_org_id, username, password_cipher, password_iv
     from hardware.vendor_credentials
     where status = 'active' and vendor_id in
       (select id from hardware.hardware_vendors where slug = 'zaptec')
     limit 1`,
  );
  if (!cred.rowCount) {
    console.log("No active Zaptec credential found.");
    return;
  }
  const row = cred.rows[0];
  console.log(`Credential: id=${row.id} username=${row.username}`);

  // Decrypt the password using the same KEK approach as the worker.
  // We don't have the KEK locally, so decrypt would fail — instead
  // ask the operator to paste the password OR run a different probe.
  // For this script we'll use a different approach: skip auth and
  // just print what we'd need to do.
  console.log(
    "\nThis script needs the plaintext Zaptec password to authenticate.",
  );
  console.log(
    "Use: ZAPTEC_PASSWORD=<password> npx tsx scripts/probe-dalvegur-chargehistory.ts",
  );

  if (!process.env.ZAPTEC_PASSWORD) {
    await c.end();
    return;
  }

  // OAuth password grant
  const tokenRes = await fetch(`${ZAPTEC_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: row.username,
      password: process.env.ZAPTEC_PASSWORD,
    }),
  });
  if (!tokenRes.ok) {
    console.error(`OAuth failed: ${tokenRes.status}`);
    console.error(await tokenRes.text());
    await c.end();
    return;
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  console.log("OAuth ok.");

  const from = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();
  console.log(`\nFetching /api/chargehistory from=${from} to=${to}`);

  const url =
    `${ZAPTEC_BASE}/api/chargehistory?` +
    new URLSearchParams({
      From: from,
      To: to,
      PageSize: "500",
    });
  const histRes = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  console.log(`Response: ${histRes.status}`);
  const json = (await histRes.json()) as {
    Pages?: number;
    Data?: Array<{
      Id?: string;
      ChargerId?: string;
      DeviceName?: string;
      StartDateTime?: string;
      EndDateTime?: string | null;
      Energy?: number;
      UserUserName?: string;
    }>;
  };
  const list = Array.isArray(json) ? json : json.Data ?? [];
  console.log(`\nReturned ${list.length} session(s):`);
  for (const s of list.slice(0, 30)) {
    console.log(
      `  Id=${s.Id?.slice(0, 8)}…  Charger=${s.ChargerId?.slice(0, 8)}…  ` +
        `Device=${s.DeviceName ?? "—"}  Start=${s.StartDateTime}  ` +
        `End=${s.EndDateTime ?? "(open)"}  ${s.Energy?.toFixed(3) ?? "—"} kWh  ` +
        `User=${s.UserUserName ?? "—"}`,
    );
  }

  // Also probe a wider window for sanity
  const fromWide = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  console.log(`\n--- Wider 30d probe ---`);
  const urlWide =
    `${ZAPTEC_BASE}/api/chargehistory?` +
    new URLSearchParams({
      From: fromWide,
      To: to,
      PageSize: "500",
    });
  const wideRes = await fetch(urlWide, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const wideJson = (await wideRes.json()) as {
    Data?: Array<{ Id?: string; EndDateTime?: string | null }>;
  };
  const wide = Array.isArray(wideJson) ? wideJson : wideJson.Data ?? [];
  const closed = wide.filter((s) => s.EndDateTime).length;
  console.log(`30d window: ${wide.length} total, ${closed} with EndDateTime`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
