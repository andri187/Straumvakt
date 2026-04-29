// Prisma 7 config for apps/api. Mirrors the root prisma.config.ts pattern
// but resolves DATABASE_URL from the API's own .env.local. The migrate engine
// uses this; the runtime uses the Hyperdrive binding via Worker env (set in
// apps/api/src/lib/prisma.ts).

import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

if (existsSync(".env.local")) loadEnv({ path: ".env.local" });
if (existsSync(".env")) loadEnv();

const databaseUrl = process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: databaseUrl,
  },
});
