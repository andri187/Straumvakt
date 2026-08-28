#!/usr/bin/env node
// Straumvakt connector capacity model — OFFLINE, reproducible, no I/O to any
// live system. Emits CSV + a markdown summary to stdout/files.
//
// EVERY NUMBER HERE IS AN ASSUMPTION OR A DERIVED VALUE.
// Nothing in this file is measured. No production-scale load test exists.
// Tags used throughout:
//   [A] assumption        — chosen here, argued in the markdown doc
//   [S] source-derived    — read from repo config, cited
//   [T] target            — an SLO we would like to hold
//   [M] measured          — NONE. If a value ever becomes [M], cite the run.
//
// Usage:
//   node scripts/analysis/capacity-model.mjs            # print summary
//   node scripts/analysis/capacity-model.mjs --csv      # also write CSVs
//
// Reproducibility: pure function of the constants below. No randomness, no
// clock, no network. Same input → identical output, byte for byte.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'output');

// ── Assumptions ──────────────────────────────────────────────────────
// low / base / high. Base is what the scenarios use unless stated.
const A = {
  activeWebsocketPct:        { low: 0.90, base: 0.97, high: 0.99, tag: 'A',
    note: 'share of provisioned connectors holding a live OCPP WebSocket' },
  heartbeatIntervalSec:      { low: 900,  base: 300,  high: 60,   tag: 'A',
    note: 'OCPP Heartbeat interval; lower = more load, so "high" is the worst case' },
  statusNotifPerConnHour:    { low: 2,    base: 6,    high: 20,   tag: 'A',
    note: 'StatusNotification per connector per hour, idle + transitions' },
  concurrentChargingPct:     { low: 0.05, base: 0.10, high: 0.25, tag: 'A',
    note: 'share of connectors actively charging at a given moment' },
  meterValuesPerChargeMin:   { low: 1,    base: 1,    high: 4,    tag: 'A',
    note: 'MeterValues per active charge per minute (OCPP ClockAlignedDataInterval)' },
  sessionStartsPer1kPerMin:  { low: 0.5,  base: 2,    high: 8,    tag: 'A',
    note: 'session starts per 1000 connectors per minute' },
  reconnectBurstSec:         { low: 300,  base: 60,   high: 30,   tag: 'A',
    note: 'window over which all connectors re-establish after an outage' },
  dbWritesPerIngestEvent:    { low: 1,    base: 1.5,  high: 3,    tag: 'A',
    note: 'row writes per accepted envelope incl. projections' },
  bytesPerIngestEvent:       { low: 400,  base: 900,  high: 2000, tag: 'A',
    note: 'stored bytes per envelope incl. archive copy' },
  queueFanout:               { low: 2,    base: 2,    high: 2,    tag: 'S',
    note: 'inbound consumer fans each envelope to the archive queue — 2 queues (apps/api/wrangler.jsonc)' },
  workerCpuMsBudget:         { low: 50,   base: 50,   high: 50,   tag: 'S',
    note: 'limits.cpu_ms = 50 (wrangler.jsonc:14-16)' },
  dbClientMaxPerRequest:     { low: 1,    base: 1,    high: 1,    tag: 'S',
    note: 'makeDrizzle Pool max: 1 per request (apps/api/src/lib/drizzle.ts)' },
  costProjectionSecPer1kSess:{ low: 5,    base: 20,   high: 90,   tag: 'A',
    note: 'seconds to project cost for 1000 completed sessions' },
  issueEvalPerConnHour:      { low: 1,    base: 4,    high: 12,   tag: 'A',
    note: 'issue-engine evaluations per connector per hour' },
};

const base = (k) => A[k].base;

// ── Formulas (unit-checked in comments) ──────────────────────────────
// heartbeats/s   = connectors × activePct ÷ heartbeatIntervalSec        [1/s]
// statusNotif/s  = connectors × statusPerHour ÷ 3600                    [1/s]
// meterValues/s  = connectors × chargingPct × mvPerMin ÷ 60             [1/s]
// ingest/s       = heartbeats/s + statusNotif/s + meterValues/s         [1/s]
// queueMsgs/s    = ingest/s × queueFanout                               [1/s]
// dbWrites/s     = ingest/s × dbWritesPerIngestEvent                    [1/s]
// storage/day    = ingest/s × bytesPerEvent × 86400                     [bytes/day]

function model(connectors, o = {}) {
  const activePct   = o.activePct   ?? base('activeWebsocketPct');
  const hbSec       = o.hbSec       ?? base('heartbeatIntervalSec');
  const statusHr    = o.statusHr    ?? base('statusNotifPerConnHour');
  const chargePct   = o.chargePct   ?? base('concurrentChargingPct');
  const mvPerMin    = o.mvPerMin    ?? base('meterValuesPerChargeMin');
  const startsPerMin= (o.startsPer1k ?? base('sessionStartsPer1kPerMin')) * connectors / 1000;

  const liveConns   = connectors * activePct;
  const heartbeats  = liveConns / hbSec;
  const statusNotif = connectors * statusHr / 3600;
  const meterValues = connectors * chargePct * mvPerMin / 60;
  const ingest      = heartbeats + statusNotif + meterValues;

  return {
    connectors,
    liveConnections:   liveConns,
    heartbeatsPerSec:  heartbeats,
    statusNotifPerSec: statusNotif,
    meterValuesPerSec: meterValues,
    ingestEventsPerSec: ingest,
    queueMsgsPerSec:   ingest * base('queueFanout'),
    dbWritesPerSec:    ingest * base('dbWritesPerIngestEvent'),
    sessionStartsPerMin: startsPerMin,
    chargingNow:       connectors * chargePct,
    storageGbPerDay:   ingest * base('bytesPerIngestEvent') * 86400 / 1e9,
    issueEvalsPerSec:  connectors * base('issueEvalPerConnHour') / 3600,
  };
}

// ── Scenarios ────────────────────────────────────────────────────────
const scenarios = [
  { id: 'S1', name: '1k connectors — normal weekday',        ...model(1000) },
  { id: 'S2', name: '4k connectors — normal weekday',        ...model(4000) },
  { id: 'S3', name: '5k connectors — reconnect storm',       ...model(5000, { activePct: 1.0 }),
    peakConnectsPerSec: 5000 / base('reconnectBurstSec') },
  { id: 'S4', name: '5k connectors — free-period start surge',
    ...model(5000, { chargePct: A.concurrentChargingPct.high, startsPer1k: A.sessionStartsPer1kPerMin.high }) },
  { id: 'S5', name: '5k connectors — degraded consumer (50% throughput)',
    ...model(5000), consumerCapacityPct: 0.5 },
];

// backlog growth when the consumer runs at a fraction of arrival rate
for (const s of scenarios) {
  if (s.consumerCapacityPct != null) {
    const drain = s.queueMsgsPerSec * s.consumerCapacityPct;
    s.backlogGrowthPerSec = s.queueMsgsPerSec - drain;
    s.backlogAfter1h = s.backlogGrowthPerSec * 3600;
  }
}

// ── Sensitivity: which assumption moves ingest most? ─────────────────
function sensitivity(connectors = 4000) {
  const baseline = model(connectors).ingestEventsPerSec;
  const knobs = [
    ['heartbeatIntervalSec', (v) => model(connectors, { hbSec: v })],
    ['statusNotifPerConnHour', (v) => model(connectors, { statusHr: v })],
    ['concurrentChargingPct', (v) => model(connectors, { chargePct: v })],
    ['meterValuesPerChargeMin', (v) => model(connectors, { mvPerMin: v })],
    ['activeWebsocketPct', (v) => model(connectors, { activePct: v })],
  ];
  return knobs.map(([k, f]) => {
    const hi = f(A[k].high).ingestEventsPerSec;
    const lo = f(A[k].low).ingestEventsPerSec;
    return {
      assumption: k,
      lowIngest: lo, baseIngest: baseline, highIngest: hi,
      swingFactor: hi / baseline,
    };
  }).sort((a, b) => b.swingFactor - a.swingFactor);
}

// ── Output ───────────────────────────────────────────────────────────
const n = (x, d = 2) => (x == null ? '' : Number(x).toFixed(d));

const scenarioCsv = [
  'id,name,connectors,live_connections,heartbeats_per_sec,status_notif_per_sec,meter_values_per_sec,ingest_events_per_sec,queue_msgs_per_sec,db_writes_per_sec,session_starts_per_min,charging_now,storage_gb_per_day,issue_evals_per_sec,peak_connects_per_sec,backlog_after_1h',
  ...scenarios.map((s) => [
    s.id, `"${s.name}"`, s.connectors, n(s.liveConnections, 0), n(s.heartbeatsPerSec),
    n(s.statusNotifPerSec), n(s.meterValuesPerSec), n(s.ingestEventsPerSec),
    n(s.queueMsgsPerSec), n(s.dbWritesPerSec), n(s.sessionStartsPerMin),
    n(s.chargingNow, 0), n(s.storageGbPerDay, 3), n(s.issueEvalsPerSec),
    n(s.peakConnectsPerSec, 1), n(s.backlogAfter1h, 0),
  ].join(',')),
].join('\n');

const assumptionCsv = [
  'assumption,low,base,high,tag,note',
  ...Object.entries(A).map(([k, v]) => `${k},${v.low},${v.base},${v.high},${v.tag},"${v.note}"`),
].join('\n');

const sens = sensitivity(4000);
const sensitivityCsv = [
  'assumption,low_ingest_per_sec,base_ingest_per_sec,high_ingest_per_sec,swing_factor_high_over_base',
  ...sens.map((s) => `${s.assumption},${n(s.lowIngest)},${n(s.baseIngest)},${n(s.highIngest)},${n(s.swingFactor)}`),
].join('\n');

console.log('# Capacity model output (ALL VALUES ASSUMPTION-DERIVED, NONE MEASURED)\n');
console.log('## Scenarios\n');
console.log('| id | scenario | ingest/s | queue msgs/s | db writes/s | charging | storage GB/day |');
console.log('|---|---|---|---|---|---|---|');
for (const s of scenarios) {
  console.log(`| ${s.id} | ${s.name} | ${n(s.ingestEventsPerSec)} | ${n(s.queueMsgsPerSec)} | ${n(s.dbWritesPerSec)} | ${n(s.chargingNow, 0)} | ${n(s.storageGbPerDay, 3)} |`);
}
console.log('\n## Sensitivity at 4k connectors (ingest/s, high vs base)\n');
console.log('| assumption | base | high | swing |');
console.log('|---|---|---|---|');
for (const s of sens) {
  console.log(`| ${s.assumption} | ${n(s.baseIngest)} | ${n(s.highIngest)} | ${n(s.swingFactor)}× |`);
}
const storm = scenarios.find((s) => s.id === 'S3');
const degraded = scenarios.find((s) => s.id === 'S5');
console.log(`\nS3 peak connects/s: ${n(storm.peakConnectsPerSec, 1)}`);
console.log(`S5 backlog after 1h at 50% consumer throughput: ${n(degraded.backlogAfter1h, 0)} messages`);

if (process.argv.includes('--csv')) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'capacity-scenarios.csv'), scenarioCsv + '\n');
  writeFileSync(join(OUT_DIR, 'capacity-assumptions.csv'), assumptionCsv + '\n');
  writeFileSync(join(OUT_DIR, 'capacity-sensitivity.csv'), sensitivityCsv + '\n');
  console.error(`\nWrote 3 CSVs to ${OUT_DIR}`);
}
