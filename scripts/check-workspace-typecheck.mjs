//
// Every TypeScript workspace must be typechecked by `npm run check`.
//
// THE HOLE THIS CLOSES
// --------------------
// The root script ends in:
//
//     npm run typecheck --workspaces --if-present
//
// `--if-present` is the trap. A workspace with no `typecheck` script is not an
// error — it is silently skipped, and the pipeline still reports success. That
// is how @straumvakt/shared, commercial and contracts went unchecked: 77 source
// files, of which four (including two package entry points) were compiled by
// nothing at all, while `npm run check` printed PASS typecheck.
//
// Adding scripts to those three fixed today's gap but not tomorrow's: the next
// package added without a typecheck script rebuilds the same hole in silence.
// This asserts the invariant instead of the instance.
//
// Offline, deterministic, no network, no database. Reads package.json files
// and looks for TypeScript sources on disk.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directories that never hold first-party source. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "generated",
  ".next",
  ".open-next",
  ".dart_tool",
  ".wrangler",
]);

const TS_EXT = /\.(ts|tsx|mts|cts)$/;

/** True when the directory tree holds at least one first-party TS source. */
function hasTypeScriptSources(dir) {
  if (!fs.existsSync(dir)) return false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(path.join(d, e.name));
      } else if (TS_EXT.test(e.name)) {
        return true;
      }
    }
  }
  return false;
}

/** Expand the `workspaces` globs in a root package.json to concrete dirs. */
export function workspaceDirs(root) {
  const rootPkgPath = path.join(root, "package.json");
  if (!fs.existsSync(rootPkgPath)) return [];
  const patterns = JSON.parse(fs.readFileSync(rootPkgPath, "utf8")).workspaces ?? [];
  const out = [];
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const base = path.join(root, pattern.slice(0, -2));
      if (!fs.existsSync(base)) continue;
      for (const e of fs.readdirSync(base, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const dir = path.join(base, e.name);
        if (fs.existsSync(path.join(dir, "package.json"))) out.push(dir);
      }
    } else {
      const dir = path.join(root, pattern);
      if (fs.existsSync(path.join(dir, "package.json"))) out.push(dir);
    }
  }
  return out.sort();
}

/**
 * Workspaces that hold TypeScript but declare no `typecheck` script, and are
 * therefore skipped by `--if-present` without anyone noticing.
 */
export function findUncoveredWorkspaces(root) {
  const uncovered = [];
  for (const dir of workspaceDirs(root)) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (!hasTypeScriptSources(dir)) continue;
    const script = pkg.scripts?.typecheck;
    if (typeof script !== "string" || script.trim() === "") {
      uncovered.push({
        name: pkg.name ?? path.basename(dir),
        dir: path.relative(root, dir).split(path.sep).join("/"),
      });
    }
  }
  return uncovered;
}

// ── CLI ────────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const uncovered = findUncoveredWorkspaces(root);
  if (uncovered.length) {
    console.error(
      `${uncovered.length} TypeScript workspace(s) are skipped by ` +
        `\`npm run typecheck --workspaces --if-present\`:\n\n` +
        uncovered.map((w) => `  ${w.name}  (${w.dir})`).join("\n") +
        `\n\nEach holds TypeScript sources but declares no "typecheck" script, so\n` +
        `--if-present skips it and the pipeline reports success anyway. Add:\n\n` +
        `    "scripts": { "typecheck": "tsc --noEmit" }\n\n` +
        `plus a local tsconfig.json, following packages/shared.\n`,
    );
    process.exit(1);
  }
  const n = workspaceDirs(root).length;
  console.log(`every TypeScript workspace declares a typecheck script (${n} workspaces).`);
}
