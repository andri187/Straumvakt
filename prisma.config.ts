// Prisma 7 config.
//
// Why this file exists: Prisma 7 no longer accepts `url = env("DATABASE_URL")`
// inside `datasource db {}` in schema.prisma. Connection details for the
// migrate engine live here instead, in `datasource.url`.
//
// We load env vars from `.env.local` (Next's convention) so a single
// `.env.local` works for both `npm run dev` and `npx prisma migrate dev`.
// Prisma's own `.env` file is read as a fallback.

import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

if (existsSync(".env.local")) loadEnv({ path: ".env.local" });
if (existsSync(".env")) loadEnv(); // .env as fallback

// DATABASE_URL is optional at config-load time. `prisma generate` doesn't
// need it; only `prisma migrate dev` / `migrate deploy` / `db push` do.
// Letting the migrate engine surface its own missing-URL error keeps
// `prisma generate` working in CI / first-clone scenarios where the env
// hasn't been wired yet.
const databaseUrl = process.env.DATABASE_URL ?? "";

export default defineConfig({
  // A directory, not a file: prisma/schema/ is a Prisma schema folder (GA
  // since 6.7). Generators + datasource live in prisma/schema/schema.prisma;
  // models live in seven domain files beside it.
  schema: path.join("prisma", "schema"),
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    // REQUIRED here, and load-bearing — not a tidy-up.
    //
    // With a single-file schema, Prisma finds `migrations/` next to the
    // schema file, so `prisma/schema.prisma` + `prisma/migrations` resolved
    // on its own and this line was unnecessary. Moving to a schema folder
    // silently changed the anchor: the docs require the migrations directory
    // to sit "next to the .prisma file that defines the datasource block",
    // which is now prisma/schema/schema.prisma — so Prisma began looking in
    // prisma/schema/migrations, which does not exist.
    //
    // It does not warn about this. It reports "No migration found in
    // prisma/migrations" and then "Database schema is up to date!", and
    // exits 0. Measured against staging on 2026-08-08, with all 47
    // migrations present on disk and two genuinely unapplied:
    //
    //   without this line:  "No migration found" + "up to date!"   exit 0
    //   with this line:     "47 migrations found" + the 2 listed as pending
    //
    // What that false green cost: `npm run check:migrations` — the guard
    // check.yml points at ("run it against staging before deploying") — has
    // been passing unconditionally, and `migrate deploy` would have applied
    // nothing at all, silently, including every future migration.
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
