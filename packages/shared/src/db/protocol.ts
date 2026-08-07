// protocol — OCPP and OCPI wire-level state — Drizzle table declarations.
//
// Postgres schemas: ocpp · roaming
//
// Additive. Prisma still owns these tables and still generates a client for
// them; nothing here replaces anything yet.
//
// First drafted by scripts/drizzle-scaffold-from-prisma.mjs from
// prisma/schema/protocol.prisma, then OWNED BY HAND. Re-running the scaffolder
// over this file discards the hand edits — which is survivable, because
// test/parity/domain-schemas.test.ts checks all 98 tables against
// information_schema and goes red the moment one is lost.
//
// Relations and foreign keys are deliberately NOT declared: Drizzle needs
// them only for db.query relational reads, every ported repository uses
// explicit joins, and a wrong FK declaration would be a silent lie about
// cascade behaviour.

import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const ocppSchema = pgSchema("ocpp");

// The `reports` Postgres schema is shared: it holds derived rollups written by
// a higher layer and read here. AMPECO has no reports domain at all — it
// materialises projections per subject — so the schema splits across domain
// files rather than living in one:
//
//   reports.site_energy_daily      assets     (this file)
//   reports.charger_uptime_daily   assets     (this file)
//   reports.command_history        protocol
//   reports.session_ledger         commercial
//   reports.billing_period_summary commercial
//
// Declaring the pgSchema in more than one file is fine — pgSchema() is a
// namespace handle, not a resource.
export const reportsSchema = pgSchema("reports");
export const roamingSchema = pgSchema("roaming");

export const ocppVersionEnum = ocppSchema.enum("OcppVersion", ["ocpp_1_6", "ocpp_2_0_1", "ocpp_2_1"]);
export const assetClassEnum = ocppSchema.enum("AssetClass", ["ac", "dc"]);
export const commandStatusEnum = ocppSchema.enum("CommandStatus", ["pending", "sent", "acked", "failed", "cancelled"]);
export const hubKindEnum = roamingSchema.enum("HubKind", ["hubject", "gireve", "direct"]);
export const cdrDirectionEnum = roamingSchema.enum("CdrDirection", ["inbound", "outbound"]);

/** Prisma model `OcppIdentity` — ocpp.ocpp_identities */
export const ocppIdentities = ocppSchema.table(
  "ocpp_identities",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    chargingStationId: uuid("charging_station_id").notNull(),
    identityString: text("identity_string").notNull(),
    authSecretHash: text("auth_secret_hash"),
    ocppVersion: ocppVersionEnum("ocpp_version").notNull(),
    assetClass: assetClassEnum("asset_class").notNull().default("ac"),
    vendor: text("vendor"),
    vendorResourceId: text("vendor_resource_id"),
    credentialsRef: text("credentials_ref"),
    credentialsStatus: text("credentials_status"),
    status: text("status").notNull().default("provisioned"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.identityString),
    index().on(t.orgId, t.chargingStationId),
  ],
);

/** Prisma model `PendingDiscovery` — ocpp.pending_discoveries */
export const pendingDiscoveries = ocppSchema.table(
  "pending_discoveries",
  {
    identityString: varchar("identity_string", { length: 64 }).primaryKey(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    remoteAddr: varchar("remote_addr", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),
    lastPayloadSummary: jsonb("last_payload_summary"),
  },
  (t) => [
    index().on(t.lastSeenAt),
  ],
);

/** Prisma model `OutboundCommand` — ocpp.outbound_commands */
export const outboundCommands = ocppSchema.table(
  "outbound_commands",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    identityId: uuid("identity_id").notNull(),
    controlDomain: text("control_domain").notNull(),
    routedTo: text("routed_to").notNull(),
    payload: jsonb("payload").notNull(),
    status: commandStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, precision: 6, mode: "date" }),
    result: jsonb("result"),
    correlationId: uuid("correlation_id").notNull(),
    requestedBy: uuid("requested_by"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.status, t.notBefore),
    index().on(t.orgId, t.identityId),
  ],
);

/** Prisma model `OcpiToken` — roaming.ocpi_tokens */

/** Prisma model `HubConnection` — roaming.hub_connections */

/** Prisma model `CdrQueueEntry` — roaming.cdr_queue */

/** Prisma model `ExternalCpmsRef` — roaming.external_cpms_refs */
export const externalCpmsRefs = roamingSchema.table(
  "external_cpms_refs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    chargingStationId: uuid("charging_station_id").notNull(),
    externalCpmsSlug: text("external_cpms_slug").notNull(),
    externalAssetId: text("external_asset_id").notNull(),
    importMode: text("import_mode").notNull(),
    credentialsRef: text("credentials_ref"),
    status: text("status").notNull().default("pending"),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.externalCpmsSlug, t.externalAssetId),
    index().on(t.orgId),
  ],
);

/** Prisma model `OcppConfigurationKey` — ocpp.configuration_keys */

/** Prisma model `CommandHistory` — reports.command_history */
