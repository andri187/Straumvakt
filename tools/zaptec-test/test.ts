/**
 * Zaptec API smoke test
 *
 * Auth: OAuth 2.0 Resource Owner Password Credentials
 * Docs: https://api.zaptec.com/help
 *
 * Run:
 *   1. Fill in .env with your Zaptec portal credentials
 *   2. npx tsx test.ts
 */

import { readFileSync, existsSync } from "node:fs";

// ── Load .env ─────────────────────────────────────────────────────────────────
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?(.*?)["']?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const BASE = "https://api.zaptec.com";
const USERNAME = process.env.ZAPTEC_USERNAME!;
const PASSWORD = process.env.ZAPTEC_PASSWORD!;

if (!USERNAME || !PASSWORD) {
  console.error("Set ZAPTEC_USERNAME and ZAPTEC_PASSWORD in .env");
  process.exit(1);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function getToken(): Promise<string> {
  console.log("\n[1] OAuth token request...");
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: USERNAME,
      password: PASSWORD,
      scope: "openid",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token request failed ${res.status}: ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number; token_type: string };
  console.log(`    ✓ token_type: ${data.token_type}`);
  console.log(`    ✓ expires_in: ${data.expires_in}s`);
  console.log(`    ✓ access_token: ${data.access_token.slice(0, 40)}…`);
  return data.access_token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function pp(label: string, obj: unknown) {
  console.log(`\n${label}`);
  console.log(JSON.stringify(obj, null, 2));
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function main() {
  const token = await getToken();

  // 2. List installations owned by this account
  console.log("\n[2] GET /api/installation ...");
  const installations = await get<{ Data: { Id: string; Name: string; Address: string }[] }>(
    token, "/api/installation"
  );
  pp("    Installations:", installations.Data?.map(i => ({ Id: i.Id, Name: i.Name, Address: i.Address })));

  if (!installations.Data?.length) {
    console.log("    No installations found — stopping here.");
    return;
  }

  const inst = installations.Data[0];
  console.log(`\n    Using installation: ${inst.Name} (${inst.Id})`);

  // 3. Installation detail
  console.log("\n[3] GET /api/installation/:id ...");
  const instDetail = await get<Record<string, unknown>>(token, `/api/installation/${inst.Id}`);
  pp("    Installation detail:", instDetail);

  // 4. Chargers in this installation
  console.log("\n[4] GET /api/chargers?InstallationId=:id ...");
  const chargers = await get<{ Data: { Id: string; Name: string; SerialNo: string; IsOnline: boolean }[] }>(
    token, `/api/chargers?InstallationId=${inst.Id}`
  );
  pp("    Chargers:", chargers.Data?.map(c => ({
    Id: c.Id,
    Name: c.Name,
    SerialNo: c.SerialNo,
    IsOnline: c.IsOnline,
  })));

  if (!chargers.Data?.length) {
    console.log("    No chargers found in this installation.");
    return;
  }

  const charger = chargers.Data[0];
  console.log(`\n    Using charger: ${charger.Name} / ${charger.SerialNo} (${charger.Id})`);

  // 5. Charger state (live readings)
  console.log("\n[5] GET /api/chargers/:id/state ...");
  const state = await get<{ StateId: number; ValueAsString: string; Timestamp: string }[]>(
    token, `/api/chargers/${charger.Id}/state`
  );
  // Print a useful subset of state observations
  const interesting = [
    710,  // ChargerOperationMode
    711,  // IsOnline
    712,  // ConnectorStatus (OCPP)
    719,  // Voltage phase 1
    720,  // Voltage phase 2
    721,  // Voltage phase 3
    507,  // Current phase 1
    508,  // Current phase 2
    509,  // Current phase 3
    513,  // TotalChargePower
    553,  // CompletedSession.Energy
  ];
  const filtered = Array.isArray(state)
    ? state.filter(s => interesting.includes(s.StateId))
    : state;
  pp("    State (key observations):", filtered);
}

main().catch(e => {
  console.error("\n✗ Error:", e.message);
  process.exit(1);
});
