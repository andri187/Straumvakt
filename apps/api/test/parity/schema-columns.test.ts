// Does every column the Prisma schema declares actually exist?
//
// WHY THIS EXISTS
// ---------------
// `DriverAccessRequest.triggeredBy` was the one field across 157 models
// missing a `@map` it needed. Prisma addressed a column `"triggeredBy"`; the
// column is `triggered_by`. Every read and write of that model failed at
// runtime with "The column ... does not exist in the current database", and
// the entire driver access-request flow was dead.
//
// Nothing caught it. `prisma validate` passes — the schema is internally
// consistent. `tsc` passes — the generated client types match the schema.
// The unit tests pass — they run against a hand-rolled fake that has no
// column names to get wrong. It took reconciling the schema against the
// database by hand on 2026-08-06 to find it.
//
// So this asserts the one thing none of those can: that the schema's claims
// about the database are true, for every model, every column.
//
// WHICH BRANCH TO POINT THIS AT
// -----------------------------
// A branch that mirrors staging. As of 2026-08-06 the TEST branch
// (br-withered-hat-abtc5gzi) does NOT: its `_prisma_migrations` ledger stops
// at 20260802190000_tap_intents, twelve behind, while parts of the later
// schema are present anyway — `archive_watermark` exists as a table but is
// unrecorded, and the vendor_auth_* columns are absent. Its ledger and its
// schema disagree, so it is not a faithful mirror of anything.
//
// Run against it and this test reports three vendor_auth_* columns as
// missing. Those are a stale branch, not a schema bug — they exist on
// staging (br-tiny-river-abgpqq37), where this passes clean.
//
// Everything here is information_schema SELECTs, so pointing it at staging is
// read-only and safe. The repository-parity file next door is the one that
// wants the test branch, because that is where the fixtures live.
//
// DIRECTION
// ---------
// Only declared-but-absent is a failure. That is the direction that breaks
// queries at runtime. The reverse — columns the database has and the schema
// does not declare — is real (21 defaults, some indexes) but harmless to
// reads and writes, is inventoried in
// docs/notes/2026-08-06-schema-database-drift-reconciliation.md, and would
// make this test permanently red for a decision that has not been taken.

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeAll, getPool, hasDb } from "./_harness";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../prisma/schema",
);

interface ModelDecl {
  model: string;
  file: string;
  pgSchema: string;
  table: string;
  columns: string[];
}

/** Minimal Prisma parser — enough to answer "which columns does this claim?".
 *  Relation fields are not columns and are excluded; a field's column is its
 *  `@map` if present, otherwise its name verbatim, which is exactly the rule
 *  that made `triggeredBy` wrong. */
function parseModels(): ModelDecl[] {
  const files = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".prisma") && f !== "schema.prisma");

  const raw = files.map((f) => ({ file: f, text: fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8") }));
  const all = raw.map((r) => r.text).join("\n");
  const modelNames = new Set([...all.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));

  const out: ModelDecl[] = [];

  for (const { file, text } of raw) {
    let cur: { model: string; pgSchema: string | null; table: string | null; columns: string[] } | null = null;

    for (const line of text.split(/\r?\n/)) {
      const open = line.match(/^model\s+(\w+)\s*\{/);
      if (open) {
        cur = { model: open[1], pgSchema: null, table: null, columns: [] };
        continue;
      }
      if (!cur) continue;

      if (line === "}") {
        if (cur.pgSchema) {
          out.push({
            model: cur.model,
            file,
            pgSchema: cur.pgSchema,
            table: cur.table ?? cur.model,
            columns: cur.columns,
          });
        }
        cur = null;
        continue;
      }

      const t = line.trim();
      const sm = t.match(/^@@schema\("([^"]+)"\)/);
      if (sm) { cur.pgSchema = sm[1]; continue; }
      const mm = t.match(/^@@map\("([^"]+)"\)/);
      if (mm) { cur.table = mm[1]; continue; }
      if (t === "" || t.startsWith("//") || t.startsWith("@@")) continue;

      const f = t.match(/^(\w+)\s+([\w.]+)(\[\])?(\??)(.*)$/);
      if (!f) continue;
      const [, name, type, isList, , rest] = f;

      // A relation field is not a column. Both sides are excluded: the owning
      // side carries @relation(fields:), the other side is a bare model type.
      if (/@relation\(/.test(rest)) continue;
      if (modelNames.has(type)) continue;
      if (isList) continue;

      const mapped = rest.match(/@map\("([^"]+)"\)/);
      cur.columns.push(mapped ? mapped[1] : name);
    }
  }

  return out;
}

describe.skipIf(!hasDb)("every column the Prisma schema declares exists in the database", () => {
  afterAll(closeAll);

  const models = parseModels();

  it("parsed a plausible number of models", () => {
    // A parser that silently matched nothing would make every assertion below
    // vacuous. ~66 models remain across the domain files — was ~98 until
    // 2026-08-07, when 29 never-used, never-referenced tables were dropped
    // (ADR 0050 decision 3).
    expect(models.length).toBeGreaterThan(60);
    expect(models.every((m) => m.columns.length > 0)).toBe(true);
  });

  it("no model declares a column the database does not have", async () => {
    const schemas = [...new Set(models.map((m) => m.pgSchema))];
    const { rows } = await getPool().query<{ table_schema: string; table_name: string; column_name: string }>(
      `select table_schema, table_name, column_name
         from information_schema.columns
        where table_schema = any($1)`,
      [schemas],
    );

    const byTable = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = `${r.table_schema}.${r.table_name}`;
      if (!byTable.has(key)) byTable.set(key, new Set());
      byTable.get(key)!.add(r.column_name);
    }

    const missingTables: string[] = [];
    const missingColumns: string[] = [];

    for (const m of models) {
      const key = `${m.pgSchema}.${m.table}`;
      const actual = byTable.get(key);
      if (!actual) { missingTables.push(`${key} (model ${m.model}, ${m.file})`); continue; }
      for (const col of m.columns) {
        if (!actual.has(col)) {
          missingColumns.push(`${key}.${col} — model ${m.model} in ${m.file}`);
        }
      }
    }

    // Tables are reported separately: a whole missing table usually means an
    // unapplied migration, which is a different conversation from a mistyped
    // column.
    expect(missingTables, "models whose table does not exist").toEqual([]);
    expect(
      missingColumns,
      "columns Prisma will reference and Postgres does not have — every query touching these fails at runtime",
    ).toEqual([]);
  });
});
