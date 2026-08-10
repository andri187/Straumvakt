#!/usr/bin/env node
// Collect an OCPP cost profile from the repository, read-only.
//
// Collection and judgement are separate: this reads source and config and
// records what is true; check-ocpp-cost.mjs decides whether that is affordable.
// A collector that judged its own output would always approve of it.
//
// SAFETY:
//   * imports only node:fs / node:path / node:url. No network, no child_process.
//   * reads source files; writes only the profile you ask for with --out.
//   * never opens a .env or credential file, and never prints a value.
//   * it does not connect to Cloudflare, Neon, or a charger. Everything here is
//     what the CODE says. What the fleet actually does is Phase 3's job, and the
//     difference between the two is the point.
//
// Usage:
//   node collect-ocpp-cost-profile.mjs [--repo <path>] [--out profile.json]

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const REPO = resolve(val('--repo') ?? join(HERE, '..', '..', '..'));

function parseJsonc(text) {
  let out = '', inStr = false, esc = false, line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (line) { if (c === '\n') { line = false; out += c; } continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const read = (p) => { try { return readFileSync(join(REPO, p), 'utf8'); } catch { return null; } };
const cfg = (p) => { const t = read(p); if (!t) return null; try { return parseJsonc(t); } catch { return null; } };

// Find the line number of the first match, so every finding is citable.
function locate(text, re) {
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return null;
}

const DO_SRC = read('gateway/src/identity-do.ts');
const INGEST_SRC = read('gateway/src/ingest-client.ts');
const GW = cfg('gateway/wrangler.jsonc');
const API = cfg('apps/api/wrangler.jsonc');
const WEB = cfg('wrangler.jsonc');

// ── heartbeat handling ──────────────────────────────────────────────
// The question that decides most of the cost: does a normal, idle heartbeat
// cause a queue operation, or is it dropped before the send?
const enqueueLine = locate(DO_SRC, /await\s+enqueueOrPost\s*\(/);
const retentionFnLine = locate(DO_SRC, /export function retentionClassFor/);
const heartbeatRawLine = locate(DO_SRC, /action === "Heartbeat"\)\s*return "raw_protocol"/);

// Is there any guard that skips the enqueue for a heartbeat? Look for an early
// return, continue, or conditional around the ingest call that mentions Heartbeat.
// Detected structurally rather than by keyword: the guard must appear BEFORE the
// enqueue and must end in a return, and the reply must still be sent on that
// path. A guard that skipped the enqueue and also skipped the reply would pass a
// naive keyword search and break charging.
let heartbeatSkipsQueue = false;
let fastPathAt = null;
let fastPathRepliesBeforeReturn = false;
if (DO_SRC) {
  const lines = DO_SRC.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/if\s*\(\s*bypassesIngest\s*\(/.test(lines[i])) continue;
    if (enqueueLine != null && i + 1 >= enqueueLine) break;   // guard must precede the send
    const body = lines.slice(i, i + 6).join('\n');
    if (!/\breturn\b/.test(body)) break;
    fastPathAt = i + 1;
    fastPathRepliesBeforeReturn = /ws\.send\(serializeCallResult\(/.test(body);
    heartbeatSkipsQueue = fastPathRepliesBeforeReturn;
    break;
  }
}
const frameCapWired = DO_SRC ? /frameCapDecision\s*\(/.test(DO_SRC) && /cap\.shedIngest/.test(DO_SRC) : false;

const queuesOf = (c) => {
  const envs = [{ label: 'top-level', node: c ?? {} }];
  for (const [n, node] of Object.entries(c?.env ?? {})) envs.push({ label: `env.${n}`, node });
  return envs.map((e) => ({
    env: e.label,
    name: e.node.name ?? null,
    producers: (e.node.queues?.producers ?? []).map((p) => ({ binding: p.binding, queue: p.queue })),
    consumers: (e.node.queues?.consumers ?? []).map((p) => ({
      queue: p.queue, maxBatchSize: p.max_batch_size ?? null,
      maxRetries: p.max_retries ?? null, deadLetterQueue: p.dead_letter_queue ?? null,
    })),
  }));
};

const profile = {
  profileVersion: 1,
  collectedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  repo: REPO,
  note: 'Collected from source and config only. Nothing here was observed from a live charger, a live Queue, or a live database. Phase 3 exists because these two can disagree.',

  heartbeat: {
    idleIntervalSeconds: 3600,
    idleIntervalSource: 'product frame: idle heartbeat stays at 1 hour',
    activeSessionIntervalSeconds: null,
    activeSessionIntervalSource: 'TBD from real charger data — deliberately null, not guessed',
    retentionClassFunctionAt: retentionFnLine ? `gateway/src/identity-do.ts:${retentionFnLine}` : null,
    heartbeatClassifiedRawProtocolAt: heartbeatRawLine ? `gateway/src/identity-do.ts:${heartbeatRawLine}` : null,
    everyFrameEnqueuedAt: enqueueLine ? `gateway/src/identity-do.ts:${enqueueLine}` : null,
    heartbeatSkipsQueue,
    fastPathAt: fastPathAt ? `gateway/src/identity-do.ts:${fastPathAt}` : null,
    fastPathRepliesBeforeReturn,
    retentionClassCarriedOnEvent: DO_SRC ? /retentionClass:\s*retentionClassFor\(/.test(DO_SRC) : false,
  },

  durableObject: {
    usesHibernationApi: DO_SRC ? /state\.acceptWebSocket\(/.test(DO_SRC) : false,
    acceptWebSocketAt: locate(DO_SRC, /state\.acceptWebSocket\(/) ? `gateway/src/identity-do.ts:${locate(DO_SRC, /state\.acceptWebSocket\(/)}` : null,
    usesAutoResponse: DO_SRC ? /setWebSocketAutoResponse\(/.test(DO_SRC) : false,
    inMemoryStateAcrossWake: DO_SRC ? /hibernation wake-up/i.test(DO_SRC) : false,
    authorizeCacheTtlMs: (() => { const m = DO_SRC?.match(/AUTHORIZE_CACHE_TTL_MS\s*=\s*([\d_]+)/); return m ? Number(m[1].replace(/_/g, '')) : null; })(),
  },

  queues: {
    gateway: queuesOf(GW),
    api: queuesOf(API),
    fallbackPath: INGEST_SRC ? /postEvent|fetch\(/.test(INGEST_SRC) : null,
    fallbackWarnsAt: locate(DO_SRC, /ingest retriable/) ? `gateway/src/identity-do.ts:${locate(DO_SRC, /ingest retriable/)}` : null,
    rejectLogsAt: locate(DO_SRC, /ingest rejected/) ? `gateway/src/identity-do.ts:${locate(DO_SRC, /ingest rejected/)}` : null,
  },

  workersDev: ['wrangler.jsonc', 'apps/api/wrangler.jsonc', 'gateway/wrangler.jsonc'].map((p) => {
    const c = cfg(p);
    const envs = [{ label: 'top-level', node: c ?? {} }, ...Object.entries(c?.env ?? {}).map(([n, node]) => ({ label: `env.${n}`, node }))];
    return {
      file: p,
      environments: envs.map((e) => ({
        env: e.label, name: e.node.name ?? null,
        declaresWorkersDev: Object.prototype.hasOwnProperty.call(e.node, 'workers_dev'),
        workersDev: e.node.workers_dev ?? null,
        hasRoutes: Array.isArray(e.node.routes) ? e.node.routes.length > 0 : e.node.route != null,
      })),
    };
  }),

  pinnedHosts: (() => {
    const out = [];
    const dart = read('apps/mobile/lib/api/client.dart');
    if (dart) {
      const m = dart.match(/['"]https:\/\/([^'"]+)['"]/);
      if (m) out.push({ client: 'flutter-mobile', host: m[1], file: 'apps/mobile/lib/api/client.dart', line: locate(dart, /https:\/\//), overridable: /String\.fromEnvironment|remoteConfig|dotenv/.test(dart) });
    }
    return out;
  })(),

  limits: { perConnectorFramesPerHourCap: frameCapWired ? 120 : null },

  pricing: {
    perConnectorPerMonthIsk: 200,
    perActiveDriverPerMonthIsk: 50,
    capPerConnectorPerMonthIsk: 450,
    source: 'product frame, locked',
  },

  // Derived, not measured. Stated so the arithmetic is visible and arguable.
  derived: {
    idleHeartbeatsPerConnectorPerMonth: Math.round((30 * 24 * 3600) / 3600),
    note: 'One frame per hour per connector while idle. Active-session frames are unknown and deliberately excluded rather than guessed.',
  },
};

const out = val('--out');
if (!out) { console.log(JSON.stringify(profile, null, 2)); process.exit(0); }
writeFileSync(out, JSON.stringify(profile, null, 2) + '\n');
console.log(`ocpp cost profile written to ${out}`);
console.log(`  heartbeat skips queue: ${profile.heartbeat.heartbeatSkipsQueue}`);
console.log(`  DO hibernation:        ${profile.durableObject.usesHibernationApi}`);
console.log(`  gateway producers:     ${profile.queues.gateway.flatMap((e) => e.producers).length}`);
console.log(`  idle heartbeats/conn/month: ${profile.derived.idleHeartbeatsPerConnectorPerMonth}`);
