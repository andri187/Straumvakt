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
  column_default: string | null;
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
      `select column_name, is_nullable, udt_name, udt_schema, column_default
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

      // The quietest failure mode in the whole port.
      //
      // A NOT NULL column with no database default and no client-side
      // generator means every INSERT fails — but only at runtime, only on
      // the write path, and the type checker is perfectly happy. Prisma was
      // filling these in from `@default(uuid())` and `@updatedAt`, neither
      // of which leaves a trace in the DDL: identity.users.id has no
      // default at all, while identity.id_tokens.id has gen_random_uuid()
      // because that migration was written by hand. Half and half, with
      // nothing to tell them apart by inspection.
      it("can supply a value for every NOT NULL column on insert", async () => {
        const cols = await columnsOf(cfg.schema!, cfg.name);
        const byName = new Map(cols.map((c) => [c.column_name, c]));

        const unfillable: string[] = [];
        const lyingAboutDb: string[] = [];
        for (const col of cfg.columns) {
          const db = byName.get(col.name);
          if (!db || !col.notNull) continue;

          const dbSupplies = db.column_default !== null;
          // `.$defaultFn()` is client-side and works whatever the database
          // does. `.hasDefault` without one is a CLAIM that the database
          // has a default — which makes the column optional on insert, so
          // if the claim is wrong every insert fails on a NOT NULL.
          const clientSupplies = typeof (col as { defaultFn?: unknown }).defaultFn === "function";
          const claimsDbDefault = col.hasDefault && !clientSupplies;

          if (clientSupplies) continue;
          if (claimsDbDefault && !dbSupplies) lyingAboutDb.push(col.name);
          if (!claimsDbDefault && !dbSupplies) unfillable.push(col.name);
        }

        expect(
          lyingAboutDb,
          `${qualified}: declared with a default the database does not have — optional on insert, then NOT NULL at runtime`,
        ).toEqual([]);

        // Columns the caller always passes explicitly are fine — this is
        // about the ones nobody thinks about. Kept as an allowlist so a new
        // one has to be argued for rather than absorbed.
        // Database column names, because that is what `col.name` carries.
        const CALLER_SUPPLIED: Record<string, string[]> = {
          "identity.users": ["email"],
          "identity.user_vendor_refs": ["user_id", "vendor_slug", "vendor_user_id", "last_synced_at"],
          "identity.id_tokens": ["user_id", "kind", "value"],
          "identity.vendor_user_groups": ["vendor_slug", "vendor_group_id", "installation_id", "name", "last_synced_at"],
          "identity.vendor_user_group_memberships": ["group_id", "user_id", "role"],
          "identity.user_credentials": ["user_id"],
          "identity.user_tokens": ["user_id", "kind", "token_hash", "expires_at"],
          "identity.platform_grants": ["user_id", "role", "granted_at"],
          "tenancy.organizations": ["display_name", "country_code"],
          "tenancy.host_applications": ["company_name", "contact_name", "contact_email", "site_type"],
          "tenancy.memberships": ["org_id", "user_id", "role"],
          "tenancy.org_email_domains": ["org_id", "domain"],
          "people.vehicles": ["user_id"],
          "people.family_groups": ["org_id", "display_name", "primary_user_id"],
          "people.family_memberships": ["family_group_id", "user_id", "member_kind", "joined_at"],
        };
        const allowed = new Set(CALLER_SUPPLIED[qualified] ?? []);
        const surprises = unfillable.filter((c) => !allowed.has(c));

        expect(
          surprises,
          `${qualified}: NOT NULL with no database default and no client default — every insert fails`,
        ).toEqual([]);
      });
    });
  }
});
