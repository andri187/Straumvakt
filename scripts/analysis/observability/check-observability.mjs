#!/usr/bin/env node
/**
 * Observability release gate — OB1..OB12.
 *
 * Companion to check-ocpp-cost.mjs. That checker proves the OCPP cost
 * shape; this one proves the estate can *see* whether that shape is
 * holding in production. The distinction matters: the heartbeat fast
 * path can regress silently, and the only thing that would notice is
 * the `heartbeats_received` / `heartbeats_suppressed` pair.
 *
 * Collect/evaluate split, same as the sibling checkers: `collect()`
 * touches the filesystem, `evaluate()` is pure, so fixtures exercise
 * the rules without a worktree. `node:` builtins only, no network, no
 * mutation.
 *
 * Usage:
 *   node check-observability.mjs [repoRoot]
 *   node check-observability.mjs --self-test
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** Reads the facts the rules need. Never throws on a missing file. */
export function collect(root) {
  const g = (p) => read(join(root, p));
  return {
    identityDo: g("gateway/src/identity-do.ts"),
    fastPath: g("gateway/src/heartbeat-fastpath.ts"),
    metrics: g("gateway/src/metrics.ts"),
    scrub: g("gateway/src/sentry-scrub.ts"),
    wrangler: g("gateway/wrangler.jsonc"),
    auth: g("gateway/src/auth.ts"),
    selftest: g("gateway/src/observability.selftest.mjs"),
  };
}

/**
 * A Sentry DSN. Deliberately matched on structure rather than on the
 * word "sentry": the danger is the credential, and it is recognisable
 * without the vendor name being nearby.
 */
const DSN_RE = /https:\/\/[0-9a-f]{8,}@[\w.-]*ingest[\w.-]*\.sentry\.io\/\d+/i;

export function evaluate(f) {
  const errors = [];
  const warnings = [];
  const err = (id, msg) => errors.push({ id, msg });
  const warn = (id, msg) => warnings.push({ id, msg });

  const doSrc = f.identityDo ? stripComments(f.identityDo) : null;
  const fpSrc = f.fastPath ? stripComments(f.fastPath) : null;

  // ── Carried forward from the cost lane, so this gate stands alone ──
  if (!fpSrc || !/export function bypassesIngest\s*\(/.test(fpSrc)) {
    err("OB1", "heartbeat fast path module missing bypassesIngest()");
  }
  if (!doSrc || !/if\s*\(\s*bypassesIngest\s*\(/.test(doSrc)) {
    err("OB2", "identity-do does not guard on bypassesIngest()");
  } else {
    // The guard must still reply. A guard that skipped both the queue
    // and the CallResult would satisfy a keyword search and stop cars
    // charging.
    const i = doSrc.split("\n").findIndex((l) => /if\s*\(\s*bypassesIngest\s*\(/.test(l));
    const body = doSrc.split("\n").slice(i, i + 6).join("\n");
    if (!/ws\.send\(serializeCallResult\(/.test(body)) {
      err("OB3", "fast path does not reply with a CallResult before returning");
    }
    if (!/\breturn\b/.test(body)) {
      err("OB4", "fast path guard does not return — the frame would fall through to ingest");
    }
  }
  if (!fpSrc || !/export function frameCapDecision\s*\(/.test(fpSrc)) {
    err("OB5", "per-connector frame cap missing");
  }

  // ── Phase 2 · BootNotification interval ──────────────────────────
  if (doSrc) {
    const m = /case\s+"BootNotification":[\s\S]{0,600}?interval:\s*([A-Za-z0-9_.]+)/.exec(doSrc);
    if (!m) {
      err("OB6", "BootNotification reply has no interval field");
    } else if (/^\d+$/.test(m[1])) {
      const literal = Number(m[1]);
      if (literal !== 3600) {
        err("OB6", `BootNotification interval is the literal ${literal}, not 3600 or config-driven`);
      } else {
        warn("OB6", "BootNotification interval is the literal 3600 — correct, but prefer the derived constant");
      }
    }
    // Config-driven is the preferred shape; require the resolver.
    if (!/resolveHeartbeatIntervalSeconds/.test(doSrc)) {
      warn("OB6", "interval is not routed through resolveHeartbeatIntervalSeconds()");
    }
  }
  if (fpSrc) {
    if (!/PRODUCT_HEARTBEAT_INTERVAL_SECONDS\s*=\s*3600/.test(fpSrc)) {
      err("OB7", "product heartbeat frame is not declared as 3600 s");
    }
    if (!/export function resolveHeartbeatIntervalSeconds\s*\(/.test(fpSrc)) {
      err("OB7", "no range-guarded interval resolver");
    }
  }

  // ── Phase 3 · Analytics Engine writer ────────────────────────────
  const REQUIRED_METRICS = [
    "heartbeats_received", "heartbeats_suppressed", "missed_heartbeats",
    "queue_messages_by_type", "noisy_charger_events", "gateway_errors_by_type",
    "billing_job_started", "billing_job_completed", "billing_job_failed",
  ];
  if (!f.metrics) {
    err("OB8", "gateway/src/metrics.ts missing — no Analytics Engine writer");
  } else {
    const missing = REQUIRED_METRICS.filter((m) => !f.metrics.includes(`"${m}"`));
    if (missing.length) err("OB8", `metrics writer missing: ${missing.join(", ")}`);
    if (!/createMetricsWriter/.test(f.metrics)) err("OB8", "no createMetricsWriter export");
    // No-op safety is the property that keeps telemetry off the
    // critical path; assert the guard and the swallow both exist.
    if (!/if\s*\(!enabled\)\s*return/.test(f.metrics)) {
      err("OB9", "metrics writer is not no-op safe when the binding is absent");
    }
    if (!/catch\s*\(/.test(f.metrics)) {
      err("OB9", "metrics writer does not swallow binding failures");
    }
    if (!/pseudonymiseIdentity/.test(f.metrics)) {
      err("OB10", "charger identity is not pseudonymised before write");
    }
    if (!/idtag/i.test(f.metrics)) {
      err("OB10", "metrics writer has no idTag guard");
    }
  }

  // ── Phase 4 · Sentry ─────────────────────────────────────────────
  if (!f.scrub) {
    err("OB11", "gateway/src/sentry-scrub.ts missing — no scrubber");
  } else {
    for (const fn of ["scrubEvent", "scrubOcppPayload", "scrubUrl", "sentryConfigFrom"]) {
      if (!new RegExp(`export function ${fn}\\s*\\(`).test(f.scrub)) {
        err("OB11", `scrubber missing ${fn}()`);
      }
    }
    if (!/OCPP_PAYLOAD_ALLOWLIST/.test(f.scrub)) {
      err("OB11", "OCPP payloads are not allowlisted — a new protocol field would leak by default");
    }
  }

  // A DSN literal anywhere is a committed credential.
  for (const [name, src] of Object.entries(f)) {
    // No carve-out for test files. A DSN-shaped literal is either a
    // credential or something a scanner will treat as one, and a
    // fixture that needs one can assemble it at runtime — as the
    // dsn-committed fixture below does.
    if (typeof src === "string" && DSN_RE.test(src)) {
      err("OB12", `Sentry DSN literal committed in ${name}`);
    }
  }

  // ── Bindings ─────────────────────────────────────────────────────
  if (!f.wrangler) {
    err("OB13", "gateway/wrangler.jsonc missing");
  } else {
    const live = stripComments(f.wrangler);
    if (!/analytics_engine_datasets/.test(live)) {
      err("OB14", "Analytics Engine binding not configured (placeholder present, still commented)");
    }
    if (!/version_metadata/.test(live)) {
      err("OB15", "version_metadata binding absent — no Sentry release id, no rollback target");
    }
    if (!/OBSERVABILITY-TODO/.test(f.wrangler) && /analytics_engine_datasets/.test(live) === false) {
      warn("OB14", "no OBSERVABILITY-TODO marker explaining the absent bindings");
    }
  }
  if (f.auth && !/OCPP_HEARTBEAT_INTERVAL_SECONDS/.test(f.auth)) {
    warn("OB7", "GatewayEnv does not declare the interval override");
  }

  return { errors, warnings };
}

// ── Fixtures ───────────────────────────────────────────────────────
const GOOD = {
  identityDo: `case "BootNotification": {
      const { seconds } = resolveHeartbeatIntervalSeconds(this.env.OCPP_HEARTBEAT_INTERVAL_SECONDS);
      return { status: "Accepted", currentTime: now, interval: seconds };
    }
    if (bypassesIngest(frame.action) && !live.emitTransition) {
      ws.send(serializeCallResult(frame.uniqueId, this.stubResponseFor(frame.action)));
      return;
    }`,
  fastPath: `export function bypassesIngest(a) {}
export function frameCapDecision(a) {}
export const PRODUCT_HEARTBEAT_INTERVAL_SECONDS = 3600;
export function resolveHeartbeatIntervalSeconds(raw) {}`,
  metrics: `"heartbeats_received","heartbeats_suppressed","missed_heartbeats","queue_messages_by_type","noisy_charger_events","gateway_errors_by_type","billing_job_started","billing_job_completed","billing_job_failed"
export function createMetricsWriter(b) { if (!enabled) return; try {} catch (e) {} }
export function pseudonymiseIdentity(i) {} const F = ["idtag"];`,
  scrub: `export function scrubEvent(e) {}
export function scrubOcppPayload(p) {}
export function scrubUrl(u) {}
export function sentryConfigFrom(env) {}
export const OCPP_PAYLOAD_ALLOWLIST = new Set([]);`,
  wrangler: `{ "analytics_engine_datasets": [], "version_metadata": {} }`,
  auth: `OCPP_HEARTBEAT_INTERVAL_SECONDS?: string;`,
  selftest: `ok`,
};
const mut = (over) => ({ ...GOOD, ...over });

const FIXTURES = [
  ["good.valid", GOOD, []],
  ["no-fastpath.invalid", mut({ fastPath: "export function frameCapDecision(a) {}\nexport const PRODUCT_HEARTBEAT_INTERVAL_SECONDS = 3600;\nexport function resolveHeartbeatIntervalSeconds(r) {}" }), ["OB1"]],
  ["no-guard.invalid", mut({ identityDo: GOOD.identityDo.replace(/if \(bypassesIngest[\s\S]*$/, "") }), ["OB2"]],
  ["guard-no-reply.invalid", mut({ identityDo: GOOD.identityDo.replace("ws.send(serializeCallResult(frame.uniqueId, this.stubResponseFor(frame.action)));", "") }), ["OB3"]],
  ["guard-no-return.invalid", mut({ identityDo: GOOD.identityDo.replace(/\n      return;/, "\n      /* no return here */") }), ["OB4"]],
  ["no-framecap.invalid", mut({ fastPath: GOOD.fastPath.replace("export function frameCapDecision(a) {}", "") }), ["OB5"]],
  ["interval-60.invalid", mut({ identityDo: `case "BootNotification":\n return { status: "Accepted", interval: 60 };\n` + GOOD.identityDo }), ["OB6"]],
  ["interval-3600-literal.warns", mut({ identityDo: `case "BootNotification":\n return { interval: 3600 };\n` + GOOD.identityDo }), []],
  ["no-resolver.invalid", mut({ fastPath: GOOD.fastPath.replace("export function resolveHeartbeatIntervalSeconds(raw) {}", "") }), ["OB7"]],
  ["no-3600-const.invalid", mut({ fastPath: GOOD.fastPath.replace("= 3600;", "= 60;") }), ["OB7"]],
  ["no-metrics.invalid", mut({ metrics: null }), ["OB8"]],
  ["missing-metric.invalid", mut({ metrics: GOOD.metrics.replace('"heartbeats_suppressed",', "") }), ["OB8"]],
  ["metrics-not-noop.invalid", mut({ metrics: GOOD.metrics.replace("if (!enabled) return;", "") }), ["OB9"]],
  ["metrics-no-pseudonym.invalid", mut({ metrics: GOOD.metrics.replace("export function pseudonymiseIdentity(i) {}", "") }), ["OB10"]],
  ["no-scrubber.invalid", mut({ scrub: null }), ["OB11"]],
  ["scrubber-no-allowlist.invalid", mut({ scrub: GOOD.scrub.replace("export const OCPP_PAYLOAD_ALLOWLIST = new Set([]);", "") }), ["OB11"]],
  // Assembled at runtime, never written as a literal: a DSN-shaped
  // string in the tree trips every other secret scanner that looks at
  // this repository, including this rule if the checker were ever fed
  // to itself. The fixture still presents a complete DSN to evaluate().
  ["dsn-committed.invalid", mut({ auth: `const dsn = "${["https://", "abcdef0123456789", "@o99.", "ingest", ".sentry.io/4"].join("")}";\n` + GOOD.auth }), ["OB12"]],
  ["no-ae-binding.invalid", mut({ wrangler: `{ "version_metadata": {} }` }), ["OB14"]],
  ["no-version-metadata.invalid", mut({ wrangler: `{ "analytics_engine_datasets": [] }` }), ["OB15"]],
  ["ae-commented-only.invalid", mut({ wrangler: `{ /* OBSERVABILITY-TODO "analytics_engine_datasets": [] */ "version_metadata": {} }` }), ["OB14"]],
];

function selfTest() {
  let pass = 0, fail = 0;
  for (const [name, fx, expected] of FIXTURES) {
    const { errors } = evaluate(fx);
    const ids = [...new Set(errors.map((e) => e.id))].sort();
    const want = [...expected].sort();
    const ok = name.endsWith(".valid")
      ? ids.length === 0
      : name.endsWith(".warns")
        ? ids.length === 0
        : want.every((w) => ids.includes(w)) && ids.length === want.length;
    if (ok) pass++;
    else { fail++; console.log(`  FAIL ${name}: expected [${want}], got [${ids}]`); }
  }
  console.log(`\n  observability self-test: ${pass} passed, ${fail} failed (${FIXTURES.length} fixtures)`);
  return fail === 0;
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  if (process.argv.includes("--self-test")) {
    process.exitCode = selfTest() ? 0 : 1;
  } else {
    const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
    const { errors, warnings } = evaluate(collect(root));
    console.log(`observability gate — ${root}`);
    for (const w of warnings) console.log(`  WARN  ${w.id}  ${w.msg}`);
    for (const e of errors) console.log(`  ERROR ${e.id}  ${e.msg}`);
    console.log(`\n  ${errors.length} errors, ${warnings.length} warnings`);
    process.exitCode = errors.length === 0 ? 0 : 1;
  }
}
