// Which ledger rows a caller may see — decided in one pure place.
//
// ── THE TWO FILES THAT EACH NAMED THE OTHER ──────────────────────────────
//
// repositories/session-ledger.ts:16-18 said:
//
//     "Scope authorisation is the CALLER's job — the route handler validates
//      that the requesting session is allowed to ask for the scope it's
//      asking for. This repo trusts the scope it receives."
//
// routes/admin/billing.ts:49-56 said:
//
//     "The route gate is `billing.read`; refining further (e.g. preventing an
//      org agent from querying another org's siteId) is layered on top via
//      assertPermission once Sprint 8 Track C lands per-resource checks. For
//      Sprint 8.4 ship the admin-scope happy path."
//
// The repository deferred to the route. The route deferred to a milestone.
// `scopeFromQuery` took whatever query parameters arrived, unverified, and
// returned `{ kind: "admin" }` — no tenant filter at all — when none were
// supplied. `requireAdmin` only checks that an admin session cookie verifies;
// it does not restrict to platform staff. So any org member holding
// `billing.read` who called GET /api/admin/billing/sessions with no query
// string received every tenant's billing ledger.
//
// ── THE RESOLUTION ───────────────────────────────────────────────────────
//
// **The repository enforces.** This module decides, the repository applies,
// and the route only supplies the caller's identity. The header in
// session-ledger.ts has been corrected to say so, because the sentence that
// stood there described an arrangement that did not exist.
//
// The mechanism is a REQUIRED field, not a convention: `LedgerAccess`
// carries `restrictToOrgIds`, and `null` — meaning platform-wide — has to be
// written out. There is no default. A future caller that forgets to think
// about tenancy does not compile.
//
// Nothing about platform staff changes: `resolveOrgScope` returns
// `{ all: true }` for a bootstrap session or a `platform.tenant.read` grant,
// which maps to `restrictToOrgIds: null` and the behaviour that exists today.
// What changes is that an org member gets their own orgs' rows.
//
// Per-site, per-charger and per-driver views keep working for org members,
// because the restriction is applied ALONGSIDE the requested scope rather
// than instead of it — a charger view is intersected with the caller's orgs
// rather than refused. That is the alternative path the operator workflow
// needs, and it is the reason this is not a breaking change for the six UI
// surfaces that consume the ledger.

import type { OrgScope } from "../auth/org-scope";
import type { LedgerAccess, LedgerScope } from "../../repositories/session-ledger";

/** The raw query parameters, before anyone has decided whether to trust them. */
export interface LedgerScopeRequest {
  orgId?: string;
  siteId?: string;
  chargingStationId?: string;
  driverUserId?: string;
}

export type LedgerScopeDenial =
  /** The caller asked for an org they are not a member of. */
  | "org_not_in_scope"
  /** The caller has no org memberships and no platform grant. */
  | "no_org_scope";

export type LedgerAccessDecision =
  | { kind: "allow"; access: LedgerAccess }
  | { kind: "deny"; reason: LedgerScopeDenial };

/**
 * Turn query parameters plus the caller's org scope into a ledger access.
 *
 * Specific scopes win over general ones, matching the previous precedence so
 * no UI surface changes which rows it asks for — what changes is that the
 * answer is now confined to orgs the caller belongs to.
 */
export function decideLedgerAccess(
  request: LedgerScopeRequest,
  orgScope: OrgScope,
): LedgerAccessDecision {
  const requested = requestedScope(request);

  if (orgScope.all) {
    // Platform staff and bootstrap. Unchanged behaviour, stated explicitly
    // rather than arrived at by falling through a switch.
    return { kind: "allow", access: { scope: requested, restrictToOrgIds: null } };
  }

  if (orgScope.orgIds.length === 0) {
    // No memberships, no platform grant. Previously this caller got
    // `{ kind: "admin" }` and therefore every row in the table.
    return { kind: "deny", reason: "no_org_scope" };
  }

  if (request.orgId && !orgScope.orgIds.includes(request.orgId)) {
    // Naming someone else's org is a different act from omitting the
    // parameter, and it deserves its own answer rather than being quietly
    // narrowed to the caller's own rows.
    return { kind: "deny", reason: "org_not_in_scope" };
  }

  return {
    kind: "allow",
    access: { scope: requested, restrictToOrgIds: orgScope.orgIds },
  };
}

function requestedScope(request: LedgerScopeRequest): LedgerScope {
  if (request.driverUserId) return { kind: "driver", driverUserId: request.driverUserId };
  if (request.chargingStationId) {
    return { kind: "charger", chargingStationId: request.chargingStationId };
  }
  if (request.siteId) return { kind: "site", siteId: request.siteId };
  if (request.orgId) return { kind: "org", orgId: request.orgId };
  // "No parameters" is a request for everything the caller may see — which is
  // not the same as everything there is. `restrictToOrgIds` is what makes the
  // difference, and it is not optional.
  return { kind: "admin" };
}
