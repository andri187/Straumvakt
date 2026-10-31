// Drizzle adapters for admission and authorization.
//
// Read-mostly and deliberately small: admission is ONE query for the CPO (by the
// host's routing id) and ONE for its identity rows with their placements and the
// placed installations; authorization is ONE query (token + user + access
// EXISTS). The only write is the throttled discovery upsert. No Prisma, no
// Hyperdrive, no scheduled work.

import { and, eq, sql } from "drizzle-orm";
import { deviceIdentities, installations, placements } from "@straumvakt/shared/db/assets";
import { agreements, driverGroupMemberships, driverGroups } from "@straumvakt/shared/db/commercial";
import { idTokens, organizations, users } from "@straumvakt/shared/db/identity";
import { pendingDiscoveries } from "@straumvakt/shared/db/protocol";
import { identityRow } from "@/lib/installations/model";
import type { Db, Executor } from "@/lib/installations/db";
import type { AdmissionInstallation, AdmissionLookup, AdmissionStore } from "./admission";
import type { AuthorizationStore } from "./authorization";
import { MAX_PENDING_IDENTITIES_PER_CPO, PENDING_CAPTURE_EVICT_AFTER_DAYS } from "./pending";
import { classifyRegistration, type PendingStore } from "./pending-service";

/** A repeat attempt from the same unregistered charger writes at most once per window. */
export const DISCOVERY_WRITE_INTERVAL_SECONDS = 300;

export function drizzleAdmissionStore(db: Executor): AdmissionStore {
  return {
    async lookup(route, at): Promise<AdmissionLookup> {
      const [org] = await db
        .select({ id: organizations.id, status: organizations.status })
        .from(organizations)
        .where(eq(organizations.cpoRoutingId, route.routingId))
        .limit(1);
      if (!org) return { org: null, identities: [] };

      // Scoped to THIS CPO by column, so the same charge point id in another CPO is never seen. Case-insensitive on
      // purpose: the caller decides exact vs case-only match. A row whose CPO columns are NULL (an old identity that
      // matched no installation when it was migrated) cannot match and is never admitted.
      const atTs = at.toISOString();
      const rows = await db
        .select({
          deviceId: deviceIdentities.deviceId,
          chargePointId: deviceIdentities.chargePointId,
          identityString: deviceIdentities.identityString,
          current: sql<boolean>`${deviceIdentities.period} @> ${atTs}::timestamptz`,
          placementId: placements.id,
          placementOrgId: placements.orgId,
          placementInstallationId: placements.installationId,
          placementCurrent: sql<boolean | null>`${placements.period} @> ${atTs}::timestamptz`,
          instId: installations.id,
          instOrgId: installations.orgId,
          instArchivedAt: installations.archivedAt,
          mode: installations.ocppPasswordMode,
          verifier: installations.ocppPasswordVerifier,
          setAt: installations.ocppPasswordSetAt,
        })
        .from(deviceIdentities)
        .leftJoin(placements, eq(placements.deviceId, deviceIdentities.deviceId))
        .leftJoin(installations, eq(installations.id, placements.installationId))
        .where(and(eq(deviceIdentities.cpoOrgId, org.id), sql`lower(${deviceIdentities.chargePointId}) = lower(${route.chargePointId})`));

      const byIdentity = new Map<string, AdmissionLookup["identities"][number]>();
      for (const r of rows) {
        if (r.chargePointId === null) continue;
        const k = `${r.deviceId}|${r.identityString}|${r.current}`;
        let entry = byIdentity.get(k);
        if (!entry) {
          entry = { deviceId: r.deviceId, chargePointId: r.chargePointId, identityString: r.identityString, current: r.current, placements: [] };
          byIdentity.set(k, entry);
        }
        if (r.placementId && r.placementOrgId && r.placementInstallationId) {
          const installation: AdmissionInstallation | null = r.instId
            ? {
                id: r.instId,
                orgId: r.instOrgId as string,
                archived: r.instArchivedAt !== null,
                passwordMode: r.mode === "none" || r.mode === "password" ? r.mode : "unset",
                passwordVerifier: r.verifier,
                credentialEpoch: `${r.mode}:${r.setAt?.getTime() ?? 0}`,
              }
            : null;
          entry.placements.push({ id: r.placementId, orgId: r.placementOrgId, installationId: r.placementInstallationId, current: r.placementCurrent === true, installation });
        }
      }

      return { org: { id: org.id, active: org.status === "active" }, identities: [...byIdentity.values()] };
    },

    async recordDiscovery({ orgId, chargePointId, at, reason }) {
      // Keyed per CPO, so the same id knocking on two CPOs is two rows.
      const identity = identityRow(orgId, chargePointId).identityString;
      await db
        .insert(pendingDiscoveries)
        .values({ identityString: identity, firstSeenAt: at, lastSeenAt: at, attemptCount: 1, ...(reason ? { lastPayloadSummary: { reason, reasonAt: at.toISOString() } } : {}) })
        .onConflictDoUpdate({
          target: pendingDiscoveries.identityString,
          // Merged, not replaced: a captured BootNotification (key `boot`) must survive a later refusal reason.
          set: { lastSeenAt: at, attemptCount: sql`${pendingDiscoveries.attemptCount} + 1`, ...(reason ? { lastPayloadSummary: sql`coalesce(${pendingDiscoveries.lastPayloadSummary}, '{}'::jsonb) || ${JSON.stringify({ reason, reasonAt: at.toISOString() })}::jsonb` } : {}) },
          setWhere: sql`${pendingDiscoveries.lastSeenAt} < ${at.toISOString()}::timestamptz - make_interval(secs => ${DISCOVERY_WRITE_INTERVAL_SECONDS})`,
        });
    },
  };
}

/**
 * Pending onboarding persistence. The capture lives in the existing `last_payload_summary` jsonb of the CPO-scoped
 * discovery row under the key `boot`, so there is no second registry and no schema change. `reason` (a recorded
 * refusal) is a sibling key and is never touched here.
 */
export function drizzlePendingStore(db: Executor): PendingStore {
  const admission = drizzleAdmissionStore(db);
  const keyOf = (orgId: string, chargePointId: string) => identityRow(orgId, chargePointId).identityString;
  return {
    async registration({ routingId, chargePointId, at }) {
      const found = await admission.lookup({ routingId, chargePointId }, at);
      return { state: classifyRegistration(found, chargePointId), orgId: found.org?.id ?? null };
    },

    async storeBoot({ orgId, chargePointId, capture, at }) {
      const key = keyOf(orgId, chargePointId);
      // One transaction under a per-CPO advisory lock, so the count and the write cannot race: the cap below is a real cap.
      return (db as Db).transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pending-capture:${orgId}`}))`);
        const [existing] = await tx
          .select({ hash: sql<string | null>`${pendingDiscoveries.lastPayloadSummary}->'boot'->>'hash'`, hasBoot: sql<boolean>`(${pendingDiscoveries.lastPayloadSummary}->'boot') is not null` })
          .from(pendingDiscoveries)
          .where(eq(pendingDiscoveries.identityString, key));
        // The same boot again is not a write. The gateway still answers it; only storage is skipped.
        if (existing?.hash === capture.hash) return "unchanged" as const;

        if (!existing?.hasBoot) {
          const prefix = `${orgId}/%`;
          const [counted] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(pendingDiscoveries)
            .where(and(sql`${pendingDiscoveries.identityString} like ${prefix}`, sql`(${pendingDiscoveries.lastPayloadSummary}->'boot') is not null`));
          if ((counted?.n ?? 0) >= MAX_PENDING_IDENTITIES_PER_CPO) {
            // Evict ONE capture body (never a row) from the oldest idle row whose charger was never registered here. A registered
            // charger's retained body is never a candidate, and neither is anything seen inside the retention window.
            const cutoff = new Date(at.getTime() - PENDING_CAPTURE_EVICT_AFTER_DAYS * 86_400_000).toISOString();
            const evicted = await tx
              .update(pendingDiscoveries)
              .set({ lastPayloadSummary: sql`${pendingDiscoveries.lastPayloadSummary} - 'boot'` })
              .where(
                sql`${pendingDiscoveries.identityString} = (
                  select p.identity_string from ${pendingDiscoveries} p
                  where p.identity_string like ${prefix}
                    and (p.last_payload_summary->'boot') is not null
                    and p.last_seen_at < ${cutoff}::timestamptz
                    and not exists (
                      select 1 from ${deviceIdentities} di
                      where di.cpo_org_id = ${orgId}::uuid
                        and lower(di.charge_point_id) = lower(substring(p.identity_string from ${orgId.length + 2}::int))
                    )
                  order by p.last_seen_at asc
                  limit 1
                )`,
              )
              .returning({ k: pendingDiscoveries.identityString });
            if (evicted.length === 0) return "full" as const;
          }
        }

        const body = JSON.stringify(capture);
        const merged = sql`jsonb_set(coalesce(${pendingDiscoveries.lastPayloadSummary}, '{}'::jsonb), '{boot}', ${body}::jsonb)`;
        await tx
          .insert(pendingDiscoveries)
          .values({ identityString: key, firstSeenAt: at, lastSeenAt: at, attemptCount: 1, lastPayloadSummary: { boot: capture } })
          .onConflictDoUpdate({ target: pendingDiscoveries.identityString, set: { lastSeenAt: at, lastPayloadSummary: merged } });
        return "stored" as const;
      });
    },

    async hasCapture({ orgId, chargePointId }) {
      const [r] = await db
        .select({ has: sql<boolean>`(${pendingDiscoveries.lastPayloadSummary}->'boot') is not null` })
        .from(pendingDiscoveries)
        .where(eq(pendingDiscoveries.identityString, keyOf(orgId, chargePointId)));
      return r?.has === true;
    },

    async touch({ orgId, chargePointId, at }) {
      await db
        .insert(pendingDiscoveries)
        .values({ identityString: keyOf(orgId, chargePointId), firstSeenAt: at, lastSeenAt: at, attemptCount: 1 })
        .onConflictDoUpdate({
          target: pendingDiscoveries.identityString,
          set: { lastSeenAt: at },
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
