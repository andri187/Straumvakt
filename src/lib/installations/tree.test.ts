import { describe, expect, it, vi } from "vitest";
import type { InstallationListRow } from "./drizzle-store";
import { buildCircuitTree, createDetailLoader, groupSites } from "./tree";

const row = (id: string, siteId: string, siteName = "Site", orgId = "o1"): InstallationListRow => ({
  id, key: id, displayName: `Inst ${id}`, orgId, orgName: `Org ${orgId}`, siteId, siteName, revision: 1, circuitCount: 0, chargerCount: 0, updatedAt: "2026-10-30T00:00:00.000Z",
});

describe("grouping sites", () => {
  it("groups by site id, so equal site names with different ids stay separate", () => {
    const g = groupSites([row("i1", "s1", "Harbour"), row("i2", "s2", "Harbour", "o2"), row("i3", "s1", "Harbour")]);
    expect(g.map((x) => [x.siteId, x.orgId, x.installations.map((i) => i.id)])).toEqual([["s1", "o1", ["i1", "i3"]], ["s2", "o2", ["i2"]]]);
  });
});

describe("nesting circuits", () => {
  const c = (id: string, parentId: string | null) => ({ id, parentId });
  const h = (id: string, circuitId: string) => ({ id, circuitId });
  it("keeps real parentage and places chargers on their own circuit", () => {
    const { roots, unplaced } = buildCircuitTree([c("a", null), c("b", "a"), c("c", null)], [h("1", "b"), h("2", "c"), h("3", "gone")]);
    expect(roots.map((r) => r.circuit.id)).toEqual(["a", "c"]);
    expect(roots[0].children.map((r) => [r.circuit.id, r.chargers.map((x) => x.id)])).toEqual([["b", ["1"]]]);
    expect(unplaced.map((x) => x.id)).toEqual(["3"]);
  });
  it("does not lose a circuit whose parent is missing, and terminates on a cycle", () => {
    const { roots } = buildCircuitTree([c("a", "x"), c("p", "q"), c("q", "p")], []);
    expect(roots.map((r) => r.circuit.id).sort()).toEqual(["a", "p", "q"]);
  });
});

const detail = { installation: { id: "i1", mainRatingAmps: 63, mainPhaseCount: 3, mainGridType: "TN" }, circuits: [], chargers: [] };
const ok = () => Promise.resolve(new Response(JSON.stringify(detail), { status: 200 }));
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("installation detail loader", () => {
  it("reads once on first expansion and never again for collapse/reopen", async () => {
    const f = vi.fn((..._a: unknown[]) => ok());
    const l = createDetailLoader(f as unknown as typeof fetch, () => {});
    l.load("i1");
    await settle();
    l.load("i1"); // reopen
    l.load("i1");
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe("/api/cpo/installations?id=i1");
    expect(l.get("i1")?.status).toBe("ready");
  });

  it("deduplicates rapid repeated expansion to one in-flight request", async () => {
    const f = vi.fn(ok);
    const l = createDetailLoader(f as unknown as typeof fetch, () => {});
    l.load("i1");
    l.load("i1");
    l.load("i1");
    expect(l.get("i1")?.status).toBe("loading");
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("reads each installation separately, once", async () => {
    const f = vi.fn(ok);
    const l = createDetailLoader(f as unknown as typeof fetch, () => {});
    l.load("i1");
    l.load("i2");
    await settle();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([[401, "denied"], [403, "denied"], [404, "gone"], [500, "failed"]])("maps HTTP %i to %s and does not retry on its own", async (status, kind) => {
    const f = vi.fn(() => Promise.resolve(new Response("{}", { status })));
    const l = createDetailLoader(f as unknown as typeof fetch, () => {});
    l.load("i1");
    await settle();
    l.load("i1"); // reopening a failed row is not a retry
    await settle();
    expect(l.get("i1")).toEqual({ status: "error", kind });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("treats a network error or malformed body as failed, and retries only on explicit retry", async () => {
    let calls = 0;
    const f = vi.fn(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("offline")) : calls === 2 ? Promise.resolve(new Response("{}", { status: 200 })) : ok();
    });
    const l = createDetailLoader(f as unknown as typeof fetch, () => {});
    l.load("i1");
    await settle();
    expect(l.get("i1")).toEqual({ status: "error", kind: "failed" });
    l.retry("i1");
    await settle();
    expect(l.get("i1")).toEqual({ status: "error", kind: "failed" }); // malformed body is a failure, not an empty installation
    l.retry("i1");
    await settle();
    expect(l.get("i1")?.status).toBe("ready");
    l.retry("i1"); // nothing to retry once loaded
    await settle();
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("ignores results that arrive after dispose", async () => {
    const onChange = vi.fn();
    const l = createDetailLoader(ok as unknown as typeof fetch, onChange);
    l.load("i1");
    const before = onChange.mock.calls.length;
    l.dispose();
    await settle();
    expect(onChange.mock.calls.length).toBe(before);
    expect(l.get("i1")).toBeUndefined();
  });
});
