import { z } from "zod";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
// DDMMYY-XXXX or DDMMYYXXXX (Iceland kennitala)
const KENNITALA_RE = /^\d{6}-?\d{4}$/;
const IDENTITY_RE = /^[A-Za-z0-9._:-]+$/;

export const OrganizationRoleEnum = z.enum([
  "csms_provider",
  "operator",
  "service_contractor",
  "installer",
  "vendor",
  "asset_owner",
  "payer",
  "beneficiary",
  "customer",
  "retailer",
  "dso",
  "tso",
  "producer",
  "aggregator",
  "public_charging",
  "home_charging",
  "emsp",
  "roaming_hub",
  "payment_processor",
  "insurance_provider",
  "regulator",
]);

const SiteTypeEnum = z.enum([
  "standard",
  "workplace",
  "mdu",
  "hotel",
  "fleet",
  "retail",
]);
const SiteAccessLevelEnum = z.enum(["public", "private", "taxi_only"]);
const SitePowerClassEnum = z.enum([
  "lt_50kw",
  "between_50_150kw",
  "between_150_500kw",
  "gt_500kw",
]);
const ConnectorTypeEnum = z.enum(["Type2", "CCS2", "CHAdeMO", "Schuko"]);
const OcppVersionEnum = z.enum(["ocpp_1_6", "ocpp_2_0_1", "ocpp_2_1"]);
const AssetClassEnum = z.enum(["ac", "dc"]);

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const OnboardingChainInput = z.object({
  // ── Organization (required) ─────────────────────────────────────
  orgSlug: z.string().regex(SLUG_RE, {
    message: "lowercase letters, digits, dashes only; 3–48 chars",
  }),
  orgDisplayName: z.string().min(1).max(120),
  orgKennitala: z
    .string()
    .regex(KENNITALA_RE, { message: "format: DDMMYY-XXXX" })
    .transform((v) => v.replace(/-/g, "")),
  orgLegalName: z.string().min(1).max(200),
  orgRoles: z.array(OrganizationRoleEnum).min(1),
  orgCountryCode: z.string().regex(COUNTRY_RE).default("IS"),
  orgDefaultCurrency: z.string().min(3).max(3).default("ISK"),

  // ── Organization (optional) ─────────────────────────────────────
  orgLegalForm: optionalString(40),
  orgVskNr: optionalString(40),
  orgLeiCode: optionalString(40),
  orgRegulatorLicenceNo: optionalString(80),
  orgNotes: optionalString(2000),
  orgAddressStreet: optionalString(200),
  orgAddressCity: optionalString(80),
  orgAddressPostalCode: optionalString(20),
  orgContactName: optionalString(120),
  orgContactEmail: z
    .string()
    .email()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  orgContactPhone: optionalString(40),

  // ── Property (required) ─────────────────────────────────────────
  propertyDisplayName: z.string().min(1).max(120),

  // ── Property (optional) ─────────────────────────────────────────
  propertyStreet: optionalString(200),
  propertyCity: optionalString(80),
  propertyPostalCode: optionalString(20),
  propertyLatitude: z.number().min(-90).max(90).optional(),
  propertyLongitude: z.number().min(-180).max(180).optional(),

  // ── Site (required) ─────────────────────────────────────────────
  siteDisplayName: z.string().min(1).max(120),
  siteType: SiteTypeEnum.default("standard"),

  // ── Site (optional) ─────────────────────────────────────────────
  siteTimezone: z.string().default("Atlantic/Reykjavik"),
  siteAccessLevel: SiteAccessLevelEnum.default("private"),
  sitePowerClass: SitePowerClassEnum.optional(),

  // ── ChargingStation (required) ──────────────────────────────────
  stationVendor: z.string().min(1).max(60),
  stationModel: z.string().min(1).max(80),
  stationSerialNumber: z.string().min(1).max(80),

  // ── ChargingStation (optional) ──────────────────────────────────
  stationFirmwareVersion: optionalString(60),
  stationInstallDate: optionalString(20), // YYYY-MM-DD

  // ── EVSE ────────────────────────────────────────────────────────
  evseIndex: z.number().int().min(1).max(99).default(1),
  evseMaxPowerKw: z.number().positive().max(1000).optional(),
  evsePhaseCount: z.number().int().min(1).max(3).optional(),

  // ── Connector (required) ────────────────────────────────────────
  connectorType: ConnectorTypeEnum.default("Type2"),

  // ── Connector (optional) ────────────────────────────────────────
  connectorIndex: z.number().int().min(1).max(99).default(1),
  connectorMaxPowerKw: z.number().positive().max(1000).optional(),

  // ── OCPP Identity (required) ────────────────────────────────────
  identityString: z.string().min(3).max(64).regex(IDENTITY_RE, {
    message: "alphanumerics, '.', '_', ':', '-' only",
  }),
  ocppVersion: OcppVersionEnum.default("ocpp_1_6"),
  assetClass: AssetClassEnum.default("ac"),
});
export type OnboardingChainInput = z.infer<typeof OnboardingChainInput>;
