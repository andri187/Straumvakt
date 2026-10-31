// The shell's view of the gateway's pending sockets: two bounded calls over a service binding.
//
// Both are optional. With no binding (tests, local, a deployment that has not bound the gateway) the list falls back to
// the knock window and a save simply does not signal; neither fails. A save never waits on the gateway for its
// correctness: the intent to activate is written in the SAME transaction as the attach (see service.ts), each attempt's
// outcome is recorded, and an undelivered signal is shown to the operator and re-sent when the list is read.

import type { PresencePort, PromotionPort } from "./discovery";

/** What the gateway's CommandEntrypoint offers for pending chargers (gateway/src/command-entrypoint.ts). */
export type PendingGatewayBinding = {
  promotePending(i: { orgId: string; chargePointId: string }): Promise<{ outcome: string }>;
  pendingPresence(i: { orgId: string; chargePointIds: string[] }): Promise<{ connected: string[]; unknown: string[] }>;
};

export interface PendingGateway extends PresencePort, PromotionPort {}

/** One call tells the gateway about at most this many chargers; a larger set is carried to the next read, never dropped. */
export const MAX_PROMOTE_PER_CALL = 10;

export function pendingGatewayFrom(binding: PendingGatewayBinding | undefined | null): PendingGateway | null {
  if (!binding) return null;
  return {
    async connected(orgId, chargePointIds) {
      try {
        const r = await binding.pendingPresence({ orgId, chargePointIds });
        return { connected: new Set(r.connected ?? []), unknown: new Set(r.unknown ?? []) };
      } catch {
        return null;
      }
    },
    /** An outcome per id. A transport failure is the outcome "error": it is NOT swallowed, the caller records it. */
    async promote(orgId, chargePointIds) {
      const out: Record<string, string> = {};
      await Promise.all(
        chargePointIds.slice(0, MAX_PROMOTE_PER_CALL).map(async (chargePointId) => {
          try {
            out[chargePointId] = (await binding.promotePending({ orgId, chargePointId })).outcome || "error";
          } catch {
            out[chargePointId] = "error";
          }
        }),
      );
      return out;
    },
  };
}
