import { z } from "zod";

const COUNTRY_RE = /^[A-Z]{2}$/;
const KENNITALA_RE = /^\d{6}-?\d{4}$/;
// Hagstofa Íslands sveitarfélagskóðar are 4-digit numerics ("1000",
// "0000" etc.). Accept any 4-digit string; future iteration could
// validate against the live catalogue.
const MUNICIPALITY_CODE_RE = /^\d{4}$/;

// OCPI-aligned tenant taxonomy — matches the trimmed prisma enum.
export const OrganizationRoleEnum = z.enum([
  "cpo",
  "emsp",
  "hub",
  "nsp",
  "site_host",
  "service_contractor",
  "installer",
  "vendor",
  "regulator",
  "dso",
  "tso",
  "retailer",
  "payment_processor",
]);
export type OrganizationRole = z.infer<typeof OrganizationRoleEnum>;

// Address shape used for both postalAddress and legalAddress. Iceland-
// only scope today, so country is omitted; add when the first
// non-IS org lands.
export const AddressInput = z.object({
  street: z.string().min(1).max(200),
  postalCode: z.string().min(1).max(20),
  city: z.string().min(1).max(120),
});
export type AddressInput = z.infer<typeof AddressInput>;

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalAddress = AddressInput.optional().nullable();

export const OrgCreateInput = z.object({
  displayName: z.string().min(1).max(120),
  countryCode: z.string().regex(COUNTRY_RE, {
    message: "ISO-3166-1 alpha-2 (e.g. IS, NO, SE)",
  }),
  kennitala: z
    .string()
    .regex(KENNITALA_RE, { message: "format: DDMMYY-XXXX" })
    .optional()
    .transform((v) => (v ? v.replace(/-/g, "") : undefined)),
  legalName: optionalString(200),
  legalForm: optionalString(120),
  legalFormCode: optionalString(20),
  vskNr: optionalString(40),
  leiCode: optionalString(40),
  defaultCurrency: z.string().min(3).max(3).default("ISK"),
  postalAddress: optionalAddress,
  legalAddress: optionalAddress,
  municipalityCode: z
    .string()
    .regex(MUNICIPALITY_CODE_RE, { message: "4-digit Hagstofa code" })
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  municipalityName: optionalString(120),
  regulatorLicenceNo: optionalString(80),
  notes: optionalString(2000),
  roles: z.array(OrganizationRoleEnum).default([]),
  branding: z.record(z.string(), z.unknown()).default({}),
  mainContactUserId: z.string().uuid().optional().nullable(),
});
export type OrgCreateInput = z.infer<typeof OrgCreateInput>;

export const OrgUpdateInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  countryCode: z.string().regex(COUNTRY_RE).optional(),
  kennitala: z
    .string()
    .regex(KENNITALA_RE)
    .optional()
    .transform((v) => (v ? v.replace(/-/g, "") : undefined)),
  legalName: optionalString(200),
  legalForm: optionalString(120),
  legalFormCode: optionalString(20),
  vskNr: optionalString(40),
  leiCode: optionalString(40),
  defaultCurrency: z.string().min(3).max(3).optional(),
  postalAddress: optionalAddress,
  legalAddress: optionalAddress,
  municipalityCode: z
    .string()
    .regex(MUNICIPALITY_CODE_RE)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  municipalityName: optionalString(120),
  regulatorLicenceNo: optionalString(80),
  notes: optionalString(2000),
  roles: z.array(OrganizationRoleEnum).optional(),
  branding: z.record(z.string(), z.unknown()).optional(),
  mainContactUserId: z.string().uuid().optional().nullable(),
});
export type OrgUpdateInput = z.infer<typeof OrgUpdateInput>;
