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
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
