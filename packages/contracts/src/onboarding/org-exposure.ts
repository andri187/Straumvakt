// Who may see an organisation's registered identity, and through which shape.
//
// ── THE DISTINCTION THIS MODULE EXISTS FOR ──────────────────────────────
//
// An identifier that leaks through a LIST endpoint is a different class of
// mistake from one that leaks through a DETAIL endpoint. A detail read is a
// deliberate act against one named org; a list read hands back every org at
// once, so a single over-broad permission turns into bulk disclosure.
//
// ── WHAT IS ACTUALLY TRUE TODAY, MEASURED 2026-08-19 ────────────────────
//
// `apps/api/src/repositories/orgs.ts` maps rows through ONE function,
// `toSummary`, which includes `kennitala` — and BOTH `listOrgs` and
// `getOrgById` use it. So the cross-tenant list at `GET /api/admin/orgs`
// returns every organisation's kennitala.
//
// It is NOT an open leak: that route carries
// `requirePermission("platform.tenant.read")` and the code comment says so
// deliberately — "only platform staff see every org". So this is an
// over-broad payload behind a correct guard, not a hole.
//
// It is still worth closing, because the guard is the only thing standing
// between a support-agent role and every host's registered identity, and
// permission sets drift faster than payload shapes.
//
// ── WHY THIS SHIPS AS A POLICY MODULE RATHER THAN AN EDIT TO listOrgs ───
//
// Removing a field from `OrgSummary` changes a DTO the console reads
// (`src/app/org/[slug]/profile/page.tsx` renders `org.kennitala`). Making
// that change mid-round, while Claude A is working in the same tree, trades a
// small privacy improvement for a real chance of breaking a page nobody would
// notice until it rendered blank.
//
// So the redactor is built and tested here, and the handover is named:
//
//   HANDOVER TARGET: `apps/api/src/repositories/orgs.ts` — `listOrgs` should
//   map through `redactOrgIdentityForList`, leaving `getOrgById` unchanged.
//   The console then reads the full value from the detail endpoint it already
//   has, and the bulk shape stops carrying identifiers.

import { maskKennitala } from "../invoice/kennitala";

/** The identity-bearing subset of an org summary. Structural, so it fits any DTO. */
export interface OrgIdentityBearing {
  id: string;
  kennitala: string | null;
  vskNr: string | null;
}

export class OrgTenantViolation extends Error {
  readonly callerOrgId: string | null;
  readonly targetOrgId: string;
  constructor(callerOrgId: string | null, targetOrgId: string) {
    // Deliberately does NOT include any identifier beyond org ids, which are
    // opaque UUIDs. An access-denied error is a thing that gets logged.
    super("org_tenant_violation");
    this.name = "OrgTenantViolation";
    this.callerOrgId = callerOrgId;
    this.targetOrgId = targetOrgId;
  }
}

export interface Caller {
  /** The org this caller belongs to, or null for platform staff. */
  orgId: string | null;
  /** Platform staff may cross tenants; a customer admin may not. */
  isPlatformStaff: boolean;
}

/**
 * FOCUS.md rule 5, as a function.
 *
 * The repository layer currently takes no caller scope — `getOrgById(db,
 * orgId)` will happily return any org, and safety rests entirely on
 * `requirePermission("org.read", { orgIdParam })` at the route. That is a
 * real guard and it works, but rule 5 says tenancy belongs in every query,
 * not only in the middleware in front of it.
 *
 * This is the assertion a repository should make for itself.
 */
export function assertSameTenant(caller: Caller, targetOrgId: string): void {
  if (caller.isPlatformStaff) return;
  if (caller.orgId !== null && caller.orgId === targetOrgId) return;
  throw new OrgTenantViolation(caller.orgId, targetOrgId);
}

export function maySeeOrgIdentity(caller: Caller, targetOrgId: string): boolean {
  try {
    assertSameTenant(caller, targetOrgId);
    return true;
  } catch {
    return false;
  }
}

/**
 * The list projection: identity masked, never absent.
 *
 * Masked rather than removed on purpose. Removing the key makes a list row
 * and a detail row structurally different, which every consumer then has to
 * branch on; masking keeps one shape and makes the reduction visible in the
 * value itself. `maskKennitala` renders `DDMMYY-****` — enough to recognise a
 * record, not enough to identify a party.
 */
export function redactOrgIdentityForList<T extends OrgIdentityBearing>(summary: T): T {
  return {
    ...summary,
    kennitala: summary.kennitala ? maskKennitala(summary.kennitala) : null,
    // VSK numbers are published in a public register, so they are not
    // redacted. Stated explicitly so the asymmetry reads as a decision
    // rather than an oversight.
    vskNr: summary.vskNr,
  };
}

/**
 * The detail projection, tenancy-checked.
 *
 * Throws rather than returning null: a caller that ignores a null still ends
 * up rendering something. A caller that ignores a throw renders nothing.
 */
export function orgIdentityForDetail<T extends OrgIdentityBearing>(caller: Caller, summary: T): T {
  assertSameTenant(caller, summary.id);
  return summary;
}

/**
 * The exposure contract, as asserted data.
 *
 * Recorded here so "which endpoint returns what" is a question the test suite
 * answers rather than a paragraph that drifts.
 */
export const ORG_IDENTITY_EXPOSURE = {
  list: {
    endpoint: "GET /api/admin/orgs",
    guard: "platform.tenant.read",
    crossTenant: true,
    kennitalaToday: "full",
    kennitalaRecommended: "masked",
  },
  detail: {
    endpoint: "GET /api/admin/orgs/:orgId",
    guard: "org.read (orgIdParam)",
    crossTenant: false,
    kennitalaToday: "full",
    kennitalaRecommended: "full",
  },
} as const;
