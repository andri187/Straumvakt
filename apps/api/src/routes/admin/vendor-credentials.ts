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
import { requirePermission } from "../../lib/auth/require-permission";
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
  unsealAndAuth,
} from "../../repositories/credential-management";
import { probeZaptecSessions } from "../../repositories/zaptec-session-probe";
import { syncZaptecSessions } from "../../repositories/zaptec-session-sync";
import { listInstallations } from "../../lib/zaptec";
import type { Env } from "../../bindings";

// Platform-wide list — every org's credentials. Operator UI uses this
// for the "Onboarding" tab when the operator is platform admin.
export const adminVendorCredentialsAll = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminVendorCredentialsAll.use("*", requireAdmin);

adminVendorCredentialsAll.get(
  "/",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const credentials = await listVendorCredentials(db);
    return c.json({ credentials });
  },
);

adminVendorCredentialsAll.get(
  "/:id",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const credential = await getVendorCredentialById(db, c.req.param("id"));
    if (!credential) return c.json({ error: "not_found" }, 404);
    return c.json({ credential });
  },
);

adminVendorCredentialsAll.patch(
  "/:id",
  requirePermission("platform.tenant.write"),
  async (c) => {
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
  },
);

// Sprint 8.x — API-fallback probe. Reads Zaptec's charge history
// for the time window + (optional) installationId/chargerId filter,
// diffs against our charge_sessions + session_ledger, returns the
// gap. Read-only; doesn't write to our DB. Operator decides what
// to do with the diff.
//
// Query params:
//   ?installationId=...   restrict to one Zaptec installation
//   ?chargerId=...        restrict to one Zaptec charger (deviceId)
//   ?from=ISO             default 30 days ago
//   ?to=ISO               default now
adminVendorCredentialsAll.get(
  "/:id/probe-sessions",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    try {
      const auth = await unsealAndAuth(db, c.env.OCPP_CRED_KEK!, c.req.param("id"));
      const result = await probeZaptecSessions(db, {
        accessToken: auth.accessToken,
        installationId: c.req.query("installationId"),
        chargerId: c.req.query("chargerId"),
        from: c.req.query("from"),
        to: c.req.query("to"),
      });
      return c.json({
        zaptecCount: result.zaptecCount,
        ourCount: result.ourCount,
        bothInOurs: result.bothInOurs,
        onlyInZaptec: result.onlyInZaptec,
        onlyInOurs: result.onlyInOurs.map((s) => ({
          ...s,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt?.toISOString() ?? null,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "credential_not_found") return c.json({ error: msg }, 404);
      if (msg === "credential_not_zaptec") return c.json({ error: msg }, 400);
      if (msg === "credential_password_missing") return c.json({ error: msg }, 400);
      if (msg === "zaptec_auth_failed") return c.json({ error: msg }, 502);
      if (msg === "kek_unavailable") return c.json({ error: msg }, 500);
      if (msg.startsWith("zaptec_chargehistory_fetch_failed")) {
        return c.json({ error: "zaptec_chargehistory_fetch_failed", detail: msg }, 502);
      }
      throw err;
    }
  },
);

// Sprint 8.7 — API-only writeback. Idempotent backfill: re-runs hit
// the unique (sourceKind, sourceCdrId) index on imported_cdr_refs.
//
// 8.14.1 — when no installationId is provided, fans out per
// installation (Zaptec's /api/chargehistory returns nothing without
// an installation filter, confirmed against staging). With
// installationId set, hits just that one. With chargerId set, scopes
// to a single charger across the credential's installation set.
//
// Use for backfills: POST /:id/sync-sessions?from=2026-04-01T00:00:00Z&to=2026-06-01T00:00:00Z
// will sweep April + May across every installation under the
// credential and idempotently land every session with cost.
adminVendorCredentialsAll.post(
  "/:id/sync-sessions",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const db = makePrisma(c.env);
    try {
      const auth = await unsealAndAuth(db, c.env.OCPP_CRED_KEK!, c.req.param("id"));
      const installationIdParam = c.req.query("installationId");
      const chargerId = c.req.query("chargerId");
      const from = c.req.query("from");
      const to = c.req.query("to");

      // If installationId or chargerId given → narrow scope path.
      if (installationIdParam || chargerId) {
        const result = await syncZaptecSessions(db, {
          accessToken: auth.accessToken,
          installationId: installationIdParam,
          chargerId,
          from,
          to,
        });
        return c.json({
          installationsScanned: 1,
          zaptecCount: result.zaptecCount,
          importedCount: result.imported.length,
          skippedCount: result.skipped.length,
          errorCount: result.errors.length,
          imported: result.imported,
          skipped: result.skipped,
          errors: result.errors,
        });
      }

      // No filter → fan out across every installation the credential
      // can see. Aggregates the per-installation results into a
      // single response.
      const installsResp = await listInstallations(auth.accessToken);
      if (!installsResp.ok) {
        return c.json(
          {
            error: "zaptec_installations_fetch_failed",
            detail: JSON.stringify(installsResp.error),
          },
          502,
        );
      }
      let zaptecCount = 0;
      const imported: typeof installsResp extends { value: infer _ }
        ? Array<{ zaptecId: string; ourSessionId: string; energyKwh: number; costIskMinor: string }>
        : never = [] as never;
      const skipped: Array<{ zaptecId: string; reason: string }> = [];
      const errors: Array<{ zaptecId: string; code: string; detail: string }> = [];
      let installationsScanned = 0;
      for (const inst of installsResp.value) {
        if (!inst.Id) continue;
        const result = await syncZaptecSessions(db, {
          accessToken: auth.accessToken,
          installationId: inst.Id,
          from,
          to,
        });
        installationsScanned++;
        zaptecCount += result.zaptecCount;
        imported.push(...result.imported);
        skipped.push(...result.skipped);
        errors.push(...result.errors);
      }
      return c.json({
        installationsScanned,
        zaptecCount,
        importedCount: imported.length,
        skippedCount: skipped.length,
        errorCount: errors.length,
        imported,
        skipped,
        errors,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "credential_not_found") return c.json({ error: msg }, 404);
      if (msg === "credential_not_zaptec") return c.json({ error: msg }, 400);
      if (msg === "credential_password_missing") return c.json({ error: msg }, 400);
      if (msg === "zaptec_auth_failed") return c.json({ error: msg }, 502);
      if (msg === "kek_unavailable") return c.json({ error: msg }, 500);
      if (msg.startsWith("zaptec_chargehistory_fetch_failed")) {
        return c.json({ error: "zaptec_chargehistory_fetch_failed", detail: msg }, 502);
      }
      throw err;
    }
  },
);

// Manage tree — returns the operator-facing view of "what's in Zaptec
// vs what's in our DB" for a credential. Imported installations float
// to the top so the operator can act; unimported sink (wizard-only).
adminVendorCredentialsAll.get(
  "/:id/manage-tree",
  requirePermission("platform.tenant.read"),
  async (c) => {
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
  },
);

adminVendorCredentialsAll.post(
  "/:id/apply",
  requirePermission("platform.tenant.write"),
  async (c) => {
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
  },
);

const MoveCredentialBody = z.object({
  targetOrgId: z.string().uuid(),
});

adminVendorCredentialsAll.post(
  "/:id/move",
  requirePermission("platform.tenant.write"),
  async (c) => {
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
  },
);

adminVendorCredentialsAll.delete(
  "/:id",
  requirePermission("platform.tenant.delete"),
  async (c) => {
  const db = makePrisma(c.env);
  try {
    await deleteVendorCredential(db, c.req.param("id"));
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Record to delete does not exist")) return c.json({ ok: true });
    throw err;
  }
  },
);

// Org-scoped — operators viewing the credentials owned by one of their
// orgs. Mounted at /api/admin/orgs/:orgId/vendor-credentials so it
// composes naturally with the existing org sub-routes.
export const adminVendorCredentialsByOrg = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminVendorCredentialsByOrg.use("*", requireAdmin);

adminVendorCredentialsByOrg.get(
  "/",
  requirePermission("org.read", { orgIdParam: "orgId" }),
  async (c) => {
    const orgId = c.req.param("orgId");
    if (!orgId) return c.json({ error: "missing_orgId" }, 400);
    const db = makePrisma(c.env);
    const credentials = await listVendorCredentials(db, { ownerOrgIds: [orgId] });
    return c.json({ credentials });
  },
);

adminVendorCredentialsByOrg.post(
  "/",
  requirePermission("org.write", { orgIdParam: "orgId" }),
  async (c) => {
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
  },
);
