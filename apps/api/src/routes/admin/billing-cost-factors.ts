// billing.cost_factors CRUD — Sprint 9 Track A.
//
// Endpoints:
//   GET    /                          — list catalogue (summary, grouped by anchorTier)
//   POST   /                          — create new factor
//   PATCH  /:id                       — edit displayName / description / defaults
//                                       code and anchorTier are REJECTED (immutable)
//   POST   /:id/deactivate            — set status → archived
//   POST   /:id/reactivate            — set status → active
//
// All mutating routes require billing.write. The deactivate endpoint
// returns an activeTariffCount warning so the UI can surface it.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  listCostFactors,
  createCostFactor,
  updateCostFactor,
  deactivateCostFactor,
  reactivateCostFactor,
} from "../../repositories/billing-cost-factors";
import {
  createCostFactorSchema,
  updateCostFactorSchema,
} from "../../lib/billing/cost-factor-zod";
import type { AuthVars } from "../../lib/auth-middleware";
import type { Env } from "../../bindings";

export const costFactorsRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

// ─────────────────────────────────────────────────────────────────────────────
// GET / — catalogue summary
// ─────────────────────────────────────────────────────────────────────────────

costFactorsRouter.get("/", requirePermission("billing.read"), async (c) => {
  const db = makePrisma(c.env);
  const summary = await listCostFactors(db);
  return c.json(summary);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST / — create new factor
// ─────────────────────────────────────────────────────────────────────────────

costFactorsRouter.post("/", requirePermission("billing.write"), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json", message: "Request body must be valid JSON" }, 400);
  }

  const parsed = createCostFactorSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation_error",
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      },
      422,
    );
  }

  const db = makePrisma(c.env);

  // Check code uniqueness before hitting DB unique constraint.
  const existing = await db.costFactor.findUnique({
    where: { code: parsed.data.code },
    select: { id: true },
  });
  if (existing) {
    return c.json(
      {
        error: "conflict",
        message: `A cost factor with code "${parsed.data.code}" already exists.`,
      },
      409,
    );
  }

  const factor = await createCostFactor(db, parsed.data);
  return c.json({ factor }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id — edit mutable fields
// ─────────────────────────────────────────────────────────────────────────────

costFactorsRouter.patch("/:id", requirePermission("billing.write"), async (c) => {
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json", message: "Request body must be valid JSON" }, 400);
  }

  // Reject if caller included immutable fields — surface a clear error.
  const raw = body as Record<string, unknown>;
  if ("code" in raw) {
    return c.json(
      {
        error: "immutable_field",
        message:
          "code cannot be changed on an existing factor. Create a new factor with the desired code instead.",
        field: "code",
      },
      422,
    );
  }
  if ("anchorTier" in raw) {
    return c.json(
      {
        error: "immutable_field",
        message:
          "anchorTier cannot be changed on an existing factor. Create a new factor with the desired anchorTier instead.",
        field: "anchorTier",
      },
      422,
    );
  }

  const parsed = updateCostFactorSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation_error",
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      },
      422,
    );
  }

  const db = makePrisma(c.env);
  const factor = await updateCostFactor(db, id, parsed.data);
  if (!factor) {
    return c.json({ error: "not_found", message: `Cost factor ${id} not found` }, 404);
  }

  return c.json({ factor });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/deactivate — set status → archived
//
// Returns activeTariffCount so the UI can show a warning when the factor
// is still referenced by active TariffDefinitions. Deactivation is not
// blocked — only warned.
// ─────────────────────────────────────────────────────────────────────────────

costFactorsRouter.post(
  "/:id/deactivate",
  requirePermission("billing.write"),
  async (c) => {
    const id = c.req.param("id");
    const db = makePrisma(c.env);
    const result = await deactivateCostFactor(db, id);
    if (!result) {
      return c.json({ error: "not_found", message: `Cost factor ${id} not found` }, 404);
    }

    return c.json({
      factor: result.factor,
      activeTariffCount: result.activeTariffCount,
      ...(result.activeTariffCount > 0 && {
        warning: `This factor is still referenced by ${result.activeTariffCount} active tariff${result.activeTariffCount !== 1 ? "s" : ""}. Those tariffs will continue to function but the factor cannot be assigned to new tariffs while archived.`,
      }),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/reactivate — set status → active
// ─────────────────────────────────────────────────────────────────────────────

costFactorsRouter.post(
  "/:id/reactivate",
  requirePermission("billing.write"),
  async (c) => {
    const id = c.req.param("id");
    const db = makePrisma(c.env);
    const factor = await reactivateCostFactor(db, id);
    if (!factor) {
      return c.json({ error: "not_found", message: `Cost factor ${id} not found` }, 404);
    }
    return c.json({ factor });
  },
);
