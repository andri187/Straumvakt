import { z } from "zod";

const ComputeRule = z.object({
  kind: z.enum([
    "per_kwh",
    "per_session_flat",
    "per_minute_after_minutes",
    "percent_of_factors",
    "per_calendar_month_flat",
    "per_day_flat",
  ]),
  amountMinor: z.number().int().min(0).optional(),
  thresholdMinutes: z.number().int().min(0).optional(),
  percent: z.number().min(0).max(100).optional(),
  factorCodes: z.array(z.string()).optional(),
});

export const TariffDefinitionCreateInput = z.object({
  orgId: z.string().uuid(),
  costFactorId: z.string().uuid(),
  displayName: z.string().min(1).max(120),
  computeRule: ComputeRule,
  vatRatePct: z.number().min(0).max(100).default(24),
  currency: z.string().min(3).max(3).default("ISK"),
  validFrom: z.string().min(10), // ISO date
  validUntil: z.string().optional(),
});
export type TariffDefinitionCreateInput = z.infer<typeof TariffDefinitionCreateInput>;
