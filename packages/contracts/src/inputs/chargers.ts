import { z } from "zod";

const ConnectorTypeEnum = z.enum(["Type2", "CCS2", "CHAdeMO", "Schuko"]);
const OcppVersionEnum = z.enum(["ocpp_1_6", "ocpp_2_0_1", "ocpp_2_1"]);
const AssetClassEnum = z.enum(["ac", "dc"]);

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const ChargerCreateInput = z.object({
  orgId: z.string().uuid(),
  siteId: z.string().uuid(),
  installationId: z.string().uuid().optional(),
  circuitId: z.string().uuid().optional(),
  // Station
  stationVendor: z.string().min(1).max(60),
  stationModel: z.string().min(1).max(80),
  stationSerialNumber: z.string().min(1).max(80),
  stationFirmwareVersion: optionalString(60),
  // EVSE
  evseIndex: z.number().int().min(1).max(99).default(1),
  evseMaxPowerKw: z.number().positive().max(1000).optional(),
  evsePhaseCount: z.number().int().min(1).max(3).optional(),
  // Connector
  connectorIndex: z.number().int().min(1).max(99).default(1),
  connectorType: ConnectorTypeEnum.default("Type2"),
  connectorMaxPowerKw: z.number().positive().max(1000).optional(),
  // OcppIdentity
  identityString: z.string().min(3).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  ocppVersion: OcppVersionEnum.default("ocpp_1_6"),
  assetClass: AssetClassEnum.default("ac"),
});
export type ChargerCreateInput = z.infer<typeof ChargerCreateInput>;

export const ChargerUpdateInput = z.object({
  stationVendor: z.string().min(1).max(60).optional(),
  stationModel: z.string().min(1).max(80).optional(),
  stationSerialNumber: z.string().min(1).max(80).optional(),
  stationFirmwareVersion: optionalString(60),
  installationId: z.string().uuid().optional().nullable(),
  circuitId: z.string().uuid().optional().nullable(),
  evseId: z.string().uuid().optional(),
  evseMaxPowerKw: z.number().positive().max(1000).optional().nullable(),
  evsePhaseCount: z.number().int().min(1).max(3).optional().nullable(),
  connectorId: z.string().uuid().optional(),
  connectorType: ConnectorTypeEnum.optional(),
  connectorMaxPowerKw: z.number().positive().max(1000).optional().nullable(),
  // Operator-domain physical info (Sprint 3 enrichment). Each accepts
  // empty string → coerce to null (operator clearing a field).
  locationNote: z.string().max(2000).optional().nullable(),
  mountingType: z.enum(["wall", "pedestal", "floor", "other"]).optional().nullable(),
  photoUrl: z.string().max(500).optional().nullable(),
  ipRating: z.string().max(20).optional().nullable(),
  breakerAmps: z.number().int().min(1).max(2000).optional().nullable(),
});
export type ChargerUpdateInput = z.infer<typeof ChargerUpdateInput>;

// OCPP command bodies — schemas live next to charger inputs because the
// commands are addressed by ocppIdentityId, which is a charger primary key.

export const RemoteStartBody = z.object({
  connectorId: z.string().uuid(),
  // OCPP idTag is CiString20Type — no whitespace expected. Trim
  // before validating max-length so a copy-paste with trailing space
  // doesn't push past the 20-char ceiling, and coerce
  // empty-after-trim to undefined so the dispatch omits the field
  // (charger uses its locally-configured Default ID tag).
  idTag: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() || undefined : v),
    z.string().max(20).optional(),
  ),
});
export type RemoteStartBody = z.infer<typeof RemoteStartBody>;

export const RemoteStopBody = z.object({
  transactionId: z.number().int(),
});
export type RemoteStopBody = z.infer<typeof RemoteStopBody>;

export const GetConfigurationBody = z.object({
  key: z.array(z.string().min(1).max(50)).max(50).optional(),
});
export type GetConfigurationBody = z.infer<typeof GetConfigurationBody>;

export const ChangeConfigurationBody = z.object({
  key: z.string().min(1).max(50),
  value: z.string().max(500),
});
export type ChangeConfigurationBody = z.infer<typeof ChangeConfigurationBody>;
