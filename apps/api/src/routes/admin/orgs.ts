import { Hono } from "hono";
import { OrgInputs } from "@straumvakt/shared";
import { MembershipCreateInput } from "@straumvakt/shared/inputs/users";
import { makePrisma } from "../../lib/prisma";
import { makeDrizzle } from "../../lib/drizzle";
import { UniqueViolationError } from "../../domains/identity/repositories/errors";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  createOrg,
  getOrgById,
  listOrgs,
  updateOrg,
} from "../../repositories/orgs";
import { listPropertiesByOrg } from "../../repositories/properties";
import { listSitesByOrg } from "../../repositories/sites";
import { listInstallationsByOrg } from "../../repositories/installations";
import { listAllChargers } from "../../repositories/chargers";
import { listSiteTree } from "../../repositories/site-tree";
import { listOrgDrivers, listOrgAgreements, getOrgSessionSummary } from "../../repositories/host-views";
import { getSessionFullDetail } from "../../repositories/session-full-detail";
import {
  listOrgDriverGroups,
  listOrgDriverInvites,
  createDriverInvite,
} from "../../repositories/host-invites";
import { sessionUserId } from "../../lib/auth/require-permission";
import { z } from "zod";
import {
  listContractsByOrg,
} from "../../repositories/contracts";
import { getOrgTariffChainSummary } from "../../repositories/org-tariff-chain";
import { listFamilyGroupsByOrg } from "../../domains/identity/repositories/family-groups";
import {
  addMembership,
  listOrgMemberships,
  listUsersByOrg,
} from "../../domains/identity/repositories/users";
import type { Env } from "../../bindings";

export const adminOrgs = new Hono<{ Bindings: Env; Variables: AuthVars }>();

// Sprint 4 milestone 4.3 — five routes migrated to requirePermission
// as proof-of-concept for the M2 partial sweep. requireAdmin still
// gates session loading at the router level; requirePermission then
// checks the verb. Bootstrap admin (single-user, env-var) gets god-
// mode through the middleware until Sprint 5 multi-user lands. See
// docs/notes/2026-05-02-permission-hierarchy-review.md for the
// hierarchy concerns flagged for Sprint 4.4 / 9 review.
adminOrgs.use("*", requireAdmin);

// Cross-tenant list — only platform staff (with platform.tenant.read)
// see every org. Customer admins should hit GET /:id for their own org.
adminOrgs.get(
  "/",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const includeArchived = c.req.query("includeArchived") === "true";
    const db = makePrisma(c.env);
    const orgs = await listOrgs(db, { includeArchived });
    return c.json({ orgs });
  },
);

// Creating a new org is a platform-staff action — the platform
// onboards new customers; customer admins don't bootstrap their own
// org via this surface.
adminOrgs.post(
  "/",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = OrgInputs.OrgCreateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const org = await createOrg(db, parsed.data);
    return c.json({ org }, 201);
  },
);

// Per-org read — members of the org with org.read OR platform staff
// (via platform.tenant.read expansion).
adminOrgs.get(
  "/:id",
  requirePermission("org.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const org = await getOrgById(db, c.req.param("id"));
    if (!org) return c.json({ error: "not_found" }, 404);
    return c.json({ org });
  },
);

// Per-org write — owner-level membership OR platform.tenant.write.
adminOrgs.patch(
  "/:id",
  requirePermission("org.write", { orgIdParam: "id" }),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = OrgInputs.OrgUpdateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const org = await updateOrg(db, c.req.param("id"), parsed.data);
    return c.json({ org });
  },
);

// Archive is destructive — owner-level OR platform.tenant.delete.
adminOrgs.post(
  "/:id/archive",
  requirePermission("org.write", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const updated = await db.organization.update({
      where: { id: c.req.param("id") },
      data: { status: "archived" },
    });
    return c.json({ org: { id: updated.id, status: updated.status } });
  },
);

// Nested org endpoints — used by create forms in the UI to populate
// dropdowns scoped to a specific org. Each maps to the read-verb of
// the resource being listed; member-management uses member.* verbs.

adminOrgs.get(
  "/:id/sites",
  requirePermission("site.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const sites = await listSitesByOrg(db, c.req.param("id"));
    return c.json({ sites });
  },
);

// Installations are site-level children; site.read is the appropriate
// gate (no separate installation.read verb in the catalogue today).
adminOrgs.get(
  "/:id/installations",
  requirePermission("site.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const installations = await listInstallationsByOrg(db, c.req.param("id"));
    return c.json({ installations });
  },
);

// Host-reachable chargers list — the platform-only /api/admin/chargers
// list (platform.tenant.read) isn't reachable by a host_admin, so this
// orgIdParam route lets a host read their own org's chargers. Membership
// is validated by requirePermission(charger.read, orgIdParam); data is
// scoped to that org via the org-scope helper. No resolution change.
adminOrgs.get(
  "/:id/chargers",
  requirePermission("charger.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const includeDecommissioned = c.req.query("includeDecommissioned") === "true";
    const chargers = await listAllChargers(db, {
      includeDecommissioned,
      kek: c.env.OCPP_CRED_KEK,
      orgScope: { all: false, orgIds: [c.req.param("id")] },
    });
    return c.json({ chargers });
  },
);

// Host-reachable site tree — the org's Site → Installation → Circuit →
// Charger hierarchy with lifetime-kWh + online/offline aggregates. Same
// builder as the operator /sites tree, scoped to this org. charger.read +
// orgIdParam (host_admin has charger.read via its bundle).
adminOrgs.get(
  "/:id/sites/tree",
  requirePermission("charger.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const includeDecommissioned = c.req.query("includeDecommissioned") === "true";
    const tree = await listSiteTree(db, c.env.OCPP_CRED_KEK, {
      includeDecommissioned,
      orgScope: { all: false, orgIds: [c.req.param("id")] },
    });
    return c.json({ tree });
  },
);

// Host-reachable drivers — members of the org's driver groups. member.read +
// orgIdParam (host_admin has member.read via its bundle).
adminOrgs.get(
  "/:id/drivers",
  requirePermission("member.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const drivers = await listOrgDrivers(db, c.req.param("id"));
    return c.json({ drivers });
  },
);

// ── ADR 0028 — host↔driver INVITE loop ──────────────────────────────────
//
// The host_admin picks one of their org's DriverGroups, enters a driver
// email, and mints a single-use invite code. Gated on member.read (list)
// and member.invite (create) — both in HOST_ADMIN_BUNDLE. The orgIdParam
// guard plus DriverGroup.ownerOrgId === :id check (in the repo) stop a
// host_admin for org A from inviting into org B's group.

// Driver groups the org owns — the pick list for "invite into which group".
adminOrgs.get(
  "/:id/driver-groups",
  requirePermission("member.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const groups = await listOrgDriverGroups(db, c.req.param("id"));
    return c.json({ groups });
  },
);

// Pending/used driver invites for the org's groups.
adminOrgs.get(
  "/:id/driver-invites",
  requirePermission("member.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const invites = await listOrgDriverInvites(db, c.req.param("id"));
    return c.json({ invites });
  },
);

// Mint a driver invite into one of the org's groups.
const DriverInviteCreateBody = z.object({
  driverGroupId: z.string().uuid(),
  email: z.string().email().max(200),
  ttlHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30) // 30 days max
    .optional(),
});

adminOrgs.post(
  "/:id/driver-invites",
  requirePermission("member.invite", { orgIdParam: "id" }),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = DriverInviteCreateBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    // invitedByUserId comes from the session. Bootstrap admin (no userId)
    // has god-mode through requirePermission but carries no real User row;
    // attribute the invite to null-safe value by requiring a real userId.
    const session = c.get("session");
    const invitedByUserId = sessionUserId(session);
    if (!invitedByUserId) {
      return c.json(
        { error: "session_missing_userid_relogin_required" },
        401,
      );
    }
    const db = makePrisma(c.env);
    const result = await createDriverInvite(db, {
      orgId: c.req.param("id"),
      driverGroupId: parsed.data.driverGroupId,
      email: parsed.data.email,
      invitedByUserId,
      ttlHours: parsed.data.ttlHours ?? 168, // 7d default (printed/shared code)
    });
    if (!result.ok) {
      const status =
        result.reason === "driver_group_not_found"
          ? 404
          : result.reason === "driver_group_wrong_org"
            ? 403
            : 400;
      return c.json({ error: result.reason }, status);
    }
    return c.json({ invite: result.invite }, 201);
  },
);

// Host-reachable agreements — agreements.agreements the org is party to.
// Gated on billing.read: it's the host's own commercial data and host_admin
// has billing.read (not contract.read, which is manager/finance and up).
adminOrgs.get(
  "/:id/agreements",
  requirePermission("billing.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const agreements = await listOrgAgreements(db, c.req.param("id"));
    return c.json({ agreements });
  },
);

// Host-reachable session summary — aggregates + recent activity for the
// dashboard. billing.read (host_admin has it); org-scoped by the param.
adminOrgs.get(
  "/:id/sessions",
  requirePermission("billing.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const summary = await getOrgSessionSummary(db, c.req.param("id"), new Date());
    return c.json({ summary });
  },
);

// Full enriched detail for ONE session under this org. Reuses the
// operator-grade getSessionFullDetail repo, gated billing.read (host_admin
// has it) and org-scoped by the :id param. Tenant isolation: if the
// session doesn't exist OR belongs to another org we return 404 (never
// leak a cross-tenant session). includeRaw omitted — heavy raw blobs are
// operator-only via the /admin/billing/sessions/:id/full route.
adminOrgs.get(
  "/:id/sessions/:sessionId",
  requirePermission("billing.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const detail = await getSessionFullDetail(db, c.req.param("sessionId"));
    if (!detail || detail.orgId !== c.req.param("id")) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ session: detail });
  },
);

adminOrgs.get(
  "/:id/contracts",
  requirePermission("contract.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const contracts = await listContractsByOrg(db, c.req.param("id"));
    return c.json({ contracts });
  },
);

// Sprint 8.10 — per-org Tariff chain summary. Walks every Site +
// Installation under the org and resolves the bound DSO + retailer
// tariff for each. Operator-facing answer to "what is each site
// under this org being charged?".
adminOrgs.get(
  "/:id/tariff-chain",
  requirePermission("contract.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const summary = await getOrgTariffChainSummary(db, c.req.param("id"));
    return c.json({ summary });
  },
);

// Family groups are billing-side metadata; contract.read is the
// closest verb in the current catalogue.
adminOrgs.get(
  "/:id/family-groups",
  requirePermission("contract.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makeDrizzle(c.env);
    const familyGroups = await listFamilyGroupsByOrg(db, c.req.param("id"));
    return c.json({ familyGroups });
  },
);

adminOrgs.get(
  "/:id/properties",
  requirePermission("property.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makePrisma(c.env);
    const properties = await listPropertiesByOrg(db, c.req.param("id"));
    return c.json({ properties });
  },
);

adminOrgs.get(
  "/:id/users",
  requirePermission("member.read", { orgIdParam: "id" }),
  async (c) => {
    // Drizzle: the three identity reads below are ported. Everything else
    // on this route file is still Prisma — orgs itself has not been moved.
    const db = makeDrizzle(c.env);
    const users = await listUsersByOrg(db, c.req.param("id"));
    return c.json({ users });
  },
);

adminOrgs.get(
  "/:id/memberships",
  requirePermission("member.read", { orgIdParam: "id" }),
  async (c) => {
    const db = makeDrizzle(c.env);
    const memberships = await listOrgMemberships(db, c.req.param("id"));
    return c.json({ memberships });
  },
);

adminOrgs.post(
  "/:id/memberships",
  requirePermission("member.invite", { orgIdParam: "id" }),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = MembershipCreateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makeDrizzle(c.env);
    try {
      const membership = await addMembership(db, c.req.param("id"), parsed.data.userId, parsed.data.role);
      return c.json({ membership }, 201);
    } catch (err) {
      if (err instanceof UniqueViolationError) {
        return c.json({ error: "already_member" }, 409);
      }
      throw err;
    }
  },
);
