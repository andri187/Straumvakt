import { z } from "zod";

const COUNTRY_RE = /^[A-Z]{2}$/;
const KENNITALA_RE = /^\d{6}-?\d{4}$/;
const IDENTITY_RE = /^[A-Za-z0-9._:-]+$/;

// Re-exports the OCPI-aligned trimmed enum from inputs/orgs.ts so the
// onboarding wizard validates against the same set as direct create.
export { OrganizationRoleEnum } from "./orgs";
import { OrganizationRoleEnum } from "./orgs";

const SiteTypeEnum = z.enum(["standard", "workplace", "mdu", "hotel", "fleet", "retail"]);
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
  orgDisplayName: z.string().min(1).max(120),
  orgKennitala: z
    .string()
    .regex(KENNITALA_RE, { message: "format: DDMMYY-XXXX" })
    .transform((v) => v.replace(/-/g, "")),
  orgLegalName: z.string().min(1).max(200),
  orgRoles: z.array(OrganizationRoleEnum).min(1),
  orgCountryCode: z.string().regex(COUNTRY_RE).default("IS"),
  orgDefaultCurrency: z.string().min(3).max(3).default("ISK"),
  orgLegalForm: optionalString(40),
  orgVskNr: optionalString(40),
  orgLeiCode: optionalString(40),
  orgRegulatorLicenceNo: optionalString(80),
  orgNotes: optionalString(2000),
  orgAddressStreet: optionalString(200),
  orgAddressCity: optionalString(80),
  orgAddressPostalCode: optionalString(20),

  propertyDisplayName: z.string().min(1).max(120),
  propertyStreet: optionalString(200),
  propertyCity: optionalString(80),
  propertyPostalCode: optionalString(20),
  propertyLatitude: z.number().min(-90).max(90).optional(),
  propertyLongitude: z.number().min(-180).max(180).optional(),

  siteDisplayName: z.string().min(1).max(120),
  siteType: SiteTypeEnum.default("standard"),
  siteTimezone: z.string().default("Atlantic/Reykjavik"),
  siteAccessLevel: SiteAccessLevelEnum.default("private"),
  sitePowerClass: SitePowerClassEnum.optional(),

  stationVendor: z.string().min(1).max(60),
  stationModel: z.string().min(1).max(80),
  stationSerialNumber: z.string().min(1).max(80),
  stationFirmwareVersion: optionalString(60),
  stationInstallDate: optionalString(20),

  evseIndex: z.number().int().min(1).max(99).default(1),
  evseMaxPowerKw: z.number().positive().max(1000).optional(),
  evsePhaseCount: z.number().int().min(1).max(3).optional(),

  connectorType: ConnectorTypeEnum.default("Type2"),
  connectorIndex: z.number().int().min(1).max(99).default(1),
  connectorMaxPowerKw: z.number().positive().max(1000).optional(),

  identityString: z
    .string()
    .min(3)
    .max(64)
    .regex(IDENTITY_RE, { message: "alphanumerics, '.', '_', ':', '-' only" }),
  ocppVersion: OcppVersionEnum.default("ocpp_1_6"),
  assetClass: AssetClassEnum.default("ac"),
});
export type OnboardingChainInput = z.infer<typeof OnboardingChainInput>;
