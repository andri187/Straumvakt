import { z } from "zod";

const OwnerType = z.enum(["workplace", "family_group", "self"]);
const Status = z.enum(["pending_configuration", "active", "superseded", "archived"]);

export const DriverContractCreateInput = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  ownerType: OwnerType,
  ownerId: z.string().uuid(),
  wrkpfTariffId: z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  displayName: z.string().min(1).max(120),
  status: Status.default("pending_configuration"),
  validFrom: z.string().min(10),
  validUntil: z.string().optional(),
});
export type DriverContractCreateInput = z.infer<typeof DriverContractCreateInput>;
