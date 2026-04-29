// Wire shape of a pending discovery — a charger that's tried to
// authenticate against the OCPP gateway with credentials that don't
// match any OcppIdentity row. Operators see these in /chargers/pending
// and click Claim to pre-fill /chargers/new.

export interface PendingDiscoverySummary {
  identityString: string;
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
  remoteAddr: string | null;
  userAgent: string | null;
}
