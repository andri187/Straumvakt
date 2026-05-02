// Contract summary as returned by /api/admin/orgs/:id/contracts.
// Org-level Contract (billing.contracts table) — NOT DriverContract
// (which is per-driver under people schema).

export type ContractStatus =
  | "pending_configuration"
  | "active"
  | "suspended"
  | "expired";

export type ContractScopeType =
  | "org_default"
  | "site"
  | "installation"
  | "circuit"
  | "charger"
  | "user"
  | "family_group"
  | "cost_center";

export interface ContractSummary {
  id: string;
  orgId: string;
  displayName: string;
  status: ContractStatus;
  scopeType: ContractScopeType;
  scopeId: string | null;
  parentContractId: string | null;
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}
