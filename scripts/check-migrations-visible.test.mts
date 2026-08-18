// Focused coverage for the Tier-0 offline migration guard.
//
// The regression it guards (see check-migrations-visible.mts) was invisible
// precisely because the failing states LOOK like success: Prisma reports "No
// migration found" then "Database schema is up to date!" and exits 0. So each
// failing state is asserted explicitly here rather than assumed.
//
// No database, no network, no reading of the real prisma.config.ts — the
// checker is pure and takes the configured path as an argument, so every case
// is exercised against throwaway directories in the OS temp dir.

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkMigrationsVisible,
  migrationsPathOf,
} from "./check-migrations-visible.mts";

const made: string[] = [];

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-visible-"));
  made.push(d);
  return d;
}

afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe("checkMigrationsVisible", () => {
  it("fails when migrations.path is absent — the original regression", () => {
    const r = checkMigrationsVisible(undefined, tmpRoot());
    expect(r.ok).toBe(false);
    expect(r.configuredPath).toBeNull();
    expect(r.message).toContain("sets no migrations.path");
  });

  it("fails when migrations.path is an empty string", () => {
    const r = checkMigrationsVisible("   ", tmpRoot());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("sets no migrations.path");
  });

  it("fails when migrations.path points somewhere that does not exist", () => {
    // The exact shape of the regression: the schema folder move left Prisma
    // pointing at prisma/schema/migrations, which was never created.
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, "prisma", "schema"), { recursive: true });
    const r = checkMigrationsVisible(path.join("prisma", "schema", "migrations"), root);
    expect(r.ok).toBe(false);
    expect(r.migrationCount).toBe(0);
    expect(r.message).toContain("does not exist");
  });

  it("fails when the directory exists but holds no migrations", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, "prisma", "migrations"), { recursive: true });
    const r = checkMigrationsVisible(path.join("prisma", "migrations"), root);
    expect(r.ok).toBe(false);
    expect(r.migrationCount).toBe(0);
    expect(r.message).toContain("no migration");
  });

  it("does not count loose files as migrations", () => {
    const root = tmpRoot();
    const dir = path.join(root, "prisma", "migrations");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "migration_lock.toml"), 'provider = "postgresql"\n');
    const r = checkMigrationsVisible(path.join("prisma", "migrations"), root);
    expect(r.ok).toBe(false);
    expect(r.migrationCount).toBe(0);
  });

  it("passes for a valid configuration and counts the migrations", () => {
    const root = tmpRoot();
    const dir = path.join(root, "prisma", "migrations");
    fs.mkdirSync(path.join(dir, "20260101000000_init"), { recursive: true });
    fs.mkdirSync(path.join(dir, "20260102000000_next"), { recursive: true });
    fs.writeFileSync(path.join(dir, "migration_lock.toml"), 'provider = "postgresql"\n');
    const r = checkMigrationsVisible(path.join("prisma", "migrations"), root);
    expect(r.ok).toBe(true);
    expect(r.migrationCount).toBe(2);
    expect(r.message).toContain("2 migrations visible");
  });

  it("accepts an absolute migrations.path", () => {
    const root = tmpRoot();
    const dir = path.join(root, "elsewhere");
    fs.mkdirSync(path.join(dir, "20260101000000_init"), { recursive: true });
    const r = checkMigrationsVisible(dir, root);
    expect(r.ok).toBe(true);
    expect(r.migrationCount).toBe(1);
  });
});

describe("migrationsPathOf", () => {
  it("reads the path out of a config-shaped object", () => {
    expect(migrationsPathOf({ migrations: { path: "prisma/migrations" } })).toBe(
      "prisma/migrations",
    );
  });

  it("returns undefined rather than throwing for configs without migrations", () => {
    expect(migrationsPathOf({})).toBeUndefined();
    expect(migrationsPathOf(null)).toBeUndefined();
    expect(migrationsPathOf(undefined)).toBeUndefined();
  });
});
