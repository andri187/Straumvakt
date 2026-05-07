// Sprint 9.6 — admin read of charging.live_sessions.
// One row per charger with an active session. Maintained by the
// /api/internal/zaptec-state-event ingest from the Fly AMQP consumer.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import type { Env } from "../../bindings";

export const adminActiveSessions = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminActiveSessions.use("*", requireAdmin);

adminActiveSessions.get("/", requirePermission("charger.read"), async (c) => {
  const db = makePrisma(c.env);
  const rows = await db.liveSession.findMany({
    select: {
      chargingStationId: true,
      orgId: true,
      ocppIdentityId: true,
      vendorResourceId: true,
      startedAt: true,
      lastObservedAt: true,
      lastOperationMode: true,
      lastPowerW: true,
      lastSessionEnergyWh: true,
      organization: { select: { displayName: true } },
      ocppIdentity: { select: { identityString: true } },
      chargingStation: {
        select: {
          siteAsset: { select: { displayName: true, site: { select: { displayName: true } } } },
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });
  return c.json({
    sessions: rows.map((r) => ({
      chargingStationId: r.chargingStationId,
      orgId: r.orgId,
      orgDisplayName: r.organization.displayName,
      siteDisplayName: r.chargingStation.siteAsset.site.displayName,
      chargerDisplayName: r.chargingStation.siteAsset.displayName,
      identityString: r.ocppIdentity.identityString,
      vendorResourceId: r.vendorResourceId,
      startedAt: r.startedAt.toISOString(),
      lastObservedAt: r.lastObservedAt.toISOString(),
      lastOperationMode: r.lastOperationMode,
      lastPowerW: r.lastPowerW != null ? Number(r.lastPowerW) : null,
      lastSessionEnergyWh:
        r.lastSessionEnergyWh != null ? Number(r.lastSessionEnergyWh) : null,
    })),
    count: rows.length,
    fetchedAt: new Date().toISOString(),
  });
});
