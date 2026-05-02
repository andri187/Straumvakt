import { Hono } from "hono";
import { InstallationCreateInput, InstallationUpdateInput } from "@straumvakt/shared/inputs/installations";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  createInstallation,
  deleteInstallation,
  getInstallationById,
  listAllInstallations,
  listVendors,
  updateInstallation,
} from "../../repositories/installations";
import type { Env } from "../../bindings";

export const adminInstallations = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminInstallations.use("*", requireAdmin);

// Installations are site-level children; no separate installation.*
// verb in the catalogue. site.read/write maps cleanly.
adminInstallations.get(
  "/",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const [installations, vendors] = await Promise.all([
      listAllInstallations(db),
      listVendors(db),
    ]);
    return c.json({ installations, vendors });
  },
);

adminInstallations.post(
  "/",
  requirePermission("site.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = InstallationCreateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const installation = await createInstallation(db, parsed.data);
    return c.json({ installation }, 201);
  },
);

adminInstallations.get(
  "/:id",
  requirePermission("site.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const installation = await getInstallationById(db, c.req.param("id"));
    if (!installation) return c.json({ error: "not_found" }, 404);
    return c.json({ installation });
  },
);

adminInstallations.patch(
  "/:id",
  requirePermission("site.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = InstallationUpdateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const installation = await updateInstallation(db, c.req.param("id"), parsed.data);
    return c.json({ installation });
  },
);

adminInstallations.delete(
  "/:id",
  requirePermission("site.delete"),
  async (c) => {
    const db = makePrisma(c.env);
    await deleteInstallation(db, c.req.param("id"));
    return c.json({ ok: true });
  },
);
