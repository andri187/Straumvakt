// The active Drizzle migration chain must carry the hand-written constraints
// that drizzle-kit cannot express.
//
// WHY THIS EXISTS
// ---------------
// Migrations 0000-0008 were collapsed into one cold baseline (0000_cold_hex).
// The collapse was regenerated from the TypeScript schema, and EXCLUDE and
// CHECK constraints are not in that schema or in drizzle-kit's snapshot, so
// btree_gist and 11 constraints from the retired 0005/0006/0007 vanished
// without any check noticing: table and column parity still matched.
//
// The list below is RESTATED, not derived (same reasoning as
// packages/shared/src/db/tests/unique-constraints.test.ts): a constraint
// removed from the migration must also be removed here, in a test file.
//
// This is a STATIC check on SQL text. It proves the definitions are present,
// correctly spelled, on columns that exist, and never dropped later in the
// chain. It does NOT prove PostgreSQL accepts or enforces them; that needs a
// disposable database (see the 2026-10-26 agent-run handoff).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const DRIZZLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const journal = JSON.parse(readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8")) as Journal;

/** Strip comments, collapse whitespace, split on drizzle's breakpoints. */
function statementsOf(sql: string): string[] {
  return sql
    .replace(/--(?!>)[^\r\n]*/g, "")
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/--> statement-breakpoint/g, "").replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim())
    .filter((s) => s.length > 0);
}

const chain = journal.entries.map((e) => ({
  tag: e.tag,
  sql: readFileSync(path.join(DRIZZLE_DIR, `${e.tag}.sql`), "utf8"),
}));
const statements = chain.flatMap((m) => statementsOf(m.sql));

const WELL_FORMED = 'CHECK (NOT isempty("period") AND NOT lower_inf("period"))';
const OCPP_STATUS =
  "CHECK (\"status\" IN ('Available', 'Preparing', 'Charging', 'SuspendedEV', 'SuspendedEVSE', " +
  "'Finishing', 'Reserved', 'Unavailable', 'Faulted', 'unknown')) NOT VALID";

interface Expected {
  schema: string;
  table: string;
  name: string;
  definition: string;
  columns: string[];
}

const EXPECTED: Expected[] = [
  // Well-formed periods (4)
  { schema: "assets", table: "placements", name: "placements_period_well_formed", definition: WELL_FORMED, columns: ["period"] },
  { schema: "assets", table: "device_identities", name: "device_identities_period_well_formed", definition: WELL_FORMED, columns: ["period"] },
  { schema: "agreements", table: "agreement_clauses", name: "agreement_clauses_period_well_formed", definition: WELL_FORMED, columns: ["period"] },
  { schema: "agreements", table: "driver_group_memberships", name: "driver_group_memberships_period_well_formed", definition: WELL_FORMED, columns: ["period"] },
  // No overlapping periods (5)
  {
    schema: "assets", table: "placements", name: "placements_one_place_at_a_time",
    definition: 'EXCLUDE USING GIST ("device_id" WITH =, "period" WITH &&)',
    columns: ["device_id", "period"],
  },
  {
    schema: "assets", table: "device_identities", name: "device_identities_one_identity_per_device_at_a_time",
    definition: 'EXCLUDE USING GIST ("device_id" WITH =, "period" WITH &&)',
    columns: ["device_id", "period"],
  },
  {
    schema: "assets", table: "device_identities", name: "device_identities_one_device_per_identity_at_a_time",
    definition: 'EXCLUDE USING GIST ("identity_string" WITH =, "period" WITH &&)',
    columns: ["identity_string", "period"],
  },
  {
    schema: "agreements", table: "agreement_clauses", name: "agreement_clauses_one_clause_per_factor_at_a_time",
    definition: 'EXCLUDE USING GIST ("agreement_id" WITH =, "cost_factor_id" WITH =, "period" WITH &&)',
    columns: ["agreement_id", "cost_factor_id", "period"],
  },
  {
    schema: "agreements", table: "driver_group_memberships", name: "driver_group_memberships_one_membership_at_a_time",
    definition: 'EXCLUDE USING GIST ("driver_group_id" WITH =, "user_id" WITH =, "period" WITH &&)',
    columns: ["driver_group_id", "user_id", "period"],
  },
  // OCPP status vocabulary (2). NOT VALID is deliberate: no database was read.
  { schema: "assets", table: "connectors", name: "connectors_status_is_ocpp_vocabulary", definition: OCPP_STATUS, columns: ["status"] },
  { schema: "assets", table: "evses", name: "evses_status_is_ocpp_vocabulary", definition: OCPP_STATUS, columns: ["status"] },
];

function createTableBody(schema: string, table: string): string | undefined {
  const head = `CREATE TABLE "${schema}"."${table}" (`;
  return statements.find((s) => s.startsWith(head));
}

describe("migration chain integrity", () => {
  it("journal entries are contiguous and every file exists", () => {
    expect(chain.length).toBeGreaterThan(0);
    journal.entries.forEach((e, i) => expect(e.idx).toBe(i));
  });

  it("restates exactly 11 constraints", () => {
    expect(EXPECTED).toHaveLength(11);
    expect(new Set(EXPECTED.map((e) => e.name)).size).toBe(11);
  });
});

describe("hand-written constraints survive in the active migration chain", () => {
  it("enables btree_gist before any EXCLUDE uses it", () => {
    const extensionAt = statements.findIndex((s) => s === "CREATE EXTENSION IF NOT EXISTS btree_gist;");
    expect(extensionAt, "CREATE EXTENSION IF NOT EXISTS btree_gist is missing").toBeGreaterThanOrEqual(0);

    const firstExcludeAt = statements.findIndex((s) => s.includes("EXCLUDE USING GIST"));
    expect(firstExcludeAt).toBeGreaterThan(extensionAt);
  });

  it.each(EXPECTED.map((e) => [e.name, e] as const))("%s", (_name, e) => {
    const wanted = `ALTER TABLE "${e.schema}"."${e.table}" ADD CONSTRAINT "${e.name}" ${e.definition};`;
    const matches = statements.filter((s) => s === wanted || s === wanted.replace(/;$/, ""));
    expect(matches, `exact definition of ${e.name} not found exactly once`).toHaveLength(1);

    // Added after its table is created.
    const createdAt = statements.findIndex((s) => s.startsWith(`CREATE TABLE "${e.schema}"."${e.table}" (`));
    const addedAt = statements.findIndex((s) => s === wanted || s === wanted.replace(/;$/, ""));
    expect(createdAt, `${e.schema}.${e.table} is not created in the chain`).toBeGreaterThanOrEqual(0);
    expect(addedAt).toBeGreaterThan(createdAt);

    // Every column it names exists on the table.
    const body = createTableBody(e.schema, e.table);
    expect(body).toBeDefined();
    for (const col of e.columns) {
      expect(body, `${e.schema}.${e.table} has no column "${col}"`).toContain(`"${col}" `);
    }

    // Never dropped later in the chain.
    const dropped = statements.some((s) => s.includes(`DROP CONSTRAINT "${e.name}"`) || s.includes(`DROP CONSTRAINT IF EXISTS "${e.name}"`));
    expect(dropped, `${e.name} is dropped somewhere in the chain`).toBe(false);
  });

  it("keeps the two OCPP status checks NOT VALID until a census validates them", () => {
    const status = EXPECTED.filter((e) => e.name.endsWith("_status_is_ocpp_vocabulary"));
    expect(status).toHaveLength(2);
    for (const e of status) {
      expect(e.definition.endsWith("NOT VALID")).toBe(true);
    }
  });

  it("does not reintroduce pair-unique indexes that would contradict dated periods", () => {
    const pairUnique = [
      'ON "agreements"."agreement_clauses" USING btree ("agreement_id","cost_factor_id")',
      'ON "agreements"."driver_group_memberships" USING btree ("driver_group_id","user_id")',
    ];
    for (const tail of pairUnique) {
      const offending = statements.filter((s) => s.startsWith("CREATE UNIQUE INDEX") && s.includes(tail));
      expect(offending, `a unique index on ${tail} forbids a second dated period`).toEqual([]);
    }
  });
});
