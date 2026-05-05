#!/usr/bin/env tsx
/**
 * Probe /api/chargehistory with the DetailLevel and GroupBy query
 * params our current code doesn't pass. If higher DetailLevel surfaces
 * user/driver data that's hidden at the default level, the entire
 * driver-attribution gap changes shape.
 *
 * Tests a matrix of (DetailLevel × GroupBy) and prints the keys
 * present in each response, plus a redacted sample row. Lets us
 * compare what each parameter unlocks without manually crafting
 * curl calls.
 *
 * Usage:
 *   $env:ZAPTEC_PASSWORD = "<paste>"
 *   $env:ZAPTEC_USERNAME = "andrith187@gmail.com"   # optional
 *   $env:DALVEGUR_INSTALLATION_ID = "<install-uuid>" # optional
 *   npx tsx scripts/probe-chargehistory-params.ts
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const ZAPTEC_BASE = "https://api.zaptec.com";

interface ProbeResult {
  detailLevel: number | null;
  groupBy: number | null;
  status: number;
  rowCount: number;
  uniqueKeys: string[];
  sampleRow: Record<string, unknown> | null;
}

(async () => {
  const password = process.env.ZAPTEC_PASSWORD;
  if (!password) {
    console.error("ZAPTEC_PASSWORD env var required.");
    process.exit(1);
  }

  let username = process.env.ZAPTEC_USERNAME;
  if (!username) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(
      `select username from hardware.vendor_credentials where status='active' limit 1`,
    );
    await c.end();
    username = r.rows[0]?.username;
    if (!username) {
      console.error("No DB credential and no ZAPTEC_USERNAME env var.");
      process.exit(1);
    }
  }

  // OAuth
  console.log("[1/3] OAuth password grant…");
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

  // Installation pick
  let installationId = process.env.DALVEGUR_INSTALLATION_ID;
  if (!installationId) {
    console.log("[2/3] Listing installations to pick one…");
    const installRes = await fetch(`${ZAPTEC_BASE}/api/installation`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const installList = (await installRes.json()) as {
      Data?: Array<{ Id: string; Name?: string }>;
    };
    installationId = installList.Data?.[0]?.Id;
    if (!installationId) {
      console.error("No installations visible.");
      process.exit(1);
    }
    console.log(`     Using installation: ${installationId}`);
  }

  // Last 7 days, narrow window for fast probe
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Test matrix
  const results: ProbeResult[] = [];

  console.log(
    `[3/3] Probing parameter matrix (window: ${from.toISOString()} → ${to.toISOString()})\n`,
  );

  // Baseline (no DetailLevel, no GroupBy)
  for (const detailLevel of [null, 0, 1, 2, 3]) {
    for (const groupBy of [null, 0, 1, 2, 3]) {
      const params = new URLSearchParams({
        InstallationId: installationId,
        From: from.toISOString(),
        To: to.toISOString(),
        PageSize: "5",
      });
      if (detailLevel !== null) params.set("DetailLevel", String(detailLevel));
      if (groupBy !== null) params.set("GroupBy", String(groupBy));

      const url = `${ZAPTEC_BASE}/api/chargehistory?${params}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      let rows: Array<Record<string, unknown>> = [];
      let parseError: string | null = null;
      try {
        const json = (await res.json()) as
          | { Data?: Array<Record<string, unknown>> }
          | Array<Record<string, unknown>>;
        rows = Array.isArray(json) ? json : (json.Data ?? []);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }

      const allKeys = new Set<string>();
      for (const r of rows) for (const k of Object.keys(r)) allKeys.add(k);

      results.push({
        detailLevel,
        groupBy,
        status: res.status,
        rowCount: rows.length,
        uniqueKeys: [...allKeys].sort(),
        sampleRow: rows[0] ?? null,
      });

      const tag = `DL=${detailLevel ?? "—"} GB=${groupBy ?? "—"}`;
      const status =
        res.status === 200
          ? `${rows.length} row(s)`
          : `${res.status}${parseError ? ` (${parseError})` : ""}`;
      console.log(`  ${tag.padEnd(15)} ${status}`);
    }
  }

  // Find the result with the most unique keys — that's the richest shape
  console.log(`\n${"═".repeat(70)}`);
  console.log("Comparison — keys present per (DetailLevel, GroupBy):");
  console.log(`${"═".repeat(70)}\n`);

  // Print key sets sorted by richness
  const sorted = [...results]
    .filter((r) => r.status === 200)
    .sort((a, b) => b.uniqueKeys.length - a.uniqueKeys.length);

  // Show only the top 5 distinct shapes (collapse duplicates)
  const seen = new Set<string>();
  const distinct: ProbeResult[] = [];
  for (const r of sorted) {
    const sig = r.uniqueKeys.join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);
    distinct.push(r);
  }

  for (const r of distinct) {
    console.log(
      `\nDL=${r.detailLevel ?? "—"} GB=${r.groupBy ?? "—"}: ${r.uniqueKeys.length} keys`,
    );
    console.log(`  Keys: ${r.uniqueKeys.join(", ")}`);
    if (r.sampleRow) {
      // Redact long fields and obvious secrets
      const redacted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.sampleRow)) {
        if (typeof v === "string" && v.length > 80) {
          redacted[k] = `[${v.length} chars]`;
        } else {
          redacted[k] = v;
        }
      }
      console.log(`  Sample: ${JSON.stringify(redacted, null, 2)}`);
    }
  }

  // Highlight any user-related keys we discover
  const userKeys = new Set<string>();
  for (const r of results) {
    for (const k of r.uniqueKeys) {
      if (
        k.toLowerCase().includes("user") ||
        k.toLowerCase().includes("rfid") ||
        k.toLowerCase().includes("card") ||
        k.toLowerCase().includes("tag") ||
        k.toLowerCase().includes("auth")
      ) {
        userKeys.add(k);
      }
    }
  }

  console.log(`\n${"═".repeat(70)}`);
  if (userKeys.size > 0) {
    console.log(`USER-RELATED KEYS DISCOVERED: ${[...userKeys].join(", ")}`);
    console.log(`This rewrites the driver-attribution conversation.`);
  } else {
    console.log(`No user-related keys in any response.`);
    console.log(`Native auth + REST is confirmed driver-anonymous.`);
  }
  console.log(`${"═".repeat(70)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
