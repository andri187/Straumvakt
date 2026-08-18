#!/usr/bin/env node
//
// Tenant-scoping guard for per-tenant permission gates — offline, no DB.
//
// WHY THIS EXISTS
//
// `requirePermission("billing.read")` without `orgIdParam` does not mean "a
// looser check". It means a DIFFERENT check. require-permission.ts resolves
// orgId to null, and effective-permissions.ts then skips the membership lookup
// entirely. The gate becomes simultaneously:
//
//   - unreachable for an ordinary org member, who is denied despite holding a
//     bundle that contains the verb, and
//   - tenant-wide for anyone with a platform grant, who now sees every tenant.
//
// One omission, two opposite failures, and neither is visible at the call
// site. That is exactly the shape a reader cannot catch and a linter can.
//
// This does not fix the existing surfaces. It CLOSES THE SET, the same way
// check-pricing-ssot.mjs closed the set of files allowed to price a session:
// every unscoped per-tenant gate must be listed here with a reason, so the
// next one is a decision instead of an accident.
//
// Usage:  node scripts/check-orgid-param.mjs [--json]
// Exit:   0 = no unlisted unscoped gate
//         1 = a new unscoped gate appeared, or an allowlisted one was fixed
//             (a stale entry is also a failure — the list must shrink as the
//             debt is paid, or it stops meaning anything)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROUTES_DIR = "apps/api/src/routes";

/**
 * Verbs that name a single tenant's data. A gate on one of these without an
 * orgIdParam is the bug described above.
 *
 * Deliberately NOT every verb: `platform.*` is tenant-wide by definition, and
 * flagging it would train people to ignore this check.
 */
const PER_TENANT_PREFIXES = ["billing.", "member.", "tariff.", "site.", "charger.", "property."];

/** requirePermission("verb", { orgIdParam: "x" }) — the second argument decides. */
const GATE = /requirePermission\(\s*"([^"]+)"\s*(,\s*\{[^}]*\})?/g;

/**
 * Known unscoped gates, each with the reason it is still unscoped.
 *
 * An entry here is a debt, not an approval. The comment is the record of why
 * it has not been paid yet.
 */
const ALLOWED = new Map([
  // Measured, not assembled by hand: this list was generated from the guard's
  // own findings on 2026-08-11 and is the true size of the debt at that
  // moment — 36 distinct file:verb pairs across 75 gate occurrences, all in
  // routes/admin. 16 of the 36 are billing.
  //
  // Every entry is a DEBT, not an approval. The list must SHRINK: a `vanished`
  // failure fires when an entry is fixed and not deleted, so paying the debt
  // is recorded rather than quietly forgotten.

  // ── admin ──
  ["apps/api/src/routes/admin/active-sessions.ts:charger.read", "charger.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/agreements-debug.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/agreements-resolve.ts:billing.write", "billing.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-contracts.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-cost-centers.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-cost-factors.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-cost-factors.ts:billing.write", "billing.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-driver-contracts.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-dso.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-electricity.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-enrichment.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-rate-references.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-rate-references.ts:billing.write", "billing.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-summary.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-tariff-detail.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing-tariff-mgmt.ts:billing.write", "billing.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/billing.ts:billing.read", "billing.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/chargers.ts:charger.config", "charger.config — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/chargers.ts:charger.read", "charger.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/chargers.ts:charger.remote_start", "charger.remote_start — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/chargers.ts:charger.remote_stop", "charger.remote_stop — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/chargers.ts:charger.write", "charger.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/circuits.ts:site.delete", "site.delete — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/circuits.ts:site.read", "site.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/circuits.ts:site.write", "site.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/installations.ts:site.delete", "site.delete — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/installations.ts:site.read", "site.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/installations.ts:site.write", "site.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/onboarding.ts:charger.write", "charger.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/properties.ts:property.delete", "property.delete — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/properties.ts:property.read", "property.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/properties.ts:property.write", "property.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/sites.ts:site.delete", "site.delete — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/sites.ts:site.read", "site.read — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/sites.ts:site.write", "site.write — unscoped when this guard was introduced, 2026-08-11"],
  ["apps/api/src/routes/admin/vehicles.ts:member.read", "member.read — unscoped when this guard was introduced, 2026-08-11"],
]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) yield full;
  }
}

/** Strip comments so a gate named in prose does not count. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function isPerTenantVerb(verb) {
  return PER_TENANT_PREFIXES.some((p) => verb.startsWith(p));
}

export function findUnscopedGates(root = ROUTES_DIR) {
  const out = [];
  for (const file of walk(root)) {
    const rel = relative(".", file).split(sep).join("/");
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const clean = stripComments(src);
    const lines = clean.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Gates are frequently written across two lines; join a small window so
      // the options object is visible to the regex.
      const window = lines.slice(i, i + 3).join(" ");
      GATE.lastIndex = 0;
      let m;
      while ((m = GATE.exec(window)) !== null) {
        const verb = m[1];
        const opts = m[2] ?? "";
        if (!isPerTenantVerb(verb)) continue;
        if (/orgIdParam/.test(opts)) continue;
        // Only record the first line of a multi-line gate once.
        if (!lines[i].includes("requirePermission")) continue;
        out.push({ file: rel, line: i + 1, verb });
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function diffAgainstAllowlist(found, allowed = ALLOWED) {
  const key = (g) => `${g.file}:${g.verb}`;
  const seen = new Set(found.map(key));
  return {
    unexpected: found.filter((g) => !allowed.has(key(g))),
    vanished: [...allowed.keys()].filter((k) => !seen.has(k)).sort(),
  };
}

function main() {
  const asJson = process.argv.includes("--json");
  const found = findUnscopedGates();
  const { unexpected, vanished } = diffAgainstAllowlist(found);

  if (asJson) {
    process.stdout.write(JSON.stringify({ found, unexpected, vanished }, null, 2) + "\n");
    process.exit(unexpected.length === 0 && vanished.length === 0 ? 0 : 1);
  }

  if (unexpected.length === 0 && vanished.length === 0) {
    process.stdout.write(
      `orgIdParam: every per-tenant gate names its tenant (${found.length} allowlisted).\n`,
    );
    process.exit(0);
  }

  const byVerb = new Map();
  for (const g of unexpected) byVerb.set(g.verb, (byVerb.get(g.verb) ?? 0) + 1);

  process.stderr.write(
    `\n  UNSCOPED PER-TENANT GATES: ${unexpected.length}\n\n` +
      `        A gate without orgIdParam resolves orgId to null, which SKIPS the\n` +
      `        membership lookup. It is therefore unreachable for org members AND\n` +
      `        tenant-wide for platform grants — one omission, two opposite bugs.\n\n` +
      `        By verb:\n` +
      [...byVerb.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `          ${String(n).padStart(3)}  ${v}\n`)
        .join("") +
      `\n        Fix by passing { orgIdParam: "orgId" } and re-checking the row in the\n` +
      `        repository, as apps/api/src/repositories/bill-objects.ts:127 does.\n` +
      `        If a gate must stay unscoped, add it to ALLOWED in this file WITH the\n` +
      `        reason — that entry is the decision record.\n\n`,
  );
  for (const g of unexpected.slice(0, 40)) {
    process.stderr.write(`          ${g.file}:${g.line}  ${g.verb}\n`);
  }
  if (unexpected.length > 40) {
    process.stderr.write(`          … and ${unexpected.length - 40} more\n`);
  }
  for (const v of vanished) {
    process.stderr.write(
      `\n  ALLOWLIST STALE  ${v}\n` +
        `        Listed as unscoped but no longer is. Delete the entry — that is\n` +
        `        progress, and the list must shrink to record it.\n`,
    );
  }
  process.exit(1);
}

export { GATE, ALLOWED, PER_TENANT_PREFIXES };

if (process.argv[1]?.endsWith("check-orgid-param.mjs")) main();
