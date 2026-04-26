import { z } from "zod";

export const MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "operator",
  "helper",
  "contractor",
  "driver",
  "viewer",
] as const;
export type MembershipRoleValue = (typeof MEMBERSHIP_ROLES)[number];

export const MembershipCreateInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(MEMBERSHIP_ROLES),
});
export type MembershipCreateInput = z.infer<typeof MembershipCreateInput>;

export const MembershipUpdateInput = z.object({
  role: z.enum(MEMBERSHIP_ROLES),
});
export type MembershipUpdateInput = z.infer<typeof MembershipUpdateInput>;
