import { describe, expect, it } from "vitest";
import { commissionChargers, configurableVendors, effectiveAddress, type CommissionTarget } from "./vendor-commissioning";
import { buildEaseeSitePackage, buildZaptecSitePackage } from "./vendor-read.mjs";
import { parseVendorPackage } from "./vendor-import";

const ROUTING = "nordic-charge";
const ADDR = `wss://${ROUTING}.straumvakt.org`;
const LOCAL = "https://api.easee.com/local-ocpp/v1";
const target = (over: Partial<CommissionTarget> = {}): CommissionTarget => ({ ref: "EH000001", name: "Bilskur 1", serialNumber: "EH000001", chargePointId: "CP-1", ...over });

type Call = { method: string; url: string; authorization: string | null; body: unknown };
function fake(handler: (url: string, method: string, body: Record<string, unknown> | null) => Response | null) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, url, authorization: headers.Authorization ?? null, body });
    expect(init?.redirect).toBe("error");
    return handler(url, method, body) ?? new Response("", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}
const run = (fx: ReturnType<typeof fake>, over: Partial<Parameters<typeof commissionChargers>[0]> = {}) =>
  commissionChargers({ vendor: "easee", accessToken: "tok-never", installationRef: "4821", routingId: ROUTING, enabled: true, targets: [target()], fetcher: fx.fetcher, ...over });

describe("which vendors may be configured", () => {
  it("is nothing by default and only the named, known vendors", () => {
    expect(configurableVendors(undefined)).toEqual([]);
    expect(configurableVendors({})).toEqual([]);
    expect(configurableVendors({ CPO_VENDOR_CONFIGURE: " Easee, zaptec, wallbox, __proto__, easee" })).toEqual(["easee", "zaptec"]);
  });
});

describe("the address a stored configuration makes a charger use", () => {
  it("appends the identity exactly once, tolerating a trailing slash and a URL that already ends in the identity", () => {
    expect(effectiveAddress(ADDR, "CP-1")).toBe(`${ADDR}/CP-1`);
    expect(effectiveAddress(`${ADDR}/`, "CP-1")).toBe(`${ADDR}/CP-1`);
    expect(effectiveAddress(`${ADDR}/CP-1`, "CP-1")).toBe(`${ADDR}/CP-1`);
    expect(effectiveAddress(`${ADDR}/CP-1/`, "CP-1")).toBe(`${ADDR}/CP-1`);
    expect(effectiveAddress(`${ADDR}/CP-1`, null)).toBe(`${ADDR}/CP-1`);
  });
  it("refuses what is not a ws/wss URL, or carries a query or fragment", () => {
    for (const bad of ["https://x.example/a", "nonsense", "", `${ADDR}/CP-1?token=x`, `${ADDR}#frag`]) expect(effectiveAddress(bad, "CP-1")).toBeNull();
  });
});

describe("commissioning guards", () => {
  it("does nothing, and makes no vendor call, when configuration is not enabled or the CPO has no address", async () => {
    const fx = fake(() => null);
    const off = await run(fx, { enabled: false });
    expect(off.results[0]).toMatchObject({ state: "blocked", code: "not_enabled", address: `${ADDR}/CP-1` });
    const noRoute = await run(fx, { routingId: null });
    expect(noRoute.results[0]).toMatchObject({ state: "blocked", code: "no_routing", address: null });
    expect((await run(fx, { vendor: "wallbox" })).results[0]).toMatchObject({ state: "blocked" });
    expect(fx.calls).toEqual([]);
  });

  it("uses the vendor's fixed host with the connection's token, and only the two documented write calls for Easee", async () => {
    let applied = false;
    const fx = fake((url, method) => {
      if (url === `${LOCAL}/connection-details/EH000001`) {
        if (method === "GET") return applied ? Response.json({ connectivityMode: "DualProtocol", websocketConnectionArgs: { url: ADDR }, chargePointId: "CP-1" }) : new Response("", { status: 404 });
        return Response.json({ version: 12 });
      }
      if (url === `${LOCAL}/connections/chargers/EH000001` && method === "POST") { applied = true; return new Response("{}", { status: 200 }); }
      return null;
    });
    const out = await run(fx);
    expect(out.results[0]).toMatchObject({ state: "configured", code: "ok" });
    expect(fx.calls.every((c) => c.url.startsWith(`${LOCAL}/`) && c.authorization === "Bearer tok-never")).toBe(true);
    expect(fx.calls.filter((c) => c.method !== "GET").map((c) => c.body)).toEqual([
      { connectivityMode: "DualProtocol", websocketConnectionArgs: { url: ADDR }, chargePointId: "CP-1" },
      { version: "12" },
    ]);
    // No password, certificate, current limit or command is ever part of a write.
    expect(JSON.stringify(fx.calls)).not.toMatch(/basicAuthPassword|current|reboot|start|stop|reset|profile/i);
  });

  it("fails visibly when the vendor does not say which version it stored, or the read-back differs", async () => {
    const noVersion = fake((url, method) => (url.includes("/connection-details/") ? (method === "GET" ? new Response("", { status: 404 }) : Response.json({})) : null));
    expect((await run(noVersion)).results[0]).toMatchObject({ state: "failed", code: "store_unconfirmed" });
    expect(noVersion.calls.some((c) => c.url.includes("/connections/chargers/"))).toBe(false);

    let applied = false;
    const mismatch = fake((url, method) => {
      if (url.includes("/connections/chargers/")) { applied = true; return Response.json({}); }
      if (method === "POST") return Response.json({ version: 1 });
      return applied ? Response.json({ websocketConnectionArgs: { url: `${ADDR}/WRONG` }, chargePointId: "CP-1" }) : new Response("", { status: 404 });
    });
    expect((await run(mismatch)).results[0]).toMatchObject({ state: "failed", code: "readback_mismatch" });
  });

  it("ends the run on a refused token and stops on a rate limit, marking the rest as not attempted", async () => {
    const two = [target(), target({ ref: "EH000002", serialNumber: "EH000002", chargePointId: "CP-2" })];
    const ended = await run(fake(() => new Response("", { status: 401 })), { targets: two });
    expect(ended).toMatchObject({ ended: true, retryAfter: null });
    expect(ended.results.map((r) => [r.state, r.code])).toEqual([["not_attempted", "connection_ended"], ["not_attempted", "connection_ended"]]);

    const fx = fake(() => new Response("", { status: 429, headers: { "retry-after": "30" } }));
    const limited = await run(fx, { targets: two });
    expect(limited).toMatchObject({ ended: false, retryAfter: 30 });
    expect(limited.results.map((r) => r.code)).toEqual(["rate_limited", "rate_limited"]);
    expect(fx.calls).toHaveLength(1);
  });

  it("reports a network failure as an unfinished result without leaking detail", async () => {
    const fetcher = (async () => { throw new Error("socket detail tok-never"); }) as typeof fetch;
    const out = await run({ calls: [], fetcher });
    expect(out.results[0]).toMatchObject({ state: "failed", code: "unreachable" });
    expect(JSON.stringify(out)).not.toContain("tok-never");
  });

  it("has no Zaptec write at all: it reads, classifies and names the address to set", async () => {
    const fx = fake((url, method) => {
      if (url.endsWith("/api/installation/7d722149-3c5f-4488-8bf2-e660503e11e9")) return Response.json({ AuthenticationType: 2 });
      if (url.includes("/api/chargers/") && method === "GET") return Response.json({ DeviceId: "ZCS032822" });
      return null;
    });
    const out = await commissionChargers({
      vendor: "zaptec", accessToken: "tok-never", installationRef: "7d722149-3c5f-4488-8bf2-e660503e11e9", routingId: ROUTING, enabled: true,
      targets: [{ ref: "03278fc6-ab76-47af-9ccc-b84e90e07284", name: "Festi 5", serialNumber: "ZCS032822", chargePointId: "ZAP1" }], fetcher: fx.fetcher,
    });
    expect(out.results[0]).toMatchObject({ state: "blocked", code: "write_contract_unconfirmed", address: `${ADDR}/ZAP1` });
    expect(fx.calls.every((c) => c.method === "GET" && c.url.startsWith("https://api.zaptec.com/api/"))).toBe(true);
  });
});

describe("what the shared readers carry", () => {
  it("keeps an explicit Easee serial apart from the vendor reference, and gives none where the vendor reported none", () => {
    const pkg = buildEaseeSitePackage({ id: 4821, circuits: [{ id: 11, chargers: [{ id: "EH000001", serialNumber: "EH-SER-1" }, { id: "EH000002" }] }] }) as { equipment: { ref: string; serialNumber: string | null }[] };
    expect(pkg.equipment.map((e) => [e.ref, e.serialNumber])).toEqual([["EH000001", "EH-SER-1"], ["EH000002", null]]);
  });

  it("builds a Zaptec package whose chargers carry the physical DeviceId as serial (not the deprecated SerialNo), validates, and has no OCPP identity", () => {
    const pkg = buildZaptecSitePackage(
      { Id: "7d722149-3c5f-4488-8bf2-e660503e11e9", Name: "Dalvegur", NetworkType: 4, MaxCurrent: 100, OcppCloudUrl: "wss://secret-backend.example/tenant-never", OcppInitialChargePointPassword: "pw-never" },
      { Circuits: [{ Id: "aaaaaaaa-0000-4000-8000-000000000001", Name: "A", MaxCurrent: 32, Chargers: [{ Id: "03278fc6-ab76-47af-9ccc-b84e90e07284", Name: "Festi 5", DeviceId: "ZCS032822", SerialNo: "OLD-never" }] }] },
    );
    const parsed = parseVendorPackage(pkg);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.package.vendor).toBe("zaptec");
    expect(parsed.package.site.networkType).toBe("TN_3_Phase");
    expect(parsed.package.equipment[0]).toMatchObject({ ref: "03278fc6-ab76-47af-9ccc-b84e90e07284", serialNumber: "ZCS032822", circuitRef: "aaaaaaaa-0000-4000-8000-000000000001" });
    expect(JSON.stringify(parsed.package)).not.toMatch(/secret-backend|tenant-never|pw-never|OLD-never/);
    expect(JSON.stringify(parsed.package)).not.toMatch(/"chargePointId"|"ocppId"/);
  });
});
