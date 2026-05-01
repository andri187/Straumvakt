export type UserStatus = "active" | "suspended" | "deleted";

export type MembershipRole =
  | "owner"
  | "admin"
  | "operator"
  | "helper"
  | "contractor"
  | "driver"
  | "viewer";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  kennitala: string | null;
  phone: string | null;
  locale: string;
  notes: string | null;
  hasCredentials: boolean;
  // Profile enrichment round 2 (Sprint 3) — name parts, DOB, photo,
  // freeform address. address is JSONB on the row; the UI shows it as
  // an editable form keyed on common fields (street/city/postal/country).
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  dateOfBirth: string | null; // ISO date (yyyy-mm-dd) — DATE column
  photoUrl: string | null;
  address: unknown;
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
