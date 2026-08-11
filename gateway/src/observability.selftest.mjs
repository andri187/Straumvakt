#!/usr/bin/env node
// Standalone runner for the observability slice: BootNotification
// interval resolution, the Analytics Engine metrics writer, and the
// Sentry scrubber.
//
// Same rationale as heartbeat-fastpath.selftest.mjs — the gateway suite
// is vitest and this worktree has no node_modules, so these assertions
// run against the real modules using Node's own type stripping. The
// vitest files beside them cover the same ground in CI.
//
// Usage: node observability.selftest.mjs

import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f) => import(pathToFileURL(join(HERE, f)).href);

const hb = await load('heartbeat-fastpath.ts');
const met = await load('metrics.ts');
const sc = await load('sentry-scrub.ts');

let pass = 0, fail = 0, suite = '';
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.log(`  FAIL  ${suite} :: ${name}\n        ${e.message}`); }
}
const expect = (v) => ({
  toBe: (x) => { if (v !== x) throw new Error(`expected ${JSON.stringify(x)}, got ${JSON.stringify(v)}`); },
  toEqual: (x) => { if (!eq(v, x)) throw new Error(`expected ${JSON.stringify(x)}, got ${JSON.stringify(v)}`); },
  toContain: (x) => { if (!String(v).includes(x)) throw new Error(`expected to contain ${x}, got ${JSON.stringify(v)}`); },
  toBeUndefined: () => { if (v !== undefined) throw new Error(`expected undefined, got ${JSON.stringify(v)}`); },
  toBeTruthy: () => { if (!v) throw new Error(`expected truthy, got ${JSON.stringify(v)}`); },
  toBeFalsy: () => { if (v) throw new Error(`expected falsy, got ${JSON.stringify(v)}`); },
});
const describe = (n, fn) => { suite = n; fn(); };

// ── Phase 2 · BootNotification interval ────────────────────────────
describe('boot interval', () => {
  check('product frame is 3600 s', () => {
    expect(hb.PRODUCT_HEARTBEAT_INTERVAL_SECONDS).toBe(3600);
  });
  check('derived from liveness config, not a literal', () => {
    expect(hb.bootNotificationIntervalSeconds()).toBe(3600);
    expect(hb.bootNotificationIntervalSeconds()).toBe(hb.PRODUCT_HEARTBEAT_INTERVAL_SECONDS);
  });
  check('derivation tracks a changed liveness config', () => {
    // The point of deriving: move the window, the advertised interval
    // moves with it. This is what makes 60-vs-3600 drift impossible.
    const cfg = { ...hb.DEFAULT_LIVENESS_CONFIG, idleHeartbeatIntervalMs: 900_000 };
    expect(hb.bootNotificationIntervalSeconds(cfg)).toBe(900);
  });
  check('absent override uses product default', () => {
    expect(hb.resolveHeartbeatIntervalSeconds(undefined)).toEqual({ seconds: 3600, source: 'product-default' });
    expect(hb.resolveHeartbeatIntervalSeconds(null).seconds).toBe(3600);
    expect(hb.resolveHeartbeatIntervalSeconds('   ').source).toBe('product-default');
  });
  check('valid override is honoured', () => {
    expect(hb.resolveHeartbeatIntervalSeconds('900')).toEqual({ seconds: 900, source: 'env-override' });
  });
  check('REGRESSION: 60 is legal only as an explicit override, never a default', () => {
    // 60 is inside the legal range, so an operator who has measured the
    // hardware may set it. What must never happen is 60 arriving
    // silently as the built-in.
    expect(hb.resolveHeartbeatIntervalSeconds('60')).toEqual({ seconds: 60, source: 'env-override' });
    expect(hb.resolveHeartbeatIntervalSeconds(undefined).seconds).toBe(3600);
  });
  check('out-of-range and junk overrides are rejected, not clamped', () => {
    for (const bad of ['0', '59', '86401', '-1', 'abc', '3.5', '1e9', '']) {
      const r = hb.resolveHeartbeatIntervalSeconds(bad);
      expect(r.seconds).toBe(3600);
      if (bad !== '') expect(r.source).toBe('rejected-override');
    }
  });
});

// ── Phase 3 · Analytics Engine metrics ─────────────────────────────
function recorder() {
  const points = [];
  return { points, writeDataPoint: (p) => points.push(p) };
}

describe('metrics writer', () => {
  check('no-op safe when binding absent', () => {
    const w = met.createMetricsWriter(undefined);
    expect(w.enabled).toBeFalsy();
    w.count('heartbeats_received', { identity: 'ZPR074002' }); // must not throw
  });
  check('NOOP_METRICS is disabled', () => {
    expect(met.NOOP_METRICS.enabled).toBeFalsy();
    met.NOOP_METRICS.count('missed_heartbeats');
  });
  check('writes a point when bound', () => {
    const r = recorder();
    const w = met.createMetricsWriter(r);
    expect(w.enabled).toBeTruthy();
    w.count('heartbeats_received', { identity: 'ZPR074002' });
    expect(r.points.length).toBe(1);
    expect(r.points[0].indexes).toEqual(['heartbeats_received']);
    expect(r.points[0].doubles).toEqual([1]);
  });
  check('all nine required metric names exist', () => {
    for (const n of ['heartbeats_received', 'heartbeats_suppressed', 'missed_heartbeats',
      'queue_messages_by_type', 'noisy_charger_events', 'gateway_errors_by_type',
      'billing_job_started', 'billing_job_completed', 'billing_job_failed']) {
      if (!met.METRIC_NAMES.includes(n)) throw new Error(`missing metric ${n}`);
    }
    expect(met.METRIC_NAMES.length).toBe(9);
  });
  check('PII: raw charger identity never appears in a blob', () => {
    const r = recorder();
    met.createMetricsWriter(r).count('heartbeats_received', { identity: 'ZPR074002' });
    const flat = JSON.stringify(r.points[0]);
    if (flat.includes('ZPR074002')) throw new Error('raw identity leaked into blobs');
    expect(r.points[0].blobs[1]).toContain('cid_');
  });
  check('pseudonymisation is stable and salt-separated', () => {
    expect(met.pseudonymiseIdentity('A')).toBe(met.pseudonymiseIdentity('A'));
    if (met.pseudonymiseIdentity('A') === met.pseudonymiseIdentity('B')) throw new Error('collision on distinct ids');
    if (met.pseudonymiseIdentity('A', 's1') === met.pseudonymiseIdentity('A', 's2')) throw new Error('salt ignored');
  });
  check('PII: forbidden dimension key is refused by buildBlobs', () => {
    let threw = false;
    try { met.buildBlobs('heartbeats_received', { idTag: 'DEADBEEF' }); } catch { threw = true; }
    expect(threw).toBeTruthy();
  });
  check('a forbidden dimension does not crash the hot path', () => {
    const r = recorder();
    const seen = [];
    const w = met.createMetricsWriter(r, { onError: (e) => seen.push(e) });
    w.count('heartbeats_received', { idTag: 'DEADBEEF' }); // must not throw
    expect(r.points.length).toBe(0);
    expect(seen.length).toBe(1);
  });
  check('blob order is positional and fixed', () => {
    // Dashboard queries index blobs by position, so this order is a
    // contract, not an implementation detail.
    expect(met.buildBlobs('gateway_errors_by_type', {
      identity: 'X', eventType: 'Heartbeat', errorKind: 'parse_error', period: '2026-08',
    })).toEqual(['gateway_errors_by_type', met.pseudonymiseIdentity('X'), 'Heartbeat', 'parse_error', '2026-08']);
  });
  check('a throwing binding never propagates', () => {
    const seen = [];
    const w = met.createMetricsWriter({ writeDataPoint: () => { throw new Error('AE down'); } }, { onError: (e) => seen.push(e) });
    w.count('heartbeats_suppressed'); // must not throw
    expect(seen.length).toBe(1);
  });
  check('non-finite values are dropped', () => {
    const r = recorder();
    const w = met.createMetricsWriter(r);
    w.count('missed_heartbeats', {}, NaN);
    w.count('missed_heartbeats', {}, Infinity);
    expect(r.points.length).toBe(0);
  });
});

// ── Phase 4 · Sentry scrubbing ─────────────────────────────────────
describe('sentry scrubber', () => {
  check('idTag is redacted at any depth and casing', () => {
    const out = sc.scrubValue({ a: { b: { idTag: 'DEADBEEF', IDTAG: 'X', idTagInfo: { status: 'Accepted' } } } });
    const flat = JSON.stringify(out);
    if (flat.includes('DEADBEEF')) throw new Error('idTag leaked');
    if (flat.includes('"X"')) throw new Error('IDTAG leaked');
  });
  check('credentials and headers are redacted', () => {
    const out = sc.scrubValue({
      Authorization: 'Basic Zm9vOmJhcg==',
      password: 'hunter2',
      'x-api-key': 'k',
      SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/2',
    });
    const flat = JSON.stringify(out);
    for (const bad of ['Zm9vOmJhcg', 'hunter2', 'ingest.sentry.io']) {
      if (flat.includes(bad)) throw new Error(`leaked ${bad}`);
    }
  });
  check('kennitala is treated as personal data', () => {
    const flat = JSON.stringify(sc.scrubValue({ kennitala: '1234567890' }));
    if (flat.includes('1234567890')) throw new Error('kennitala leaked');
  });
  check('OCPP payload: allowlisted fields survive, the rest are dropped', () => {
    const out = sc.scrubOcppPayload({ status: 'Accepted', connectorId: 1, idTag: 'DEADBEEF', customVendorBlob: 'x' });
    expect(out.status).toBe('Accepted');
    expect(out.connectorId).toBe(1);
    expect(out.idTag).toBeUndefined();
    expect(out.customVendorBlob).toBeUndefined();
    expect(out._droppedFields).toBe(2);
  });
  check('an unknown future OCPP field is dropped by default', () => {
    // The allowlist is what makes this safe as the protocol grows.
    const out = sc.scrubOcppPayload({ driverPhoneNumber: '+3545551234' });
    if (JSON.stringify(out).includes('5551234')) throw new Error('unknown field leaked');
  });
  check('non-object payload is not passed through', () => {
    expect(sc.scrubOcppPayload('raw string')._dropped).toBe(sc.REDACTED);
    expect(sc.scrubOcppPayload(null)._dropped).toBe(sc.REDACTED);
  });
  check('URL userinfo and query are stripped', () => {
    const u = sc.scrubUrl('wss://charger:s3cret@ocpp.straumvakt.org/ocpp/ZPR074002?token=abc');
    if (u.includes('s3cret') || u.includes('abc')) throw new Error(`leaked: ${u}`);
    expect(u).toContain('ocpp.straumvakt.org');
  });
  check('malformed URL collapses to redacted', () => {
    expect(sc.scrubUrl('not a url')).toBe(sc.REDACTED);
  });
  check('scrubEvent drops user entirely', () => {
    const out = sc.scrubEvent({ user: { id: 'u1', email: 'a@b.is' } });
    expect(out.user).toBeUndefined();
  });
  check('scrubEvent cleans request headers, url and body together', () => {
    const out = sc.scrubEvent({
      request: {
        url: 'wss://c:p@h/ocpp/X?t=1',
        headers: { Authorization: 'Basic AAA', 'user-agent': 'zaptec' },
        data: { idTag: 'DEADBEEF', status: 'Accepted' },
      },
    });
    const flat = JSON.stringify(out);
    for (const bad of ['DEADBEEF', 'Basic AAA', 'c:p@h']) {
      if (flat.includes(bad)) throw new Error(`leaked ${bad}`);
    }
    expect(out.request.headers['user-agent']).toBe('zaptec');
    expect(out.request.data.status).toBe('Accepted');
  });
  check('breadcrumbs are scrubbed and bounded', () => {
    const crumbs = Array.from({ length: 100 }, (_, i) => ({ message: `m${i}`, data: { idTag: 'DEADBEEF' } }));
    const out = sc.scrubEvent({ breadcrumbs: crumbs });
    expect(out.breadcrumbs.length).toBe(30);
    if (JSON.stringify(out.breadcrumbs).includes('DEADBEEF')) throw new Error('crumb leaked idTag');
  });
  check('cyclic structures terminate', () => {
    const a = { name: 'a' }; a.self = a;
    const out = sc.scrubValue(a); // must not hang or throw
    expect(typeof out).toBe('object');
  });
  check('config: absent DSN disables rather than throws', () => {
    const c = sc.sentryConfigFrom({});
    expect(c.enabled).toBeFalsy();
    expect(c.dsn).toBeUndefined();
    expect(sc.sentryConfigFrom({ SENTRY_DSN: '   ' }).enabled).toBeFalsy();
  });
  check('config: DSN present enables, version id becomes release', () => {
    const c = sc.sentryConfigFrom({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/2', CF_VERSION_METADATA: { id: 'v-123' } }, 'staging');
    expect(c.enabled).toBeTruthy();
    expect(c.release).toBe('v-123');
    expect(c.environment).toBe('staging');
  });
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
