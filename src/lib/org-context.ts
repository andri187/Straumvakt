// Server-side entry gate for the per-org landing template.
//
// Auth is NOT rebuilt here. host_admin users sign in through the same
// POST /api/admin/login as everyone else (Path B — UserCredential lookup —
// in apps/api/src/routes/admin/auth.ts) from the root login page. This
// module only answers, for an already-authenticated request: which
// organisation is this person a host_admin of, and may they see /org/<slug>?
//
// It does that with the two existing endpoints:
//
//   GET /api/admin/me            → persona + the caller's org memberships
//                                  (apps/api/src/routes/admin/me.ts)
//   GET /api/admin/orgs/:orgId   → the full Organization row; reachable by
//                                  a host_admin because org.read is in the
//                                  HOST_ADMIN_BUNDLE and the route is
//                                  orgIdParam-scoped.
//
// This is the same pattern the parked host console used — its
// (app)/layout.tsx and host/layout.tsx both called GET /api/admin/me and
// routed personas from the result. No new endpoint, no change to apps/api.
//
// Tenant isolation comes for free: the org we render is always one the
// session actually holds a membership in. A slug pointing at somebody
// else's org can never resolve, because we only ever look at memberships
// returned by /me for this session.

import { cache } from "react";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import {
  resolveOrgTenant,
  slugForOrgName,
  type OrgSummary,
  type OrgTenantProfile,
} from "@/lib/org-tenant";

/** Shape returned by GET /api/admin/me. */
export type AdminMe = {
  email: string;
  role: string;
  userId: string | null;
  persona: "operator" | "host_admin" | "member" | "none";
  isPlatform: boolean;
  orgs: {
    orgId: string;
    displayName: string;
    kind: string | null;
    role: string;
  }[];
};

export type OrgContext = {
  /** Signed-in principal. */
  email: string;
  /** The full Organization row for the tenant being rendered. */
  org: OrgSummary;
  /** Everything the template is parameterised by. */
  tenant: OrgTenantProfile;
};

/**
 * Where a caller who does not belong on an org landing page is sent.
 *
 * Deliberately /home for every non-host_admin persona rather than any
 * employee-specific route: /home is the neutral post-login destination and
 * is the one place that knows about every persona. Keeping this module
 * from naming a staff route means the Straumvakt-employee landing page can
 * land wherever it likes without touching this file.
 *
 * The `as Route` casts throughout this file are because `typedRoutes` is on
 * (next.config.ts): redirect() takes a known route rather than a string,
 * and /org/[slug] is dynamic.
 */
const NOT_OUR_PERSONA = "/home" as Route;
const SIGNED_OUT = "/" as Route;

// React.cache dedupes within a single request. The layout and its
// generateMetadata both resolve the context, and every sub-page under
// /org/[slug] sits inside that layout — without this the same two
// endpoints would be hit several times per navigation.
const fetchMe = cache(async (): Promise<AdminMe | null> => {
  const res = await apiFetchServer("/api/admin/me");
  if (!res.ok) return null;
  return (await res.json()) as AdminMe;
});

const fetchOrg = cache(async (orgId: string): Promise<OrgSummary | null> => {
  const res = await apiFetchServer(`/api/admin/orgs/${orgId}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { org: OrgSummary };
  return body.org;
});

/**
 * Pick which host_admin membership a slug refers to, using only what /me
 * already gave us — no extra round-trip. Orgs with a registry entry match
 * on its slug; everything else matches on the slug derived from its
 * display name.
 *
 * With no slug, or a slug that matches nothing, the caller's first
 * host_admin membership wins (the overwhelmingly common single-org case).
 */
function pickMembership(
  me: AdminMe,
  slug: string | undefined,
): AdminMe["orgs"][number] | null {
  const hostAdminOrgs = me.orgs.filter((o) => o.role === "host_admin");
  if (hostAdminOrgs.length === 0) return null;
  if (slug) {
    const match = hostAdminOrgs.find(
      (o) => slugForOrgName(o.displayName) === slug,
    );
    if (match) return match;
  }
  return hostAdminOrgs[0];
}

/**
 * Resolve the org landing context for the current request, or redirect.
 *
 * Pass the [slug] route param to render that tenant; pass undefined from
 * the /org entry route to resolve whichever org the caller belongs to.
 * When the URL slug is not the tenant's canonical slug (a derived slug
 * where a registry entry exists, a stale bookmark, or another org's slug)
 * this redirects to the canonical URL rather than rendering, so the
 * address bar never disagrees with what is on screen.
 *
 * Never returns for a caller who should not be here — it redirects.
 */
export async function requireOrgContext(
  slug?: string,
): Promise<OrgContext> {
  const me = await fetchMe();
  if (!me) redirect(SIGNED_OUT);

  // Operators, plain members and membership-less accounts all belong
  // somewhere else. The employee landing page owns that decision.
  if (me.persona !== "host_admin") redirect(NOT_OUR_PERSONA);

  const membership = pickMembership(me, slug);
  if (!membership) redirect(NOT_OUR_PERSONA);

  const org = await fetchOrg(membership.orgId);
  if (!org) redirect(NOT_OUR_PERSONA);

  const tenant = resolveOrgTenant(org);
  if (slug !== tenant.slug) redirect(`/org/${tenant.slug}` as Route);

  return { email: me.email, org, tenant };
}

/**
 * The canonical landing URL for the current caller, or null if they are
 * not a host_admin. Used by /org to bounce into the right tenant without
 * rendering anything, and safe to call from any post-login destination
 * that wants to route personas.
 */
export async function orgLandingPathForSession(): Promise<Route | null> {
  const me = await fetchMe();
  if (!me || me.persona !== "host_admin") return null;
  const membership = pickMembership(me, undefined);
  if (!membership) return null;
  return `/org/${slugForOrgName(membership.displayName)}` as Route;
}
