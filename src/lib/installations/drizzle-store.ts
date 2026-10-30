// Drizzle implementation of the installation-management store, plus the
// read-side queries the pages and API use.
//
// NOT EXECUTED AGAINST POSTGRES. These queries and the migration they rely on
// (apps/api/drizzle/0002_installation_management.sql, with 0000 and 0001) have
// been type-checked and reviewed only; no database was contacted. The catalog,
// constraint, concurrency and read-back checks that prove them are listed in
// docs/agent-runs/2026-10-29/ and must be run on the approved target.
//
// Reads fetch on demand and paginate; nothing polls.

import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import {
  circuits,
  devices,
  deviceIdentities,
  installationChanges,
  installations,
  lifecycleRequests,
  placements,
  properties,
  sites,
} from "@straumvakt/shared/db/assets";
import { ocppTransactions } from "@straumvakt/shared/db/charging";
import { organizations } from "@straumvakt/shared/db/identity";
import type { Db, Executor, Tx } from "./db";
import {
  isReservedRoutingLabel,
  routingLabelFromName,
  storedIdentity,
  type CircuitState,
  type ChargerState,
  type InstallationState,
  type PasswordMode,
  type Phases,
  type Snapshot,
} from "./model";
import { SaveError, type ChangeRow, type Store, type TxPort } from "./store";

const openPlacement = sql`upper_inf(${placements.period})`;
const openIdentity = sql`upper_inf(${deviceIdentities.period})`;
const openRange = sql`tstzrange(clock_timestamp(), NULL, '[)')`;

function pgCode(error: unknown): { code?: string; constraint?: string } {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  return { code: e?.code ?? e?.cause?.code, constraint: e?.constraint ?? e?.cause?.constraint };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ── Read side ──────────────────────────────────────────────────────────────

export async function loadSnapshot(x: Executor, installationId: string): Promise<Snapshot | null> {
  const [i] = await x
    .select()
    .from(installations)
    .where(and(eq(installations.id, installationId), isNull(installations.archivedAt)));
  if (!i || !i.installationKey) return null;

  const cs = await x
    .select()
    .from(circuits)
    .where(and(eq(circuits.installationId, installationId), isNull(circuits.archivedAt)))
    .orderBy(asc(circuits.sortOrder), asc(circuits.createdAt));

  const rows = await x
    .select({
      deviceId: devices.id,
      vendor: devices.vendor,
      model: devices.model,
      serialNumber: devices.serialNumber,
      placementId: placements.id,
      circuitId: placements.circuitId,
      label: placements.label,
      identity: deviceIdentities.identityString,
    })
    .from(placements)
    .innerJoin(devices, eq(devices.id, placements.deviceId))
    .leftJoin(deviceIdentities, and(eq(deviceIdentities.deviceId, devices.id), openIdentity))
    .where(and(eq(placements.installationId, installationId), openPlacement))
    .orderBy(asc(placements.createdAt));

  const prefix = `${i.installationKey}/`;
  const installation: InstallationState = {
    id: i.id,
    orgId: i.orgId,
    siteId: i.siteId,
    key: i.installationKey,
    displayName: i.displayName,
    revision: i.revision,
    mainDeviceType: i.mainDeviceType,
    mainRatingAmps: i.mainRatingAmps,
    mainPhaseCount: (i.mainPhaseCount as Phases) ?? null,
    electrician: { name: i.electricianName, email: i.electricianEmail, phone: i.electricianPhone },
    electricianChangedRevision: i.electricianChangedRevision,
    responsibleConfirmedRevision: i.responsibleConfirmedRevision,
    passwordMode: i.ocppPasswordMode as PasswordMode,
    passwordSetAt: iso(i.ocppPasswordSetAt),
  };
  const circuitStates: CircuitState[] = cs.map((c) => ({
    id: c.id,
    parentId: c.parentCircuitId,
    displayName: c.displayName,
    ratingAmps: c.ampereCeiling,
    phaseCount: (c.phaseCount as Phases) ?? null,
    sortOrder: c.sortOrder,
  }));
  const chargers: ChargerState[] = rows
    .filter((r) => r.circuitId !== null)
    .map((r) => ({
      id: r.deviceId,
      placementId: r.placementId,
      circuitId: r.circuitId as string,
      label: r.label ?? "",
      chargePointId: r.identity?.startsWith(prefix) ? r.identity.slice(prefix.length) : (r.identity ?? ""),
      vendor: r.vendor,
      model: r.model,
      serialNumber: r.serialNumber,
    }));
  return { installation, circuits: circuitStates, chargers };
}

export type InstallationListRow = {
  id: string;
  key: string;
  displayName: string;
  orgId: string;
  orgName: string;
  siteName: string;
  revision: number;
  circuitCount: number;
  chargerCount: number;
  updatedAt: string;
};

export async function listInstallations(x: Executor, opts: { limit: number; offset: number }): Promise<InstallationListRow[]> {
  const rows = await x
    .select({
      id: installations.id,
      key: installations.installationKey,
      displayName: installations.displayName,
      orgId: installations.orgId,
      orgName: organizations.displayName,
      siteName: sites.displayName,
      revision: installations.revision,
      updatedAt: installations.updatedAt,
      circuitCount: sql<number>`(select count(*)::int from ${circuits} c where c.installation_id = ${installations.id} and c.archived_at is null)`,
      chargerCount: sql<number>`(select count(*)::int from ${placements} p where p.installation_id = ${installations.id} and upper_inf(p.period))`,
    })
    .from(installations)
    .innerJoin(organizations, eq(organizations.id, installations.orgId))
    .innerJoin(sites, eq(sites.id, installations.siteId))
    .where(and(isNull(installations.archivedAt), sql`${installations.installationKey} is not null`))
    .orderBy(desc(installations.updatedAt), asc(installations.id))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r) => ({ ...r, key: r.key as string, updatedAt: r.updatedAt.toISOString() }));
}

export type ChargerListRow = {
  deviceId: string;
  label: string;
  chargePointId: string;
  installationId: string;
  installationName: string;
  circuitName: string | null;
  vendor: string | null;
  model: string | null;
};

export async function listChargers(x: Executor, opts: { limit: number; offset: number }): Promise<ChargerListRow[]> {
  const rows = await x
    .select({
      deviceId: devices.id,
      label: placements.label,
      identity: deviceIdentities.identityString,
      installationId: installations.id,
      installationKey: installations.installationKey,
      installationName: installations.displayName,
      circuitName: circuits.displayName,
      vendor: devices.vendor,
      model: devices.model,
    })
    .from(placements)
    .innerJoin(devices, eq(devices.id, placements.deviceId))
    .innerJoin(installations, eq(installations.id, placements.installationId))
    .leftJoin(circuits, eq(circuits.id, placements.circuitId))
    .leftJoin(deviceIdentities, and(eq(deviceIdentities.deviceId, devices.id), openIdentity))
    .where(and(openPlacement, isNull(installations.archivedAt)))
    .orderBy(asc(installations.displayName), asc(placements.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r) => ({
    deviceId: r.deviceId,
    label: r.label ?? "",
    chargePointId: r.identity?.startsWith(`${r.installationKey}/`) ? r.identity.slice((r.installationKey ?? "").length + 1) : (r.identity ?? ""),
    installationId: r.installationId,
    installationName: r.installationName,
    circuitName: r.circuitName,
    vendor: r.vendor,
    model: r.model,
  }));
}

export type HistoryEntry = {
  id: string;
  revision: number;
  entityType: string;
  entityId: string | null;
  action: string;
  diff: Record<string, { from: unknown; to: unknown }>;
  actorLabel: string;
  effectiveAt: string | null;
  occurredAt: string;
};

export async function loadHistory(x: Executor, installationId: string, limit = 100): Promise<HistoryEntry[]> {
  const rows = await x
    .select()
    .from(installationChanges)
    .where(eq(installationChanges.installationId, installationId))
    .orderBy(desc(installationChanges.occurredAt), desc(installationChanges.revision))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    diff: r.diff as HistoryEntry["diff"],
    actorLabel: r.actorLabel,
    effectiveAt: iso(r.effectiveAt),
    occurredAt: r.occurredAt.toISOString(),
  }));
}

export async function loadRoutingId(x: Executor, orgId: string): Promise<string | null> {
  const [o] = await x.select({ r: organizations.cpoRoutingId }).from(organizations).where(eq(organizations.id, orgId));
  return o?.r ?? null;
}

export type Directory = {
  organisations: { id: string; displayName: string; routingId: string | null }[];
  sites: { id: string; orgId: string; displayName: string; address: string | null }[];
};

export async function loadDirectory(x: Executor, opts: { limit: number } = { limit: 200 }): Promise<Directory> {
  const orgs = await x
    .select({ id: organizations.id, displayName: organizations.displayName, routingId: organizations.cpoRoutingId })
    .from(organizations)
    .where(and(eq(organizations.status, "active"), sql`'cpo' = any(${organizations.roles})`))
    .orderBy(asc(organizations.displayName))
    .limit(opts.limit);
  const ids = orgs.map((o) => o.id);
  if (ids.length === 0) return { organisations: [], sites: [] };
  const ss = await x
    .select({ id: sites.id, orgId: sites.orgId, displayName: sites.displayName, address: sql<string | null>`${properties.address}->>'line'` })
    .from(sites)
    .innerJoin(properties, eq(properties.id, sites.propertyId))
    .where(inArray(sites.orgId, ids))
    .orderBy(asc(sites.displayName))
    .limit(opts.limit * 5);
  return { organisations: orgs, sites: ss };
}

/** Minimal platform-operator administration so a fresh target is usable without a bootstrap script. */
export async function createCpoOrganisation(db: Db, input: { displayName: string }): Promise<{ id: string }> {
  const [row] = await db
    .insert(organizations)
    .values({ displayName: input.displayName, countryCode: "IS", roles: ["cpo"], kind: "company" })
    .returning({ id: organizations.id });
  return row;
}

export async function createSite(db: Db, input: { orgId: string; displayName: string; address: string | null }): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const [org] = await tx.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, input.orgId), sql`'cpo' = any(${organizations.roles})`));
    if (!org) return null;
    const [property] = await tx
      .insert(properties)
      .values({ orgId: input.orgId, displayName: input.displayName, address: input.address ? { line: input.address } : {} })
      .returning({ id: properties.id });
    const [site] = await tx
      .insert(sites)
      .values({ orgId: input.orgId, propertyId: property.id, displayName: input.displayName })
      .returning({ id: sites.id });
    return site;
  });
}

// ── Write side ─────────────────────────────────────────────────────────────

function txPort(tx: Tx): TxPort {
  const requireCircuit = async (circuitId: string, installationId: string) => {
    const [c] = await tx
      .select({ id: circuits.id })
      .from(circuits)
      .where(and(eq(circuits.id, circuitId), eq(circuits.installationId, installationId), isNull(circuits.archivedAt)));
    if (!c) throw new SaveError("validation", "Circuit does not belong to this installation", [{ path: "circuitId", message: "Not in this installation" }]);
  };

  const serialTaken = async (serial: string, exceptDeviceId?: string) => {
    const [d] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(sql`lower(${devices.serialNumber}) = lower(${serial})`, exceptDeviceId ? ne(devices.id, exceptDeviceId) : undefined));
    if (d) {
      // Deliberately no detail about where that device is: it may belong to another CPO.
      throw new SaveError("serial_in_use", "That serial number is already registered. If this charger was installed here before, return the known charger instead of adding a new one; otherwise contact support. Nothing about where else it may be registered is shown.");
    }
  };

  const identityTaken = async (identity: string, exceptDeviceId?: string) => {
    const [i] = await tx
      .select({ id: deviceIdentities.id })
      .from(deviceIdentities)
      .where(and(eq(deviceIdentities.identityString, identity), openIdentity, exceptDeviceId ? ne(deviceIdentities.deviceId, exceptDeviceId) : undefined));
    if (i) throw new SaveError("identity_in_use", "That charge point id is already in use.");
  };

  const closeOpenIdentity = async (deviceId: string) => {
    await tx
      .update(deviceIdentities)
      .set({ period: sql`tstzrange(lower(${deviceIdentities.period}), GREATEST(clock_timestamp(), lower(${deviceIdentities.period}) + interval '1 millisecond'), '[)')` })
      .where(and(eq(deviceIdentities.deviceId, deviceId), openIdentity));
  };

  const openIdentityRow = async (deviceId: string, identity: string, note: string) => {
    await tx.insert(deviceIdentities).values({ deviceId, identityString: identity, period: sql`tstzrange(clock_timestamp(), NULL, '[)')` as unknown as string, note });
  };

  return {
    async findReplay(key) {
      const [r] = await tx.select({ id: installationChanges.installationId }).from(installationChanges).where(eq(installationChanges.idempotencyKey, key));
      return r?.id ?? null;
    },
    loadSnapshot: (id) => loadSnapshot(tx, id),
    async loadSite(siteId, orgId) {
      const [r] = await tx
        .select({ name: organizations.displayName, routing: organizations.cpoRoutingId })
        .from(sites)
        .innerJoin(organizations, eq(organizations.id, sites.orgId))
        .where(and(eq(sites.id, siteId), eq(sites.orgId, orgId)));
      return r ? { orgDisplayName: r.name, routingId: r.routing } : null;
    },
    async ensureRoutingId(orgId, orgDisplayName) {
      const existing = await loadRoutingId(tx, orgId);
      if (existing) return existing;
      const base = routingLabelFromName(orgDisplayName);
      for (let attempt = 0; attempt < 8; attempt++) {
        const suffix = attempt === 0 ? "" : `-${crypto.randomUUID().slice(0, 4)}`;
        const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`.replace(/-+$/g, "");
        if (isReservedRoutingLabel(candidate)) continue;
        const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.cpoRoutingId, candidate));
        if (taken) continue;
        await tx.update(organizations).set({ cpoRoutingId: candidate }).where(and(eq(organizations.id, orgId), isNull(organizations.cpoRoutingId)));
        return (await loadRoutingId(tx, orgId)) ?? candidate;
      }
      throw new SaveError("unavailable", "Could not allocate a routing label for this organisation");
    },
    async insertInstallation(r) {
      await tx.insert(installations).values({
        id: r.id,
        orgId: r.orgId,
        siteId: r.siteId,
        displayName: r.displayName,
        installationKey: r.key,
        revision: 1,
        mainDeviceType: r.mainDeviceType,
        mainRatingAmps: r.mainRatingAmps,
        mainPhaseCount: r.mainPhaseCount,
        electricianName: r.electricianName,
        electricianEmail: r.electricianEmail,
        electricianPhone: r.electricianPhone,
        electricianChangedRevision: r.electricianChangedRevision,
      });
    },
    async bumpRevision(id, expected) {
      const rows = await tx
        .update(installations)
        .set({ revision: sql`${installations.revision} + 1` })
        .where(and(eq(installations.id, id), eq(installations.revision, expected), isNull(installations.archivedAt)))
        .returning({ revision: installations.revision });
      return rows[0]?.revision ?? null;
    },
    async patchInstallation(id, patch) {
      await tx.update(installations).set(patch).where(eq(installations.id, id));
    },
    async setPassword(id, mode, verifier) {
      await tx
        .update(installations)
        .set({ ocppPasswordMode: mode, ocppPasswordVerifier: verifier, ocppPasswordSetAt: new Date() })
        .where(eq(installations.id, id));
    },

    async insertCircuit(r) {
      if (r.parentId) await requireCircuit(r.parentId, r.installationId);
      await tx.insert(circuits).values({
        id: r.id,
        orgId: r.orgId,
        siteId: r.siteId,
        installationId: r.installationId,
        parentCircuitId: r.parentId,
        displayName: r.displayName,
        ampereCeiling: r.ratingAmps,
        phaseCount: r.phaseCount,
        sortOrder: r.sortOrder,
      });
    },
    async updateCircuit(id, patch) {
      if (patch.parentId) {
        const [self] = await tx.select({ installationId: circuits.installationId }).from(circuits).where(eq(circuits.id, id));
        if (!self?.installationId) throw new SaveError("not_found", "Circuit not found");
        await requireCircuit(patch.parentId, self.installationId);
      }
      const { ratingAmps, parentId, ...rest } = patch;
      await tx
        .update(circuits)
        .set({
          ...rest,
          ...(ratingAmps !== undefined ? { ampereCeiling: ratingAmps } : {}),
          ...(parentId !== undefined ? { parentCircuitId: parentId } : {}),
        })
        .where(eq(circuits.id, id));
    },
    async archiveCircuit(id) {
      const [child] = await tx.select({ id: circuits.id }).from(circuits).where(and(eq(circuits.parentCircuitId, id), isNull(circuits.archivedAt)));
      const [placed] = await tx.select({ id: placements.id }).from(placements).where(and(eq(placements.circuitId, id), openPlacement));
      if (child || placed) throw new SaveError("validation", "A circuit with sub-circuits or chargers cannot be removed", [{ path: "circuits", message: "Not empty" }]);
      await tx.update(circuits).set({ archivedAt: new Date() }).where(eq(circuits.id, id));
    },

    async attachCharger(r) {
      await requireCircuit(r.circuitId, r.installationId);
      if (r.serialNumber) await serialTaken(r.serialNumber);
      const identity = storedIdentity(r.installationKey, r.chargePointId);
      await identityTaken(identity);
      await tx.insert(devices).values({ id: r.deviceId, vendor: r.vendor, model: r.model, serialNumber: r.serialNumber });
      await openIdentityRow(r.deviceId, identity, "registered with installation");
      await tx.insert(placements).values({
        deviceId: r.deviceId,
        orgId: r.orgId,
        installationId: r.installationId,
        siteId: r.siteId,
        circuitId: r.circuitId,
        label: r.label,
        period: openRange as unknown as string,
      });
    },
    async updateCharger(r) {
      const { label, chargePointId, ...hardware } = r.patch;
      if (hardware.serialNumber) await serialTaken(hardware.serialNumber, r.deviceId);
      if (Object.keys(hardware).length > 0) await tx.update(devices).set(hardware).where(eq(devices.id, r.deviceId));
      // The open placement, not `r.placementId`: a move in the same save has already replaced it.
      if (label !== undefined) await tx.update(placements).set({ label }).where(and(eq(placements.deviceId, r.deviceId), openPlacement));
      if (chargePointId !== undefined) {
        const identity = storedIdentity(r.installationKey, chargePointId);
        await identityTaken(identity, r.deviceId);
        await closeOpenIdentity(r.deviceId);
        await openIdentityRow(r.deviceId, identity, "charge point id changed");
      }
    },
    async moveCharger(r) {
      await requireCircuit(r.circuitId, r.installationId);
      const closed = await tx
        .update(placements)
        .set({ period: sql`tstzrange(lower(${placements.period}), GREATEST(clock_timestamp(), lower(${placements.period}) + interval '1 millisecond'), '[)')`, detachReason: "moved to another circuit" })
        .where(and(eq(placements.id, r.placementId), eq(placements.deviceId, r.deviceId), openPlacement))
        .returning({ id: placements.id });
      if (closed.length === 0) throw new SaveError("validation", "Charger placement changed — reload and try again");
      await tx.insert(placements).values({
        deviceId: r.deviceId,
        orgId: r.orgId,
        installationId: r.installationId,
        siteId: r.siteId,
        circuitId: r.circuitId,
        label: r.label,
        period: sql`tstzrange(clock_timestamp(), NULL, '[)')` as unknown as string,
      });
    },
    async detachBlockReason(deviceId) {
      // Coordinate the plain-save path with a StartTransaction before counting.
      // A new start holds this placement FOR SHARE until its transaction commits.
      await tx.select({ id: placements.id }).from(placements).where(and(eq(placements.deviceId, deviceId), openPlacement)).for("update");
      // A later start is not proof that an earlier session stopped.
      const [session] = await tx.select({ id: ocppTransactions.id }).from(ocppTransactions).where(and(eq(ocppTransactions.deviceId, deviceId), isNull(ocppTransactions.stoppedReceivedAt))).limit(1);
      const [request] = await tx.select({ id: lifecycleRequests.id }).from(lifecycleRequests).where(and(eq(lifecycleRequests.deviceId, deviceId), notInArray(lifecycleRequests.state, ["completed", "cancelled"]))).limit(1);
      return session || request
        ? "This charger has a session in progress or a removal already open. Use Remove charger, which stops and settles the session, instead of deleting it here."
        : null;
    },
    async detachCharger(r) {
      await tx
        .update(placements)
        .set({ period: sql`tstzrange(lower(${placements.period}), GREATEST(clock_timestamp(), lower(${placements.period}) + interval '1 millisecond'), '[)')`, detachReason: r.reason })
        .where(and(eq(placements.id, r.placementId), eq(placements.deviceId, r.deviceId), openPlacement));
      await closeOpenIdentity(r.deviceId);
    },

    async insertChanges(rows: ChangeRow[]) {
      if (rows.length === 0) return;
      await tx.insert(installationChanges).values(rows.map((c) => ({ ...c })));
    },
  };
}

/**
 * Store over a request-scoped Drizzle client. A concurrent double-submit that
 * loses the idempotency-key race is retried once so it is answered as a replay
 * rather than reported as an error; constraint violations that mean "already
 * in use" become the same typed errors the service raises itself.
 */
export function drizzleStore(db: Db): Store {
  return {
    async transaction(fn) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await db.transaction((tx) => fn(txPort(tx)));
        } catch (error) {
          if (error instanceof SaveError) throw error;
          const { code, constraint } = pgCode(error);
          if (code === "23505" && constraint?.includes("idempotency_key") && attempt === 0) continue;
          if (code === "23P01" || (code === "23505" && constraint?.includes("device_identities"))) {
            throw new SaveError("identity_in_use", "That charge point id is already in use.");
          }
          if (code === "23505" && constraint?.includes("devices_vendor_serial")) {
            throw new SaveError("serial_in_use", "That serial number is already registered. If this charger was installed here before, return the known charger instead of adding a new one; otherwise contact support. Nothing about where else it may be registered is shown.");
          }
          throw error;
        }
      }
    },
  };
}
