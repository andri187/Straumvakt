// Database access for the CPO shell Worker. Drizzle only.
//
// One short-lived client per request: Workers forbid sharing a connection
// across requests, and closing at the end of the request lets the Neon compute
// auto-suspend. `DATABASE_URL` is a secret read from the Worker environment;
// it is never logged, returned or echoed in an error.
//
// Neon's WebSocket pool is used (not the HTTP driver) because saving an
// installation needs a real interactive transaction: mutation and change
// history commit together. No Hyperdrive binding is used or required.

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

export type ShellDbEnv = Record<string, string | undefined>;

export function readDatabaseUrl(env: ShellDbEnv = process.env): string | null {
  const url = env.DATABASE_URL?.trim();
  return url ? url : null;
}

export function openDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 1_000 });
  const db = drizzle(pool);
  return { db, close: () => pool.end().catch(() => undefined) };
}

export type Db = ReturnType<typeof openDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

/** Runs `fn` with a request-scoped client and always closes it. Null when the database is not configured. */
export async function withDb<T>(fn: (db: Db) => Promise<T>, env: ShellDbEnv = process.env): Promise<T | null> {
  const url = readDatabaseUrl(env);
  if (!url) return null;
  const { db, close } = openDb(url);
  try {
    return await fn(db);
  } finally {
    await close();
  }
}
