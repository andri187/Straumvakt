// Contract summary as returned by /api/admin/orgs/:id/contracts.
// Org-level Contract (billing.contracts table) — NOT DriverContract
// (which is per-driver under people schema).

export type ContractStatus =
  | "pending_configuration"
  | "active"
  | "superseded"
  | "archived";

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
  orgDisplayName: string;
  displayName: string;
  status: ContractStatus;
  scopeType: ContractScopeType;
  scopeId: string | null;
  /** Resolved name of the scope row (site name, installation name, …)
   *  when scopeId is set and the row exists. null for org_default or
   *  when the scope row was deleted. */
  scopeDisplayName: string | null;
  parentContractId: string | null;
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractUpdateInput {
  displayName?: string;
  status?: ContractStatus;
  validFrom?: string;
  /** Pass null to clear (open-ended), an ISO string to set, omit to skip. */
  validUntil?: string | null;
}
