import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const readRaw = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** Source with comments removed, so a sentence saying "no Prisma" cannot fail a check for importing it. */
const read = (p: string) => readRaw(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !rel.includes("__tests__")) out.push(rel);
  }
  return out;
}

describe("adopted engine + sync graph", () => {
  const files = [
    ...walk("src/lib/ocpp-engine"),
    ...walk("src/lib/sync"),
    ...walk("src/lib/costing"),
    ...walk("src/lib/lifecycle"),
    "src/app/cpo/chargers/live-status.tsx",
    "src/app/api/cpo/sync/route.ts",
    "gateway/src/command-entrypoint.ts",
    "src/app/api/cpo/lifecycle/route.ts",
    "gateway/src/engine-mode.ts",
    "gateway/src/engine-client.ts",
    "gateway/src/connection-ownership.ts",
    "gateway/src/outbox.ts",
  ];

  it("imports no Prisma runtime or generated client, no legacy API app and no Hyperdrive/raw pg", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/prisma|generated\/prisma|@prisma\//i);
      expect(src, f).not.toMatch(/from\s+["'](?:\.\.\/)+apps\/api|@straumvakt\/api/);
      expect(src, f).not.toMatch(/HYPERDRIVE|from\s+["']pg["']/);
    }
  });

  it("the gateway imports only the dependency-free protocol module from the engine, never its stores or admission", () => {
    for (const f of walk("gateway/src")) {
      const src = read(f);
      for (const m of src.matchAll(/from\s+["']@engine\/([^"']+)["']/g)) expect(["protocol"], `${f} imports @engine/${m[1]}`).toContain(m[1]);
    }
    const protocolSrc = read("src/lib/ocpp-engine/protocol.ts");
    expect([...protocolSrc.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1])).toEqual(["zod"]);
  });

  it("never logs or returns a connection string, password, verifier or the ingest secret", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/console\.\w+\([^)]*(DATABASE_URL|connectionString|ocppPasswordVerifier|OCPP_INGEST_SECRET|password)/i);
    }
  });

  it("test doubles never ship in the adopted graph", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/memory-tx-store|memory-repo|localStorage|sessionStorage/);
  });

  it("the engine is reachable only through a named entrypoint: no HTTP route, no allow-list entry, no shared secret in the hop", () => {
    expect(fs.existsSync(path.join(ROOT, "src/app/api/internal"))).toBe(false);
    for (const f of ["src/lib/cpo-shell-policy.ts", "workers/cpo-shell-edge.mjs", "src/middleware.ts"]) expect(readRaw(f), f).not.toMatch(/ocpp|\/internal|engine/i);
    expect(readRaw("workers/cpo-shell.mjs")).toMatch(/export \{ EngineEntrypoint \}/);
    expect(readRaw("workers/cpo-shell-engine.mjs")).toMatch(/extends WorkerEntrypoint/);
    // the gateway side calls RPC on the binding; it does not fetch an engine URL or send the ingest secret to it
    const client = readRaw("gateway/src/engine-client.ts");
    expect(client).not.toMatch(/fetch\(|x-straumvakt-ingest|OCPP_INGEST_SECRET/);
  });

  it("the sync endpoint is mounted at exactly one path, GET only, in all three allow-lists", () => {
    expect(readRaw("src/lib/cpo-shell-policy.ts")).toContain('"/api/cpo/sync"');
    expect(readRaw("workers/cpo-shell-edge.mjs")).toContain("'/api/cpo/sync'");
    const route = readRaw("src/app/api/cpo/sync/route.ts");
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });
});

describe("migrations 0003, 0004 and 0005", () => {
  const sql3 = readRaw("apps/api/drizzle/0003_ocpp_engine_transactions.sql");
  const sql4 = readRaw("apps/api/drizzle/0004_sync_operational_state.sql");
  const sql5 = readRaw("apps/api/drizzle/0005_ocpp_costing_handoff.sql");
  const sql6 = readRaw("apps/api/drizzle/0006_charger_lifecycle.sql");
  const sql7 = readRaw("apps/api/drizzle/0007_terms_snapshot.sql");
  const journal = JSON.parse(readRaw("apps/api/drizzle/meta/_journal.json")) as { entries: { idx: number; tag: string }[] };

  it("are registered in order with snapshots", () => {
    expect(journal.entries.map((e) => e.tag).slice(2)).toEqual(["0002_installation_management", "0003_ocpp_engine_transactions", "0004_sync_operational_state", "0005_ocpp_costing_handoff", "0006_charger_lifecycle", "0007_terms_snapshot"]);
    for (const n of ["0003", "0004", "0005", "0006", "0007"]) expect(fs.existsSync(path.join(ROOT, `apps/api/drizzle/meta/${n}_snapshot.json`))).toBe(true);
  });

  it("are additive: no drops, no data writes, no destructive statement", () => {
    for (const sql of [sql3, sql4, sql5, sql6, sql7]) {
      expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|INDEX|SEQUENCE)\b/i);
      expect(sql).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|INSERT\s+INTO|UPDATE\s+")\b/i);
    }
  });

  it("0003 carries the transaction-id namespace and the evidence constraints", () => {
    expect(sql3).toMatch(/CREATE SEQUENCE "charging"\."ocpp_transaction_no_seq"[^;]*MAXVALUE 2147483647/);
    expect(sql3).not.toMatch(/\bCYCLE\b/); // exhaustion must be loud, never a reused id
    expect(sql3).toMatch(/CREATE UNIQUE INDEX "ocpp_transactions_transaction_no_index"/);
    expect(sql3).toMatch(/CREATE UNIQUE INDEX "protocol_receipts_device_id_message_id_request_hash_index"/);
    for (const c of ["ocpp_transactions_unauthorized_never_costed", "ocpp_transactions_energy_only_when_ok", "ocpp_transactions_stop_fields_together", "protocol_receipts_payload_bounded", "ocpp_transaction_readings_energy_non_negative"]) expect(sql3).toContain(c);
  });

  it("0005's costing vocabulary lists every state the consumer and the stop handler can write", () => {
    const listed = [...(/costing_state" IN \(([^)]*)\)/.exec(sql5)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const code = readRaw("src/lib/costing/cost-session.ts");
    const union = [...(/export type CostingState =([^;]*);/.exec(code)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const written = [...new Set([...union, "needed", "not_needed"])].sort();
    expect(listed).toEqual(written);
    expect(sql5).toMatch(/WHERE "charging"\."ocpp_transactions"\."costing_state" = 'needed'/); // the consumer's claim stays an index scan of pending rows only
  });

  it("0004 adds the status counter with a safe default and the delta indexes", () => {
    expect(sql4).toMatch(/ADD COLUMN "status_version" bigint DEFAULT 0 NOT NULL/);
    expect(sql4).toMatch(/"device_operational_state_installation_id_seq_index"/);
    expect(sql4).toMatch(/"installation_changes_installation_id_revision_index"/);
  });
});
