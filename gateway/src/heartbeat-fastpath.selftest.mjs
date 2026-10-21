#!/usr/bin/env node
// Standalone runner for the heartbeat fast-path rules.
//
// The gateway suite is vitest, and vitest needs node_modules that this worktree
// does not have. Rather than install ~500 MB to run twenty assertions, this
// exercises the same pure module with a shim providing describe/it/expect, using
// Node's own type stripping.
//
// It is NOT a replacement for the vitest file beside it — that one runs in CI
// with the rest of the suite. This is what makes the logic verifiable *now*,
// offline, which is the whole reason the rules were pulled into a pure module.
//
// Usage: node heartbeat-fastpath.selftest.mjs

import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(HERE, 'heartbeat-fastpath.ts')).href);
const {
  bypassesIngest, recordFrame, frameCapDecision, initialFrameCap,
  CAP_EXEMPT_ACTIONS, DEFAULT_LIVENESS_CONFIG, DEFAULT_FRAME_CAP,
} = mod;

let pass = 0, fail = 0, suite = '';
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.log(`  FAIL  ${suite} :: ${name}\n        ${e.message}`); }
}
const expect = (v) => ({
  toBe: (x) => { if (v !== x) throw new Error(`expected ${JSON.stringify(x)}, got ${JSON.stringify(v)}`); },
  toEqual: (x) => { if (!eq(v, x)) throw new Error(`expected ${JSON.stringify(x)}, got ${JSON.stringify(v)}`); },
  toBeNull: () => { if (v !== null) throw new Error(`expected null, got ${JSON.stringify(v)}`); },
});
const describe = (n, fn) => { suite = n; fn(); };

const HOUR = 3600_000;
const T0 = 1_800_000_000_000;

describe('bypassesIngest', () => {
  check('drops Heartbeat', () => expect(bypassesIngest('Heartbeat')).toBe(true));
  for (const a of ['BootNotification', 'StatusNotification', 'MeterValues', 'Authorize',
    'StartTransaction', 'StopTransaction', 'DataTransfer', 'FirmwareStatusNotification']) {
    check(`does not drop ${a}`, () => expect(bypassesIngest(a)).toBe(false));
  }
  check('does not drop an untriaged action', () => expect(bypassesIngest('SomeVendorExtension')).toBe(false));
  check('does not drop the empty action', () => expect(bypassesIngest('')).toBe(false));
  check('is case sensitive', () => expect(bypassesIngest('heartbeat')).toBe(false));
});

describe('recordFrame', () => {
  check('first contact is a transition', () => {
    const d = recordFrame(null, 'BootNotification', T0);
    expect(d.emitTransition).toBe(true); expect(d.transition).toBe('online');
  });
  check('ordinary heartbeat emits no transition', () => {
    const s = recordFrame(null, 'Heartbeat', T0).next;
    expect(recordFrame(s, 'Heartbeat', T0 + HOUR).emitTransition).toBe(false);
  });
  check('720 hourly heartbeats produce ZERO transitions', () => {
    let s = recordFrame(null, 'Heartbeat', T0).next, t = 0;
    for (let i = 1; i <= 720; i++) { const d = recordFrame(s, 'Heartbeat', T0 + i * HOUR); if (d.emitTransition) t++; s = d.next; }
    expect(t).toBe(0);
  });
  check('recovery after long silence emits a transition', () => {
    const s = recordFrame(null, 'Heartbeat', T0).next;
    const gap = HOUR * DEFAULT_LIVENESS_CONFIG.offlineAfterMissedIntervals + 1;
    const d = recordFrame(s, 'Heartbeat', T0 + gap);
    expect(d.emitTransition).toBe(true); expect(d.previousStateDurationMs).toBe(gap);
  });
  check('jitter is not an outage', () => {
    const s = recordFrame(null, 'Heartbeat', T0).next;
    expect(recordFrame(s, 'Heartbeat', T0 + HOUR * 2.5).emitTransition).toBe(false);
  });
  check('rollup flushes once when the hour rolls', () => {
    let s = recordFrame(null, 'Heartbeat', T0 + 60_000).next;
    s = recordFrame(s, 'StatusNotification', T0 + 120_000).next;
    const d = recordFrame(s, 'Heartbeat', T0 + HOUR + 60_000);
    expect(d.flushRollup).toBe(true);
    expect(d.flushedBucket.counts).toEqual({ Heartbeat: 1, StatusNotification: 1 });
    expect(d.next.rollupCounts).toEqual({ Heartbeat: 1 });
  });
  check('no flush inside the same bucket', () => {
    const s = recordFrame(null, 'Heartbeat', T0 + 60_000).next;
    const d = recordFrame(s, 'Heartbeat', T0 + 120_000);
    expect(d.flushRollup).toBe(false); expect(d.next.rollupCounts).toEqual({ Heartbeat: 2 });
  });
  check('counts by action', () => {
    let s = recordFrame(null, 'Heartbeat', T0 + 1000).next;
    s = recordFrame(s, 'MeterValues', T0 + 2000).next;
    s = recordFrame(s, 'MeterValues', T0 + 3000).next;
    expect(s.rollupCounts).toEqual({ Heartbeat: 1, MeterValues: 2 });
  });
  check('lastSeenAt advances', () => {
    const s = recordFrame(null, 'Heartbeat', T0).next;
    expect(recordFrame(s, 'Heartbeat', T0 + 5000).next.lastSeenAt).toBe(T0 + 5000);
  });
  check('reports expected next heartbeat', () => expect(recordFrame(null, 'Heartbeat', T0).expectedNextHeartbeatAt).toBe(T0 + HOUR));
  check('survives a hibernation wake', () => {
    const a = recordFrame(null, 'Heartbeat', T0).next;
    const viaStorage = JSON.parse(JSON.stringify(a));
    expect(recordFrame(viaStorage, 'Heartbeat', T0 + HOUR)).toEqual(recordFrame(a, 'Heartbeat', T0 + HOUR));
  });
});

describe('frameCapDecision', () => {
  check('permits a normal rate', () => {
    let s = initialFrameCap(T0);
    for (let i = 0; i < 10; i++) { const d = frameCapDecision(s, 'Heartbeat', T0 + i * 1000); expect(d.shedIngest).toBe(false); s = d.next; }
  });
  check('sheds once over the cap', () => {
    let s = initialFrameCap(T0), shed = 0;
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 5; i++) { const d = frameCapDecision(s, 'StatusNotification', T0 + i * 100); if (d.shedIngest) shed++; s = d.next; }
    expect(shed).toBe(5);
  });
  check('emits exactly one breach event', () => {
    let s = initialFrameCap(T0), b = 0;
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 50; i++) { const d = frameCapDecision(s, 'StatusNotification', T0 + i * 100); if (d.emitBreachEvent) b++; s = d.next; }
    expect(b).toBe(1);
  });
  for (const a of CAP_EXEMPT_ACTIONS) {
    check(`never sheds ${a}`, () => {
      let s = initialFrameCap(T0);
      for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 20; i++) s = frameCapDecision(s, 'StatusNotification', T0 + i * 100).next;
      expect(frameCapDecision(s, a, T0 + 100_000).shedIngest).toBe(false);
    });
  }
  check('keeps shedding while quarantined', () => {
    let s = initialFrameCap(T0);
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 1; i++) s = frameCapDecision(s, 'StatusNotification', T0 + i * 100).next;
    const d = frameCapDecision(s, 'StatusNotification', T0 + 200_000);
    expect(d.shedIngest).toBe(true); expect(d.reason).toBe('quarantined');
  });
  check('recovers in a new window', () => {
    let s = initialFrameCap(T0);
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 1; i++) s = frameCapDecision(s, 'StatusNotification', T0 + i * 100).next;
    const d = frameCapDecision(s, 'StatusNotification', T0 + DEFAULT_FRAME_CAP.windowMs + 1000);
    expect(d.shedIngest).toBe(false); expect(d.next.count).toBe(1);
  });
  check('anomaly only after repeated breaches', () => {
    let s = initialFrameCap(T0), an = 0;
    for (let w = 0; w < DEFAULT_FRAME_CAP.anomalyAfterConsecutiveBreaches; w++) {
      const base = T0 + w * DEFAULT_FRAME_CAP.windowMs;
      for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 2; i++) { const d = frameCapDecision(s, 'StatusNotification', base + i * 100); if (d.emitAnomalyEvent) an++; s = d.next; }
    }
    expect(an).toBe(1);
  });
  check('survives a hibernation wake', () => {
    let s = frameCapDecision(initialFrameCap(T0), 'Heartbeat', T0 + 1000).next;
    const viaStorage = JSON.parse(JSON.stringify(s));
    expect(frameCapDecision(viaStorage, 'Heartbeat', T0 + 2000)).toEqual(frameCapDecision(s, 'Heartbeat', T0 + 2000));
  });
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
