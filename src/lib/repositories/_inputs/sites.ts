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

export const SiteUpdateInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  timezone: z.string().optional(),
  siteType: SiteTypeEnum.optional(),
  accessLevel: SiteAccessLevelEnum.optional(),
  powerClass: SitePowerClassEnum.optional().nullable(),
});
export type SiteUpdateInput = z.infer<typeof SiteUpdateInput>;
