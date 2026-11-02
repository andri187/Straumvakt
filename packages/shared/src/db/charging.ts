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

import { sql } from "drizzle-orm";
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
    // ── ADR 0054 decision 6 — a session is SEALED ────────────────────────
    //
    // OCPI `mod_cdrs` puts it exactly: a CDR is "sealed, preserving the
    // information valid at the moment in time the underlying session was
    // started", carries the owning party, and COPIES the location in rather
    // than referencing it. Decision 6 is that rule, and these columns are what
    // make it enforceable rather than aspirational.
    //
    // A session is NEVER re-attributed when a device moves. A dispute years
    // later must be answerable without reconstructing where the device was
    // that day — and reconstruction is exactly what a bare foreign key forces,
    // because the row it points at has moved on.

    /**
     * The placement live at session start.
     *
     * Nullable: sessions written before migration 0008 have no placement to
     * point at, and back-filling one would mean deciding where a device was
     * during a period nothing recorded. That is a claim about the past, and
     * `unavailable` is the honest value.
     *
     * This is a REFERENCE, and the snapshot columns beside it are why that is
     * safe. The placement row itself is immutable in the ways that matter —
     * its `device_id`, `org_id` and `installation_id` never change, and only
     * its period's upper bound closes — so pointing at it does not risk
     * re-attribution. What could change (a tariff, a site name) is copied in.
     */
    placementId: uuid("placement_id"),

    /**
     * The tariff AS APPLIED, copied in rather than referenced.
     *
     * `rate_references` rows are effective-dated and new ones supersede old
     * ones; resolving "what did this cost" by re-running the resolver against
     * today's rows is the re-derivation FOCUS rule 4 forbids. The shape mirrors
     * a resolved rate reference — `code`, `basis`, `priceMinor`, `currency`,
     * `vatRatePct`, `supplierOrgId` — so a dispute is answered by reading one
     * row rather than by reconstructing a resolver's state from an earlier day.
     *
     * JSONB rather than columns because a tariff is not one number: an org may
     * be on per-kWh and per-minute at once, and flattening that into columns
     * fixes the arity of something the agreement model deliberately leaves
     * open.
     */
    tariffSnapshotJson: jsonb("tariff_snapshot_json"),

    /**
     * WHEN the snapshot was taken.
     *
     * Almost always equal to `started_at`, and stored separately anyway,
     * because "the tariff we sealed" and "the moment the session began" are
     * different facts and a gap between them is a bug worth being able to see.
     * A snapshot taken at stop time would silently price a session that
     * straddles a rate change at the wrong rate.
     */
    tariffSnapshotAt: timestamp("tariff_snapshot_at", { withTimezone: true, precision: 6, mode: "date" }),
  },
  (t) => [
    index().on(t.orgId, t.startedAt),
    index().on(t.evseId, t.startedAt),
    index().on(t.userId, t.startedAt),
    index().on(t.evPlcMac),
    // "Which sessions ran on this placement" is the dispute query, and it is
    // also what Phase 5 needs to attribute a mid-month move. Without it that
    // is a scan of every session the org has ever had.
    index().on(t.placementId, t.startedAt),
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
    // @unique in Prisma — lost in the Drizzle port, restored 2026-10-26.
    uniqueIndex().on(t.ocppIdentityId),
    index().on(t.orgId),
    index().on(t.lastObservedAt),
    index().on(t.userId),
  ],
);

/**
 * charging.ocpp_transaction_no_seq — the OCPP 1.6 transactionId namespace.
 *
 * transactionId is a 32-bit signed integer on the wire, so the namespace is
 * exactly 1..2^31-1. One global sequence (not per device) makes the number a
 * unique lookup key on its own; NO CYCLE makes exhaustion a loud error instead
 * of a reused id. A per-connection random id is rejected: it collides and cannot
 * be looked up after a restart. (S1 generic OCPP engine, migration 0003.)
 */
export const ocppTransactionNoSeq = chargingSchema.sequence("ocpp_transaction_no_seq", { startWith: 1, minValue: 1, maxValue: 2147483647, increment: 1, cycle: false });

/**
 * charging.ocpp_transactions — one row per OCPP transaction, SEALED context.
 *
 * org / installation / device / placement are the ones live when the
 * transaction STARTED and are never rewritten: a device that later moves CPO
 * leaves its history where it was. The charger's clock (`*_reported_at`) is
 * stored apart from ours (`*_received_at`); neither chooses a tenant.
 *
 * `authorized = false` rows exist on purpose: a refused start whose charger
 * delivers energy anyway is evidence of an exception. It is kept, flagged
 * `excluded_unauthorized`, and never priced as ordinary use.
 *
 * `costing_state` is the durable hand-off to the existing cost workflow
 * (needed | blocked_energy | excluded_unauthorized | not_needed). Stopping a
 * transaction never depends on a tariff existing.
 */
export const ocppTransactions = chargingSchema.table(
  "ocpp_transactions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    transactionNo: integer("transaction_no").notNull().default(sql`nextval('charging.ocpp_transaction_no_seq')`),
    orgId: uuid("org_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    placementId: uuid("placement_id").notNull(),
    identityString: text("identity_string").notNull(),
    connectorNo: integer("connector_no").notNull(),
    idTag: text("id_tag").notNull(),
    authorization: jsonb("authorization").notNull(),
    authorized: boolean("authorized").notNull(),
    userId: uuid("user_id"),
    idTokenId: uuid("id_token_id"),
    meterStartWh: bigint("meter_start_wh", { mode: "number" }).notNull(),
    meterStopWh: bigint("meter_stop_wh", { mode: "number" }),
    startedReportedAt: timestamp("started_reported_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    startedReceivedAt: timestamp("started_received_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    stoppedReportedAt: timestamp("stopped_reported_at", { withTimezone: true, precision: 6, mode: "date" }),
    stoppedReceivedAt: timestamp("stopped_received_at", { withTimezone: true, precision: 6, mode: "date" }),
    stopReason: text("stop_reason"),
    energyWh: bigint("energy_wh", { mode: "number" }),
    energyQuality: text("energy_quality"),
    costingState: text("costing_state").notNull().default("not_needed"),
    /** When the costing consumer reached a terminal outcome (costed or an explicit unresolved state). */
    costedAt: timestamp("costed_at", { withTimezone: true, precision: 6, mode: "date" }),
    /** Why: reason/factors for an unresolved state, or line count + totals for a costed one. Never a secret. */
    costingDetail: jsonb("costing_detail"),
    /** Failed consumer attempts; the consumer parks a row at the bound so it cannot starve others. */
    costingAttempts: integer("costing_attempts").notNull().default(0),
    reconcileFlag: text("reconcile_flag"),
    /**
     * The terms that applied, captured ONCE at start, as of the server start time (see costing/terms-snapshot.ts):
     * agreement, clauses, bearer rules, rate references and driver-group membership, content-addressed by sha-256.
     * A trigger (migration 0007) refuses any later change to a non-null value, so editing a rate, clause or rule
     * after the session started cannot change how it is priced or who pays. NULL = started before this contract.
     */
    termsSnapshot: jsonb("terms_snapshot"),
    startReceiptId: uuid("start_receipt_id").notNull(),
    stopReceiptId: uuid("stop_receipt_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.transactionNo),
    index().on(t.deviceId, t.connectorNo),
    index().on(t.orgId, t.startedReceivedAt),
    index().on(t.installationId, t.startedReceivedAt),
    // The costing consumer's claim: only rows that still need costing.
    index("ocpp_transactions_costing_needed_index").on(t.startedReceivedAt).where(sql`${t.costingState} = 'needed'`),
    // A driver's open sessions, for the live-access grant (src/lib/sync/driver-live.ts): partial, so it holds only sessions in
    // progress and stays tiny, and the grant read is one indexed lookup instead of a scan of every transaction.
    index("ocpp_transactions_open_by_user_index").on(t.userId).where(sql`${t.stoppedReceivedAt} IS NULL AND ${t.userId} IS NOT NULL`),
  ],
);

/**
 * charging.ocpp_transaction_readings — meter evidence, one row per sample time.
 *
 * Primary key (transaction_id, sampled_at) makes a redelivered MeterValues a
 * no-op. Energy and power are columns; every other measurand is kept verbatim
 * in `other`, so nothing reported is dropped and nothing multiplies rows.
 */
export const ocppTransactionReadings = chargingSchema.table(
  "ocpp_transaction_readings",
  {
    transactionId: uuid("transaction_id").notNull(),
    sampledAt: timestamp("sampled_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    energyWh: bigint("energy_wh", { mode: "number" }),
    powerW: integer("power_w"),
    other: jsonb("other").notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.sampledAt] })],
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

