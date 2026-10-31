// Live dependencies for the lifecycle endpoint. One short-lived database client
// per request. The STOP command path is optional: with no gateway command binding
// it is null, and the service then makes removal of a charger with a session in
// progress UNAVAILABLE rather than pretending. Costing reuses the retained
// consumer (bounded to one transaction id).

import { drizzleCostingStore } from "@/lib/costing/drizzle-costing-store";
import { costPending } from "@/lib/costing/service";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { openDb, readDatabaseUrl, type ShellDbEnv } from "@/lib/installations/db";
import type { LifecycleApiDeps } from "./api";
import { drizzleLifecycleStore } from "./drizzle-store";
import type { StopPort } from "./service";

/**
 * What the gateway's command entrypoint offers (see gateway/src/command-entrypoint.ts). The call carries the reserved
 * attempt id, the placement fence and the attempt deadline, forwarded unchanged to the device's Durable Object. The reply
 * may carry a diagnostic `reason`; only `outcome` is used.
 */
export type GatewayCommandBinding = {
  requestStop(i: { deviceId: string; transactionNo: number; requestId: string; attemptId: string; placementId: string; deadlineMs: number }): Promise<{ outcome: "accepted" | "rejected" | "offline" | "timeout" | "unavailable"; reason?: string }>;
};

export function stopPortFrom(binding: GatewayCommandBinding | undefined | null): StopPort | null {
  if (!binding) return null;
  return {
    async requestStop(i) {
      try {
        const r = await binding.requestStop(i);
        return r.outcome;
      } catch {
        return "unavailable";
      }
    },
  };
}

export function liveLifecycleDeps(env: ShellDbEnv, bindings: { GATEWAY?: GatewayCommandBinding } = {}, now: () => Date = () => new Date()): LifecycleApiDeps {
  return {
    env,
    async withLifecycle(fn) {
      const url = readDatabaseUrl(env);
      if (!url) throw new DatabaseUnavailableError();
      const { db, close } = openDb(url);
      try {
        return await fn({
          store: drizzleLifecycleStore(db),
          stop: stopPortFrom(bindings.GATEWAY),
          costing: { runFor: async (transactionId) => void (await costPending(drizzleCostingStore(db), { limit: 1, onlyId: transactionId })) },
          authorise: () => false, // replaced per request by the handler with the verified actor
          now,
        });
      } finally {
        await close();
      }
    },
  };
}
