import { beforeEach, describe, expect, it } from "vitest";
import { ScopeChecker, readCheck } from "./check";
import { SingleFlight } from "./single-flight";
import { memorySync } from "./__tests__/memory-repo";
import { StructureCache } from "./cache";
import { handleSync, type SyncApiDeps } from "./api";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
let t: number;
beforeEach(() => { t = 5_000_000; });

describe("ScopeChecker", () => {
  it("probes once per cooldown per actor and visible set, then answers from what it knows, with the age", async () => {
    const c = new ScopeChecker(() => t, 30_000);
    let probes = 0;
    const probe = async () => { probes += 1; return { [A]: 1 }; };
    const first = await c.check("po|alice", "s1", probe);
    expect([first.deferred, first.ageMs, first.retryAfterMs]).toEqual([false, 0, 30_000]);
    t += 10_000;
    const second = await c.check("po|alice", "s1", probe);
    expect([second.deferred, second.ageMs, second.retryAfterMs, probes]).toEqual([true, 10_000, 20_000, 1]);
    t += 20_001;
    expect((await c.check("po|alice", "s1", probe)).deferred).toBe(false);
    expect(probes).toBe(2);
  });
  it("a change in the visible set (a permission change) defeats the cooldown at once", async () => {
    const c = new ScopeChecker(() => t);
    let probes = 0;
    await c.check("po|alice", "visible-{A,B}", async () => { probes += 1; return { [A]: 1, [B]: 1 }; });
    const narrowed = await c.check("po|alice", "visible-{A}", async () => { probes += 1; return { [A]: 1 }; });
    expect(narrowed.deferred).toBe(false);
    expect(narrowed.revisions).toEqual({ [A]: 1 });
    expect(probes).toBe(2);
  });
  it("noteCommit folds a local write into every remembered answer, never lowering a revision", async () => {
    const c = new ScopeChecker(() => t);
    await c.check("po|alice", "s1", async () => ({ [A]: 4 }));
    c.noteCommit(A, 5);
    c.noteCommit(A, 2);
    t += 1_000;
    expect((await c.check("po|alice", "s1", async () => ({}))).revisions).toEqual({ [A]: 5 });
  });
  it("is bounded", async () => {
    const c = new ScopeChecker(() => t, 30_000, 3);
    for (let i = 0; i < 10; i++) await c.check(`po|u${i}`, "s", async () => ({}));
    expect(c.size).toBe(3);
  });
  it("a failed probe is not remembered, so the next call may try again", async () => {
    const c = new ScopeChecker(() => t);
    await expect(c.check("po|alice", "s", async () => { throw new Error("db down"); })).rejects.toThrow();
    expect((await c.check("po|alice", "s", async () => ({ [A]: 1 }))).deferred).toBe(false);
  });
});

describe("SingleFlight", () => {
  it("shares a running load, drops it when it settles, and shares a failure then recovers", async () => {
    const f = new SingleFlight();
    let runs = 0;
    const slow = () => new Promise<number>((r) => setTimeout(() => r(++runs), 5));
    expect(await Promise.all([f.run("k", slow), f.run("k", slow), f.run("k", slow)])).toEqual([1, 1, 1]);
    expect(f.size).toBe(0);
    expect(await f.run("k", slow)).toBe(2); // nothing is cached after settling
    const bad = () => Promise.reject(new Error("x"));
    await expect(Promise.all([f.run("e", bad), f.run("e", bad)])).rejects.toThrow("x");
    expect(f.size).toBe(0);
    expect(await f.run("e", async () => 7)).toBe(7);
    expect(f.stats.joined).toBe(3);
  });
  it("different keys (for example different permission scopes) never share", async () => {
    const f = new SingleFlight();
    let runs = 0;
    await Promise.all([f.run("platform-operator|list", async () => ++runs), f.run("org-7|list", async () => ++runs)]);
    expect(runs).toBe(2);
  });
});

describe("GET /api/cpo/sync?check=1", () => {
  const CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
  const ENV = { CPO_SHELL_USERNAME: CONFIG.username, CPO_SHELL_PASSWORD: CONFIG.password, CPO_SHELL_SESSION_SECRET: CONFIG.secret };
  let w: ReturnType<typeof memorySync>;
  let grants: string[] | null;
  const deps = (checker?: ScopeChecker): SyncApiDeps => ({
    env: ENV,
    ...(checker ? { checker } : {}),
    withSync: async (fn) => fn({ access: { visible: async () => (grants ? { installationIds: grants } : null) }, repo: w.repo, cache: new StructureCache(), now: () => t }),
  });
  const get = async (d: SyncApiDeps, path = "/api/cpo/sync?check=1", cookie = true) =>
    handleSync(new Request(`https://shell.example.test${path}`, { headers: cookie ? { cookie: `${SHELL_COOKIE_NAME}=${await createShellSession(CONFIG)}` } : {} }), d);

  beforeEach(() => { w = memorySync(); w.addInstallation(A); w.addInstallation(B); grants = [A, B]; });

  it("401 without a session before anything is read; 501 when no checker is configured rather than running unthrottled", async () => {
    expect((await get(deps(new ScopeChecker(() => t)), undefined, false)).status).toBe(401);
    expect(w.calls).toEqual({});
    expect((await get(deps())).status).toBe(501);
  });
  it("returns revisions only (no entity data), never cached, and a second call inside the cooldown does no probe", async () => {
    const checker = new ScopeChecker(() => t);
    const first = await get(deps(checker));
    expect(first.headers.get("cache-control")).toBe("no-store");
    const body = (await first.json()) as { revisions: Record<string, number>; deferred: boolean };
    expect(body.revisions).toEqual({ [A]: 1, [B]: 1 });
    expect(Object.keys(body)).not.toContain("installations");
    expect(w.calls).toEqual({ versions: 1 });
    w.resetCalls();
    t += 5_000;
    const again = (await (await get(deps(checker))).json()) as { deferred: boolean; ageMs: number; retryAfterMs: number };
    expect([again.deferred, again.ageMs, again.retryAfterMs]).toEqual([true, 5_000, 25_000]);
    expect(w.calls).toEqual({});
  });
  it("a revoked actor gets 403 even inside a cooldown answered earlier; an oversize scope is refused", async () => {
    const checker = new ScopeChecker(() => t);
    await get(deps(checker));
    grants = null;
    expect((await get(deps(checker))).status).toBe(403);
    grants = Array.from({ length: 51 }, (_, i) => `cccccccc-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await get(deps(checker))).status).toBe(413);
  });
  it("readCheck reports only installations that exist", async () => {
    grants = [A, "dddddddd-0000-4000-8000-000000000009"];
    const r = await readCheck({ access: { visible: async () => ({ installationIds: grants! }) }, repo: w.repo, cache: new StructureCache(), now: () => t }, "x", new ScopeChecker(() => t), "p");
    expect(r.kind === "check" && r.body.revisions).toEqual({ [A]: 1 });
  });
});
