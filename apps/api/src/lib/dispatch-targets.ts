// Dispatch targets — pluggable implementations that deliver a command
// to the downstream system (OCPP gateway Worker today; vendor HTTP APIs
// when adapters land). Ported 1:1 from src/lib/ocpp/dispatch-targets.ts
// in the monolith — same OCPP action map, same retry semantics.
//
// The dispatcher (./dispatcher.ts) looks up the target by name from a
// registry and calls .dispatch(command). Vendor adapters register
// themselves under 'vendor:<slug>' without touching the dispatcher.

import type { Service } from "@cloudflare/workers-types";

export interface ClaimedCommand {
  id: string;
  orgId: string;
  identityId: string;
  controlDomain: string;
  routedTo: string;
  payload: Record<string, unknown>;
  correlationId: string;
  attempts: number;
}

export type DispatchResult =
  | { kind: "ack"; result: Record<string, unknown> }
  | { kind: "retriable"; error: string }
  | { kind: "permanent"; error: string };

export interface DispatchTarget {
  readonly name: string;
  dispatch(command: ClaimedCommand): Promise<DispatchResult>;
}

export class TargetRegistry {
  private readonly targets = new Map<string, DispatchTarget>();

  register(target: DispatchTarget): void {
    this.targets.set(target.name, target);
  }

  get(name: string): DispatchTarget | undefined {
    return this.targets.get(name);
  }

  has(name: string): boolean {
    return this.targets.has(name);
  }

  clear(): void {
    this.targets.clear();
  }
}

/**
 * ServiceBinding-backed OCPP target — POSTs to the gateway Worker's
 * /dispatch/:identityId endpoint. The gateway routes into the right
 * Durable Object by identityId and sends the OCPP Call frame on the
 * open WebSocket to the charger.
 *
 * Binding + secret are constructor args (not module-level reads of
 * process.env) so the class is straightforwardly unit-testable.
 */
export class ServiceBindingOcppTarget implements DispatchTarget {
  readonly name = "ocpp";

  constructor(
    private readonly binding: Service,
    private readonly ingestSecret: string,
    /** controlDomain → OCPP 1.6J action name. */
    private readonly actionMap: Record<string, string> = {
      remote_start: "RemoteStartTransaction",
      remote_stop: "RemoteStopTransaction",
      reset: "Reset",
      unlock_connector: "UnlockConnector",
      get_configuration: "GetConfiguration",
      change_configuration: "ChangeConfiguration",
    },
  ) {}

  async dispatch(command: ClaimedCommand): Promise<DispatchResult> {
    const action = this.actionMap[command.controlDomain];
    if (!action) {
      return {
        kind: "permanent",
        error: `no OCPP action mapping for controlDomain=${command.controlDomain}`,
      };
    }

    try {
      const resp = await this.binding.fetch(
        new Request(`https://ocpp.internal/dispatch/${command.identityId}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-straumvakt-ingest": this.ingestSecret,
          },
          body: JSON.stringify({
            commandId: command.id,
            action,
            payload: command.payload,
          }),
        }),
      );

      if (resp.status === 202 || resp.status === 200) {
        const body = (await resp.json()) as DispatchResult;
        return body;
      }
      if (resp.status === 503) {
        // Gateway says no active WebSocket — retriable (charger may reconnect).
        const body = await resp.text().catch(() => "");
        return { kind: "retriable", error: `gateway 503: ${body.slice(0, 200)}` };
      }
      if (resp.status >= 500) {
        return { kind: "retriable", error: `gateway ${resp.status}` };
      }
      return { kind: "permanent", error: `gateway ${resp.status}` };
    } catch (err) {
      return {
        kind: "retriable",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Build the per-request registry from env. Producing a fresh registry
 * per invocation avoids globalThis state and keeps the binding/secret
 * scoped to the request that holds them.
 */
export function buildRegistry(env: {
  OCPP_GATEWAY: Service;
  OCPP_INGEST_SECRET: string;
}): TargetRegistry {
  const reg = new TargetRegistry();
  reg.register(new ServiceBindingOcppTarget(env.OCPP_GATEWAY, env.OCPP_INGEST_SECRET));
  return reg;
}
