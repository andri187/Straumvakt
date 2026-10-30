import { beforeEach, describe, expect, it } from "vitest";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { StructureCache } from "./cache";
import { handleSync, type SyncApiDeps } from "./api";
import { memoryAccess, memorySync } from "./__tests__/memory-repo";

const HTTPS = "https://shell.example.test";
const CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
const ENV = { CPO_SHELL_USERNAME: CONFIG.username, CPO_SHELL_PASSWORD: CONFIG.password, CPO_SHELL_SESSION_SECRET: CONFIG.secret };
const A = "aaaaaaaa-0000-4000-8000-000000000001";

let w: ReturnType<typeof memorySync>;
let deps: SyncApiDeps;
let grants: Record<string, string[] | null>;
const cookie = async () => `${SHELL_COOKIE_NAME}=${await createShellSession(CONFIG)}`;
const get = async (path: string, headers: Record<string, string> = {}, withCookie = true) =>
  handleSync(new Request(`${HTTPS}${path}`, { headers: { ...(withCookie ? { cookie: await cookie() } : {}), ...headers } }), deps);

beforeEach(() => {
  w = memorySync();
  w.addInstallation(A, "Harbour");
  grants = { "shared login \"ShellTester\"": [A] };
  const cache = new StructureCache();
  deps = {
    env: ENV,
    withSync: async (fn) => fn({ access: { visible: async (actor) => { const g = grants[actor.label]; return g ? { installationIds: g } : null; } }, repo: w.repo, cache, now: Date.now }),
  };
});

describe("sync endpoint", () => {
  it("401 without a valid signed session, before any storage is touched", async () => {
    const res = await get("/api/cpo/sync", {}, false);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(w.calls)).toEqual([]);
  });
  it("snapshot: private, must-revalidate, ETag, vary cookie; never a shared-cacheable response", async () => {
    const res = await get("/api/cpo/sync");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("vary")).toBe("cookie");
    expect(res.headers.get("etag")).toMatch(/^W\//);
    expect(JSON.stringify(await res.json())).not.toMatch(/verifier|password/i);
  });
  it("conditional request: 304 only after access resolved and the probe ran, with no tree or device read", async () => {
    const etag = (await get("/api/cpo/sync")).headers.get("etag")!;
    w.resetCalls();
    const res = await get("/api/cpo/sync", { "if-none-match": etag });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(w.calls).toEqual({ versions: 1 });
  });
  it("a revoked user gets 403, never a 304, even with a valid ETag in hand", async () => {
    const etag = (await get("/api/cpo/sync")).headers.get("etag")!;
    grants["shared login \"ShellTester\""] = null;
    expect((await get("/api/cpo/sync", { "if-none-match": etag })).status).toBe(403);
  });
  it("changes: no-store, and a stale or foreign cursor yields an explicit reset, not data", async () => {
    const snap = (await (await get("/api/cpo/sync")).json()) as { cursor: string };
    w.status(A, "dddddddd-0000-4000-8000-000000000001", "Charging");
    const res = await get(`/api/cpo/sync?since=${snap.cursor}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as { changes: unknown[] }).changes).toHaveLength(1);
    expect(await (await get("/api/cpo/sync?since=nonsense")).json()).toEqual({ schema: 1, resetRequired: "cursor_invalid" });
  });
  it("method guard, unavailable database and oversize scope", async () => {
    expect((await handleSync(new Request(`${HTTPS}/api/cpo/sync`, { method: "POST", headers: { cookie: await cookie() } }), deps)).status).toBe(405);
    const down: SyncApiDeps = { env: ENV, withSync: async () => { throw new DatabaseUnavailableError(); } };
    expect((await handleSync(new Request(`${HTTPS}/api/cpo/sync`, { headers: { cookie: await cookie() } }), down)).status).toBe(503);
    grants["shared login \"ShellTester\""] = Array.from({ length: 51 }, (_, i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await get("/api/cpo/sync")).status).toBe(413);
  });
});
void memoryAccess;
