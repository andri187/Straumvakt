#!/usr/bin/env node
// Fixture generator for the OCPP cost gates.
//
// The "clean" profile is the estate as it SHOULD be once the heartbeat path is
// fixed — not as it is. The estate as it is fails, and that is captured
// separately in current-estate.error.json. An honest baseline is more useful
// than a flattering one.
//
// Every negative fixture differs from clean in exactly one way. A negative
// fixture that fails for two reasons proves nothing about either.
//
//   node build-ocpp-fixtures.mjs

import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'ocpp-fixtures');
mkdirSync(DIR, { recursive: true });
const clone = (o) => JSON.parse(JSON.stringify(o));
const write = (n, o) => writeFileSync(join(DIR, `${n}.json`), JSON.stringify(o, null, 2) + '\n');

const clean = {
  profileVersion: 1,
  collectedAt: '2026-08-10T02:30:00Z',
  repo: 'E:/Claude/Straumvakt-beta-production',
  heartbeat: {
    idleIntervalSeconds: 3600,
    idleIntervalSource: 'product frame: idle heartbeat stays at 1 hour',
    activeSessionIntervalSeconds: null,
    activeSessionIntervalSource: 'TBD from real charger data',
    retentionClassFunctionAt: 'gateway/src/identity-do.ts:232',
    heartbeatClassifiedRawProtocolAt: 'gateway/src/identity-do.ts:238',
    everyFrameEnqueuedAt: 'gateway/src/identity-do.ts:615',
    heartbeatSkipsQueue: true,
    retentionClassCarriedOnEvent: true,
  },
  retentionDefault: 'operational',
  storage: { rawFramesPersistedPermanently: false, rawFrameTtlDays: 7 },
  liveness: { lastSeenAt: true, onlineOfflineTransitions: true, hourlyRollup: true },
  limits: { perConnectorFramesPerHourCap: 120 },
  durableObject: {
    usesHibernationApi: true,
    acceptWebSocketAt: 'gateway/src/identity-do.ts:404',
    usesAutoResponse: true,
    inMemoryStateAcrossWake: true,
    authorizeCacheTtlMs: 60000,
  },
  queues: {
    gateway: [{ env: 'env.staging', name: 'straumvakt-ocpp-staging',
      producers: [{ binding: 'OCPP_EVENTS_QUEUE', queue: 'straumvakt-ocpp-events-staging' }], consumers: [] }],
    api: [{ env: 'env.staging', name: 'hlada-api-staging', producers: [],
      consumers: [{ queue: 'straumvakt-ocpp-events-staging', maxBatchSize: 25, maxRetries: 3, deadLetterQueue: 'straumvakt-ocpp-events-dlq-staging' }] }],
    fallbackPath: true,
    fallbackWarnsAt: 'gateway/src/identity-do.ts:617',
    rejectLogsAt: 'gateway/src/identity-do.ts:623',
  },
  workersDev: [
    { file: 'apps/api/wrangler.jsonc', environments: [
      { env: 'env.staging', name: 'hlada-api-staging', declaresWorkersDev: true, workersDev: true, hasRoutes: false }] },
  ],
  pinnedHosts: [{ client: 'flutter-mobile', host: 'hlada-api-staging.straumvakt.workers.dev', file: 'apps/mobile/lib/api/client.dart', line: 25, overridable: true }],
  neon: { branchPerOrg: false },
  pricing: { perConnectorPerMonthIsk: 200, perActiveDriverPerMonthIsk: 50, capPerConnectorPerMonthIsk: 450 },
  derived: { idleHeartbeatsPerConnectorPerMonth: 720 },
};

const F = {};
F['remediated.clean'] = clean;

// ── the estate as it actually is ──
{
  const m = clone(clean);
  m.heartbeat.heartbeatSkipsQueue = false;
  m.durableObject.usesAutoResponse = false;
  m.pinnedHosts[0].overridable = false;
  m.workersDev[0].environments[0].declaresWorkersDev = false;
  m.workersDev[0].environments[0].workersDev = null;
  m.limits.perConnectorFramesPerHourCap = null;
  m.storage.rawFrameTtlDays = null;
  m.notes = 'The estate as collected on 2026-08-10. Every Call frame including Heartbeat reaches the queue; the mobile pin has no runtime override; the API config declares neither routes nor workers_dev.';
  F['current-estate.error'] = m;
}

// ── one rule per fixture ──
const bad = (name, mutate, note) => { const m = clone(clean); mutate(m); m.notes = note; F[name] = m; };

bad('heartbeat-enqueued.error', (m) => { m.heartbeat.heartbeatSkipsQueue = false; },
  'OC1. 720 queue operations per idle connector per month, for frames carrying only liveness and a clock.');
// OC14 is INFO, never a failure. This fixture exists to prove that: everything
// else is clean, auto-response is off, and the run must still count as clean.
// (OC2 cannot have a fixture of its own — it only fires alongside OC1, because
// labelling a frame disposable while still sending it is precisely the pairing
// it describes.)
bad('info-only-does-not-fail.clean', (m) => { m.durableObject.usesAutoResponse = false; },
  'OC14 info only. An informational finding must not fail a build, or it will be deleted rather than read.');
bad('heartbeat-not-classified.error', (m) => { m.heartbeat.heartbeatClassifiedRawProtocolAt = null; },
  'OC3. Nothing marks Heartbeat disposable, so a consumer has no basis to discard it.');
bad('retention-default-raw.error', (m) => { m.retentionDefault = 'raw_protocol'; },
  'OC4. An unrecognised frame type would be silently discarded — the wrong failure direction.');
bad('idle-interval-too-short.error', (m) => { m.heartbeat.idleIntervalSeconds = 300; },
  'OC5. Twelve times the frames, for the same information.');
bad('idle-interval-missing.error', (m) => { m.heartbeat.idleIntervalSeconds = null; },
  'OC5. No interval recorded at all.');
bad('active-interval-guessed.error', (m) => { m.heartbeat.activeSessionIntervalSeconds = 30; m.heartbeat.activeSessionIntervalSource = 'assumed reasonable'; },
  'OC6. A guessed active-session interval sizes the entire ingest path.');
bad('raw-frames-permanent.error', (m) => { m.storage.rawFramesPersistedPermanently = true; },
  'OC7. Heartbeats become a growing table nothing reads.');
bad('raw-ttl-too-long.error', (m) => { m.storage.rawFrameTtlDays = 365; },
  'OC8. Diagnostics that outlive the incident they diagnose are just storage.');
bad('raw-ttl-missing.warns', (m) => { m.storage.rawFrameTtlDays = null; },
  'OC8 warning. No TTL recorded for raw protocol frames.');
bad('no-lastseenat.error', (m) => { m.liveness.lastSeenAt = false; },
  'OC9. The heartbeat is paid for and produces nothing durable.');
bad('no-transitions.error', (m) => { m.liveness.onlineOfflineTransitions = false; },
  'OC9. No online/offline transition event, so downtime cannot be derived.');
bad('no-rollup.error', (m) => { m.liveness.hourlyRollup = false; },
  'OC9. No rollup, so every question about liveness has to hit raw frames.');
bad('no-frame-cap.error', (m) => { m.limits.perConnectorFramesPerHourCap = null; },
  'OC10. One misbehaving charger can bill the estate; a 450 kr cap cannot absorb it.');
bad('frame-scale-excessive.error', (m) => { m.derived.idleHeartbeatsPerConnectorPerMonth = 43200; },
  'OC11. A one-minute heartbeat: 43,200 frames per connector per month.');
bad('no-hibernation.error', (m) => { m.durableObject.usesHibernationApi = false; },
  'OC12. An idle socket bills duration for doing nothing.');
bad('hibernation-no-wake-handling.warns', (m) => { m.durableObject.inMemoryStateAcrossWake = false; },
  'OC13 warning. Hibernation on, but no evidence the code survives losing in-memory state.');
bad('no-auto-response.warns', (m) => { m.durableObject.usesAutoResponse = false; m.storage.rawFrameTtlDays = null; },
  'OC14 info plus OC8 warning — auto-response alone is info, never a failure.');
bad('authorize-cache-missing.warns', (m) => { m.durableObject.authorizeCacheTtlMs = null; },
  'OC15 warning. Every Authorize becomes an API call.');
bad('authorize-cache-too-long.error', (m) => { m.durableObject.authorizeCacheTtlMs = 900000; },
  'OC15. A fifteen-minute cache allows repeated starts on a revoked token.');
bad('no-queue-binding.error', (m) => { m.queues.gateway[0].producers = []; },
  'OC16. The ingest path silently falls back to a synchronous POST per frame.');
bad('fallback-silent.error', (m) => { m.queues.fallbackWarnsAt = null; },
  'OC17. Running permanently on the fallback is invisible until the bill arrives.');
bad('producer-without-consumer.warns', (m) => { m.queues.api[0].consumers = []; },
  'OC18 warning. Work is accepted and then goes nowhere.');
bad('consumer-no-dlq.warns', (m) => { m.queues.api[0].consumers[0].deadLetterQueue = null; },
  'OC19 warning. A poison message retries until dropped, unobserved.');
bad('consumer-retries-excessive.error', (m) => { m.queues.api[0].consumers[0].maxRetries = 20; },
  'OC19. Retries multiply the cost of exactly the messages already failing.');
bad('pinned-host-undeclared.error', (m) => { m.workersDev[0].environments[0].declaresWorkersDev = false; },
  'OC20. A shipped client pins this host and the config does not declare workers_dev.');
bad('pin-no-override.warns', (m) => { m.pinnedHosts[0].overridable = false; },
  'OC21 warning. Recovery is server-side only; a client fix costs a store release.');
bad('neon-branch-per-org.error', (m) => { m.neon.branchPerOrg = true; },
  'OC22. Storage and compute multiplied by tenant count.');

// ── scale profiles: the cap is the constraint, so model against it ──
for (const [n, conns, drivers] of [['50', 50, 120], ['100', 100, 250], ['500', 500, 1300], ['1000', 1000, 2600]]) {
  const m = clone(clean);
  m.scale = { connectors: conns, activeDrivers: drivers };
  m.derived.idleHeartbeatsPerConnectorPerMonth = 720;
  m.derived.fleetIdleHeartbeatsPerMonth = 720 * conns;
  m.derived.revenueIskPerMonth = Math.min(200 * conns + 50 * drivers, 450 * conns);
  m.notes = `Scale profile at ${conns} connectors / ${drivers} active drivers. Revenue ${m.derived.revenueIskPerMonth} kr/month against ${m.derived.fleetIdleHeartbeatsPerMonth} idle heartbeat frames. Passes because the heartbeat is dropped before the queue.`;
  F[`scale-${n}-connectors.clean`] = m;
}
// The same scale points with the CURRENT heartbeat behaviour, which fail.
for (const [n, conns, drivers] of [['50', 50, 120], ['100', 100, 250], ['500', 500, 1300], ['1000', 1000, 2600]]) {
  const m = clone(clean);
  m.heartbeat.heartbeatSkipsQueue = false;
  m.scale = { connectors: conns, activeDrivers: drivers };
  m.derived.fleetIdleHeartbeatsPerMonth = 720 * conns;
  m.derived.revenueIskPerMonth = Math.min(200 * conns + 50 * drivers, 450 * conns);
  m.notes = `Scale profile at ${conns} connectors with the CURRENT heartbeat path: ${720 * conns} queue operations a month buying nothing.`;
  F[`scale-${n}-connectors-current.error`] = m;
}

// ── schema-shape fixtures ──
bad('empty-queues-section.error', (m) => { m.queues.gateway = []; },
  'OC16. No gateway queue configuration at all.');
bad('multiple-producers-one-orphan.warns', (m) => {
  m.queues.gateway[0].producers.push({ binding: 'OCPP_METRICS_QUEUE', queue: 'straumvakt-ocpp-metrics-staging' });
}, 'OC18 warning. A second producer with no consumer anywhere in the estate.');

for (const [name, doc] of Object.entries(F)) write(name, doc);
const total = readdirSync(DIR).filter((f) => f.endsWith('.json')).length;
console.log(`wrote ${Object.keys(F).length} OCPP cost fixtures; ${total} total in ocpp-fixtures/`);
