// Live dependency construction for the engine entrypoint. One short-lived
// database client per call, always closed, so Neon can auto-suspend; the
// connection string comes only from the Worker's own `DATABASE_URL` secret and
// is never logged or returned. Missing configuration yields `null` (reported as
// "unavailable"), never a guess.

import { openDb, readDatabaseUrl, type ShellDbEnv } from "@/lib/installations/db";
import { drizzleAdmissionStore, drizzlePendingStore } from "./drizzle-admission-store";
import { drizzleTransactionStore } from "./drizzle-tx-store";
import { notifyCommitted, type HubClient } from "@/lib/sync/hub";
import { drizzleCostingStore } from "@/lib/costing/drizzle-costing-store";
import { costPending, type CostingReport } from "@/lib/costing/service";
import type { EngineRpcDeps } from "./rpc";

/** Default BootNotification interval. A product setting (seconds); overridable by a plain variable, bounded. */
export const DEFAULT_HEARTBEAT_SECONDS = 3600;

export function heartbeatSeconds(env: ShellDbEnv): number {
  const n = Number(env.OCPP_HEARTBEAT_INTERVAL_SECONDS);
  return Number.isInteger(n) && n >= 60 && n <= 86_400 ? n : DEFAULT_HEARTBEAT_SECONDS;
}

export function liveEngineDeps(env: ShellDbEnv, now: () => Date = () => new Date(), hub: HubClient | null = null, afterStop?: () => void): EngineRpcDeps {
  async function withDbOrNull<T>(fn: (db: ReturnType<typeof openDb>["db"]) => Promise<T>): Promise<T | null> {
    const url = readDatabaseUrl(env);
    if (!url) return null;
    const { db, close } = openDb(url);
    try {
      return await fn(db);
    } finally {
      await close();
    }
  }
  return {
    now,
    heartbeatIntervalSeconds: heartbeatSeconds(env),
    ...(afterStop ? { afterStop } : {}),
    onStatusCommitted: async (installationId, seq) => void (await notifyCommitted(hub, installationId, { sv: seq })),
    withAdmission: (fn) => withDbOrNull((db) => fn(drizzleAdmissionStore(db))),
    withPending: (fn) => withDbOrNull((db) => fn(drizzlePendingStore(db))),
    withEngine: (fn) => withDbOrNull((db) => fn({ store: drizzleTransactionStore(db) })),
  };
}

/**
 * Runs the costing consumer once, bounded. Explicit invocation only (after a stop,
 * best-effort, and by a deliberate service call); there is no timer. Returns null
 * when the database is not configured. Never throws.
 */
export async function runCosting(env: ShellDbEnv, limit = 3): Promise<CostingReport | null> {
  const url = readDatabaseUrl(env);
  if (!url) return null;
  const { db, close } = openDb(url);
  try {
    return await costPending(drizzleCostingStore(db), { limit });
  } catch {
    return null;
  } finally {
    await close();
  }
}
