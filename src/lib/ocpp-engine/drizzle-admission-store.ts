// Drizzle adapters for admission and authorization (Checkpoint A).
//
// Read-mostly and deliberately small: admission is ONE query for the route
// (org + installation) and ONE for identity + placements; authorization is ONE
// query (token + user + access EXISTS). The only write is the throttled
// discovery upsert. No Prisma, no Hyperdrive, no scheduled work.

import { and, eq, sql } from "drizzle-orm";
import { deviceIdentities, installations, placements } from "@straumvakt/shared/db/assets";
import { agreements, driverGroupMemberships, driverGroups } from "@straumvakt/shared/db/commercial";
import { idTokens, organizations, users } from "@straumvakt/shared/db/identity";
import { pendingDiscoveries } from "@straumvakt/shared/db/protocol";
import type { Executor } from "@/lib/installations/db";
import type { AdmissionLookup, AdmissionStore } from "./admission";
import type { AuthorizationStore } from "./authorization";

/** A repeat attempt from the same unregistered charger writes at most once per window. */
export const DISCOVERY_WRITE_INTERVAL_SECONDS = 300;

export function drizzleAdmissionStore(db: Executor): AdmissionStore {
  return {
    async lookup(route, at): Promise<AdmissionLookup> {
      const [row] = await db
        .select({
          orgId: organizations.id,
          orgStatus: organizations.status,
          installationId: installations.id,
          installationOrgId: installations.orgId,
          archivedAt: installations.archivedAt,
          mode: installations.ocppPasswordMode,
          verifier: installations.ocppPasswordVerifier,
          setAt: installations.ocppPasswordSetAt,
        })
        .from(organizations)
        .innerJoin(installations, and(eq(installations.orgId, organizations.id), eq(installations.installationKey, route.installationKey)))
        .where(eq(organizations.cpoRoutingId, route.routingId))
        .limit(1);
      if (!row) return { org: null, installation: null, identities: [] };

      // Case-insensitive on purpose: the caller decides exact vs case-only match.
      // The prefix pins the installation key, so the scan is index-bounded.
      const prefix = `${route.installationKey}/`;
      const idRows = await db
        .select({
          deviceId: deviceIdentities.deviceId,
          identityString: deviceIdentities.identityString,
          current: sql<boolean>`${deviceIdentities.period} @> ${at.toISOString()}::timestamptz`,
          placementId: placements.id,
          placementOrgId: placements.orgId,
          placementInstallationId: placements.installationId,
          placementCurrent: sql<boolean | null>`${placements.period} @> ${at.toISOString()}::timestamptz`,
        })
        .from(deviceIdentities)
        .leftJoin(placements, eq(placements.deviceId, deviceIdentities.deviceId))
        .where(and(sql`lower(${deviceIdentities.identityString}) = lower(${prefix + route.chargePointId})`));

      const byIdentity = new Map<string, AdmissionLookup["identities"][number]>();
      for (const r of idRows) {
        const k = `${r.deviceId}|${r.identityString}|${r.current}`;
        let entry = byIdentity.get(k);
        if (!entry) {
          entry = { deviceId: r.deviceId, identityString: r.identityString, current: r.current, placements: [] };
          byIdentity.set(k, entry);
        }
        if (r.placementId && r.placementOrgId && r.placementInstallationId) {
          entry.placements.push({ id: r.placementId, orgId: r.placementOrgId, installationId: r.placementInstallationId, current: r.placementCurrent === true });
        }
      }

      return {
        org: { id: row.orgId, active: row.orgStatus === "active" },
        installation: {
          id: row.installationId,
          orgId: row.installationOrgId,
          archived: row.archivedAt !== null,
          passwordMode: row.mode === "none" || row.mode === "password" ? row.mode : "unset",
          passwordVerifier: row.verifier,
          credentialEpoch: `${row.mode}:${row.setAt?.getTime() ?? 0}`,
        },
        identities: [...byIdentity.values()],
      };
    },

    async recordDiscovery({ installationKey, chargePointId, at, reason }) {
      const identity = `${installationKey}/${chargePointId}`;
      await db
        .insert(pendingDiscoveries)
        .values({ identityString: identity, firstSeenAt: at, lastSeenAt: at, attemptCount: 1, ...(reason ? { lastPayloadSummary: { reason } } : {}) })
        .onConflictDoUpdate({
          target: pendingDiscoveries.identityString,
          set: { lastSeenAt: at, attemptCount: sql`${pendingDiscoveries.attemptCount} + 1`, ...(reason ? { lastPayloadSummary: { reason } } : {}) },
          setWhere: sql`${pendingDiscoveries.lastSeenAt} < ${at.toISOString()}::timestamptz - make_interval(secs => ${DISCOVERY_WRITE_INTERVAL_SECONDS})`,
        });
    },
  };
}

export function drizzleAuthorizationStore(db: Executor): AuthorizationStore {
  return {
    async facts({ idTag, installationId, at }) {
      const atTs = at.toISOString();
      const [row] = await db
        .select({
          id: idTokens.id,
          userId: idTokens.userId,
          status: idTokens.status,
          expiresAt: idTokens.expiresAt,
          scopeInstallationId: idTokens.scopeInstallationId,
          userStatus: users.status,
          hasAccess: sql<boolean>`exists (
            select 1
            from ${driverGroupMemberships} m
            join ${driverGroups} g on g.id = m.driver_group_id
            join ${agreements} a on a.id = g.agreement_id
            where m.user_id = ${idTokens.userId}
              and m.period @> ${atTs}::timestamptz
              and a.agreement_type = 'installation'
              and a.installation_id = ${installationId}
              and a.status = 'active'
              and a.effective_from <= ${atTs}::timestamptz
              and (a.effective_until is null or a.effective_until > ${atTs}::timestamptz)
          )`,
        })
        .from(idTokens)
        .innerJoin(users, eq(users.id, idTokens.userId))
        .where(eq(idTokens.value, idTag))
        .limit(1);
      if (!row) return { token: null, userActive: false, hasInstallationAccess: false };
      return {
        token: { id: row.id, userId: row.userId, status: row.status, expiresAt: row.expiresAt, scopeInstallationId: row.scopeInstallationId },
        userActive: row.userStatus === "active",
        hasInstallationAccess: row.hasAccess === true,
      };
    },
  };
}
