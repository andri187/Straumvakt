import { describe, it, expect, vi } from "vitest";
import { parseBasicAuth, authenticate, type GatewayEnv } from "./auth";

describe("parseBasicAuth", () => {
  it("returns null for missing header", () => {
    expect(parseBasicAuth(null)).toBeNull();
  });
  it("returns null for malformed scheme", () => {
    expect(parseBasicAuth("Bearer abc")).toBeNull();
  });
  it("returns null for invalid base64", () => {
    expect(parseBasicAuth("Basic not-base64!")).toBeNull();
  });
  it("returns null for missing colon in decoded value", () => {
    const b64 = btoa("no-colon-here");
    expect(parseBasicAuth(`Basic ${b64}`)).toBeNull();
  });
  it("returns null for empty username or password", () => {
    expect(parseBasicAuth(`Basic ${btoa(":p")}`)).toBeNull();
    expect(parseBasicAuth(`Basic ${btoa("u:")}`)).toBeNull();
  });
  it("parses a valid Basic-Auth header", () => {
    const b64 = btoa("CP001:supersecret");
    expect(parseBasicAuth(`Basic ${b64}`)).toEqual({
      username: "CP001",
      password: "supersecret",
    });
  });
});

function makeEnv(resp: Response): GatewayEnv {
  return {
    MAIN_APP: { fetch: vi.fn(async () => resp) },
    OCPP_INGEST_SECRET: "test-secret",
  };
}

describe("authenticate", () => {
  it("403 when no auth header AND API rejects (auth required)", async () => {
    // Gateway now forwards identity-only to the API even when no
    // Basic Auth is present. API decides based on stored hash. In
    // the auth-required case the API returns 403.
    const env = makeEnv(
      new Response(JSON.stringify({ ok: false, error: "auth_required" }), { status: 403 }),
    );
    const r = await authenticate(env, "CP001", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    if (!r.ok) expect(r.reason).toBe("bad_credentials");
  });

  it("200 when no auth header AND API accepts (no-auth installation)", async () => {
    // Gateway forwards identity-only; API has the row with NULL
    // hash and returns 200 with authMode='none'.
    const env = makeEnv(
      new Response(
        JSON.stringify({
          ok: true,
          identityId: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          authMode: "none",
        }),
        { status: 200 },
      ),
    );
    const r = await authenticate(env, "CP001", null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identityId).toBe("11111111-1111-1111-1111-111111111111");
      expect(r.orgId).toBe("22222222-2222-2222-2222-222222222222");
    }
  });

  it("401 when URL identity doesn't match Basic-Auth username", async () => {
    const env = makeEnv(new Response());
    const b64 = btoa("CP999:pw");
    const r = await authenticate(env, "CP001", `Basic ${b64}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("identity_mismatch");
  });

  it("200 from main app → AuthOk with identityId + orgId", async () => {
    const env = makeEnv(
      new Response(
        JSON.stringify({
          ok: true,
          identityId: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const b64 = btoa("CP001:pw");
    const r = await authenticate(env, "CP001", `Basic ${b64}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identityId).toBe("11111111-1111-1111-1111-111111111111");
      expect(r.orgId).toBe("22222222-2222-2222-2222-222222222222");
    }
  });

  it("403 from main app → AuthFail(403, bad_credentials)", async () => {
    const env = makeEnv(new Response("no", { status: 403 }));
    const b64 = btoa("CP001:wrong");
    const r = await authenticate(env, "CP001", `Basic ${b64}`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.reason).toBe("bad_credentials");
    }
  });

  it("upstream 500 → AuthFail(401, auth_upstream_failed)", async () => {
    const env = makeEnv(new Response("boom", { status: 500 }));
    const b64 = btoa("CP001:pw");
    const r = await authenticate(env, "CP001", `Basic ${b64}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("auth_upstream_failed");
  });
});
