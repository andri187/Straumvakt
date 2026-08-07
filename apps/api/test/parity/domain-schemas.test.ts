// Do the Drizzle declarations describe the database that actually exists —
// for every domain, every table, every column?
//
// A Drizzle table declaration typechecks whether or not it is true. Get a
// column name wrong and nothing complains until a query returns undefined at
// runtime, in production, on one code path. drizzle-kit introspection cannot
// generate these — it does not support Postgres schema names, and this
// database has twenty — so they are scaffolded and then hand-owned, which
// means they need checking against information_schema rather than against a
// reviewer's attention span.
//
// Supersedes the identity-only version. It found two real things while it was
// identity-only: `tenancy.organizations.roles` being nullable where Prisma
// says otherwise, and the client-side/database-side default split that would
// have broken every insert on half the identity tables.
//
// Point it at a branch that mirrors staging.

import { afterAll, describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { closeAll, getPool, hasDb } from "./_harness";
import * as identity from "@straumvakt/shared/db/identity";
import * as assets from "@straumvakt/shared/db/assets";
import * as charging from "@straumvakt/shared/db/charging";
import * as commercial from "@straumvakt/shared/db/commercial";
import * as vendor from "@straumvakt/shared/db/vendor";
import * as catalog from "@straumvakt/shared/db/catalog";
import * as protocol from "@straumvakt/shared/db/protocol";
import * as platform from "@straumvakt/shared/db/platform";

const DOMAINS: Record<string, Record<string, unknown>> = {
  identity,
  assets,
  charging,
  commercial,
  vendor,
  catalog,
  protocol,
  platform,
};

/** Every exported table across every domain, discovered rather than listed —
 *  a hand-maintained list is the thing that goes stale and quietly shrinks
 *  the coverage this file claims. */
function allTables(): Array<{ domain: string; exportName: string; table: PgTable }> {
  const out: Array<{ domain: string; exportName: string; table: PgTable }> = [];
  for (const [domain, mod] of Object.entries(DOMAINS)) {
    for (const [exportName, value] of Object.entries(mod)) {
      // pgSchema() and enum() exports are not tables; getTableConfig throws
      // on them, so identify tables by the symbol Drizzle stamps on them.
      if (!value || typeof value !== "object") continue;
      const isTable = Object.getOwnPropertySymbols(value).some((s) =>
        String(s).includes("drizzle:IsDrizzleTable"),
      );
      if (isTable) out.push({ domain, exportName, table: value as PgTable });
    }
  }
  return out;
}

interface DbColumn {
  table_schema: string;
  table_name: string;
  column_name: string;
  is_nullable: "YES" | "NO";
  udt_name: string;
  column_default: string | null;
}

/** Map what Drizzle would emit as DDL onto the `udt_name` Postgres reports. */
function expectedUdt(sqlType: string): string {
  const isArray = sqlType.endsWith("[]");
  const base = isArray ? sqlType.slice(0, -2).trim() : sqlType;
  // Precision can sit in the MIDDLE, not only at the end:
  // "timestamp (6) with time zone". Stripping only a trailing "(...)" left
  // that unmatched and reported 246 false mismatches.
  const bare = base.replace(/\s*\(\s*\d+(\s*,\s*\d+)?\s*\)/g, "").trim();

  const map: Record<string, string> = {
    uuid: "uuid",
    text: "text",
    citext: "citext",
    bytea: "bytea",
    integer: "int4",
    bigint: "int8",
    smallint: "int2",
    boolean: "bool",
    numeric: "numeric",
    jsonb: "jsonb",
    json: "json",
    date: "date",
    "double precision": "float8",
    real: "float4",
    "timestamp with time zone": "timestamptz",
    timestamp: "timestamp",
    "character varying": "varchar",
    varchar: "varchar",
  };

  const mapped = map[bare] ?? bare.replace(/^"|"$/g, "");
  return isArray ? `_${mapped}` : mapped;
}

describe.skipIf(!hasDb)("Drizzle domain schemas match the database", () => {
  afterAll(closeAll);

  const tables = allTables();

  let byTable: Map<string, DbColumn[]>;

  async function load() {
    if (byTable) return byTable;
    const schemas = [...new Set(tables.map((t) => getTableConfig(t.table).schema!))];
    const { rows } = await getPool().query<DbColumn>(
      `select table_schema, table_name, column_name, is_nullable, udt_name, column_default
         from information_schema.columns
        where table_schema = any($1)`,
      [schemas],
    );
    byTable = new Map();
    for (const r of rows) {
      const k = `${r.table_schema}.${r.table_name}`;
      if (!byTable.has(k)) byTable.set(k, []);
      byTable.get(k)!.push(r);
    }
    return byTable;
  }

  it("discovered every declared table across all seven domains", () => {
    // 66 Drizzle tables. Was 95; 29 were dropped on 2026-08-07 (ADR 0050
    // decision 3) — tables that had never held a row AND that no code
    // referenced. Not merely empty: 17 empty tables have live writers and
    // were deliberately kept, as was agreements.bearer_rules, which the live
    // billing resolver reads through a relation load.
    //
    // This is an exact equality on purpose. A discovery bug that found
    // nothing would make every assertion below pass vacuously, and a table
    // quietly appearing or vanishing should surface here as a decision to
    // confirm rather than a number that drifts.
    expect(tables.length).toBe(66);
    for (const d of Object.keys(DOMAINS)) {
      expect(tables.filter((t) => t.domain === d).length, `${d} contributed no tables`).toBeGreaterThan(0);
    }
  });

  it("every declared table exists", async () => {
    const db = await load();
    const missing = tables
      .filter((t) => {
        const cfg = getTableConfig(t.table);
        return !db.has(`${cfg.schema}.${cfg.name}`);
      })
      .map((t) => {
        const cfg = getTableConfig(t.table);
        return `${cfg.schema}.${cfg.name} (${t.domain}.${t.exportName})`;
      });
    expect(missing).toEqual([]);
  });

  it("no table declares a column the database does not have", async () => {
    const db = await load();
    const invented: string[] = [];
    for (const t of tables) {
      const cfg = getTableConfig(t.table);
      const actual = new Set((db.get(`${cfg.schema}.${cfg.name}`) ?? []).map((c) => c.column_name));
      if (actual.size === 0) continue;
      for (const col of cfg.columns) {
        if (!actual.has(col.name)) {
          invented.push(`${cfg.schema}.${cfg.name}.${col.name} — ${t.domain}.${t.exportName}`);
        }
      }
    }
    // The dangerous direction: a column that does not exist makes every
    // SELECT on the table throw.
    expect(invented, "declared columns that do not exist").toEqual([]);
  });

  it("no table omits a column the database has", async () => {
    const db = await load();
    const omitted: string[] = [];
    for (const t of tables) {
      const cfg = getTableConfig(t.table);
      const declared = new Set(cfg.columns.map((c) => c.name));
      for (const c of db.get(`${cfg.schema}.${cfg.name}`) ?? []) {
        if (!declared.has(c.column_name)) {
          omitted.push(`${cfg.schema}.${cfg.name}.${c.column_name} — ${t.domain}.${t.exportName}`);
        }
      }
    }
    // Less dangerous — an undeclared column is merely unreadable — but it
    // means the port is incomplete, and finding that out later costs more.
    expect(omitted, "columns in the database with no declaration").toEqual([]);
  });

  it("agrees on type and nullability for every column", async () => {
    const db = await load();
    const mismatches: string[] = [];
    for (const t of tables) {
      const cfg = getTableConfig(t.table);
      const actual = new Map((db.get(`${cfg.schema}.${cfg.name}`) ?? []).map((c) => [c.column_name, c]));
      for (const col of cfg.columns) {
        const c = actual.get(col.name);
        if (!c) continue;
        const want = expectedUdt(col.getSQLType());
        if (c.udt_name !== want) {
          mismatches.push(
            `${cfg.schema}.${cfg.name}.${col.name}: declared ${col.getSQLType()} (udt ${want}), database has ${c.udt_name}`,
          );
        }
        const dbNotNull = c.is_nullable === "NO";
        if (col.notNull !== dbNotNull) {
          mismatches.push(
            `${cfg.schema}.${cfg.name}.${col.name}: declared ${col.notNull ? "NOT NULL" : "nullable"}, database is ${dbNotNull ? "NOT NULL" : "nullable"}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("no column claims a database default the database does not have", async () => {
    // The quietest failure mode. `.defaultNow()` / `.default(x)` without a
    // `$defaultFn` tells Drizzle the column is optional on insert because
    // the DATABASE will fill it. If that is untrue, the type checker is
    // happy and every insert fails on a NOT NULL at runtime.
    const db = await load();
    const lying: string[] = [];
    for (const t of tables) {
      const cfg = getTableConfig(t.table);
      const actual = new Map((db.get(`${cfg.schema}.${cfg.name}`) ?? []).map((c) => [c.column_name, c]));
      for (const col of cfg.columns) {
        const c = actual.get(col.name);
        if (!c || !col.notNull) continue;
        const clientSupplies = typeof (col as { defaultFn?: unknown }).defaultFn === "function";
        if (clientSupplies) continue;
        if (col.hasDefault && c.column_default === null) {
          lying.push(`${cfg.schema}.${cfg.name}.${col.name}`);
        }
      }
    }
    expect(lying, "optional on insert, then NOT NULL at runtime").toEqual([]);
  });
});
