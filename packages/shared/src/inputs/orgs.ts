import { z } from "zod";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const KENNITALA_RE = /^\d{6}-?\d{4}$/;

export const OrganizationRoleEnum = z.enum([
  "csms_provider",
  "operator",
  "service_contractor",
  "installer",
  "vendor",
  "asset_owner",
  "payer",
  "beneficiary",
  "customer",
  "retailer",
  "dso",
  "tso",
  "producer",
  "aggregator",
  "public_charging",
  "home_charging",
  "emsp",
  "roaming_hub",
  "payment_processor",
  "insurance_provider",
  "regulator",
]);
export type OrganizationRole = z.infer<typeof OrganizationRoleEnum>;

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const OrgCreateInput = z.object({
  slug: z.string().regex(SLUG_RE, {
    message: "lowercase letters, digits, dashes only; 3–48 chars",
  }),
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
  legalForm: optionalString(40),
  vskNr: optionalString(40),
  leiCode: optionalString(40),
  defaultCurrency: z.string().min(3).max(3).default("ISK"),
  regulatorLicenceNo: optionalString(80),
  notes: optionalString(2000),
  roles: z.array(OrganizationRoleEnum).default([]),
  addresses: z.record(z.string(), z.unknown()).default({}),
  contacts: z.record(z.string(), z.unknown()).default({}),
  branding: z.record(z.string(), z.unknown()).default({}),
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
  legalForm: optionalString(40),
  vskNr: optionalString(40),
  leiCode: optionalString(40),
  defaultCurrency: z.string().min(3).max(3).optional(),
  regulatorLicenceNo: optionalString(80),
  notes: optionalString(2000),
  roles: z.array(OrganizationRoleEnum).optional(),
  addresses: z.record(z.string(), z.unknown()).optional(),
  contacts: z.record(z.string(), z.unknown()).optional(),
  branding: z.record(z.string(), z.unknown()).optional(),
});
export type OrgUpdateInput = z.infer<typeof OrgUpdateInput>;
