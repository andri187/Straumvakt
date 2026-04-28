import { z } from "zod";

const optionalString = (max: number) =>
  z.string().max(max).optional().transform((v) => (v && v.length > 0 ? v : undefined));

export const CircuitCreateInput = z.object({
  orgId: z.string().uuid(),
  siteId: z.string().uuid(),
  installationId: z.string().uuid().optional(),
  displayName: z.string().min(1).max(120),
  ampereCeiling: z.number().int().min(1).max(2000).optional(),
  phaseCount: z.number().int().min(1).max(3).default(3),
  vendorCircuitRef: optionalString(120),
});
export type CircuitCreateInput = z.infer<typeof CircuitCreateInput>;

export const CircuitUpdateInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  installationId: z.string().uuid().optional().nullable(),
  ampereCeiling: z.number().int().min(1).max(2000).optional().nullable(),
  phaseCount: z.number().int().min(1).max(3).optional(),
  vendorCircuitRef: optionalString(120),
  metadata: z.unknown().optional(),
});
export type CircuitUpdateInput = z.infer<typeof CircuitUpdateInput>;
