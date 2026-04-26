import { z } from "zod";

const OnboardingStatus = z.enum([
  "pending_credentials",
  "discovering",
  "active",
  "suspended",
  "error",
]);

const optionalString = (max: number) =>
  z.string().max(max).optional().transform((v) => (v && v.length > 0 ? v : undefined));

export const InstallationCreateInput = z.object({
  orgId: z.string().uuid(),
  siteId: z.string().uuid(),
  displayName: z.string().min(1).max(120),
  vendorId: z.string().uuid().optional(),
  modelId: z.string().uuid().optional(),
  vendorInstallationRef: optionalString(120),
  onboardingStatus: OnboardingStatus.default("pending_credentials"),
});
export type InstallationCreateInput = z.infer<typeof InstallationCreateInput>;
