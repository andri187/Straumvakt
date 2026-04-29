import { z } from "zod";

const KENNITALA_RE = /^\d{6}-?\d{4}$/;

const optionalString = (max: number) =>
  z.string().max(max).optional().transform((v) => (v && v.length > 0 ? v : undefined));

export const UserCreateInput = z.object({
  email: z.string().email().max(180),
  displayName: z.string().min(1).max(120).optional(),
  password: z.string().min(12).max(180).optional(),
});
export type UserCreateInput = z.infer<typeof UserCreateInput>;

export const UserUpdateInput = z.object({
  email: z.string().email().max(180).optional(),
  displayName: z.string().min(1).max(120).optional(),
  status: z.enum(["active", "suspended", "deleted"]).optional(),
  kennitala: z
    .string()
    .regex(KENNITALA_RE, { message: "format: DDMMYY-XXXX" })
    .optional()
    .transform((v) => (v ? v.replace(/-/g, "") : undefined)),
  phone: optionalString(40),
  locale: z.string().min(2).max(10).optional(),
  notes: optionalString(2000),
});
export type UserUpdateInput = z.infer<typeof UserUpdateInput>;

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
