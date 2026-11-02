// Live composition of the bounded recovery pass over the EXISTING stores. One database client per pass, always closed,
// so Neon can auto-suspend. Nothing is opened unless recovery is explicitly enabled, so a disabled scheduler does no
// database work at all. The connection string comes only from the Worker's own `DATABASE_URL` secret and is never logged.

import { drizzleCostingStore } from "@/lib/costing/drizzle-costing-store";
import { openDb, readDatabaseUrl, type ShellDbEnv } from "@/lib/installations/db";
import { drizzleLifecycleStore } from "@/lib/lifecycle/drizzle-store";
import { stopPortFrom, type GatewayCommandBinding } from "@/lib/lifecycle/live";
import { liveRoomsFromNamespace, type HubNamespace } from "@/lib/sync/live";
import { disabledReport, runRecovery, unavailableReport, type RecoveryPorts, type RecoveryReport } from "./recovery";

/** Default OFF. Only the exact string "true" enables the pass; anything else, including a missing variable, is disabled. */
export const recoveryEnabled = (env: ShellDbEnv): boolean => env.CPO_SHELL_RECOVERY_ENABLED === "true";

export type RecoveryOpen = () => { ports: RecoveryPorts; close: () => Promise<void> } | null;

/** The real composition. Returns null when the database is not configured. */
export function liveRecoveryOpen(env: ShellDbEnv & { GATEWAY?: unknown; VERSION_HUB?: unknown }): RecoveryOpen {
  return () => {
    const url = readDatabaseUrl(env);
    if (!url) return null;
    const { db, close } = openDb(url);
    // A removal completed by this pass must clear the shared live room exactly like one completed from the page.
    const rooms = env.CPO_SHELL_REALTIME_ENABLED === "true" ? liveRoomsFromNamespace(env.VERSION_HUB as HubNamespace | undefined) : null;
    return {
      ports: {
        costing: drizzleCostingStore(db), lifecycle: drizzleLifecycleStore(db), stop: stopPortFrom(env.GATEWAY as GatewayCommandBinding | undefined),
        ...(rooms ? { onPlacementClosed: (i: { installationId: string; deviceId: string; placementId: string }) => rooms.remove(i.installationId, i.deviceId, i.placementId) } : {}),
      },
      close,
    };
  };
}

/**
 * Runs one bounded pass. Never throws. `open` is injectable so the disabled and failure paths can be checked without a database.
 */
export async function runScheduledRecovery(env: ShellDbEnv & { GATEWAY?: unknown; VERSION_HUB?: unknown }, open: RecoveryOpen = liveRecoveryOpen(env)): Promise<RecoveryReport> {
  if (!recoveryEnabled(env)) return disabledReport(); // zero database work
  let handle: ReturnType<RecoveryOpen>;
  try {
    handle = open();
  } catch {
    return unavailableReport("database_error");
  }
  if (!handle) return unavailableReport("database_not_configured");
  try {
    return await runRecovery(handle.ports);
  } catch {
    return unavailableReport("database_error");
  } finally {
    await handle.close().catch(() => undefined);
  }
}
