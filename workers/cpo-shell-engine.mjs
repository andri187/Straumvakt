// Named entrypoint of the CPO shell Worker for the OCPP gateway.
//
// Not a route and not part of the public `fetch` surface: it is reachable only
// through a service binding whose `entrypoint` is "EngineEntrypoint", configured
// in the gateway's own Worker config. The edge allow-list (cpo-shell-edge.mjs)
// is untouched and cannot reach it.
//
// Kept in its own module so the class can be tested against a local harness
// without loading the generated OpenNext worker.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { liveEngineDeps, runCosting } from '../src/lib/ocpp-engine/live.ts';
import { rpcAdmit, rpcCall, rpcCallBatch, rpcPendingOp } from '../src/lib/ocpp-engine/rpc.ts';
import { hubFromNamespace } from '../src/lib/sync/live.ts';
import { validLiveDevice } from '../src/lib/ocpp-engine/live-projection.ts';

export class EngineEntrypoint extends WorkerEntrypoint {
  async publishLiveV1(value) {
    if (this.env.CPO_SHELL_REALTIME_ENABLED !== 'true' || !this.env.VERSION_HUB || !validLiveDevice(value)) return { ok: false };
    const stub = this.env.VERSION_HUB.get(this.env.VERSION_HUB.idFromName(`live:${value.installationId}`));
    return stub.publishLive(value);
  }
  /** Bounded asynchronous ingestion on the existing internal binding. */
  async callBatchV1(input) {
    const outcomes = await rpcCallBatch(liveEngineDeps(this.env, undefined, hubFromNamespace(this.env.VERSION_HUB)), input);
    return outcomes.map((outcome, index) => ({ messageId: input[index]?.messageId, outcome }));
  }
  /** @param {{host: string, pathname: string, authorization: string | null}} input */
  async admit(input) {
    return rpcAdmit(liveEngineDeps(this.env, undefined, hubFromNamespace(this.env.VERSION_HUB)), input);
  }

  /**
   * Pending onboarding for an unregistered charger: store its complete BootNotification, re-check registration, or
   * note a close. Grants nothing and registers nothing.
   * @param {{op: 'boot' | 'check' | 'closed', routingId: string, chargePointId: string}} input
   */
  async pending(input) {
    return rpcPendingOp(liveEngineDeps(this.env), input);
  }

  /** @param {{ctx: object, messageId: string, action: string, payload: unknown, receivedAt: string}} input */
  async call(input) {
    return rpcCall(
      liveEngineDeps(this.env, undefined, hubFromNamespace(this.env.VERSION_HUB), () => {
        // After the stop is committed and answered: try to cost it, in the background, bounded.
        this.ctx.waitUntil(runCosting(this.env, 3));
      }),
      input,
    );
  }

  /**
   * Deliberate, bounded costing run (e.g. after a rate book is fixed and rows re-queued).
   * Not scheduled by anything in this source.
   * @param {{limit?: number}} [input]
   */
  async costPending(input) {
    const limit = Number.isInteger(input?.limit) && input.limit > 0 && input.limit <= 50 ? input.limit : 10;
    return (await runCosting(this.env, limit)) ?? { processed: 0, costed: 0, unresolved: {}, failed: 0 };
  }
}
