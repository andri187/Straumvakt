import { z } from "zod";

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const PropertyCreateInput = z.object({
  orgId: z.string().uuid(),
  displayName: z.string().min(1).max(120),
  locationType: optionalString(40),
  street: optionalString(200),
  city: optionalString(80),
  postalCode: optionalString(20),
  countryCode: z.string().regex(/^[A-Z]{2}$/).default("IS"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export type PropertyCreateInput = z.infer<typeof PropertyCreateInput>;

export const PropertyUpdateInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  locationType: optionalString(40),
  street: optionalString(200),
  city: optionalString(80),
  postalCode: optionalString(20),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});
export type PropertyUpdateInput = z.infer<typeof PropertyUpdateInput>;
