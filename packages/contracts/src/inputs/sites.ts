import { z } from "zod";

const SiteTypeEnum = z.enum(["standard", "workplace", "mdu", "hotel", "fleet", "retail"]);
const SiteAccessLevelEnum = z.enum(["public", "private", "taxi_only"]);
const SitePowerClassEnum = z.enum(["lt_50kw", "between_50_150kw", "between_150_500kw", "gt_500kw"]);

export const SiteCreateInput = z.object({
  orgId: z.string().uuid(),
  propertyId: z.string().uuid(),
  displayName: z.string().min(1).max(120),
  timezone: z.string().default("Atlantic/Reykjavik"),
  siteType: SiteTypeEnum.default("standard"),
  accessLevel: SiteAccessLevelEnum.default("private"),
  powerClass: SitePowerClassEnum.optional(),
});
export type SiteCreateInput = z.infer<typeof SiteCreateInput>;

// Weekly schedule + freeform extras. Each weekday is an array of
// open-close windows; an empty array = closed. holidays is a list of
// yyyy-mm-dd date overrides. notes is freeform copy the operator can
// drop in (e.g. "Closed during summer holidays").
const OpeningHoursWindow = z.object({
  open: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "HH:MM" }),
  close: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "HH:MM" }),
});
const OpeningHoursDay = z.array(OpeningHoursWindow).max(6);
const OpeningHoursSchema = z
  .object({
    mon: OpeningHoursDay.optional(),
    tue: OpeningHoursDay.optional(),
    wed: OpeningHoursDay.optional(),
    thu: OpeningHoursDay.optional(),
    fri: OpeningHoursDay.optional(),
    sat: OpeningHoursDay.optional(),
    sun: OpeningHoursDay.optional(),
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .optional();

export const SiteUpdateInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  timezone: z.string().optional(),
  siteType: SiteTypeEnum.optional(),
  accessLevel: SiteAccessLevelEnum.optional(),
  powerClass: SitePowerClassEnum.optional().nullable(),
  provisioningStatus: z.string().min(1).max(40).optional(),
  dsoTariffId: z.string().uuid().nullable().optional(),
  usrfTariffId: z.string().uuid().nullable().optional(),
  usrfPremTariffId: z.string().uuid().nullable().optional(),
  xtrrfTariffId: z.string().uuid().nullable().optional(),
  spvivfTariffId: z.string().uuid().nullable().optional(),
  // Profile enrichment round 2 (Sprint 3).
  openingHours: OpeningHoursSchema,
  accessNote: z.string().max(2000).optional().nullable(),
  photoUrl: z.string().max(500).optional().nullable(),
});
export type SiteUpdateInput = z.infer<typeof SiteUpdateInput>;
