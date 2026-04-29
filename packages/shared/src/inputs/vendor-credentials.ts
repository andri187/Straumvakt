import { z } from "zod";

// POST /api/admin/orgs/:orgId/vendor-credentials — save Zaptec/Easee/etc.
// portal credentials under one org. Password is sealed server-side
// before insert (apps/api/src/lib/credential-crypto.ts).

export const VendorCredentialCreateInput = z.object({
  vendorSlug: z.string().min(1).max(40), // resolves server-side to vendorId
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  notes: z.string().max(500).optional().transform((v) => (v && v.length > 0 ? v : undefined)),
});
export type VendorCredentialCreateInput = z.infer<typeof VendorCredentialCreateInput>;

export const VendorCredentialUpdateInput = z.object({
  // Allow rotating the password without changing username/vendor.
  password: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "expired", "revoked"]).optional(),
  notes: z.string().max(500).optional(),
});
export type VendorCredentialUpdateInput = z.infer<typeof VendorCredentialUpdateInput>;
