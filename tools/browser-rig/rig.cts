// Local rig for a REAL-BROWSER pass over /cpo/installations and /cpo/chargers. Test tooling only; nothing here is imported by the app.
//
//   Browser  ->  this server (:RIG_PORT)  ->  /api/cpo/installations, /api/cpo/sync : the REAL handlers over the project's real
//                                              migrations on PGlite, fixture saved through the real saveInstallation path
//                                           ->  everything else : the real production Next server (`next start`) on :NEXT_PORT
//
// Same origin for the browser (cookies, fetch, Refresh and navigation behave as on the site). TWO simulated isolates share one
// in-process VersionHubCore (standing in for the Durable Object), so the cross-isolate cooldown/limits are exercised too.
// What this is NOT: Neon transport/latency, the Cloudflare edge, or a real VERSION_HUB binding. See the handoff for limits.
//
//   npx tsx tools/browser-rig/rig.cts            (after `next build --webpack`)
//   GET /__rig/stats        counters since the last reset (JSON)         POST /__rig/reset
//   POST /__rig/external-edit?n=0&name=...       a commit made by "someone else" (another isolate), announced through the hub
//   POST /__rig/external-status?n=0              a changed device status committed by the engine path, announced through the hub
//   POST /__rig/revoke                           the operator login stops working (APP signs out on the next call)

import http from "node:http";
import { spawn } from "node:child_process";
import { drizzle } from "drizzle-orm/pglite";
import { handleInstallations, type ApiDeps } from "@/lib/installations/api";
import { mayAdminister, sharedLoginActor, type Actor } from "@/lib/installations/actor";
import { repoFor } from "@/lib/installations/repo";
import { handleSync, type SyncApiDeps } from "@/lib/sync/api";
import { StructureCache } from "@/lib/sync/cache";
import { ScopeChecker } from "@/lib/sync/check";
import { LocalGate, hubBackedGate } from "@/lib/sync/gate";
import { drizzleSharedLoginAccess, drizzleSyncRepo } from "@/lib/sync/drizzle-sync-store";
import { VersionHubCore, hubBackedAccess, hubBackedRepo, type HubClient, type HubStorage } from "@/lib/sync/hub";
import { SingleFlight } from "@/lib/sync/single-flight";
import { saveInstallation } from "@/lib/installations/service";
import { drizzleStore } from "@/lib/installations/drizzle-store";
import { SHELL_CONFIG, SHELL_ENV, changeStatus, makeFixture } from "@/lib/perf/harness";

async function main() {
const RIG_PORT = Number(process.env.RIG_PORT ?? 3300);
const NEXT_PORT = Number(process.env.NEXT_PORT ?? 3301);

class MemStorage implements HubStorage {
  private m = new Map<string, unknown>();
  async get<T>(k: string) { return structuredClone(this.m.get(k)) as T | undefined; }
  async put<T>(k: string, v: T) { this.m.set(k, structuredClone(v)); }
  async delete(k: string) { return this.m.delete(k); }
}

const fx = await makeFixture();
const hubCore = new VersionHubCore(new MemStorage());
const hub: HubClient = hubCore;
{
  const versions = Object.fromEntries([...(await drizzleSyncRepo(fx.db).versions(fx.installationIds))].map(([id, v]) => [id, { rev: v.revision, sv: v.statusVersion }]));
  await hubCore.prime(fx.installationIds, versions);
}

// ── counters ────────────────────────────────────────────────────────────────
const stats = { requests: {} as Record<string, number>, connections: 0, sqlByClass: {} as Record<string, number>, status: {} as Record<string, number> };
const reset = () => { stats.requests = {}; stats.connections = 0; stats.sqlByClass = {}; stats.status = {}; fx.counter.reset(); fx.counter.enabled = true; };
fx.counter.enabled = true;

// ── two isolates sharing the hub ────────────────────────────────────────────
function isolate() {
  const checker = new ScopeChecker();
  const flight = new SingleFlight();
  const cache = new StructureCache();
  const gate = hubBackedGate(hub, new LocalGate());
  const api: ApiDeps = {
    env: SHELL_ENV, contextOrgId: fx.orgId, flight, gate,
    async withRepo(fn) { stats.connections += 1; return fn(repoFor(fx.db, hub)); },
  };
  const sync: SyncApiDeps = {
    env: SHELL_ENV, checker, gate,
    async withSync(fn) {
      stats.connections += 1;
      const access = drizzleSharedLoginAccess<Actor>(fx.db, (a) => mayAdminister(a, ""));
      const repo = drizzleSyncRepo(fx.db);
      return fn({ access: hubBackedAccess(access, hub, (a) => mayAdminister(a, "")), repo: hubBackedRepo(repo, hub), cache, now: Date.now, flight });
    },
  };
  return { api, sync };
}
const isolates = [isolate(), isolate()];
let rr = 0;
let revoked = false;

const route = (url: URL): string => {
  const p = url.pathname;
  if (p === "/api/cpo/sync") return url.searchParams.has("check") ? "sync:check" : url.searchParams.get("view") === "status" ? "sync:status" : url.searchParams.has("since") ? "sync:changes" : "sync:snapshot";
  if (url.searchParams.has("incoming")) return "installations:incoming";
  if (url.searchParams.get("shape") === "tree") return "installations:tree";
  if (url.searchParams.get("view") === "chargers") return "installations:chargers-list";
  if (url.searchParams.has("id")) return "installations:detail";
  return "installations:list";
};

async function toRequest(req: http.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body });
}

async function send(res: http.ServerResponse, r: Response) {
  const headers: Record<string, string | string[]> = {};
  r.headers.forEach((v, k) => { if (k !== "set-cookie" && k !== "content-encoding" && k !== "transfer-encoding" && k !== "content-length") headers[k] = v; });
  const cookies = r.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (url.pathname === "/__rig/stats") { return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...stats, sql: fx.counter.snapshot(), hubGateKeys: undefined })); }
    if (url.pathname === "/__rig/reset") { reset(); return void res.writeHead(200).end("ok"); }
    if (url.pathname === "/__rig/revoke") { revoked = true; return void res.writeHead(200).end("ok"); }
    if (url.pathname === "/__rig/unrevoke") { revoked = false; return void res.writeHead(200).end("ok"); }
    if (url.pathname === "/__rig/external-edit") {
      const n = Number(url.searchParams.get("n") ?? 0);
      const id = fx.installationIds[n]!;
      const cur = await repoFor(fx.db, hub).getTree(id);
      const result = await repoFor(fx.db, hub).save(
        {
          orgId: cur!.installation.orgId, siteId: cur!.installation.siteId, idempotencyKey: crypto.randomUUID(), installationId: id, expectedRevision: cur!.installation.revision,
          installation: { displayName: url.searchParams.get("name") ?? `Renamed ${Date.now()}`, mainDeviceType: null, mainRatingAmps: 63, mainPhaseCount: 3, mainGridType: "TN" },
          electrician: { name: null, email: null, phone: null }, password: { action: "keep" },
          circuits: cur!.circuits.map((c) => ({ id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: c.ratingAmps, phaseCount: c.phaseCount })),
          chargers: cur!.chargers.map((c) => ({ id: c.id, circuitId: c.circuitId, label: c.label, chargePointId: c.chargePointId, vendor: c.vendor, model: c.model, serialNumber: c.serialNumber })),
        } as never,
        sharedLoginActor(SHELL_CONFIG.username),
      );
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ revision: result.snapshot.installation.revision }));
    }
    if (url.pathname === "/__rig/external-status") {
      const n = Number(url.searchParams.get("n") ?? 0);
      const id = fx.installationIds[n]!;
      await changeStatus(fx, id, url.searchParams.get("status") ?? "Charging");
      const v = (await drizzleSyncRepo(fx.db).versions([id])).get(id)!;
      await hub.bump(id, { sv: v.statusVersion });
      return void res.writeHead(200).end("ok");
    }
    if (url.pathname === "/__rig/fixture") {
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ installations: fx.installationIds.length, circuits: fx.size.installations * fx.size.circuitsPer, chargers: fx.size.installations * fx.size.chargersPer, size: fx.size }));
    }

    if (url.pathname === "/api/cpo/installations" || url.pathname === "/api/cpo/sync") {
      const kind = route(url);
      stats.requests[kind] = (stats.requests[kind] ?? 0) + 1;
      const before = fx.counter.snapshot().dataQueries;
      const request = await toRequest(req);
      if (revoked) {
        // The login stops working: the handlers' own guard answers 401 for a session that no longer verifies.
        const dead = new Request(request.url, { method: request.method, headers: { ...Object.fromEntries(request.headers), cookie: "straumvakt_cpo_shell=revoked" } });
        const r = url.pathname === "/api/cpo/sync" ? await handleSync(dead, isolates[rr++ % 2]!.sync) : await handleInstallations(dead, isolates[rr++ % 2]!.api);
        stats.status[String(r.status)] = (stats.status[String(r.status)] ?? 0) + 1;
        return void (await send(res, r));
      }
      const iso = isolates[rr++ % 2]!;
      const r = url.pathname === "/api/cpo/sync" ? await handleSync(request, iso.sync) : await handleInstallations(request, iso.api);
      stats.sqlByClass[kind] = (stats.sqlByClass[kind] ?? 0) + (fx.counter.snapshot().dataQueries - before);
      stats.status[String(r.status)] = (stats.status[String(r.status)] ?? 0) + 1;
      return void (await send(res, r));
    }

    // Everything else is the real Next server.
    const request = await toRequest(req);
    // Next sees its own port as its origin, so present the browser's same-origin request as same-origin to it (the page's own
    // same-origin guard is unchanged and still runs; only the port differs between the rig and the app behind it).
    const upstreamHeaders = new Headers(request.headers);
    for (const h of ["host", "connection", "content-length"]) upstreamHeaders.delete(h);
    const origin = upstreamHeaders.get("origin");
    if (origin === `http://127.0.0.1:${RIG_PORT}`) upstreamHeaders.set("origin", `http://localhost:${NEXT_PORT}`);
    const referer = upstreamHeaders.get("referer");
    if (referer) upstreamHeaders.set("referer", referer.replace(`http://127.0.0.1:${RIG_PORT}`, `http://localhost:${NEXT_PORT}`));
    const upstream = await fetch(`http://127.0.0.1:${NEXT_PORT}${url.pathname}${url.search}`, { method: request.method, headers: upstreamHeaders, body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(), redirect: "manual" });
    const rewritten = new Headers(upstream.headers);
    const location = rewritten.get("location");
    if (location) rewritten.set("location", location.replace(`http://127.0.0.1:${NEXT_PORT}`, `http://127.0.0.1:${RIG_PORT}`).replace(`http://localhost:${NEXT_PORT}`, `http://127.0.0.1:${RIG_PORT}`));
    await send(res, new Response(upstream.body, { status: upstream.status, headers: rewritten }));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String((e as Error).stack ?? e));
  }
});

// NOTE: the Next server gets NO database. Server components that read the database directly (for example the installation EDITOR page)
// therefore render their "database not connected" state in this rig; only the API handlers above are database-backed.
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(NEXT_PORT), "-H", "127.0.0.1"], {
  env: { ...process.env, ...SHELL_ENV, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: "", CPO_SHELL_ORG_ID: fx.orgId },
  stdio: ["ignore", "pipe", "pipe"],
});
next.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
next.stderr.on("data", (d) => process.stderr.write(`[next!] ${d}`));
const shutdown = async () => { next.kill(); server.close(); await fx.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Wait for Next, then listen.
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`http://127.0.0.1:${NEXT_PORT}/signin`); if (r.status < 500) break; } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
server.listen(RIG_PORT, "127.0.0.1", () => console.log(`RIG READY http://127.0.0.1:${RIG_PORT}  fixture ${fx.size.installations} installations / ${fx.size.installations * fx.size.circuitsPer} circuits / ${fx.size.installations * fx.size.chargersPer} chargers`));
void drizzle; void saveInstallation; void drizzleStore;

}
main().catch((e) => { console.error(e); process.exit(1); });
