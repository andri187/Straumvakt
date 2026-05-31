/**
 * access-requests.ts — operator inbox routes for driver self-onboarding
 * (ADR 0022 / 2026-05-31 addendum, Sprint 9 ENROLL-2).
 *
 * Mounted at /api/admin/access-requests in src/index.ts.
 *
 * Routes:
 *   GET   /api/admin/access-requests?orgId=&status=
 *     - Lists requests scoped to the installation's parent org.
 *     - status defaults to 'pending'.
 *     - Requires member.write on orgId — operator must have admin-grade
 *       authority on the org whose installation the request targets.
 *
 *   PATCH /api/admin/access-requests/:id
 *     - Body { action: "approve" | "deny", denialReason?: string }
 *     - "deny" requires a non-empty denialReason — 400 if missing.
 *     - Looks up the request, asserts member.write on its parent org,
 *       then dispatches to the repo's approve/deny handler.
 *
 * Why orgId is a query param (and not in the URL): the inbox is a
 * single view that the operator console pre-scopes by their current
 * org selector. Keeping orgId on the query string lets the UI page
 * across orgs without restructuring the URL — and the assertPermission
 * + tenant filter inside the repo enforce isolation regardless.
 */

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import {
  requirePermission,
  assertPermission,
} from "../../lib/auth/require-permission";
import {
  listForOperator,
  approveRequest,
  denyRequest,
  type DriverAccessRequestStatus,
} from "../../repositories/driver-access-requests";
import type { Env } from "../../bindings";

export const adminAccessRequests = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

adminAccessRequests.use("*", requireAdmin);

// Pull the request Origin so the emails carry the same base URL the
// operator is currently using (staging vs production console).
function originBaseUrl(c: {
  req: { header: (k: string) => string | undefined };
}): string | undefined {
  const origin = c.req.header("origin") ?? c.req.header("referer");
  if (!origin) return undefined;
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/access-requests
// ─────────────────────────────────────────────────────────────────────

const ListQuery = z.object({
  orgId: z.string().uuid(),
  status: z
    .enum(["pending", "approved", "denied", "withdrawn"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

adminAccessRequests.get("/", async (c) => {
  const parsed = ListQuery.safeParse({
    orgId: c.req.query("orgId"),
    status: c.req.query("status"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return c.json(
      { error: "validation", issues: parsed.error.issues },
      400,
    );
  }

  // Authority — operator must have member.write on the queried org.
  const denial = await assertPermission(c, "member.write", parsed.data.orgId);
  if (denial) return denial;

  const db = makePrisma(c.env);
  const result = await listForOperator(db, {
    orgId: parsed.data.orgId,
    status: parsed.data.status as DriverAccessRequestStatus | undefined,
    limit: parsed.data.limit,
  });
  return c.json(result);
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/admin/access-requests/:id
// ─────────────────────────────────────────────────────────────────────

const PatchBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("deny"),
    denialReason: z.string().trim().min(1).max(500),
  }),
]);

adminAccessRequests.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "validation", message: "id required" }, 400);
  }

  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    // Distinguish missing-denial-reason from other validation errors so
    // the UI can show "Please tell the driver why you're denying" inline.
    const issues = parsed.error.issues;
    const missingReason = issues.some(
      (i) =>
        i.path.includes("denialReason") ||
        (typeof i.message === "string" &&
          i.message.toLowerCase().includes("denialreason")),
    );
    return c.json(
      missingReason
        ? { error: "denial_reason_required", issues }
        : { error: "validation", issues },
      400,
    );
  }

  const session = c.var.session;
  const reviewerUserId =
    (session as typeof session & { userId?: string }).userId ?? null;
  if (!reviewerUserId) {
    return c.json(
      { error: "session_missing_userid_relogin_required" },
      401,
    );
  }

  // Look up the request's parent org so the permission check is
  // anchored to the right tenant. The local generated Prisma client
  // doesn't yet expose driverAccessRequest natively (regen lands with
  // sibling ENROLL-1 / ENROLL-3 commits), so the call is typed via the
  // structural cast — same escape hatch the repo uses.
  const db = makePrisma(c.env);
  const head = await (db as unknown as {
    driverAccessRequest: {
      findUnique: (args: {
        where: { id: string };
        select: { id: true; installation: { select: { orgId: true } } };
      }) => Promise<
        | { id: string; installation: { orgId: string } }
        | null
      >;
    };
  }).driverAccessRequest.findUnique({
    where: { id },
    select: {
      id: true,
      installation: { select: { orgId: true } },
    },
  });
  if (!head) {
    return c.json({ error: "request_not_found" }, 404);
  }
  const orgId = head.installation.orgId;

  const denial = await assertPermission(c, "member.write", orgId);
  if (denial) return denial;

  const baseUrl = originBaseUrl(c);

  if (parsed.data.action === "approve") {
    const result = await approveRequest(db, c.env, id, reviewerUserId, {
      expectedInstallationOrgId: orgId,
      baseUrl,
    });
    if ("error" in result) {
      const status =
        result.error === "request_not_found"
          ? 404
          : result.error === "no_driver_group_for_installation"
            ? 422
            : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json({
      ok: true,
      membership: result.membership,
      alreadyExisted: result.alreadyExisted,
    });
  }

  // action === "deny"
  const result = await denyRequest(
    db,
    c.env,
    id,
    reviewerUserId,
    parsed.data.denialReason,
    { expectedInstallationOrgId: orgId, baseUrl },
  );
  if ("error" in result) {
    const status =
      result.error === "request_not_found"
        ? 404
        : result.error === "denial_reason_required"
          ? 400
          : 409;
    return c.json({ error: result.error }, status);
  }
  return c.json({ ok: true });
});
