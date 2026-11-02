// Real-PostgreSQL concurrency evidence. OPT-IN: skipped unless STRAUMVAKT_TEST_PG_URL names a throwaway server that this
// test may CREATE AND DROP A DATABASE ON. It never reads DATABASE_URL, so it cannot reach Neon by accident.
//
//   Start a local server (any PostgreSQL 14+), then:
//     STRAUMVAKT_TEST_PG_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run src/lib/pg-concurrency
//
// What this proves that PGlite cannot: several REAL connections, each in its own transaction, racing on the production locks
// (FOR UPDATE / FOR SHARE / SKIP LOCKED), real unique indexes, and every migration executing on a real server.
// What it does not prove: Neon's pooler/WebSocket transport, production data volumes, or Cloudflare timing.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull, sql } from "drizzle-orm";
import { installations, lifecycleRequests, placements } from "@straumvakt/shared/db/assets";
import { ocppTransactions } from "@straumvakt/shared/db/charging";
import type { Db } from "@/lib/installations/db";
import { createCpoOrganisation, createSite, drizzleStore, loadSnapshot } from "@/lib/installations/drizzle-store";
import { saveInstallation } from "@/lib/installations/service";
import { sharedLoginActor } from "@/lib/installations/actor";
import { drizzleTransactionStore } from "@/lib/ocpp-engine/drizzle-tx-store";
import { drizzleCostingStore } from "@/lib/costing/drizzle-costing-store";
import { costPending } from "@/lib/costing/service";
import { drizzleLifecycleStore } from "@/lib/lifecycle/drizzle-store";
import { progressRemoval, requestRemoval, type Deps, type StopPort } from "@/lib/lifecycle/service";
import { ACTOR } from "@/lib/lifecycle/__tests__/memory-store";
import type { ConnectionContext } from "@/lib/ocpp-engine/admission";
import type { MeterRequest } from "@/lib/ocpp-engine/meter";

const ADMIN_URL = process.env.STRAUMVAKT_TEST_PG_URL;
const dbName = `straumvakt_conc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let admin: Pool;
let pool: Pool;
/** Each caller gets its own pooled connection, like separate Worker isolates would. */
const dbN = (): Db => drizzle(pool) as unknown as Db;

const migrations = () => readdirSync("apps/api/drizzle").filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();

type Fx = { orgId: string; installationId: string; deviceId: string; placementId: string; ctx: ConnectionContext; chargePointId: string };
let n = 0;
async function makeInstallation(orgId: string, siteId: string): Promise<Fx> {
  const db = dbN();
  const id = ++n;
  const saved = await saveInstallation(
    drizzleStore(db),
    {
      orgId, siteId, idempotencyKey: crypto.randomUUID(),
      installation: { displayName: `Conc ${id}`, mainDeviceType: null, mainRatingAmps: 63, mainPhaseCount: 3, mainGridType: "TN" },
      electrician: { name: null, email: null, phone: null }, password: { action: "keep" },
      circuits: [{ id: "new-c0", parentId: null, displayName: "Circuit", ratingAmps: 32, phaseCount: 3 }],
      chargers: [{ id: "new-k0", circuitId: "new-c0", label: "Bay", chargePointId: `CONC-${id}-${Math.floor(Math.random() * 1e9)}`, vendor: "Zaptec", model: "Go", serialNumber: `SN-${id}` }],
    } as never,
    sharedLoginActor("conc"),
  );
  const snap = await loadSnapshot(db, saved.snapshot.installation.id);
  const c = snap!.chargers[0]!;
  const ctx = { orgId, installationId: saved.snapshot.installation.id, chargePointId: c.chargePointId, identityString: `${orgId}/${c.chargePointId}`, deviceId: c.id, placementId: c.placementId, credentialMode: "none", credentialEpoch: "e" } as ConnectionContext;
  return { orgId, installationId: ctx.installationId, deviceId: c.id, placementId: c.placementId, ctx, chargePointId: c.chargePointId };
}

/** Starts a session exactly the way the engine does: gate on the placement first, then insert, in one transaction. */
async function tryStart(fx: Fx, connectorNo = 1): Promise<"started" | "refused"> {
  const store = drizzleTransactionStore(dbN());
  return store.run(async (tx) => {
    const gate = await tx.startGate(fx.ctx);
    if (!gate.placementOpen || gate.blocked) return "refused" as const;
    const receipt = await tx.receipt({ ctx: fx.ctx, action: "StartTransaction", messageId: crypto.randomUUID(), requestHash: crypto.randomUUID(), payload: {}, receivedAt: new Date() });
    await tx.insertTransaction({
      ctx: fx.ctx, receiptId: receipt.id, connectorNo, idTag: "TAG", authorization: { status: "Accepted", reason: "ok", decidedAt: new Date().toISOString() }, authorized: true,
      meterStartWh: 0, startedReportedAt: new Date(), startedReceivedAt: new Date(), termsSnapshot: null,
    });
    return "started" as const;
  });
}

const lifecycleDeps = (stop: StopPort): Deps => ({
  store: drizzleLifecycleStore(dbN()) as never, stop, costing: null, authorise: () => true, now: () => new Date(),
});
// drizzleLifecycleStore(db).run opens a transaction on the connection it was built with; build a store per call.
const freshDeps = (stop: StopPort): Deps => ({ ...lifecycleDeps(stop), store: { run: (fn) => drizzleLifecycleStore(dbN()).run(fn) } });

describe.skipIf(!ADMIN_URL)("real PostgreSQL: several connections, production locks", () => {
  let orgId = "";
  let siteId = "";

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    await admin.query(`create database ${dbName}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: u.toString(), max: 24 });
    await pool.query("create extension if not exists citext; create extension if not exists btree_gist;");
    for (const f of migrations()) await pool.query(readFileSync(`apps/api/drizzle/${f}`, "utf8").replaceAll("--> statement-breakpoint", ""));
    // Drizzle fills these client-side; the raw fixture rows below do not go through Drizzle.
    await pool.query("alter table charging.ocpp_transactions alter column updated_at set default now()");
    const db = dbN();
    orgId = (await createCpoOrganisation(db, { displayName: "Conc CPO" })).id;
    siteId = (await createSite(db, { orgId, displayName: "Site", address: null }))!.id;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    await admin?.end();
  });

  it("every migration, including 0011, executes on a real server and the new partial index exists", async () => {
    const idx = await pool.query("select indexdef from pg_indexes where indexname = 'ocpp_transactions_open_by_user_index'");
    expect(idx.rows).toHaveLength(1);
    expect(idx.rows[0].indexdef).toMatch(/WHERE/i);
    const applied = migrations();
    expect(applied.length).toBeGreaterThanOrEqual(12);
  });

  it("the driver-grant read uses the partial index, not a scan (planner check on a real server)", async () => {
    const fx = await makeInstallation(orgId, siteId);
    for (let i = 0; i < 300; i++) await pool.query(`insert into charging.ocpp_transactions (id, org_id, installation_id, device_id, placement_id, identity_string, connector_no, id_tag, "authorization", authorized, user_id, meter_start_wh, meter_stop_wh, stopped_reported_at, stopped_received_at, started_reported_at, started_received_at, start_receipt_id, stop_receipt_id) values (gen_random_uuid(),$1,$2,$3,$4,'x',1,'t','{}',true,$5,0,10,now(),now(),now(),now(),gen_random_uuid(),gen_random_uuid())`, [orgId, fx.installationId, fx.deviceId, fx.placementId, crypto.randomUUID()]);
    const user = crypto.randomUUID();
    await pool.query(`insert into charging.ocpp_transactions (id, org_id, installation_id, device_id, placement_id, identity_string, connector_no, id_tag, "authorization", authorized, user_id, meter_start_wh, started_reported_at, started_received_at, start_receipt_id) values (gen_random_uuid(),$1,$2,$3,$4,'x',1,'t','{}',true,$5,0,now(),now(),gen_random_uuid())`, [orgId, fx.installationId, fx.deviceId, fx.placementId, user]);
    await pool.query("analyze charging.ocpp_transactions");
    await pool.query("set enable_seqscan = off");
    const plan = await pool.query("explain select installation_id, device_id, connector_no from charging.ocpp_transactions where user_id = $1 and stopped_received_at is null and authorized = true", [user]);
    expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain("ocpp_transactions_open_by_user_index");
  });

  it("duplicate delivery: six connections racing the same receipt create exactly one", async () => {
    const fx = await makeInstallation(orgId, siteId);
    const messageId = crypto.randomUUID();
    const hash = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => drizzleTransactionStore(dbN()).run((tx) => tx.receipt({ ctx: fx.ctx, action: "StartTransaction", messageId, requestHash: hash, payload: {}, receivedAt: new Date() }))));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  });

  it("costing: concurrent consumers claim DISJOINT rows (SKIP LOCKED), so no row is processed twice", async () => {
    const fx = await makeInstallation(orgId, siteId);
    const total = 12;
    for (let i = 0; i < total; i++) {
      await pool.query(
        `insert into charging.ocpp_transactions (id, org_id, installation_id, device_id, placement_id, identity_string, connector_no, id_tag, "authorization", authorized, meter_start_wh, meter_stop_wh, started_reported_at, started_received_at, stopped_reported_at, stopped_received_at, energy_wh, costing_state, start_receipt_id, stop_receipt_id)
         values (gen_random_uuid(),$1,$2,$3,$4,'x',$5,'t','{}',true,0,1000, now() - interval '2 hour', now() - interval '2 hour', now() - interval '1 hour', now() - interval '1 hour', 1000, 'needed', gen_random_uuid(), gen_random_uuid())`,
        [orgId, fx.installationId, fx.deviceId, fx.placementId, 100 + i],
      );
    }
    const reports = await Promise.all(Array.from({ length: 6 }, () => costPending(drizzleCostingStore(dbN()), { limit: 10 })));
    expect(reports.reduce((a, r) => a + r.processed, 0)).toBe(total);
    const rows = await pool.query("select costing_state, costing_attempts from charging.ocpp_transactions where installation_id = $1 and connector_no >= 100", [fx.installationId]);
    expect(rows.rows.filter((r) => r.costing_state === "needed")).toHaveLength(0);
    expect(rows.rows.every((r) => r.costing_attempts === 0)).toBe(true);
  });

  it("removal during a charge: eight connections progressing one request reserve exactly ONE stop attempt (one attempt id on every delivery); closing never starts another", async () => {
    const fx = await makeInstallation(orgId, siteId);
    expect(await tryStart(fx)).toBe("started");
    const sent: string[] = [];
    const stop: StopPort = { requestStop: async (i) => { sent.push(i.attemptId); await new Promise((r) => setTimeout(r, 25)); return "accepted"; } };
    const requested = await requestRemoval(freshDeps(stop), { deviceId: fx.deviceId, kind: "remove", reason: "", requestKey: crypto.randomUUID(), actor: ACTOR });
    expect(requested.ok).toBe(true);
    const id = (requested as { value: { id: string } }).value.id;
    const results = await Promise.all(Array.from({ length: 8 }, () => progressRemoval(freshDeps(stop), id)));
    expect(results.every((r) => r.ok)).toBe(true);
    // The port may be called by every caller that resumes the reserved attempt, but always with the SAME attempt id: the device
    // sends the wire command once per attempt id and returns the retained outcome to the rest (gateway/src/engine-mode.ts redeliver).
    expect(new Set(sent).size).toBe(1);
    // Accepted is not a stop: the placement is still open and the session still has no stop evidence.
    const [open] = await dbN().select({ id: placements.id }).from(placements).where(and(eq(placements.id, fx.placementId), sql`upper_inf(${placements.period})`));
    expect(open).toBeDefined();
    const [req] = await dbN().select().from(lifecycleRequests).where(eq(lifecycleRequests.id, id));
    expect(req!.state).not.toBe("completed");
    // The charger really stops: only now may closure proceed, and eight racing callers close it exactly once.
    await pool.query("update charging.ocpp_transactions set stopped_received_at = now(), stopped_reported_at = now(), meter_stop_wh = 500, energy_wh = 500, costing_state = 'not_needed', stop_receipt_id = gen_random_uuid() where device_id = $1 and stopped_received_at is null", [fx.deviceId]);
    const before = (await dbN().select({ r: installations.revision }).from(installations).where(eq(installations.id, fx.installationId)))[0]!.r;
    const closes = await Promise.all(Array.from({ length: 8 }, () => progressRemoval(freshDeps(stop), id)));
    expect(closes.every((r) => r.ok)).toBe(true);
    const after = (await dbN().select({ r: installations.revision }).from(installations).where(eq(installations.id, fx.installationId)))[0]!.r;
    expect(after - before).toBe(1); // one structural change, however many callers raced
    const closed = await pool.query("select count(*)::int as n from assets.placements where id = $1 and not upper_inf(period)", [fx.placementId]);
    expect(closed.rows[0].n).toBe(1);
    expect(new Set(sent).size).toBe(1); // closing never started a second attempt
    const [done] = await dbN().select().from(lifecycleRequests).where(eq(lifecycleRequests.id, id));
    expect(["completed", "settling"]).toContain(done!.state);
  });

  it("start versus removal: across 60 jittered races a placement is NEVER closed while a session started under it is still open", async () => {
    let started = 0;
    let refused = 0;
    const jitter = () => new Promise<void>((r) => setTimeout(r, Math.random() * 14));
    for (let round = 0; round < 60; round++) {
      const fx = await makeInstallation(orgId, siteId);
      const stop: StopPort = { requestStop: async () => "accepted" };
      const key = crypto.randomUUID();
      // Random 0-14 ms head starts, so both orders (start first, removal first) and true overlaps occur across the rounds.
      const [startResult, removal] = await Promise.all([
        (async () => { await jitter(); return tryStart(fx); })(),
        (async () => {
          await jitter();
          const r = await requestRemoval(freshDeps(stop), { deviceId: fx.deviceId, kind: "remove", reason: "", requestKey: key, actor: ACTOR });
          if (!r.ok) return r;
          return progressRemoval(freshDeps(stop), r.value.id);
        })(),
      ]);
      expect(removal.ok).toBe(true);
      if (startResult === "started") started++; else refused++;
      const open = await pool.query("select count(*)::int as n from charging.ocpp_transactions where placement_id = $1 and stopped_received_at is null", [fx.placementId]);
      const closed = await pool.query("select count(*)::int as n from assets.placements where id = $1 and not upper_inf(period)", [fx.placementId]);
      // The invariant: an open session and a closed placement never coexist.
      expect(open.rows[0].n > 0 && closed.rows[0].n > 0, `round ${round}: open session under a closed placement`).toBe(false);
      if (startResult === "started") expect(closed.rows[0].n, `round ${round}`).toBe(0); // the close saw the session and waited for its stop
    }
    // Both outcomes are legitimate; the point is that neither violated the invariant. Report the split.
    expect(started + refused).toBe(60);
    console.log(`start-vs-removal races: started ${started}, refused ${refused}`);
  }, 120_000);

  it("compatible meter SQL batch on a real server: one transaction per batch, idempotent redelivery, concurrent redelivery and overlap, atomic failure", async () => {
    const fx = await makeInstallation(orgId, siteId);
    expect(await tryStart(fx, 1)).toBe("started");
    const open = await pool.query("select id, transaction_no from charging.ocpp_transactions where device_id = $1 and stopped_received_at is null", [fx.deviceId]);
    const txNo: number = open.rows[0].transaction_no;
    const item = (n: number): MeterRequest => ({
      ctx: fx.ctx, messageId: crypto.randomUUID(), requestHash: crypto.randomUUID(), receivedAt: new Date(200000),
      payload: { connectorId: 1, transactionId: txNo, meterValue: [{ timestamp: new Date(1_000_000 + n * 1000).toISOString(), sampledValue: [{ value: String(n), unit: "kWh" }] }] },
    } as MeterRequest);
    const count = async () => (await pool.query("select count(*)::int as n, coalesce(sum(energy_wh),0)::bigint as total from charging.ocpp_transaction_readings where transaction_id = $1", [open.rows[0].id])).rows[0];
    const first = Array.from({ length: 20 }, (_, i) => item(i));
    expect(await drizzleTransactionStore(dbN()).tryIngestMeters!(first)).toBe(true);
    expect(await count()).toMatchObject({ n: 20 });
    // Redelivery of the same batch (a retry after a lost ack) changes nothing.
    expect(await drizzleTransactionStore(dbN()).tryIngestMeters!(first)).toBe(true);
    expect((await count()).n).toBe(20);
    // Six connections deliver the same batch at the same time: unique (transaction, time) makes every one a no-op beyond the first.
    const again = Array.from({ length: 20 }, (_, i) => item(i));
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => drizzleTransactionStore(dbN()).tryIngestMeters!(again).catch((e: unknown) => e)));
    expect(concurrent.every((r) => r === true), JSON.stringify(concurrent.map(String))).toBe(true);
    expect((await count()).n).toBe(20);
    // Overlapping batches from different connections converge on the union.
    const a = Array.from({ length: 20 }, (_, i) => item(100 + i));
    const b = Array.from({ length: 20 }, (_, i) => item(110 + i));
    const results = await Promise.all([a, b, a, b].map((batch) => drizzleTransactionStore(dbN()).tryIngestMeters!(batch).catch((e: unknown) => e)));
    expect(results.every((r) => r === true), JSON.stringify(results.map(String))).toBe(true);
    expect((await count()).n).toBe(20 + 30);
    // A failing sample rolls back the WHOLE batch on the real server.
    const bad = item(300);
    bad.payload.meterValue[0]!.sampledValue = [{ value: "99999999999999", measurand: "Power.Active.Import", unit: "W" }];
    await expect(drizzleTransactionStore(dbN()).tryIngestMeters!([item(301), item(302), bad])).rejects.toThrow();
    expect((await count()).n).toBe(50);
    // An unknown transaction leaves no effect (the per-event quarantine path takes over).
    const unknown = item(400);
    (unknown.payload as { transactionId: number }).transactionId = 2_000_000_000;
    expect(await drizzleTransactionStore(dbN()).tryIngestMeters!([unknown])).toBe(false);
    expect((await count()).n).toBe(50);
  });

  it("a start after the removal request is refused while stop evidence is pending (blocked), and after closure (placement closed)", async () => {
    const fx = await makeInstallation(orgId, siteId);
    const stop: StopPort = { requestStop: async () => "accepted" };
    const r = await requestRemoval(freshDeps(stop), { deviceId: fx.deviceId, kind: "remove", reason: "", requestKey: crypto.randomUUID(), actor: ACTOR });
    expect(r.ok).toBe(true);
    expect(await tryStart(fx)).toBe("refused");
    await progressRemoval(freshDeps(stop), (r as { value: { id: string } }).value.id);
    expect(await tryStart(fx)).toBe("refused");
    const none = await dbN().select({ id: ocppTransactions.id }).from(ocppTransactions).where(and(eq(ocppTransactions.deviceId, fx.deviceId), isNull(ocppTransactions.stoppedReceivedAt)));
    expect(none).toHaveLength(0);
  });
});
