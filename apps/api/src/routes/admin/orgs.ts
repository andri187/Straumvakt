import { Hono } from "hono";
import { OrgInputs } from "@straumvakt/shared";
import { makePrisma } from "../../lib/prisma";
import { createOrg, getOrgById, listOrgs, updateOrg } from "../../repositories/orgs";
import type { Env } from "../../bindings";

export const adminOrgs = new Hono<{ Bindings: Env }>();

adminOrgs.get("/", async (c) => {
  const includeArchived = c.req.query("includeArchived") === "true";
  const db = makePrisma(c.env);
  const orgs = await listOrgs(db, { includeArchived });
  return c.json({ orgs });
});

adminOrgs.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = OrgInputs.OrgCreateInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
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
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const db = makePrisma(c.env);
  const org = await updateOrg(db, c.req.param("id"), parsed.data);
  return c.json({ org });
});
