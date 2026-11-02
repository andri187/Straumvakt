// Drizzle implementation of LifecycleStore. One interactive transaction per `run`
// (Neon WebSocket pool). Not executed against PostgreSQL in this increment: the
// locking, the exclusion/partial-unique behaviour and every query below are
// UNVERIFIED until the approved PostgreSQL run (see the handoff manifest).
//
// Period closing follows the installation store's idiom (upper bound set with
// GREATEST(now, lower+1ms) so a period is never empty). The installation row is
// locked FOR UPDATE for the whole close, so a concurrent edit or a second close
// serialises behind it, and the optimistic request `version` backs that up.

import { and, asc, desc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { deviceIdentities, installationChanges, installations, lifecycleRequests, lifecycleRecoveryCursor, placements } from "@straumvakt/shared/db/assets";
import { ocppTransactions } from "@straumvakt/shared/db/charging";
import type { Db, Executor } from "@/lib/installations/db";
import { identityRow } from "@/lib/installations/model";
import type { LifecycleRequest, SessionStep } from "./model";
import type { Observed } from "./plan";
import { SUPERSEDED_FLAG } from "@/lib/ocpp-engine/transactions";
import { OpenRequestConflict, PlacementAlreadyClosed, SessionOpenError, type DeviceView, type LifecycleStore, type LifecycleTx } from "./service";

const openPlacement = sql`upper_inf(${placements.period})`;
const openIdentity = sql`upper_inf(${deviceIdentities.period})`;
const CLOSED = ["completed", "cancelled"];

const toReq = (r: typeof lifecycleRequests.$inferSelect): LifecycleRequest => ({
  id: r.id, kind: r.kind as LifecycleRequest["kind"], state: r.state as LifecycleRequest["state"], orgId: r.orgId, installationId: r.installationId,
  deviceId: r.deviceId, placementId: r.placementId, reason: r.reason, actorKind: "shared_login", actorLabel: r.actorLabel,
  requestedAt: r.requestedAt.toISOString(), serviceEndedAt: r.serviceEndedAt?.toISOString() ?? null, completedAt: r.completedAt?.toISOString() ?? null,
  sessions: r.sessions as SessionStep[], attention: r.attention, identityClosed: r.identityClosed, version: r.version,
});

function port(x: Executor): LifecycleTx {
  return {
    async currentPlacement(deviceId): Promise<DeviceView | null> {
      const [p] = await x
        .select({ placementId: placements.id, orgId: placements.orgId, installationId: placements.installationId, circuitId: placements.circuitId, label: placements.label, chargePointId: deviceIdentities.chargePointId, identity: deviceIdentities.identityString })
        .from(placements)
        .innerJoin(installations, eq(installations.id, placements.installationId))
        .leftJoin(deviceIdentities, and(eq(deviceIdentities.deviceId, placements.deviceId), openIdentity))
        .where(and(eq(placements.deviceId, deviceId), openPlacement))
        .limit(1);
      if (!p) return null;
      return { deviceId, placementId: p.placementId, orgId: p.orgId, installationId: p.installationId, circuitId: p.circuitId, label: p.label ?? "", chargePointId: p.chargePointId ?? p.identity ?? "" };
    },

    async byKey(key) { const [r] = await x.select().from(lifecycleRequests).where(eq(lifecycleRequests.requestKey, key)); return r ? toReq(r) : null; },
    async byId(id) { const [r] = await x.select().from(lifecycleRequests).where(eq(lifecycleRequests.id, id)); return r ? toReq(r) : null; },
    async openFor(deviceId) {
      const [r] = await x.select().from(lifecycleRequests).where(and(eq(lifecycleRequests.deviceId, deviceId), notInArray(lifecycleRequests.state, CLOSED))).limit(1);
      return r ? toReq(r) : null;
    },
    async insert(req, requestKey) {
      // The partial unique index (one OPEN request per device) and the request-key index make a losing concurrent insert
      // fail with 23505. PostgreSQL has aborted this transaction, so we only SIGNAL: the service rolls back and resumes in a
      // new transaction. Any other error, and any other constraint, propagates unchanged.
      try {
        await x.insert(lifecycleRequests).values({
          id: req.id, requestKey, kind: req.kind, state: req.state, orgId: req.orgId, installationId: req.installationId, deviceId: req.deviceId, placementId: req.placementId,
          reason: req.reason, actorKind: req.actorKind, actorLabel: req.actorLabel, requestedAt: new Date(req.requestedAt), sessions: req.sessions, attention: req.attention,
          identityClosed: req.identityClosed, version: req.version,
        });
      } catch (e) {
        const c = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
        const code = c.code ?? c.cause?.code;
        const constraint = c.constraint ?? c.cause?.constraint;
        if (code === "23505" && (constraint === "lifecycle_requests_one_open_per_device" || constraint === "lifecycle_requests_request_key_index")) throw new OpenRequestConflict();
        throw e;
      }
    },
    async lockPlacement(placementId) {
      await x.select({ id: placements.id }).from(placements).where(eq(placements.id, placementId)).for("update");
    },
    async save(req, expectedVersion) {
      const rows = await x
        .update(lifecycleRequests)
        .set({
          state: req.state, sessions: req.sessions, attention: req.attention, identityClosed: req.identityClosed, version: req.version,
          serviceEndedAt: req.serviceEndedAt ? new Date(req.serviceEndedAt) : null, completedAt: req.completedAt ? new Date(req.completedAt) : null,
        })
        .where(and(eq(lifecycleRequests.id, req.id), eq(lifecycleRequests.version, expectedVersion)))
        .returning({ id: lifecycleRequests.id });
      return rows.length === 1;
    },

    async observed(req) {
      const tracked = req.sessions.map((s) => s.transactionNo);
      const rows = await x
        .select({ transactionNo: ocppTransactions.transactionNo, transactionId: ocppTransactions.id, stoppedReceivedAt: ocppTransactions.stoppedReceivedAt, authorized: ocppTransactions.authorized, costingState: ocppTransactions.costingState, reconcileFlag: ocppTransactions.reconcileFlag })
        .from(ocppTransactions)
        .where(and(eq(ocppTransactions.deviceId, req.deviceId), tracked.length ? sql`(${ocppTransactions.stoppedReceivedAt} IS NULL OR ${inArray(ocppTransactions.transactionNo, tracked)})` : isNull(ocppTransactions.stoppedReceivedAt)))
        .orderBy(asc(ocppTransactions.transactionNo));
      const [open] = await x.select({ id: placements.id }).from(placements).where(and(eq(placements.deviceId, req.deviceId), openPlacement)).limit(1);
      return { sessions: rows.map(({ reconcileFlag, ...r }) => ({ ...r, superseded: reconcileFlag === SUPERSEDED_FLAG && r.stoppedReceivedAt === null })), placementOpen: !!open };
    },
    // This short-lived lock is released before any command or costing effect.
    async lockRecoveryCursor() {
      await x.insert(lifecycleRecoveryCursor).values({ id: 1 }).onConflictDoNothing();
      const [cursor] = await x.select().from(lifecycleRecoveryCursor).where(eq(lifecycleRecoveryCursor.id, 1)).for("update");
      if (!cursor) throw new Error("Recovery cursor unavailable");
      return cursor.afterDeviceId;
    },
    async advanceRecoveryCursor(afterDeviceId) {
      await x.update(lifecycleRecoveryCursor).set({ afterDeviceId }).where(eq(lifecycleRecoveryCursor.id, 1));
    },
    // Predicate and order match the existing partial unique device index; no hash sort or OFFSET.
    async listOpen({ limit, afterDeviceId }) {
      const rows = await x
        .select()
        .from(lifecycleRequests)
        .where(and(sql`${lifecycleRequests.state} NOT IN ('completed','cancelled')`, afterDeviceId === null ? undefined : gt(lifecycleRequests.deviceId, afterDeviceId)))
        .orderBy(asc(lifecycleRequests.deviceId))
        .limit(limit);
      return rows.map(toReq);
    },
    async observedMany(reqs) {
      const out = new Map<string, Observed>();
      if (reqs.length === 0) return out;
      const deviceIds = [...new Set(reqs.map((r) => r.deviceId))];
      const tracked = [...new Set(reqs.flatMap((r) => r.sessions.map((s) => s.transactionNo)))];
      // transaction_no is globally unique, so matching the tracked numbers alone is safe; the other arm is each device's open sessions.
      const rows = await x
        .select({ deviceId: ocppTransactions.deviceId, transactionNo: ocppTransactions.transactionNo, transactionId: ocppTransactions.id, stoppedReceivedAt: ocppTransactions.stoppedReceivedAt, authorized: ocppTransactions.authorized, costingState: ocppTransactions.costingState, reconcileFlag: ocppTransactions.reconcileFlag })
        .from(ocppTransactions)
        .where(or(and(inArray(ocppTransactions.deviceId, deviceIds), isNull(ocppTransactions.stoppedReceivedAt)), tracked.length ? inArray(ocppTransactions.transactionNo, tracked) : undefined))
        .orderBy(asc(ocppTransactions.transactionNo));
      const openPlacements = await x.select({ deviceId: placements.deviceId }).from(placements).where(and(inArray(placements.deviceId, deviceIds), openPlacement));
      const placed = new Set(openPlacements.map((p) => p.deviceId));
      for (const req of reqs) {
        const mine = new Set(req.sessions.map((s) => s.transactionNo));
        const sessions = rows
          .filter((r) => r.deviceId === req.deviceId && (r.stoppedReceivedAt === null || mine.has(r.transactionNo)))
          .map(({ reconcileFlag, deviceId: _device, ...r }) => ({ ...r, superseded: reconcileFlag === SUPERSEDED_FLAG && r.stoppedReceivedAt === null }));
        out.set(req.id, { sessions, placementOpen: placed.has(req.deviceId) });
      }
      return out;
    },
    async openSessionCount(deviceId) {
      // Supersession is not stop evidence: every unconfirmed session blocks closure.
      const [r] = await x.select({ n: sql<number>`count(*)::int` }).from(ocppTransactions).where(and(eq(ocppTransactions.deviceId, deviceId), isNull(ocppTransactions.stoppedReceivedAt)));
      return r?.n ?? 0;
    },

    async closePlacement({ req, at }) {
      // Serialise with every other writer of this installation.
      const [inst] = await x.select({ revision: installations.revision }).from(installations).where(eq(installations.id, req.installationId)).for("update").limit(1);
      if (!inst) throw new Error("installation not found");
      // Lock order: installation (above), then THIS placement. A start holds the placement FOR SHARE, so after this
      // returns every committed start is visible to the count below and any later start is refused as placement-closed.
      await x.select({ id: placements.id }).from(placements).where(eq(placements.id, req.placementId)).for("update");
      const [open] = await x.select({ n: sql<number>`count(*)::int` }).from(ocppTransactions).where(and(eq(ocppTransactions.deviceId, req.deviceId), isNull(ocppTransactions.stoppedReceivedAt)));
      if ((open?.n ?? 0) > 0) throw new SessionOpenError();
      const closed = await x
        .update(placements)
        .set({ period: sql`tstzrange(lower(${placements.period}), GREATEST(${at.toISOString()}::timestamptz, lower(${placements.period}) + interval '1 millisecond'), '[)')`, detachReason: `${req.kind}: ${req.reason}`.slice(0, 200) })
        .where(and(eq(placements.id, req.placementId), eq(placements.deviceId, req.deviceId), openPlacement))
        .returning({ id: placements.id });
      if (closed.length === 0) throw new PlacementAlreadyClosed();
      await x
        .update(deviceIdentities)
        .set({ period: sql`tstzrange(lower(${deviceIdentities.period}), GREATEST(${at.toISOString()}::timestamptz, lower(${deviceIdentities.period}) + interval '1 millisecond'), '[)')` })
        .where(and(eq(deviceIdentities.deviceId, req.deviceId), openIdentity));
      const revision = inst.revision + 1;
      await x.update(installations).set({ revision }).where(eq(installations.id, req.installationId));
      await x.insert(installationChanges).values({
        orgId: req.orgId, installationId: req.installationId, revision, entityType: "charger", entityId: req.deviceId,
        // `detach` is what the sync service reads as a removal; the request id and kind make the cause answerable.
        action: "detach", diff: { lifecycle: { from: null, to: `${req.kind}:${req.id}` } }, actorKind: req.actorKind, actorLabel: req.actorLabel, effectiveAt: at,
      });
    },

    async detachedHere(installationId) {
      const rows = await x.execute(sql`
        select d.id as device_id, coalesce(p.label, '') as label, d.vendor, d.model, p.circuit_id,
               coalesce((select lr.kind = 'retire' from assets.lifecycle_requests lr where lr.device_id = d.id and lr.state = 'completed' order by lr.completed_at desc limit 1), false) as retired
        from assets.devices d
        join lateral (select * from assets.placements pp where pp.device_id = d.id order by lower(pp.period) desc limit 1) p on true
        where p.installation_id = ${installationId}
          and not exists (select 1 from assets.placements op where op.device_id = d.id and upper_inf(op.period))`);
      return (rows.rows as { device_id: string; label: string; vendor: string | null; model: string | null; circuit_id: string | null; retired: boolean }[]).map((r) => ({
        deviceId: r.device_id, label: r.label, vendor: r.vendor, model: r.model, lastCircuitId: r.circuit_id, retired: r.retired,
      }));
    },
    async deviceHistory(deviceId) {
      const [p] = await x.select({ orgId: placements.orgId, installationId: placements.installationId }).from(placements).where(eq(placements.deviceId, deviceId)).orderBy(desc(sql`lower(${placements.period})`)).limit(1);
      if (!p) return null;
      const [lr] = await x.select({ kind: lifecycleRequests.kind }).from(lifecycleRequests).where(and(eq(lifecycleRequests.deviceId, deviceId), eq(lifecycleRequests.state, "completed"))).orderBy(desc(lifecycleRequests.completedAt)).limit(1);
      return { orgId: p.orgId, installationId: p.installationId, retired: lr?.kind === "retire" };
    },
    async openPlacement(i) {
      const [inst] = await x.select({ revision: installations.revision, siteId: installations.siteId }).from(installations).where(eq(installations.id, i.installationId)).for("update").limit(1);
      if (!inst) throw new Error("installation not found");
      try {
        await x.insert(placements).values({ deviceId: i.deviceId, orgId: i.orgId, installationId: i.installationId, siteId: inst.siteId, circuitId: i.circuitId, label: i.label, period: sql`tstzrange(${i.at.toISOString()}::timestamptz, NULL, '[)')` as unknown as string });
        await x.insert(deviceIdentities).values({ deviceId: i.deviceId, ...identityRow(i.orgId, i.chargePointId), period: sql`tstzrange(${i.at.toISOString()}::timestamptz, NULL, '[)')` as unknown as string, note: "returned to service" });
      } catch (e) {
        const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
        if (code === "23P01" || code === "23505") throw new Error("identity_in_use"); // exclusion / unique: the id or the open placement is taken
        throw e;
      }
      const revision = inst.revision + 1;
      await x.update(installations).set({ revision }).where(eq(installations.id, i.installationId));
      await x.insert(installationChanges).values({ orgId: i.orgId, installationId: i.installationId, revision, entityType: "charger", entityId: i.deviceId, action: "create", diff: { returned: { from: null, to: true } }, actorKind: i.actor.kind, actorLabel: i.actor.label, effectiveAt: i.at });
    },
  };
}

export function drizzleLifecycleStore(db: Db): LifecycleStore {
  return { run: (fn) => db.transaction((tx) => fn(port(tx))) };
}
