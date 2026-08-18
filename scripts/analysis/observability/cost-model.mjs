#!/usr/bin/env node
/**
 * OCPP cost evidence model.
 *
 * Produces frame, DO-wakeup, queue-op, consumer-invocation, DB-row and
 * metric-point counts per scenario and per fleet size.
 *
 * **No kr figures.** Cloudflare unit prices are not knowable from this
 * tree, and a plausible-looking wrong number is worse than an honest
 * formula. Every monetary term is emitted as a named placeholder
 * (`P_QUEUE_OP`, `P_DO_REQ`, …) to be multiplied once real prices are
 * recorded with a source and a date. What this model is *for* is
 * sensitivity and multipliers, which do not need prices.
 *
 * Intervals marked `tbd: true` are guesses standing in for measurements
 * that do not exist yet (M-3). They are flagged in every output so no
 * downstream reader mistakes them for evidence.
 *
 * `node:` builtins only. Read-only. Usage:
 *   node cost-model.mjs [--md] [--json]
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MONTH_S = 30 * 24 * 3600;
const DAY_S = 24 * 3600;
const HOUR_S = 3600;

/** Storage class per action — what the frame is allowed to become. */
export const STORAGE_CLASS = {
  Heartbeat: "liveness only",
  BootNotification: "event",
  StatusNotification: "event",
  MeterValues: "billing material",
  StartTransaction: "billing material",
  StopTransaction: "billing material",
  Authorize: "event",
  DataTransfer: "raw protocol",
};

/**
 * One scenario = a frame arrival pattern for a single connector.
 * `queueRate` is the share of frames that become queue messages after
 * the fast path; heartbeats are 0 by construction.
 */
export const SCENARIOS = [
  {
    id: "idle-3600",
    label: "Idle connector, 3600 s heartbeat (product frame)",
    action: "Heartbeat", intervalS: 3600, durationS: MONTH_S,
    queued: false, tbd: false,
    controlledBy: "PRODUCT_HEARTBEAT_INTERVAL_SECONDS / idleHeartbeatIntervalMs",
    gate: "OB6, OB7, OC5",
  },
  {
    id: "idle-60",
    label: "Idle connector, 60 s heartbeat (the pre-fix defect)",
    action: "Heartbeat", intervalS: 60, durationS: MONTH_S,
    queued: false, tbd: false,
    controlledBy: "literal interval in stubResponseFor — now derived",
    gate: "OB6, OB23 (reports the multiplier)",
  },
  {
    id: "noisy-1s-1h",
    label: "Noisy connector, 1 frame/s, 1 hour",
    action: "StatusNotification", intervalS: 1, durationS: HOUR_S,
    queued: true, tbd: false,
    controlledBy: "DEFAULT_FRAME_CAP (120/hour, then shed)",
    gate: "OB5, OB25, OC10",
  },
  {
    id: "noisy-1s-1d",
    label: "Noisy connector, 1 frame/s, 1 day",
    action: "StatusNotification", intervalS: 1, durationS: DAY_S,
    queued: true, tbd: false,
    controlledBy: "DEFAULT_FRAME_CAP + quarantine",
    gate: "OB5, OB25, OC10",
  },
  {
    id: "noisy-1s-1mo",
    label: "Noisy connector, 1 frame/s, 1 month",
    action: "StatusNotification", intervalS: 1, durationS: MONTH_S,
    queued: true, tbd: false,
    controlledBy: "DEFAULT_FRAME_CAP + quarantine",
    gate: "OB5, OB25, OC10",
  },
  {
    id: "session-startup-1s-5m",
    label: "Active session — startup burst, 1 s for 5 min",
    action: "MeterValues", intervalS: 1, durationS: 300,
    queued: true, tbd: true,
    controlledBy: "charger firmware — not settable from here",
    gate: "OC6 refuses a fabricated interval",
  },
  {
    id: "session-settling-10s",
    label: "Active session — settling, 10 s for 10 min",
    action: "MeterValues", intervalS: 10, durationS: 600,
    queued: true, tbd: true,
    controlledBy: "charger firmware",
    gate: "OC6",
  },
  {
    id: "session-active-120s",
    label: "Active session — steady, 120 s for 4 h",
    action: "MeterValues", intervalS: 120, durationS: 4 * HOUR_S,
    queued: true, tbd: true,
    controlledBy: "charger firmware / OCPP MeterValueSampleInterval",
    gate: "OC6",
  },
  {
    id: "session-connected-idle-240s",
    label: "Connected but idle, 240 s for 8 h",
    action: "MeterValues", intervalS: 240, durationS: 8 * HOUR_S,
    queued: true, tbd: true,
    controlledBy: "charger firmware",
    gate: "OC6",
  },
];

export const FLEETS = [1, 50, 500, 1000, 20_000];

/**
 * The frame cap admits `maxFramesPerWindow` per window and sheds the
 * rest from *ingest* while still answering the protocol. So a noisy
 * charger's frame count is unchanged — the DO still wakes — but its
 * queue and DB cost is clamped. That asymmetry is the whole point of
 * the cap and the model has to show it.
 */
export const FRAME_CAP = { windowMs: 3_600_000, maxFramesPerWindow: 120 };

export function evaluateScenario(s) {
  const frames = Math.floor(s.durationS / s.intervalS);
  const windows = s.durationS / (FRAME_CAP.windowMs / 1000);
  const admitted = s.queued
    ? Math.min(frames, Math.ceil(windows * FRAME_CAP.maxFramesPerWindow))
    : 0;
  const shed = s.queued ? frames - admitted : 0;

  // Every inbound frame wakes the DO — the fast path reduces what
  // happens *after* the wake, not the wake itself. Anyone modelling
  // heartbeat savings as "no DO cost" is wrong, and this row says so.
  const doWakeups = frames;
  // One storage put per frame: liveness + cap state share one key.
  const doStorageWrites = frames;
  const queueOps = admitted;
  const consumerInvocations = admitted; // 1:1 before batching
  const dbRows = s.action === "Heartbeat" ? 0 : admitted;
  const dbRowsAvoided = s.action === "Heartbeat" ? frames : shed;
  // Two metric points per heartbeat (received + suppressed), one otherwise.
  const metricPoints = s.action === "Heartbeat" ? frames * 2 : frames;
  const events = s.action === "Heartbeat" ? 0 : admitted;

  return {
    ...s,
    storageClass: STORAGE_CLASS[s.action] ?? "unknown",
    frames, doWakeups, doStorageWrites, queueOps, consumerInvocations,
    dbRows, dbRowsAvoided, metricPoints, events, shed,
    formula: "cost = frames·P_DO_REQ + doStorageWrites·P_DO_WRITE + queueOps·P_QUEUE_OP + consumerInvocations·P_CONSUMER + dbRows·P_NEON_ROW + metricPoints·P_AE_POINT",
  };
}

export function run() {
  const scenarios = SCENARIOS.map(evaluateScenario);
  const fleets = {};
  for (const n of FLEETS) {
    fleets[n] = scenarios.map((s) => ({
      id: s.id,
      connectors: n,
      frames: s.frames * n,
      doWakeups: s.doWakeups * n,
      queueOps: s.queueOps * n,
      dbRows: s.dbRows * n,
      metricPoints: s.metricPoints * n,
      tbd: s.tbd,
    }));
  }
  const idle3600 = scenarios.find((s) => s.id === "idle-3600");
  const idle60 = scenarios.find((s) => s.id === "idle-60");
  return {
    generated: "deterministic — no clock, no randomness",
    priceePlaceholders: ["P_DO_REQ", "P_DO_WRITE", "P_QUEUE_OP", "P_CONSUMER", "P_NEON_ROW", "P_AE_POINT"],
    frameCap: FRAME_CAP,
    scenarios,
    fleets,
    headline: {
      idleFramesPerConnectorMonth: idle3600.frames,
      idleFramesPerConnectorMonthAt60s: idle60.frames,
      multiplier: idle60.frames / idle3600.frames,
      queueOpsSavedPerConnectorMonth: idle3600.dbRowsAvoided,
      noisyMonthFramesUncapped: scenarios.find((s) => s.id === "noisy-1s-1mo").frames,
      noisyMonthQueueOpsCapped: scenarios.find((s) => s.id === "noisy-1s-1mo").queueOps,
    },
  };
}

const n = (x) => x.toLocaleString("en-US");

function toMarkdown(r) {
  const L = [];
  L.push("| Scenario | Interval | Duration | Frames | DO wakeups | DO writes | Queue ops | Consumer | DB rows | Rows avoided | Metric pts | Storage class | Controlled by | Gate | TBD |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of r.scenarios) {
    L.push(`| ${s.label} | ${s.intervalS}s | ${n(s.durationS)}s | ${n(s.frames)} | ${n(s.doWakeups)} | ${n(s.doStorageWrites)} | ${n(s.queueOps)} | ${n(s.consumerInvocations)} | ${n(s.dbRows)} | ${n(s.dbRowsAvoided)} | ${n(s.metricPoints)} | ${s.storageClass} | \`${s.controlledBy}\` | ${s.gate} | ${s.tbd ? "**yes**" : "no"} |`);
  }
  L.push("");
  L.push("### Fleet scaling — monthly idle path only (3600 s heartbeat)");
  L.push("");
  L.push("| Connectors | Frames/mo | DO wakeups/mo | Queue ops/mo | DB rows/mo | Metric points/mo |");
  L.push("|---|---|---|---|---|---|");
  for (const size of FLEETS) {
    const row = r.fleets[size].find((x) => x.id === "idle-3600");
    L.push(`| ${n(size)} | ${n(row.frames)} | ${n(row.doWakeups)} | ${n(row.queueOps)} | ${n(row.dbRows)} | ${n(row.metricPoints)} |`);
  }
  L.push("");
  L.push("### The same fleets at the 60 s defect");
  L.push("");
  L.push("| Connectors | Frames/mo | DO wakeups/mo | Δ vs 3600 s |");
  L.push("|---|---|---|---|");
  for (const size of FLEETS) {
    const a = r.fleets[size].find((x) => x.id === "idle-3600");
    const b = r.fleets[size].find((x) => x.id === "idle-60");
    L.push(`| ${n(size)} | ${n(b.frames)} | ${n(b.doWakeups)} | **+${n(b.frames - a.frames)}** |`);
  }
  return L.join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const r = run();
  if (process.argv.includes("--md")) console.log(toMarkdown(r));
  else console.log(JSON.stringify(r, null, 2));
}
