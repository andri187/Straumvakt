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
  // `online` is the legacy "either source signals reachability" flag,
  // kept for the at-a-glance count aggregation on parent nodes.
  // Renderers should prefer `apiActive` + `ocppActive` for per-row
  // emblems since they distinguish what's actually reachable.
  online: boolean;
  /**
   * Zaptec cloud reports this charger as online (vendor-side
   * data plane reachable). null = not a Zaptec charger / Zaptec
   * unreachable / no credential available — render the emblem grey
   * but operator can hover to see "unknown" rather than "offline".
   */
  apiActive: boolean | null;
  /**
   * Per-charger CONFIG flag. True when Zaptec's AuthenticationType
   * is OCPP (2 = OCPP cloud, 3 = Native OCPP). False when configured
   * for any other auth mode. null = unknown (non-Zaptec / Zaptec
   * unreachable). Independent of runtime session state — that's
   * tracked via parent-node chargersOnline / chargersOffline counts.
   */
  ocppActive: boolean | null;
  /**
   * ISO timestamp of when the charger came online (StateId -2 last
   * transition to "1"). null when offline / never connected /
   * Zaptec data unavailable. Used to render "online 3h 12m" in the
   * tree row. Disconnect count would need a server-side event log
   * that we don't currently track — see disconnectsPast24h.
   */
  onlineSince: string | null;
  /**
   * Number of disconnects observed in the last 24 hours. Always
   * null right now: Zaptec REST doesn't expose this and we don't
   * yet track gateway WebSocket lifecycle events on our side.
   * Reserved so the UI placeholder maps to a real field once we
   * add the event log.
   */
  disconnectsPast24h: number | null;
  /**
   * Whether Zaptec is configured to send OCPP Basic-Auth on the
   * WSS upgrade for this charger. Drives the per-row Auth toggle
   * in the sites tree. null = unknown (non-Zaptec / Zaptec
   * unreachable / no credential available).
   */
  authRequired: boolean | null;
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
