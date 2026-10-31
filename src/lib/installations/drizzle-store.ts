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
  installationDrafts,
  installations,
  lifecycleRequests,
  placements,
  properties,
  sites,
} from "@straumvakt/shared/db/assets";
import { ocppTransactions } from "@straumvakt/shared/db/charging";
import { vendors } from "@straumvakt/shared/db/catalog";
import { organizations } from "@straumvakt/shared/db/identity";
import { pendingDiscoveries, protocolReceipts } from "@straumvakt/shared/db/protocol";
import type { Db, Executor, Tx } from "./db";
import {
  isReservedRoutingLabel,
  routingLabelFromName,
  identityRow,
  type CircuitState,
  type ChargerState,
  type InstallationState,
  type PasswordMode,
  type Phases,
  type Snapshot,
} from "./model";
import { CHARGE_POINT_ID } from "./address";
import { SaveError, type BootCaptureRow, type ChangeRow, type DiscoveryRow, type Draft, type DraftRow, type DraftState, type Store, type TxPort } from "./store";

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
      chargePointId: deviceIdentities.chargePointId,
      identity: deviceIdentities.identityString,
    })
    .from(placements)
    .innerJoin(devices, eq(devices.id, placements.deviceId))
    .leftJoin(deviceIdentities, and(eq(deviceIdentities.deviceId, devices.id), openIdentity))
    .where(and(eq(placements.installationId, installationId), openPlacement))
    .orderBy(asc(placements.createdAt));

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
    mainGridType: i.mainGridType === "TN" || i.mainGridType === "IT" ? i.mainGridType : null,
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
      // The column, never a parsed string. A row that predates the column and matched nothing shows its stored string whole.
      chargePointId: r.chargePointId ?? r.identity ?? "",
      vendor: r.vendor,
      model: r.model,
      serialNumber: r.serialNumber,
    }));
  const vendorCircuitRefs = Object.fromEntries(cs.filter((c) => c.vendorCircuitRef).map((c) => [c.id, c.vendorCircuitRef as string]));
  return { installation, circuits: circuitStates, chargers, ...(Object.keys(vendorCircuitRefs).length > 0 ? { vendorCircuitRefs } : {}) };
}

export type InstallationListRow = {
  id: string;
  key: string;
  displayName: string;
  orgId: string;
  orgName: string;
  siteId: string;
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
      siteId: installations.siteId,
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
  circuitId: string | null;
  circuitName: string | null;
  vendor: string | null;
  model: string | null;
};

export async function listChargers(x: Executor, opts: { limit: number; offset: number }): Promise<ChargerListRow[]> {
  const rows = await x
    .select({
      deviceId: devices.id,
      label: placements.label,
      chargePointId: deviceIdentities.chargePointId,
      identity: deviceIdentities.identityString,
      installationId: installations.id,
      installationName: installations.displayName,
      circuitId: placements.circuitId,
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
    chargePointId: r.chargePointId ?? r.identity ?? "",
    installationId: r.installationId,
    installationName: r.installationName,
    circuitId: r.circuitId ?? null,
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

type DraftDbRow = typeof installationDrafts.$inferSelect;

function draftRow(r: DraftDbRow): DraftRow {
  return {
    id: r.id,
    orgId: r.orgId,
    state: r.state as DraftState,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    revision: r.revision,
    installationId: r.installationId,
    actorLabel: r.actorLabel,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    closedAt: iso(r.closedAt),
  };
}

const draftColumns = { r: installationDrafts, orgName: organizations.displayName };

export async function loadDraft(x: Executor, id: string): Promise<Draft | null> {
  const [row] = await x
    .select(draftColumns)
    .from(installationDrafts)
    .leftJoin(organizations, eq(organizations.id, installationDrafts.orgId))
    .where(eq(installationDrafts.id, id));
  return row ? { ...draftRow(row.r), orgName: row.orgName } : null;
}

export async function listOpenDrafts(x: Executor, limit: number): Promise<Draft[]> {
  const rows = await x
    .select(draftColumns)
    .from(installationDrafts)
    .leftJoin(organizations, eq(organizations.id, installationDrafts.orgId))
    .where(eq(installationDrafts.state, "open"))
    .orderBy(desc(installationDrafts.updatedAt), asc(installationDrafts.id))
    .limit(limit);
  return rows.map((row) => ({ ...draftRow(row.r), orgName: row.orgName }));
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

/**
 * The CPO's routing label (the {cpo-id} in its connection address): assigned once, from the organisation's name at
 * that moment, collision-checked, reserved labels excluded, and never changed afterwards, not even by a rename.
 */
export async function allocateRoutingId(x: Executor, orgId: string, orgDisplayName: string): Promise<string> {
  const existing = await loadRoutingId(x, orgId);
  if (existing) return existing;
  const base = routingLabelFromName(orgDisplayName);
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = attempt === 0 ? "" : `-${crypto.randomUUID().slice(0, 4)}`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`.replace(/-+$/g, "");
    if (isReservedRoutingLabel(candidate)) continue;
    const [taken] = await x.select({ id: organizations.id }).from(organizations).where(eq(organizations.cpoRoutingId, candidate));
    if (taken) continue;
    await x.update(organizations).set({ cpoRoutingId: candidate }).where(and(eq(organizations.id, orgId), isNull(organizations.cpoRoutingId)));
    return (await loadRoutingId(x, orgId)) ?? candidate;
  }
  throw new SaveError("unavailable", "Could not allocate a routing label for this organisation");
}

/**
 * Minimal platform-operator administration so a fresh target is usable without a bootstrap script. The organisation
 * gets its routing label in the same transaction, so its connection address can be shown immediately.
 */
export async function createCpoOrganisation(db: Db, input: { displayName: string }): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(organizations)
      .values({ displayName: input.displayName, countryCode: "IS", roles: ["cpo"], kind: "company" })
      .returning({ id: organizations.id });
    await allocateRoutingId(tx, row.id, input.displayName);
    return row;
  });
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

  /** The id is held, right now, by another device of the same CPO, whichever installation it is in. */
  const identityTaken = async (cpoOrgId: string, chargePointId: string, exceptDeviceId?: string) => {
    const [i] = await tx
      .select({ id: deviceIdentities.id })
      .from(deviceIdentities)
      .where(
        and(
          eq(deviceIdentities.cpoOrgId, cpoOrgId),
          eq(deviceIdentities.chargePointId, chargePointId),
          openIdentity,
          exceptDeviceId ? ne(deviceIdentities.deviceId, exceptDeviceId) : undefined,
        ),
      );
    if (i) throw new SaveError("identity_in_use", "That charge point id is already in use.");
  };

  // The list and the evidence line never read the captured body: only the refusal reason and the capture's time/message id,
  // pulled out of the jsonb in SQL. The body is fetched by `loadBootCapture`, one row, on demand.
  const discoverySelect = {
    identityString: pendingDiscoveries.identityString,
    firstSeenAt: pendingDiscoveries.firstSeenAt,
    lastSeenAt: pendingDiscoveries.lastSeenAt,
    attemptCount: pendingDiscoveries.attemptCount,
    reason: sql<string | null>`${pendingDiscoveries.lastPayloadSummary}->>'reason'`,
    bootMessageId: sql<string | null>`${pendingDiscoveries.lastPayloadSummary}->'boot'->>'messageId'`,
    bootReceivedAt: sql<string | null>`${pendingDiscoveries.lastPayloadSummary}->'boot'->>'receivedAt'`,
    reasonAt: sql<string | null>`${pendingDiscoveries.lastPayloadSummary}->>'reasonAt'`,
    promote: sql<unknown>`${pendingDiscoveries.lastPayloadSummary}->'promote'`,
  };
  const discoveryOf = (identityString: string, orgId: string, r: { firstSeenAt: Date; lastSeenAt: Date; attemptCount: number; reason: string | null; bootMessageId: string | null; bootReceivedAt: string | null; reasonAt: string | null; promote: unknown }): DiscoveryRow | null => {
    // Only the exact CPO-scoped key is trusted: anything else is a legacy or ambiguous entry and is left out.
    if (!identityString.startsWith(`${orgId}/`)) return null;
    const chargePointId = identityString.slice(orgId.length + 1);
    if (!CHARGE_POINT_ID.test(chargePointId)) return null;
    const receivedAt = r.bootReceivedAt ? new Date(r.bootReceivedAt) : null;
    const boot = r.bootMessageId && receivedAt && !Number.isNaN(receivedAt.getTime()) ? { messageId: r.bootMessageId, receivedAt } : null;
    const reasonAt = r.reasonAt ? new Date(r.reasonAt) : null;
    const pr = r.promote as { at?: unknown; delivered?: unknown; attempts?: unknown; outcome?: unknown } | null;
    const promoteAt = pr && typeof pr.at === "string" ? new Date(pr.at) : null;
    const promote = pr && promoteAt && !Number.isNaN(promoteAt.getTime())
      ? { at: promoteAt, delivered: pr.delivered === true, attempts: typeof pr.attempts === "number" ? pr.attempts : 0, outcome: typeof pr.outcome === "string" ? pr.outcome : null }
      : null;
    return {
      chargePointId, firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, attemptCount: r.attemptCount, reason: typeof r.reason === "string" ? r.reason : null, boot,
      reasonAt: reasonAt && !Number.isNaN(reasonAt.getTime()) ? reasonAt : null, promote,
    };
  };

  const closeOpenIdentity = async (deviceId: string) => {
    await tx
      .update(deviceIdentities)
      .set({ period: sql`tstzrange(lower(${deviceIdentities.period}), GREATEST(clock_timestamp(), lower(${deviceIdentities.period}) + interval '1 millisecond'), '[)')` })
      .where(and(eq(deviceIdentities.deviceId, deviceId), openIdentity));
  };

  const openIdentityRow = async (deviceId: string, cpoOrgId: string, chargePointId: string, note: string) => {
    await tx.insert(deviceIdentities).values({ deviceId, ...identityRow(cpoOrgId, chargePointId), period: sql`tstzrange(clock_timestamp(), NULL, '[)')` as unknown as string, note });
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
    ensureRoutingId: (orgId, orgDisplayName) => allocateRoutingId(tx, orgId, orgDisplayName),
    async loadCpoOrganisation(orgId) {
      const [o] = await tx
        .select({ name: organizations.displayName, routing: organizations.cpoRoutingId })
        .from(organizations)
        .where(and(eq(organizations.id, orgId), eq(organizations.status, "active"), sql`'cpo' = any(${organizations.roles})`));
      return o ? { displayName: o.name, routingId: o.routing } : null;
    },
    loadDraft: (id) => loadDraft(tx, id),
    async lockDraft(id) {
      const [r] = await tx.select().from(installationDrafts).where(eq(installationDrafts.id, id)).for("update");
      return r ? draftRow(r) : null;
    },
    async countOpenDrafts() {
      const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(installationDrafts).where(eq(installationDrafts.state, "open"));
      return r?.n ?? 0;
    },
    listOpenDrafts: (limit) => listOpenDrafts(tx, limit),
    async insertDraft(r) {
      await tx.insert(installationDrafts).values({ id: r.id, orgId: r.orgId, payload: r.payload, actorKind: r.actorKind, actorLabel: r.actorLabel });
    },
    async updateDraft(id, patch) {
      // Only an open draft changes, and only forward: the revision cannot go back.
      const rows = await tx
        .update(installationDrafts)
        .set({ orgId: patch.orgId, payload: patch.payload, revision: sql`${installationDrafts.revision} + 1`, updatedAt: new Date() })
        .where(and(eq(installationDrafts.id, id), eq(installationDrafts.state, "open")))
        .returning({ revision: installationDrafts.revision });
      if (rows.length === 0) throw new SaveError("draft_unavailable", "This draft was already used or discarded.");
      return rows[0].revision;
    },
    async closeDraft(id, to, installationId) {
      // Only an open row can close; a closed one is never reopened or re-closed differently.
      const rows = await tx
        .update(installationDrafts)
        .set({ state: to, installationId, closedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(installationDrafts.id, id), eq(installationDrafts.state, "open")))
        .returning({ id: installationDrafts.id });
      if (rows.length === 0) throw new SaveError("draft_unavailable", "This draft was already used or discarded.");
    },
    async lockVendorImport(orgId, vendor, externalRef) {
      // A transaction-scoped advisory lock: released at commit or rollback, so no unlock path can be forgotten. The key names
      // the CPO, the vendor and the vendor's own installation reference; a waiting import resumes after the first one commits
      // and its next statement (READ COMMITTED) sees the committed row. There is no unique index behind this yet (see handoff).
      const key = `vendor-import:${orgId}:${vendor}:${externalRef}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      const [row] = await tx
        .select({ id: installations.id, archivedAt: installations.archivedAt })
        .from(installations)
        .where(
          and(
            eq(installations.orgId, orgId),
            eq(installations.vendorInstallationRef, externalRef),
            sql`${installations.metadata}->'vendorImport'->>'vendor' = ${vendor}`,
          ),
        )
        .orderBy(asc(installations.createdAt))
        .limit(1);
      return row ? { id: row.id, archived: row.archivedAt !== null } : null;
    },
    async insertInstallation(r) {
      // vendor_id is the catalogue row when one exists. The catalogue may not hold this vendor yet; the import does not
      // create reference data, so the column stays NULL and the vendor is identified by the snapshot's vendor name.
      const [vendorRow] = r.vendorImport ? await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.slug, r.vendorImport.vendor)).limit(1) : [];
      await tx.insert(installations).values({
        id: r.id,
        orgId: r.orgId,
        siteId: r.siteId,
        displayName: r.displayName,
        installationKey: r.key,
        ...(r.vendorImport
          ? { vendorId: vendorRow?.id ?? null, vendorInstallationRef: r.vendorImport.externalRef, metadata: r.vendorImport.metadata }
          : {}),
        revision: 1,
        mainDeviceType: r.mainDeviceType,
        mainRatingAmps: r.mainRatingAmps,
        mainPhaseCount: r.mainPhaseCount,
        mainGridType: r.mainGridType,
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
        ...(r.vendorRef ? { vendorCircuitRef: r.vendorRef } : {}),
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
      await identityTaken(r.orgId, r.chargePointId);
      await tx.insert(devices).values({ id: r.deviceId, vendor: r.vendor, model: r.model, serialNumber: r.serialNumber });
      await openIdentityRow(r.deviceId, r.orgId, r.chargePointId, "registered with installation");
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
        await identityTaken(r.orgId, chargePointId, r.deviceId);
        await closeOpenIdentity(r.deviceId);
        await openIdentityRow(r.deviceId, r.orgId, chargePointId, "charge point id changed");
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

    async listDiscoveries(orgId, limit) {
      const rows = await tx
        .select(discoverySelect)
        .from(pendingDiscoveries)
        .where(sql`${pendingDiscoveries.identityString} like ${`${orgId}/%`}`)
        .orderBy(desc(pendingDiscoveries.lastSeenAt))
        .limit(limit);
      return rows.flatMap((r) => discoveryOf(r.identityString, orgId, r) ?? []);
    },
    async loadDiscovery(orgId, chargePointId) {
      const [r] = await tx
        .select(discoverySelect)
        .from(pendingDiscoveries)
        .where(eq(pendingDiscoveries.identityString, identityRow(orgId, chargePointId).identityString));
      return r ? discoveryOf(r.identityString, orgId, r) : null;
    },
    async markPromotion(orgId, chargePointId, at) {
      const intent = JSON.stringify({ promote: { at: at.toISOString(), delivered: false, attempts: 0, outcome: null } });
      await tx
        .update(pendingDiscoveries)
        .set({ lastPayloadSummary: sql`coalesce(${pendingDiscoveries.lastPayloadSummary}, '{}'::jsonb) || ${intent}::jsonb` })
        .where(eq(pendingDiscoveries.identityString, identityRow(orgId, chargePointId).identityString));
    },
    async recordPromotionOutcome(orgId, chargePointId, result) {
      const col = pendingDiscoveries.lastPayloadSummary;
      await tx
        .update(pendingDiscoveries)
        .set({
          lastPayloadSummary: sql`jsonb_set(${col}, '{promote}', (${col}->'promote') || jsonb_build_object('delivered', ${result.delivered}::boolean, 'outcome', ${result.outcome}::text, 'attempts', coalesce((${col}->'promote'->>'attempts')::int, 0) + 1))`,
        })
        .where(and(eq(pendingDiscoveries.identityString, identityRow(orgId, chargePointId).identityString), sql`(${col}->'promote') is not null`));
    },
    async lastBootAt(orgId, chargePointIds) {
      const lowered = [...new Set(chargePointIds.map((x) => x.toLowerCase()))];
      if (lowered.length === 0) return new Map<string, Date>();
      const id = sql<string>`lower(${deviceIdentities.chargePointId})`;
      const rows = await tx
        .select({ id, at: sql<Date | string>`max(${protocolReceipts.receivedAt})` })
        .from(deviceIdentities)
        .innerJoin(protocolReceipts, eq(protocolReceipts.deviceId, deviceIdentities.deviceId))
        .where(and(eq(deviceIdentities.cpoOrgId, orgId), inArray(id, lowered), eq(protocolReceipts.action, "BootNotification")))
        .groupBy(id);
      return new Map(rows.map((r) => [r.id, r.at instanceof Date ? r.at : new Date(r.at)]));
    },
    async loadBootCapture(orgId, chargePointId) {
      const [r] = await tx
        .select({ boot: sql<unknown>`${pendingDiscoveries.lastPayloadSummary}->'boot'` })
        .from(pendingDiscoveries)
        .where(eq(pendingDiscoveries.identityString, identityRow(orgId, chargePointId).identityString));
      const b = r?.boot as Partial<BootCaptureRow> | null | undefined;
      if (!b || typeof b.messageId !== "string" || typeof b.receivedAt !== "string") return null;
      const v = b.validation as { ok?: unknown; code?: unknown; description?: unknown } | undefined;
      const validation = v && v.ok === false && typeof v.code === "string" && typeof v.description === "string" ? { ok: false as const, code: v.code, description: v.description } : { ok: true as const };
      return { messageId: b.messageId, receivedAt: b.receivedAt, frameBytes: typeof b.frameBytes === "number" ? b.frameBytes : 0, validation, payload: b.payload ?? null };
    },
    async knownChargePointIds(orgId, chargePointIds) {
      const lowered = [...new Set(chargePointIds.map((x) => x.toLowerCase()))];
      if (lowered.length === 0) return new Set<string>();
      const rows = await tx
        .select({ id: sql<string>`lower(${deviceIdentities.chargePointId})` })
        .from(deviceIdentities)
        .where(and(eq(deviceIdentities.cpoOrgId, orgId), inArray(sql`lower(${deviceIdentities.chargePointId})`, lowered)));
      return new Set(rows.map((x) => x.id));
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
          // A concurrent reserve of the same draft (primary key) or a freak key collision with a
          // concurrent writer: run the whole transaction again. The retry finds the first writer's
          // row and answers as a replay, or draws a different key.
          if (code === "23505" && (constraint?.includes("installation_key") || constraint?.includes("installation_drafts_pkey")) && attempt < 3) continue;
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
