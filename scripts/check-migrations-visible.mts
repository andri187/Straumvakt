#!/usr/bin/env tsx
//
// Tier-0 migration guard — offline, no credential, no database.
//
// THE REGRESSION THIS EXISTS TO CATCH
// -----------------------------------
// prisma.config.ts had no `migrations.path`. With a single-file schema Prisma
// finds `migrations/` next to the schema file, so prisma/schema.prisma +
// prisma/migrations resolved on its own. Moving to a schema FOLDER silently
// moved the anchor to prisma/schema/schema.prisma, so Prisma began looking in
// prisma/schema/migrations — which does not exist.
//
// It does not warn about that. `prisma migrate status` reported "No migration
// found in prisma/migrations" then "Database schema is up to date!" and exited
// 0, with 47 migrations on disk and two genuinely unapplied. `migrate deploy`
// would likewise have applied nothing, silently, forever.
//
// That failure is pure configuration. It is detectable with no database at
// all, which is why this runs in the ordinary check pipeline on every branch
// and PR, while the credential-requiring `check:migrations` cannot (see
// docs/operator/CI_MIGRATION_CHECK_CREDENTIAL.md — this is its Tier 0).
//
// It does NOT replace Tier 1: it cannot see the database, so it cannot detect
// unrecorded or pending migrations. It closes the hole that hid them.
//
// The config is read STRUCTURALLY — imported and inspected as an object, not
// pattern-matched as text — so a reformat, a comment, or a differently-quoted
// path cannot fool it either way.

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MigrationsCheckResult {
  ok: boolean;
  message: string;
  /** Configured path as written in prisma.config.ts, or null when unset. */
  configuredPath: string | null;
  /** Number of migration directories found; 0 when the path is missing. */
  migrationCount: number;
}

/**
 * Validate that Prisma can actually see the migrations directory.
 *
 * Pure and injectable so the failure modes can be tested without mutating the
 * real config: pass the value read from `prisma.config.ts` and the directory
 * relative paths resolve against.
 */
export function checkMigrationsVisible(
  configuredPath: unknown,
  root: string,
): MigrationsCheckResult {
  if (typeof configuredPath !== "string" || configuredPath.trim() === "") {
    return {
      ok: false,
      configuredPath: null,
      migrationCount: 0,
      message:
        "prisma.config.ts sets no migrations.path.\n" +
        "Prisma will look for migrations next to the datasource file — with a\n" +
        "schema folder that means prisma/schema/migrations, which does not\n" +
        "exist — and will then report success having seen no migrations at all.",
    };
  }

  const resolved = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(root, configuredPath);

  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return {
      ok: false,
      configuredPath,
      migrationCount: 0,
      message:
        `migrations.path is "${configuredPath}", which does not exist as a\n` +
        `directory (resolved to ${resolved}).\n` +
        "Prisma would find no migrations there and report success anyway.",
    };
  }

  const migrationCount = readdirSync(resolved, { withFileTypes: true }).filter(
    (d) => d.isDirectory(),
  ).length;

  if (migrationCount === 0) {
    return {
      ok: false,
      configuredPath,
      migrationCount: 0,
      message:
        `migrations.path is "${configuredPath}" but it contains no migration\n` +
        "directories. An empty migrations directory and a mis-pointed one are\n" +
        "indistinguishable to `migrate status`: both report success.",
    };
  }

  return {
    ok: true,
    configuredPath,
    migrationCount,
    message: `ok — migrations.path=${configuredPath}, ${migrationCount} migrations visible to Prisma`,
  };
}

/** Pull `migrations.path` out of a loaded config without trusting its type. */
export function migrationsPathOf(config: unknown): unknown {
  return (config as { migrations?: { path?: unknown } } | null)?.migrations?.path;
}

// ── CLI ────────────────────────────────────────────────────────────────────
// `defineConfig` returns a branded opaque type, so the path is read through an
// untyped accessor rather than a direct property access.

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = (await import("../prisma.config.ts")).default;
  const result = checkMigrationsVisible(migrationsPathOf(config), root);
  if (!result.ok) {
    console.error(`Prisma cannot see the migrations directory.\n\n${result.message}\n`);
    process.exit(1);
  }
  console.log(result.message);
}
