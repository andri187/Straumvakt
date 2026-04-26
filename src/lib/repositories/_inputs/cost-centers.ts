import { z } from "zod";

const optionalUuid = z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined));

export const CostCenterCreateInput = z.object({
  orgId: z.string().uuid(),
  code: z.string().min(1).max(40).regex(/^[A-Z0-9_-]+$/, { message: "uppercase, digits, underscore, dash" }),
  displayName: z.string().min(1).max(120),
  payerOrgId: optionalUuid,
  payerUserId: optionalUuid,
  beneficiaryOrgId: optionalUuid,
}).refine((d) => !(d.payerOrgId && d.payerUserId), {
  message: "exactly zero or one of payerOrgId / payerUserId may be set",
  path: ["payerUserId"],
});
export type CostCenterCreateInput = z.infer<typeof CostCenterCreateInput>;
