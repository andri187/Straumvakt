// Drizzle SyncRepo (Checkpoint D). Reuses the installation read model
// (`loadSnapshot`) for the full tree so there is ONE definition of structure,
// and adds only the narrow queries the delta path needs: version probe, history
// after a revision, entity-by-id lookups and operational-since.
//
// Every query is bounded (by primary key, by an indexed (installation, counter)
// range, or by an explicit limit). None scans a table, and none runs on a timer.

import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { circuits, deviceIdentities, deviceOperationalState, devices, installationChanges, installations, placements } from "@straumvakt/shared/db/assets";
import type { Executor } from "@/lib/installations/db";
import { loadSnapshot } from "@/lib/installations/drizzle-store";
import type { AccessPort, SyncRepo } from "./service";
import type { ChargerView, CircuitView, DeviceStateView, InstallationView, Structure } from "./model";

const openPlacement = sql`upper_inf(${placements.period})`;
const openIdentity = sql`upper_inf(${deviceIdentities.period})`;

const circuitView = (c: { id: string; parentCircuitId: string | null; displayName: string; ampereCeiling: number | null; phaseCount: number | null; sortOrder: number }): CircuitView => ({
  id: c.id, parentId: c.parentCircuitId, displayName: c.displayName, ratingAmps: c.ampereCeiling, phaseCount: c.phaseCount, sortOrder: c.sortOrder,
});

const deviceState = (r: typeof deviceOperationalState.$inferSelect): DeviceStateView => ({
  deviceId: r.deviceId,
  connectors: r.connectors as DeviceStateView["connectors"],
  lastReportedAt: r.lastReportedAt ? r.lastReportedAt.toISOString() : null,
  lastReceivedAt: r.lastReceivedAt.toISOString(),
  seq: r.seq,
});

export function drizzleSyncRepo(x: Executor): SyncRepo {
  return {
    async versions(ids) {
      if (ids.length === 0) return new Map();
      const rows = await x
        .select({ id: installations.id, revision: installations.revision, statusVersion: installations.statusVersion })
        .from(installations)
        .where(and(inArray(installations.id, ids), isNull(installations.archivedAt)));
      return new Map(rows.map((r) => [r.id, { revision: r.revision, statusVersion: r.statusVersion }]));
    },

    async structure(id): Promise<Structure | null> {
      const s = await loadSnapshot(x, id);
      if (!s) return null;
      return {
        installation: { id: s.installation.id, displayName: s.installation.displayName, revision: s.installation.revision, mainRatingAmps: s.installation.mainRatingAmps, mainPhaseCount: s.installation.mainPhaseCount },
        circuits: s.circuits.map((c) => ({ id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: c.ratingAmps, phaseCount: c.phaseCount, sortOrder: c.sortOrder })),
        chargers: s.chargers.map((c) => ({ id: c.id, circuitId: c.circuitId, label: c.label, chargePointId: c.chargePointId, vendor: c.vendor, model: c.model, serialNumber: c.serialNumber })),
      };
    },

    async operational(id) {
      const rows = await x.select().from(deviceOperationalState).where(eq(deviceOperationalState.installationId, id)).orderBy(asc(deviceOperationalState.seq));
      return rows.map(deviceState);
    },

    async historyAfter(id, afterRevision, limit) {
      const rows = await x
        .select({ revision: installationChanges.revision, entityType: installationChanges.entityType, entityId: installationChanges.entityId, action: installationChanges.action })
        .from(installationChanges)
        .where(and(eq(installationChanges.installationId, id), gt(installationChanges.revision, afterRevision)))
        .orderBy(asc(installationChanges.revision), asc(installationChanges.occurredAt))
        .limit(limit);
      return rows;
    },

    async installationView(id): Promise<InstallationView | null> {
      const [i] = await x
        .select({ id: installations.id, displayName: installations.displayName, revision: installations.revision, mainRatingAmps: installations.mainRatingAmps, mainPhaseCount: installations.mainPhaseCount })
        .from(installations)
        .where(and(eq(installations.id, id), isNull(installations.archivedAt)));
      return i ?? null;
    },

    async circuitsByIds(installationId, ids) {
      if (ids.length === 0) return [];
      const rows = await x.select().from(circuits).where(and(eq(circuits.installationId, installationId), inArray(circuits.id, ids), isNull(circuits.archivedAt)));
      return rows.map(circuitView);
    },

    async chargersByIds(installationId, ids) {
      if (ids.length === 0) return [];
      const rows = await x
        .select({ deviceId: devices.id, vendor: devices.vendor, model: devices.model, serialNumber: devices.serialNumber, circuitId: placements.circuitId, label: placements.label, chargePointId: deviceIdentities.chargePointId, identity: deviceIdentities.identityString })
        .from(placements)
        .innerJoin(devices, eq(devices.id, placements.deviceId))
        .leftJoin(deviceIdentities, and(eq(deviceIdentities.deviceId, devices.id), openIdentity))
        .where(and(eq(placements.installationId, installationId), inArray(devices.id, ids), openPlacement));
      return rows
        .filter((r) => r.circuitId !== null)
        .map((r): ChargerView => ({ id: r.deviceId, circuitId: r.circuitId as string, label: r.label ?? "", chargePointId: r.chargePointId ?? r.identity ?? "", vendor: r.vendor, model: r.model, serialNumber: r.serialNumber }));
    },

    async operationalSince(id, afterSeq, limit) {
      const rows = await x
        .select()
        .from(deviceOperationalState)
        .where(and(eq(deviceOperationalState.installationId, id), gt(deviceOperationalState.seq, afterSeq)))
        .orderBy(asc(deviceOperationalState.seq))
        .limit(limit);
      return rows.map(deviceState);
    },
  };
}

/**
 * Effective access for the shell today: the single shared login administers every
 * non-archived installation (`mayAdminister`). When per-CPO accounts exist this is
 * the one place that narrows to the actor's own organisations; the service already
 * re-resolves it on every call, so narrowing it needs no change anywhere else.
 */
export function drizzleSharedLoginAccess<Actor>(x: Executor, mayAdminister: (a: Actor) => boolean): AccessPort<Actor> {
  return {
    async visible(actor) {
      if (!mayAdminister(actor)) return null;
      const rows = await x.select({ id: installations.id }).from(installations).where(isNull(installations.archivedAt)).limit(51);
      return { installationIds: rows.map((r) => r.id) };
    },
  };
}
