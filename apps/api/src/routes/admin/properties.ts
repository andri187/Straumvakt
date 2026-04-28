import { Hono } from "hono";
import { PropertyCreateInput, PropertyUpdateInput } from "@straumvakt/shared/inputs/properties";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import {
  createProperty,
  getPropertyById,
  listAllProperties,
  updateProperty,
} from "../../repositories/properties";
import type { Env } from "../../bindings";

export const adminProperties = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminProperties.use("*", requireAdmin);

adminProperties.get("/", async (c) => {
  const db = makePrisma(c.env);
  const properties = await listAllProperties(db);
  return c.json({ properties });
});

adminProperties.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = PropertyCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const property = await createProperty(db, parsed.data);
  return c.json({ property }, 201);
});

adminProperties.get("/:id", async (c) => {
  const db = makePrisma(c.env);
  const property = await getPropertyById(db, c.req.param("id"));
  if (!property) return c.json({ error: "not_found" }, 404);
  return c.json({ property });
});

adminProperties.patch("/:id", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = PropertyUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const property = await updateProperty(db, c.req.param("id"), parsed.data);
  return c.json({ property });
});
