// Actual Drizzle selector and migration on in-process PostgreSQL (PGlite).
// No Neon/network. This verifies SQL, persistence, rollback and a synthetic query plan,
// not concurrent Neon connections, production statistics or Cloudflare timing.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { lifecycleRequests } from "@straumvakt/shared/db/assets";
import type { Db } from "@/lib/installations/db";
import { drizzleLifecycleStore } from "./drizzle-store";
import { selectDueRemovals } from "./service";
import { MAX_STOP_ATTEMPTS } from "./model";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = () => new Date("2026-10-31T12:00:00Z");
const migration = (name: string) => readFileSync(`apps/api/drizzle/${name}.sql`, "utf8").replaceAll("--> statement-breakpoint", "");
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const queries: { query: string; params: unknown[] }[] = [];
const freshStore = () => drizzleLifecycleStore(db as unknown as Db);
const select = (scanLimit = 4, maxDue = 2) => selectDueRemovals({ store: freshStore(), now }, { scanLimit, maxDue });
const cursor = async () => (await pg.query<{ after_device_id: string | null }>("select after_device_id from assets.lifecycle_recovery_cursor where id = 1")).rows[0]?.after_device_id;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create schema assets; create schema charging;");
  await pg.exec(migration("0006_charger_lifecycle"));
  await pg.exec(migration("0010_lifecycle_recovery_cursor"));
  await pg.exec(`
    create table charging.ocpp_transactions (
      id uuid primary key, transaction_no integer unique, device_id uuid,
      stopped_received_at timestamptz, authorized boolean, costing_state text, reconcile_flag text
    );
    create table assets.placements (id uuid primary key, device_id uuid, period tstzrange);
  `);
  db = drizzle(pg, { logger: { logQuery: (query, params) => queries.push({ query, params }) } });
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec("truncate assets.lifecycle_requests, assets.lifecycle_recovery_cursor, charging.ocpp_transactions, assets.placements;");
  queries.length = 0;
});

async function request(n: number, held = false) {
  await db.insert(lifecycleRequests).values({
    id: uid(n), requestKey: `request-${n}`, kind: "remove", state: held ? "needs_attention" : "requested",
    orgId: uid(900001), installationId: uid(900002), deviceId: uid(n), placementId: uid(800000 + n),
    reason: "test", actorKind: "shared_login", actorLabel: "local test", requestedAt: now(),
    sessions: held ? [{ transactionNo: n, transactionId: uid(700000 + n), stop: { attempts: MAX_STOP_ATTEMPTS, lastOutcome: "rejected", lastAt: now().toISOString(), everAccepted: false }, stopConfirmedAt: null, settlement: { state: "pending", reason: null } }] : [],
  });
  if (held) await pg.query("insert into charging.ocpp_transactions values ($1,$2,$3,null,true,'not_needed',null)", [uid(700000 + n), n, uid(n)]);
}

describe("durable lifecycle recovery selection (local PostgreSQL)", () => {
  it("crosses three held windows and reaches real work on the fourth pass, using fresh store instances", async () => {
    for (let n = 1; n <= 12; n++) await request(n, true);
    await request(13);
    for (let pass = 1; pass <= 3; pass++) {
      const result = await select();
      expect(result).toMatchObject({ scanned: 4, due: [], scanTruncated: true });
      expect(await cursor()).toBe(uid(pass * 4));
    }
    expect((await select()).due.map((x) => x.requestId)).toEqual([uid(13)]);
  });

  it("persists only the examined prefix: the work cap cannot skip other actionable requests; crashes are revisited after wrapping", async () => {
    for (let n = 1; n <= 7; n++) await request(n);
    for (const expected of [[1, 2], [3, 4], [5, 6], [7], [1, 2]]) {
      const result = await select(100, 2);
      expect(result.due.map((x) => x.requestId)).toEqual(expected.map(uid));
      expect(await cursor()).toBe(uid(expected.at(-1)!));
      // Deliberately don't progress the request: models loss/crash after selection commits.
    }
  });

  it("rolls back cursor movement with its transaction", async () => {
    await request(1); await request(2);
    await select(1, 1);
    await expect(freshStore().run(async (tx) => {
      await tx.lockRecoveryCursor!();
      await tx.advanceRecoveryCursor!(uid(2));
      throw new Error("abort selection");
    })).rejects.toThrow("abort selection");
    expect(await cursor()).toBe(uid(1));
    expect((await select()).due[0].requestId).toBe(uid(2));
  });

  it("survives closure of the cursor request and discovers an insertion behind it on the next wrap", async () => {
    await request(2); await request(4);
    await select(1, 1);
    await pg.query("update assets.lifecycle_requests set state = 'cancelled' where id = $1", [uid(2)]);
    await request(1);
    expect((await select()).due.map((x) => x.requestId)).toEqual([uid(4)]);
    expect((await select()).due.map((x) => x.requestId)).toEqual([uid(1), uid(4)]);
  });

  it("revisits a held request after late real stop evidence without resetting attempts", async () => {
    await request(1, true);
    expect((await select()).due).toEqual([]);
    await pg.query("update charging.ocpp_transactions set stopped_received_at = $1, costing_state = 'costed' where transaction_no = 1", [now().toISOString()]);
    expect((await select()).due).toMatchObject([{ requestId: uid(1), needsStop: false }]);
    const row = (await db.select().from(lifecycleRequests))[0];
    expect((row.sessions as { stop: { attempts: number } }[])[0].stop.attempts).toBe(MAX_STOP_ATTEMPTS);
  });

  it("serialises duplicate selections in the embedded transaction runner without losing the durable position", async () => {
    for (let n = 1; n <= 6; n++) await request(n);
    const results = await Promise.all([select(100, 2), select(100, 2), select(100, 2)]);
    expect(results.flatMap((r) => r.due.map((x) => x.requestId)).sort()).toEqual([1, 2, 3, 4, 5, 6].map(uid));
    expect(await cursor()).toBe(uid(6));
    // PGlite has one connection; this is not a multi-connection row-lock proof.
  });

  it("enforces a single cursor row", async () => {
    await expect(pg.exec("insert into assets.lifecycle_recovery_cursor (id) values (2)")).rejects.toThrow();
  });

  it("uses the existing partial index without a sort for a 101-row window beside 50,000 completed and 2,000 open requests", async () => {
    await pg.exec(`
      insert into assets.lifecycle_requests
        (id, request_key, kind, state, org_id, installation_id, device_id, placement_id, reason, actor_kind, actor_label, requested_at, completed_at)
      select v, g::text, 'remove', case when g <= 50000 then 'completed' else 'requested' end,
        v, v, v, v, 'test', 'shared_login', 'test', now(), case when g <= 50000 then now() else null end
      from generate_series(1, 52000) g
      cross join lateral (select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid as v) ids;
      analyze assets.lifecycle_requests;
    `);
    queries.length = 0;
    const rows = await freshStore().run((tx) => tx.listOpen!({ limit: 101, afterDeviceId: uid(51000) }));
    expect(rows).toHaveLength(101);
    const statement = queries.find((q) => q.query.includes('from "assets"."lifecycle_requests"'))!;
    const explanation = await pg.query<{ "QUERY PLAN": { Plan: Record<string, unknown> }[] }>(`explain (analyze, format json) ${statement.query}`, statement.params);
    const plan = explanation.rows[0]["QUERY PLAN"][0].Plan;
    const text = JSON.stringify(plan);
    expect(text).toContain('"Index Name":"lifecycle_requests_one_open_per_device"');
    expect(text).not.toContain('"Node Type":"Sort"');
    expect(text).not.toContain('"Node Type":"Seq Scan"');
    expect(plan["Actual Rows"]).toBe(101);
    console.info("Recovery selector fixture: 52,000 requests; existing partial index; no sort/seq scan; 101 rows returned.");
  });
});
