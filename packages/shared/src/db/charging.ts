// charging — sessions and what happened during them — Drizzle table declarations.
//
// Postgres schemas: charging
//
// Depends on assets, identity.
//
// Additive. Prisma still owns these tables and still generates a client for
// them; nothing here replaces anything yet.
//
// First drafted by scripts/drizzle-scaffold-from-prisma.mjs from
// prisma/schema/charging.prisma, then OWNED BY HAND. Re-running the scaffolder
// over this file discards the hand edits — which is survivable, because
// test/parity/domain-schemas.test.ts checks all 98 tables against
// information_schema and goes red the moment one is lost.
//
// Relations and foreign keys are deliberately NOT declared: Drizzle needs
// them only for db.query relational reads, every ported repository uses
// explicit joins, and a wrong FK declaration would be a silent lie about
// cascade behaviour.

import { bigint, boolean, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const chargingSchema = pgSchema("charging");

export const sessionStatusEnum = chargingSchema.enum("SessionStatus", ["in_progress", "completed", "aborted"]);

/** Prisma model `ChargeSession` — charging.sessions */
export const sessions = chargingSchema.table(
  "sessions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    siteId: uuid("site_id").notNull(),
    chargingStationId: uuid("charging_station_id").notNull(),
    evseId: uuid("evse_id").notNull(),
    connectorId: uuid("connector_id"),
    ocppIdentityId: uuid("ocpp_identity_id"),
    userId: uuid("user_id"),
    idTag: text("id_tag"),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, precision: 6, mode: "date" }),
    energyWh: bigint("energy_wh", { mode: "bigint" }),
    stopReason: text("stop_reason"),
    status: sessionStatusEnum("status").notNull().default("in_progress"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    costExVatMinor: bigint("cost_ex_vat_minor", { mode: "bigint" }),
    costIncVatMinor: bigint("cost_inc_vat_minor", { mode: "bigint" }),
    completedSessionRawJson: jsonb("completed_session_raw_json"),
    ocmfSignedSession: text("ocmf_signed_session"),
    ocmfFormatVersion: text("ocmf_format_version"),
    ocmfGatewayId: text("ocmf_gateway_id"),
    ocmfGatewaySerial: text("ocmf_gateway_serial"),
    ocmfGatewayVersion: text("ocmf_gateway_version"),
    authIdStatus: boolean("auth_id_status"),
    authIdLevel: text("auth_id_level"),
    authIdType: text("auth_id_type"),
    authIdValue: text("auth_id_value"),
    // HAND-EDIT, not from the scaffolder. Prisma types this as a non-null
    // list; Postgres allows NULL, because Prisma does NOT emit NOT NULL for
    // scalar list columns. Four columns in this database are affected and
    // only tenancy.memberships.scope_* escape it, via a hand-written
    // migration. Declared to match the DATABASE, which is what a query
    // actually returns. See docs/notes/2026-08-06-schema-database-drift-
    // reconciliation.md; restoring the constraints is a staging migration.
    authIdFlags: text("auth_id_flags").array(),
    ocmfFirstReadingKwh: numeric("ocmf_first_reading_kwh", { precision: 14, scale: 4 }),
    ocmfLastReadingKwh: numeric("ocmf_last_reading_kwh", { precision: 14, scale: 4 }),
    ocmfSignedSessionKwh: numeric("ocmf_signed_session_kwh", { precision: 14, scale: 4 }),
    completedSessionSeenAt: timestamp("completed_session_seen_at", { withTimezone: true, precision: 6, mode: "date" }),
    evPlcMac: text("ev_plc_mac"),
    evPlcMacOuiVendor: text("ev_plc_mac_oui_vendor"),
    evPlcPibVersion: text("ev_plc_pib_version"),
    cableType: text("cable_type"),
    pncAttempted: boolean("pnc_attempted"),
    pncSucceeded: boolean("pnc_succeeded"),
    pncRejectedUuid: text("pnc_rejected_uuid"),
    ocppEnergyKwh: numeric("ocpp_energy_kwh", { precision: 10, scale: 4 }),
    cdrEnergyKwh: numeric("cdr_energy_kwh", { precision: 10, scale: 4 }),
    amqpEnergyKwh: numeric("amqp_energy_kwh", { precision: 10, scale: 4 }),
    ocppStoppedAt: timestamp("ocpp_stopped_at", { withTimezone: true, precision: 6, mode: "date" }),
    cdrStoppedAt: timestamp("cdr_stopped_at", { withTimezone: true, precision: 6, mode: "date" }),
    ocmfBlobRef: text("ocmf_blob_ref"),
  },
  (t) => [
    index().on(t.orgId, t.startedAt),
    index().on(t.evseId, t.startedAt),
    index().on(t.userId, t.startedAt),
    index().on(t.evPlcMac),
  ],
);

/** Prisma model `MeterValue` — charging.meter_values */
export const meterValues = chargingSchema.table(
  "meter_values",
  {
    id: uuid("id").notNull(),
    orgId: uuid("org_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    energyWh: bigint("energy_wh", { mode: "bigint" }),
    powerW: integer("power_w"),
    voltageV: numeric("voltage_v", { precision: 6, scale: 2 }),
    currentA: numeric("current_a", { precision: 6, scale: 2 }),
    socPercent: numeric("soc_percent", { precision: 5, scale: 2 }),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.measuredAt] }),
    index().on(t.sessionId, t.measuredAt),
  ],
);

/** Prisma model `Reservation` — charging.reservations */
export const reservations = chargingSchema.table(
  "reservations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    connectorId: uuid("connector_id").notNull(),
    userId: uuid("user_id"),
    reservedFrom: timestamp("reserved_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    reservedUntil: timestamp("reserved_until", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    status: text("status").notNull().default("confirmed"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.orgId, t.reservedFrom),
  ],
);

/** Prisma model `ProtocolTransactionRef` — charging.protocol_transaction_refs */
export const protocolTransactionRefs = chargingSchema.table(
  "protocol_transaction_refs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.sourceKind, t.sourceId),
    index().on(t.sessionId),
  ],
);

/** Prisma model `ImportedCdrRef` — charging.imported_cdr_refs */
export const importedCdrRefs = chargingSchema.table(
  "imported_cdr_refs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceCdrId: text("source_cdr_id").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.sourceKind, t.sourceCdrId),
    index().on(t.sessionId),
  ],
);

/** Prisma model `TapIntent` — charging.tap_intents */
export const tapIntents = chargingSchema.table(
  "tap_intents",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").notNull(),
    chargingStationId: uuid("charging_station_id").notNull(),
    evseId: uuid("evse_id"),
    deviceHandle: text("device_handle"),
    bleRssi: integer("ble_rssi"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, precision: 6, mode: "date" }),
    consumedIdTag: text("consumed_id_tag"),
  },
  (t) => [
    index().on(t.chargingStationId, t.consumedAt, t.expiresAt),
    index().on(t.userId, t.expiresAt),
  ],
);

/** Prisma model `LiveSession` — charging.live_sessions */
export const liveSessions = chargingSchema.table(
  "live_sessions",
  {
    chargingStationId: uuid("charging_station_id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    ocppIdentityId: uuid("ocpp_identity_id").notNull(),
    vendorResourceId: text("vendor_resource_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    lastOperationMode: integer("last_operation_mode"),
    lastPowerW: numeric("last_power_w", { precision: 10, scale: 0 }),
    lastSessionEnergyWh: numeric("last_session_energy_wh", { precision: 12, scale: 0 }),
    connectedAt: timestamp("connected_at", { withTimezone: true, precision: 6, mode: "date" }),
    chargingStartedAt: timestamp("charging_started_at", { withTimezone: true, precision: 6, mode: "date" }),
    lastModeAt: timestamp("last_mode_at", { withTimezone: true, precision: 6, mode: "date" }),
    chargingSeconds: integer("charging_seconds").notNull().default(0),
    nonChargingSeconds: integer("non_charging_seconds").notNull().default(0),
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId),
    index().on(t.lastObservedAt),
    index().on(t.userId),
  ],
);

/** Prisma model `LiveSessionSample` — charging.live_session_samples */
export const liveSessionSamples = chargingSchema.table(
  "live_session_samples",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    chargerId: uuid("charger_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    powerW: integer("power_w"),
    energyWh: bigint("energy_wh", { mode: "bigint" }),
    stateId: integer("state_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.chargerId, t.observedAt),
  ],
);

