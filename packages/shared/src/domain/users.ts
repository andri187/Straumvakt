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
  createdAt: string;
  updatedAt: string;
}

export interface UserMembershipSummary {
  orgId: string;
  orgSlug: string;
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
