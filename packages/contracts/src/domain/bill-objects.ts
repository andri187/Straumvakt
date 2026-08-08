// ADR 0029 — child-object billing attribution (the BILLING spine: who
// pays). A BillObject is a unit/apartment/stall (multi-dwelling) or a
// company/department/cost-center (company host) that accumulates charging
// cost and resolves to an owner of record. Orthogonal to the ACCESS spine
// (DriverGroup → Agreement → scope). Runtime-free UI/domain shapes.

export type BillObjectKind =
  | "apartment"
  | "unit"
  | "stall"
  | "company"
  | "department"
  | "cost_center"
  | "other";

export type BillObjectStatus = "active" | "inactive";

// Owner of record — the invoice recipient. Exactly one of user/org in a
// billable object; "none" only for transient/structural rows.
export type BillObjectOwner =
  | { kind: "user"; userId: string }
  | { kind: "org"; orgId: string }
  | { kind: "none" };

export interface BillObjectSummary {
  id: string;
  orgId: string; // host org
  installationId: string | null; // null for company-flat
  kind: BillObjectKind;
  label: string;
  parentId: string | null;
  owner: BillObjectOwner;
  status: BillObjectStatus;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface BillObjectMemberSummary {
  id: string;
  billObjectId: string;
  userId: string;
  effectiveFrom: string; // ISO 8601
  effectiveTo: string | null; // null = current
}
