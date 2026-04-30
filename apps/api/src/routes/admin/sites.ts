import { Hono } from "hono";
import { SiteCreateInput, SiteUpdateInput } from "@straumvakt/shared/inputs/sites";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import {
  createSite,
  deleteSite,
  getSiteById,
  listAllSites,
  updateSite,
} from "../../repositories/sites";
import { listInstallationsBySite } from "../../repositories/installations";
import { listCircuitsBySite } from "../../repositories/circuits";
import { listSiteTree } from "../../repositories/site-tree";
import type { Env } from "../../bindings";

export const adminSites = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminSites.use("*", requireAdmin);

adminSites.get("/", async (c) => {
  const db = makePrisma(c.env);
  const sites = await listAllSites(db);
  return c.json({ sites });
});

adminSites.get("/tree", async (c) => {
  const db = makePrisma(c.env);
  // KEK is required to decrypt vendor credentials for the per-charger
  // API-active fetch. Without it the repo skips the Zaptec leg and
  // returns apiActive=null on every charger.
  const tree = await listSiteTree(db, c.env.OCPP_CRED_KEK);
  return c.json({ tree });
});

adminSites.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = SiteCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const site = await createSite(db, parsed.data);
  return c.json({ site }, 201);
});

adminSites.get("/:siteId", async (c) => {
  const db = makePrisma(c.env);
  const site = await getSiteById(db, c.req.param("siteId"));
  if (!site) return c.json({ error: "not_found" }, 404);
  return c.json({ site });
});

adminSites.patch("/:siteId", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = SiteUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const site = await updateSite(db, c.req.param("siteId"), parsed.data);
  return c.json({ site });
});

adminSites.delete("/:siteId", async (c) => {
  const db = makePrisma(c.env);
  await deleteSite(db, c.req.param("siteId"));
  return c.json({ ok: true });
});

adminSites.get("/:siteId/circuits", async (c) => {
  const db = makePrisma(c.env);
  const circuits = await listCircuitsBySite(db, c.req.param("siteId"));
  return c.json({ circuits });
});

adminSites.get("/:siteId/installations", async (c) => {
  const db = makePrisma(c.env);
  const installations = await listInstallationsBySite(db, c.req.param("siteId"));
  return c.json({ installations });
});
