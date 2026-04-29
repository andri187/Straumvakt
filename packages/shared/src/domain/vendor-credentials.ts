// Wire shape of a stored vendor portal credential. Password is never
// returned to the operator UI — only metadata. Re-authenticating via
// the credential happens server-side using the encrypted column +
// the Worker KEK.

export interface VendorCredentialSummary {
  id: string;
  ownerOrgId: string;
  ownerOrgDisplayName: string;
  vendorId: string;
  vendorSlug: string;
  vendorDisplayName: string;
  username: string;
  status: "active" | "expired" | "revoked";
  notes: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Convenience counts populated by the list endpoints — null when not joined.
  installationCount: number | null;
  chargerCount: number | null;
}
