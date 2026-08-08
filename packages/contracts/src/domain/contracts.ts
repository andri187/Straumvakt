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
  /** Primary owner — typically the customer / asset owner. */
  orgId: string;
  orgDisplayName: string;
  /** The other side of the bilateral arrangement — typically the
   *  operator (Straumvakt). null when the contract is single-sided
   *  or pre-dates the counterparty column. */
  counterpartyOrgId: string | null;
  counterpartyOrgDisplayName: string | null;
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

/** Tariff bindings resolved through the contract's scope.
 *  - DSO: anchored on the parent Site of the scope (always one).
 *  - Retailers: per Installation under the scope (one or many). */
export interface ContractTariffSummary {
  dso: {
    siteId: string;
    siteDisplayName: string;
    tariffId: string;
    tariffDisplayName: string;
    pricePerKwhMinor: string | null;
    vatRatePct: number | null;
  } | null;
  retailers: Array<{
    installationId: string;
    installationDisplayName: string;
    tariffId: string | null;
    tariffDisplayName: string | null;
    pricePerKwhMinor: string | null;
    vatRatePct: number | null;
  }>;
}

export interface ContractUpdateInput {
  displayName?: string;
  status?: ContractStatus;
  validFrom?: string;
  /** Pass null to clear (open-ended), an ISO string to set, omit to skip. */
  validUntil?: string | null;
}
