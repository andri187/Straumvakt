// Vendor-credential discovery probe — read-only inventory of every
// installation + charger a stored vendor credential can see, diffed
// against our DB so the operator can decide what to attach or onboard.
//
// Sprint 9 — PROBE-2 (discovery surface). PROBE-3 owns the "attach
// existing" write action; PROBE-4 owns the "onboard whole installation"
// write action. This type only describes the read shape.
//
// Status taxonomy per charger:
//   - "onboarded_linked"           — already in our DB, linked to THIS credential
//                                    (either via Installation.credentialsId or
//                                    Installation.credentialsRef = username)
//   - "onboarded_unlinked"         — in our DB but the parent Installation has
//                                    no credentialsId / credentialsRef. Candidate
//                                    for PROBE-3's "attach to this credential" action.
//   - "onboarded_other_credential" — in our DB AND already linked to a DIFFERENT
//                                    credential. Informational only — no action.
//   - "not_onboarded"              — visible in Zaptec but no matching OcppIdentity
//                                    in our DB. Candidate for PROBE-4's onboard action.

export type VendorCredentialProbeChargerStatus =
  | "onboarded_linked"
  | "onboarded_unlinked"
  | "onboarded_other_credential"
  | "not_onboarded";

export interface VendorCredentialProbeCharger {
  /** Zaptec internal UUID — the join key against OcppIdentity.vendor_resource_id. */
  zaptecChargerId: string;
  /** Hardware DeviceId (e.g. ZPR042645) — also matches OcppIdentity.identity_string. */
  serialNumber: string | null;
  /** Operator-friendly name from Zaptec. */
  displayName: string;
  /** Zaptec installation name (denormalised so a charger row is self-describing). */
  installationName: string;
  /** Discovery verdict — see comments above for taxonomy. */
  status: VendorCredentialProbeChargerStatus;
  /** Our charging_station_id when status is one of the three "onboarded_*"; null otherwise. */
  ourChargingStationId: string | null;
  /** Our owning org id (when onboarded) — used to render a tenant pill. */
  ourOrgId: string | null;
  /** Display name of our owning org (when onboarded). */
  ourOrgName: string | null;
}

export interface VendorCredentialProbeInstallation {
  /** Zaptec installation UUID. */
  zaptecInstallationId: string;
  /** Display name from Zaptec. */
  name: string;
  /** Zaptec-side address ("Street, City") — null when Zaptec didn't return any. */
  address: string | null;
  chargers: VendorCredentialProbeCharger[];
  /** Roll-up: how many of the chargers below have any "onboarded_*" status. */
  onboardedCount: number;
  /** Roll-up: total chargers in this installation. */
  totalCount: number;
}

export interface VendorCredentialProbeCredential {
  id: string;
  vendor: string;
  username: string;
  status: string;
}

export interface VendorCredentialProbeSummary {
  totalInstallations: number;
  totalChargers: number;
  /** Count of chargers in any "onboarded_*" state. */
  onboardedTotal: number;
  /** Count of "not_onboarded" chargers. */
  notOnboardedTotal: number;
  /** Count of "onboarded_unlinked" — chargers PROBE-3 could attach to this credential. */
  needsAttachTotal: number;
}

export interface VendorCredentialProbe {
  credential: VendorCredentialProbeCredential;
  installations: VendorCredentialProbeInstallation[];
  summary: VendorCredentialProbeSummary;
}
