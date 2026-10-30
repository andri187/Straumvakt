import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !rel.includes("__tests__")) out.push(rel);
  }
  return out;
}

describe("adopted path boundaries", () => {
  const files = [
    ...walk("src/lib/installations"),
    ...walk("src/app/api/cpo"),
    ...walk("src/app/cpo/installations"),
    "src/app/cpo/chargers/page.tsx",
  ];

  it("shipped installation code imports no Prisma runtime or generated client, and no legacy API app", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/prisma|generated\/prisma|@prisma\//i);
      expect(src, f).not.toMatch(/from\s+["'](?:\.\.\/)*apps\/api|@straumvakt\/api/);
    }
  });

  it("reaches the database only through Drizzle and the Neon driver, never Hyperdrive or raw pg", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/HYPERDRIVE|from\s+["']pg["']/);
    }
  });

  it("ships no test-only store and no browser storage as a database", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/memory-store|localStorage|sessionStorage|indexedDB/);
    }
  });

  it("never logs or returns a connection string or the password verifier", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/console\.\w+\([^)]*(DATABASE_URL|connectionString|ocppPasswordVerifier)/);
    }
    const api = read("src/lib/installations/api.ts");
    expect(api).not.toMatch(/ocppPasswordVerifier|verifier\s*:/);
  });

  it("keeps the wizard, checklist and activation concepts out of the editor", () => {
    const ui = read("src/app/cpo/installations/installation-editor.tsx").replace(/^\s*\/\/.*$/gm, "");
    expect(ui).not.toMatch(/wizard|commission|checklist|activate/i);
    expect(ui).not.toMatch(/>\s*Next\s*</);
  });
});

describe("migration 0002", () => {
  const sql = read("apps/api/drizzle/0002_installation_management.sql");
  const journal = JSON.parse(read("apps/api/drizzle/meta/_journal.json")) as { entries: { idx: number; tag: string }[] };

  it("is registered in the journal after 0001 and has a snapshot", () => {
    expect(journal.entries.map((e) => e.tag).slice(0, 3)).toEqual(["0000_cold_hex", "0001_restore_temporal_and_status_constraints", "0002_installation_management"]);
    expect(fs.existsSync(path.join(ROOT, "apps/api/drizzle/meta/0002_snapshot.json"))).toBe(true);
  });

  it("is additive: no drops, no data writes, no destructive statement", () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|INDEX)\b/i);
    expect(sql).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+"|INSERT\s+INTO)\b/i);
  });

  it("carries the hand-written constraints the snapshot cannot express", () => {
    for (const name of [
      "circuits_ampere_ceiling_non_negative",
      "circuits_phase_count_known_values",
      "circuits_not_own_parent",
      "installations_ocpp_password_verifier_matches_mode",
      "installations_installation_key_format",
      "organizations_cpo_routing_id_format",
    ]) expect(sql).toContain(name);
  });

  it("removes the three-phase default and keeps unknown nullable", () => {
    expect(sql).toContain('ALTER COLUMN "phase_count" DROP DEFAULT');
    expect(sql).toContain('ALTER COLUMN "phase_count" DROP NOT NULL');
  });

  it("gives idempotency keys and installation keys unique indexes", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "installation_changes_idempotency_key_index"/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "installations_installation_key_index"/);
  });
});
