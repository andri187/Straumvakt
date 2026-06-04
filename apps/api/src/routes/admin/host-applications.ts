// ADR 0026 §6 / §7 — operator inbox for host applications.
//
//   GET   /api/admin/host-applications?status=     — list (newest first)
//   GET   /api/admin/host-applications/:id         — one
//   PATCH /api/admin/host-applications/:id         — { status }
//
// Global (pre-tenant) surface, so it's gated by the platform.tenant.*
// permissions rather than an org-scoped membership check. Converting a
// "won" application into a host org lands with ADR 0027 (host onboarding).

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  getHostApplication,
  listHostApplications,
  updateHostApplicationStatus,
} from "../../repositories/host-applications";
import type { Env } from "../../bindings";

export const adminHostApplications = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

adminHostApplications.use("*", requireAdmin);

const STATUSES = ["new", "in_review", "offered", "won", "lost"] as const;

adminHostApplications.get(
  "/",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const statusRaw = c.req.query("status");
    const ListQuery = z.object({
      status: z.enum(STATUSES).optional(),
    });
    const parsed = ListQuery.safeParse({ status: statusRaw });
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    const db = makePrisma(c.env);
    const items = await listHostApplications(db, parsed.data);
    return c.json({ items });
  },
);

adminHostApplications.get(
  "/:id",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const id = c.req.param("id");
    const db = makePrisma(c.env);
    const application = await getHostApplication(db, id);
    if (!application) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ application });
  },
);

const PatchBody = z.object({
  status: z.enum(STATUSES),
});

adminHostApplications.patch(
  "/:id",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const id = c.req.param("id");
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = PatchBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    const db = makePrisma(c.env);
    const application = await updateHostApplicationStatus(
      db,
      id,
      parsed.data.status,
    );
    if (!application) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ application });
  },
);
