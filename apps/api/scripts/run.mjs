#!/usr/bin/env node
// Runner for the operator scripts in this directory.
//
// WHY THIS EXISTS
// ---------------
// These scripts import the generated Prisma node client, and under Node 24
// that cannot be run with `tsx` (or bare `node`) directly. Node's native
// TypeScript type-stripping is what ends up handling the generated files,
// and it drops their runtime exports:
//
//   SyntaxError: The requested module '.../node-client/client'
//   does not provide an export named 'PrismaClient'
//
// The export is right there — `export const PrismaClient = ...` on line 40 —
// but it is shadowed by an `export type PrismaClient` of the same name on the
// next line, and the stripper erases the pair. Vitest transforms the same
// files correctly, which is why test/parity/ works and these scripts did not.
//
// Bundling with esbuild first sidesteps it entirely: esbuild resolves the
// exports properly, and the output is plain JS with nothing left to strip.
//
// This is what made `run-billing-tick.ts` runnable on 2026-08-07, and it is
// the same wall `shadow-compare-resolvers.ts` (CO-3, ADR 0048) hits.
//
// USAGE
//   node scripts/run.mjs <script.ts> [args...]
//   npm run script -- run-billing-tick.ts --since 120
//
// The bundle is written next to the repo root so node_modules resolves, and
// removed afterwards. `--packages=external` keeps dependencies unbundled, so
// this stays fast and the stack traces stay readable.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "..");
const repoRoot = resolve(apiDir, "../..");

const [entry, ...rest] = process.argv.slice(2);
if (!entry) {
  console.error("usage: node scripts/run.mjs <script.ts> [args...]");
  process.exit(1);
}

const entryPath = existsSync(resolve(entry)) ? resolve(entry) : join(here, entry);
if (!existsSync(entryPath)) {
  console.error(`no such script: ${entry}`);
  process.exit(1);
}

const esbuild = join(repoRoot, "node_modules/.bin/esbuild");
const outfile = join(repoRoot, ".script-bundle.tmp.mjs");

const build = spawnSync(
  esbuild,
  [
    entryPath,
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node22",
    // Externalise the heavy runtime deps, but BUNDLE the workspace packages.
    // `--packages=external` would externalise @straumvakt/* too, and Node then
    // has to resolve their extensionless relative imports (`./types`) as raw
    // ESM, which it cannot. Bundling them sidesteps that without touching the
    // harvested source, which must stay byte-identical to what it was copied
    // from.
    "--external:pg",
    "--external:pg-*",
    "--external:@prisma/*",
    "--external:prisma",
    "--external:dotenv",
    "--external:zod",
    "--external:drizzle-orm",
    "--external:@cloudflare/*",
    `--outfile=${outfile}`,
    "--log-level=warning",
  ],
  { stdio: "inherit", shell: process.platform === "win32" }
);
if (build.status !== 0) process.exit(build.status ?? 1);

// Clean up BEFORE exiting, not in a finally — process.exit() is immediate and
// skips it, which left a stray .script-bundle.tmp.mjs in the repo root.
const run = spawnSync(process.execPath, [outfile, ...rest], {
  stdio: "inherit",
  cwd: repoRoot,
});
rmSync(outfile, { force: true });
process.exit(run.status ?? 1);
