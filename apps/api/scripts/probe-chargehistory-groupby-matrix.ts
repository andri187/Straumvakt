#!/usr/bin/env tsx
/**
 * Probe /api/chargehistory with each GroupBy value (0=Charger,
 * 1=Day, 2=User) for ZPR042344 (K1, Dalvegur) over the last 24h.
 * Dumps the raw JSON response from each call so we can compare the
 * three shapes side-by-side.
 *
 * Usage:
 *   $env:ZAPTEC_PASSWORD = "<paste>"
 *   npx tsx scripts/probe-chargehistory-groupby-matrix.ts
 */
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const ZAPTEC_BASE = "https://api.zaptec.com";
const TARGET_DEVICE_ID = "ZPR042344"; // K1 at Dalvegur

(async () => {
  const password = process.env.ZAPTEC_PASSWORD;
  const username = process.env.ZAPTEC_USERNAME ?? "andrith187@gmail.com";
  if (!password) {
    console.error("ZAPTEC_PASSWORD env var required.");
    process.exit(1);
  }

  // ── OAuth ────────────────────────────────────────────────────
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

  // ── Resolve ChargerId for the target DeviceId ────────────────
  const chargerListRes = await fetch(`${ZAPTEC_BASE}/api/chargers`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const chargerList = (await chargerListRes.json()) as {
    Data?: Array<{ Id: string; DeviceId?: string; Name?: string }>;
  };
  const chargers = chargerList.Data ?? [];
  const target = chargers.find((c) => c.DeviceId === TARGET_DEVICE_ID);
  if (!target) {
    console.error(
      `ChargerId for DeviceId=${TARGET_DEVICE_ID} not found among ${chargers.length} chargers.`,
    );
    process.exit(1);
  }
  console.log(
    `Target: DeviceId=${TARGET_DEVICE_ID}  Name=${target.Name}  ChargerId=${target.Id}\n`,
  );

  // ── Call with each GroupBy ───────────────────────────────────
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const groupByLabels: Record<string, string> = {
    "0": "Charger",
    "1": "Day",
    "2": "User",
  };

  for (const groupBy of ["0", "1", "2"]) {
    const params = new URLSearchParams({
      ChargerId: target.Id,
      From: from.toISOString(),
      To: to.toISOString(),
      GroupBy: groupBy,
      DetailLevel: "1",
      PageSize: "50",
    });
    const url = `${ZAPTEC_BASE}/api/chargehistory?${params}`;
    console.log(`${"═".repeat(72)}`);
    console.log(
      `GroupBy=${groupBy} (${groupByLabels[groupBy]})  DetailLevel=1`,
    );
    console.log(`URL: ${url}`);
    console.log(`${"═".repeat(72)}`);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    console.log(`Status: ${res.status} ${res.statusText}\n`);

    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
    console.log("");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
