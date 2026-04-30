// Site tree — hierarchical projection used by /sites to render
// Site → Installation → Circuit → Charger inline. Each level carries
// just enough info for an at-a-glance row; click-through lands on the
// individual entity's detail page for full editing.
//
// The tree includes "orphan" buckets at site and installation levels so
// chargers that aren't yet bucketed under a circuit (or circuits that
// aren't bucketed under an installation) still render somewhere — the
// schema permits these gaps and we don't want to hide rows just because
// the operator hasn't finished the hierarchy.

export interface SiteTreeChargerNode {
  chargingStationId: string;
  ocppIdentityId: string | null;
  identityString: string | null;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  // Online iff status === 'online' or last_seen_at within the last 5
  // minutes — same definition vendor-credentials uses for its
  // online/offline split. Reflects the gateway DO's perspective.
  online: boolean;
  status: string;
  lastSeenAt: string | null;
  connectorSummary: string;
}

export interface SiteTreeCircuitNode {
  id: string;
  displayName: string;
  ampereCeiling: number | null;
  phaseCount: number;
  chargers: SiteTreeChargerNode[];
}

export interface SiteTreeInstallationNode {
  id: string;
  displayName: string;
  vendorSlug: string | null;
  onboardingStatus: string;
  circuits: SiteTreeCircuitNode[];
  // Chargers attached to this installation but not to any circuit.
  directChargers: SiteTreeChargerNode[];
  chargersOnline: number;
  chargersOffline: number;
}

export interface SiteTreeNode {
  id: string;
  displayName: string;
  orgId: string;
  orgDisplayName: string;
  propertyId: string;
  propertyDisplayName: string;
  siteType: string;
  accessLevel: string;
  timezone: string;
  chargersOnline: number;
  chargersOffline: number;
  installations: SiteTreeInstallationNode[];
  // Circuits not under any installation.
  orphanCircuits: SiteTreeCircuitNode[];
  // Chargers not under any installation or circuit.
  orphanChargers: SiteTreeChargerNode[];
}
