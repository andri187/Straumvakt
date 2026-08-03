// Sprint 9 / 2026-05-09 — ADR 0036 Autocharge Step G
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

// GET /api/admin/vehicles/fly-health — operator-triggered probe of
// the Fly consumer. The click both verifies aliveness AND wakes the
// machine if it auto-suspended on the free tier — the cold-start
// path takes 10-15s, so timeouts are generous.
//
// Returns:
//   200 + { alive: true,  health: <Fly response> }
//   200 + { alive: false, error: "timed_out" | "fly_5xx" | "fetch_failed", detail }
adminVehicles.get(
  "/fly-health",
  requirePermission("member.read"),
  async (c) => {
    const FLY_HEALTH_URL =
      "https://straumvakt-zaptec-consumer-staging.fly.dev/health";
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      const res = await fetch(FLY_HEALTH_URL, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      const elapsedMs = Date.now() - t0;
      if (!res.ok) {
        return c.json({
          alive: false,
          error: "fly_5xx",
          status: res.status,
          elapsedMs,
        });
      }
      const health = (await res.json().catch(() => null)) as unknown;
      return c.json({ alive: true, health, elapsedMs });
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = msg.includes("aborted") || msg.includes("AbortError");
      return c.json({
        alive: false,
        error: isAbort ? "timed_out" : "fetch_failed",
        detail: msg,
        elapsedMs,
      });
    }
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
