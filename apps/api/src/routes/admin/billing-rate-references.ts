// Admin billing sub-router — RateReference CRUD (Sprint 9, ADR 0019 Phase 1).
//
// Mounted by billing.ts at /api/admin/billing/rate-references.
// Auth: requireAdmin already applied by parent adminBilling router.
//
// RateReference is load-bearing for session-stop cost resolution (Rule 5).
// The key invariant is that price resolution fields (priceMinor, effectiveFrom,
// effectiveUntil, basis) on a currently-active row are IMMUTABLE. Attempts
// to mutate them are rejected with { error: "active_row_immutable" }.
//
// "Stage new version" is the correct path for rate changes. It auto-closes
// the previous row's effectiveUntil in a single Prisma transaction.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  listRateReferences,
  getRateReference,
  createRateReference,
  patchRateReference,
  retireRateReference,
} from "../../repositories/billing-rate-references";
import {
  CreateRateReferenceSchema,
  PatchRateReferenceSchema,
} from "../../lib/billing/rate-reference-zod";
import type { AuthVars } from "../../lib/auth-middleware";
import type { Env } from "../../bindings";

export const rateReferencesRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/billing/rate-references/cost-factors
//
// Returns the agreements.cost_factors catalog (for form select options).
// Placed before /:id to avoid routing ambiguity.
// ─────────────────────────────────────────────────────────────────────────────

rateReferencesRouter.get(
  "/cost-factors",
  requirePermission("billing.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const factors = await db.agreementCostFactor.findMany({
      where: { status: "active" },
      orderBy: { code: "asc" },
      select: { id: true, code: true, displayNameEn: true },
    });
    return c.json({ costFactors: factors });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/billing/rate-references
//
// Returns the full rate book catalogue, grouped by code into
// current / staged / expired buckets.
// ─────────────────────────────────────────────────────────────────────────────

rateReferencesRouter.get(
  "/",
  requirePermission("billing.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const summary = await listRateReferences(db);
    return c.json(summary);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/billing/rate-references/:id
// ─────────────────────────────────────────────────────────────────────────────

rateReferencesRouter.get(
  "/:id",
  requirePermission("billing.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const row = await getRateReference(db, c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ rateReference: row });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/billing/rate-references
//
// Stage a new version. If a currently-active row exists for the same code,
// its effectiveUntil is auto-closed to the new version's effectiveFrom in
// a single transaction.
// ─────────────────────────────────────────────────────────────────────────────

rateReferencesRouter.post(
  "/",
  requirePermission("billing.write"),
  async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = CreateRateReferenceSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "validation_error",
          issues: parsed.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
        400,
      );
    }

    const db = makePrisma(c.env);

    try {
      const row = await createRateReference(db, parsed.data);
      return c.json({ rateReference: row }, 201);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "active_row_would_overlap") {
        return c.json(
          {
            error: "active_row_would_overlap",
            message: e.message,
            suggestion: "stage_new_version_with_future_date",
          },
          400,
        );
      }
      if (e.code === "validation_error") {
        return c.json({ error: "validation_error", message: e.message }, 400);
      }
      throw err;
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/billing/rate-references/:id
//
// Edit notes / supplierOrgId on any row. Also allows effectiveUntil changes
// on staged (future) rows only.
//
// Rule 5: price_minor, effective_from, basis, costFactorId, currency, and
// vatRatePct are NOT patchable via this endpoint. Attempts to send those
// fields are ignored — callers should stage new versions for rate changes.
// ─────────────────────────────────────────────────────────────────────────────

rateReferencesRouter.patch(
  "/:id",
  requirePermission("billing.write"),
  async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = PatchRateReferenceSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "validation_error",
          issues: parsed.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
        400,
      );
    }

    const db = makePrisma(c.env);
    const result = await patchRateReference(db, c.req.param("id"), parsed.data);

    if ("errorCode" in result) {
      if (result.errorCode === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      if (result.errorCode === "active_row_immutable") {
        return c.json(
          {
            error: "active_row_immutable",
            suggestion: result.suggestion,
            message:
              "Resolution fields (price, dates) cannot be changed on an active row. Stage a new version instead.",
          },
          400,
        );
      }
      if (result.errorCode === "validation_error") {
        return c.json({ error: "validation_error", message: result.message }, 400);
      }
    }

    return c.json({ rateReference: result });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/billing/rate-references/:id/retire
//
// Sets effectiveUntil = now() on a currently-active row. This creates a gap
// in rate resolution — sessions after retirement will have no rate for this
// code's factor. The response includes a warning flag.
// ─────────────────────────────────────────────────────────────────────────────

rateReferencesRouter.post(
  "/:id/retire",
  requirePermission("billing.write"),
  async (c) => {
    const db = makePrisma(c.env);
    const result = await retireRateReference(db, c.req.param("id"));

    if ("errorCode" in result) {
      if (result.errorCode === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      if (result.errorCode === "not_active") {
        return c.json(
          {
            error: "not_active",
            status: result.rowStatus,
            message: `Row is already ${result.rowStatus} — only active rows can be retired.`,
          },
          400,
        );
      }
    }

    return c.json({
      rateReference: result,
      warning:
        "Rate reference retired. Sessions resolving this factor code after now() will find no active rate. Stage a replacement version to close the gap.",
    });
  },
);
