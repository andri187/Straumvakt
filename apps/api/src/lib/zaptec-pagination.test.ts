// Pagination and vendor-config tests for the Dalvegur rehearsal.
//
// Entirely offline. No Zaptec API call, no socket — `FetchLike` is injected.

import { describe, expect, it } from "vitest";

import { ZAPTEC_MAX_PAGES, ZAPTEC_PAGE_SIZE, listChargers } from "./zaptec";
import type { FetchLike } from "./zaptec";
import {
  FixtureVendorConfigSink,
  ZAPTEC_AUTH_TYPE,
  sameConfig,
} from "@straumvakt/contracts/vendor/config-observation";

/** A fake Zaptec that serves `total` chargers across pages of `pageSize`. */
function fakeZaptec(total: number, pageSize = ZAPTEC_PAGE_SIZE, opts: { bareArray?: boolean } = {}) {
  const calls: string[] = [];
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const idx = Number(/PageIndex=(\d+)/.exec(url)?.[1] ?? 0);
    const start = idx * pageSize;
    const data = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => ({
      Id: `chg-${start + i + 1}`,
    }));
    return {
      ok: true,
      status: 200,
      json: async () => (opts.bareArray ? data : { Data: data, Pages: pages }),
    };
  };
  return { impl, calls, pages };
}

describe("listChargers honours the Pages envelope", () => {
  it("reads a single page when there is one", async () => {
    const { impl, calls } = fakeZaptec(30);
    const r = await listChargers("token", impl);
    expect(r.ok && r.value).toHaveLength(30);
    expect(calls).toHaveLength(1);
    expect(r.ok && r.reportedPages).toBe(1);
  });

  it("READS EVERY PAGE — 35 chargers across pages of 20", async () => {
    // The Dalvegur shape: more chargers than one small page holds.
    const { impl, calls } = fakeZaptec(35, 20);
    const r = await listChargers("token", impl);
    expect(r.ok && r.value).toHaveLength(35);
    expect(calls).toHaveLength(2);
  });

  it("the OLD behaviour would have returned only the first page", async () => {
    // This is the defect, expressed as a test: one request, short result.
    const { impl } = fakeZaptec(35, 20);
    const firstOnly = await impl(`x?PageIndex=0`);
    const body = (await firstOnly.json()) as { Data: unknown[] };
    expect(body.Data).toHaveLength(20);
    // ...against 35 actually present.
    const r = await listChargers("token", fakeZaptec(35, 20).impl);
    expect(r.ok && r.value.length).toBe(35);
  });

  it("stops on the ENVELOPE, not on a short page", async () => {
    // 40 across pages of 20 -> page 2 is full, page 3 does not exist.
    const { impl, calls } = fakeZaptec(40, 20);
    const r = await listChargers("token", impl);
    expect(r.ok && r.value).toHaveLength(40);
    expect(calls).toHaveLength(2);
  });

  it("sends PageSize and PageIndex", async () => {
    const { impl, calls } = fakeZaptec(5);
    await listChargers("token", impl);
    expect(calls[0]).toContain(`PageSize=${ZAPTEC_PAGE_SIZE}`);
    expect(calls[0]).toContain("PageIndex=0");
  });

  it("still accepts a bare array — an unpaged response", async () => {
    const { impl, calls } = fakeZaptec(7, 100, { bareArray: true });
    const r = await listChargers("token", impl);
    expect(r.ok && r.value).toHaveLength(7);
    expect(calls).toHaveLength(1);
  });

  it("refuses to loop forever on a nonsense page count", async () => {
    const calls: string[] = [];
    const impl: FetchLike = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ Data: [{ Id: "x" }], Pages: 9999 }) };
    };
    const r = await listChargers("token", impl);
    expect(r.ok).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(ZAPTEC_MAX_PAGES);
  });

  it("propagates an unreachable API rather than returning an empty fleet", async () => {
    const impl: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const r = await listChargers("token", impl);
    expect(r.ok).toBe(false);
    // The distinction ledger note 22 is about: unreachable is NOT zero chargers.
    expect(r.ok === false && r.error.kind).toBe("unreachable");
  });

  it("propagates a non-200 rather than returning an empty fleet", async () => {
    const impl: FetchLike = async () => ({ ok: false, status: 503, json: async () => null });
    const r = await listChargers("token", impl);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.kind).toBe("list");
  });
});

describe("vendor config observations", () => {
  const base = {
    deviceId: "dev-1",
    observedAt: new Date("2026-08-28T00:00:00Z"),
    chargerActive: true,
    authenticationType: ZAPTEC_AUTH_TYPE.Ocpp,
    isAuthorizationRequired: false,
    ocppDefaultIdTag: "TOKEN-FIXTURE",
  };

  it("records the four fields", async () => {
    const sink = new FixtureVendorConfigSink();
    expect((await sink.record(base)).status).toBe("recorded");
    const latest = await sink.latestFor("dev-1");
    expect(latest.status).toBe("available");
    expect(latest.status === "available" && latest.value.authenticationType).toBe(2);
  });

  it("an identical observation is `unchanged`, not a duplicate row", async () => {
    const sink = new FixtureVendorConfigSink();
    await sink.record(base);
    const second = await sink.record({ ...base, observedAt: new Date("2026-08-28T00:05:00Z") });
    expect(second.status).toBe("unchanged");
    expect(sink.historyFor("dev-1")).toHaveLength(1);
  });

  it("a CHANGED setting is recorded, so 'when did it change?' is answerable", async () => {
    const sink = new FixtureVendorConfigSink();
    await sink.record(base);
    await sink.record({
      ...base,
      observedAt: new Date("2026-09-01T00:00:00Z"),
      isAuthorizationRequired: true,
    });
    expect(sink.historyFor("dev-1")).toHaveLength(2);
  });

  it("a device never observed is UNAVAILABLE, not a default-shaped object", async () => {
    const sink = new FixtureVendorConfigSink();
    const r = await sink.latestFor("never-seen");
    expect(r.status).toBe("unavailable");
    // "never observed" and "reports everything off" must not look the same.
  });

  it("a null field means the vendor did not say — it does not mean off", async () => {
    const sink = new FixtureVendorConfigSink();
    await sink.record({ ...base, isAuthorizationRequired: null });
    const r = await sink.latestFor("dev-1");
    expect(r.status === "available" && r.value.isAuthorizationRequired).toBeNull();
    expect(r.status === "available" && r.value.isAuthorizationRequired).not.toBe(false);
  });

  it("sameConfig ignores the timestamp and compares the four fields", () => {
    expect(sameConfig(base, { ...base, observedAt: new Date("2030-01-01T00:00:00Z") })).toBe(true);
    expect(sameConfig(base, { ...base, chargerActive: false })).toBe(false);
  });
});

// ── fool-test ───────────────────────────────────────────────────────────

describe("FOOL H — stop paginating on a short page", () => {
  // The plausible-looking stop condition, and the one that hides the last page
  // whenever the total is an exact multiple of the page size... and, worse,
  // returns a silently truncated fleet whenever the first page is short.
  async function listFooled(impl: FetchLike): Promise<unknown[]> {
    const res = await impl("x?PageIndex=0");
    const body = (await res.json()) as { Data?: unknown[] };
    return body.Data ?? [];
  }

  it("the fooled reader returns 20 of 35 and reports no error", async () => {
    const { impl } = fakeZaptec(35, 20);
    expect(await listFooled(impl)).toHaveLength(20);
  });

  it("the real reader returns all 35", async () => {
    const { impl } = fakeZaptec(35, 20);
    const r = await listChargers("token", impl);
    expect(r.ok && r.value).toHaveLength(35);
  });
});
