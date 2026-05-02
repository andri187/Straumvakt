import { Hono } from "hono";
import { OrgInputs } from "@straumvakt/shared";
import { MembershipCreateInput } from "@straumvakt/shared/inputs/users";
import { makePrisma } from "../../lib/prisma";
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
import { listContractsByOrg } from "../../repositories/contracts";
import { listFamilyGroupsByOrg } from "../../repositories/family-groups";
import {
  addMembership,
  listOrgMemberships,
  listUsersByOrg,
} from "../../repositories/users";
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
// dropdowns scoped to a specific org.

adminOrgs.get("/:id/sites", async (c) => {
  const db = makePrisma(c.env);
  const sites = await listSitesByOrg(db, c.req.param("id"));
  return c.json({ sites });
});

adminOrgs.get("/:id/installations", async (c) => {
  const db = makePrisma(c.env);
  const installations = await listInstallationsByOrg(db, c.req.param("id"));
  return c.json({ installations });
});

adminOrgs.get("/:id/contracts", async (c) => {
  const db = makePrisma(c.env);
  const contracts = await listContractsByOrg(db, c.req.param("id"));
  return c.json({ contracts });
});

adminOrgs.get("/:id/family-groups", async (c) => {
  const db = makePrisma(c.env);
  const familyGroups = await listFamilyGroupsByOrg(db, c.req.param("id"));
  return c.json({ familyGroups });
});

adminOrgs.get("/:id/properties", async (c) => {
  const db = makePrisma(c.env);
  const properties = await listPropertiesByOrg(db, c.req.param("id"));
  return c.json({ properties });
});

adminOrgs.get("/:id/users", async (c) => {
  const db = makePrisma(c.env);
  const users = await listUsersByOrg(db, c.req.param("id"));
  return c.json({ users });
});

adminOrgs.get("/:id/memberships", async (c) => {
  const db = makePrisma(c.env);
  const memberships = await listOrgMemberships(db, c.req.param("id"));
  return c.json({ memberships });
});

adminOrgs.post("/:id/memberships", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = MembershipCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  try {
    const membership = await addMembership(db, c.req.param("id"), parsed.data.userId, parsed.data.role);
    return c.json({ membership }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return c.json({ error: "already_member" }, 409);
    }
    throw err;
  }
});
