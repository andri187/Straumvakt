// Local workerd check of the EXACT release artifacts across a staged rollout. No live bindings, no network, no database.
//
//   node tools/release-checks/mixed-version.mjs <new-gateway-index.js> [<live-baseline-gateway-index.js>]
//
// It runs the built gateway Worker in the real workerd runtime with a REAL service binding to a stub shell, and proves:
//   1. what the runtime really says when a service binding calls a method the receiver does not have (so the gateway's
//      compatibility test matches reality, not a guess);
//   2. NEW gateway + OLD shell (no batch method): queued evidence still drains, one event at a time, in order;
//   3. NEW gateway + NEW shell: the same evidence drains as ONE batch call;
//   4. the durable stop contract is versioned: the new gateway serves requestStopV1; the previous live gateway does not, so a
//      caller of V1 fails closed against it instead of sending an unrecorded command.
// Time is real (the status flush delay is 5 s), so a run takes about 30 seconds.

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const NEW_GATEWAY = process.argv[2];
const OLD_GATEWAY = process.argv[3];
if (!NEW_GATEWAY) { console.error("usage: node tools/release-checks/mixed-version.mjs <new-gateway-index.js> [<live-baseline-gateway-index.js>]"); process.exit(2); }

const requireMf = createRequire(resolve("gateway/node_modules/wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireMf("miniflare");
const makeMf = (options) => new Miniflare(convertV4MiniflareOptions(options));

const CONTEXT = {
  orgId: "11111111-1111-4111-8111-111111111111", installationId: "22222222-2222-4222-8222-222222222222", chargePointId: "LOCAL-CP",
  identityString: "11111111-1111-4111-8111-111111111111/LOCAL-CP", deviceId: "33333333-3333-4333-8333-333333333333",
  placementId: "44444444-4444-4444-8444-444444444444", credentialMode: "none", credentialEpoch: "none:0",
};

const engineSource = (withBatch) => `
import { WorkerEntrypoint } from "cloudflare:workers";
const log = (globalThis.__log ??= { calls: [], batches: [] });
const context = ${JSON.stringify(CONTEXT)};
const ok = { kind: "answer", answer: { kind: "result", payload: {} } };
export class EngineEntrypoint extends WorkerEntrypoint {
  async admit() { return { kind: "admit", context }; }
  async call(body) {
    log.calls.push(body.action + ":" + body.messageId);
    return { kind: "answer", answer: { kind: "result", payload: body.action === "BootNotification" ? { status: "Accepted", currentTime: new Date().toISOString(), interval: 300 } : {} } };
  }
  ${withBatch ? `async callBatchV1(input) { log.batches.push(input.map((i) => i.messageId)); return input.map((i) => ({ messageId: i.messageId, outcome: ok })); }` : ""}
}
export default { async fetch() { return Response.json(log); } };
`;

// A tiny caller worker, to see exactly what a service-binding call to a missing method does at runtime.
const probeSource = `
export default {
  async fetch(req, env) {
    const which = new URL(req.url).pathname.slice(1);
    try {
      const result = which === "batch" ? await env.ENGINE.callBatchV1([]) : which === "stop-new" ? await env.GATEWAY_NEW.requestStopV1(JSON.parse(await req.text())) : await env.GATEWAY_OLD.requestStopV1(JSON.parse(await req.text()));
      return Response.json({ ok: true, result });
    } catch (e) { return Response.json({ ok: false, name: e && e.name, message: e && e.message }); }
  },
};
`;

const results = { checks: [] };
const pass = (name, detail) => { results.checks.push({ name, ok: true, ...(detail !== undefined ? { detail } : {}) }); console.log("  ok  ", name, detail !== undefined ? JSON.stringify(detail) : ""); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gatewayWorker(path, extra = {}) {
  return {
    name: extra.name ?? "gateway", modules: true, script: await readFile(resolve(path), "utf8"), compatibilityDate: "2026-10-26", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { IDENTITY_DO: { className: "IdentityDurableObject", useSQLite: true } },
    serviceBindings: { ENGINE: { name: "engine", entrypoint: "EngineEntrypoint" } },
    bindings: { OCPP_ALLOWED_HOSTS: "local.straumvakt.org", PENDING_ONBOARDING: "false" },
    ratelimits: { OCPP_HOST_LIMITER: { namespace_id: "9001", simple: { limit: 1000, period: 60 } }, OCPP_IDENTITY_LIMITER: { namespace_id: "9002", simple: { limit: 1000, period: 60 } } },
    unsafeEphemeralDurableObjects: true,
  };
}

async function connectAndSend(mf, count) {
  const res = await (await mf.getWorker("gateway")).fetch("http://local.straumvakt.org/LOCAL-CP", { headers: { Upgrade: "websocket", "sec-websocket-protocol": "ocpp1.6" } });
  assert.equal(res.status, 101, "websocket upgrade refused: " + res.status + " " + (res.status === 101 ? "" : await res.text()));
  const ws = res.webSocket;
  const replies = [];
  ws.addEventListener("message", (e) => replies.push(JSON.parse(e.data)));
  ws.accept();
  for (let i = 1; i <= count; i++) {
    ws.send(JSON.stringify([2, `s${i}`, "StatusNotification", { connectorId: 1, status: i % 2 ? "Preparing" : "Charging", errorCode: "NoError", timestamp: new Date(Date.now() + i).toISOString() }]));
  }
  const end = Date.now() + 5000;
  while (replies.length < count && Date.now() < end) await sleep(25);
  assert.equal(replies.length, count, "the gateway acknowledged every frame to the charger");
  return ws;
}

async function engineLog(mf) { return (await (await mf.getWorker("engine")).fetch("http://engine/")).json(); }

async function drainScenario(label, withBatch) {
  const mf = makeMf({
    host: "127.0.0.1",
    workers: [
      { name: "engine", modules: true, script: engineSource(withBatch), compatibilityDate: "2026-10-26", compatibilityFlags: ["nodejs_compat"] },
      await gatewayWorker(NEW_GATEWAY),
    ],
  });
  try {
    const ws = await connectAndSend(mf, 3);
    // Status frames are delivered after their (real) 5 s flush delay, by the Durable Object alarm.
    const end = Date.now() + 25000;
    let log;
    do { await sleep(500); log = await engineLog(mf); } while (log.calls.filter((c) => c.startsWith("StatusNotification")).length + log.batches.flat().length < 3 && Date.now() < end);
    ws.close(1000, "done");
    return log;
  } finally { await mf.dispose(); }
}

(async () => {
  // 1. The real runtime message for a missing method.
  {
    const mf = makeMf({
      host: "127.0.0.1",
      workers: [
        { name: "engine", modules: true, script: engineSource(false), compatibilityDate: "2026-10-26", compatibilityFlags: ["nodejs_compat"] },
        { name: "probe", modules: true, script: probeSource, compatibilityDate: "2026-10-26", serviceBindings: { ENGINE: { name: "engine", entrypoint: "EngineEntrypoint" } } },
      ],
    });
    try {
      const out = await (await (await mf.getWorker("probe")).fetch("http://probe/batch")).json();
      assert.equal(out.ok, false);
      assert.match(out.message, /does not implement|is not a function|no such method/i, `unexpected runtime message: ${out.message}`);
      results.runtimeMessage = out.message;
      pass("a service-binding call to a missing method rejects with a message the gateway's compatibility test recognises", { message: out.message });
    } finally { await mf.dispose(); }
  }

  // 2. New gateway + old shell.
  {
    const log = await drainScenario("old shell", false);
    assert.deepEqual(log.calls.filter((c) => c.startsWith("StatusNotification")).map((c) => c.split(":")[1]), ["s1", "s2", "s3"]);
    assert.equal(log.batches.length, 0);
    results.oldShell = log;
    pass("NEW gateway + OLD shell (no batch method): all 3 queued events drained one by one, in order, via the older contract", { calls: log.calls, batchCalls: log.batches.length });
  }

  // 3. New gateway + new shell.
  {
    const log = await drainScenario("new shell", true);
    assert.equal(log.batches.length, 1, "exactly one batch call");
    assert.deepEqual(log.batches[0], ["s1", "s2", "s3"]);
    assert.equal(log.calls.filter((c) => c.startsWith("StatusNotification")).length, 0, "no per-event calls");
    results.newShell = log;
    pass("NEW gateway + NEW shell: the same 3 events drained as ONE batch call (3 RPCs -> 1)", { batches: log.batches });
  }

  // 4. Versioned durable stop contract.
  {
    const workers = [
      { name: "engine", modules: true, script: engineSource(true), compatibilityDate: "2026-10-26", compatibilityFlags: ["nodejs_compat"] },
      await gatewayWorker(NEW_GATEWAY, { name: "gateway-new" }),
    ];
    if (OLD_GATEWAY) workers.push(await gatewayWorker(OLD_GATEWAY, { name: "gateway-old" }));
    workers.push({
      name: "probe", modules: true, script: probeSource, compatibilityDate: "2026-10-26",
      serviceBindings: { ENGINE: { name: "engine", entrypoint: "EngineEntrypoint" }, GATEWAY_NEW: { name: "gateway-new", entrypoint: "CommandEntrypoint" }, ...(OLD_GATEWAY ? { GATEWAY_OLD: { name: "gateway-old", entrypoint: "CommandEntrypoint" } } : {}) },
    });
    const mf = makeMf({ host: "127.0.0.1", workers });
    try {
      const body = JSON.stringify({ deviceId: CONTEXT.deviceId, transactionNo: 7, requestId: "req-1", attemptId: "req-1:7:1", placementId: CONTEXT.placementId, deadlineMs: Date.now() + 30000 });
      const probe = await mf.getWorker("probe");
      const fresh = await (await probe.fetch("http://probe/stop-new", { method: "POST", body })).json();
      assert.equal(fresh.ok, true, `new gateway must serve requestStopV1: ${JSON.stringify(fresh)}`);
      assert.ok(["offline", "unavailable", "timeout", "rejected", "accepted"].includes(fresh.result.outcome));
      pass("the NEW gateway serves requestStopV1 (a device with no live socket answers with an outcome, never an error)", fresh.result);
      if (OLD_GATEWAY) {
        const stale = await (await probe.fetch("http://probe/stop-old", { method: "POST", body })).json();
        assert.equal(stale.ok, false);
        assert.match(stale.message, /does not implement|is not a function|no such method/i);
        results.oldGatewayStop = stale.message;
        pass("the PREVIOUS live gateway has no requestStopV1: a V1 caller is rejected and fails closed (nothing is sent)", { message: stale.message });
      }
    } finally { await mf.dispose(); }
  }

  console.log(JSON.stringify({ result: "PASS", checks: results.checks.length }));
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
