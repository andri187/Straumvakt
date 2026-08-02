// Entry-Worker tests. The upgrade handler rebuilds the charger's
// request from scratch before handing it to the Durable Object, so
// P4.17's subprotocol offer would be dropped on the floor unless it is
// explicitly relayed. These tests pin that relay — the DO can echo
// only what it is told about.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

type WorkerEnv = Parameters<typeof worker.fetch>[1];

const IDENTITY_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";

function makeEnv(): { env: WorkerEnv; forwarded: Request[] } {
  const forwarded: Request[] = [];
  const env = {
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
