import { z } from "zod";

const ConnectorTypeEnum = z.enum(["Type2", "CCS2", "CHAdeMO", "Schuko"]);
const OcppVersionEnum = z.enum(["ocpp_1_6", "ocpp_2_0_1", "ocpp_2_1"]);
const AssetClassEnum = z.enum(["ac", "dc"]);

const optionalString = (max: number) =>
  z.string().max(max).optional().transform((v) => (v && v.length > 0 ? v : undefined));

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
