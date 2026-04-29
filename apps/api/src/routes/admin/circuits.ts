import { Hono } from "hono";
import { CircuitCreateInput, CircuitUpdateInput } from "@straumvakt/shared/inputs/circuits";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import {
  createCircuit,
  deleteCircuit,
  getCircuitById,
  listAllCircuits,
  updateCircuit,
} from "../../repositories/circuits";
import type { Env } from "../../bindings";

export const adminCircuits = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminCircuits.use("*", requireAdmin);

adminCircuits.get("/", async (c) => {
  const db = makePrisma(c.env);
  const circuits = await listAllCircuits(db);
  return c.json({ circuits });
});

adminCircuits.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = CircuitCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const circuit = await createCircuit(db, parsed.data);
  return c.json({ circuit }, 201);
});

adminCircuits.get("/:id", async (c) => {
  const db = makePrisma(c.env);
  const circuit = await getCircuitById(db, c.req.param("id"));
  if (!circuit) return c.json({ error: "not_found" }, 404);
  return c.json({ circuit });
});

adminCircuits.patch("/:id", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = CircuitUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const circuit = await updateCircuit(db, c.req.param("id"), parsed.data);
  return c.json({ circuit });
});

adminCircuits.delete("/:id", async (c) => {
  const db = makePrisma(c.env);
  await deleteCircuit(db, c.req.param("id"));
  return c.json({ ok: true });
});
