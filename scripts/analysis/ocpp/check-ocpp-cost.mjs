#!/usr/bin/env node
// OCPP / Core cost gates — 22 rules over an ops profile.
//
// The lane this serves is "keep Core cheap and releasable". Pricing is
// 200 kr/connector/month + 50 kr/active driver/month, capped at 450 kr/connector.
// That cap is the whole reason these rules exist: at 450 kr a connector cannot
// carry an unbounded per-frame cost, so anything that scales with FRAMES rather
// than with SESSIONS has to be justified rather than assumed.
//
// Rules are a pure function of a profile: no git, no network, no filesystem
// beyond reading the profile and its fixtures. That split is what makes them
// testable — you cannot conveniently arrange a fleet of noisy chargers to prove
// a rule fires, but you can write the profile down.
//
// SAFETY: imports only node:fs / node:path / node:url. No network, no
// child_process, no writes except an explicit --report path.
//
// Usage:
//   node check-ocpp-cost.mjs <profile.json>
//   node check-ocpp-cost.mjs --strict <profile.json>
//   node check-ocpp-cost.mjs --json <profile.json>
//   node check-ocpp-cost.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Cloudflare/Neon unit costs are deliberately NOT hard-coded as money here.
// Prices change and a stale constant in a checker is worse than no constant.
// The rules reason about ORDERS OF MAGNITUDE and about whether a cost scales
// with frames, and Phase 3's measurement plan turns that into ISK.
const FRAME_SCALE_CEILING_PER_CONNECTOR_MONTH = 5000;

function evaluate(p) {
  const F = [];
  const add = (id, sev, msg, fix) => F.push({ id, severity: sev, message: msg, fix: fix ?? null });
  const hb = p.heartbeat ?? {};
  const dobj = p.durableObject ?? {};
  const q = p.queues ?? {};

  // ── Heartbeat and ingest volume ───────────────────────────────────
  // OC1. The rule this whole checker exists for.
  if (hb.heartbeatSkipsQueue !== true) {
    add('OC1', 'error',
      `every OCPP Call frame is enqueued, including Heartbeat${hb.everyFrameEnqueuedAt ? ` (${hb.everyFrameEnqueuedAt})` : ''} — an idle connector therefore costs ${p.derived?.idleHeartbeatsPerConnectorPerMonth ?? '~720'} queue operations a month for frames that carry nothing but liveness and a clock`,
      'drop Heartbeat before enqueueOrPost and fold it into a lastSeenAt write plus an online/offline transition; keep the frame only if it changes state');
  }
  // OC2. Labelling is not the same as not sending.
  if (hb.retentionClassCarriedOnEvent === true && hb.heartbeatSkipsQueue !== true) {
    add('OC2', 'warn',
      'retentionClass rides on the queue message rather than gating the send — the classification is correct but it is applied downstream, so the queue operation has already been paid for by the time anything knows the frame is disposable',
      'move the retention decision in front of the send for raw_protocol frames');
  }
  // OC3. Heartbeat must be classified disposable at all.
  if (!hb.heartbeatClassifiedRawProtocolAt) {
    add('OC3', 'error', 'Heartbeat is not classified as raw_protocol anywhere — nothing marks it disposable, so a consumer has no basis to discard it',
      'classify Heartbeat as raw_protocol in retentionClassFor');
  }
  // OC4. An untriaged frame type must fail long, not short.
  if (hb.retentionClassFunctionAt && p.retentionDefault && p.retentionDefault === 'raw_protocol') {
    add('OC4', 'error', 'the default retention class is raw_protocol — an unrecognised frame type would be discarded silently, which is the wrong failure direction',
      'default to operational: an untriaged frame is more likely to be something new that matters than something disposable');
  }
  // OC5. Idle interval.
  if (hb.idleIntervalSeconds == null) add('OC5', 'error', 'idle heartbeat interval is unset');
  else if (hb.idleIntervalSeconds < 3600) {
    add('OC5', 'error', `idle heartbeat interval is ${hb.idleIntervalSeconds}s, below the locked 3600s — cost scales linearly with this number and nothing else changed to justify it`);
  }
  // OC6. Active interval must be measured, never invented.
  if (hb.activeSessionIntervalSeconds != null && !hb.activeSessionIntervalSource?.match(/measured|observed/i)) {
    add('OC6', 'error', `an active-session interval of ${hb.activeSessionIntervalSeconds}s is recorded without a measured source — this number is explicitly TBD from real charger data, and a guess here sizes the entire ingest path`);
  }
  // OC7. No permanent raw row.
  if (p.storage?.rawFramesPersistedPermanently === true) {
    add('OC7', 'error', 'raw protocol frames are persisted permanently — heartbeats become a growing table that nothing reads',
      'raw frames are TTL diagnostics only; the durable artifact is the derived downtime period');
  }
  // OC8. TTL must exist and be bounded.
  if (p.storage?.rawFrameTtlDays == null) add('OC8', 'warn', 'no TTL recorded for raw protocol frames');
  else if (p.storage.rawFrameTtlDays > 30) add('OC8', 'error', `raw frame TTL is ${p.storage.rawFrameTtlDays} days — diagnostics that outlive the incident they diagnose are just storage`);
  // OC9. The liveness artifacts must exist, or the heartbeat is pure cost.
  for (const k of ['lastSeenAt', 'onlineOfflineTransitions', 'hourlyRollup']) {
    if (p.liveness && p.liveness[k] !== true) {
      add('OC9', 'error', `liveness artifact "${k}" is absent — without it the heartbeat is paid for and nothing durable is produced from it`);
    }
  }
  // OC10. Noisy connector cap.
  if (p.limits?.perConnectorFramesPerHourCap == null) {
    add('OC10', 'error', 'no per-connector frame cap — one misbehaving charger can bill the whole estate, and a 450 kr cap per connector cannot absorb it',
      'cap frames per connector per hour, log the breach, and keep serving the protocol while dropping the ingest');
  }
  // OC11. Frame-scaling sanity against the price cap.
  const est = p.derived?.idleHeartbeatsPerConnectorPerMonth ?? 0;
  if (est > FRAME_SCALE_CEILING_PER_CONNECTOR_MONTH) {
    add('OC11', 'error', `estimated ${est} frames/connector/month exceeds the ${FRAME_SCALE_CEILING_PER_CONNECTOR_MONTH} ceiling this checker will accept without a measured justification`);
  }

  // ── Durable Object ────────────────────────────────────────────────
  // OC12. Hibernation is the difference between paying for wall-clock and paying for work.
  if (dobj.usesHibernationApi !== true) {
    add('OC12', 'error', 'the DO does not use the WebSocket Hibernation API — a charger holding an idle socket would bill duration for doing nothing',
      'accept sockets with state.acceptWebSocket');
  }
  // OC13. Hibernation only helps if nothing depends on in-memory state.
  if (dobj.usesHibernationApi === true && dobj.inMemoryStateAcrossWake !== true) {
    add('OC13', 'warn', 'hibernation is enabled but there is no evidence the code accounts for losing in-memory state across a wake — a fresh instance over the same storage is what a wake-up looks like');
  }
  // OC14. Auto-response handles WS-level ping without a wake.
  if (dobj.usesAutoResponse !== true) {
    add('OC14', 'info', 'setWebSocketAutoResponse is not used — it answers WebSocket-level ping without waking the DO. Note this does NOT cover OCPP Heartbeat, which is an application frame and still wakes the object; the two are easy to conflate');
  }
  // OC15. Authorize cache bounds the API round trips.
  if (dobj.authorizeCacheTtlMs == null) add('OC15', 'warn', 'no Authorize cache TTL recorded — every Authorize becomes an API call');
  else if (dobj.authorizeCacheTtlMs > 300_000) add('OC15', 'error', `Authorize cache TTL is ${dobj.authorizeCacheTtlMs}ms — a long TTL allows repeated starts on a token that has since been revoked`);

  // ── Queues ────────────────────────────────────────────────────────
  const gwProducers = (q.gateway ?? []).flatMap((e) => e.producers ?? []);
  // OC16. The binding must exist before scale, not after.
  if (!gwProducers.length) {
    add('OC16', 'error', 'no queue producer binding declared on the gateway — the ingest path would silently fall back to a synchronous POST for every frame',
      'declare the producer binding and verify it in the deployed environment, not only in config');
  }
  // OC17. A fallback that nobody notices is a fallback that becomes the norm.
  if (q.fallbackPath && !q.fallbackWarnsAt) {
    add('OC17', 'error', 'a synchronous fallback ingest path exists with no warning log — running permanently on the fallback is indistinguishable from running on the queue until the bill arrives');
  }
  // OC18. Every producer needs a consumer somewhere in the estate.
  const allConsumers = [...(q.gateway ?? []), ...(q.api ?? [])].flatMap((e) => (e.consumers ?? []).map((c) => c.queue));
  for (const pr of gwProducers) {
    if (pr.queue && !allConsumers.includes(pr.queue)) {
      add('OC18', 'warn', `queue "${pr.queue}" has a producer but no consumer declared in this estate — work is accepted and then goes nowhere`);
    }
  }
  // OC19. A DLQ is where unprocessed work hides.
  for (const e of [...(q.gateway ?? []), ...(q.api ?? [])]) {
    for (const c of e.consumers ?? []) {
      if (!c.deadLetterQueue) add('OC19', 'warn', `consumer for "${c.queue}" declares no dead_letter_queue — a poison message retries until it is dropped, unobserved`);
      if (c.maxRetries != null && c.maxRetries > 5) add('OC19', 'error', `consumer for "${c.queue}" retries ${c.maxRetries} times — retries multiply the cost of exactly the messages that are already failing`);
    }
  }

  // ── Release-adjacent cost controls ────────────────────────────────
  // OC20. The workers.dev foot-gun, restated as a cost/availability gate.
  for (const f of p.workersDev ?? []) {
    for (const e of f.environments ?? []) {
      if (!e.name) continue;
      const pinned = (p.pinnedHosts ?? []).some((h) => h.host?.includes(e.name));
      if (pinned && !e.declaresWorkersDev) {
        add('OC20', 'error', `${f.file} [${e.env} ${e.name}] is pinned by a shipped client but does not declare workers_dev — adding routes would infer workers_dev=false and remove the host`);
      }
    }
  }
  // OC21. A pinned host with no client-side override has no cheap recovery.
  for (const h of p.pinnedHosts ?? []) {
    if (h.overridable === false) {
      add('OC21', 'warn', `${h.client} pins ${h.host} with no runtime override (${h.file}:${h.line ?? '?'}) — recovery is server-side only; a client fix costs a store release`);
    }
  }
  // OC22. Per-org Neon branches would multiply the database bill by tenant.
  if (p.neon?.branchPerOrg === true) {
    add('OC22', 'error', 'a Neon branch per organisation is recorded — this multiplies storage and compute by tenant count and defeats shared multi-tenant infrastructure',
      'one shared branch per environment; isolate by org scope in the schema, not by branch');
  }

  return F;
}

function report(findings, label) {
  const err = findings.filter((f) => f.severity === 'error');
  if (!findings.length) { console.log(`OK      ${label} — no cost gate findings`); return 0; }
  console.log(`        ${label}`);
  for (const f of findings) {
    const tag = f.severity === 'error' ? 'ERROR ' : f.severity === 'warn' ? 'WARN  ' : 'INFO  ';
    console.log(`  ${tag}${f.id} ${f.message}`);
    if (f.fix) console.log(`         fix: ${f.fix}`);
  }
  return err.length;
}

function selfTest() {
  const dir = join(HERE, 'ocpp-fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    const kind = f.includes('.clean.') ? 'clean' : f.includes('.warns.') ? 'warns' : 'error';
    const prof = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const found = evaluate(prof);
    const hasErr = found.some((x) => x.severity === 'error');
    const hasWarn = found.some((x) => x.severity === 'warn');
    const ok = kind === 'error' ? hasErr : kind === 'warns' ? (!hasErr && hasWarn) : (!hasErr && !hasWarn);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${basename(f)}  (${kind})`);
    if (ok) {
      pass++;
      const first = found.find((x) => x.severity === 'error') ?? found.find((x) => x.severity === 'warn');
      if (first) console.log(`          ${first.id}: ${first.message.slice(0, 96)}`);
    } else { fail++; found.forEach((x) => console.log(`          ${x.severity} ${x.id} ${x.message.slice(0, 96)}`)); }
  }
  console.log(`\n  ${pass} passed, ${fail} failed  (${files.length} fixtures)`);
  return fail ? 1 : 0;
}


// Only act as a CLI when run directly. Without this guard, importing `evaluate`
// — which is the whole point of exporting it — also runs the argument parser and
// exits, so any tool that tried to reuse the rules would die on startup.
const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isEntry) { /* imported as a library */ }
else {
const argv = process.argv.slice(2);
if (argv.includes('--self-test')) process.exit(selfTest());
const strict = argv.includes('--strict');
const asJson = argv.includes('--json');
const files = argv.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node check-ocpp-cost.mjs [--strict] [--json] <profile.json> | --self-test');
  process.exit(2);
}
let bad = 0;
const results = [];
for (const f of files) {
  let findings = evaluate(JSON.parse(readFileSync(f, 'utf8')));
  if (strict) findings = findings.map((x) => (x.severity === 'warn' ? { ...x, severity: 'error' } : x));
  const errs = findings.filter((x) => x.severity === 'error').length;
  if (errs) bad++;
  results.push({ file: basename(f), errors: errs, findings });
  if (!asJson) report(findings, basename(f));
}
if (asJson) console.log(JSON.stringify({ strict, results }, null, 2));
process.exit(bad ? 1 : 0);
}

// Exported so other tooling can reuse the rules without shelling out — and so
// the fixture-coverage check can prove every rule is exercised by at least one
// fixture rather than taking that on trust.
export { evaluate };
