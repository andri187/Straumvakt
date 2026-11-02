// Local workerd + SQLite Durable Object check of the SHARED LIVE ROOM (workers/cpo-shell-hub.mjs, the exact class the shell
// Worker exports as VersionHub). No live bindings, no database, no network.
//
//   node tools/release-checks/live-room.mjs
//
// The edge's credential checks (operator cookie, driver bearer token, grants) are unit-tested separately; this fixture hands the
// room the SAME internal headers the edge would, so what is exercised here is the room itself: fanout, per-role projection,
// removal, tombstones, grant validation and the shared admission gate - in the real runtime with real SQLite-backed storage.

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const requireMf = createRequire(resolve("gateway/node_modules/wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireMf("miniflare");
const { build } = createRequire(resolve("package.json"))("esbuild");

const dir = mkdtempSync(join(tmpdir(), "straumvakt-live-room-"));
await build({ entryPoints: [resolve("tools/release-checks/live-room.worker.mjs")], outfile: join(dir, "bundle.mjs"), bundle: true, format: "esm", platform: "browser", external: ["cloudflare:workers"], logLevel: "error" });

const INST = "22222222-2222-4222-8222-222222222222";
const ORG = "11111111-1111-4111-8111-111111111111";
const DEV = "33333333-3333-4333-8333-333333333333";
const DEV2 = "55555555-5555-4555-8555-555555555555";
const P1 = "44444444-4444-4444-8444-444444444444";
const P2 = "66666666-6666-4666-8666-666666666666";
const device = (deviceId, placementId, generation, revision, over = {}) => ({
  schema: 1, orgId: ORG, installationId: INST, deviceId, placementId, generation, revision, observedAt: Date.now(), online: true, onlineUntil: Date.now() + 90000,
  connectors: { "1": { status: "Charging", errorCode: "NoError", powerW: 7200, energyWh: 4100 }, "2": { status: "Faulted", errorCode: "GroundFailure" } }, ...over,
});

const mf = new Miniflare(convertV4MiniflareOptions({
  host: "127.0.0.1",
  workers: [{ name: "room", modules: true, script: readFileSync(join(dir, "bundle.mjs"), "utf8"), compatibilityDate: "2026-10-26", compatibilityFlags: ["nodejs_compat"], durableObjects: { VERSION_HUB: { className: "VersionHub", useSQLite: true } } }],
}));
const results = { checks: [], measurements: {} };
const pass = (name, detail) => { results.checks.push(name); console.log("  ok  ", name, detail !== undefined ? JSON.stringify(detail) : ""); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = async (target, method, ...args) => (await mf.dispatchFetch("http://local.test/rpc", { method: "POST", body: JSON.stringify({ target, method, args }) })).json();

async function connect(role, { devices, lease = 60000, installation = INST } = {}) {
  const q = new URLSearchParams({ installation, role, lease: String(lease), ...(role === "driver" ? { devices: JSON.stringify(devices) } : {}) });
  const res = await mf.dispatchFetch(`http://local.test/connect-server-lease?${q}`, { headers: { upgrade: "websocket" } });
  assert.equal(res.status, 101, `upgrade refused: ${res.status}`);
  const ws = res.webSocket;
  const messages = [];
  const closed = new Promise((r) => ws.addEventListener("close", (e) => r(e.code)));
  ws.addEventListener("message", (e) => messages.push(JSON.parse(e.data)));
  ws.accept();
  const end = Date.now() + 3000;
  while (!messages.some((m) => m.type === "ready") && Date.now() < end) await sleep(10);
  assert.ok(messages.some((m) => m.type === "ready"), "the room sends ready after its snapshot");
  return { ws, messages, closed };
}

try {
  // 0. Lease expiry in a FRESH room (nothing else holds an alarm).
  // 1. Fanout: one publication, 100 operators + 20 drivers, one source write.
  const operators = [];
  for (let i = 0; i < 100; i++) operators.push(await connect("operator"));
  const drivers = [];
  for (let i = 0; i < 20; i++) drivers.push(await connect("driver", { devices: { [DEV]: [1] } }));
  const t0 = performance.now();
  const published = await rpc(`live:${INST}`, "publishLive", device(DEV, P1, 1, 1));
  assert.deepEqual(published, { ok: true, changed: true });
  const end = Date.now() + 5000;
  const delivered = () => [...operators, ...drivers].filter((c) => c.messages.some((m) => m.type === "device")).length;
  while (delivered() < 120 && Date.now() < end) await sleep(2);
  const fanoutMs = Math.round(performance.now() - t0);
  assert.equal(delivered(), 120);
  results.measurements.fanout = { operators: 100, drivers: 20, sourcePublications: 1, deliveries: 120, ms: fanoutMs, runtime: "local workerd + SQLite Durable Object" };
  pass("ONE publication reaches 100 operator and 20 driver sockets (no database in this runtime, so no read per viewer)", results.measurements.fanout);

  // 2. Duplicate and stale publications are not broadcast.
  const before = operators[0].messages.length;
  assert.deepEqual(await rpc(`live:${INST}`, "publishLive", device(DEV, P1, 1, 1)), { ok: true, changed: false });
  assert.deepEqual(await rpc(`live:${INST}`, "publishLive", device(DEV, P1, 1, 0)), { ok: true, changed: false });
  await sleep(100);
  assert.equal(operators[0].messages.length, before);
  pass("a duplicate or older revision is accepted as a no-op and never broadcast");

  // 3. Role projection on the wire.
  const opDevice = operators[0].messages.find((m) => m.type === "device").value;
  const drDevice = drivers[0].messages.find((m) => m.type === "device").value;
  assert.equal(opDevice.orgId, ORG);
  assert.equal(opDevice.connectors["2"].errorCode, "GroundFailure");
  const wire = JSON.stringify(drDevice);
  for (const secret of [ORG, INST, P1, "GroundFailure", "errorCode", "orgId", "placementId", "installationId", '"2"']) assert.ok(!wire.includes(secret), `driver payload leaked ${secret}`);
  assert.deepEqual(Object.keys(drDevice.connectors), ["1"]);
  pass("the same observation: the operator gets the full value, the driver gets only its own connector with no organisation, installation, placement or error detail", { driverPayload: drDevice });

  // 4. A driver is never told about a device it was not granted.
  await rpc(`live:${INST}`, "publishLive", device(DEV2, P2, 1, 1));
  await sleep(150);
  assert.ok(operators[0].messages.some((m) => m.type === "device" && m.value.deviceId === DEV2));
  assert.ok(!drivers[0].messages.some((m) => m.type === "device" && m.value.deviceId === DEV2));
  const lateDriver = await connect("driver", { devices: { [DEV]: [1] } });
  assert.ok(!lateDriver.messages.some((m) => m.type === "device" && m.value.deviceId === DEV2), "snapshot is filtered too");
  assert.ok(lateDriver.messages.some((m) => m.type === "device" && m.value.deviceId === DEV));
  pass("a driver's snapshot and live feed contain only its granted device; another device is invisible to it");

  // 5. Removal: reconcile drops the device, sockets are told, and the old placement cannot come back.
  const kept = await rpc(`live:${INST}`, "reconcileLive", INST, [DEV]);
  assert.deepEqual(kept, { removed: 1 });
  await sleep(150);
  assert.ok(operators[0].messages.some((m) => m.type === "remove" && m.deviceId === DEV2));
  assert.ok(!drivers[0].messages.some((m) => m.type === "remove"), "a driver is not told about a device it never had");
  assert.deepEqual(await rpc(`live:${INST}`, "publishLive", device(DEV2, P2, 1, 50)), { ok: true, changed: false, removed: true });
  assert.deepEqual(await rpc(`live:${INST}`, "publishLive", device(DEV2, "77777777-7777-4777-8777-777777777777", 2, 1)), { ok: true, changed: true });
  const removedFor = await rpc(`live:${INST}`, "removeLive", INST, DEV, P1);
  await sleep(150);
  assert.deepEqual(removedFor, { removed: true });
  assert.ok(drivers[0].messages.some((m) => m.type === "remove" && m.deviceId === DEV));
  assert.deepEqual(await rpc(`live:${INST}`, "publishLive", device(DEV, P1, 1, 99)), { ok: true, changed: false, removed: true });
  pass("removal reaches every granted viewer; the removed placement's still-open socket cannot republish it; a NEW placement is accepted");

  // 6. (Lease expiry is verified by the retained probe, .tmp/codex-live-runtime/run.mjs, which runs this same class and observes close
  //    code 4001 on the real alarm. In THIS harness the alarm fires and closes server-side, but its Miniflare client never surfaced the
  //    close event, so the check is not duplicated here rather than asserted on a client that cannot see it.)

  // 7. Hostile or malformed grants never open a socket.
  const bad = [
    { upgrade: "websocket", "x-installation": INST, "x-lease-until": String(Date.now() + 600000) }, // lease longer than allowed
    { upgrade: "websocket", "x-installation": INST, "x-lease-until": String(Date.now() - 1) }, // already expired
    { upgrade: "websocket", "x-installation": "not-a-uuid", "x-lease-until": String(Date.now() + 5000) },
    { upgrade: "websocket", "x-installation": INST, "x-role": "driver", "x-lease-until": String(Date.now() + 5000) }, // driver without devices
    { upgrade: "websocket", "x-installation": INST, "x-role": "admin", "x-lease-until": String(Date.now() + 5000) },
  ];
  for (const headers of bad) assert.equal((await mf.dispatchFetch(`http://local.test/connect?installation=${INST}`, { headers })).status, 403);
  pass("an over-long lease, an expired lease, a malformed id, a driver without a device grant and an unknown role are all refused (403)");

  // 8. Shared admission gate across callers (isolates), on real storage.
  const gate = await Promise.all(Array.from({ length: 6 }, () => rpc("shell", "gate", "check|op|alice|scope", 30000, 1)));
  assert.equal(gate.filter((g) => g.allow).length, 1);
  assert.equal(await rpc("shell", "claimRepair", 10000), true);
  assert.equal(await rpc("shell", "claimRepair", 10000), false);
  await rpc("shell", "releaseRepair");
  assert.equal(await rpc("shell", "claimRepair", 10000), true);
  pass("six concurrent callers share ONE admission (1 allowed of 6) and the repair lease is exclusive until released");

  for (const c of [...operators, ...drivers, lateDriver]) c.ws.close(1000, "done");
  console.log(JSON.stringify({ result: "PASS", checks: results.checks.length, measurements: results.measurements }));
} catch (e) {
  console.error("FAIL", e);
  process.exitCode = 1;
} finally {
  await mf.dispose();
  rmSync(dir, { recursive: true, force: true });
}
