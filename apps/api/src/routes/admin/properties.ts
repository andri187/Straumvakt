import { Hono } from "hono";
import { PropertyCreateInput, PropertyUpdateInput } from "@straumvakt/shared/inputs/properties";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { resolveOrgScope } from "../../lib/auth/org-scope";
import {
  createProperty,
  deleteProperty,
  getPropertyById,
  listAllProperties,
  updateProperty,
} from "../../repositories/properties";
import type { Env } from "../../bindings";

export const adminProperties = new Hono<{ Bindings: Env; Variables: AuthVars }>();

// Sprint 4 / ADR 0014 milestone 4.4 — verb-gated. Sub-resource routes
// (GET/PATCH/DELETE /:id) use the bare requirePermission(verb) form
// which checks only platform-side perms today; Sprint 5 retrofits a
// resource-lookup so org members can hit them too. Bootstrap admin
// passes through god-mode regardless.
adminProperties.use("*", requireAdmin);

adminProperties.get(
  "/",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const orgScope = await resolveOrgScope(c.env, c.get("session"));
    const properties = await listAllProperties(db, orgScope);
    return c.json({ properties });
  },
);

adminProperties.post(
  "/",
  requirePermission("property.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = PropertyCreateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const property = await createProperty(db, parsed.data);
    return c.json({ property }, 201);
  },
);

adminProperties.get(
  "/:id",
  requirePermission("property.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const orgScope = await resolveOrgScope(c.env, c.get("session"));
    const property = await getPropertyById(db, c.req.param("id"), orgScope);
    if (!property) return c.json({ error: "not_found" }, 404);
    return c.json({ property });
  },
);

adminProperties.patch(
  "/:id",
  requirePermission("property.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = PropertyUpdateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const property = await updateProperty(db, c.req.param("id"), parsed.data);
    return c.json({ property });
  },
);

adminProperties.delete(
  "/:id",
  requirePermission("property.delete"),
  async (c) => {
    const db = makePrisma(c.env);
    await deleteProperty(db, c.req.param("id"));
    return c.json({ ok: true });
  },
);
