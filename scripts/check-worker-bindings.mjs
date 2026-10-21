#!/usr/bin/env node
//
// Worker binding checker — offline, no network, no cloud credentials.
//
// WHY THIS EXISTS
//
// A wrangler config names several independently deployable targets: the
// top-level block, and one per `env.<name>`. `wrangler deploy` with no
// `--env` deploys the TOP-LEVEL one. Bindings do NOT inherit from
// top-level into an env, and they do not inherit upward either — an env
// block is a complete, separate deployment target.
//
// Both of this repo's Worker configs currently declare their real
// bindings only under `env.staging`. Their top-level blocks name the
// Worker and its entrypoint and almost nothing else. Deploying either
// without `--env staging` produces a Worker that starts, serves traffic,
// and is missing the database, the queue, or both:
//
//   apps/api  top-level → no hyperdrive, no queue consumer, no crons
//   gateway   top-level → no queue producer
//
// The gateway's failure mode is the quiet one. `OCPP_EVENTS_QUEUE` is
// typed optional (gateway/src/auth.ts) and ingest-client falls back to a
// synchronous service-binding call, so a queueless gateway does not
// crash — it silently converts every OCPP frame into a blocking
// Worker-to-Worker request. At a 60s heartbeat that is ~44k extra
// synchronous calls per connector per month, and it couples charger
// liveness to API Worker availability. Nothing fails; it just gets
// expensive and fragile.
//
// This check is deliberately a STATIC one. It reads the committed config
// files and never asks Cloudflare what is actually deployed, so it runs
// in CI with no credentials. It cannot tell you what production has; it
// tells you what a deploy of this config WOULD produce.
//
// Usage:  node scripts/check-worker-bindings.mjs [--json]
// Exit:   0 = every deployable target satisfies its contract
//         1 = at least one target would deploy without a required binding

import { readFileSync, existsSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────
// Contracts — what each deployable target must carry
// ─────────────────────────────────────────────────────────────────────

/**
 * `requiredIn` semantics:
 *   "every"  — every deployable target, top-level included
 *   "named"  — every target EXCEPT top-level, when top-level is declared
 *              a non-deployable skeleton via `skeletonTopLevel`
 *
 * `skeletonTopLevel` is an explicit, reviewable escape hatch. Setting it
 * is a statement that the top-level block is not deployed — which is only
 * true if nobody ever runs `wrangler deploy` without `--env`. Prefer
 * fixing the config over setting it.
 */
const CONTRACTS = [
  {
    file: "gateway/wrangler.jsonc",
    label: "OCPP gateway",
    skeletonTopLevel: false,
    requirements: [
      {
        id: "queue-producer-ocpp-events",
        kind: "queue_producer",
        binding: "OCPP_EVENTS_QUEUE",
        requiredIn: "every",
        why:
          "Without it, ingest-client falls back to a synchronous service-binding " +
          "call per OCPP frame. Silent: nothing errors, every frame just becomes " +
          "a blocking Worker-to-Worker request (~44k/connector/month at 60s heartbeat).",
      },
      {
        id: "service-main-app",
        kind: "service",
        binding: "MAIN_APP",
        requiredIn: "every",
        why: "Auth + event ingest both go through it; absence is a hard failure at connect.",
      },
      {
        id: "do-identity",
        kind: "durable_object",
        binding: "IDENTITY_DO",
        requiredIn: "every",
        why: "The per-charger Durable Object. No binding, no WebSocket handling at all.",
      },
    ],
  },
  {
    file: "apps/api/wrangler.jsonc",
    label: "API Worker",
    skeletonTopLevel: false,
    requirements: [
      {
        id: "hyperdrive-db",
        kind: "hyperdrive",
        binding: "HYPERDRIVE_DB",
        requiredIn: "every",
        why: "No database. Every route that touches Postgres 500s.",
      },
      {
        id: "queue-consumer-ocpp-events",
        kind: "queue_consumer",
        match: /ocpp-events/,
        requiredIn: "every",
        why:
          "Nothing drains the inbound OCPP queue. The gateway keeps producing; " +
          "messages pile up and expire. No error surfaces on either side.",
      },
      {
        id: "crons",
        kind: "cron",
        requiredIn: "every",
        why:
          "No partition cron (event_log / meter_values daily partitions stop being " +
          "created) and no outbox sweeper.",
      },
    ],
  },
];

/** Field names people reach for that wrangler does not read. */
const SINGULAR_TRAPS = {
  queue: "queues",
  service: "services",
  r2_bucket: "r2_buckets",
  trigger: "triggers",
  cron: "triggers.crons",
  durable_object: "durable_objects",
  hyperdrive_config: "hyperdrive",
  kv_namespace: "kv_namespaces",
  d1_database: "d1_databases",
};

// ─────────────────────────────────────────────────────────────────────
// JSONC
// ─────────────────────────────────────────────────────────────────────

/**
 * Strip comments and trailing commas from JSONC.
 *
 * String-aware on purpose: apps/api/wrangler.jsonc contains
 * "postgresql://placeholder@..." and a naive //-strip silently truncates
 * that line and every field after it on the same line. A checker that
 * corrupts the input it is validating is worse than no checker.
 */
export function parseJsonc(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") { out += text[++i] ?? ""; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") { inLine = true; i++; continue; }
    if (c === "/" && next === "*") { inBlock = true; i++; continue; }
    out += c;
  }
  // Trailing commas before } or ]
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// ─────────────────────────────────────────────────────────────────────
// Inspection
// ─────────────────────────────────────────────────────────────────────

/** Every independently deployable target in a wrangler config. */
export function deployTargets(config) {
  const targets = [{ name: "(top-level)", block: config, isTopLevel: true }];
  for (const [name, block] of Object.entries(config.env ?? {})) {
    targets.push({ name: `env.${name}`, block, isTopLevel: false });
  }
  return targets;
}

function hasBinding(block, req) {
  switch (req.kind) {
    case "queue_producer":
      return (block.queues?.producers ?? []).some((p) => p.binding === req.binding);
    case "queue_consumer":
      return (block.queues?.consumers ?? []).some((c) => req.match.test(c.queue ?? ""));
    case "service":
      return (block.services ?? []).some((s) => s.binding === req.binding);
    case "durable_object":
      return (block.durable_objects?.bindings ?? []).some((d) => d.name === req.binding);
    case "hyperdrive":
      return (block.hyperdrive ?? []).some((h) => h.binding === req.binding);
    case "cron":
      return (block.triggers?.crons ?? []).length > 0;
    default:
      throw new Error(`unknown requirement kind: ${req.kind}`);
  }
}

/** Fields wrangler ignores, which read as if they configure something. */
function singularTraps(block, where) {
  const found = [];
  for (const [wrong, right] of Object.entries(SINGULAR_TRAPS)) {
    if (Object.hasOwn(block, wrong)) {
      found.push({
        where,
        detail: `"${wrong}" is not a wrangler field — it is silently ignored. Use "${right}".`,
      });
    }
  }
  return found;
}

/**
 * A top-level block that declares strictly less than every env block is
 * the shape that produces a half-configured Worker on an un-suffixed
 * deploy. Reported even when the requirement list happens to pass, so a
 * future binding added only to an env is caught on the way in.
 */
function skeletonWarning(targets) {
  const top = targets.find((t) => t.isTopLevel);
  const envs = targets.filter((t) => !t.isTopLevel);
  if (!top || envs.length === 0) return null;
  const keysOf = (b) =>
    new Set(
      Object.keys(b).filter(
        (k) => !["name", "main", "compatibility_date", "compatibility_flags", "env", "$schema"].includes(k),
      ),
    );
  const topKeys = keysOf(top.block);
  const missingEverywhere = new Set();
  for (const e of envs) {
    for (const k of keysOf(e.block)) if (!topKeys.has(k)) missingEverywhere.add(k);
  }
  if (missingEverywhere.size === 0) return null;
  return [...missingEverywhere].sort();
}

/** `workers_dev: true` on a target that also declares routes. */
function routeFootgun(block, where) {
  const out = [];
  const hasRoutes = Boolean(block.routes || block.route);
  if (block.workers_dev === true && hasRoutes) {
    out.push({
      where,
      detail:
        "workers_dev:true alongside routes — the *.workers.dev hostname stays " +
        "publicly reachable and bypasses anything enforced at the custom domain.",
    });
  }
  if (Object.hasOwn(block, "route")) {
    out.push({ where, detail: '"route" is singular and ignored by current wrangler — use "routes".' });
  }
  return out;
}

export function checkConfig(contract, config) {
  const targets = deployTargets(config);
  const failures = [];
  const warnings = [];

  for (const t of targets) {
    if (t.isTopLevel && contract.skeletonTopLevel) continue;
    for (const req of contract.requirements) {
      if (req.requiredIn === "named" && t.isTopLevel) continue;
      if (!hasBinding(t.block, req)) {
        failures.push({
          file: contract.file,
          target: t.name,
          id: req.id,
          binding: req.binding ?? String(req.match ?? req.kind),
          why: req.why,
        });
      }
    }
    warnings.push(...singularTraps(t.block, `${contract.file} ${t.name}`));
    warnings.push(...routeFootgun(t.block, `${contract.file} ${t.name}`));
  }

  const skeleton = skeletonWarning(targets);
  if (skeleton) {
    warnings.push({
      where: `${contract.file} (top-level)`,
      detail:
        `top-level declares none of: ${skeleton.join(", ")} — present in an env block. ` +
        `A deploy without --env produces a Worker missing them.`,
    });
  }
  return { failures, warnings };
}

// ─────────────────────────────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────────────────────────────

function main() {
  const asJson = process.argv.includes("--json");
  const allFailures = [];
  const allWarnings = [];

  for (const contract of CONTRACTS) {
    if (!existsSync(contract.file)) {
      allFailures.push({
        file: contract.file,
        target: "-",
        id: "config-missing",
        binding: "-",
        why: "Config file not found. If the Worker moved, update CONTRACTS — do not delete this check.",
      });
      continue;
    }
    const config = parseJsonc(readFileSync(contract.file, "utf8"));
    const { failures, warnings } = checkConfig(contract, config);
    allFailures.push(...failures);
    allWarnings.push(...warnings);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ failures: allFailures, warnings: allWarnings }, null, 2) + "\n");
  } else {
    for (const w of allWarnings) process.stdout.write(`  warn  ${w.where}: ${w.detail}\n`);
    for (const f of allFailures) {
      process.stderr.write(`\n  FAIL  ${f.file} ${f.target}\n        missing ${f.binding} (${f.id})\n        ${f.why}\n`);
    }
    if (allFailures.length === 0) {
      process.stdout.write(
        `worker bindings: every deployable target satisfies its contract${
          allWarnings.length ? ` (${allWarnings.length} warning(s))` : ""
        }.\n`,
      );
    } else {
      process.stderr.write(
        `\n${allFailures.length} deployable target(s) would deploy without a required binding.\n` +
          `Fix the config, or — if a target is genuinely never deployed — set skeletonTopLevel\n` +
          `for it in scripts/check-worker-bindings.mjs and say why in the commit message.\n\n`,
      );
    }
  }
  process.exit(allFailures.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("check-worker-bindings.mjs")) {
  main();
}
