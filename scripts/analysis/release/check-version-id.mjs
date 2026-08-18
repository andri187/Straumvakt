#!/usr/bin/env node
//
// Release gate: a DEPLOYED environment must be able to identify itself.
//
// ── WHAT THIS ADDS OVER OB15/OB24 ───────────────────────────────────────
//
// OB15 and OB24 already fail when `version_metadata` is not DECLARED in a
// wrangler config. That is the static half and it is covered. This is the
// runtime half, and the two are not the same claim:
//
//   declared  — someone wrote the binding into a config file.
//   reported  — the thing actually running says which version it is.
//
// A config can declare the binding while the deployed Worker predates it,
// which is precisely today's situation in reverse and exactly the state that
// makes a rollback impossible. Only a live probe distinguishes them.
//
// ── WHY IT IS NOT IN `npm run check` ────────────────────────────────────
//
// It needs either a network call or a recorded probe response, and
// `npm run check` is the offline, credential-free, must-stay-green surface.
// This sits with the observability gate instead: a real gate, currently RED
// against every environment, run deliberately. `--self-test` is offline and
// is what CI can run.
//
// Usage:
//   node scripts/analysis/release/check-version-id.mjs --self-test
//   node scripts/analysis/release/check-version-id.mjs --probe https://ws.straumvakt.org
//   node scripts/analysis/release/check-version-id.mjs --recorded probe.json
//
// Exit 0 = the environment reports a usable version id. 1 = it does not.

import { existsSync, readFileSync } from "node:fs";

/**
 * The rule, in one place.
 *
 * Deliberately NOT `Boolean(body.versionId)`: the failure this guards against
 * is a body that reports a plausible placeholder. "unknown", "dev", "latest"
 * and "" all read like answers and would all pass a truthiness check.
 */
export const PLACEHOLDER_VERSIONS = new Set(["", "unknown", "dev", "latest", "none", "null", "n/a"]);

export function evaluate(body) {
  if (body === null || typeof body !== "object") {
    return { ok: false, reason: "response is not a JSON object" };
  }
  if (body.configured !== true) {
    return { ok: false, reason: `environment reports configured=${JSON.stringify(body.configured)} (${body.reason ?? "no reason given"})` };
  }
  const v = body.versionId;
  if (typeof v !== "string") return { ok: false, reason: "versionId is not a string" };
  if (PLACEHOLDER_VERSIONS.has(v.trim().toLowerCase())) {
    return { ok: false, reason: `versionId "${v}" is a placeholder, not a deployed version` };
  }
  return { ok: true, reason: `version ${v}` };
}

// ── self-test ───────────────────────────────────────────────────────────

const FIXTURES = [
  ["configured-with-real-id.valid", { configured: true, versionId: "95f6f763-52fa-4f2d-91ea-7fe5092c58b9" }, true],
  ["unconfigured.invalid", { configured: false, versionId: null, reason: "binding-absent" }, false],
  ["malformed-binding.invalid", { configured: false, versionId: null, reason: "binding-malformed" }, false],
  ["placeholder-unknown.invalid", { configured: true, versionId: "unknown" }, false],
  ["placeholder-dev.invalid", { configured: true, versionId: "dev" }, false],
  ["placeholder-empty.invalid", { configured: true, versionId: "" }, false],
  ["placeholder-cased.invalid", { configured: true, versionId: "  Unknown  " }, false],
  ["versionid-not-a-string.invalid", { configured: true, versionId: 12345 }, false],
  ["configured-missing.invalid", { versionId: "abc" }, false],
  ["not-an-object.invalid", "ok", false],
  ["null-body.invalid", null, false],
  // The exact shape the gateway returns today, pre-binding. It must fail.
  [
    "current-gateway-response.invalid",
    { service: "straumvakt-ocpp", versionId: null, tag: null, timestamp: null, configured: false, reason: "binding-absent" },
    false,
  ],
];

if (process.argv.includes("--self-test")) {
  let passed = 0;
  let failed = 0;
  for (const [name, body, expectOk] of FIXTURES) {
    const r = evaluate(body);
    if (r.ok === expectOk) passed++;
    else {
      failed++;
      process.stdout.write(`  FAIL  ${name}: expected ok=${expectOk}, got ok=${r.ok} (${r.reason})\n`);
    }
  }
  process.stdout.write(`\n  version-id self-test: ${passed} passed, ${failed} failed (${FIXTURES.length} fixtures)\n`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── live / recorded ─────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const at = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1] ?? null;
};

const recorded = at("--recorded");
const probe = at("--probe");

if (recorded) {
  if (!existsSync(recorded)) {
    process.stdout.write(`recorded probe not found: ${recorded}\n`);
    process.exit(1);
  }
  const r = evaluate(JSON.parse(readFileSync(recorded, "utf8")));
  process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${recorded} — ${r.reason}\n`);
  process.exit(r.ok ? 0 : 1);
}

if (probe) {
  const url = probe.replace(/\/$/, "") + "/version";
  let body;
  try {
    const res = await fetch(url);
    body = await res.json();
  } catch (e) {
    process.stdout.write(`FAIL  ${url} — could not read /version: ${e.message}\n`);
    process.exit(1);
  }
  const r = evaluate(body);
  process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${url} — ${r.reason}\n`);
  process.exit(r.ok ? 0 : 1);
}

process.stdout.write(
  "usage: check-version-id.mjs --self-test | --probe <origin> | --recorded <file.json>\n",
);
process.exit(1);
