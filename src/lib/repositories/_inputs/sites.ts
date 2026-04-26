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
