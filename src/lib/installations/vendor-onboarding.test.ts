import { describe, expect, it } from "vitest";
import { remainingWaitSeconds, waitCookieName } from "./vendor-connection";
import {
  enabledVendors,
  isVendorAction,
  planVendorOnboarding,
  vendorConnect,
  vendorDisconnect,
  vendorInventory,
  type VendorContext,
  type VendorReply,
} from "./vendor-onboarding";

const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";
const SHELL = "shell-payload.shell-signature";
const ENV = {
  CPO_SHELL_USERNAME: "ShellTester",
  CPO_SHELL_PASSWORD: "disposable-test-password",
  CPO_SHELL_SESSION_SECRET: "test-only-signing-secret-0123456789abcdef",
  CPO_VENDOR_CONNECT: "easee",
};
const NOW = 1_800_000_000_000;
const URL_ = "https://shell.example.test/api/cpo/installations";

const siteDetail = (id: string | number = 4821) => ({
  id, name: "Grandavegur 3", siteKey: "ELFX-YA22", siteType: 1, ratedCurrent: 63, useDynamicMaster: true,
  address: { street: "Grandavegur", buildingNumber: "3", zip: "107", city: "Reykjavik", country: "IS" },
  // None of the following may reach what is saved.
  contactInfo: { ownerName: "Jon Jonsson", ownerPhoneNumber: "+3545551234" }, costPerKWh: 18.5, installerId: 991,
  users: [{ name: "Driver One", email: "driver@example.org", rfids: ["TAG-SECRET"] }], accessToken: "tok-never", password: "pw-never",
  circuits: [
    { id: 11, panelName: "Panel A", ratedCurrent: 40, use3Phase: true, chargers: [{ id: "EH000001", name: "Bilskur 1" }, { id: "EH000002", name: "Bilskur 2" }] },
  ],
});

type Call = { url: string; method: string; authorization: string | null; body: string | null; redirect: string | undefined };
type Behaviour = {
  login?: () => Response;
  sites?: () => Response;
  detail?: (ref: string) => Response;
  fail?: boolean;
};

function fakeEasee(b: Behaviour = {}) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", authorization: headers.Authorization ?? null, body: typeof init?.body === "string" ? init.body : null, redirect: init?.redirect });
    if (b.fail) throw new Error("network down: secret-detail-never");
    if (url === "https://api.easee.com/api/accounts/login") {
      return b.login ? b.login() : Response.json({ accessToken: "easee-token-never", refreshToken: "refresh-never", expiresIn: 3600, accessClaims: ["Partner"] });
    }
    if (url === "https://api.easee.com/api/sites") {
      return b.sites ? b.sites() : Response.json([{ id: 4821, name: "Grandavegur 3", circuits: [{ chargers: [{ id: "a" }, { id: "b" }] }] }, { id: 4822, name: "Hlidarendi" }]);
    }
    const m = url.match(/^https:\/\/api\.easee\.com\/api\/sites\/([^/]+)$/);
    if (m) return b.detail ? b.detail(m[1]) : Response.json(siteDetail(m[1]));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

function context(fx: ReturnType<typeof fakeEasee>, over: Partial<VendorContext> & { cookie?: string } = {}): VendorContext {
  const { cookie, ...rest } = over;
  return {
    request: new Request(URL_, { method: "POST", headers: cookie ? { cookie } : {} }),
    env: ENV,
    orgId: ORG,
    shellSessionToken: SHELL,
    fetcher: fx.fetcher,
    now: () => NOW,
    ...rest,
  };
}

const cookieOf = (r: VendorReply) => r.cookies.map((c) => c.split(";")[0]).join("; ");
const creds = { action: "vendor-connect", vendor: "easee", username: "operator@example.org", password: "operator-secret-never" };

async function connected(over: Partial<VendorContext> = {}) {
  const fx = fakeEasee();
  const r = await vendorConnect(context(fx, over), creds);
  expect(r.status).toBe(200);
  return { cookie: cookieOf(r), reply: r, calls: fx.calls };
}

describe("which vendors are switched on", () => {
  it("is nothing by default, and only a named vendor that has a reader", () => {
    expect(enabledVendors(undefined)).toEqual([]);
    expect(enabledVendors({})).toEqual([]);
    expect(enabledVendors({ CPO_VENDOR_CONNECT: "easee" })).toEqual(["easee"]);
    expect(enabledVendors({ CPO_VENDOR_CONNECT: " Easee , easee, zaptec, constructor, __proto__, " })).toEqual(["easee", "zaptec"]);
    expect(enabledVendors({ CPO_VENDOR_CONNECT: "zaptec" })).toEqual(["zaptec"]);
    expect(enabledVendors({ CPO_VENDOR_CONNECT: "wallbox,easee" })).toEqual(["easee"]);
  });

  it("recognises exactly the four vendor actions", () => {
    for (const a of ["vendor-connect", "vendor-inventory", "vendor-disconnect", "vendor-onboard"]) expect(isVendorAction(a)).toBe(true);
    for (const a of ["import-vendor", "save-draft", "", undefined, 3]) expect(isVendorAction(a)).toBe(false);
  });

  it("refuses every action for a vendor that is not enabled, a vendor without a reader and a workspace without a CPO, with no vendor traffic", async () => {
    const fx = fakeEasee();
    const off = { env: { ...ENV, CPO_VENDOR_CONNECT: undefined } };
    expect((await vendorConnect(context(fx, off), creds)).status).toBe(404);
    expect((await vendorInventory(context(fx, off), { action: "vendor-inventory", vendor: "easee" })).status).toBe(404);
    const onboard = { action: "vendor-onboard", vendor: "easee", installationRef: "4821", siteId: SITE, idempotencyKey: crypto.randomUUID() };
    expect((await planVendorOnboarding(context(fx, off), onboard))).toMatchObject({ ok: false, reply: { status: 404 } });
    // A vendor that is not listed is refused, whatever the browser asks for: Zaptec is only on when the deployment names it.
    expect((await vendorConnect(context(fx), { ...creds, vendor: "zaptec" })).status).toBe(404);
    expect((await vendorConnect(context(fx), { ...creds, vendor: "wallbox" })).status).toBe(404);
    // No CPO for the workspace.
    expect((await vendorConnect(context(fx, { orgId: null }), creds)).body).toMatchObject({ error: "no_context" });
    expect(fx.calls).toEqual([]);
  });
});

describe("connecting", () => {
  it("signs in once, reads the site list once, keeps the connection sealed in one cookie and returns no secret", async () => {
    const { reply, calls } = await connected();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST https://api.easee.com/api/accounts/login", "GET https://api.easee.com/api/sites"]);
    expect(calls.every((c) => c.redirect === "error")).toBe(true);
    expect(JSON.parse(calls[0].body!)).toEqual({ userName: "operator@example.org", password: "operator-secret-never" });
    expect(calls[1].authorization).toBe("Bearer easee-token-never");
    expect(reply.body).toMatchObject({
      connected: true, vendor: "easee", label: "Easee", claims: ["Partner"],
      installations: [{ id: "4821", name: "Grandavegur 3", activeChargerCount: 2 }, { id: "4822", name: "Hlidarendi", activeChargerCount: null }],
    });
    const text = JSON.stringify(reply);
    expect(text).not.toMatch(/easee-token-never|refresh-never|operator-secret-never/);
    expect(reply.cookies).toHaveLength(1);
    expect(reply.cookies[0]).toMatch(/^straumvakt_vc_easee=/);
    expect(reply.cookies[0]).toMatch(/HttpOnly; SameSite=Strict/);
    expect(reply.cookies[0]).not.toContain("easee-token-never");
    const ends = Date.parse(String(reply.body.expiresAt));
    expect(ends - NOW).toBeLessThanOrEqual(15 * 60_000);
    expect(ends).toBeGreaterThan(NOW);
  });

  it("does not offer a site the vendor listed without a usable id", async () => {
    const fx = fakeEasee({ sites: () => Response.json([{ name: "No id" }, { id: 7, name: "Seven" }]) });
    const r = await vendorConnect(context(fx), creds);
    expect(r.body.installations).toEqual([{ id: "7", name: "Seven", activeChargerCount: null }]);
  });

  it("reports a refused sign-in without upstream detail or a cookie", async () => {
    const fx = fakeEasee({ login: () => new Response("sensitive upstream body operator-secret-never", { status: 401 }) });
    const r = await vendorConnect(context(fx), creds);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("vendor_sign_in_refused");
    expect(JSON.stringify(r)).not.toMatch(/sensitive|operator-secret-never/);
    expect(r.cookies).toEqual([]);
    expect(fx.calls).toHaveLength(1);
  });

  it("passes on a rate limit with its Retry-After, remembers it, and then refuses the next attempt before it leaves the Worker", async () => {
    const fx = fakeEasee({ login: () => new Response("", { status: 429, headers: { "retry-after": "120" } }) });
    const r = await vendorConnect(context(fx), creds);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: "vendor_rate_limited", retryAfter: 120 });
    expect(r.headers).toEqual({ "retry-after": "120" });
    expect(r.cookies).toHaveLength(1);
    expect(r.cookies[0]).toContain(waitCookieName("easee"));
    expect(r.cookies[0]).toContain("Max-Age=120");
    // No automatic retry: one request only.
    expect(fx.calls).toHaveLength(1);

    const again = fakeEasee();
    const blocked = await vendorConnect(context(again, { cookie: cookieOf(r) }), creds);
    expect(blocked.status).toBe(429);
    expect(blocked.body.retryAfter).toBe(120);
    expect(again.calls).toEqual([]);
    // After the wait it goes through.
    expect((await vendorConnect(context(again, { cookie: cookieOf(r), now: () => NOW + 121_000 }), creds)).status).toBe(200);
  });

  it("answers a vendor outage or a network failure without upstream detail", async () => {
    const down = await vendorConnect(context(fakeEasee({ fail: true })), creds);
    expect(down.status).toBe(502);
    expect(JSON.stringify(down)).not.toMatch(/secret-detail-never|network down/);
    const err = await vendorConnect(context(fakeEasee({ login: () => new Response("<html>boom</html>", { status: 500 }) })), creds);
    expect(err.status).toBe(502);
    expect(JSON.stringify(err)).not.toContain("boom");
  });

  it("refuses a token too large to keep, with nothing stored", async () => {
    const fx = fakeEasee({ login: () => Response.json({ accessToken: "t".repeat(5000), expiresIn: 3600 }) });
    const r = await vendorConnect(context(fx), creds);
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("connection_not_kept");
    expect(r.cookies).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("ttttt");
  });

  it("rejects empty or oversized credentials before any request", async () => {
    const fx = fakeEasee();
    expect((await vendorConnect(context(fx), { ...creds, username: "", password: "" })).status).toBe(422);
    expect((await vendorConnect(context(fx), { ...creds, password: "p".repeat(2000) })).status).toBe(422);
    expect((await vendorConnect(context(fx), { action: "vendor-connect" })).status).toBe(422);
    expect(fx.calls).toEqual([]);
  });
});

describe("listing and disconnecting", () => {
  it("lists through a live connection with one read and no sign-in", async () => {
    const { cookie } = await connected();
    const fx = fakeEasee();
    const r = await vendorInventory(context(fx, { cookie }), { action: "vendor-inventory", vendor: "easee" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connected: true, installations: [{ id: "4821" }, { id: "4822" }] });
    expect(fx.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET https://api.easee.com/api/sites"]);
    expect(fx.calls[0].authorization).toBe("Bearer easee-token-never");
    expect(JSON.stringify(r)).not.toContain("easee-token-never");
  });

  it("reads nothing and shows no installations without a connection, for an expired one, and for another shell session", async () => {
    const { cookie } = await connected();
    const ask = (over: Partial<VendorContext> & { cookie?: string }) => {
      const fx = fakeEasee();
      return vendorInventory(context(fx, over), { action: "vendor-inventory", vendor: "easee" }).then((r) => ({ r, calls: fx.calls }));
    };
    const none = await ask({});
    expect(none.r.body).toEqual({ connected: false, vendor: "easee", reason: "missing" });
    expect(none.r.cookies).toEqual([]);
    expect(none.calls).toEqual([]);

    const expired = await ask({ cookie, now: () => NOW + 16 * 60_000 });
    expect(expired.r.body).toMatchObject({ connected: false, reason: "expired" });
    expect(expired.r.cookies[0]).toContain("Max-Age=0");
    expect(expired.calls).toEqual([]);

    // Logging out and in again gives a different shell session; the earlier connection is dead.
    const other = await ask({ cookie, shellSessionToken: "another-payload.another-signature" });
    expect(other.r.body).toMatchObject({ connected: false, reason: "rejected" });
    expect(other.calls).toEqual([]);

    // Another CPO's workspace cannot use it either.
    const foreign = await ask({ cookie, orgId: "22222222-2222-4222-8222-222222222222" });
    expect(foreign.r.body).toMatchObject({ connected: false, reason: "rejected" });
    expect(foreign.calls).toEqual([]);
  });

  it("treats a token the vendor no longer accepts as 'not connected' and clears it", async () => {
    const { cookie } = await connected();
    const fx = fakeEasee({ sites: () => new Response("", { status: 401 }) });
    const r = await vendorInventory(context(fx, { cookie }), { action: "vendor-inventory", vendor: "easee" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connected: false, reason: "vendor_session_ended" });
    expect(r.cookies[0]).toContain("Max-Age=0");
  });

  it("honours a recorded wait on a listing too", async () => {
    const { cookie } = await connected();
    const limited = fakeEasee({ sites: () => new Response("", { status: 429, headers: { "retry-after": "30" } }) });
    const r = await vendorInventory(context(limited, { cookie }), { action: "vendor-inventory", vendor: "easee" });
    expect(r.status).toBe(429);
    expect(remainingWaitSeconds(cookieOf(r), "easee", NOW)).toBe(30);
    const next = fakeEasee();
    const blocked = await vendorInventory(context(next, { cookie: `${cookie}; ${cookieOf(r)}` }), { action: "vendor-inventory", vendor: "easee" });
    expect(blocked.status).toBe(429);
    expect(next.calls).toEqual([]);
  });

  it("disconnect clears the cookie and makes no vendor call", () => {
    const r = vendorDisconnect(context(fakeEasee()), { action: "vendor-disconnect", vendor: "easee" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connected: false });
    expect(r.cookies[0]).toMatch(/^straumvakt_vc_easee=; .*Max-Age=0/);
  });
});

describe("preparing one selected installation for the existing save", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    action: "vendor-onboard", vendor: "easee", installationRef: "4821", siteId: SITE, idempotencyKey: crypto.randomUUID(), ...over,
  });

  it("reads the one selected site with the connection's token and maps it; the browser supplies no vendor data", async () => {
    const { cookie } = await connected();
    const fx = fakeEasee();
    const plan = await planVendorOnboarding(context(fx, { cookie }), request({
      ocppIds: { EH000001: "CP-1" },
      // A package from the browser is not an input here; unknown fields are dropped.
      package: { kind: "straumvakt-vendor-site", site: { ref: "9999", name: "Forged" } },
    }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(fx.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET https://api.easee.com/api/sites/4821"]);
    expect(fx.calls[0].authorization).toBe("Bearer easee-token-never");
    const { input } = plan.mapped;
    expect(input.siteId).toBe(SITE);
    expect(input.vendorImport?.package.site).toMatchObject({ ref: "4821", name: "Grandavegur 3" });
    // Values (and keys that would carry them) must be absent. The NAMES of fields the read saw are kept deliberately in
    // fieldsObserved, as strings in an array, so a bare name is not a leak; a name followed by ':' would be a key with a value.
    expect(JSON.stringify(plan.mapped)).not.toMatch(/Forged|Jon Jonsson|3545551234|Driver One|TAG-SECRET|tok-never|pw-never|easee-token-never|"(costPerKWh|installerId|contactInfo|users|accessToken|password)"\s*:/);
    expect(plan.mapped.pendingEquipment).toEqual([{ ref: "EH000002", name: "Bilskur 2", circuitRef: "11", serialNumber: null, reason: "needs_ocpp_identity" }]);
    // The identity is the operator's: neither the vendor reference nor anything else was turned into one.
    expect(plan.mapped.resolved).toEqual([{ ref: "EH000001", chargePointId: "CP-1", circuitRef: "11", serialNumber: null, name: "Bilskur 1", source: "operator" }]);
    expect(input.chargers).toHaveLength(1);
    // Not accepted, so the vendor's 40 A stays unknown on the circuit while remaining in the snapshot.
    expect(input.circuits?.[0]).toMatchObject({ ratingAmps: null, phaseCount: null });
    expect(plan.acceptVendorElectrical).toBe(false);
  });

  it("applies the operator's explicit acceptance of the vendor's ratings", async () => {
    const { cookie } = await connected();
    const plan = await planVendorOnboarding(context(fakeEasee(), { cookie }), request({ acceptVendorElectrical: true }));
    expect(plan.ok && plan.mapped.input.circuits?.[0]).toMatchObject({ ratingAmps: 40, phaseCount: 3 });
  });

  it("needs a connection: none, or one for another shell session, reads nothing", async () => {
    const fx = fakeEasee();
    const none = await planVendorOnboarding(context(fx), request());
    expect(none).toMatchObject({ ok: false, reply: { status: 409, body: { error: "connection_required" } } });
    const { cookie } = await connected();
    const other = await planVendorOnboarding(context(fx, { cookie, shellSessionToken: "x.y" }), request());
    expect(other).toMatchObject({ ok: false, reply: { status: 409, body: { error: "connection_required" } } });
    expect(!other.ok && other.reply.cookies[0]).toContain("Max-Age=0");
    expect(fx.calls).toEqual([]);
  });

  it("validates before any vendor traffic", async () => {
    const { cookie } = await connected();
    const fx = fakeEasee();
    for (const bad of [{ siteId: "not-a-uuid" }, { idempotencyKey: "x" }, { installationRef: "" }, { vendor: "Easee!" }, { acceptVendorElectrical: "yes" }]) {
      expect(await planVendorOnboarding(context(fx, { cookie }), request(bad))).toMatchObject({ ok: false, reply: { status: 422 } });
    }
    // A reference that is not a vendor id never reaches the vendor either.
    expect(await planVendorOnboarding(context(fx, { cookie }), request({ installationRef: "../../accounts" }))).toMatchObject({ ok: false, reply: { status: 422, body: { error: "vendor_input" } } });
    expect(fx.calls).toEqual([]);
  });

  it("ends the connection when the vendor stops accepting the token, and passes on a rate limit with a stop", async () => {
    const { cookie } = await connected();
    const gone = await planVendorOnboarding(context(fakeEasee({ detail: () => new Response("", { status: 401 }) }), { cookie }), request());
    expect(gone).toMatchObject({ ok: false, reply: { status: 409, body: { error: "connection_required" } } });
    expect(!gone.ok && gone.reply.cookies[0]).toContain("Max-Age=0");

    const limited = await planVendorOnboarding(context(fakeEasee({ detail: () => new Response("", { status: 429, headers: { "retry-after": "45" } }) }), { cookie }), request());
    expect(limited).toMatchObject({ ok: false, reply: { status: 429, body: { retryAfter: 45 } } });
    expect(!limited.ok && limited.reply.cookies[0]).toContain(waitCookieName("easee"));

    const forbidden = await planVendorOnboarding(context(fakeEasee({ detail: () => new Response("", { status: 403 }) }), { cookie }), request());
    expect(forbidden).toMatchObject({ ok: false, reply: { status: 422, body: { error: "vendor_forbidden" } } });
  });

  it("does not accept a different site than the one asked for, or an outage's detail", async () => {
    const { cookie } = await connected();
    const different = await planVendorOnboarding(context(fakeEasee({ detail: () => Response.json(siteDetail(9999)) }), { cookie }), request());
    expect(different).toMatchObject({ ok: false, reply: { status: 502 } });
    const outage = await planVendorOnboarding(context(fakeEasee({ fail: true }), { cookie }), request());
    expect(outage).toMatchObject({ ok: false, reply: { status: 502 } });
    expect(JSON.stringify(outage)).not.toMatch(/network down|secret-detail-never/);
  });

  it("reports data that does not fit the import limits as a validation problem", async () => {
    const { cookie } = await connected();
    // Two circuits reported under one reference cannot be told apart, so the package is refused rather than guessed at.
    const duplicate = { ...siteDetail(), circuits: [{ id: 11, panelName: "A", chargers: [] }, { id: 11, panelName: "B", chargers: [] }] };
    const plan = await planVendorOnboarding(context(fakeEasee({ detail: () => Response.json(duplicate) }), { cookie }), request());
    expect(plan).toMatchObject({ ok: false, reply: { status: 422, body: { error: "validation" } } });
    expect(!plan.ok && JSON.stringify(plan.reply.body)).toContain("package.circuits");
  });
});
