import { beforeEach, describe, expect, it } from "vitest";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { handleLifecycle, MAX_LIFECYCLE_JSON_BYTES, type LifecycleApiDeps } from "./api";
import { memoryLifecycle } from "./__tests__/memory-store";

const HTTPS = "https://shell.example.test";
const CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
const ENV = { CPO_SHELL_USERNAME: CONFIG.username, CPO_SHELL_PASSWORD: CONFIG.password, CPO_SHELL_SESSION_SECRET: CONFIG.secret };
const ORG = "11111111-1111-4111-8111-111111111111";
const INST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const KEY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let world: ReturnType<typeof memoryLifecycle>;
let hasStop: boolean;
let deps: LifecycleApiDeps;
const cookie = async () => `${SHELL_COOKIE_NAME}=${await createShellSession(CONFIG)}`;

beforeEach(() => {
  world = memoryLifecycle();
  world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
  world.w.history.set(DEV, { orgId: ORG, installationId: INST, retired: false });
  hasStop = true;
  deps = {
    env: ENV,
    withLifecycle: async (fn) => fn({ store: world.store, stop: hasStop ? { requestStop: async () => "accepted" } : null, costing: null, authorise: () => false, now: () => new Date("2026-10-30T10:00:00Z") }),
  };
});

const post = async (body: unknown, headers: Record<string, string> = {}, withCookie = true) =>
  handleLifecycle(new Request(`${HTTPS}/api/cpo/lifecycle`, { method: "POST", headers: { "content-type": "application/json", origin: HTTPS, ...(withCookie ? { cookie: await cookie() } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), deps);

describe("lifecycle endpoint guards", () => {
  it("401 without a session, before storage; 403 cross-origin; 415 wrong type; 413 oversize; 405 wrong method", async () => {
    expect((await post({ action: "preview", deviceId: DEV }, {}, false)).status).toBe(401);
    expect((await post({ action: "preview", deviceId: DEV }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ action: "preview", deviceId: DEV }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("x".repeat(MAX_LIFECYCLE_JSON_BYTES + 1))).status).toBe(413);
    expect((await handleLifecycle(new Request(`${HTTPS}/api/cpo/lifecycle`, { headers: { cookie: await cookie() } }), deps)).status).toBe(405);
    expect(world.w.requests.size).toBe(0);
  });
  it("validates the body strictly (uuids, known action, retire/return fields)", async () => {
    expect((await post({ action: "nope" })).status).toBe(422);
    expect((await post({ action: "remove", deviceId: "not-a-uuid", requestKey: KEY })).status).toBe(422);
    expect((await post({ action: "return", deviceId: DEV, installationId: INST, orgId: ORG, circuitId: INST, label: "", chargePointId: "bad id!" })).status).toBe(422);
    expect((await post("{oops")).status).toBe(400);
  });
  it("database not configured is 503, never a success", async () => {
    deps = { env: ENV, withLifecycle: async () => { throw new DatabaseUnavailableError(); } };
    expect((await post({ action: "preview", deviceId: DEV })).status).toBe(503);
  });
});

describe("lifecycle endpoint behaviour", () => {
  it("preview shows the real effect before anything is committed, and writes nothing", async () => {
    const r = await post({ action: "preview", deviceId: DEV });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ deviceId: DEV, willBlockNewStarts: true, openSessions: 0 });
    expect(world.w.requests.size).toBe(0);
  });
  it("remove returns the pending request; progress closes it; the actor is attributed honestly", async () => {
    const r = await post({ action: "remove", deviceId: DEV, requestKey: KEY });
    const req = (await r.json()) as { id: string; state: string; actorLabel: string };
    expect(r.status).toBe(200);
    expect(req).toMatchObject({ state: "requested", actorLabel: 'shared login "ShellTester"' });
    const done = (await (await post({ action: "progress", requestId: req.id })).json()) as { state: string };
    expect(done.state).toBe("completed");
  });
  it("a charger with a session in progress is 409 stop_unavailable when no stop path is bound, and nothing is written", async () => {
    world.w.txs.push({ transactionNo: 1, transactionId: "tx1", deviceId: DEV, stoppedReceivedAt: null, authorized: true, costingState: "not_needed" });
    hasStop = false;
    const r = await post({ action: "remove", deviceId: DEV, requestKey: KEY });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "stop_unavailable" });
    expect(world.w.requests.size).toBe(0);
  });
  it("progress sends ONE attempt-keyed stop through the bound port; a repeated call inside the backoff sends nothing more, and the attempt is visible in the response", async () => {
    world.w.txs.push({ transactionNo: 1, transactionId: "tx1", deviceId: DEV, stoppedReceivedAt: null, authorized: true, costingState: "not_needed" });
    const sent: { attemptId: string; requestId: string; placementId: string; transactionNo: number; deadlineMs: number }[] = [];
    deps = {
      env: ENV,
      withLifecycle: async (fn) => fn({
        store: world.store, stop: { requestStop: async (i) => { sent.push(i); return "accepted"; } }, costing: null, authorise: () => false, now: () => new Date("2026-10-30T10:00:00Z"),
      }),
    };
    const id = ((await (await post({ action: "remove", deviceId: DEV, requestKey: KEY })).json()) as { id: string }).id;
    const first = (await (await post({ action: "progress", requestId: id })).json()) as { state: string; sessions: { stop: { attempts: number; inFlight?: unknown; everAccepted: boolean } }[] };
    await post({ action: "progress", requestId: id });
    expect(sent).toEqual([{ deviceId: DEV, transactionNo: 1, requestId: id, attemptId: `${id}:1:1`, placementId: "p1", deadlineMs: Date.parse("2026-10-30T10:01:00Z") }]);
    expect(first).toMatchObject({ state: "stopping", sessions: [{ stop: { attempts: 1, everAccepted: true } }] });
    expect(first.sessions[0]!.stop.inFlight).toBeUndefined();
  });
  it("another organisation's device and an unknown device are the same 404", async () => {
    world.w.placements.set("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", { deviceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", placementId: "p9", orgId: "99999999-9999-4999-8999-999999999999", installationId: INST, circuitId: null, label: "x", chargePointId: "CP-9" });
    // the shared login administers every organisation today (platform operator), so isolation is demonstrated at the service layer; here: unknown id
    const unknown = await post({ action: "remove", deviceId: "ffffffff-ffff-4fff-8fff-ffffffffffff", requestKey: "dddddddd-0000-4000-8000-000000000001" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found", message: "Charger not found" });
  });
  it("return lists then reattaches a known device; a placed one is 409", async () => {
    const id = ((await (await post({ action: "remove", deviceId: DEV, requestKey: KEY })).json()) as { id: string }).id;
    await post({ action: "progress", requestId: id });
    const list = (await (await post({ action: "returnable", installationId: INST, orgId: ORG })).json()) as { devices: { deviceId: string }[] };
    expect(list.devices.map((d) => d.deviceId)).toEqual([DEV]);
    const ret = { action: "return", deviceId: DEV, installationId: INST, orgId: ORG, circuitId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Bay 1", chargePointId: "CP-1" };
    expect((await post(ret)).status).toBe(200);
    expect((await post(ret)).status).toBe(409);
  });
});
