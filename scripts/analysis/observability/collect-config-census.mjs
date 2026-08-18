#!/usr/bin/env node
/**
 * Config / deployed-shape census collector.
 *
 * Walks every wrangler config plus the gateway source surface and emits
 * one row per configuration fact. The point is that the census is
 * *derived*, not recalled: a row exists because a key exists, so the
 * table cannot drift from the tree the way a hand-written inventory
 * does.
 *
 * Impact columns (cost / release / rollback / blocker) are judgement,
 * so they come from an explicit annotation map keyed by product and by
 * specific key path. Unannotated rows fall back to the product default
 * and are marked so, rather than silently inheriting a guess.
 *
 * `node:` builtins only. Read-only. Emits JSON on stdout; `--md`
 * emits the markdown table.
 *
 * Usage:
 *   node collect-config-census.mjs [--repo <path>] [--md]
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const REPO = resolve(val("--repo") ?? join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", ".."));

/** JSONC → JSON. String-aware so a `//` inside a value survives. */
export function stripJsonc(text) {
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
 * Keys that are NOT inherited into a named environment. Verified
 * against Cloudflare docs: `workers_dev`, `route`, `routes` ARE
 * inheritable; every binding type is not. This project has already
 * produced one incorrect finding from getting this backwards.
 */
export const NON_INHERITABLE = [
  "define", "vars", "durable_objects", "kv_namespaces", "r2_buckets", "d1_databases",
  "services", "queues", "workflows", "hyperdrive", "vectorize", "ai", "browser",
  "send_email", "mtls_certificates", "analytics_engine_datasets", "tail_consumers",
  "version_metadata", "unsafe", "ai_search", "ai_search_namespaces", "pipelines",
  "secrets", "secrets_store_secrets",
];

const PRODUCT_OF = {
  durable_objects: "Durable Object", migrations: "Durable Object",
  queues: "Queue", services: "Worker", vars: "Worker",
  analytics_engine_datasets: "Analytics Engine", version_metadata: "Worker",
  r2_buckets: "R2", workflows: "Workflows", observability: "Cloudflare observability",
  routes: "DNS/domain", route: "DNS/domain", workers_dev: "DNS/domain",
  name: "Worker", main: "Worker", compatibility_date: "Worker",
  compatibility_flags: "Worker", account_id: "Worker", $schema: "unknown",
  placement: "Worker", limits: "Worker", triggers: "Worker",
  assets: "Pages", pages_build_output_dir: "Pages",
  kv_namespaces: "Workers KV", d1_databases: "D1", hyperdrive: "Hyperdrive",
  send_email: "Email", browser: "Browser", ai: "Workers AI",
  tail_consumers: "Cloudflare observability", secrets_store_secrets: "Secrets Store",
};

/** Judgement annotations. Keyed by `product` then overridden by key path. */
const IMPACT_BY_PRODUCT = {
  "Durable Object":         { cost: "high — per-object wakeups + duration", release: "class name is a migration boundary", rollback: "migrations are not reversible in place", blocker: "no" },
  "Queue":                  { cost: "high — per-message op",                release: "binding must exist per environment",  rollback: "in-flight messages survive a rollback", blocker: "no" },
  "Analytics Engine":       { cost: "low — sampled writes",                 release: "absent binding = no cost attribution", rollback: "additive, safe to remove", blocker: "yes" },
  "Worker":                 { cost: "medium — request + CPU",               release: "name change creates a new Worker",     rollback: "redeploy previous version", blocker: "no" },
  "DNS/domain":             { cost: "none directly",                        release: "can remove a pinned host",             rollback: "re-add route; DNS TTL delay", blocker: "yes" },
  "R2":                     { cost: "low — storage + class A/B ops",        release: "bucket must exist before first write", rollback: "objects persist", blocker: "no" },
  "Workflows":              { cost: "medium — per-step",                    release: "absent today",                         rollback: "n/a", blocker: "no" },
  "Cloudflare observability": { cost: "low — log volume",                   release: "enabling is additive",                 rollback: "toggle off", blocker: "no" },
  "Pages":                  { cost: "low",                                  release: "build output path",                    rollback: "redeploy", blocker: "no" },
  "Workers KV":             { cost: "low — read/write ops",                 release: "namespace id per environment",         rollback: "data persists", blocker: "no" },
  "D1":                     { cost: "low",                                  release: "rejected for Core business truth",     rollback: "n/a", blocker: "no" },
  "Secrets Store":          { cost: "none",                                 release: "secret names only in config",          rollback: "re-set secret", blocker: "no" },
  "unknown":                { cost: "none",                                 release: "none",                                 rollback: "none", blocker: "no" },
};

const IMPACT_BY_KEY = {
  "queues.producers":        { cost: "high — every enqueue is a billed op; the heartbeat fast path exists to keep this near zero", blocker: "no" },
  "analytics_engine_datasets": { cost: "low, but its ABSENCE costs visibility into the 60x heartbeat risk", release: "Core release expects metrics", rollback: "additive", blocker: "yes" },
  "version_metadata":        { cost: "none", release: "without it there is no version id and no rollback target", rollback: "THIS IS the rollback mechanism", blocker: "yes" },
  "workers_dev":            { cost: "none", release: "undeclared + routes added ⇒ inferred false ⇒ pinned host disappears", rollback: "re-declare and redeploy; shipped mobile clients cannot be fixed server-side", blocker: "yes" },
  "durable_objects.bindings": { cost: "high — one object per charger identity, billed on wakeup and duration", blocker: "no" },
  "services":                { cost: "medium — a synchronous Worker-to-Worker hop per call", release: "target Worker must exist in the same environment", rollback: "redeploy", blocker: "no" },
  "observability":           { cost: "low — but log volume scales with frame volume", blocker: "no" },
  "migrations":              { cost: "none", release: "a new_sqlite_classes tag is one-way", rollback: "cannot be undone in place — this is the sharpest edge in the file", blocker: "no" },
};

function walkConfig(rel, absPath, rows) {
  const raw = readFileSync(absPath, "utf8");
  let cfg;
  try { cfg = JSON.parse(stripJsonc(raw)); }
  catch (e) { rows.push({ file: rel, key: "<parse>", product: "unknown", env: "unknown", shape: `PARSE ERROR: ${e.message}`, inheritance: "-", blocker: "yes" }); return; }

  const emit = (key, node, envName) => {
    const product = PRODUCT_OF[key] ?? "unknown";
    const base = IMPACT_BY_PRODUCT[product] ?? IMPACT_BY_PRODUCT.unknown;
    const over = IMPACT_BY_KEY[key] ?? {};
    const nonInh = NON_INHERITABLE.includes(key);
    rows.push({
      file: rel,
      key: envName === "top-level" ? key : `env.${envName}.${key}`,
      symbol: key,
      product,
      env: envName,
      shape: shapeOf(node),
      inheritance: nonInh
        ? "NOT inherited into named envs — must be redeclared"
        : "inherited into named envs unless overridden",
      cost: over.cost ?? base.cost,
      release: over.release ?? base.release,
      rollback: over.rollback ?? base.rollback,
      blocker: over.blocker ?? base.blocker,
      annotated: (key in IMPACT_BY_KEY) ? "keyed" : (product in IMPACT_BY_PRODUCT ? "product-default" : "none"),
      evidence: `${rel}:${key}`,
    });
    // One extra row per binding entry, so each binding is its own fact.
    if (key === "durable_objects" && node?.bindings) {
      for (const b of node.bindings) rows.push(bindingRow(rel, envName, "Durable Object", `${b.name} → ${b.class_name}`, key));
    }
    if (key === "queues" && node?.producers) {
      for (const p of node.producers) rows.push(bindingRow(rel, envName, "Queue", `producer ${p.binding} → ${p.queue}`, key));
    }
    if (key === "queues" && node?.consumers) {
      for (const c of node.consumers) rows.push(bindingRow(rel, envName, "Queue", `consumer ← ${c.queue} (dlq ${c.dead_letter_queue ?? "none"})`, key));
    }
    if (key === "services") {
      for (const s of node) rows.push(bindingRow(rel, envName, "Worker", `service ${s.binding} → ${s.service}`, key));
    }
    if (key === "r2_buckets") {
      for (const b of node) rows.push(bindingRow(rel, envName, "R2", `${b.binding} → ${b.bucket_name}`, key));
    }
    if (key === "vars") {
      for (const [k, v] of Object.entries(node)) rows.push(bindingRow(rel, envName, "Worker", `var ${k} = ${shapeOf(v)}`, key));
    }
    if (key === "migrations") {
      for (const m of node) rows.push(bindingRow(rel, envName, "Durable Object", `migration ${m.tag}: ${JSON.stringify(m.new_sqlite_classes ?? m.new_classes ?? [])}`, key));
    }
  };

  for (const [k, v] of Object.entries(cfg)) {
    if (k === "env") continue;
    emit(k, v, "top-level");
  }
  for (const [envName, envCfg] of Object.entries(cfg.env ?? {})) {
    for (const [k, v] of Object.entries(envCfg)) emit(k, v, envName);
    // Inheritance gaps: a non-inheritable key present at top level but
    // absent from this env is a real deployed-shape difference.
    for (const k of Object.keys(cfg)) {
      if (k === "env" || !NON_INHERITABLE.includes(k)) continue;
      if (!(k in envCfg)) {
        rows.push({
          file: rel, key: `env.${envName}.${k}`, symbol: k,
          product: PRODUCT_OF[k] ?? "unknown", env: envName,
          shape: "ABSENT — present at top level, not inherited",
          inheritance: "NOT inherited — this env does not have it",
          cost: "n/a", release: `${k} exists in top-level but NOT in env.${envName}`,
          rollback: "n/a", blocker: k === "queues" || k === "durable_objects" ? "yes" : "no",
          annotated: "derived", evidence: `${rel}:env.${envName} missing ${k}`,
        });
      }
    }
  }
}

const bindingRow = (file, env, product, shape, parent) => ({
  file, key: `${env === "top-level" ? "" : `env.${env}.`}${parent}[]`, symbol: parent,
  product, env, shape,
  inheritance: "NOT inherited into named envs — must be redeclared",
  cost: (IMPACT_BY_KEY[parent] ?? IMPACT_BY_PRODUCT[product] ?? {}).cost ?? "-",
  release: (IMPACT_BY_PRODUCT[product] ?? {}).release ?? "-",
  rollback: (IMPACT_BY_PRODUCT[product] ?? {}).rollback ?? "-",
  blocker: "no", annotated: "binding-entry", evidence: `${file}:${parent}`,
});

function shapeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === "object") return `{${Object.keys(v).join(", ")}}`;
  if (typeof v === "string") return v.length > 48 ? `"${v.slice(0, 45)}…"` : `"${v}"`;
  return String(v);
}

/** Source-symbol rows: the code side of the deployed shape. */
const SOURCE_FACTS = [
  ["gateway/src/heartbeat-fastpath.ts", "PRODUCT_HEARTBEAT_INTERVAL_SECONDS", "Worker", "idle heartbeat frame, seconds"],
  ["gateway/src/heartbeat-fastpath.ts", "bootNotificationIntervalSeconds", "Worker", "derives advertised interval from liveness config"],
  ["gateway/src/heartbeat-fastpath.ts", "resolveHeartbeatIntervalSeconds", "Worker", "range-guarded env override"],
  ["gateway/src/heartbeat-fastpath.ts", "bypassesIngest", "Queue", "actions that skip queue + ingest"],
  ["gateway/src/heartbeat-fastpath.ts", "recordFrame", "Durable Object", "liveness transition + rollup"],
  ["gateway/src/heartbeat-fastpath.ts", "frameCapDecision", "Durable Object", "per-connector frame cap"],
  ["gateway/src/heartbeat-fastpath.ts", "CAP_EXEMPT_ACTIONS", "Durable Object", "billing-material actions never shed"],
  ["gateway/src/heartbeat-fastpath.ts", "DEFAULT_FRAME_CAP", "Durable Object", "window, max frames, quarantine, anomaly threshold"],
  ["gateway/src/identity-do.ts", "handleInboundCall", "Durable Object", "frame entry point"],
  ["gateway/src/identity-do.ts", "stubResponseFor", "Worker", "BootNotification/Heartbeat replies"],
  ["gateway/src/identity-do.ts", "OPS_STATE_KEY", "Durable Object", "single storage key for liveness + cap"],
  ["gateway/src/ingest-client.ts", "enqueueOrPost", "Queue", "queue producer with service-binding fallback"],
  ["gateway/src/metrics.ts", "createMetricsWriter", "Analytics Engine", "no-op safe writer"],
  ["gateway/src/metrics.ts", "METRIC_NAMES", "Analytics Engine", "closed vocabulary, 9 names"],
  ["gateway/src/metrics.ts", "pseudonymiseIdentity", "Analytics Engine", "salted FNV-1a, sync"],
  ["gateway/src/metrics.ts", "FORBIDDEN_DIMENSION_KEYS", "Analytics Engine", "runtime PII guard"],
  ["gateway/src/sentry-scrub.ts", "scrubEvent", "Sentry/env", "beforeSend transform"],
  ["gateway/src/sentry-scrub.ts", "OCPP_PAYLOAD_ALLOWLIST", "Sentry/env", "payload allowlist"],
  ["gateway/src/sentry-scrub.ts", "DENY_KEY_SUBSTRINGS", "Sentry/env", "key denylist incl. kennitala"],
  ["gateway/src/sentry-scrub.ts", "sentryConfigFrom", "Sentry/env", "fail-closed when DSN absent"],
  ["gateway/src/auth.ts", "GatewayEnv", "Worker", "env surface / binding contract"],
  ["gateway/src/auth.ts", "parseBasicAuth", "Worker", "charger credential parsing"],
];

/**
 * OCPP action taxonomy. This is a deployed-shape fact as much as any
 * binding: which actions bypass ingest, which may never be shed, and
 * what storage class each lands in is what determines the bill.
 */
const OCPP_ACTIONS = [
  ["Heartbeat",          "liveness only",   "yes", "no",  "720/connector/month at 3600 s; 43,200 at 60 s", "OB6, OC1, OC5"],
  ["BootNotification",   "event",           "no",  "yes", "one per connect; carries the interval reply",   "OB6, OB7"],
  ["StatusNotification", "event",           "no",  "no",  "per connector state change",                    "OC4"],
  ["MeterValues",        "billing material","no",  "yes", "UNKNOWN until M-3; dominates active sessions",  "OC6"],
  ["StartTransaction",   "billing material","no",  "yes", "one per session",                               "OC6"],
  ["StopTransaction",    "billing material","no",  "yes", "one per session",                               "OC6"],
  ["Authorize",          "event",           "no",  "yes", "one per session start; upstream call",          "OC4"],
  ["DataTransfer",       "raw protocol",    "no",  "no",  "vendor-specific, unbounded by spec",            "OC7, OC8"],
];

/** Secret names only. Values are never read, printed, or stored. */
const SECRET_NAMES = [
  ["OCPP_INGEST_SECRET", "gateway + api", "shared ingest gate between gateway and API"],
  ["SENTRY_DSN",         "gateway",       "absent today; fail-closed disables reporting"],
  ["AUTH_SECRET",        "api",           "a real value is already public in git history — must be rotated, not reused"],
  ["DATABASE_URL",       "api",           "Neon DSN; secret binding, never a plaintext var"],
];

export function collect(repo) {
  const rows = [];
  for (const rel of ["wrangler.jsonc", "apps/api/wrangler.jsonc", "gateway/wrangler.jsonc"]) {
    const abs = join(repo, rel);
    if (existsSync(abs)) walkConfig(rel, abs, rows);
    else rows.push({ file: rel, key: "<missing>", product: "unknown", env: "unknown", shape: "FILE ABSENT", inheritance: "-", blocker: "yes", annotated: "derived", evidence: rel });
  }
  for (const [file, symbol, product, note] of SOURCE_FACTS) {
    const abs = join(repo, file);
    const present = existsSync(abs) && readFileSync(abs, "utf8").includes(symbol);
    rows.push({
      file, key: symbol, symbol, product, env: "all",
      shape: present ? note : `ABSENT — ${note}`,
      inheritance: "source, not config",
      cost: (IMPACT_BY_PRODUCT[product] ?? IMPACT_BY_PRODUCT.unknown).cost,
      release: present ? "present" : "MISSING",
      rollback: "git revert",
      blocker: present ? "no" : "yes",
      annotated: "source", evidence: `${file}:${symbol}`,
    });
  }
  // CI + package script rows.
  const wf = join(repo, ".github/workflows");
  if (existsSync(wf)) {
    for (const f of readdirSync(wf)) {
      rows.push({
        file: `.github/workflows/${f}`, key: "workflow", symbol: f, product: "Worker", env: "ci",
        shape: "GitHub Actions workflow", inheritance: "n/a",
        cost: "none", release: "CI gate", rollback: "n/a", blocker: "no",
        annotated: "derived", evidence: `.github/workflows/${f}`,
      });
    }
  }
  for (const p of ["package.json", "gateway/package.json", "apps/api/package.json"]) {
    const abs = join(repo, p);
    if (!existsSync(abs)) continue;
    const pkg = JSON.parse(readFileSync(abs, "utf8"));
    for (const [k, v] of Object.entries(pkg.scripts ?? {})) {
      rows.push({
        file: p, key: `scripts.${k}`, symbol: k, product: "Worker", env: "local",
        shape: v.length > 48 ? `${v.slice(0, 45)}…` : v,
        inheritance: "n/a",
        cost: "none",
        release: /deploy/.test(k) ? "MUTATING — this is a deploy path" : "local",
        rollback: "n/a", blocker: "no", annotated: "derived", evidence: `${p}:scripts.${k}`,
      });
    }
  }
  // OCPP action taxonomy — the frame-level shape that sets the bill.
  const fpSrc = existsSync(join(repo, "gateway/src/heartbeat-fastpath.ts"))
    ? readFileSync(join(repo, "gateway/src/heartbeat-fastpath.ts"), "utf8") : "";
  for (const [action, storage, bypass, capExempt, volume, gates] of OCPP_ACTIONS) {
    const declaredExempt = new RegExp(`"${action}"`).test(fpSrc.split("CAP_EXEMPT_ACTIONS")[1]?.slice(0, 300) ?? "");
    rows.push({
      file: "gateway/src/heartbeat-fastpath.ts", key: `action:${action}`, symbol: action,
      product: "Durable Object", env: "all",
      shape: `storage=${storage}; bypassesIngest=${bypass}; capExempt=${capExempt}${declaredExempt === (capExempt === "yes") ? "" : " (MISMATCH vs source)"}`,
      inheritance: "source, not config",
      cost: volume,
      release: `gates ${gates}`,
      rollback: "git revert",
      blocker: declaredExempt === (capExempt === "yes") ? "no" : "yes",
      annotated: "ocpp-taxonomy", evidence: `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS`,
    });
  }
  // Metric vocabulary — each name is a cardinality and cost decision.
  const metSrc = existsSync(join(repo, "gateway/src/metrics.ts"))
    ? readFileSync(join(repo, "gateway/src/metrics.ts"), "utf8") : "";
  for (const m of (metSrc.match(/"([a-z_]+)"(?=,?\n)/g) ?? []).map((s) => s.replace(/"/g, ""))
    .filter((s, i, a) => s.includes("_") && a.indexOf(s) === i).slice(0, 12)) {
    rows.push({
      file: "gateway/src/metrics.ts", key: `metric:${m}`, symbol: m,
      product: "Analytics Engine", env: "all",
      shape: "index=name; blobs=[name, cid, eventType, errorKind, period]",
      inheritance: "source, not config",
      cost: "one sampled data point per occurrence; cardinality bounded by the closed vocabulary",
      release: "no binding today ⇒ written nowhere",
      rollback: "additive", blocker: "no",
      annotated: "metric-vocabulary", evidence: `metrics.ts:METRIC_NAMES`,
    });
  }
  // Secret names only — never values.
  for (const [name, where, note] of SECRET_NAMES) {
    rows.push({
      file: "(Worker secret)", key: `secret:${name}`, symbol: name,
      product: "Secrets Store", env: where,
      shape: "NAME ONLY — value never read by this census",
      inheritance: "secrets are per-environment, never inherited",
      cost: "none", release: note, rollback: "re-set the secret",
      blocker: name === "AUTH_SECRET" ? "yes" : "no",
      annotated: "secret-name", evidence: "docs/notes — never the value",
    });
  }
  return rows;
}

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function toMarkdown(rows) {
  const head = "| # | File | Key | Product | Env | Shape | Inheritance | Cost impact | Release impact | Rollback impact | Blocker | Evidence |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|";
  const body = rows.map((r, i) =>
    `| ${i + 1} | \`${esc(r.file)}\` | \`${esc(r.key)}\` | ${esc(r.product)} | ${esc(r.env)} | ${esc(r.shape)} | ${esc(r.inheritance)} | ${esc(r.cost)} | ${esc(r.release)} | ${esc(r.rollback)} | ${esc(r.blocker)} | \`${esc(r.evidence)}\` |`);
  return [head, sep, ...body].join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const rows = collect(REPO);
  if (argv.includes("--md")) console.log(toMarkdown(rows));
  else console.log(JSON.stringify({ repo: relative(process.cwd(), REPO) || ".", count: rows.length, rows }, null, 2));
}
