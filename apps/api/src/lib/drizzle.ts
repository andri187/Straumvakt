import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Env } from "../bindings";

// Per-request Drizzle client, for the same reason makePrisma() mints a
// per-request PrismaClient: Workers I/O isolation forbids reusing a Postgres
// connection across requests. Hyperdrive sits in front of Neon and keeps its
// own pooled connections warm, so the cost of a fresh client here is small.
//
// node-postgres, not the Neon HTTP/WebSocket driver. Hyperdrive speaks raw
// Postgres TCP — the same reason src/lib/prisma.ts uses PrismaPg rather than
// PrismaNeon. Swapping in the Neon driver would bypass Hyperdrive entirely.
//
// max: 1 because a Worker request is single-threaded and a pool larger than
// one only holds Hyperdrive connections open with nothing to do.

export function makeDrizzle(env: Env) {
  const pool = new Pool({
    connectionString: env.HYPERDRIVE_DB.connectionString,
    max: 1,
  });
  // No `casing` option on purpose: every column name is written out in
  // domains/*/schema.ts. An implicit camelCase→snake_case rule on top of
  // explicit names is a second, invisible mapping to get wrong.
  return drizzle(pool);
}

export type Db = ReturnType<typeof makeDrizzle>;
