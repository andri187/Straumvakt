import { beforeEach, describe, expect, it } from "vitest";
import { StructuralStore } from "./structural-store";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

type World = { revisions: Record<string, number>; status: number; retryAfterMs: number; ageMs: number; calls: string[]; gate: Promise<void> | null };
let w: World;
let t: number;
let store: StructuralStore;

const row = (id: string, rev: number) => ({ id, key: id, displayName: `Inst ${id.slice(0, 1)}`, orgId: "o", orgName: "O", siteId: "s", siteName: "S", revision: rev, circuitCount: 1, chargerCount: 1, updatedAt: "2026-10-31T00:00:00.000Z" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const server: typeof fetch = async (input) => {
  const url = String(input);
  w.calls.push(url);
  if (w.gate) await w.gate;
  if (w.status !== 200) return json({ error: "x" }, w.status);
  if (url.startsWith("/api/cpo/sync?check=1")) return json({ schema: 1, scope: "s", revisions: w.revisions, checkedAt: t, ageMs: w.ageMs, deferred: w.ageMs > 0, retryAfterMs: w.retryAfterMs });
  if (url.includes("view=chargers")) return json({ chargers: Object.keys(w.revisions).map((id) => ({ deviceId: `d-${id}`, label: "c", chargePointId: "cp", installationId: id, installationName: "I", circuitId: null, circuitName: null, vendor: null, model: null })), revisions: w.revisions });
  if (url.includes("shape=tree")) {
    const id = new URL(url, "http://x").searchParams.get("id")!;
    return json({ installation: { id, revision: w.revisions[id], mainRatingAmps: null, mainPhaseCount: null, mainGridType: null }, circuits: [], chargers: [] });
  }
  if (url.includes("incoming=1")) return json({ incoming: [], asOf: new Date(t).toISOString(), windowMs: 1 });
  return json({ installations: Object.entries(w.revisions).map(([id, r]) => row(id, r)), revisions: w.revisions });
};

beforeEach(() => {
  w = { revisions: { [A]: 1, [B]: 1 }, status: 200, retryAfterMs: 30_000, ageMs: 0, calls: [], gate: null };
  t = 1_000_000;
  store = new StructuralStore({ fetch: server, now: () => t });
  store.bind("user-a:1");
});

describe("structural store: warm revisit and dedupe", () => {
  it("serves a held overview with no request, and shares one request between concurrent callers", async () => {
    await Promise.all([store.ensureOverview(), store.ensureOverview()]);
    expect(w.calls).toEqual(["/api/cpo/installations"]);
    await store.ensureOverview(); // a revisit
    expect(w.calls).toHaveLength(1);
    expect(store.sent.overview).toBe(1);
  });
  it("fetches detail only on first expansion, once, and keeps it across revisits", async () => {
    await store.ensureOverview();
    expect(store.sent.detail).toBe(0); // collapsed rows load nothing
    await Promise.all([store.ensureDetail(A), store.ensureDetail(A)]);
    await store.ensureDetail(A);
    expect(store.sent.detail).toBe(1);
    expect(store.detail(A).status).toBe("ready");
  });
  it("overview and chargers are separate slots in one store: loading one does not read the other", async () => {
    await store.ensureOverview();
    expect(store.sent.chargers).toBe(0);
    await store.ensureChargers();
    expect(store.sent.chargers).toBe(1);
  });
  it("keeps the expansion state a reader left behind", () => {
    store.setInstallationOpen(A, true);
    store.setSiteOpen("s", true);
    expect(store.ui.openInstallations.has(A)).toBe(true);
    expect(store.ui.openSites.has("s")).toBe(true);
  });
});

describe("structural store: checks and the cooldown", () => {
  it("sends no check right after a load, and one when the cooldown has passed", async () => {
    await store.ensureOverview();
    await store.onViewEnter();
    expect(store.sent.check).toBe(0);
    t += 29_000;
    await store.onViewEnter();
    expect(store.sent.check).toBe(0);
    t += 2_000;
    await store.onViewEnter();
    expect(store.sent.check).toBe(1);
    expect(store.updatesAvailable).toBe(false);
  });
  it("raises Updates available for a changed or added installation and leaves the view untouched until Refresh", async () => {
    await store.ensureOverview();
    t += 31_000;
    w.revisions = { [A]: 2, [B]: 1, [C]: 1 };
    await store.onViewEnter();
    expect(store.updatesAvailable).toBe(true);
    expect([...store.staleIds].sort()).toEqual([A, C]);
    expect(store.overview.status === "ready" && store.overview.data.rows).toHaveLength(2); // not rearranged under the reader
    expect(await store.refresh()).toEqual({ kind: "applied" });
    expect(store.overview.status === "ready" && store.overview.data.rows).toHaveLength(3);
    expect(store.updatesAvailable).toBe(false);
    expect(store.sent.overview).toBe(2);
  });
  it("Refresh inside the cooldown sends nothing and says when the next check is possible", async () => {
    await store.ensureOverview();
    t += 5_000;
    const r = await store.refresh();
    expect(r).toMatchObject({ kind: "cooldown", retryAfterMs: 25_000 });
    expect(w.calls).toHaveLength(1);
  });
  it("a deferred server answer still carries revisions and is compared, never taken as 'unchanged'", async () => {
    await store.ensureOverview();
    t += 31_000;
    w.revisions = { [A]: 5, [B]: 1 }; // another isolate committed; this answer is 12 s old but already knows
    w.ageMs = 12_000;
    w.retryAfterMs = 18_000;
    await store.check();
    expect(store.updatesAvailable).toBe(true);
    expect(store.nextCheckAt).toBe(t + 18_000);
    expect(store.lastCheckedAt).toBe(t - 12_000);
  });
  it("applying updates is judged against the latest check: a server that hands back older data stays flagged", async () => {
    await store.ensureOverview();
    t += 31_000;
    const behind = { ...w.revisions };
    w.revisions = { [A]: 3, [B]: 1 };
    await store.check();
    w.revisions = behind; // the list endpoint answers from before the commit
    await store.refresh();
    expect(store.updatesAvailable).toBe(true);
  });
  it("an expanded installation that changed is reloaded in place; a collapsed one is dropped and not fetched", async () => {
    await store.ensureOverview();
    store.setInstallationOpen(A, true);
    await store.ensureDetail(A);
    await store.ensureDetail(B);
    t += 31_000;
    w.revisions = { [A]: 2, [B]: 2 };
    await store.check();
    const before = store.sent.detail;
    await store.refresh();
    expect(store.sent.detail).toBe(before + 1);
    expect(store.detail(A).status).toBe("ready");
    expect(store.detail(B).status).toBe("idle");
  });
  it("a failed check is reported, not hidden, and backs off one cooldown", async () => {
    await store.ensureOverview();
    t += 31_000;
    w.status = 500;
    expect(await store.refresh()).toEqual({ kind: "failed" });
    expect(store.checkFailed).toBe(true);
    expect(store.nextCheckAt).toBe(t + 30_000);
    expect(store.overview.status).toBe("ready"); // data kept
  });
});

describe("structural store: access, sessions and local writes", () => {
  it("an installation that leaves the authorised set disappears at once, without Refresh", async () => {
    await store.ensureOverview();
    await store.ensureChargers();
    store.setInstallationOpen(B, true);
    await store.ensureDetail(B);
    t += 31_000;
    w.revisions = { [A]: 1 };
    await store.check();
    expect(store.overview.status === "ready" && store.overview.data.rows.map((r) => r.id)).toEqual([A]);
    expect(store.chargers.status === "ready" && store.chargers.data.rows.map((r) => r.installationId)).toEqual([A]);
    expect(store.detail(B).status).toBe("idle");
    expect(store.ui.openInstallations.has(B)).toBe(false);
  });
  it("401/403 clears every held value and stops further reads", async () => {
    await store.ensureOverview();
    await store.ensureDetail(A);
    t += 31_000;
    w.status = 403;
    await store.check();
    expect(store.denied).toBe(true);
    expect(store.overview.status).toBe("idle");
    expect(store.detail(A).status).toBe("idle");
    const calls = w.calls.length;
    await store.ensureOverview();
    await store.ensureChargers();
    await store.refresh();
    expect(w.calls).toHaveLength(calls);
  });
  it("another session's partition drops all data before anything is read, and a late answer for the old one is discarded", async () => {
    let release!: () => void;
    w.gate = new Promise<void>((r) => (release = r));
    const slow = store.ensureOverview(); // user A's request is in flight
    store.bind("user-b:2"); // a different session takes over the store
    w.gate = null;
    release();
    await slow;
    expect(store.overview.status).toBe("idle"); // A's answer was not painted for B
    await store.ensureOverview();
    expect(store.overview.status).toBe("ready");
  });
  it("A signs out and B signs in: nothing of A is held", async () => {
    await store.ensureOverview();
    await store.ensureChargers();
    await store.ensureDetail(A);
    store.setInstallationOpen(A, true);
    store.bind("user-b:2");
    expect([store.overview.status, store.chargers.status, store.incoming.status, store.detail(A).status]).toEqual(["idle", "idle", "idle", "idle"]);
    expect(store.ui.openInstallations.size).toBe(0);
  });
  it("a successful local write invalidates immediately and does not wait out the cooldown", async () => {
    await store.ensureOverview();
    await store.ensureDetail(A);
    t += 1_000; // well inside the cooldown
    w.revisions = { [A]: 2, [B]: 1 };
    store.localMutation(A);
    expect(store.overview.status).toBe("idle");
    expect(store.detail(A).status).toBe("idle");
    await store.ensureOverview();
    expect(store.overview.status === "ready" && store.overview.data.revisions[A]).toBe(2);
    expect(store.sent.check).toBe(0);
  });
  it("incoming is operational: reused while fresh, read again once it is not", async () => {
    await store.ensureIncoming();
    await store.ensureIncoming();
    expect(store.sent.incoming).toBe(1);
    t += 31_000;
    await store.ensureIncoming();
    expect(store.sent.incoming).toBe(2);
  });
  it("bounds the detail cache", async () => {
    const small = new StructuralStore({ fetch: server, now: () => t, maxDetails: 2 });
    small.bind("p");
    w.revisions = { [A]: 1, [B]: 1, [C]: 1 };
    await small.ensureDetail(A);
    await small.ensureDetail(B);
    await small.ensureDetail(C);
    expect([small.detail(A).status, small.detail(B).status, small.detail(C).status]).toEqual(["idle", "ready", "ready"]);
  });
});

describe("structural store: the server asked for a pause (429)", () => {
  const limited = (seconds = "7"): typeof fetch => async (input) => {
    w.calls.push(String(input));
    return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "retry-after": seconds, "content-type": "application/json" } });
  };

  it("keeps what is held, sends nothing before the retry-after, and then reads again", async () => {
    await store.ensureOverview();
    let limit = false;
    store = new StructuralStore({ fetch: (i, o) => (limit ? limited()(i, o) : server(i, o)), now: () => t });
    store.bind("user-a:1");
    await store.ensureOverview();
    expect(store.overview.status).toBe("ready");
    limit = true;
    await store.ensureDetail(A); // a 429 on a first expansion
    expect(store.detail(A)).toMatchObject({ status: "error", kind: "limited", retryAfterMs: 7000 });
    const sent = w.calls.length;
    await store.ensureDetail(A, true); // explicit retry inside the window: nothing leaves the browser
    expect(w.calls.length).toBe(sent);
    expect(store.overview.status).toBe("ready"); // the list on screen is untouched
    limit = false;
    t += 7001;
    await store.ensureDetail(A, true);
    expect(store.detail(A).status).toBe("ready");
  });

  it("a limited refresh keeps the previous list, shows it as an error with the last data, and does not loop", async () => {
    await store.ensureOverview();
    const first = store.overview.status === "ready" ? store.overview.data : null;
    const before = w.calls.length;
    w.revisions = { [A]: 2, [B]: 1 };
    store = new StructuralStore({ fetch: async (i, o) => (String(i).includes("check=1") ? server(i, o) : limited("3")(i, o)), now: () => t });
    store.bind("user-a:1");
    store.overview = { status: "ready", data: first! };
    await store.check();
    expect(store.updatesAvailable).toBe(true);
    await store.refresh(); // applies: the list read is refused
    expect(store.overview).toMatchObject({ status: "error", kind: "limited", previous: first });
    const sent = w.calls.length;
    await store.refresh();
    expect(w.calls.length).toBe(sent + (store.checkEligible() ? 1 : 0)); // no repeated list read inside the window
    expect(before).toBeGreaterThan(0);
  });

  it("a different session drops the pause along with everything else", async () => {
    store = new StructuralStore({ fetch: limited(), now: () => t });
    store.bind("user-a:1");
    await store.ensureOverview();
    expect(store.overview).toMatchObject({ status: "error", kind: "limited" });
    store.bind("user-b:2");
    expect(store.overview.status).toBe("idle");
    const calls = w.calls.length;
    await store.ensureOverview(); // a new person is not held back by the previous person's limit
    expect(w.calls.length).toBe(calls + 1);
  });
});
