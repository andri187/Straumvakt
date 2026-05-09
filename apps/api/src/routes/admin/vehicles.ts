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
import type { Env } from "../../bindings";

export const adminVehicles = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminVehicles.use("*", requireAdmin);

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
