// Executes the actual Drizzle batch SQL on local PostgreSQL/PGlite; no cloud connection.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "@/lib/installations/db";
import { drizzleTransactionStore } from "./drizzle-tx-store";
import type { MeterRequest } from "./meter";

const id = "00000000-0000-4000-8000-000000000001";
let pg: PGlite;
const queries: string[] = [];
let store: ReturnType<typeof drizzleTransactionStore>;
let transactions = 0;
let commits = 0;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema charging;
    create table charging.ocpp_transactions(id uuid primary key, transaction_no int unique, device_id uuid, org_id uuid, stopped_received_at timestamptz);
    create table charging.ocpp_transaction_readings(transaction_id uuid references charging.ocpp_transactions(id), sampled_at timestamptz, energy_wh bigint, power_w integer, other jsonb, received_at timestamptz, primary key(transaction_id,sampled_at));
    insert into charging.ocpp_transactions values('${id}',1,'${id}','${id}',now());`);
  const db = drizzle(pg, { logger: { logQuery: q => { queries.push(q); } } });
  store = drizzleTransactionStore({ transaction: async (fn: Parameters<typeof db.transaction>[0]) => {
    transactions++;
    const result = await db.transaction(fn);
    commits++;
    return result;
  } } as unknown as Db);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec("truncate charging.ocpp_transaction_readings"); queries.length = 0; transactions = 0; commits = 0; });
const item = (n: number): MeterRequest => ({
  ctx: { deviceId: id, orgId: id, installationId: id, placementId: id, chargePointId: "CP", identityString: "o/CP", credentialEpoch: "1", credentialMode: "none" },
  messageId: `m${n}`, requestHash: `h${n}`, receivedAt: new Date(100000),
  payload: { connectorId: 1, transactionId: 1, meterValue: [{ timestamp: new Date(n * 1000).toISOString(), sampledValue: [{ value: String(n), unit: "kWh" }] }] },
});
describe("compatible meter SQL batch", () => {
  it("20 late samples use one transaction, one reference lookup and one insert; replay changes nothing", async () => {
    const items = Array.from({ length: 20 }, (_, i) => item(i));
    expect(await store.tryIngestMeters!(items)).toBe(true);
    expect(transactions).toBe(1);
    expect(queries.filter(q => /^select/i.test(q))).toHaveLength(1);
    expect(queries.filter(q => /^insert/i.test(q))).toHaveLength(1);
    expect(commits).toBe(1);
    expect(await store.tryIngestMeters!(items)).toBe(true);
    const result = await pg.query<{ n: number; total: number }>("select count(*)::int n, sum(energy_wh)::int total from charging.ocpp_transaction_readings");
    expect(result.rows).toEqual([{ n: 20, total: 190000 }]);
  });
  it("an insert failure rolls back every sample, and a corrected retry can recover", async () => {
    const bad = item(2);
    bad.payload.meterValue[0]!.sampledValue = [{ value: "99999999999999", measurand: "Power.Active.Import", unit: "W" }];
    await expect(store.tryIngestMeters!([item(1), bad])).rejects.toThrow();
    expect((await pg.query("select * from charging.ocpp_transaction_readings")).rows).toEqual([]);
    expect(await store.tryIngestMeters!([item(1), item(2)])).toBe(true);
  });
  it("unknown and foreign-device references leave no effects for the per-event quarantine fallback", async () => {
    for (const other of [{ ...item(2), payload: { ...item(2).payload, transactionId: 999 } }, { ...item(2), ctx: { ...item(2).ctx, deviceId: "00000000-0000-4000-8000-000000000002" } }]) {
      expect(await store.tryIngestMeters!([other])).toBe(false);
      expect((await pg.query("select * from charging.ocpp_transaction_readings")).rows).toEqual([]);
    }
  });
  it("duplicate timestamps preserve the established first-insert-wins policy", async () => {
    const duplicate = item(1);
    duplicate.payload.meterValue[0]!.sampledValue[0]!.value = "999";
    expect(await store.tryIngestMeters!([item(1), duplicate])).toBe(true);
    expect((await pg.query("select energy_wh::int value from charging.ocpp_transaction_readings")).rows).toEqual([{ value: 1000 }]);
  });
});
