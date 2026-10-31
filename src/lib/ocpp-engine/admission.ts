// Connection admission.
//
// Resolves the CPO (the host) and the charge point id (the path) TOGETHER to one
// permanent device and its one live placement, then derives the installation
// from that placement and applies the installation's explicit credential mode.
// The URL never names an installation and no caller-supplied value picks one:
// an unknown charger cannot be assigned to an installation by guessing, and a
// charge point id registered in another CPO is simply not found here. Pure: all
// reads arrive through `AdmissionStore`, so the whole decision table is
// testable without a database.
//
// What admission is NOT:
//   - It is not charging permission. Admitting a socket says "this connection
//     matches a registered, placed device of this CPO"; whether any
//     driver may charge is `authorization.ts`, per idTag, per request.
//   - It is not proof of hardware ownership when the mode is `none`. A
//     credential-free admission is a deliberate, recorded installation choice,
//     and the context says so (`credentialMode: "none"`) so nothing downstream
//     can mistake it for an authenticated device.
//   - It never reads a caller-supplied tenant or timestamp. `at` is the
//     server's clock, passed in so tests are deterministic.

import { verifyInstallationPassword } from "@/lib/installations/password";
import type { BasicCredentials, ParsedRoute } from "./route";

export type AdmissionInstallation = {
  id: string;
  orgId: string;
  archived: boolean;
  passwordMode: "unset" | "none" | "password";
  passwordVerifier: string | null;
  /** Changes whenever mode or password changes, so cached admissions can be invalidated. */
  credentialEpoch: string;
};

export type AdmissionLookup = {
  org: { id: string; active: boolean } | null;
  /** Identity rows OF THIS CPO whose charge point id matches the route, ignoring case. */
  identities: {
    deviceId: string;
    chargePointId: string;
    /** The identity string as stored (old rows: `{installation-key}/{id}`; new rows: `{cpo-org-id}/{id}`). */
    identityString: string;
    /** True when the identity period contains `at`. */
    current: boolean;
    placements: { id: string; orgId: string; installationId: string; current: boolean; installation: AdmissionInstallation | null }[];
  }[];
};

export interface AdmissionStore {
  lookup(route: ParsedRoute, at: Date): Promise<AdmissionLookup>;
  /** Best-effort, throttled record that an unregistered identity tried to connect to this CPO. Never grants anything. */
  recordDiscovery(input: { orgId: string; chargePointId: string; at: Date; /** Why the connection was refused, kept for the operator (e.g. a retired device reconnecting). */ reason?: DenyReason }): Promise<void>;
}

export type ConnectionContext = {
  /** The CPO organisation, from the host. */
  orgId: string;
  /** Derived from the device's live placement, never from the URL. */
  installationId: string;
  chargePointId: string;
  /** The connection identity row as stored (see `identityRow`). */
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
  | "installation_unavailable"
  | "credentials_not_configured"
  | "credentials_required"
  | "username_mismatch"
  | "bad_credentials";

export type AdmissionDecision =
  | { kind: "admit"; context: ConnectionContext }
  /**
   * Only for a genuinely unknown charge point id of an ACTIVE CPO, and only when the caller asked for it. It is a
   * restricted waiting state: no device, placement, charging permission or cost exists for it. Retired, ambiguous,
   * case-mismatched or credential-failing identities never reach it.
   */
  | { kind: "pending"; orgId: string; chargePointId: string }
  | { kind: "deny"; reason: DenyReason }
  | { kind: "unavailable" };

export async function decideAdmission(
  store: AdmissionStore,
  route: ParsedRoute,
  basic: BasicCredentials | null,
  at: Date,
  options: { acceptPending?: boolean } = {},
): Promise<AdmissionDecision> {
  let found: AdmissionLookup;
  try {
    found = await store.lookup(route, at);
  } catch {
    return { kind: "unavailable" };
  }

  const { org } = found;
  if (!org || !org.active) return { kind: "deny", reason: "unknown_route" };

  const exact = found.identities.filter((i) => i.chargePointId === route.chargePointId);
  if (exact.length === 0) {
    if (found.identities.length > 0) return { kind: "deny", reason: "identity_case_mismatch" };
    // Unknown charger for this CPO: remember it for discovery, grant nothing, assign it to nothing.
    await store.recordDiscovery({ orgId: org.id, chargePointId: route.chargePointId, at }).catch(() => undefined);
    if (options.acceptPending) return { kind: "pending", orgId: org.id, chargePointId: route.chargePointId };
    return { kind: "deny", reason: "unregistered" };
  }

  const current = exact.filter((i) => i.current);
  if (current.length === 0) {
    // A KNOWN identity whose period has ended: a removed or retired device (or a stale one) is still talking. Record the
    // attempt so an operator can see it; it never grants anything and is throttled by the store.
    await store.recordDiscovery({ orgId: org.id, chargePointId: route.chargePointId, at, reason: "identity_not_current" }).catch(() => undefined);
    return { kind: "deny", reason: "identity_not_current" };
  }
  if (current.length > 1) return { kind: "deny", reason: "ambiguous_identity" };
  const identity = current[0]!;

  const live = identity.placements.filter((p) => p.current);
  if (live.length === 0) {
    await store.recordDiscovery({ orgId: org.id, chargePointId: route.chargePointId, at, reason: "no_active_placement" }).catch(() => undefined);
    return { kind: "deny", reason: "no_active_placement" };
  }
  if (live.length > 1) return { kind: "deny", reason: "ambiguous_placement" };
  const placement = live[0]!;
  // The device is placed in a different CPO than the host names: that is not this CPO's charger.
  if (placement.orgId !== org.id) return { kind: "deny", reason: "placement_elsewhere" };
  // The installation comes from the placement. It must be this CPO's own and still in service.
  const installation = placement.installation;
  if (!installation || installation.id !== placement.installationId || installation.orgId !== org.id || installation.archived) {
    return { kind: "deny", reason: "installation_unavailable" };
  }

  // Cheap checks are done; only now pay for the password hash.
  // A credential refusal of a REGISTERED charger is recorded (reason code and time only, never a value) so the operator can see
  // why a newly attached charger is not connecting. The store throttles it; the Incoming read clears it once the charger boots.
  const refuse = async (reason: DenyReason): Promise<AdmissionDecision> => {
    await store.recordDiscovery({ orgId: org.id, chargePointId: route.chargePointId, at, reason }).catch(() => undefined);
    return { kind: "deny", reason };
  };
  const mode = installation.passwordMode;
  if (mode === "unset") return refuse("credentials_not_configured");
  if (mode === "password") {
    if (!basic) return refuse("credentials_required");
    if (basic.username !== route.chargePointId) return refuse("username_mismatch");
    if (!installation.passwordVerifier) return refuse("credentials_not_configured");
    const ok = await verifyInstallationPassword(basic.password, installation.passwordVerifier).catch(() => false);
    if (!ok) return refuse("bad_credentials");
  } else if (basic && basic.username !== route.chargePointId) {
    // `none` ignores the password, but a header naming some other charger is a
    // misconfiguration worth refusing rather than guessing about.
    return refuse("username_mismatch");
  }

  return {
    kind: "admit",
    context: {
      orgId: org.id,
      installationId: installation.id,
      chargePointId: route.chargePointId,
      identityString: identity.identityString,
      deviceId: identity.deviceId,
      placementId: placement.id,
      credentialMode: mode,
      credentialEpoch: installation.credentialEpoch,
    },
  };
}

/** HTTP status for a charger that was refused. Reasons stay internal: every denial looks the same on the wire. */
export function wireStatus(decision: Exclude<AdmissionDecision, { kind: "admit" | "pending" }>): 401 | 503 {
  return decision.kind === "unavailable" ? 503 : 401;
}
