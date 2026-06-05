import { Hono } from "hono";
import { SiteCreateInput, SiteUpdateInput } from "@straumvakt/shared/inputs/sites";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { resolveOrgScope } from "../../lib/auth/org-scope";
import {
  createSite,
  deleteSite,
  getSiteById,
  listAllSites,
  moveSiteToOrg,
  updateSite,
} from "../../repositories/sites";
import { z } from "zod";
import { listInstallationsBySite } from "../../repositories/installations";
import { listCircuitsBySite } from "../../repositories/circuits";
import { listSiteTree } from "../../repositories/site-tree";
import type { Env } from "../../bindings";

export const adminSites = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminSites.use("*", requireAdmin);

adminSites.get("/", requirePermission("platform.tenant.read"), async (c) => {
  const db = makePrisma(c.env);
  const orgScope = await resolveOrgScope(db, c.get("session"));
  const sites = await listAllSites(db, orgScope);
  return c.json({ sites });
});

adminSites.get("/tree", requirePermission("platform.tenant.read"), async (c) => {
  const db = makePrisma(c.env);
  const includeDecommissioned = c.req.query("includeDecommissioned") === "1";
  const orgScope = await resolveOrgScope(db, c.get("session"));
  // KEK is required to decrypt vendor credentials for the per-charger
  // API-active fetch. Without it the repo skips the Zaptec leg and
  // returns apiActive=null on every charger.
  const tree = await listSiteTree(db, c.env.OCPP_CRED_KEK, {
    includeDecommissioned,
    orgScope,
  });
  return c.json({ tree });
});

adminSites.post("/", requirePermission("site.write"), async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = SiteCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const site = await createSite(db, parsed.data);
  return c.json({ site }, 201);
});

adminSites.get("/:siteId", requirePermission("site.read"), async (c) => {
  const db = makePrisma(c.env);
  const orgScope = await resolveOrgScope(db, c.get("session"));
  const site = await getSiteById(db, c.req.param("siteId"), orgScope);
  if (!site) return c.json({ error: "not_found" }, 404);
  return c.json({ site });
});

adminSites.patch("/:siteId", requirePermission("site.write"), async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = SiteUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const site = await updateSite(db, c.req.param("siteId"), parsed.data);
  return c.json({ site });
});

adminSites.delete("/:siteId", requirePermission("site.delete"), async (c) => {
  const db = makePrisma(c.env);
  await deleteSite(db, c.req.param("siteId"));
  return c.json({ ok: true });
});

const MoveSiteBody = z.object({
  targetOrgId: z.string().uuid(),
});

// Cross-org move — destructive (cascade reassignment). Platform-only.
adminSites.post(
  "/:siteId/move",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = MoveSiteBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    const db = makePrisma(c.env);
    try {
      const result = await moveSiteToOrg(
        db,
        c.req.param("siteId"),
        parsed.data.targetOrgId,
        null,
      );
      return c.json({ result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "site_not_found") return c.json({ error: msg }, 404);
      if (msg === "target_org_not_found") return c.json({ error: msg }, 400);
      if (msg === "already_in_target_org") return c.json({ error: msg }, 400);
      throw err;
    }
  },
);

adminSites.get("/:siteId/circuits", requirePermission("site.read"), async (c) => {
  const db = makePrisma(c.env);
  const circuits = await listCircuitsBySite(db, c.req.param("siteId"));
  return c.json({ circuits });
});

adminSites.get("/:siteId/installations", requirePermission("site.read"), async (c) => {
  const db = makePrisma(c.env);
  const installations = await listInstallationsBySite(db, c.req.param("siteId"));
  return c.json({ installations });
});
