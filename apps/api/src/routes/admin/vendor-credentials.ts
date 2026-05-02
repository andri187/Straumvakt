// Vendor-credentials admin routes — both platform-wide ("show me all
// stored Zaptec credentials across all orgs", platform-admin only) and
// org-scoped ("show me my org's stored Zaptec credentials"). Org-scoped
// filtering is by ownerOrgId from the URL path; the per-user-membership
// check is a no-op today (ADR 0006 — roles inert during pilot) but the
// shape is in place for when roles flip on.

import { Hono } from "hono";
import {
  VendorCredentialCreateInput,
  VendorCredentialUpdateInput,
} from "@straumvakt/shared/inputs/vendor-credentials";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import {
  createVendorCredential,
  deleteVendorCredential,
  getVendorCredentialById,
  listVendorCredentials,
  moveVendorCredentialToOrg,
  updateVendorCredential,
} from "../../repositories/vendor-credentials";
import { z } from "zod";
import {
  applyCredentialSelection,
  getCredentialManagementTree,
} from "../../repositories/credential-management";
import type { Env } from "../../bindings";

// Platform-wide list — every org's credentials. Operator UI uses this
// for the "Onboarding" tab when the operator is platform admin.
export const adminVendorCredentialsAll = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminVendorCredentialsAll.use("*", requireAdmin);

adminVendorCredentialsAll.get("/", async (c) => {
  const db = makePrisma(c.env);
  const credentials = await listVendorCredentials(db);
  return c.json({ credentials });
});

adminVendorCredentialsAll.get("/:id", async (c) => {
  const db = makePrisma(c.env);
  const credential = await getVendorCredentialById(db, c.req.param("id"));
  if (!credential) return c.json({ error: "not_found" }, 404);
  return c.json({ credential });
});

adminVendorCredentialsAll.patch("/:id", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = VendorCredentialUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  try {
    const credential = await updateVendorCredential(db, c.req.param("id"), {
      passwordPlaintext: parsed.data.password,
      status: parsed.data.status,
      notes: parsed.data.notes,
      kek: c.env.OCPP_CRED_KEK,
    });
    return c.json({ credential });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Record to update not found")) return c.json({ error: "not_found" }, 404);
    throw err;
  }
});

// Manage tree — returns the operator-facing view of "what's in Zaptec
// vs what's in our DB" for a credential. Imported installations float
// to the top so the operator can act; unimported sink (wizard-only).
adminVendorCredentialsAll.get("/:id/manage-tree", async (c) => {
  const db = makePrisma(c.env);
  try {
    const tree = await getCredentialManagementTree(db, c.env.OCPP_CRED_KEK, c.req.param("id"));
    return c.json({ tree });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "credential_not_found") return c.json({ error: msg }, 404);
    if (msg === "credential_not_zaptec") return c.json({ error: msg }, 400);
    if (msg === "credential_password_missing") return c.json({ error: msg }, 400);
    if (msg === "zaptec_auth_failed") return c.json({ error: msg }, 502);
    if (msg === "kek_unavailable") return c.json({ error: msg }, 500);
    throw err;
  }
});

adminVendorCredentialsAll.post("/:id/apply", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as
    | { selectedZaptecChargerIds?: unknown }
    | null;
  const ids = Array.isArray(raw?.selectedZaptecChargerIds)
    ? (raw!.selectedZaptecChargerIds as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : null;
  if (!ids) {
    return c.json({ error: "validation", issues: [{ path: ["selectedZaptecChargerIds"], message: "must be string array" }] }, 400);
  }
  const db = makePrisma(c.env);
  try {
    const result = await applyCredentialSelection(db, c.env.OCPP_CRED_KEK, c.req.param("id"), ids);
    return c.json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "credential_not_found") return c.json({ error: msg }, 404);
    if (msg === "credential_not_zaptec") return c.json({ error: msg }, 400);
    if (msg === "credential_password_missing") return c.json({ error: msg }, 400);
    if (msg === "zaptec_auth_failed") return c.json({ error: msg }, 502);
    if (msg === "kek_unavailable") return c.json({ error: msg }, 500);
    throw err;
  }
});

const MoveCredentialBody = z.object({
  targetOrgId: z.string().uuid(),
});

adminVendorCredentialsAll.post("/:id/move", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = MoveCredentialBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const db = makePrisma(c.env);
  try {
    const result = await moveVendorCredentialToOrg(
      db,
      c.req.param("id"),
      parsed.data.targetOrgId,
    );
    return c.json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "credential_not_found") return c.json({ error: msg }, 404);
    if (msg === "target_org_not_found") return c.json({ error: msg }, 400);
    if (msg === "already_in_target_org") return c.json({ error: msg }, 400);
    throw err;
  }
});

adminVendorCredentialsAll.delete("/:id", async (c) => {
  const db = makePrisma(c.env);
  try {
    await deleteVendorCredential(db, c.req.param("id"));
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Record to delete does not exist")) return c.json({ ok: true });
    throw err;
  }
});

// Org-scoped — operators viewing the credentials owned by one of their
// orgs. Mounted at /api/admin/orgs/:orgId/vendor-credentials so it
// composes naturally with the existing org sub-routes.
export const adminVendorCredentialsByOrg = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminVendorCredentialsByOrg.use("*", requireAdmin);

adminVendorCredentialsByOrg.get("/", async (c) => {
  const orgId = c.req.param("orgId");
  if (!orgId) return c.json({ error: "missing_orgId" }, 400);
  const db = makePrisma(c.env);
  const credentials = await listVendorCredentials(db, { ownerOrgIds: [orgId] });
  return c.json({ credentials });
});

adminVendorCredentialsByOrg.post("/", async (c) => {
  const orgId = c.req.param("orgId");
  if (!orgId) return c.json({ error: "missing_orgId" }, 400);
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = VendorCredentialCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  try {
    const credential = await createVendorCredential(db, {
      ownerOrgId: orgId,
      vendorSlug: parsed.data.vendorSlug,
      username: parsed.data.username,
      passwordPlaintext: parsed.data.password,
      notes: parsed.data.notes,
      kek: c.env.OCPP_CRED_KEK,
    });
    return c.json({ credential }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "vendor_not_found") return c.json({ error: msg }, 400);
    if (msg.includes("Unique constraint")) {
      return c.json({ error: "already_exists" }, 409);
    }
    throw err;
  }
});
