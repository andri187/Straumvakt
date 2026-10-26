// Every field-level `@unique` in the Prisma schema must exist as a unique
// index in the Drizzle declarations.
//
// This test exists because all 13 of them went missing at once, and stayed
// missing for months. `scripts/drizzle-scaffold-from-prisma.mjs` parsed
// `@unique` into an `isUnique` flag on every field and then never emitted it —
// one unused variable, thirteen dropped constraints. Every composite
// `@@unique` came through intact, 32 of 32, which is why the counts looked
// healthy: 85 tables, 85 tables; 67 enums, 67 enums.
//
// Nothing downstream could catch it. `check-schema-consistency.mjs` compares
// tables and columns only — its success line is literally "Drizzle and Prisma
// agree (N tables, N columns)". And `drizzle-baseline.mjs` recorded migration
// 0000 as applied without running it, so no database was ever built from these
// declarations to contradict them. Three safety nets, all blind to the same
// class of thing.
//
// What a fresh database would have shipped without this: two accounts on one
// email address, two RFID tokens carrying the same value, duplicate auth token
// hashes. Silent, and only discoverable from the wrong side.
//
// The list below is RESTATED rather than derived from the schema, deliberately
// — the same reasoning core-billing-enums.test.ts gives for restating its
// unions. Deriving it from the Drizzle tables would make the test tautological:
// a constraint deleted from the schema would simply vanish from the expected
// list too, and pass. Restating means a deletion has to be made twice, and the
// second place is a test file.
//
// Composite `@@unique` constraints are not listed. The scaffolder always
// emitted those, and they render through the same `uniqueIndex()` call, so
// they fail the same way if they ever go.

import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { chargingStations, controlRoutingPolicies, modems } from "../assets";
import { vendors } from "../catalog";
import { liveSessions } from "../charging";
import { agreementsCostFactors, billingCostFactors } from "../commercial";
import { idTokens, organizations, userTokens, users, vehicles } from "../identity";

/**
 * Prisma field-level `@unique`, as of 2026-10-26. Thirteen of them.
 * Columns are Postgres names, not TypeScript property names.
 */
const SINGLE_COLUMN_UNIQUE: ReadonlyArray<readonly [label: string, table: PgTable, column: string]> = [
  ["identity.users.email", users, "email"],
  ["identity.users.kennitala", users, "kennitala"],
  ["tenancy.organizations.kennitala", organizations, "kennitala"],
  ["identity.id_tokens.value", idTokens, "value"],
  ["identity.user_tokens.token_hash", userTokens, "token_hash"],
  ["people.vehicles.vin", vehicles, "vin"],
  ["assets.charging_stations.serial_number", chargingStations, "serial_number"],
  ["assets.control_routing_policies.charging_station_id", controlRoutingPolicies, "charging_station_id"],
  ["assets.modems.imei", modems, "imei"],
  ["charging.live_sessions.ocpp_identity_id", liveSessions, "ocpp_identity_id"],
  ["hardware.vendors.slug", vendors, "slug"],
  ["billing.cost_factors.code", billingCostFactors, "code"],
  ["agreements.cost_factors.code", agreementsCostFactors, "code"],
];

/** The Postgres column names covered by each unique index on a table. */
function uniqueIndexColumns(table: PgTable): string[][] {
  return getTableConfig(table)
    .indexes.filter((idx) => idx.config.unique)
    .map((idx) =>
      idx.config.columns.map((col) => {
        const named = col as { name?: unknown };
        return typeof named.name === "string" ? named.name : "<expression>";
      }),
    );
}

describe("single-column unique constraints", () => {
  it("still lists all thirteen", () => {
    // Guards the list itself: if a constraint is dropped from the schema and
    // from this file, the count is the last thing left to notice.
    expect(SINGLE_COLUMN_UNIQUE).toHaveLength(13);
  });

  for (const [label, table, column] of SINGLE_COLUMN_UNIQUE) {
    it(`${label} has a unique index`, () => {
      const covered = uniqueIndexColumns(table);
      const match = covered.some((cols) => cols.length === 1 && cols[0] === column);

      expect(
        match,
        `no single-column unique index on ${label}. Unique indexes present: ${
          covered.length ? covered.map((c) => `(${c.join(", ")})`).join(" ") : "none"
        }`,
      ).toBe(true);
    });
  }
});
