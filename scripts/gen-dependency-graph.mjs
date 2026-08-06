#!/usr/bin/env node
//
// Generate docs/architecture/dependency-graph.md from the real import graph.
//
// A hand-drawn architecture diagram is a claim; this is a measurement. It goes
// stale the moment it disagrees with the code, and the point of regenerating it
// is that the disagreement shows up as a diff rather than as folklore.
//
// Mermaid rather than DOT so it renders on GitHub with no graphviz install.
//
// USAGE
//   node scripts/gen-dependency-graph.mjs           write
//   node scripts/gen-dependency-graph.mjs --check   verify, exit 1 if stale
//
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "architecture", "dependency-graph.md");
const BASELINE = path.join(ROOT, ".dependency-cruiser-known-violations.json");

const check = process.argv.includes("--check");
const SOURCES = ["apps/api/src", "src", "packages"];
const COLLAPSE = "^(apps/api/src/domains/[^/]+|apps/api/src/[^/]+|src/[^/]+|packages/[^/]+)";

// Call the CLI's entry module with the current node binary rather than going
// through npx: Node 24 refuses to spawnSync a .cmd shim without a shell
// (EINVAL), and a shell here would need quoting that differs per platform.
const DEPCRUISE_BIN = path.join(ROOT, "node_modules", "dependency-cruiser", "bin", "dependency-cruise.mjs");

function depcruise(args) {
  return execFileSync(
    process.execPath,
    [DEPCRUISE_BIN, ...SOURCES, "--config", ".dependency-cruiser.cjs", ...args],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
}

const mermaid = depcruise(["--collapse", COLLAPSE, "--output-type", "mermaid"]).trim();

/** @type {Array<{from:string,to:string,rule:{name:string}}>} */
const known = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : [];

const byRule = new Map();
for (const v of known) {
  const k = v.rule?.name ?? "unknown";
  if (!byRule.has(k)) byRule.set(k, []);
  byRule.get(k).push(v);
}

const lines = [];
lines.push("# Dependency graph — generated");
lines.push("");
lines.push("**Do not edit.** Written by `scripts/gen-dependency-graph.mjs` from the");
lines.push("actual import graph. Regenerate with `npm run deps:graph`; `npm run check`");
lines.push("fails if this file is stale.");
lines.push("");
lines.push("Boxes are folders, collapsed one level below each source root, so this shows");
lines.push("shape rather than files. Rules live in [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs).");
lines.push("");
lines.push("## Intended direction");
lines.push("");
lines.push("```");
lines.push("  commercial ──► charging ──► assets ──► identity");
lines.push("");
lines.push("  nothing may import vendor        an adapter must never appear in the core");
lines.push("  platform imports nothing         logs, audit, webhooks are a leaf");
lines.push("```");
lines.push("");
lines.push("Prisma cannot express this — a relation is declared on both sides, so the");
lines.push("schema-level graph is necessarily symmetric. It is enforced over TypeScript");
lines.push("or nowhere.");
lines.push("");
lines.push("## Actual");
lines.push("");
lines.push("```mermaid");
lines.push(mermaid);
lines.push("```");
lines.push("");
lines.push("## Known violations");
lines.push("");
if (known.length === 0) {
  lines.push("None. `.dependency-cruiser-known-violations.json` is empty.");
} else {
  lines.push(
    `${known.length} recorded in [\`.dependency-cruiser-known-violations.json\`](../../.dependency-cruiser-known-violations.json).`,
  );
  lines.push("");
  lines.push("These are grandfathered, not accepted. A new one fails the build; removing");
  lines.push("an entry is how a leak gets fixed. Adding one requires saying why.");
  lines.push("");
  for (const [rule, vs] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### \`${rule}\` — ${vs.length}`);
    lines.push("");
    lines.push("| from | to |");
    lines.push("|---|---|");
    for (const v of vs.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to))) {
      lines.push(`| \`${v.from}\` | \`${v.to}\` |`);
    }
    lines.push("");
  }
}

const content = lines.join("\n") + "\n";
const norm = (s) => s.replace(/\r\n/g, "\n");
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;

if (check) {
  if (current === null || norm(current) !== norm(content)) {
    console.error(
      `docs/architecture/dependency-graph.md is ${current === null ? "missing" : "stale"}.\n` +
        "Run `npm run deps:graph` and commit the result.",
    );
    process.exit(1);
  }
  console.log("docs/architecture/dependency-graph.md is up to date.");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, content, "utf8");
  console.log(
    `wrote docs/architecture/dependency-graph.md (${known.length} known violation${known.length === 1 ? "" : "s"}).`,
  );
}
