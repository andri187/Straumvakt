// Does the Drizzle identity schema describe the database that actually exists?
//
// A Drizzle table declaration typechecks whether or not it is true. Get a
// column name wrong and nothing complains until a query returns undefined at
// runtime, in production, for one code path. drizzle-kit introspection cannot
// generate these declarations — it does not support Postgres schema names —
// so they are hand-owned, which means they need checking against the real
// information_schema rather than against a reviewer's attention span.
//
// This is the structural half of the parity harness. The behavioural half is
// identity-repositories.test.ts.

import { describe, expect, it, afterAll } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { closeAll, getPool, hasDb } from "./_harness";
import * as identity from "../../src/domains/identity/schema";

const TABLES: Record<string, PgTable> = {
  users: identity.users,
  userVendorRefs: identity.userVendorRefs,
  idTokens: identity.idTokens,
  vendorUserGroups: identity.vendorUserGroups,
  vendorUserGroupMemberships: identity.vendorUserGroupMemberships,
  userCredentials: identity.userCredentials,
  userTokens: identity.userTokens,
  platformGrants: identity.platformGrants,
  organizations: identity.organizations,
  hostApplications: identity.hostApplications,
  memberships: identity.memberships,
  orgEmailDomains: identity.orgEmailDomains,
  vehicles: identity.vehicles,
  familyGroups: identity.familyGroups,
  familyMemberships: identity.familyMemberships,
};

interface DbColumn {
  column_name: string;
  is_nullable: "YES" | "NO";
  udt_name: string;
  udt_schema: string;
}

/** Map what Drizzle would emit as DDL onto the `udt_name` Postgres reports.
 *  Only the types this domain actually uses — an unmapped one should fail
 *  loudly rather than be waved through. */
function expectedUdt(sqlType: string): string {
  const isArray = sqlType.endsWith("[]");
  const base = isArray ? sqlType.slice(0, -2).trim() : sqlType;
  const bare = base.replace(/\(.*\)$/, "").trim();

  const map: Record<string, string> = {
    uuid: "uuid",
    text: "text",
    citext: "citext",
    integer: "int4",
    bigint: "int8",
    boolean: "bool",
    numeric: "numeric",
    jsonb: "jsonb",
    date: "date",
    "double precision": "float8",
    "timestamp with time zone": "timestamptz",
    "timestamp (6) with time zone": "timestamptz",
    "timestamp": "timestamp",
  };

  // Enums and anything else come through as their own type name; Postgres
  // reports a quoted identifier verbatim.
  const mapped = map[bare] ?? bare.replace(/^"|"$/g, "");
  return isArray ? `_${mapped}` : mapped;
}

describe.skipIf(!hasDb)("identity Drizzle schema matches the database", () => {
  afterAll(closeAll);

  async function columnsOf(schema: string, table: string): Promise<DbColumn[]> {
    const { rows } = await getPool().query<DbColumn>(
      `select column_name, is_nullable, udt_name, udt_schema
         from information_schema.columns
        where table_schema = $1 and table_name = $2
        order by ordinal_position`,
      [schema, table],
    );
    return rows;
  }

  for (const [exportName, table] of Object.entries(TABLES)) {
    const cfg = getTableConfig(table);
    const qualified = `${cfg.schema}.${cfg.name}`;

    describe(`${exportName} → ${qualified}`, () => {
      it("the table exists", async () => {
        const cols = await columnsOf(cfg.schema!, cfg.name);
        expect(cols.length, `${qualified} has no columns — wrong schema or table name`).toBeGreaterThan(0);
      });

      it("declares every column the table has, and no column it does not", async () => {
        const cols = await columnsOf(cfg.schema!, cfg.name);
        const inDb = new Set(cols.map((c) => c.column_name));
        const declared = new Set(cfg.columns.map((c) => c.name));

        const missing = [...inDb].filter((c) => !declared.has(c)).sort();
        const invented = [...declared].filter((c) => !inDb.has(c)).sort();

        // `invented` is the dangerous one: a column that does not exist makes
        // every SELECT on this table throw. `missing` is merely incomplete —
        // recorded so it is a decision rather than an oversight.
        expect(invented, `${qualified}: declared columns that do not exist`).toEqual([]);
        expect(missing, `${qualified}: columns in the database with no declaration`).toEqual([]);
      });

      it("agrees on type and nullability for every column", async () => {
        const cols = await columnsOf(cfg.schema!, cfg.name);
        const byName = new Map(cols.map((c) => [c.column_name, c]));

        const mismatches: string[] = [];
        for (const col of cfg.columns) {
          const db = byName.get(col.name);
          if (!db) continue; // covered by the previous test

          const wantUdt = expectedUdt(col.getSQLType());
          if (db.udt_name !== wantUdt) {
            mismatches.push(
              `${col.name}: declared ${col.getSQLType()} (expects udt ${wantUdt}), database has ${db.udt_name}`,
            );
          }

          const dbNotNull = db.is_nullable === "NO";
          if (col.notNull !== dbNotNull) {
            mismatches.push(
              `${col.name}: declared ${col.notNull ? "NOT NULL" : "nullable"}, database is ${dbNotNull ? "NOT NULL" : "nullable"}`,
            );
          }
        }

        expect(mismatches, `${qualified}`).toEqual([]);
      });
    });
  }
});
