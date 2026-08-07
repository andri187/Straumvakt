// Sprint 9.6 — admin read of charging.live_sessions.
// One row per charger with an active session. Maintained by the
// /api/internal/zaptec-state-event ingest from the Fly AMQP consumer.

import { Hono } from "hono";
import { desc, eq, inArray } from "drizzle-orm";
import { makeDrizzle } from "../../lib/drizzle";
import { liveSessions } from "@straumvakt/shared/db/charging";
import { chargingStations, siteAssets, sites } from "@straumvakt/shared/db/assets";
import { ocppIdentities } from "@straumvakt/shared/db/protocol";
import { organizations } from "@straumvakt/shared/db/identity";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { resolveOrgScope } from "../../lib/auth/org-scope";
import type { Env } from "../../bindings";

export const adminActiveSessions = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminActiveSessions.use("*", requireAdmin);

adminActiveSessions.get("/", requirePermission("charger.read"), async (c) => {
  const db = makeDrizzle(c.env);
  const orgScope = await resolveOrgScope(c.env, c.get("session"));
  // charging_stations' PK is the site_asset id, so charger name and site name
  // are two joins from the live session, not three.
  const rows = await db
    .select({
      chargingStationId: liveSessions.chargingStationId,
      orgId: liveSessions.orgId,
      ocppIdentityId: liveSessions.ocppIdentityId,
      vendorResourceId: liveSessions.vendorResourceId,
      startedAt: liveSessions.startedAt,
      lastObservedAt: liveSessions.lastObservedAt,
      lastOperationMode: liveSessions.lastOperationMode,
      lastPowerW: liveSessions.lastPowerW,
      lastSessionEnergyWh: liveSessions.lastSessionEnergyWh,
      orgDisplayName: organizations.displayName,
      identityString: ocppIdentities.identityString,
      chargerDisplayName: siteAssets.displayName,
      siteDisplayName: sites.displayName,
    })
    .from(liveSessions)
    .leftJoin(organizations, eq(organizations.id, liveSessions.orgId))
    .leftJoin(ocppIdentities, eq(ocppIdentities.id, liveSessions.ocppIdentityId))
    .leftJoin(chargingStations, eq(chargingStations.siteAssetId, liveSessions.chargingStationId))
    .leftJoin(siteAssets, eq(siteAssets.id, chargingStations.siteAssetId))
    .leftJoin(sites, eq(sites.id, siteAssets.siteId))
    .where(orgScope.all === false ? inArray(liveSessions.orgId, orgScope.orgIds) : undefined)
    .orderBy(desc(liveSessions.startedAt));
  return c.json({
    sessions: rows.map((r) => ({
      chargingStationId: r.chargingStationId,
      orgId: r.orgId,
      orgDisplayName: r.orgDisplayName,
      siteDisplayName: r.siteDisplayName,
      chargerDisplayName: r.chargerDisplayName,
      identityString: r.identityString,
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
