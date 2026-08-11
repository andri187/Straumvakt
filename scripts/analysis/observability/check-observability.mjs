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

/** JSONC → JSON, string-aware so a `//` inside a value survives. */
function stripJsonc(text) {
  let out = "", inStr = false, esc = false, line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (line) { if (c === "\n") { line = false; out += c; } continue; }
    if (block) { if (c === "*" && n === "/") { block = false; i++; } continue; }
    if (inStr) { out += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { line = true; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Flattens a wrangler config into one node per deployable environment.
 * Every gate below reasons per environment, because "the binding is
 * declared" was true of this estate while production had no queue at
 * all — the question is always *which environment*.
 */
export function environmentsOf(raw) {
  if (!raw) return null;
  let cfg;
  try { cfg = JSON.parse(stripJsonc(raw)); } catch { return null; }
  const out = { "top-level": { ...cfg } };
  delete out["top-level"].env;
  for (const [name, node] of Object.entries(cfg.env ?? {})) out[name] = node;
  return out;
}

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
    ingestClient: g("gateway/src/ingest-client.ts"),
    configs: {
      "gateway/wrangler.jsonc": environmentsOf(g("gateway/wrangler.jsonc")),
      "apps/api/wrangler.jsonc": environmentsOf(g("apps/api/wrangler.jsonc")),
      "wrangler.jsonc": environmentsOf(g("wrangler.jsonc")),
    },
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

  // ── OB16..OB24 · per-environment deployed shape ──────────────────
  //
  // Every rule here reasons per environment. The estate this checker
  // was written against had a queue producer declared — in staging
  // only — while the top-level Worker had none, and the existing
  // "queue producer declared" gate passed on it. A binding that exists
  // in one environment tells you nothing about another.
  const gw = f.configs?.["gateway/wrangler.jsonc"];
  const api = f.configs?.["apps/api/wrangler.jsonc"];

  if (gw) {
    for (const [envName, node] of Object.entries(gw)) {
      const producers = node?.queues?.producers ?? [];
      if (!producers.some((p) => p.binding === "OCPP_EVENTS_QUEUE")) {
        err("OB16", `gateway env "${envName}" (${node?.name ?? "?"}) has no OCPP_EVENTS_QUEUE producer — every event takes the synchronous service-binding fallback, with no DLQ`);
      }
    }
  }
  if (api) {
    for (const [envName, node] of Object.entries(api)) {
      const consumers = node?.queues?.consumers ?? [];
      const ocpp = consumers.find((c) => /ocpp-events/.test(c.queue ?? ""));
      if (!ocpp) {
        err("OB17", `api env "${envName}" (${node?.name ?? "?"}) consumes no OCPP events queue`);
      } else if (!ocpp.dead_letter_queue) {
        err("OB17", `api env "${envName}" consumes ${ocpp.queue} with no dead_letter_queue — a failed event is lost, not parked`);
      }
      // R2 is where statements, exports and debug bundles land.
      if (!(node?.r2_buckets ?? []).length) {
        warn("OB20", `api env "${envName}" declares no R2 bucket — exports and debug bundles have nowhere to go`);
      }
    }
  }

  // Pinned-host foot-gun, per environment: a config that declares
  // neither `routes` nor `workers_dev` will infer workers_dev=false the
  // moment a route is added, removing a host a shipped client pins.
  for (const [file, envs] of Object.entries(f.configs ?? {})) {
    if (!envs) continue;
    for (const [envName, node] of Object.entries(envs)) {
      const declaresRoute = node?.routes !== undefined || node?.route !== undefined;
      const declaresWd = node?.workers_dev !== undefined;
      // `workers_dev` and `routes` ARE inheritable, so a named env with
      // neither inherits the top level rather than being undeclared.
      const inherited = envName !== "top-level" &&
        (envs["top-level"]?.workers_dev !== undefined || envs["top-level"]?.routes !== undefined);
      if (!declaresRoute && !declaresWd && !inherited) {
        err("OB19", `${file} [${envName} ${node?.name ?? "?"}] declares neither routes nor workers_dev — adding a route would infer workers_dev=false and remove the pinned host`);
      }
    }
  }

  // Workflows: absent is a decision only if something else schedules
  // the billing/report jobs and something alerts when they fail.
  const anyWorkflows = Object.values(f.configs ?? {}).some(
    (envs) => envs && Object.values(envs).some((n) => n?.workflows),
  );
  const anyCron = Object.values(f.configs ?? {}).some(
    (envs) => envs && Object.values(envs).some((n) => n?.triggers?.crons?.length),
  );
  if (!anyWorkflows && !anyCron) {
    err("OB21", "no Workflows and no cron triggers anywhere — billing/report jobs have no declared scheduler, so 'Workflows absent' is a gap rather than a decision");
  }

  // Cloudflare Access for internal/ops tools.
  const anyAccess = Object.values(f.configs ?? {}).some(
    (envs) => envs && Object.values(envs).some(
      (n) => JSON.stringify(n ?? {}).match(/access|zero_trust|CF_Authorization/i),
    ),
  );
  if (!anyAccess) {
    warn("OB22", "no Cloudflare Access configuration found — internal/ops tools are unprotected");
  }

  // Cost model gate: an idle interval below the product frame must
  // report its multiplier, not merely fail.
  if (doSrc) {
    const m = /case\s+"BootNotification":[\s\S]{0,600}?interval:\s*(\d+)/.exec(doSrc);
    if (m) {
      const s = Number(m[1]);
      if (s > 0 && s < 3600) {
        err("OB23", `idle heartbeat interval ${s}s is below the 3600s product frame — monthly frames per connector rise ${Math.round(3600 / s)}x, from 720 to ${Math.round(720 * (3600 / s)).toLocaleString("en-US")}`);
      }
    }
  }

  // Deployment evidence: rollback-safety is a recorded fact, not a
  // property of the code.
  if (gw) {
    const anyVersionMeta = Object.values(gw).some((n) => n?.version_metadata);
    if (!anyVersionMeta) {
      err("OB24", "no version_metadata binding in any gateway environment — a release cannot be marked rollback-safe because no version id can be captured");
    }
  }

  // ── OB25..OB27 · runtime signal quality ──────────────────────────
  if (doSrc) {
    // A cap breach that only reaches console is invisible to every
    // dashboard; the locked architecture calls noisy-charger detection
    // Core, which means it needs a metric or an event, not a log line.
    const breachLogged = /frame_cap\.breached/.test(doSrc);
    const breachMetered = /noisy_charger_events/.test(doSrc);
    if (breachLogged && !breachMetered) {
      warn("OB25", "frame cap breach is logged but never recorded as a metric or event — nothing aggregates it");
    }
    if (!breachLogged) {
      err("OB25", "frame cap breach produces no signal at all");
    }
    // Missed heartbeat: liveness is computed only when a frame
    // arrives, so a charger that dies silently is never reported.
    // Anchored on the alarm *method*, case-insensitively, and without
    // relying on a comment: `doSrc` has comments stripped, so a rule
    // that matched a `/* missed_heartbeat */` note would pass on an
    // empty handler. It must see a real reference in live code.
    const hasLivenessSweeper =
      /async\s+alarm\s*\([\s\S]{0,3000}?(liveness|missed[_ ]?heartbeat|expectedNextHeartbeat)/i.test(doSrc);
    if (!hasLivenessSweeper) {
      err("OB18", "no liveness sweeper — offline is detected only on the next inbound frame, so a charger that goes silent produces no event; the existing DO alarm is the outbound-command timeout sweep");
    }
  }
  if (f.metrics) {
    // Comments are stripped first. The unstripped version of this rule
    // fired on metrics.ts's own comment explaining that it is
    // "deliberately not Record<string, string>" — a rule that reads a
    // note about a defect as the defect itself. Same class of bug that
    // mutation testing found in the OCPP fast-path collector.
    const metSrc = stripComments(f.metrics);
    // The vocabulary must be closed at the type level AND at runtime.
    if (!/MetricName\s*=\s*\n?\s*\|/.test(metSrc) && !/type MetricName/.test(metSrc)) {
      err("OB26", "metric names are not a closed union type");
    }
    if (/Record<string,\s*string>/.test(metSrc)) {
      err("OB26", "metrics accept a free-form string bag — that is how an idTag reaches telemetry");
    }
  }
  if (f.scrub) {
    // Denylist coverage for the fields this product actually carries.
    for (const key of ["idtag", "authorization", "password", "token", "kennitala", "cookie"]) {
      if (!new RegExp(`"${key}"`, "i").test(f.scrub)) {
        err("OB27", `scrubber denylist is missing "${key}"`);
      }
    }
    if (!/depth\s*>\s*\d+/.test(f.scrub)) {
      err("OB27", "scrubber has no depth bound — a cyclic structure would hang the error path");
    }
  }

  return { errors, warnings };
}

// ── Fixtures ───────────────────────────────────────────────────────

/** A wrangler config shaped the way the gates want it. */
const okGatewayCfg = (over = {}) => ({
  "top-level": {
    name: "straumvakt-ocpp", workers_dev: true,
    queues: { producers: [{ binding: "OCPP_EVENTS_QUEUE", queue: "straumvakt-ocpp-events" }] },
    version_metadata: { binding: "CF_VERSION_METADATA" },
    triggers: { crons: ["0 3 * * *"] },
    ...over,
  },
  staging: {
    name: "straumvakt-ocpp-staging", workers_dev: true,
    queues: { producers: [{ binding: "OCPP_EVENTS_QUEUE", queue: "straumvakt-ocpp-events-staging" }] },
    version_metadata: { binding: "CF_VERSION_METADATA" },
    ...(over.stagingOver ?? {}),
  },
});
const okApiCfg = (over = {}) => ({
  "top-level": {
    name: "hlada-api", workers_dev: true,
    queues: { consumers: [{ queue: "straumvakt-ocpp-events", dead_letter_queue: "straumvakt-ocpp-events-dlq" }] },
    r2_buckets: [{ binding: "EVIDENCE_BUCKET", bucket_name: "straumvakt-evidence" }],
    access: { app: "internal" },
    ...over,
  },
});
const GOOD_CONFIGS = {
  "gateway/wrangler.jsonc": okGatewayCfg(),
  "apps/api/wrangler.jsonc": okApiCfg(),
};

const GOOD = {
  configs: GOOD_CONFIGS,
  ingestClient: `if (env.OCPP_EVENTS_QUEUE) { await env.OCPP_EVENTS_QUEUE.send(event); }`,
  identityDo: `case "BootNotification": {
      const { seconds } = resolveHeartbeatIntervalSeconds(this.env.OCPP_HEARTBEAT_INTERVAL_SECONDS);
      return { status: "Accepted", currentTime: now, interval: seconds };
    }
    if (bypassesIngest(frame.action) && !live.emitTransition) {
      ws.send(serializeCallResult(frame.uniqueId, this.stubResponseFor(frame.action)));
      return;
    }
    console.warn("[ocpp-gw] frame_cap.breached", { identity });
    metrics.count("noisy_charger_events", { identity });
    async alarm() { this.sweepLiveness(); /* missed_heartbeat */ }`,
  fastPath: `export function bypassesIngest(a) {}
export function frameCapDecision(a) {}
export const PRODUCT_HEARTBEAT_INTERVAL_SECONDS = 3600;
export function resolveHeartbeatIntervalSeconds(raw) {}`,
  metrics: `type MetricName = "heartbeats_received" | "x";
"heartbeats_received","heartbeats_suppressed","missed_heartbeats","queue_messages_by_type","noisy_charger_events","gateway_errors_by_type","billing_job_started","billing_job_completed","billing_job_failed"
export function createMetricsWriter(b) { if (!enabled) return; try {} catch (e) {} }
export function pseudonymiseIdentity(i) {} const F = ["idtag"];`,
  scrub: `export function scrubEvent(e) {}
export function scrubOcppPayload(p) {}
export function scrubUrl(u) {}
export function sentryConfigFrom(env) {}
export const OCPP_PAYLOAD_ALLOWLIST = new Set([]);
const DENY = ["idtag","authorization","password","token","kennitala","cookie"];
if (depth > 8) return REDACTED;`,
  wrangler: `{ "analytics_engine_datasets": [], "version_metadata": {} }`,
  auth: `OCPP_HEARTBEAT_INTERVAL_SECONDS?: string;`,
  selftest: `ok`,
};
const mut = (over) => ({ ...GOOD, ...over });

const FIXTURES = [
  ["good.valid", GOOD, []],
  ["no-fastpath.invalid", mut({ fastPath: "export function frameCapDecision(a) {}\nexport const PRODUCT_HEARTBEAT_INTERVAL_SECONDS = 3600;\nexport function resolveHeartbeatIntervalSeconds(r) {}" }), ["OB1"]],
  // Renames the guard rather than truncating the file: truncating also
  // removed the cap-breach lines and the alarm, so the fixture failed
  // for three reasons at once and proved nothing about OB2.
  ["no-guard.invalid", mut({ identityDo: GOOD.identityDo.replace("if (bypassesIngest(", "if (someOtherPredicate(") }), ["OB2"]],
  ["guard-no-reply.invalid", mut({ identityDo: GOOD.identityDo.replace("ws.send(serializeCallResult(frame.uniqueId, this.stubResponseFor(frame.action)));", "") }), ["OB3"]],
  ["guard-no-return.invalid", mut({ identityDo: GOOD.identityDo.replace(/\n      return;/, "\n      /* no return here */") }), ["OB4"]],
  ["no-framecap.invalid", mut({ fastPath: GOOD.fastPath.replace("export function frameCapDecision(a) {}", "") }), ["OB5"]],
  // 60 trips both the shape rule and the cost-multiplier rule; that is
  // correct, and the expectation records both rather than hiding one.
  ["interval-60.invalid", mut({ identityDo: `case "BootNotification":\n return { status: "Accepted", interval: 60 };\n` + GOOD.identityDo }), ["OB6", "OB23"]],
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

  // ── OB16 · queue producer, per environment ───────────────────────
  // The case that motivated the whole per-environment rewrite: a
  // producer in staging and none top-level, which the old
  // "producer declared" gate passed.
  ["queue-producer-missing-toplevel.invalid", mut({
    configs: { ...GOOD_CONFIGS, "gateway/wrangler.jsonc": { ...okGatewayCfg(), "top-level": { ...okGatewayCfg()["top-level"], queues: undefined } } },
  }), ["OB16"]],
  ["queue-producer-missing-staging.invalid", mut({
    configs: { ...GOOD_CONFIGS, "gateway/wrangler.jsonc": { ...okGatewayCfg(), staging: { ...okGatewayCfg().staging, queues: undefined } } },
  }), ["OB16"]],
  ["queue-producer-wrong-binding.invalid", mut({
    configs: { ...GOOD_CONFIGS, "gateway/wrangler.jsonc": { ...okGatewayCfg(), "top-level": { ...okGatewayCfg()["top-level"], queues: { producers: [{ binding: "SOMETHING_ELSE", queue: "q" }] } } } },
  }), ["OB16"]],
  ["queue-producer-both-envs.valid", mut({}), []],

  // ── OB17 · consumer + DLQ ────────────────────────────────────────
  ["consumer-missing.invalid", mut({
    configs: { ...GOOD_CONFIGS, "apps/api/wrangler.jsonc": { "top-level": { ...okApiCfg()["top-level"], queues: undefined } } },
  }), ["OB17"]],
  ["consumer-without-dlq.invalid", mut({
    configs: { ...GOOD_CONFIGS, "apps/api/wrangler.jsonc": { "top-level": { ...okApiCfg()["top-level"], queues: { consumers: [{ queue: "straumvakt-ocpp-events" }] } } } },
  }), ["OB17"]],
  ["consumer-unrelated-queue.invalid", mut({
    configs: { ...GOOD_CONFIGS, "apps/api/wrangler.jsonc": { "top-level": { ...okApiCfg()["top-level"], queues: { consumers: [{ queue: "straumvakt-outbound", dead_letter_queue: "d" }] } } } },
  }), ["OB17"]],

  // ── OB18 · liveness sweeper ──────────────────────────────────────
  ["no-liveness-sweeper.invalid", mut({ identityDo: GOOD.identityDo.replace("async alarm() { this.sweepLiveness(); /* missed_heartbeat */ }", "async alarm() { this.sweepOutboundTimeouts(); }") }), ["OB18"]],
  ["sweeper-present.valid", mut({}), []],

  // ── OB19 · pinned-host foot-gun, per environment ─────────────────
  ["no-routes-no-workersdev.invalid", mut({
    configs: { "gateway/wrangler.jsonc": { "top-level": { ...okGatewayCfg()["top-level"], workers_dev: undefined } }, "apps/api/wrangler.jsonc": okApiCfg() },
  }), ["OB19"]],
  ["routes-declared-instead.valid", mut({
    configs: { "gateway/wrangler.jsonc": okGatewayCfg({ workers_dev: undefined, routes: [{ pattern: "a.b", custom_domain: true }] }), "apps/api/wrangler.jsonc": okApiCfg() },
  }), []],
  // workers_dev and routes ARE inheritable — a named env declaring
  // neither is covered by the top level, and must NOT be flagged.
  ["env-inherits-workersdev.valid", mut({
    configs: { "gateway/wrangler.jsonc": { "top-level": okGatewayCfg()["top-level"], staging: { name: "s", queues: { producers: [{ binding: "OCPP_EVENTS_QUEUE", queue: "q" }] }, version_metadata: {} } }, "apps/api/wrangler.jsonc": okApiCfg() },
  }), []],

  // ── OB20 · R2 (warning, not error) ───────────────────────────────
  ["no-r2-bucket.warns", mut({
    configs: { ...GOOD_CONFIGS, "apps/api/wrangler.jsonc": { "top-level": { ...okApiCfg()["top-level"], r2_buckets: [] } } },
  }), []],

  // ── OB21 · scheduler for billing/report jobs ─────────────────────
  ["no-workflows-no-cron.invalid", mut({
    configs: { "gateway/wrangler.jsonc": okGatewayCfg({ triggers: undefined }), "apps/api/wrangler.jsonc": okApiCfg() },
  }), ["OB21"]],
  ["workflows-present.valid", mut({
    configs: { "gateway/wrangler.jsonc": okGatewayCfg({ triggers: undefined, workflows: [{ name: "billing" }] }), "apps/api/wrangler.jsonc": okApiCfg() },
  }), []],
  ["cron-present.valid", mut({}), []],

  // ── OB22 · Access (warning) ──────────────────────────────────────
  ["no-access.warns", mut({
    configs: { ...GOOD_CONFIGS, "apps/api/wrangler.jsonc": { "top-level": { ...okApiCfg()["top-level"], access: undefined } } },
  }), []],

  // ── OB23 · cost multiplier reporting ─────────────────────────────
  ["interval-60-reports-multiplier.invalid", mut({ identityDo: `case "BootNotification": return { interval: 60 };\n` + GOOD.identityDo }), ["OB6", "OB23"]],
  ["interval-300-reports-multiplier.invalid", mut({ identityDo: `case "BootNotification": return { interval: 300 };\n` + GOOD.identityDo }), ["OB6", "OB23"]],
  ["interval-3600-no-multiplier.warns", mut({ identityDo: `case "BootNotification": return { interval: 3600 };\n` + GOOD.identityDo }), []],
  // Above the frame is still a literal, so OB6 fires — but OB23 must
  // NOT, because a longer interval cannot raise cost.
  ["interval-7200-above-frame.invalid", mut({ identityDo: `case "BootNotification": return { interval: 7200 };\n` + GOOD.identityDo }), ["OB6"]],

  // ── OB24 · deployment evidence ───────────────────────────────────
  ["no-version-metadata-any-env.invalid", mut({
    configs: { "gateway/wrangler.jsonc": { "top-level": { ...okGatewayCfg()["top-level"], version_metadata: undefined }, staging: { ...okGatewayCfg().staging, version_metadata: undefined } }, "apps/api/wrangler.jsonc": okApiCfg() },
  }), ["OB24"]],
  ["version-metadata-one-env-enough.valid", mut({
    configs: { "gateway/wrangler.jsonc": { "top-level": okGatewayCfg()["top-level"], staging: { ...okGatewayCfg().staging, version_metadata: undefined } }, "apps/api/wrangler.jsonc": okApiCfg() },
  }), []],

  // ── OB25 · noisy charger signal quality ──────────────────────────
  ["cap-breach-log-only.warns", mut({ identityDo: GOOD.identityDo.replace(`metrics.count("noisy_charger_events", { identity });`, "") }), []],
  ["cap-breach-no-signal.invalid", mut({ identityDo: GOOD.identityDo.replace(`console.warn("[ocpp-gw] frame_cap.breached", { identity });`, "").replace(`metrics.count("noisy_charger_events", { identity });`, "") }), ["OB25"]],

  // ── OB26 · metric vocabulary closure ─────────────────────────────
  ["metrics-open-vocabulary.invalid", mut({ metrics: GOOD.metrics.replace('type MetricName = "heartbeats_received" | "x";', "") }), ["OB26"]],
  ["metrics-free-form-bag.invalid", mut({ metrics: GOOD.metrics + `\nexport interface Dims extends Record<string, string> {}` }), ["OB26"]],

  // ── OB27 · scrubber denylist coverage + bounds ───────────────────
  ["scrub-missing-idtag.invalid", mut({ scrub: GOOD.scrub.replace('"idtag",', "") }), ["OB27"]],
  ["scrub-missing-kennitala.invalid", mut({ scrub: GOOD.scrub.replace('"kennitala",', "") }), ["OB27"]],
  ["scrub-missing-authorization.invalid", mut({ scrub: GOOD.scrub.replace('"authorization",', "") }), ["OB27"]],
  ["scrub-missing-cookie.invalid", mut({ scrub: GOOD.scrub.replace('"cookie"', "") }), ["OB27"]],
  ["scrub-missing-token.invalid", mut({ scrub: GOOD.scrub.replace('"token",', "") }), ["OB27"]],
  ["scrub-missing-password.invalid", mut({ scrub: GOOD.scrub.replace('"password",', "") }), ["OB27"]],
  ["scrub-no-depth-bound.invalid", mut({ scrub: GOOD.scrub.replace("if (depth > 8) return REDACTED;", "") }), ["OB27"]],
  ["scrub-complete.valid", mut({}), []],

  // ── Absent-input safety ──────────────────────────────────────────
  // A checker that silently passes on a missing tree is worse than no
  // checker, so absent configs must still produce the config errors.
  ["configs-absent.invalid", mut({ configs: undefined }), ["OB21"]],
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
