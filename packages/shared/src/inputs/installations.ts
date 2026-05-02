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

export const InstallationUpdateInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  vendorId: z.string().uuid().optional().nullable(),
  modelId: z.string().uuid().optional().nullable(),
  vendorInstallationRef: optionalString(120),
  credentialsRef: optionalString(200),
  credentialsStatus: optionalString(40),
  onboardingStatus: OnboardingStatus.optional(),
  retailerTariffId: z.string().uuid().optional().nullable(),
  // Sprint 4 / ADR 0014 milestone 4.6 — per-installation auth-enforce
  // gate. Operator flips after verifying IdToken table is seeded.
  // Defaults to false on schema add.
  enforceAuthorize: z.boolean().optional(),
});
export type InstallationUpdateInput = z.infer<typeof InstallationUpdateInput>;
