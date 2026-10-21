//
// Binding-existence gate.
//
// ── WHY ─────────────────────────────────────────────────────────────────
//
// `gateway/wrangler.jsonc` bound `MAIN_APP` to the service `hlada-api` — a
// Worker that has NEVER EXISTED on the account. Nothing caught it, because
// nothing compared configuration against reality. A binding naming a
// nonexistent resource is a config file that looks correct and cannot deploy
// into a working state.
//
// ── HOW IT RUNS WITHOUT CREDENTIALS ─────────────────────────────────────
//
// It reads a recorded snapshot of the account —
// docs/reference/cloudflare-account-snapshot.json — rather than calling
// Cloudflare. That makes it runnable in CI, on any branch, offline, which is
// the same property that lets check:migrations-visible run everywhere.
//
// The cost of that choice is that the snapshot can go stale. That is the
// right trade: a stale snapshot fails LOUDLY the moment config names
// something the snapshot lacks, and refreshing it is one read-only command
// per resource type. A gate that needs a credential is a gate that does not
// run.
//
// ── THE ESCAPE HATCH, AND WHY IT IS NARROW ──────────────────────────────
//
// A binding may name a nonexistent resource only if the snapshot's
// `pendingCreation` list names it WITH A REASON AND AN OWNER. Anything else
// is an error. This is what keeps a known, deliberate gap (the option-
// dependent MAIN_APP binding) from either failing the build forever or
// disappearing silently.
//
// Usage:
//   node scripts/analysis/bindings/check-bindings.mjs
//   node scripts/analysis/bindings/check-bindings.mjs --self-test
//
// Exit 0 = every binding resolves. 1 = at least one does not.

import { existsSync, readFileSync } from "node:fs";

const CONFIGS = [
  "wrangler.jsonc",
  "apps/api/wrangler.jsonc",
  "gateway/wrangler.jsonc",
];
const SNAPSHOT = "docs/reference/cloudflare-account-snapshot.json";

/** JSONC → JSON, string-aware so a `//` inside a value survives. */
export function stripJsonc(text) {
  let out = "";
  let inStr = false;
  let esc = false;
  let line = false;
  let block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (line) {
      if (c === "\n") { line = false; out += c; }
      continue;
    }
    if (block) {
      if (c === "*" && n === "/") { block = false; i++; }
      continue;
    }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { line = true; i++; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    out += c;
  }
  // Trailing commas are legal in JSONC and fatal in JSON.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Flatten a wrangler config into (environment, binding) rows.
 *
 * Named environments INHERIT nothing here on purpose: wrangler's inheritance
 * rules differ per key and getting them wrong in a gate produces false
 * results in both directions. This checks what each block DECLARES. A block
 * that declares no bindings contributes no rows and no errors.
 */
export function bindingsOf(config, file) {
  const rows = [];
  const collect = (envName, block) => {
    if (!block || typeof block !== "object") return;
    for (const s of block.services ?? []) {
      if (s?.service) {
        rows.push({ file, env: envName, kind: "worker", name: s.service, via: `services.${s.binding ?? "?"}` });
      }
    }
    for (const p of block.queues?.producers ?? []) {
      if (p?.queue) {
        rows.push({ file, env: envName, kind: "queue", name: p.queue, via: `queues.producers.${p.binding ?? "?"}` });
      }
    }
    for (const c of block.queues?.consumers ?? []) {
      if (c?.queue) rows.push({ file, env: envName, kind: "queue", name: c.queue, via: "queues.consumers" });
      if (c?.dead_letter_queue) {
        rows.push({ file, env: envName, kind: "queue", name: c.dead_letter_queue, via: "queues.consumers.dead_letter_queue" });
      }
    }
    for (const b of block.r2_buckets ?? []) {
      if (b?.bucket_name) {
        rows.push({ file, env: envName, kind: "r2", name: b.bucket_name, via: `r2_buckets.${b.binding ?? "?"}` });
      }
    }
    for (const h of block.hyperdrive ?? []) {
      // Existence of a Hyperdrive config id cannot be checked offline, but an
      // EMPTY id can — and an empty id deploys and then fails at runtime.
      if (h && (!h.id || String(h.id).trim() === "")) {
        rows.push({ file, env: envName, kind: "hyperdrive", name: "", via: `hyperdrive.${h.binding ?? "?"}` });
      }
    }
  };
  collect("top-level", config);
  for (const [envName, block] of Object.entries(config.env ?? {})) {
    collect(envName, block);
  }
  return rows;
}

export function checkRows(rows, snapshot) {
  const errors = [];
  const notes = [];
  const exists = (kind, name) => {
    const list =
      kind === "worker" ? snapshot.workers
      : kind === "queue" ? snapshot.queues
      : kind === "r2" ? snapshot.r2Buckets
      : [];
    const hit = (list ?? []).find((r) => r.name === name);
    return hit ? hit.exists !== false : false;
  };
  const pending = (kind, name) =>
    (snapshot.pendingCreation ?? []).find((p) => p.kind === kind && p.name === name);

  for (const r of rows) {
    if (r.kind === "hyperdrive") {
      errors.push(`${r.file} [${r.env}] ${r.via} — hyperdrive binding has an empty id`);
      continue;
    }
    if (exists(r.kind, r.name)) continue;

    const p = pending(r.kind, r.name);
    if (p) {
      if (!p.reason || !p.owner) {
        errors.push(
          `${r.file} [${r.env}] ${r.via} → ${r.kind} "${r.name}" is listed pendingCreation but has no reason and/or owner`,
        );
      } else {
        notes.push(`${r.file} [${r.env}] ${r.via} → ${r.kind} "${r.name}" PENDING-CREATION (${p.owner})`);
      }
      continue;
    }
    errors.push(
      `${r.file} [${r.env}] ${r.via} → ${r.kind} "${r.name}" does not exist on the account and is not listed pendingCreation`,
    );
  }
  return { errors, notes };
}

// ── self-test ───────────────────────────────────────────────────────────

const SNAP = {
  workers: [
    { name: "real-worker", exists: true },
    { name: "ghost-worker", exists: false },
  ],
  queues: [{ name: "q-staging", exists: true }],
  r2Buckets: [{ name: "bucket-staging", exists: true }],
  pendingCreation: [
    { kind: "worker", name: "planned-worker", reason: "blocked on a decision", owner: "Andri" },
    { kind: "worker", name: "sloppy-pending", reason: "", owner: "" },
  ],
};

const FIXTURES = [
  [
    "service-binding-to-nonexistent-worker.invalid",
    { services: [{ binding: "MAIN_APP", service: "ghost-worker" }] },
    1,
  ],
  [
    "service-binding-to-unknown-worker.invalid",
    { services: [{ binding: "MAIN_APP", service: "never-heard-of-it" }] },
    1,
  ],
  ["service-binding-to-real-worker.valid", { services: [{ binding: "MAIN_APP", service: "real-worker" }] }, 0],
  [
    "queue-that-exists-only-in-staging.invalid",
    {
      // The production-shaped mistake: a top-level block naming the staging
      // queue's production twin, which does not exist.
      queues: { producers: [{ binding: "Q", queue: "q-production" }] },
    },
    1,
  ],
  [
    "queue-and-dlq-that-exist.valid",
    {
      env: {
        staging: {
          queues: {
            producers: [{ binding: "Q", queue: "q-staging" }],
            consumers: [{ queue: "q-staging", dead_letter_queue: "q-staging" }],
          },
        },
      },
    },
    0,
  ],
  [
    "dlq-that-does-not-exist.invalid",
    {
      env: {
        staging: { queues: { consumers: [{ queue: "q-staging", dead_letter_queue: "q-dlq-missing" }] } },
      },
    },
    1,
  ],
  ["r2-bucket-that-exists.valid", { r2_buckets: [{ binding: "B", bucket_name: "bucket-staging" }] }, 0],
  ["r2-bucket-that-does-not.invalid", { r2_buckets: [{ binding: "B", bucket_name: "bucket-prod" }] }, 1],
  [
    "pending-creation-with-reason-and-owner.valid",
    { services: [{ binding: "MAIN_APP", service: "planned-worker" }] },
    0,
  ],
  [
    "pending-creation-without-reason.invalid",
    { services: [{ binding: "MAIN_APP", service: "sloppy-pending" }] },
    1,
  ],
  [
    "env-override-binding-is-checked-too.invalid",
    {
      services: [{ binding: "MAIN_APP", service: "real-worker" }],
      env: { staging: { services: [{ binding: "MAIN_APP", service: "ghost-worker" }] } },
    },
    1,
  ],
  ["empty-hyperdrive-id.invalid", { hyperdrive: [{ binding: "HYPERDRIVE_DB", id: "" }] }, 1],
  ["no-bindings-at-all.valid", { name: "x" }, 0],
];

function selfTest() {
  let passed = 0;
  let failed = 0;

  for (const [name, cfg, expectedErrors] of FIXTURES) {
    const rows = bindingsOf(cfg, "fixture.jsonc");
    const { errors } = checkRows(rows, SNAP);
    if (errors.length === expectedErrors) passed++;
    else {
      failed++;
      process.stdout.write(
        `  FAIL  ${name}: expected ${expectedErrors} error(s), got ${errors.length}${errors.length ? " — " + errors.join("; ") : ""}\n`,
      );
    }
  }

  // A commented-out binding must NOT count as live. stripJsonc is what makes
  // that true, so it is asserted directly rather than assumed.
  const commented = `{
    "name": "x",
    // "services": [{ "binding": "MAIN_APP", "service": "ghost-worker" }],
    /* "r2_buckets": [{ "binding": "B", "bucket_name": "bucket-prod" }] */
    "env": {}
  }`;
  const parsedCommented = JSON.parse(stripJsonc(commented));
  const commentedRows = bindingsOf(parsedCommented, "fixture.jsonc");
  if (commentedRows.length === 0) passed++;
  else {
    failed++;
    process.stdout.write(`  FAIL  commented-binding-is-not-live: got ${commentedRows.length} row(s)\n`);
  }

  // Trailing commas are legal JSONC and must not crash the parser.
  try {
    JSON.parse(stripJsonc('{ "a": 1, "b": [1,2,], }'));
    passed++;
  } catch {
    failed++;
    process.stdout.write("  FAIL  trailing-comma-jsonc-parses\n");
  }

  process.stdout.write(`\n  bindings self-test: ${passed} passed, ${failed} failed (${passed + failed} fixtures)\n`);
  return failed === 0 ? 0 : 1;
}

// ── main ────────────────────────────────────────────────────────────────

// Only run the CLI when invoked directly, so the module can be imported by a
// test without exiting the process.
const RUN_AS_CLI =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());

export { FIXTURES as BINDING_FIXTURES, SNAP as BINDING_SNAPSHOT_FIXTURE };

if (!RUN_AS_CLI) {
  // Imported for testing — stop before the CLI body.
} else {

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

if (!existsSync(SNAPSHOT)) {
  process.stdout.write(`account snapshot missing at ${SNAPSHOT} — cannot verify bindings\n`);
  process.exit(1);
}
const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

let allErrors = [];
let allNotes = [];
for (const file of CONFIGS) {
  if (!existsSync(file)) continue;
  let cfg;
  try {
    cfg = JSON.parse(stripJsonc(readFileSync(file, "utf8")));
  } catch (e) {
    allErrors.push(`${file} — does not parse as JSONC: ${e.message}`);
    continue;
  }
  const { errors, notes } = checkRows(bindingsOf(cfg, file), snapshot);
  allErrors = allErrors.concat(errors);
  allNotes = allNotes.concat(notes);
}

process.stdout.write(`binding-existence gate — snapshot captured ${snapshot.capturedAtUtc}\n`);
for (const n of allNotes) process.stdout.write(`  NOTE  ${n}\n`);
for (const e of allErrors) process.stdout.write(`  ERROR ${e}\n`);

if (allErrors.length) {
  process.stdout.write(`\n${allErrors.length} binding(s) name a resource that does not exist\n`);
  process.exit(1);
}
process.stdout.write(`\nall bindings resolve (${allNotes.length} pending-creation, recorded)\n`);

} // end RUN_AS_CLI
