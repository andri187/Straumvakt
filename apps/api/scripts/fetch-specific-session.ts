#!/usr/bin/env tsx
/**
 * Fetch one specific Zaptec session by id, with DetailLevel=1, and
 * dump the full raw response. Used to verify what fields populate
 * when authentication IS active on the source installation
 * (vs Dalvegur where Native auth strips user data).
 *
 * Target: session b5b2145e-10c1-441a-88ab-207fdd8adf24
 *         on charger ZPR074053 (103-10), 18-19 April 2026.
 *
 * Usage:
 *   $env:ZAPTEC_PASSWORD = "<paste>"
 *   npx tsx scripts/fetch-specific-session.ts
 */
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const ZAPTEC_BASE = "https://api.zaptec.com";
const TARGET_SESSION_ID = "b5b2145e-10c1-441a-88ab-207fdd8adf24";
const TARGET_DEVICE_ID = "ZPR074053";

(async () => {
  const password = process.env.ZAPTEC_PASSWORD;
  const username = process.env.ZAPTEC_USERNAME ?? "andrith187@gmail.com";
  if (!password) {
    console.error("ZAPTEC_PASSWORD env var required.");
    process.exit(1);
  }

  // OAuth
  console.log("→ OAuth");
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
    console.error(`OAuth failed: ${tokenRes.status}`);
    process.exit(1);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // Resolve ChargerId for ZPR074053 (and which installation it belongs to)
  console.log(`→ Resolving ChargerId for ${TARGET_DEVICE_ID}`);
  const chargersRes = await fetch(
    `${ZAPTEC_BASE}/api/chargers?DeviceType=&NameFilter=&PageSize=500`,
    { headers: { Authorization: `Bearer ${access_token}` } },
  );
  const chargersList = (await chargersRes.json()) as {
    Data?: Array<{
      Id: string;
      DeviceId?: string;
      Name?: string;
      InstallationId?: string;
      InstallationName?: string;
    }>;
  };
  const target = chargersList.Data?.find((c) => c.DeviceId === TARGET_DEVICE_ID);
  if (!target) {
    console.error(`No charger found with DeviceId=${TARGET_DEVICE_ID}`);
    console.error(`Visible chargers (${chargersList.Data?.length ?? 0}):`);
    for (const c of (chargersList.Data ?? []).slice(0, 50)) {
      console.error(
        `  ${c.DeviceId?.padEnd(15)} ${c.Name?.padEnd(40)} install=${c.InstallationId}`,
      );
    }
    process.exit(1);
  }
  console.log(
    `  ChargerId=${target.Id}  Installation=${target.InstallationName ?? target.InstallationId}`,
  );

  // /api/chargehistory with ChargerId + 2-day window covering this session
  const from = "2026-04-18T00:00:00Z";
  const to = "2026-04-20T00:00:00Z";
  const params = new URLSearchParams({
    ChargerId: target.Id,
    From: from,
    To: to,
    DetailLevel: "1",
    PageSize: "100",
  });
  const url = `${ZAPTEC_BASE}/api/chargehistory?${params}`;
  console.log(`→ GET ${url}`);
  const histRes = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  console.log(`  ${histRes.status}`);

  const histJson = (await histRes.json()) as {
    Data?: Array<Record<string, unknown>>;
  };
  const allSessions = histJson.Data ?? [];
  console.log(`  Returned ${allSessions.length} session(s) in window\n`);

  // Pick the target session if present, else show all
  const matching = allSessions.find(
    (s) => s.Id === TARGET_SESSION_ID || s.id === TARGET_SESSION_ID,
  );

  if (matching) {
    console.log(`${"═".repeat(72)}`);
    console.log(`Target session ${TARGET_SESSION_ID} (full payload):`);
    console.log(`${"═".repeat(72)}`);
    console.log(JSON.stringify(matching, null, 2));

    console.log(`\n${"─".repeat(72)}`);
    console.log("User / token / auth fields:");
    console.log(`${"─".repeat(72)}`);
    const userKeys = Object.keys(matching).filter((k) =>
      /user|token|rfid|card|auth|external/i.test(k),
    );
    if (userKeys.length === 0) {
      console.log("  (none populated)");
    } else {
      for (const k of userKeys) {
        console.log(`  ${k}: ${JSON.stringify(matching[k])}`);
      }
    }
  } else {
    console.log("Target session not in returned set. All session IDs:");
    for (const s of allSessions) {
      console.log(`  ${s.Id ?? s.id}  start=${s.StartDateTime ?? s.startDateTime}`);
    }
    console.log(`\nFirst session payload (for shape reference):`);
    if (allSessions[0]) console.log(JSON.stringify(allSessions[0], null, 2));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
