// Entry-Worker tests. The upgrade handler rebuilds the charger's
// request from scratch before handing it to the Durable Object, so
// P4.17's subprotocol offer would be dropped on the floor unless it is
// explicitly relayed. These tests pin that relay — the DO can echo
// only what it is told about.

import { afterEach, describe, expect, it, vi } from "vitest";

// `cloudflare:workers` exists only in the Workers runtime; the entry module re-exports the command entrypoint.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class { constructor(public ctx: unknown, public env: unknown) {} } }));

import worker from "./index";

type WorkerEnv = Parameters<typeof worker.fetch>[1];

const IDENTITY_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";

function makeEnv(over: Record<string, unknown> = { LEGACY_OCPP_ENABLED: "true" }): { env: WorkerEnv; forwarded: Request[] } {
  const forwarded: Request[] = [];
  const env = {
    ...over,
    IDENTITY_DO: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (req: Request) => {
          forwarded.push(req);
          // Node's Response rejects status 101, and the entry Worker
          // passes whatever the DO returns straight through — the
          // status is irrelevant to what we assert here.
          return new Response("ok", { status: 200 });
        },
      }),
    },
    MAIN_APP: {
      fetch: async () =>
        new Response(JSON.stringify({ identityId: IDENTITY_ID, orgId: ORG_ID }), {
          status: 200,
        }),
    },
    OCPP_INGEST_SECRET: "test-secret",
  } as unknown as WorkerEnv;
  return { env, forwarded };
}

function upgradeRequest(headers: Record<string, string>): Request {
  return new Request("https://gw.internal/ocpp/zpr-test-001", {
    method: "GET",
    headers: { upgrade: "websocket", ...headers },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("entry Worker upgrade forwarding", () => {
  it("relays the client's Sec-WebSocket-Protocol offer to the DO", async () => {
    const { env, forwarded } = makeEnv();

    await worker.fetch(
      upgradeRequest({ "sec-websocket-protocol": "ocpp2.0.1, ocpp1.6" }),
      env,
    );

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.headers.get("x-straumvakt-ws-protocol")).toBe(
      "ocpp2.0.1, ocpp1.6",
    );
    expect(forwarded[0]!.headers.get("x-straumvakt-identity-id")).toBe(IDENTITY_ID);
  });

  it("relays no subprotocol header when the client offered none", async () => {
    const { env, forwarded } = makeEnv();

    await worker.fetch(upgradeRequest({}), env);

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.headers.get("x-straumvakt-ws-protocol")).toBeNull();
  });
});

describe("P4.18 invalidate-authorize routing", () => {
  function invalidateRequest(headers: Record<string, string>, body: unknown): Request {
    return new Request(`https://gw.internal/invalidate-authorize/${IDENTITY_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("forwards an authenticated call to the identity's DO", async () => {
    const { env, forwarded } = makeEnv();

    const res = await worker.fetch(
      invalidateRequest({ "x-straumvakt-ingest": "test-secret" }, { idTag: "TAG-A" }),
      env,
    );

    expect(res.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(new URL(forwarded[0]!.url).pathname).toBe("/invalidate-authorize");
    expect(await forwarded[0]!.json()).toEqual({ idTag: "TAG-A" });
  });

  it("rejects a call without the ingest secret and never reaches the DO", async () => {
    const { env, forwarded } = makeEnv();

    const res = await worker.fetch(invalidateRequest({}, { idTag: "TAG-A" }), env);

    expect(res.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });

  it("rejects a wrong ingest secret", async () => {
    const { env, forwarded } = makeEnv();

    const res = await worker.fetch(
      invalidateRequest({ "x-straumvakt-ingest": "nope" }, { idTag: "TAG-A" }),
      env,
    );

    expect(res.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });
});

// ── Adopted path: legacy exclusion and the engine route ──────────────────────

describe("legacy path exclusion (adopted configuration)", () => {
  it("with the switch unset, /ocpp/<id>, /ocpp/1.6/<id>, /dispatch and /invalidate-authorize all answer 404 and never reach the DO or the legacy API", async () => {
    const { env, forwarded } = makeEnv({});
    const mainApp = vi.fn(async () => new Response("{}", { status: 200 }));
    (env as unknown as { MAIN_APP: { fetch: unknown } }).MAIN_APP.fetch = mainApp;
    const cases: [string, string, Record<string, string>][] = [
      ["GET", "https://gw.internal/ocpp/zpr-test-001", { upgrade: "websocket" }],
      ["GET", "https://gw.internal/ocpp/1.6/zpr-test-001", { upgrade: "websocket" }],
      ["POST", `https://gw.internal/dispatch/${IDENTITY_ID}`, { "x-straumvakt-ingest": "test-secret" }],
      ["POST", `https://gw.internal/invalidate-authorize/${IDENTITY_ID}`, { "x-straumvakt-ingest": "test-secret" }],
    ];
    for (const [method, url, headers] of cases) {
      const res = await worker.fetch(new Request(url, { method, headers }), env);
      expect(res.status, url).toBe(404);
    }
    expect(forwarded).toHaveLength(0);
    expect(mainApp).not.toHaveBeenCalled();
  });
  it("only the exact string \"true\" re-enables it", async () => {
    for (const v of ["1", "TRUE", "yes", ""]) {
      const { env } = makeEnv({ LEGACY_OCPP_ENABLED: v });
      const res = await worker.fetch(new Request("https://gw.internal/ocpp/zpr-test-001", { headers: { upgrade: "websocket" } }), env);
      expect(res.status).toBe(404);
    }
  });
  it("/health and /version stay available", async () => {
    const { env } = makeEnv({});
    expect((await worker.fetch(new Request("https://gw.internal/health"), env)).status).toBe(200);
    expect((await worker.fetch(new Request("https://gw.internal/version"), env)).status).toBe(200);
  });
});

describe("engine route", () => {
  const KEY = "abcdefghijk1";
  const ctx = { orgId: "o", installationId: "i", installationKey: KEY, chargePointId: "CP-1", identityString: `${KEY}/CP-1`, deviceId: "dev-9", placementId: "p", credentialMode: "none", credentialEpoch: "e" };
  const engineEnv = (admit: unknown) => {
    const { env, forwarded } = makeEnv({});
    (env as unknown as { ENGINE: unknown }).ENGINE = { admit, call: async () => ({ kind: "unavailable" }) };
    return { env, forwarded };
  };
  const req = (host = "cpoa.straumvakt.org", path = `/${KEY}/CP-1`, upgrade = true) =>
    new Request(`https://${host}${path}`, { headers: upgrade ? { upgrade: "websocket", authorization: "Basic abc" } : {} });

  it("admits through the binding and forwards the resolved context to the per-DEVICE Durable Object", async () => {
    const seen: unknown[] = [];
    const { env, forwarded } = engineEnv(async (i: unknown) => { seen.push(i); return { kind: "admit", context: ctx }; });
    await worker.fetch(req(), env);
    expect(seen).toEqual([{ host: "cpoa.straumvakt.org", pathname: `/${KEY}/CP-1`, authorization: "Basic abc" }]);
    expect(forwarded).toHaveLength(1);
    expect(JSON.parse(forwarded[0]!.headers.get("x-straumvakt-engine-ctx")!)).toEqual(ctx);
  });
  it("a refusal is a plain 401 and an unavailable engine a 503; neither reaches a Durable Object", async () => {
    const deny = engineEnv(async () => ({ kind: "deny" }));
    expect((await worker.fetch(req(), deny.env)).status).toBe(401);
    const down = engineEnv(async () => ({ kind: "unavailable" }));
    expect((await worker.fetch(req(), down.env)).status).toBe(503);
    const throwing = engineEnv(async () => { throw new Error("boom"); });
    expect((await worker.fetch(req(), throwing.env)).status).toBe(503);
    expect(deny.forwarded.length + down.forwarded.length + throwing.forwarded.length).toBe(0);
  });
  it("with no ENGINE binding configured the route fails closed (503), never open", async () => {
    const { env, forwarded } = makeEnv({});
    expect((await worker.fetch(req(), env)).status).toBe(503);
    expect(forwarded).toHaveLength(0);
  });
  it("only *.straumvakt.org hosts and well-formed paths are considered; non-upgrade is 426", async () => {
    const { env } = engineEnv(async () => ({ kind: "admit", context: ctx }));
    expect((await worker.fetch(req("evil.example.com"), env)).status).toBe(404);
    expect((await worker.fetch(req("cpoa.straumvakt.org", "/short/CP-1"), env)).status).toBe(404);
    expect((await worker.fetch(req("cpoa.straumvakt.org", `/${KEY}/CP-1`, false), env)).status).toBe(426);
  });
});

describe("command entrypoint is not a route", () => {
  it("the public fetch handler gives /command/* and engine-shaped RPC paths a 404 and never reaches a Durable Object", async () => {
    const { env, forwarded } = makeEnv({});
    for (const [method, path] of [["POST", "/command/stop"], ["POST", "/requestStop"], ["GET", "/command"]] as const) {
      expect((await worker.fetch(new Request(`https://gw.internal${path}`, { method }), env)).status, path).toBe(404);
    }
    expect(forwarded).toHaveLength(0);
  });
});
