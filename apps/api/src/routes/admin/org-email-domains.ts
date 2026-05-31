// Admin route — OrgEmailDomain CRUD (ADR 0022, 2026-05-31 addendum).
//
// Mounted via:
//   app.route("/api/admin/orgs", adminOrgEmailDomains)
// so the full paths become:
//   GET    /api/admin/orgs/:orgId/email-domains
//   POST   /api/admin/orgs/:orgId/email-domains
//   PATCH  /api/admin/orgs/:orgId/email-domains/:id
//   DELETE /api/admin/orgs/:orgId/email-domains/:id
//
// Policy rules:
//   • auto_join requires defaultDriverGroupId (the group must belong to the
//     same org — cross-tenant assignment is rejected with 400).
//   • request_approval and disabled: defaultDriverGroupId is ignored/nullable.
//   • domain is globally UNIQUE — a 409 surfaces if another org already claims it.
//
// Read gate:  platform.tenant.read  (same as GET /api/admin/orgs/)
// Write gate: platform.tenant.write (same as POST /api/admin/orgs/)
// Both verbs require an active admin session (requireAdmin middleware).

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  listEmailDomainsForOrg,
  createEmailDomain,
  updateEmailDomain,
  deleteEmailDomain,
} from "../../repositories/org-email-domains";
import type { Env } from "../../bindings";

export const adminOrgEmailDomains = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

adminOrgEmailDomains.use("*", requireAdmin);

// ─── Validation schemas ───────────────────────────────────────────────────────

// RFC 1035-ish domain label validation: only letters, digits, hyphens.
// Does not allow IP addresses, IDN (punycode is fine since it looks like
// ascii after encoding), or trailing dots.
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const PolicyEnum = z.enum(["auto_join", "request_approval", "disabled"]);

const CreateBody = z.object({
  domain: z
    .string()
    .min(1)
    .refine((v) => DOMAIN_RE.test(v), {
      message: "domain must be a valid domain name (e.g. n1.is)",
    })
    .transform((v) => v.toLowerCase()),
  policy: PolicyEnum,
  defaultDriverGroupId: z.string().uuid().nullish(),
});

const PatchBody = z
  .object({
    policy: PolicyEnum,
    defaultDriverGroupId: z.string().uuid().nullish(),
  })
  .partial();

// ─── GET /:orgId/email-domains ────────────────────────────────────────────────

adminOrgEmailDomains.get(
  "/:orgId/email-domains",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const orgId = c.req.param("orgId");
    const db = makePrisma(c.env);
    const domains = await listEmailDomainsForOrg(db, orgId);
    return c.json({ domains });
  },
);

// ─── POST /:orgId/email-domains ───────────────────────────────────────────────

adminOrgEmailDomains.post(
  "/:orgId/email-domains",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const orgId = c.req.param("orgId");
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = CreateBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }

    const { domain, policy, defaultDriverGroupId } = parsed.data;

    // auto_join requires a target group.
    if (policy === "auto_join" && !defaultDriverGroupId) {
      return c.json(
        { error: "default_driver_group_required_for_auto_join" },
        400,
      );
    }

    const db = makePrisma(c.env);

    // If a group is provided, verify it belongs to this org.
    if (defaultDriverGroupId) {
      const group = await db.driverGroup.findUnique({
        where: { id: defaultDriverGroupId },
        select: { ownerOrgId: true },
      });
      if (!group) {
        return c.json(
          { error: "not_found", message: "DriverGroup not found" },
          404,
        );
      }
      if (group.ownerOrgId !== orgId) {
        return c.json(
          {
            error: "forbidden",
            message: "DriverGroup does not belong to this organisation",
          },
          400,
        );
      }
    }

    try {
      const emailDomain = await createEmailDomain(db, {
        orgId,
        domain,
        policy,
        defaultDriverGroupId: defaultDriverGroupId ?? null,
      });
      return c.json({ emailDomain }, 201);
    } catch (err: unknown) {
      // Unique constraint on domain — another org already owns it.
      if (isUniqueConstraintError(err)) {
        return c.json({ error: "domain_taken" }, 409);
      }
      throw err;
    }
  },
);

// ─── PATCH /:orgId/email-domains/:id ─────────────────────────────────────────

adminOrgEmailDomains.patch(
  "/:orgId/email-domains/:id",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const orgId = c.req.param("orgId");
    const id = c.req.param("id");
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = PatchBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }

    const { policy, defaultDriverGroupId } = parsed.data;

    // Verify ownership before updating: fetch the current row.
    const db = makePrisma(c.env);
    const existing = await db.orgEmailDomain.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }
    if (existing.orgId !== orgId) {
      return c.json({ error: "forbidden" }, 403);
    }

    // If the new or effective policy would be auto_join, ensure a group exists.
    // We need to know the resulting policy — either from the patch or the current row.
    if (policy === "auto_join" && defaultDriverGroupId === null) {
      // Caller is setting policy=auto_join but clearing the group — invalid.
      return c.json(
        { error: "default_driver_group_required_for_auto_join" },
        400,
      );
    }

    // If a new group is provided, verify it belongs to this org.
    if (defaultDriverGroupId) {
      const group = await db.driverGroup.findUnique({
        where: { id: defaultDriverGroupId },
        select: { ownerOrgId: true },
      });
      if (!group) {
        return c.json(
          { error: "not_found", message: "DriverGroup not found" },
          404,
        );
      }
      if (group.ownerOrgId !== orgId) {
        return c.json(
          {
            error: "forbidden",
            message: "DriverGroup does not belong to this organisation",
          },
          400,
        );
      }
    }

    const updated = await updateEmailDomain(db, id, {
      ...(policy !== undefined && { policy }),
      ...(defaultDriverGroupId !== undefined && { defaultDriverGroupId }),
    });

    if (!updated) {
      return c.json({ error: "not_found" }, 404);
    }

    return c.json({ emailDomain: updated });
  },
);

// ─── DELETE /:orgId/email-domains/:id ────────────────────────────────────────

adminOrgEmailDomains.delete(
  "/:orgId/email-domains/:id",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const orgId = c.req.param("orgId");
    const id = c.req.param("id");

    const db = makePrisma(c.env);

    // Ownership check before delete.
    const existing = await db.orgEmailDomain.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }
    if (existing.orgId !== orgId) {
      return c.json({ error: "forbidden" }, 403);
    }

    await deleteEmailDomain(db, id);
    return c.json({ ok: true });
  },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  // Prisma error code P2002 = unique constraint violation.
  if ("code" in err && (err as { code: unknown }).code === "P2002") return true;
  // Some adapters surface this via message text.
  if (
    "message" in err &&
    typeof (err as { message: unknown }).message === "string" &&
    (err as { message: string }).message.includes("unique constraint")
  ) {
    return true;
  }
  return false;
}
