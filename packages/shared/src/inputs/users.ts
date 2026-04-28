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

export const MembershipCreateInput = z.object({
  userId: z.string().uuid(),
  role: z.enum([
    "owner",
    "admin",
    "operator",
    "helper",
    "contractor",
    "driver",
    "viewer",
  ]),
});
export type MembershipCreateInput = z.infer<typeof MembershipCreateInput>;
