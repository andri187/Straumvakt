//
// Pricing single-source-of-truth guard — offline, no network, no DB.
//
// WHY THIS EXISTS
//
// Straumvakt has accumulated pricing paths by addition rather than by
// decision. Measured 2026-08-10: three implementations can compute what a
// driver owes, and four call sites price a session and write it to a
// ledger. They can disagree, and the evidence says they already do — 492
// ledger rows carry no provenance because one writer sets neither
// reconciliation field, and 5 rows claim CDR provenance while carrying an
// OCPP figure.
//
// This check does not unify them. That is a migration, not a lint. It makes
// the set CLOSED, so the next pricing path is a decision instead of an
// accident.
//
// WHAT IT CHECKS
//
// `computeSessionCost` is the price of record. Every session price in the
// system flows through it, so the set of files that CALL it is the precise
// boundary — you cannot write a price you did not compute. Selecting,
// serialising or type-declaring a money column is not pricing, which is
// why this looks at the call and not at the column.
//
// Usage:  node scripts/check-pricing-ssot.mjs [--json]
// Exit:   0 = the set is unchanged
//         1 = a new pricing call site appeared, or an expected one vanished

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["apps", "packages", "src", "gateway"];
const SKIP_DIRS = new Set([
  "node_modules", ".next", "dist", "build", "generated", ".git", "archive",
  ".turbo", ".dart_tool", "coverage",
]);

/** The pricing entry point. Its own definition is excluded by ALLOWED. */
const PRICING_CALL = /\bcomputeSessionCost\s*\(/;

/**
 * Every file permitted to price a session, with the reason. Adding an entry
 * here is the decision this check exists to force — and the comment is the
 * decision record.
 */
const ALLOWED = new Map([
  [
    "apps/api/src/lib/tariff/compute-session-cost.ts",
    "the engine itself — the price of record",
  ],
  [
    "apps/api/src/lib/ocpp/projections.ts",
    "OCPP ledger writer. :999 is live; :393 is the legacy onSessionStopped path, which is dead because nothing emits session.stopped",
  ],
  [
    "apps/api/src/repositories/zaptec-session-sync.ts",
    "CDR reconciliation writer. Its update branch is the one that relabels without restating — see cdr-provenance.ts",
  ],
  [
    "apps/api/src/routes/webhooks/zaptec.ts",
    "webhook session-end writer. Sets neither verifiedSource nor enrichmentStatus, which is the origin of the 492 unlabelled rows",
  ],
  [
    "apps/api/scripts/backfill-session-costs.ts",
    "one-off backfill, not a runtime path. Does an unaudited in-place ledger UPDATE",
  ],
  [
    "apps/api/scripts/shadow-compare-resolvers.ts",
    "operator-run comparator between the legacy and agreements resolvers. Read-only",
  ],
]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(ts|mts|mjs)$/.test(name) && !/\.test\.(ts|mts|mjs)$/.test(name)) yield full;
  }
}

/** Stop a call named inside a comment or string from counting. */
export function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

export function findPricingCallSites(roots = ROOTS) {
  const found = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const rel = relative(".", file).split(sep).join("/");
      let src;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (PRICING_CALL.test(stripCommentsAndStrings(src))) found.push(rel);
    }
  }
  return found.sort();
}

export function diffAgainstAllowlist(found, allowed = ALLOWED) {
  const set = new Set(found);
  return {
    unexpected: found.filter((f) => !allowed.has(f)),
    vanished: [...allowed.keys()].filter((f) => !set.has(f)).sort(),
  };
}

function main() {
  const asJson = process.argv.includes("--json");
  const found = findPricingCallSites();
  const { unexpected, vanished } = diffAgainstAllowlist(found);

  if (asJson) {
    process.stdout.write(JSON.stringify({ found, unexpected, vanished }, null, 2) + "\n");
  } else if (unexpected.length === 0 && vanished.length === 0) {
    process.stdout.write(
      `pricing SSOT: ${found.length} files price a session, all accounted for.\n`,
    );
  } else {
    for (const f of unexpected) {
      process.stderr.write(
        `\n  NEW PRICING PATH  ${f}\n` +
          `        This file calls computeSessionCost and is not on the allowlist.\n` +
          `        Straumvakt already has four writers that can disagree about what a\n` +
          `        driver owes. If a fifth is genuinely needed, add it to ALLOWED in\n` +
          `        scripts/check-pricing-ssot.mjs with the reason — that entry is the\n` +
          `        decision record. If it is not needed, call the existing path.\n`,
      );
    }
    for (const f of vanished) {
      process.stderr.write(
        `\n  ALLOWLIST STALE  ${f}\n` +
          `        Expected to price a session and no longer does. If it converged\n` +
          `        onto another path, delete its ALLOWED entry — that is progress and\n` +
          `        the allowlist should shrink to record it.\n`,
      );
    }
  }

  process.exit(unexpected.length === 0 && vanished.length === 0 ? 0 : 1);
}

export { PRICING_CALL, ALLOWED };

if (process.argv[1]?.endsWith("check-pricing-ssot.mjs")) main();
