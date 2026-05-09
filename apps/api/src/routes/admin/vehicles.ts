// Sprint 9 / 2026-05-09 — ADR 0021 Autocharge Step G
// Vehicle-recurrence admin route. Operator opens /vehicles/[mac] in
// the UI; that page calls this endpoint server-side to render the
// "this same EV PLC MAC has plugged in N times across these chargers"
// view.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { getVehicleRecurrence } from "../../repositories/vehicle-recurrence";
import { listVehicleIdSessions } from "../../repositories/vehicle-id-sessions";
import type { Env } from "../../bindings";

export const adminVehicles = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminVehicles.use("*", requireAdmin);

// GET /api/admin/vehicles — sessions that captured ANY vehicle-identity
// signal (link / protocol / application). Powers the /vehicle-ids
// landing page in the operator UI.
adminVehicles.get(
  "/",
  requirePermission("member.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const sessions = await listVehicleIdSessions(db, { limit: 200 });
    return c.json({ sessions });
  },
);

// GET /api/admin/vehicles/:mac — recurrence for a given EV PLC MAC
adminVehicles.get(
  "/:mac",
  requirePermission("member.read"),
  async (c) => {
    const mac = c.req.param("mac");
    const db = makePrisma(c.env);
    const recurrence = await getVehicleRecurrence(db, mac);
    if (!recurrence) {
      return c.json({ error: "invalid_mac_format" }, 400);
    }
    return c.json({ vehicle: recurrence });
  },
);
