export type UserStatus = "active" | "suspended" | "deleted";

export type UserAudience = "operator" | "driver" | "service";

// MembershipRole carries both the pre-ADR-0014 values (deprecated;
// retained until Sprint 9 RLS rebuild) AND the new ADR 0014 bundles.
// Sprint 4 milestone 4.2's permission catalogue maps only the new
// values; deprecated values fall through to the no-permission default.
export type MembershipRole =
  // Pre-ADR-0014 — deprecated.
  | "owner"
  | "admin"
  | "operator"
  | "helper"
  | "contractor"
  | "driver"
  | "viewer"
  // ADR 0014.
  | "manager"
  | "technician"
  | "finance"
  | "support"
  // ADR 0027 — going-public host self-management (tenancy-scoped).
  | "host_admin";

export type MembershipStatus = "invited" | "active" | "suspended" | "revoked";

export type PlatformRole =
  | "super_user"
  | "platform_admin"
  | "support_agent"
  | "sales_cs"
  | "finance_internal"
  | "auditor";

export type PlatformGrantStatus = "active" | "suspended" | "revoked";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  audience: UserAudience;
  kennitala: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  notes: string | null;
  hasCredentials: boolean;
  // Profile enrichment round 2 (Sprint 3) — name parts, DOB, photo,
  // freeform address.
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  dateOfBirth: string | null; // ISO date (yyyy-mm-dd)
  photoUrl: string | null;
  address: unknown;
  // ADR 0014 / API-onboarding enrichment.
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  lastSeenAt: string | null;
  consentTosAt: string | null;
  consentPrivacyAt: string | null;
  consentMarketingAt: string | null;
  metadata: unknown;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VendorRefStatus =
  | "active"
  | "inactive_at_vendor"
  | "removed_at_vendor";

export interface UserVendorRefSummary {
  id: string;
  userId: string;
  vendorSlug: string;
  vendorUserId: string;
  vendorEmail: string | null;
  vendorRoleHint: string | null;
  scopeInstallationId: string | null;
  status: VendorRefStatus;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type IdTokenKind =
  | "rfid"
  | "app_jwt"
  | "magic_link"
  | "zaptec_proxy"
  | "ocpi_token"
  | "manual"
  | "evccid";

export type IdTokenStatus = "active" | "suspended" | "revoked" | "expired";

export interface IdTokenSummary {
  id: string;
  userId: string;
  kind: IdTokenKind;
  // Truncated/masked when surfaced to UI — never echo the full bearer
  // value back to the operator console for tokens of kind app_jwt /
  // magic_link / ocpi_token. RFID UIDs are operator-meaningful.
  value: string;
  vendorIssuedBy: string | null;
  vendorTokenId: string | null;
  label: string | null;
  status: IdTokenStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  scopeInstallationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleSummary {
  id: string;
  userId: string;
  make: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
  vin: string | null;
  batteryCapacityKwh: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserMembershipSummary {
  orgId: string;
  orgDisplayName: string;
  role: MembershipRole;
  createdAt: string;
}

export interface OrgMembershipSummary {
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  role: MembershipRole;
  createdAt: string;
}
