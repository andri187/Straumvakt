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

import { boolean, date, index, integer, jsonb, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const assetsSchema = pgSchema("assets");
export const energySchema = pgSchema("energy");
export const propertiesSchema = pgSchema("properties");

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
  },
  (t) => [
    index().on(t.orgId, t.siteId),
    index().on(t.vendorId),
  ],
);

/** Prisma model `ChargingStation` — assets.charging_stations */
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
);

/** Prisma model `Meter` — assets.meters */
export const meters = assetsSchema.table(
  "meters",
  {
    siteAssetId: uuid("site_asset_id").primaryKey(),
    meterSerial: text("meter_serial"),
    meterType: text("meter_type"),
    maxAmps: integer("max_amps"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
);

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
);

/** Prisma model `Controller` — assets.controllers */
export const controllers = assetsSchema.table(
  "controllers",
  {
    siteAssetId: uuid("site_asset_id").primaryKey(),
    vendor: text("vendor"),
    deviceId: text("device_id"),
    endpointUrl: text("endpoint_url"),
    capabilities: jsonb("capabilities").notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
);

/** Prisma model `SiteEnergyPolicy` — energy.site_energy_policies */
export const siteEnergyPolicies = energySchema.table(
  "site_energy_policies",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    siteId: uuid("site_id").notNull(),
    policy: jsonb("policy").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.orgId, t.siteId),
  ],
);

/** Prisma model `PropertyEnergyPolicy` — energy.property_energy_policies */
export const propertyEnergyPolicies = energySchema.table(
  "property_energy_policies",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    propertyId: uuid("property_id").notNull(),
    policy: jsonb("policy").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.orgId, t.propertyId),
  ],
);

/** Prisma model `EnergyPlanningResult` — energy.energy_planning_results */
export const energyPlanningResults = energySchema.table(
  "energy_planning_results",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    siteId: uuid("site_id").notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    result: jsonb("result").notNull(),
  },
  (t) => [
    index().on(t.orgId, t.siteId, t.calculatedAt),
  ],
);

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
    phaseCount: integer("phase_count").notNull().default(3),
    vendorCircuitRef: text("vendor_circuit_ref"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.siteId),
    index().on(t.installationId),
  ],
);

