// assets — where things are and what they are — Drizzle table declarations.
//
// Postgres schemas: properties · assets · energy
//
// Depends on identity.
//
// Additive. Prisma still owns these tables and still generates a client for
// them; nothing here replaces anything yet.
//
// First drafted by scripts/drizzle-scaffold-from-prisma.mjs from
// prisma/schema/assets.prisma, then OWNED BY HAND. Re-running the scaffolder
// over this file discards the hand edits — which is survivable, because
// test/parity/domain-schemas.test.ts checks all 98 tables against
// information_schema and goes red the moment one is lost.
//
// Relations and foreign keys are deliberately NOT declared: Drizzle needs
// them only for db.query relational reads, every ported repository uses
// explicit joins, and a wrong FK declaration would be a silent lie about
// cascade behaviour.

import { sql } from "drizzle-orm";
import { bigint, boolean, customType, date, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const assetsSchema = pgSchema("assets");
export const energySchema = pgSchema("energy");
export const propertiesSchema = pgSchema("properties");

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

export const siteAccessLevelEnum = propertiesSchema.enum("SiteAccessLevel", ["public", "private", "taxi_only"]);
export const sitePowerClassEnum = propertiesSchema.enum("SitePowerClass", ["lt_50kw", "between_50_150kw", "between_150_500kw", "gt_500kw"]);
export const siteAssetKindEnum = propertiesSchema.enum("SiteAssetKind", ["charger", "meter", "modem", "controller"]);
export const installationTypeEnum = propertiesSchema.enum("InstallationType", ["workplace", "mdu", "public", "private", "mixed"]);
export const installationOnboardingStatusEnum = propertiesSchema.enum("InstallationOnboardingStatus", ["pending_credentials", "discovering", "active", "suspended", "error"]);
export const siteTypeEnum = propertiesSchema.enum("SiteType", ["standard", "workplace", "mdu", "hotel", "fleet", "retail"]);

/** Prisma model `Property` — properties.properties */
export const properties = propertiesSchema.table(
  "properties",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    displayName: text("display_name").notNull(),
    address: jsonb("address").notNull().default({}),
    locationType: text("location_type"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    provisioningStatus: text("provisioning_status").notNull().default("provisioned"),
    external: boolean("external").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId),
  ],
);

/** Prisma model `Site` — properties.sites */
export const sites = propertiesSchema.table(
  "sites",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    propertyId: uuid("property_id").notNull(),
    displayName: text("display_name").notNull(),
    timezone: text("timezone").notNull().default("Atlantic/Reykjavik"),
    accessLevel: siteAccessLevelEnum("access_level").notNull().default("private"),
    powerClass: sitePowerClassEnum("power_class"),
    provisioningStatus: text("provisioning_status").notNull().default("provisioned"),
    external: boolean("external").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    siteType: siteTypeEnum("site_type").notNull().default("standard"),
    dsoTariffId: uuid("dso_tariff_id"),
    usrfTariffId: uuid("usrf_tariff_id"),
    usrfPremTariffId: uuid("usrf_prem_tariff_id"),
    xtrrfTariffId: uuid("xtrrf_tariff_id"),
    spvivfTariffId: uuid("spvivf_tariff_id"),
    openingHours: jsonb("opening_hours").notNull().default({}),
    accessNote: text("access_note"),
    photoUrl: text("photo_url"),
  },
  (t) => [
    index().on(t.orgId, t.propertyId),
  ],
);

/** Prisma model `SiteAsset` — properties.site_assets */
export const siteAssets = propertiesSchema.table(
  "site_assets",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    siteId: uuid("site_id").notNull(),
    kind: siteAssetKindEnum("kind").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.siteId),
    index().on(t.kind, t.status),
  ],
);

/** Prisma model `Installation` — properties.installations */
export const installations = propertiesSchema.table(
  "installations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    siteId: uuid("site_id").notNull(),
    vendorId: uuid("vendor_id"),
    modelId: uuid("model_id"),
    displayName: text("display_name").notNull(),
    vendorInstallationRef: text("vendor_installation_ref"),
    credentialsRef: text("credentials_ref"),
    credentialsId: uuid("credentials_id"),
    credentialsStatus: text("credentials_status"),
    onboardingStatus: installationOnboardingStatusEnum("onboarding_status").notNull().default("pending_credentials"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    retailerTariffId: uuid("retailer_tariff_id"),
    enforceAuthorize: boolean("enforce_authorize").notNull().default(false),
    installationType: installationTypeEnum("installation_type").notNull().default("workplace"),
    /**
     * S1 installation management (migration 0002). Stable routing key: allocated
     * once at creation, never derived from display_name, so a rename cannot move
     * the future charger connection address. Unique across all installations.
     */
    installationKey: text("installation_key"),
    /** Optimistic-concurrency counter. Every saved edit bumps it by one. */
    revision: integer("revision").notNull().default(1),
    /** Main protective device. NULL = unknown, which is not the same as 0. */
    mainDeviceType: text("main_device_type"),
    mainRatingAmps: integer("main_rating_amps"),
    mainPhaseCount: integer("main_phase_count"),
    /** On-site electrician. Not a Straumvakt user and not the signed-in account. */
    electricianName: text("electrician_name"),
    electricianEmail: text("electrician_email"),
    electricianPhone: text("electrician_phone"),
    /** The installation `revision` at which the electrician details last changed; 0 = never provided. */
    electricianChangedRevision: integer("electrician_changed_revision").notNull().default(0),
    /**
     * The installation `revision` the electrician confirmed by email. NULL until
     * email confirmation exists. Confirmed only while this equals `revision`, so
     * any later contact or electrical edit leaves the installation unconfirmed.
     */
    responsibleConfirmedRevision: integer("responsible_confirmed_revision"),
    /** 'unset' until chosen; 'none' is a deliberate no-password choice. */
    ocppPasswordMode: text("ocpp_password_mode").notNull().default("unset"),
    /** Salted PBKDF2 verifier. Never returned by any read, never audited. */
    ocppPasswordVerifier: text("ocpp_password_verifier"),
    ocppPasswordSetAt: timestamp("ocpp_password_set_at", { withTimezone: true, precision: 6, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, precision: 6, mode: "date" }),
    /**
     * Operational-state counter (S1 deltas, migration 0004). Bumped, under this
     * row's lock, by every CHANGED device status in the installation; a device's
     * `device_operational_state.seq` records the value it was written at. It is
     * deliberately NOT `revision`: a charger changing state must not look like an
     * edit to the installation, nor invalidate its structure.
     */
    statusVersion: bigint("status_version", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    index().on(t.orgId, t.siteId),
    index().on(t.vendorId),
    uniqueIndex().on(t.installationKey),
  ],
);

/**
 * Prisma model `ChargingStation` — assets.charging_stations
 *
 * ── MARKED FOR RETIREMENT (ADR 0054). NOT DELETED, NOT ALTERED. ───────────
 *
 * Superseded by `assets.devices` (the hardware, immortal) plus
 * `assets.placements` (where it is, dated). This row conflates the two: it
 * carries `org_id`, `installation_id`, `circuit_id` and the `site_assets`
 * link ON THE HARDWARE, so a device that moves tenant has to become a
 * different device, and `serial_number @unique` makes a warranty replacement
 * at the same site a constraint violation.
 *
 * Migration 0005 adds the successors and touches nothing here. The retirement
 * is a SEPARATE, separately-approved migration that runs only after a
 * backfill has been written, reviewed and reconciled — adding a successor and
 * dropping a predecessor in one migration cannot be rolled back without
 * losing every row written in between.
 *
 * Until then this table is live and every existing reader is correct to use
 * it. Do not add columns here; add them to `devices` or `placements`.
 */
export const chargingStations = assetsSchema.table(
  "charging_stations",
  {
    siteAssetId: uuid("site_asset_id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    modelId: uuid("model_id"),
    installationId: uuid("installation_id"),
    vendor: text("vendor"),
    model: text("model"),
    serialNumber: text("serial_number"),
    installDate: date("install_date", { mode: "date" }),
    warrantyExpires: date("warranty_expires", { mode: "date" }),
    firmwareVersion: text("firmware_version"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    circuitId: uuid("circuit_id"),
    ownerOrgId: uuid("owner_org_id"),
    chrgrfTariffId: uuid("chrgrf_tariff_id"),
    chargeBoxSerialNumber: text("charge_box_serial_number"),
    meterType: text("meter_type"),
    meterSerialNumber: text("meter_serial_number"),
    iccid: text("iccid"),
    imsi: text("imsi"),
    locationNote: text("location_note"),
    mountingType: text("mounting_type"),
    photoUrl: text("photo_url"),
    ipRating: text("ip_rating"),
    breakerAmps: integer("breaker_amps"),
    bleAdvertisingId: text("ble_advertising_id"),
    bleAdvertisingKind: text("ble_advertising_kind"),
    lifetimeKwhCached: numeric("lifetime_kwh_cached", { precision: 12, scale: 3 }),
    lifetimeKwhObservedAt: timestamp("lifetime_kwh_observed_at", { withTimezone: true, precision: 6, mode: "date" }),
    lastTelemetryRead: jsonb("last_telemetry_read"),
    lastTelemetryAt: timestamp("last_telemetry_at", { withTimezone: true, precision: 6, mode: "date" }),
    vendorAuthRequired: boolean("vendor_auth_required"),
    vendorAuthenticationType: integer("vendor_authentication_type"),
    vendorAuthSeenAt: timestamp("vendor_auth_seen_at", { withTimezone: true, precision: 6, mode: "date" }),
    mainboardSwVersion: text("mainboard_sw_version"),
    smartBootloaderVersion: text("smart_bootloader_version"),
    hardwareVersion: text("hardware_version"),
    onlineSinceAt: timestamp("online_since_at", { withTimezone: true, precision: 6, mode: "date" }),
    commMode: text("comm_mode"),
    signalDbm: integer("signal_dbm"),
    pushedAuthListVersion: integer("pushed_auth_list_version").notNull().default(0),
  },
  (t) => [
    // @unique in Prisma — lost in the Drizzle port, restored 2026-10-26.
    uniqueIndex().on(t.serialNumber),
    index().on(t.modelId),
    index().on(t.installationId),
    index().on(t.circuitId),
    index().on(t.ownerOrgId),
  ],
);

/** Prisma model `EVSE` — assets.evses */
export const evses = assetsSchema.table(
  "evses",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    chargingStationId: uuid("charging_station_id").notNull(),
    /**
     * ADR 0054 item 4 — the EVSE's parent becomes the DEVICE.
     *
     * Nullable during the transition, and it stays nullable until
     * `charging_stations` is retired. Both parents coexist deliberately:
     * making this `NOT NULL` in migration 0007 would require a backfill in the
     * same migration that adds the column, and there is no reconciled mapping
     * yet — see the retirement plan.
     *
     * The hierarchy is device -> EVSE -> connector, which is OCPP's, not the
     * 1:1:1 coincidence the Zaptec importer bakes in today. A Zaptec Pro
     * genuinely has one EVSE and one connector; a DC unit does not, and the
     * columns must be able to say so before an importer can.
     */
    deviceId: uuid("device_id"),
    evseIndex: integer("evse_index").notNull(),
    maxPowerKw: numeric("max_power_kw", { precision: 8, scale: 2 }),
    phaseCount: integer("phase_count"),
    status: text("status").notNull().default("unknown"),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.chargingStationId, t.evseIndex),
    index().on(t.orgId, t.status),
  ],
);

/** Prisma model `Connector` — assets.connectors */
export const connectors = assetsSchema.table(
  "connectors",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    evseId: uuid("evse_id").notNull(),
    connectorIndex: integer("connector_index").notNull(),
    type: text("type").notNull(),
    maxPowerKw: numeric("max_power_kw", { precision: 8, scale: 2 }),
    status: text("status").notNull().default("unknown"),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true, precision: 6, mode: "date" }),
    errorCode: text("error_code"),
    vendorErrorCode: text("vendor_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.evseId, t.connectorIndex),
    index().on(t.orgId),
  ],
);

/** Prisma model `CapabilityProfile` — assets.capability_profiles */
export const capabilityProfiles = assetsSchema.table(
  "capability_profiles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    chargingStationId: uuid("charging_station_id").notNull(),
    controlPlane: text("control_plane").notNull(),
    capabilities: jsonb("capabilities").notNull(),
    source: text("source").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.chargingStationId, t.controlPlane),
  ],
);

/** Prisma model `ControlRoutingPolicy` — assets.control_routing_policies */
export const controlRoutingPolicies = assetsSchema.table(
  "control_routing_policies",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    chargingStationId: uuid("charging_station_id").notNull(),
    routing: jsonb("routing").notNull(),
    fallback: text("fallback_plane"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    // @unique in Prisma — lost in the Drizzle port, restored 2026-10-26.
    uniqueIndex().on(t.chargingStationId),
  ],
);

/** Prisma model `Meter` — assets.meters */

/** Prisma model `Modem` — assets.modems */
export const modems = assetsSchema.table(
  "modems",
  {
    siteAssetId: uuid("site_asset_id").primaryKey(),
    imei: text("imei"),
    carrier: text("carrier"),
    iccid: text("iccid"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    // @unique in Prisma — lost in the Drizzle port, restored 2026-10-26.
    uniqueIndex().on(t.imei),
  ],
);

/** Prisma model `Controller` — assets.controllers */

/** Prisma model `SiteEnergyPolicy` — energy.site_energy_policies */

/** Prisma model `PropertyEnergyPolicy` — energy.property_energy_policies */

/** Prisma model `EnergyPlanningResult` — energy.energy_planning_results */

/** Prisma model `Circuit` — properties.circuits */
export const circuits = propertiesSchema.table(
  "circuits",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    siteId: uuid("site_id").notNull(),
    installationId: uuid("installation_id"),
    displayName: text("display_name").notNull(),
    ampereCeiling: integer("ampere_ceiling"),
    /** NULL = unknown. No default: an unknown phase count is never assumed three. */
    phaseCount: integer("phase_count"),
    vendorCircuitRef: text("vendor_circuit_ref"),
    /** Electrical parent within the same installation; NULL = directly under the main device. */
    parentCircuitId: uuid("parent_circuit_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true, precision: 6, mode: "date" }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.siteId),
    index().on(t.installationId),
    index().on(t.parentCircuitId),
  ],
);

/** Prisma model `SiteEnergyDaily` — reports.site_energy_daily */

/** Prisma model `ChargerUptimeDaily` — reports.charger_uptime_daily */

// ═════════════════════════════════════════════════════════════════════════
// ADR 0054 — a device is immortal, a placement is dated
//
// Migration 0005. CREATE-only: nothing below replaces `charging_stations` or
// `ocpp_identities`. Both are MARKED FOR RETIREMENT and removed in a later,
// separately-approved step — see the retirement plan in the completion
// artifact. A model that adds the successor and drops the predecessor in one
// migration cannot be rolled back without losing the rows written in between.
// ═════════════════════════════════════════════════════════════════════════

/**
 * A half-open UTC interval, `[from, until)`.
 *
 * ── THE DRIZZLE / RAW-SQL DIVERGENCE, DECLARED RATHER THAN SILENT ───────
 *
 * Drizzle has no range type and cannot express `WITHOUT OVERLAPS` or
 * `EXCLUDE USING GIST` at all. So the split is:
 *
 *   this file       declares the COLUMN, so the type is real to every reader
 *                   and every query, and the generated migration creates it;
 *   migration 0005  carries the CONSTRAINT, hand-appended below the generated
 *                   section under a banner saying so.
 *
 * The consequence is stated plainly rather than discovered later: the
 * drizzle-kit snapshot does not know the constraint exists. A future
 * `drizzle-kit generate` will not drop it — snapshots only diff what they can
 * see — but it will also never recreate it, so the hand-written block is the
 * only definition and must travel with the table. FOCUS rule 7 still holds:
 * Drizzle owns the schema, the migration is generated, nothing is pushed.
 *
 * Open-ended is the unbounded range `[from,)`, never a NULL column. ADR 0054
 * asked why not the simpler constraint: a nullable `until` forces
 * COALESCE(until, 'infinity') into every billing predicate, indexes poorly,
 * and makes "still there" and "we do not know" the same value.
 */
const tstzrange = customType<{ data: string }>({ dataType: () => "tstzrange" });

/**
 * assets.devices — the physical unit, and it is immortal.
 *
 * ADR 0054 decision 1. One row per physical charger, never deleted. It carries
 * everything true of the HARDWARE irrespective of where it sits — lifetime
 * energy, lifetime session count, firmware, warranty — and those follow the
 * asset, never the site, and are never erased on transfer.
 *
 * Keyed by a surrogate id, not by the serial. The serial is a strong natural
 * key and an unreliable one: OCPP 2.0.1 makes serialNumber optional,
 * vendor-specific and capped at 25 characters, and OCPP 1.6 offers two
 * competing serial fields plus a third for the meter. So (vendor, serial) is
 * unique and NULLABLE — a device with no serial is a device we have, not a
 * device we refuse. Postgres treats NULLs as distinct in a unique index, so
 * unserialised devices do not collide with each other.
 *
 * The placement-shaped columns `charging_stations` carried — org_id,
 * installation_id, circuit_id, the site_assets link — are deliberately ABSENT.
 * They are facts about where a device is, and a device outlives every one of
 * them.
 */
export const devices = assetsSchema.table(
  "devices",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    vendor: text("vendor"),
    model: text("model"),
    /** Nullable by protocol reality, not by laxity. See the note above. */
    serialNumber: text("serial_number"),
    chargeBoxSerialNumber: text("charge_box_serial_number"),
    meterType: text("meter_type"),
    meterSerialNumber: text("meter_serial_number"),
    firmwareVersion: text("firmware_version"),
    /** From BootNotification, not invented at import time. */
    firmwareObservedAt: timestamp("firmware_observed_at", { withTimezone: true, precision: 6, mode: "date" }),
    hardwareVersion: text("hardware_version"),
    iccid: text("iccid"),
    imsi: text("imsi"),
    /** Lifetime counters. They follow the asset, never the site. Absent is
     *  unavailable, never zero — ledger note 22 — which is why every one of
     *  these is nullable and paired with its own observed-at. */
    lifetimeKwh: numeric("lifetime_kwh", { precision: 14, scale: 3 }),
    lifetimeKwhObservedAt: timestamp("lifetime_kwh_observed_at", { withTimezone: true, precision: 6, mode: "date" }),
    lifetimeSessionCount: integer("lifetime_session_count"),
    lifetimeSessionCountObservedAt: timestamp("lifetime_session_count_observed_at", { withTimezone: true, precision: 6, mode: "date" }),
    /** Warranty follows the hardware, and is a real date rather than
     *  install-plus-five-years invented by an importer. */
    warrantyExpires: date("warranty_expires", { mode: "date" }),
    manufacturedAt: date("manufactured_at", { mode: "date" }),
    retiredAt: timestamp("retired_at", { withTimezone: true, precision: 6, mode: "date" }),
    retiredReason: text("retired_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.vendor, t.serialNumber),
    index().on(t.serialNumber),
  ],
);

/**
 * assets.device_identities — the OCPP identity, dated.
 *
 * ADR 0054 decision 2. device x identity_string x [from, until).
 *
 * The identity on the wire is a CREDENTIAL, not a hardware fact: it doubles as
 * the HTTP Basic auth username, and in OCPP 2.0.1 it is a settable
 * SecurityCtrlr Identity variable. Operators keep it when swapping a faulty
 * unit at one site, and must change it when a device moves tenant. Neither
 * operation may be a data-model violation — which is exactly what a globally
 * unique identity column on the device row made them.
 *
 * Two temporal constraints, both in 0005's hand-written block:
 *   (device_id, period)        one identity per device at a time
 *   (identity_string, period)  one device per identity at a time, which is
 *                              the half that matters on the wire, since the
 *                              gateway resolves an inbound connection by it
 */
export const deviceIdentities = assetsSchema.table(
  "device_identities",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    deviceId: uuid("device_id").notNull(),
    identityString: text("identity_string").notNull(),
    /** `[from, until)`. Open-ended is `[from,)`, never NULL. */
    period: tstzrange("period").notNull(),
    /** Who set it and why, so a change is answerable afterwards. */
    assignedByUserId: uuid("assigned_by_user_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.deviceId),
    index().on(t.identityString),
  ],
);

/**
 * assets.placements — where a device is, and when it was there.
 *
 * ADR 0054 decision 3. device x installation x [from, until), carrying what
 * the device row used to: org, installation, circuit, site.
 *
 * public_id is the stable public identifier and it exists FROM DAY ONE. That
 * is the OCPI EVSE.uid, which the specification says can never be changed,
 * modified or renamed — and OCPI explicitly warns against using a physical
 * hardware identifier for it, because redeploying the same unit at another
 * Location then breaks uniqueness. OCPI's EVSE is our placement, not our
 * device. Free now; impossible to retrofit once anything external holds a
 * reference to it.
 *
 * Closing a placement is a STATE, not a delete: OCPI requires status REMOVED
 * rather than removal. The period's upper bound is what closes; the row stays,
 * and the billing predicate reads the interval.
 */
export const placements = assetsSchema.table(
  "placements",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** The OCPI EVSE.uid. Issued once, never changed. */
    publicId: uuid("public_id").notNull().$defaultFn(() => crypto.randomUUID()),
    deviceId: uuid("device_id").notNull(),
    /** Tenancy on the row — FOCUS rule 5. The device row has no org, because
     *  a device that moves tenant would otherwise have to be two devices. */
    orgId: uuid("org_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    siteId: uuid("site_id"),
    circuitId: uuid("circuit_id"),
    /** Operator-facing name of the charger at this place (S1 installation management). */
    label: text("label"),
    /** `[from, until)`. Open-ended is `[from,)`, never NULL. */
    period: tstzrange("period").notNull(),
    attachedByUserId: uuid("attached_by_user_id"),
    detachedByUserId: uuid("detached_by_user_id"),
    detachReason: text("detach_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.publicId),
    index().on(t.deviceId),
    index().on(t.orgId),
    index().on(t.installationId),
  ],
);

/**
 * assets.vendor_config_observations — ADR 0054 item 12.
 *
 * APPEND-ONLY. One row per CHANGE, not one per poll: an importer running every
 * five minutes would otherwise write a row per poll and produce a history in
 * which nothing ever happened. The dedup is `sameReading` in
 * apps/api/src/lib/vendor-config/sink-port.ts and it deliberately ignores
 * `observed_at`.
 *
 * Every column but the timestamps is NULLABLE, and that is the point rather
 * than laxity: a field the vendor did not return is `null`, which reads as
 * `unavailable` — never `false`. `charger_active = false` is a claim that
 * Zaptec told us the charger is deactivated, and defaulting a missing
 * observation to it would silently remove a live charger from a billing count.
 *
 * There is no update path and no delete path. A correction is a later
 * observation, so the log stays answerable about what we believed and when.
 */
export const vendorConfigObservations = assetsSchema.table(
  "vendor_config_observations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    deviceId: uuid("device_id").notNull(),
    /** When the VENDOR reported it, not when we wrote the row. */
    observedAt: timestamp("observed_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    /** Zaptec `Charger.Active`. Half (b) of the Dalvegur billing predicate. */
    chargerActive: boolean("charger_active"),
    /** Zaptec `AuthenticationType` — the INTEGRATION PATH (0=Native,
     *  1=WebHooks, 2=Ocpp, 3=OcppNative), an installation property that reads
     *  2 fleet-wide. It is NOT driver auth and never can be; two wrong
     *  readings of it have already been committed here and corrected. */
    authenticationType: integer("authentication_type"),
    /** Zaptec `IsAuthorizationRequired`, StateId 120. THIS is driver auth. */
    isAuthorizationRequired: boolean("is_authorization_required"),
    /** `PropertyOcppDefaultIdTag`. A TOKEN, never a person — sessions bearing
     *  it have no driver, and a driver count that includes them is wrong. */
    ocppDefaultIdTag: text("ocpp_default_id_tag"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.deviceId, t.observedAt),
  ],
);

/**
 * properties.installation_changes — attributable change history (S1, migration 0002).
 *
 * APPEND-ONLY: no update path, no delete path. One row per changed entity per
 * saved revision. `diff` holds { field: { from, to } } and never carries a
 * password, verifier, token or cookie.
 *
 * The actor is the shared Straumvakt login, stated as such: actor_kind
 * 'shared_login' with its label. It is not a user id and is never an
 * electrician; no personal identity is inferred.
 *
 * `idempotency_key` is unique, so a replayed or double-submitted save is
 * recognised instead of applied twice.
 */
export const installationChanges = propertiesSchema.table(
  "installation_changes",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    /** The installation revision this change produced. */
    revision: integer("revision").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    diff: jsonb("diff").notNull().default({}),
    actorKind: text("actor_kind").notNull(),
    actorLabel: text("actor_label").notNull(),
    /** When it physically happened, if the operator said so. Otherwise NULL. */
    effectiveAt: timestamp("effective_at", { withTimezone: true, precision: 6, mode: "date" }),
    idempotencyKey: uuid("idempotency_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.installationId, t.occurredAt),
    // The structure delta reads "changes after revision R" for one installation.
    index().on(t.installationId, t.revision),
    uniqueIndex().on(t.idempotencyKey),
  ],
);

/**
 * assets.device_operational_state — latest reported state per device (S1 deltas, migration 0004).
 *
 * One row per PERMANENT device (it follows the device across placements; the
 * placement/installation columns are the CURRENT ones and are rewritten on a
 * move). Holds only what changes often and nothing a tree needs: per-connector
 * status/error as reported, with the charger's clock and ours kept apart.
 *
 * `seq` is the installation `status_version` at the moment this row last
 * changed. Because that counter is bumped under the installation row lock, seq
 * order equals commit order: a reader that has seen seq N has seen every
 * smaller one, which is what makes "changes since N" gap-free without a log.
 * A write that changes nothing does not bump it: an idle fleet writes nothing.
 */
export const deviceOperationalState = assetsSchema.table(
  "device_operational_state",
  {
    deviceId: uuid("device_id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    placementId: uuid("placement_id").notNull(),
    /** { "<connectorNo>": { status, errorCode, reportedAt } } as last reported. */
    connectors: jsonb("connectors").notNull().default({}),
    lastReportedAt: timestamp("last_reported_at", { withTimezone: true, precision: 6, mode: "date" }),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
  },
  (t) => [index().on(t.installationId, t.seq)],
);

/**
 * assets.lifecycle_requests — guarded charger removal/retirement (S1 lifecycle, migration 0006).
 *
 * One row per operation, advanced step by step; it is the durable record that a
 * removal is PENDING and what remains. The existence of an OPEN row for a device
 * is what blocks new starts (the engine reads it), so the block is atomic with the
 * request. At most one open request per device (partial unique index), which is how
 * "repeating an action resumes the same operation" is enforced by the database.
 *
 * `sessions` is the per-session progress (stop attempts and outcomes, the durable
 * stop confirmation, and settlement state). A command being accepted is recorded
 * but never counts as the session being stopped. The actor is the shared login,
 * stated as such.
 */
export const lifecycleRequests = assetsSchema.table(
  "lifecycle_requests",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** Client-supplied idempotency key: a repeated request returns this row. */
    requestKey: text("request_key").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    orgId: uuid("org_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    placementId: uuid("placement_id").notNull(),
    reason: text("reason").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorLabel: text("actor_label").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    serviceEndedAt: timestamp("service_ended_at", { withTimezone: true, precision: 6, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, precision: 6, mode: "date" }),
    sessions: jsonb("sessions").notNull().default([]),
    attention: text("attention"),
    identityClosed: boolean("identity_closed").notNull().default(false),
    /** Optimistic version: two workers advancing the same request cannot both win. */
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex().on(t.requestKey),
    // At most ONE open request per device. Partial: finished requests do not count.
    uniqueIndex("lifecycle_requests_one_open_per_device").on(t.deviceId).where(sql`${t.state} NOT IN ('completed','cancelled')`),
    index().on(t.installationId, t.state),
  ],
);
