/**
 * Dispatch targets — pluggable implementations that actually deliver
 * a command to the downstream system (OCPP gateway Worker, or a vendor
 * HTTP API). The dispatcher (see `./dispatcher.ts`) looks up the
 * target by name from a registry and calls `.dispatch(command)`.
 *
 * The registry design keeps vendor specifics out of the dispatcher.
 * When a Zaptec / Easee / Kempower adapter lands (Sprint 2), it
 * registers its own target under `'vendor:<slug>'` — no change to the
 * dispatcher, outbox schema, or enqueue route.
 */

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

/**
 * Minimal name → target map. Not thread-safe, but Cloudflare Workers
 * are single-threaded per request and registration is a module-load
 * activity, so that's a non-issue.
 */
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

  /** Test hook — drop all registered targets. */
  clear(): void {
    this.targets.clear();
  }
}

/**
 * Stub OCPP target used until Sprint 1.4 wires the real Service
 * Binding call to the gateway Worker. Returns a synthetic ACK so the
 * outbox → dispatcher pipeline is exercisable end-to-end on dev
 * today. Visible in the result payload so real-vs-stub is auditable
 * in the `outbound_commands.result` column.
 */
export class StubOcppTarget implements DispatchTarget {
  readonly name = "ocpp";

  async dispatch(command: ClaimedCommand): Promise<DispatchResult> {
    return {
      kind: "ack",
      result: {
        stub: true,
        message: "1.3 stub target — real gateway binding lands in 1.4",
        commandId: command.id,
        routedTo: command.routedTo,
        controlDomain: command.controlDomain,
      },
    };
  }
}

/**
 * Real OCPP target — dispatches via Cloudflare Service Binding to the
 * `straumvakt-ocpp` gateway Worker's `/dispatch/:identityId` endpoint.
 * The gateway routes into the right Durable Object by identityId and
 * sends the OCPP Call frame on the open WebSocket to the charger.
 *
 * The binding + secret are injected by the caller rather than read
 * from `process.env` so this class is unit-testable without stubbing
 * globals. The main-app route handler wires them from `env` / Next's
 * server context.
 */
export class ServiceBindingOcppTarget implements DispatchTarget {
  readonly name = "ocpp";

  constructor(
    private readonly binding: { fetch: (req: Request) => Promise<Response> },
    private readonly ingestSecret: string,
    /** Maps controlDomain → OCPP 1.6J action name. */
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

/** Default registry used by the main app. Tests build their own. */
export const defaultRegistry = new TargetRegistry();
defaultRegistry.register(new StubOcppTarget());
