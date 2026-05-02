import { Hono } from "hono";
import { OrgInputs } from "@straumvakt/shared";
import { MembershipCreateInput } from "@straumvakt/shared/inputs/users";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
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

adminOrgs.use("*", requireAdmin);

adminOrgs.get("/", async (c) => {
  const includeArchived = c.req.query("includeArchived") === "true";
  const db = makePrisma(c.env);
  const orgs = await listOrgs(db, { includeArchived });
  return c.json({ orgs });
});

adminOrgs.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = OrgInputs.OrgCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const org = await createOrg(db, parsed.data);
  return c.json({ org }, 201);
});

adminOrgs.get("/:id", async (c) => {
  const db = makePrisma(c.env);
  const org = await getOrgById(db, c.req.param("id"));
  if (!org) return c.json({ error: "not_found" }, 404);
  return c.json({ org });
});

adminOrgs.patch("/:id", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = OrgInputs.OrgUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const org = await updateOrg(db, c.req.param("id"), parsed.data);
  return c.json({ org });
});

adminOrgs.post("/:id/archive", async (c) => {
  const db = makePrisma(c.env);
  const updated = await db.organization.update({
    where: { id: c.req.param("id") },
    data: { status: "archived" },
  });
  return c.json({ org: { id: updated.id, status: updated.status } });
});

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
