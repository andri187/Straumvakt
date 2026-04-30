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
  // Profile enrichment round 2 (Sprint 3) — name parts editable
  // separately from displayName; address is a freeform JSON object.
  firstName: z.string().max(120).optional().nullable(),
  middleName: z.string().max(120).optional().nullable(),
  lastName: z.string().max(120).optional().nullable(),
  // dateOfBirth as ISO yyyy-mm-dd; UI sends empty-string when cleared.
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "format: yyyy-mm-dd" })
    .optional()
    .nullable(),
  photoUrl: z.string().max(500).optional().nullable(),
  address: z
    .object({
      street: z.string().max(200).optional(),
      city: z.string().max(80).optional(),
      postalCode: z.string().max(20).optional(),
      countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    })
    .optional(),
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
