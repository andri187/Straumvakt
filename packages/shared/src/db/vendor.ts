// vendor — the edge where external systems are named — Drizzle table declarations.
//
// Postgres schemas: vendors · hardware
//
// NOTHING MAY IMPORT THIS from the core. Vendor identifiers belong at the
// boundary; the three known leaks are in the dependency-cruiser baseline.
//
// Additive. Prisma still owns these tables and still generates a client for
// them; nothing here replaces anything yet.
//
// First drafted by scripts/drizzle-scaffold-from-prisma.mjs from
// prisma/schema/vendor.prisma, then OWNED BY HAND. Re-running the scaffolder
// over this file discards the hand edits — which is survivable, because
// test/parity/domain-schemas.test.ts checks all 98 tables against
// information_schema and goes red the moment one is lost.
//
// Relations and foreign keys are deliberately NOT declared: Drizzle needs
// them only for db.query relational reads, every ported repository uses
// explicit joins, and a wrong FK declaration would be a silent lie about
// cascade behaviour.

import { assetClassEnum } from "./protocol";
import { customType, index, integer, jsonb, numeric, pgSchema, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

// bytea likewise. Uint8Array rather than Buffer: this runs on Workers,
// where Buffer is a polyfill and node-postgres hands back the former.
const bytea = customType<{ data: Uint8Array }>({ dataType: () => "bytea" });

// vendor_credentials still lives in the hardware Postgres schema; the
// catalogue tables that shared it moved to catalog.ts.
export const hardwareSchema = pgSchema("hardware");
export const vendorsSchema = pgSchema("vendors");


/** Prisma model `VendorCredential` — hardware.vendor_credentials */
export const vendorCredentials = hardwareSchema.table(
  "vendor_credentials",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    ownerOrgId: uuid("owner_org_id").notNull(),
    vendorId: uuid("vendor_id").notNull(),
    username: varchar("username", { length: 200 }).notNull(),
    passwordCipher: bytea("password_cipher"),
    passwordIv: bytea("password_iv"),
    status: text("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, precision: 6, mode: "date" }),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.ownerOrgId, t.vendorId, t.username),
    index().on(t.ownerOrgId),
  ],
);

/** Prisma model `VendorAdapterHealth` — vendors.adapter_health */
export const adapterHealth = vendorsSchema.table(
  "adapter_health",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    vendor: text("vendor").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    errorRate: numeric("error_rate", { precision: 6, scale: 4 }).notNull(),
    p50LatencyMs: integer("p50_latency_ms").notNull(),
    p95LatencyMs: integer("p95_latency_ms").notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true, precision: 6, mode: "date" }),
  },
  (t) => [
    index().on(t.vendor, t.windowStart),
  ],
);

/** Prisma model `VendorContractTest` — vendors.contract_tests */
export const contractTests = vendorsSchema.table(
  "contract_tests",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    vendor: text("vendor").notNull(),
    testName: text("test_name").notNull(),
    result: text("result").notNull(),
    runAt: timestamp("run_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    details: jsonb("details").notNull().default({}),
  },
  (t) => [
    index().on(t.vendor, t.runAt),
  ],
);

/** Prisma model `VendorAssetRef` — vendors.vendor_asset_refs */
export const vendorAssetRefs = vendorsSchema.table(
  "vendor_asset_refs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    chargingStationId: uuid("charging_station_id").notNull(),
    vendorSlug: text("vendor_slug").notNull(),
    vendorAssetId: text("vendor_asset_id").notNull(),
    credentialsRef: text("credentials_ref"),
    capabilities: jsonb("capabilities").notNull().default({}),
    status: text("status").notNull().default("pending"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.vendorSlug, t.vendorAssetId, t.credentialsRef),
    index().on(t.chargingStationId, t.vendorSlug),
    index().on(t.orgId, t.vendorSlug),
  ],
);

