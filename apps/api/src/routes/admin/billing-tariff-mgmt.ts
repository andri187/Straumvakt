// Admin billing sub-router — TariffDefinition create/edit/clone/lifecycle.
// Sprint 9 — Track C.
//
// Mounted by billing.ts at /api/admin/billing/tariffs-mgmt.
// Auth: requireAdmin already applied by the parent adminBilling router.
//
// TariffDefinition is load-bearing for session-stop cost resolution (Rule 5).
// The Rule 5 stops live in the repository layer AND are reinforced here:
//
//   - Active tariffs: only display_name mutable via PATCH
//     (anything else → 400 active_immutable)
//   - Status transitions ONLY via dedicated publish/retire endpoints
//     (not via generic PATCH status)
//   - Resolvers (tariff/compute-session-cost, tariff/resolve-tariff*) are
//     NOT touched by this file. This file writes the catalogue only.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  createTariff,
  patchTariff,
  cloneTariff,
  publishTariff,
  retireTariff,
} from "../../repositories/billing-tariff-mgmt";
import { CreateTariffSchema, PatchTariffSchema } from "../../lib/billing/tariff-zod";
import type { AuthVars } from "../../lib/auth-middleware";
import type { Env } from "../../bindings";

export const tariffMgmtRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/billing/tariffs-mgmt
//
// Create a new draft TariffDefinition. Status is always 'draft'.
// ─────────────────────────────────────────────────────────────────────────────

tariffMgmtRouter.post(
  "/",
  requirePermission("billing.write"),
  async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = CreateTariffSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", issues: parsed.error.issues },
        400,
      );
    }
    const db = makePrisma(c.env);
    const tariff = await createTariff(db, parsed.data);
    return c.json({ tariff }, 201);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/billing/tariffs-mgmt/:id
//
// Edit a TariffDefinition.
//   - draft: any field in PatchTariffSchema
//   - active: only display_name; anything else → 400 active_immutable
//   - retired: nothing → 400 retired_immutable
// ─────────────────────────────────────────────────────────────────────────────

tariffMgmtRouter.patch(
  "/:id",
  requirePermission("billing.write"),
  async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = PatchTariffSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", issues: parsed.error.issues },
        400,
      );
    }
    const db = makePrisma(c.env);
    const result = await patchTariff(db, c.req.param("id"), parsed.data);

    if ("code" in result) {
      if (result.code === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      if (result.code === "active_immutable") {
        return c.json(
          {
            error: "active_immutable",
            suggestion: "clone_then_edit",
            message:
              "Active tariffs are immutable for resolution fields. Only display_name may be changed. Clone this tariff to create an editable draft.",
          },
          400,
        );
      }
      if (result.code === "retired_immutable") {
        return c.json(
          {
            error: "retired_immutable",
            message: "Retired tariffs cannot be modified.",
          },
          400,
        );
      }
    }

    return c.json({ tariff: result });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/billing/tariffs-mgmt/:id/clone
//
// Duplicate an existing tariff to a new draft.
// ─────────────────────────────────────────────────────────────────────────────

tariffMgmtRouter.post(
  "/:id/clone",
  requirePermission("billing.write"),
  async (c) => {
    const db = makePrisma(c.env);
    const result = await cloneTariff(db, c.req.param("id"));

    if ("code" in result) {
      if (result.code === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
    }

    return c.json({ tariff: result }, 201);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/billing/tariffs-mgmt/:id/publish
//
// Transition draft → active.
// Sets valid_from = now() if the current valid_from is in the past.
//
// TODO ADR 0021: chain-retire prior active version of same family_code
// (family_code column not yet added — tracked in repo layer).
// ─────────────────────────────────────────────────────────────────────────────

tariffMgmtRouter.post(
  "/:id/publish",
  requirePermission("billing.write"),
  async (c) => {
    const db = makePrisma(c.env);
    const result = await publishTariff(db, c.req.param("id"));

    if ("code" in result) {
      if (result.code === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      if (result.code === "already_active") {
        return c.json(
          {
            error: "already_active",
            message: "Tariff is already active.",
          },
          400,
        );
      }
      if (result.code === "not_draft") {
        return c.json(
          {
            error: "not_draft",
            message: "Only draft tariffs can be published.",
          },
          400,
        );
      }
    }

    return c.json({ tariff: result });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/billing/tariffs-mgmt/:id/retire
//
// Transition active → retired, or draft → retired (discard).
// Sets valid_until = now(). Returns binding-count warning (does not block).
// ─────────────────────────────────────────────────────────────────────────────

tariffMgmtRouter.post(
  "/:id/retire",
  requirePermission("billing.write"),
  async (c) => {
    const db = makePrisma(c.env);
    const result = await retireTariff(db, c.req.param("id"));

    if ("code" in result) {
      if (result.code === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      if (result.code === "already_retired") {
        return c.json(
          {
            error: "already_retired",
            message: "Tariff is already retired.",
          },
          400,
        );
      }
    }

    return c.json({
      tariff: result.tariff,
      warning: result.warning,
      bindingCounts: result.bindingCounts,
    });
  },
);
