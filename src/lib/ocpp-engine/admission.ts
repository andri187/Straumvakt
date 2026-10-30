// Connection admission (Checkpoint A).
//
// Resolves host + installation key + wire identity TOGETHER to one permanent
// device and one live placement, then applies the installation's explicit
// credential mode. Pure: all reads arrive through `AdmissionStore`, so the
// whole decision table is testable without a database.
//
// What admission is NOT:
//   - It is not charging permission. Admitting a socket says "this connection
//     matches a registered, placed device at this installation"; whether any
//     driver may charge is `authorization.ts`, per idTag, per request.
//   - It is not proof of hardware ownership when the mode is `none`. A
//     credential-free admission is a deliberate, recorded installation choice,
//     and the context says so (`credentialMode: "none"`) so nothing downstream
//     can mistake it for an authenticated device.
//   - It never reads a caller-supplied tenant or timestamp. `at` is the
//     server's clock, passed in so tests are deterministic.

import { verifyInstallationPassword } from "@/lib/installations/password";
import { storedIdentity } from "@/lib/installations/model";
import type { BasicCredentials, ParsedRoute } from "./route";

export type AdmissionLookup = {
  org: { id: string; active: boolean } | null;
  /** Only an installation belonging to `org` and addressed by the route key. */
  installation: {
    id: string;
    orgId: string;
    archived: boolean;
    passwordMode: "unset" | "none" | "password";
    passwordVerifier: string | null;
    /** Changes whenever mode or password changes, so cached admissions can be invalidated. */
    credentialEpoch: string;
  } | null;
  /** Identity rows for this installation key whose string matches the route, ignoring case. */
  identities: {
    deviceId: string;
    identityString: string;
    /** True when the identity period contains `at`. */
    current: boolean;
    placements: { id: string; orgId: string; installationId: string; current: boolean }[];
  }[];
};

export interface AdmissionStore {
  lookup(route: ParsedRoute, at: Date): Promise<AdmissionLookup>;
  /** Best-effort, throttled record that an unregistered identity tried to connect. Never grants anything. */
  recordDiscovery(input: { orgId: string; installationId: string; installationKey: string; chargePointId: string; at: Date; /** Why the connection was refused, kept for the operator (e.g. a retired device reconnecting). */ reason?: DenyReason }): Promise<void>;
}

export type ConnectionContext = {
  orgId: string;
  installationId: string;
  installationKey: string;
  chargePointId: string;
  /** The wire identity as stored: `{installation-key}/{charge-point-id}`. */
  identityString: string;
  /** Permanent equipment UUID; survives transfers and identity changes. */
  deviceId: string;
  placementId: string;
  credentialMode: "none" | "password";
  credentialEpoch: string;
};

export type DenyReason =
  | "unknown_route"
  | "identity_case_mismatch"
  | "unregistered"
  | "identity_not_current"
  | "no_active_placement"
  | "placement_elsewhere"
  | "ambiguous_identity"
  | "ambiguous_placement"
  | "credentials_not_configured"
  | "credentials_required"
  | "username_mismatch"
  | "bad_credentials";

export type AdmissionDecision =
  | { kind: "admit"; context: ConnectionContext }
  | { kind: "deny"; reason: DenyReason }
  | { kind: "unavailable" };

export async function decideAdmission(
  store: AdmissionStore,
  route: ParsedRoute,
  basic: BasicCredentials | null,
  at: Date,
): Promise<AdmissionDecision> {
  let found: AdmissionLookup;
  try {
    found = await store.lookup(route, at);
  } catch {
    return { kind: "unavailable" };
  }

  const { org, installation } = found;
  if (!org || !org.active || !installation || installation.orgId !== org.id || installation.archived) {
    return { kind: "deny", reason: "unknown_route" };
  }

  const wire = storedIdentity(route.installationKey, route.chargePointId);
  const exact = found.identities.filter((i) => i.identityString === wire);
  if (exact.length === 0) {
    if (found.identities.length > 0) return { kind: "deny", reason: "identity_case_mismatch" };
    // Registered installation, unknown charger: remember it for discovery, grant nothing.
    await store
      .recordDiscovery({ orgId: org.id, installationId: installation.id, installationKey: route.installationKey, chargePointId: route.chargePointId, at })
      .catch(() => undefined);
    return { kind: "deny", reason: "unregistered" };
  }

  const current = exact.filter((i) => i.current);
  if (current.length === 0) {
    // A KNOWN identity whose period has ended: a removed or retired device (or a stale one) is still talking. Record the
    // attempt so an operator can see it; it never grants anything and is throttled by the store.
    await store.recordDiscovery({ orgId: org.id, installationId: installation.id, installationKey: route.installationKey, chargePointId: route.chargePointId, at, reason: "identity_not_current" }).catch(() => undefined);
    return { kind: "deny", reason: "identity_not_current" };
  }
  if (current.length > 1) return { kind: "deny", reason: "ambiguous_identity" };
  const identity = current[0]!;

  const live = identity.placements.filter((p) => p.current);
  if (live.length === 0) {
    await store.recordDiscovery({ orgId: org.id, installationId: installation.id, installationKey: route.installationKey, chargePointId: route.chargePointId, at, reason: "no_active_placement" }).catch(() => undefined);
    return { kind: "deny", reason: "no_active_placement" };
  }
  const here = live.filter((p) => p.installationId === installation.id && p.orgId === org.id);
  if (here.length === 0) return { kind: "deny", reason: "placement_elsewhere" };
  if (live.length > 1 || here.length > 1) return { kind: "deny", reason: "ambiguous_placement" };
  const placement = here[0]!;

  // Cheap checks are done; only now pay for the password hash.
  const mode = installation.passwordMode;
  if (mode === "unset") return { kind: "deny", reason: "credentials_not_configured" };
  if (mode === "password") {
    if (!basic) return { kind: "deny", reason: "credentials_required" };
    if (basic.username !== route.chargePointId) return { kind: "deny", reason: "username_mismatch" };
    if (!installation.passwordVerifier) return { kind: "deny", reason: "credentials_not_configured" };
    const ok = await verifyInstallationPassword(basic.password, installation.passwordVerifier).catch(() => false);
    if (!ok) return { kind: "deny", reason: "bad_credentials" };
  } else if (basic && basic.username !== route.chargePointId) {
    // `none` ignores the password, but a header naming some other charger is a
    // misconfiguration worth refusing rather than guessing about.
    return { kind: "deny", reason: "username_mismatch" };
  }

  return {
    kind: "admit",
    context: {
      orgId: org.id,
      installationId: installation.id,
      installationKey: route.installationKey,
      chargePointId: route.chargePointId,
      identityString: wire,
      deviceId: identity.deviceId,
      placementId: placement.id,
      credentialMode: mode,
      credentialEpoch: installation.credentialEpoch,
    },
  };
}

/** HTTP status for a charger that was refused. Reasons stay internal: every denial looks the same on the wire. */
export function wireStatus(decision: Exclude<AdmissionDecision, { kind: "admit" }>): 401 | 503 {
  return decision.kind === "unavailable" ? 503 : 401;
}
