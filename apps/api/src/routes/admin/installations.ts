import { Hono } from "hono";
import { InstallationCreateInput, InstallationUpdateInput } from "@straumvakt/shared/inputs/installations";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  createInstallation,
  deleteInstallation,
  getInstallationById,
  listAllInstallations,
  listVendors,
  updateInstallation,
} from "../../repositories/installations";
import {
  disableInstallationOcppAuth,
  getInstallationOcppSummary,
  listInstallationOcppSummaries,
  rotateInstallationOcppPassword,
  setInstallationOcppPassword,
} from "../../repositories/installation-ocpp";
import type { Env } from "../../bindings";

export const adminInstallations = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminInstallations.use("*", requireAdmin);

// Installations are site-level children; no separate installation.*
// verb in the catalogue. site.read/write maps cleanly.
adminInstallations.get(
  "/",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const [installations, vendors, ocppMap] = await Promise.all([
      listAllInstallations(db),
      listVendors(db),
      listInstallationOcppSummaries(db),
    ]);
    // Project Map<id, summary> into a serialisable array so the UI
    // can index by id without a Map<>JSON.stringify dance. ISO the
    // Date so `JSON.parse` round-trips cleanly. Installations with
    // zero chargers and no rotation history return identityCount:0,
    // lastRotatedAt:null — explicit so the UI doesn't need a
    // missing-row branch.
    const ocppSummaries = installations.map((i) => {
      const s = ocppMap.get(i.id);
      return {
        installationId: i.id,
        identityCount: s?.identityCount ?? 0,
        lastRotatedAt: s?.lastRotatedAt?.toISOString() ?? null,
      };
    });
    return c.json({ installations, vendors, ocppSummaries });
  },
);

adminInstallations.post(
  "/",
  requirePermission("site.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = InstallationCreateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const installation = await createInstallation(db, parsed.data);
    return c.json({ installation }, 201);
  },
);

adminInstallations.get(
  "/:id",
  requirePermission("site.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const installation = await getInstallationById(db, c.req.param("id"));
    if (!installation) return c.json({ error: "not_found" }, 404);
    return c.json({ installation });
  },
);

adminInstallations.patch(
  "/:id",
  requirePermission("site.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = InstallationUpdateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const installation = await updateInstallation(db, c.req.param("id"), parsed.data);
    return c.json({ installation });
  },
);

adminInstallations.delete(
  "/:id",
  requirePermission("site.delete"),
  async (c) => {
    const db = makePrisma(c.env);
    await deleteInstallation(db, c.req.param("id"));
    return c.json({ ok: true });
  },
);

// ── OCPP password management ────────────────────────────────────────
//
// Per-installation OCPP Basic-Auth password. Mirrors the Zaptec
// portal's installation-level model: one password covers every
// charger in the installation. See repositories/installation-ocpp.ts
// for the rotation/set semantics + audit shape.
//
// We never persist plaintext — rotate returns it once, the operator
// must capture it immediately. Set is operator-supplied plaintext;
// we hash and stamp.

adminInstallations.get(
  "/:id/ocpp-password",
  requirePermission("site.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const summary = await getInstallationOcppSummary(db, c.req.param("id"));
    if (!summary) return c.json({ error: "not_found" }, 404);
    return c.json({ summary });
  },
);

adminInstallations.post(
  "/:id/ocpp-password/rotate",
  requirePermission("site.write"),
  async (c) => {
    const db = makePrisma(c.env);
    const result = await rotateInstallationOcppPassword(db, c.req.param("id"), null);
    if (!result) return c.json({ error: "not_found" }, 404);
    return c.json({ result });
  },
);

adminInstallations.patch(
  "/:id/ocpp-password",
  requirePermission("site.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof (raw as { plaintext?: unknown }).plaintext !== "string"
    ) {
      return c.json({ error: "validation", message: "plaintext required (string)" }, 400);
    }
    const plaintext = (raw as { plaintext: string }).plaintext;
    const db = makePrisma(c.env);
    try {
      const result = await setInstallationOcppPassword(
        db,
        c.req.param("id"),
        plaintext,
        null,
      );
      if (!result) return c.json({ error: "not_found" }, 404);
      return c.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message === "password_length_invalid") {
        return c.json(
          { error: "validation", message: "password must be 8–128 chars" },
          400,
        );
      }
      throw err;
    }
  },
);

// Flip the entire installation onto the no-auth path. Distinct from
// PATCH (set explicit) so the security relaxation can never be a
// silent consequence of submitting blank plaintext — the operator
// has to call this verb deliberately. UI gates with double-confirm.
adminInstallations.post(
  "/:id/ocpp-password/disable",
  requirePermission("site.write"),
  async (c) => {
    const db = makePrisma(c.env);
    const result = await disableInstallationOcppAuth(db, c.req.param("id"), null);
    if (!result) return c.json({ error: "not_found" }, 404);
    return c.json({ result });
  },
);
