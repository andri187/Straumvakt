// The pending-onboarding SQL, run against a REAL PostgreSQL engine (PGlite, in-process, in memory). Nothing here touches Neon or
// any network. It proves the statements are valid PostgreSQL and behave as intended for: the capture write under the per-CPO
// lock, the cap and the body-only eviction, the reason/boot merge, the promotion intent and outcome, and the boot-evidence read.
//
// What it does NOT prove: the real schema's other constraints (the tables below carry only the columns these statements use,
// named exactly as in packages/shared), Neon's pooler/driver behaviour, or concurrent sessions (PGlite is one connection, so
// the advisory lock is exercised but not contended).

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzleAdmissionStore, drizzlePendingStore } from "./drizzle-admission-store";
import { drizzleStore } from "@/lib/installations/drizzle-store";
import type { Db } from "@/lib/installations/db";
import { buildBootCapture, MAX_PENDING_IDENTITIES_PER_CPO } from "./pending";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const AT = new Date("2026-10-31T12:00:00Z");
const DAY = 86_400_000;

let pg: PGlite;
let db: Db;
const q = (text: string, params: unknown[] = []) => pg.query(text, params);
const summary = async (org: string, id: string) => ((await q("select last_payload_summary as s from ocpp.pending_discoveries where identity_string = $1", [`${org}/${id}`])).rows[0] as { s: Record<string, unknown> | null } | undefined)?.s;
const rowCount = async () => Number(((await q("select count(*)::int as n from ocpp.pending_discoveries")).rows[0] as { n: number }).n);
const cap = (payload: Record<string, unknown>, id = "m1") => buildBootCapture({ messageId: id, receivedAt: AT.toISOString(), frameBytes: 100, payload });
const seedKnock = (org: string, id: string, lastSeen: Date, summary: unknown = null) =>
  q("insert into ocpp.pending_discoveries (identity_string, first_seen_at, last_seen_at, attempt_count, last_payload_summary) values ($1,$2,$2,1,$3)", [`${org}/${id}`, lastSeen.toISOString(), summary === null ? null : JSON.stringify(summary)]);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create schema ocpp; create schema assets;
    create table ocpp.pending_discoveries (
      identity_string varchar(128) primary key, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
      attempt_count integer not null default 0, remote_addr varchar(64), user_agent varchar(255), last_payload_summary jsonb);
    create table assets.device_identities (device_id uuid not null, identity_string text not null default '', cpo_org_id uuid, charge_point_id text);
    create table ocpp.protocol_receipts (id uuid primary key default gen_random_uuid(), device_id uuid not null, action text not null, received_at timestamptz not null);
  `);
  db = drizzle(pg) as unknown as Db;
});
afterAll(async () => void (await pg.close()));
beforeEach(async () => void (await pg.exec("truncate ocpp.pending_discoveries, assets.device_identities, ocpp.protocol_receipts")));

describe("storeBoot", () => {
  it("stores the complete body under key `boot` and leaves a sibling refusal reason untouched", async () => {
    await seedKnock(ORG, "CP-1", AT, { reason: "credentials_required", reasonAt: AT.toISOString() });
    const c = await cap({ chargePointVendor: "V", chargePointModel: "M", iccid: "1", vendorExtra: { n: [1] } });
    expect(await drizzlePendingStore(db).storeBoot({ orgId: ORG, chargePointId: "CP-1", capture: c, at: AT })).toBe("stored");
    const s = await summary(ORG, "CP-1");
    expect(s).toMatchObject({ reason: "credentials_required", boot: { messageId: "m1", payload: { iccid: "1", vendorExtra: { n: [1] } } } });
  });
  it("an unchanged body writes nothing; a changed body replaces it", async () => {
    const store = drizzlePendingStore(db);
    const c = await cap({ chargePointVendor: "V", chargePointModel: "M" });
    expect(await store.storeBoot({ orgId: ORG, chargePointId: "CP-1", capture: c, at: AT })).toBe("stored");
    expect(await store.storeBoot({ orgId: ORG, chargePointId: "CP-1", capture: c, at: new Date(AT.getTime() + 1000) })).toBe("unchanged");
    const next = await cap({ chargePointVendor: "V", chargePointModel: "M2" }, "m2");
    expect(await store.storeBoot({ orgId: ORG, chargePointId: "CP-1", capture: next, at: AT })).toBe("stored");
    expect((await summary(ORG, "CP-1"))?.boot).toMatchObject({ messageId: "m2" });
  });
  it(`caps stored identities per CPO at ${MAX_PENDING_IDENTITIES_PER_CPO}; a full CPO with nothing evictable answers "full" and leaves every body intact`, async () => {
    const store = drizzlePendingStore(db);
    for (let i = 0; i < MAX_PENDING_IDENTITIES_PER_CPO; i++) await seedKnock(ORG, `CP-${i}`, AT, { boot: { messageId: `m${i}`, hash: `h${i}`, payload: {} } });
    const c = await cap({ chargePointVendor: "V", chargePointModel: "NEW" });
    expect(await store.storeBoot({ orgId: ORG, chargePointId: "NEW-1", capture: c, at: AT })).toBe("full");
    expect(await rowCount()).toBe(MAX_PENDING_IDENTITIES_PER_CPO);
    expect((await q("select count(*)::int as n from ocpp.pending_discoveries where last_payload_summary->'boot' is not null")).rows[0]).toEqual({ n: MAX_PENDING_IDENTITIES_PER_CPO });
    // Another CPO is unaffected by this CPO's cap.
    expect(await store.storeBoot({ orgId: OTHER, chargePointId: "NEW-1", capture: c, at: AT })).toBe("stored");
  });
  it("at the cap, evicts ONE idle body of a never-registered row (the row stays) and stores the new one", async () => {
    const store = drizzlePendingStore(db);
    for (let i = 0; i < MAX_PENDING_IDENTITIES_PER_CPO; i++) await seedKnock(ORG, `CP-${i}`, new Date(AT.getTime() - (20 + i) * DAY), { boot: { messageId: `m${i}`, hash: `h${i}`, payload: {} } });
    const c = await cap({ chargePointVendor: "V", chargePointModel: "NEW" });
    expect(await store.storeBoot({ orgId: ORG, chargePointId: "NEW-1", capture: c, at: AT })).toBe("stored");
    // The OLDEST idle row (highest i) lost its body only; no row was deleted.
    const oldest = `CP-${MAX_PENDING_IDENTITIES_PER_CPO - 1}`;
    expect(await summary(ORG, oldest)).toEqual({});
    expect(await rowCount()).toBe(MAX_PENDING_IDENTITIES_PER_CPO + 1);
    expect((await summary(ORG, "CP-0"))?.boot).toBeTruthy();
    expect((await summary(ORG, "NEW-1"))?.boot).toMatchObject({ messageId: "m1" });
  });
  it("never evicts a registered charger's retained body, nor anything seen inside the retention window", async () => {
    const store = drizzlePendingStore(db);
    for (let i = 0; i < MAX_PENDING_IDENTITIES_PER_CPO; i++) await seedKnock(ORG, `CP-${i}`, new Date(AT.getTime() - 30 * DAY), { boot: { messageId: `m${i}`, hash: `h${i}`, payload: {} } });
    // Every row is old, but every row is a REGISTERED charger here (case-insensitive match on the identity).
    for (let i = 0; i < MAX_PENDING_IDENTITIES_PER_CPO; i++) await q("insert into assets.device_identities (device_id, cpo_org_id, charge_point_id) values (gen_random_uuid(), $1, $2)", [ORG, `cp-${i}`]);
    const c = await cap({ chargePointVendor: "V", chargePointModel: "NEW" });
    expect(await store.storeBoot({ orgId: ORG, chargePointId: "NEW-1", capture: c, at: AT })).toBe("full");
    expect((await q("select count(*)::int as n from ocpp.pending_discoveries where last_payload_summary->'boot' is not null")).rows[0]).toEqual({ n: MAX_PENDING_IDENTITIES_PER_CPO });
  });
  it("nothing seen inside the retention window is evicted, however full the CPO is", async () => {
    const store = drizzlePendingStore(db);
    for (let i = 0; i < MAX_PENDING_IDENTITIES_PER_CPO; i++) await seedKnock(ORG, `CP-${i}`, new Date(AT.getTime() - 2 * DAY), { boot: { messageId: `m${i}`, hash: `h${i}`, payload: {} } });
    const c = await cap({ chargePointVendor: "V", chargePointModel: "NEW" });
    expect(await store.storeBoot({ orgId: ORG, chargePointId: "NEW-1", capture: c, at: AT })).toBe("full");
  });
  it("evicts an old unregistered body even when OTHER old rows are registered (it picks the right one)", async () => {
    const store = drizzlePendingStore(db);
    for (let i = 0; i < MAX_PENDING_IDENTITIES_PER_CPO; i++) await seedKnock(ORG, `CP-${i}`, new Date(AT.getTime() - (30 + i) * DAY), { boot: { messageId: `m${i}`, hash: `h${i}`, payload: {} } });
    // The oldest ones are registered; the oldest UNREGISTERED is the next in line.
    for (let i = MAX_PENDING_IDENTITIES_PER_CPO - 1; i >= MAX_PENDING_IDENTITIES_PER_CPO - 5; i--) await q("insert into assets.device_identities (device_id, cpo_org_id, charge_point_id) values (gen_random_uuid(), $1, $2)", [ORG, `CP-${i}`]);
    const c = await cap({ chargePointVendor: "V", chargePointModel: "NEW" });
    expect(await store.storeBoot({ orgId: ORG, chargePointId: "NEW-1", capture: c, at: AT })).toBe("stored");
    expect(await summary(ORG, `CP-${MAX_PENDING_IDENTITIES_PER_CPO - 6}`)).toEqual({});
    for (let i = MAX_PENDING_IDENTITIES_PER_CPO - 1; i >= MAX_PENDING_IDENTITIES_PER_CPO - 5; i--) expect((await summary(ORG, `CP-${i}`))?.boot).toBeTruthy();
  });
  it("hasCapture follows the stored body", async () => {
    const store = drizzlePendingStore(db);
    expect(await store.hasCapture({ orgId: ORG, chargePointId: "CP-1" })).toBe(false);
    await store.storeBoot({ orgId: ORG, chargePointId: "CP-1", capture: await cap({ chargePointVendor: "V", chargePointModel: "M" }), at: AT });
    expect(await store.hasCapture({ orgId: ORG, chargePointId: "CP-1" })).toBe(true);
  });
});

describe("recordDiscovery and touch keep the capture", () => {
  it("a refusal reason (with its time) is merged beside the capture, not over it, and the write throttle holds", async () => {
    const adm = drizzleAdmissionStore(db);
    await drizzlePendingStore(db).storeBoot({ orgId: ORG, chargePointId: "CP-1", capture: await cap({ chargePointVendor: "V", chargePointModel: "M" }), at: new Date(AT.getTime() - 3600_000) });
    await adm.recordDiscovery({ orgId: ORG, chargePointId: "CP-1", at: AT, reason: "bad_credentials" });
    expect(await summary(ORG, "CP-1")).toMatchObject({ reason: "bad_credentials", reasonAt: AT.toISOString(), boot: { messageId: "m1" } });
    // Within the throttle window a second, different reason is NOT written.
    await adm.recordDiscovery({ orgId: ORG, chargePointId: "CP-1", at: new Date(AT.getTime() + 60_000), reason: "credentials_required" });
    expect((await summary(ORG, "CP-1"))?.reason).toBe("bad_credentials");
  });
});

describe("promotion intent and outcome (installation store)", () => {
  const withTx = <T>(fn: (tx: Awaited<ReturnType<ReturnType<typeof drizzleStore>["transaction"]>> extends never ? never : Parameters<Parameters<ReturnType<typeof drizzleStore>["transaction"]>[0]>[0]) => Promise<T>) => drizzleStore(db).transaction(fn as never) as Promise<T>;
  it("marks the existing row only; records outcomes and counts attempts; a row without an intent is untouched", async () => {
    await seedKnock(ORG, "CP-1", AT, { boot: { messageId: "m1", hash: "h", payload: {} } });
    await withTx((tx) => tx.markPromotion(ORG, "CP-1", AT));
    await withTx((tx) => tx.markPromotion(ORG, "NEVER-KNOCKED", AT)); // no row: nothing is created
    expect(await rowCount()).toBe(1);
    expect((await summary(ORG, "CP-1"))?.promote).toEqual({ at: AT.toISOString(), delivered: false, attempts: 0, outcome: null });
    expect((await summary(ORG, "CP-1"))?.boot).toBeTruthy();
    await withTx((tx) => tx.recordPromotionOutcome(ORG, "CP-1", { delivered: false, outcome: "error" }));
    await withTx((tx) => tx.recordPromotionOutcome(ORG, "CP-1", { delivered: true, outcome: "reconnect_requested" }));
    expect((await summary(ORG, "CP-1"))?.promote).toEqual({ at: AT.toISOString(), delivered: true, attempts: 2, outcome: "reconnect_requested" });
    await seedKnock(ORG, "CP-2", AT, null);
    await withTx((tx) => tx.recordPromotionOutcome(ORG, "CP-2", { delivered: true, outcome: "x" }));
    expect(await summary(ORG, "CP-2")).toBeNull();
  });
  it("the list read pulls reason, reason time, boot metadata and promotion out of the jsonb without the body", async () => {
    await seedKnock(ORG, "CP-1", AT, { reason: "bad_credentials", reasonAt: AT.toISOString(), boot: { messageId: "m1", receivedAt: AT.toISOString(), hash: "h", payload: { secret: "BODY" } }, promote: { at: AT.toISOString(), delivered: true, attempts: 1, outcome: "reconnect_requested" } });
    const [row] = await withTx((tx) => tx.listDiscoveries(ORG, 10));
    expect(row).toMatchObject({ chargePointId: "CP-1", reason: "bad_credentials", boot: { messageId: "m1" }, promote: { delivered: true, attempts: 1 } });
    expect(row!.reasonAt?.toISOString()).toBe(AT.toISOString());
    expect(JSON.stringify(row)).not.toContain("BODY");
  });
});

describe("lastBootAt: evidence that a registered charger connected", () => {
  it("returns the latest BootNotification receipt per charge point id, case-insensitively, scoped to the CPO and the action", async () => {
    const dev = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const other = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await q("insert into assets.device_identities (device_id, cpo_org_id, charge_point_id) values ($1,$2,'CP-1'), ($3,$4,'CP-1')", [dev, ORG, other, OTHER]);
    await q("insert into ocpp.protocol_receipts (device_id, action, received_at) values ($1,'BootNotification',$2), ($1,'BootNotification',$3), ($1,'StartTransaction',$4), ($5,'BootNotification',$4)", [
      dev, "2026-10-31T10:00:00Z", "2026-10-31T11:00:00Z", "2026-10-31T13:00:00Z", other,
    ]);
    const got = await withTxRead(ORG, ["cp-1", "CP-1", "CP-UNKNOWN"]);
    expect([...got.entries()].map(([k, v]) => [k, v.toISOString()])).toEqual([["cp-1", "2026-10-31T11:00:00.000Z"]]);
  });
  async function withTxRead(org: string, ids: string[]) {
    return drizzleStore(db).transaction((tx) => tx.lastBootAt(org, ids));
  }
});
