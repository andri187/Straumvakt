// Per-contract admin routes — Sprint 8.13. The org-scoped list lives
// at /api/admin/orgs/:id/contracts (in orgs.ts); this file owns
// individual contract read/update/delete plus a platform-wide list.
//
// Authorization: read goes by contract.read; write/delete by
// contract.write. Per ADR 0006 the catalogue is inert during pilot
// (every authenticated admin gets through), but the verbs are wired
// so flipping roles on later Just Works.

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  deleteContract,
  getContractById,
  getContractTariffs,
  listAllContracts,
  updateContract,
} from "../../repositories/contracts";
import type { Env } from "../../bindings";

export const adminContracts = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

adminContracts.use("*", requireAdmin);

// Platform-wide list — every contract across every org. Feeds the
// top-level /billing/contracts page in the operator console.
adminContracts.get(
  "/",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const contracts = await listAllContracts(db);
    return c.json({ contracts });
  },
);

adminContracts.get(
  "/:id",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const contract = await getContractById(db, c.req.param("id"));
    if (!contract) return c.json({ error: "not_found" }, 404);
    return c.json({ contract });
  },
);

// Sprint 8.14 — DSO + retailer rates resolved through the contract's
// scope. Site-scoped → DSO of the site + every installation's
// retailer. Installation-scoped → site DSO + this installation's
// retailer. Other scopes → empty (charger / circuit / org_default
// not on the resolution path today).
adminContracts.get(
  "/:id/tariffs",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const tariffs = await getContractTariffs(db, c.req.param("id"));
    if (tariffs === null) return c.json({ error: "not_found" }, 404);
    return c.json({ tariffs });
  },
);

const ContractPatchInput = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    status: z
      .enum(["pending_configuration", "active", "superseded", "archived"])
      .optional(),
    validFrom: z.string().datetime().optional(),
    validUntil: z.union([z.string().datetime(), z.null()]).optional(),
  })
  .strict();

adminContracts.patch(
  "/:id",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = ContractPatchInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    const db = makePrisma(c.env);
    try {
      const contract = await updateContract(
        db,
        c.req.param("id"),
        parsed.data,
      );
      return c.json({ contract });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Record to update not found")) {
        return c.json({ error: "not_found" }, 404);
      }
      throw err;
    }
  },
);

adminContracts.delete(
  "/:id",
  requirePermission("platform.tenant.delete"),
  async (c) => {
    const db = makePrisma(c.env);
    try {
      await deleteContract(db, c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Record to delete does not exist")) {
        return c.json({ ok: true });
      }
      throw err;
    }
  },
);
