import { describe, expect, it } from "vitest";
import type { LiveDevice } from "../ocpp-engine/live-projection";
import { MAX_DRIVER_DEVICES, deliver, grantFromHeaders, parseGrant, snapshotFor, toDriverProjection, type Grant } from "./live-fanout";

const INST = "11111111-1111-4111-8111-111111111111";
const OTHER_INST = "22222222-2222-4222-8222-222222222222";
const DEV_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DEV_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ORG = "99999999-9999-4999-8999-999999999999";
const PL = "55555555-5555-4555-8555-555555555555";

const device = (deviceId = DEV_A, over: Partial<LiveDevice> = {}): LiveDevice => ({
  schema: 1, orgId: ORG, installationId: INST, deviceId, placementId: PL, generation: 3, revision: 9, observedAt: 1_000, online: true, onlineUntil: 61_000,
  connectors: { "1": { status: "Charging", errorCode: "NoError", reportedAt: "2026-11-01T10:00:00Z", powerW: 7200, energyWh: 4100 }, "2": { status: "Faulted", errorCode: "GroundFailure" } }, ...over,
});
const operator: Grant = { role: "operator", installationId: INST, expiresAt: 99_000 };
const driver = (devices = { [DEV_A]: [1] }): Grant => ({ role: "driver", installationId: INST, expiresAt: 99_000, devices });

describe("operator fanout", () => {
  it("receives the full normalized observation for its installation only", () => {
    expect(deliver(operator, { type: "device", value: device() })).toEqual({ type: "device", value: device() });
    expect(deliver(operator, { type: "device", value: device(DEV_A, { installationId: OTHER_INST }) })).toBeNull();
  });
  it("is told of every removal in its room", () => {
    expect(deliver(operator, { type: "remove", deviceId: DEV_B })).toEqual({ type: "remove", deviceId: DEV_B });
  });
});

describe("driver projection is minimal and scoped", () => {
  it("shows only the granted device and connector, with no organisation, installation, placement or error detail", () => {
    const out = deliver(driver(), { type: "device", value: device() });
    expect(out).toEqual({ type: "device", value: { schema: 1, deviceId: DEV_A, generation: 3, revision: 9, observedAt: 1_000, online: true, onlineUntil: 61_000, connectors: { "1": { status: "Charging", reportedAt: "2026-11-01T10:00:00Z", powerW: 7200, energyWh: 4100 } } } });
    const text = JSON.stringify(out);
    for (const secret of [ORG, INST, PL, "GroundFailure", "errorCode", "orgId", "placementId", "installationId", "Faulted"]) expect(text, secret).not.toContain(secret);
  });
  it("receives nothing about a device or an installation it was not granted", () => {
    expect(deliver(driver(), { type: "device", value: device(DEV_B) })).toBeNull();
    expect(deliver(driver(), { type: "device", value: device(DEV_A, { installationId: OTHER_INST }) })).toBeNull();
    expect(deliver(driver(), { type: "remove", deviceId: DEV_B })).toBeNull();
    expect(deliver(driver(), { type: "remove", deviceId: DEV_A })).toEqual({ type: "remove", deviceId: DEV_A });
  });
  it("a connector the driver is not on is never projected, even on a granted device", () => {
    const out = toDriverProjection(device(), [2]);
    expect(Object.keys(out.connectors)).toEqual(["2"]);
    expect(toDriverProjection(device(), [9]).connectors).toEqual({});
  });
  it("one publication, two audiences: the same observation serves both without a read", () => {
    const value = device();
    const snaps = [operator, driver()].map((g) => snapshotFor(g, [value, device(DEV_B)]));
    expect(snaps[0]).toHaveLength(2);
    expect(snaps[1]).toHaveLength(1);
  });
  it("an unknown role receives nothing", () => {
    expect(deliver({ role: "viewer", installationId: INST, expiresAt: 1 } as never, { type: "device", value: device() })).toBeNull();
  });
});

describe("grants and the internal header contract", () => {
  const get = (h: Record<string, string>) => (n: string) => h[n] ?? null;
  it("accepts operator and driver grants, defaults the role to operator, and bounds the lease", () => {
    const now = 1_000_000;
    expect(grantFromHeaders(get({ "x-installation": INST, "x-lease-until": String(now + 30_000) }), now, 60_000)).toEqual({ role: "operator", installationId: INST, expiresAt: now + 30_000 });
    const g = grantFromHeaders(get({ "x-installation": INST, "x-role": "driver", "x-lease-until": String(now + 30_000), "x-driver-devices": JSON.stringify({ [DEV_A]: [1, 1] }) }), now, 60_000);
    expect(g).toEqual({ role: "driver", installationId: INST, expiresAt: now + 30_000, devices: { [DEV_A]: [1] } });
    expect(grantFromHeaders(get({ "x-installation": INST, "x-lease-until": String(now + 61_000) }), now, 60_000)).toBeNull(); // longer than a lease
    expect(grantFromHeaders(get({ "x-installation": INST, "x-lease-until": String(now - 1) }), now, 60_000)).toBeNull(); // already expired
  });
  it("refuses malformed or oversized driver grants", () => {
    const now = 1_000_000;
    const base = { "x-installation": INST, "x-role": "driver", "x-lease-until": String(now + 1000) };
    expect(grantFromHeaders(get({ ...base }), now, 60_000)).toBeNull(); // no devices
    expect(grantFromHeaders(get({ ...base, "x-driver-devices": "not json" }), now, 60_000)).toBeNull();
    expect(grantFromHeaders(get({ ...base, "x-driver-devices": JSON.stringify({ "not-a-uuid": [1] }) }), now, 60_000)).toBeNull();
    expect(grantFromHeaders(get({ ...base, "x-driver-devices": JSON.stringify({ [DEV_A]: [] }) }), now, 60_000)).toBeNull();
    expect(grantFromHeaders(get({ ...base, "x-driver-devices": JSON.stringify({ [DEV_A]: [70000] }) }), now, 60_000)).toBeNull();
    const many = Object.fromEntries(Array.from({ length: MAX_DRIVER_DEVICES + 1 }, (_, i) => [`aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`, [1]]));
    expect(grantFromHeaders(get({ ...base, "x-driver-devices": JSON.stringify(many) }), now, 60_000)).toBeNull();
    expect(parseGrant({ role: "admin", installationId: INST, expiresAt: 1 })).toBeNull();
    expect(parseGrant(null)).toBeNull();
  });
});
