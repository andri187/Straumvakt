export interface CircuitSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  siteId: string;
  siteDisplayName: string;
  installationId: string | null;
  installationDisplayName: string | null;
  displayName: string;
  ampereCeiling: number | null;
  phaseCount: number;
  vendorCircuitRef: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}
