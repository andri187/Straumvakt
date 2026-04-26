import { z } from "zod";

const ScopeType = z.enum(["org", "property", "site", "installation", "charger"]);
const Status = z.enum(["pending_configuration", "active", "superseded", "archived"]);

export const ContractCreateInput = z.object({
  orgId: z.string().uuid(),
  scopeType: ScopeType,
  scopeId: z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  parentContractId: z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  displayName: z.string().min(1).max(120),
  status: Status.default("pending_configuration"),
  validFrom: z.string().min(10),
  validUntil: z.string().optional(),
});
export type ContractCreateInput = z.infer<typeof ContractCreateInput>;
