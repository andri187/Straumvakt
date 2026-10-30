// Driver authorization (Checkpoint A).
//
// Decides whether an idTag may start charging at one installation. Pure over an
// `AuthorizationStore`; no shadow mode, no fixed-tag bypass.
//
// The rules, in order. The first that fails wins and names its reason:
//   1. the idTag must be an enrolled token  -> else Invalid / unknown_id_tag.
//      A vendor "default id tag" configured on a charger is not enrolled by
//      being configured, so it lands here and is refused.
//   2. token status: revoked/suspended -> Blocked; expired -> Expired
//   3. token expiry passed -> Expired
//   4. a token scoped to an installation must match THIS installation
//      -> else Invalid / scope_mismatch (does not reveal that the token exists)
//   5. the owning user must be active
//   6. the user must hold current access at this installation (an active
//      driver-group membership under an active installation agreement)
//
// The old invoice-clause requirement ("agreement must carry billable clauses")
// is deliberately NOT restored: whether a rate exists is a costing concern,
// raised as a durable exception after the session, never a reason to refuse a
// permitted driver at the plug.
//
// Dependency failure is its own outcome. `unavailable` is never cached and is
// never reported as an access decision about the token.

export type AuthStatus = "Accepted" | "Blocked" | "Expired" | "Invalid";

export type AuthReason =
  | "ok"
  | "unknown_id_tag"
  | "revoked"
  | "suspended"
  | "expired_status"
  | "expiry_passed"
  | "scope_mismatch"
  | "user_inactive"
  | "no_access";

export type AuthorizationFacts = {
  token: {
    id: string;
    userId: string;
    status: "active" | "suspended" | "revoked" | "expired" | string;
    expiresAt: Date | null;
    scopeInstallationId: string | null;
  } | null;
  userActive: boolean;
  /** Current membership under an active installation agreement for the asked installation. */
  hasInstallationAccess: boolean;
};

export interface AuthorizationStore {
  facts(input: { idTag: string; installationId: string; at: Date }): Promise<AuthorizationFacts>;
}

export type AuthorizationDecision =
  | { kind: "decided"; status: AuthStatus; reason: AuthReason; userId?: string; idTokenId?: string }
  | { kind: "unavailable" };

export async function decideAuthorization(
  store: AuthorizationStore,
  input: { idTag: string; installationId: string; at: Date },
): Promise<AuthorizationDecision> {
  let f: AuthorizationFacts;
  try {
    f = await store.facts(input);
  } catch {
    return { kind: "unavailable" };
  }
  const t = f.token;
  if (!t) return { kind: "decided", status: "Invalid", reason: "unknown_id_tag" };
  const withToken = { idTokenId: t.id } as const;

  switch (t.status) {
    case "revoked":
      return { kind: "decided", status: "Blocked", reason: "revoked", ...withToken };
    case "suspended":
      return { kind: "decided", status: "Blocked", reason: "suspended", ...withToken };
    case "expired":
      return { kind: "decided", status: "Expired", reason: "expired_status", ...withToken };
    case "active":
      break;
    default:
      // A status this code does not know is not permission.
      return { kind: "decided", status: "Invalid", reason: "unknown_id_tag", ...withToken };
  }
  if (t.expiresAt && t.expiresAt.getTime() <= input.at.getTime()) {
    return { kind: "decided", status: "Expired", reason: "expiry_passed", ...withToken };
  }
  if (t.scopeInstallationId && t.scopeInstallationId !== input.installationId) {
    return { kind: "decided", status: "Invalid", reason: "scope_mismatch" };
  }
  if (!f.userActive) return { kind: "decided", status: "Blocked", reason: "user_inactive", ...withToken };
  if (!f.hasInstallationAccess) return { kind: "decided", status: "Blocked", reason: "no_access", ...withToken };
  return { kind: "decided", status: "Accepted", reason: "ok", userId: t.userId, ...withToken };
}
