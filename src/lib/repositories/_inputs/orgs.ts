import { z } from "zod";

// Slug is what shows up in URLs / API references. Lowercase, dashes only,
// no leading/trailing dash, 3–48 chars. Generous enough for "kronan-pilot",
// strict enough that we can use it in a routing path safely.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

// ISO 3166-1 alpha-2. Pilot is IS only; schema accepts any 2-letter code.
const COUNTRY_RE = /^[A-Z]{2}$/;

export const OrgCreateInput = z.object({
  slug: z.string().regex(SLUG_RE, {
    message: "lowercase letters, digits, dashes only; 3–48 chars",
  }),
  displayName: z.string().min(1).max(120),
  countryCode: z.string().regex(COUNTRY_RE, {
    message: "ISO-3166-1 alpha-2 (e.g. IS, NO, SE)",
  }),
});
export type OrgCreateInput = z.infer<typeof OrgCreateInput>;

export const OrgUpdateInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  countryCode: z.string().regex(COUNTRY_RE).optional(),
});
export type OrgUpdateInput = z.infer<typeof OrgUpdateInput>;
