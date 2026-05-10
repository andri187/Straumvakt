import { z } from "zod";

const KENNITALA_RE = /^\d{6}-?\d{4}$/;

const optionalString = (max: number) =>
  z.string().max(max).optional().transform((v) => (v && v.length > 0 ? v : undefined));

export const UserAudienceEnum = z.enum(["operator", "driver", "service"]);
export type UserAudienceValue = z.infer<typeof UserAudienceEnum>;

export const UserCreateInput = z.object({
  email: z.string().email().max(180),
  displayName: z.string().min(1).max(120).optional(),
  password: z.string().min(12).max(180).optional(),
  audience: UserAudienceEnum.default("operator"),
  // ── Profile fields available at create time ──────────────────────
  // Same shape as UserUpdateInput but optional. Provided here so the
  // operator can capture full profile in one go (Iceland operators
  // typically know name + kennitala + phone at invite time).
  firstName: optionalString(120),
  middleName: optionalString(120),
  lastName: optionalString(120),
  kennitala: z
    .string()
    .regex(KENNITALA_RE, { message: "format: DDMMYY-XXXX" })
    .optional()
    .transform((v) => (v ? v.replace(/-/g, "") : undefined)),
  phone: optionalString(40),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(60).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "format: yyyy-mm-dd" })
    .optional(),
  photoUrl: optionalString(500),
  address: z
    .object({
      street: z.string().max(200).optional(),
      city: z.string().max(80).optional(),
      postalCode: z.string().max(20).optional(),
      countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    })
    .optional(),
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
  // ── ADR 0014 / API-onboarding enrichment ─────────────────────────
  audience: UserAudienceEnum.optional(),
  timezone: z.string().min(1).max(60).optional(),
  emailVerifiedAt: z.string().datetime().optional().nullable(),
  phoneVerifiedAt: z.string().datetime().optional().nullable(),
  consentTosAt: z.string().datetime().optional().nullable(),
  consentPrivacyAt: z.string().datetime().optional().nullable(),
  consentMarketingAt: z.string().datetime().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UserUpdateInput = z.infer<typeof UserUpdateInput>;

// ── Vehicle CRUD (driver-owned EV, FK to User) ──────────────────────

export const VehicleCreateInput = z.object({
  userId: z.string().uuid(),
  make: optionalString(60),
  model: optionalString(80),
  year: z.number().int().min(1990).max(2100).optional(),
  licensePlate: optionalString(20),
  vin: optionalString(20),
  batteryCapacityKwh: z.number().positive().max(500).optional(),
});
export type VehicleCreateInput = z.infer<typeof VehicleCreateInput>;

export const VehicleUpdateInput = VehicleCreateInput.partial().omit({
  userId: true,
});
export type VehicleUpdateInput = z.infer<typeof VehicleUpdateInput>;

// ── IdToken CRUD (RFID, app JWT, …) ─────────────────────────────────
//
// Operator-side create is rare (we mostly auto-import via Zaptec
// sync). Admin can manually create for testing or to register a
// non-Zaptec RFID. value is required + UNIQUE; UI can echo "Reveal"
// once after create then mask.

export const IdTokenKindEnum = z.enum([
  "rfid",
  "app_jwt",
  "magic_link",
  "zaptec_proxy",
  "ocpi_token",
  "manual",
  "evccid",
]);
export type IdTokenKindValue = z.infer<typeof IdTokenKindEnum>;

export const IdTokenStatusEnum = z.enum([
  "active",
  "suspended",
  "revoked",
  "expired",
]);
export type IdTokenStatusValue = z.infer<typeof IdTokenStatusEnum>;

export const IdTokenCreateInput = z.object({
  userId: z.string().uuid(),
  kind: IdTokenKindEnum,
  value: z.string().min(1).max(200),
  vendorIssuedBy: optionalString(40),
  vendorTokenId: optionalString(120),
  label: optionalString(120),
  status: IdTokenStatusEnum.default("active"),
  expiresAt: z.string().datetime().optional().nullable(),
  scopeInstallationId: z.string().uuid().optional().nullable(),
});
export type IdTokenCreateInput = z.infer<typeof IdTokenCreateInput>;

export const IdTokenUpdateInput = z.object({
  label: optionalString(120),
  status: IdTokenStatusEnum.optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  scopeInstallationId: z.string().uuid().optional().nullable(),
});
export type IdTokenUpdateInput = z.infer<typeof IdTokenUpdateInput>;

export const MEMBERSHIP_ROLES = [
  // Pre-ADR-0014 (deprecated; Sprint 9 cleanup).
  "owner",
  "admin",
  "operator",
  "helper",
  "contractor",
  "driver",
  "viewer",
  // ADR 0014.
  "manager",
  "technician",
  "finance",
  "support",
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
