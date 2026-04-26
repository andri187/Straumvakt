import { z } from "zod";

export const UserCreateInput = z.object({
  email: z.string().email().max(180),
  displayName: z.string().min(1).max(120).optional(),
  // pilot: staff users never sign in (env-var admin only) — driver users
  // are inert. Both leave password unset by default. Schema is here for
  // post-pilot when real auth lands.
  password: z.string().min(12).max(180).optional(),
});
export type UserCreateInput = z.infer<typeof UserCreateInput>;

export const UserUpdateInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  status: z.enum(["active", "suspended", "deleted"]).optional(),
});
export type UserUpdateInput = z.infer<typeof UserUpdateInput>;
