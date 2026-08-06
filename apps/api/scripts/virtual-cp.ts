#!/usr/bin/env tsx

// `export {}` makes this a module rather than a global script. Without it
// TypeScript puts every top-level declaration in one shared scope, so this
// file's `Args` and `parseArgs` collided with replay-dlq.ts's — 44 errors
// between two files that never import each other. Invisible until
// scripts/ was added to a tsconfig, which nothing had done.
export {};

/**
 * Virtual charger — OCPP 1.6J simulator (Sprint 7.0 / ADR 0017).
 *
 * Connects to a Straumvakt gateway WSS endpoint pretending to be a
 * charger. Drives a configurable scenario: boot + heartbeat loop,
 * optional status sequence, optional full charging session
 * (StartTransaction → MeterValues → StopTransaction).
 *
 * NOT a load-test tool. For 4k-charger validation use the Sprint 9
 * load-test simulator. This is the developer dev-loop tool: drive
 * one or a few chargers deterministically while watching tail.
 *
 * Requires Node 22+ for built-in WebSocket. No npm deps.
 *
 * USAGE
 *
 *   npx tsx apps/api/scripts/virtual-cp.ts \
 *     --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev \
 *     --identity=zpr-test-001 \
 *     --password=<plaintext OCPP password if required> \
 *     [--vendor=Zaptec] [--model=Pro] [--serial=ZPR-TEST-001] \
 *     [--heartbeat-interval=30] \
 *     [--status=Available|Charging|Faulted|...] \
 *     [--session]   # drive Start → MeterValues → Stop over ~60s
 *     [--duration=300]   # exit after N seconds (default: run forever)
 *
 * For no-auth installations, omit --password. The script connects
 * without an Authorization header.
 *
 * EXIT
 *   0 — clean exit (--duration elapsed, or charger closed cleanly)
 *   1 — connection error / unexpected close / argument validation
 */

interface Args {
  gateway: string;
  identity: string;
  password?: string;
  vendor: string;
  model: string;
  serial: string;
  heartbeatInterval: number;
  status: string;
  session: boolean;
  durationSec: number | null;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {
    vendor: "Zaptec",
    model: "Pro",
    heartbeatInterval: 30,
    status: "Available",
    session: false,
    durationSec: null,
  };
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const key = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    const val = eq < 0 ? "" : arg.slice(eq + 1);
    switch (key) {
      case "gateway": out.gateway = val; break;
      case "identity": out.identity = val; break;
      case "password": out.password = val; break;
      case "vendor": out.vendor = val; break;
      case "model": out.model = val; break;
      case "serial": out.serial = val; break;
      case "heartbeat-interval": out.heartbeatInterval = Number(val); break;
      case "status": out.status = val; break;
      case "session": out.session = true; break;
      case "duration": out.durationSec = Number(val); break;
      default: throw new Error(`unknown arg: ${arg}`);
    }
  }
  if (!out.gateway || !out.identity) {
    throw new Error("--gateway and --identity required");
  }
  if (!out.serial) out.serial = out.identity;
  return out as Args;
}

// OCPP 1.6J message types
const CALL = 2;
const CALL_RESULT = 3;
const CALL_ERROR = 4;

type Frame =
  | [typeof CALL, string, string, Record<string, unknown>]
  | [typeof CALL_RESULT, string, Record<string, unknown>]
  | [typeof CALL_ERROR, string, string, string, Record<string, unknown>];

function uniqueId(): string {
  return crypto.randomUUID();
}

function ts(): string {
  return new Date().toISOString();
}

function log(action: string, fields: Record<string, unknown>): void {
  console.log(`[vcp] ${action}`, JSON.stringify(fields));
}

class VirtualCharger {
  private ws: WebSocket | null = null;
  private pending = new Map<
    string,
    { action: string; resolve: (payload: Record<string, unknown>) => void; reject: (err: Error) => void }
  >();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private connectorId = 1;
  private sessionTransactionId: number | null = null;
  private meterStartWh = 0;

  constructor(private readonly args: Args) {}

  async run(): Promise<void> {
    await this.connect();
    if (this.args.durationSec !== null) {
      this.endTimer = setTimeout(() => {
        log("duration_elapsed", { durationSec: this.args.durationSec });
        this.shutdown(0);
      }, this.args.durationSec * 1000);
    }
  }

  private async connect(): Promise<void> {
    const url = `${this.args.gateway.replace(/\/+$/, "")}/ocpp/${encodeURIComponent(this.args.identity)}`;
    log("connecting", { url, hasPassword: this.args.password !== undefined });

    const headers: Record<string, string> = {};
    if (this.args.password !== undefined) {
      const basic = Buffer.from(`${this.args.identity}:${this.args.password}`).toString("base64");
      headers["authorization"] = `Basic ${basic}`;
    }

    // Node's built-in WebSocket doesn't support custom headers in the
    // browser-spec API. Use the underlying http(s) module via the
    // protocols-array hack? No — for WSS with Basic Auth, the cleanest
    // is the URL-embedded form: wss://user:pass@host/path.
    const urlWithAuth = this.args.password !== undefined
      ? url.replace(/^wss:\/\//, `wss://${encodeURIComponent(this.args.identity)}:${encodeURIComponent(this.args.password)}@`)
      : url;

    this.ws = new WebSocket(urlWithAuth, "ocpp1.6");

    this.ws.addEventListener("open", () => this.onOpen());
    this.ws.addEventListener("message", (ev) => this.onMessage(ev));
    this.ws.addEventListener("close", (ev) => this.onClose(ev));
    this.ws.addEventListener("error", (ev) => this.onError(ev));
  }

  private async onOpen(): Promise<void> {
    log("ws_open", {});
    try {
      const boot = (await this.call("BootNotification", {
        chargePointVendor: this.args.vendor,
        chargePointModel: this.args.model,
        chargePointSerialNumber: this.args.serial,
        firmwareVersion: "vcp-0.1.0",
      })) as { status?: string; interval?: number; currentTime?: string };
      log("boot_response", boot);

      // Initial StatusNotification — "Available" by default. Real
      // chargers emit one of these for connectorId=0 (the whole CP)
      // immediately after boot.
      await this.call("StatusNotification", {
        connectorId: 0,
        status: this.args.status,
        errorCode: "NoError",
        timestamp: ts(),
      });

      this.startHeartbeat(boot.interval ?? this.args.heartbeatInterval);

      if (this.args.session) {
        // Defer the session start a couple seconds so the boot logs
        // settle in tail before the session frames flood in.
        setTimeout(() => void this.driveSession(), 2_000);
      }
    } catch (err) {
      log("on_open_failed", { error: err instanceof Error ? err.message : String(err) });
      this.shutdown(1);
    }
  }

  private startHeartbeat(intervalSec: number): void {
    log("heartbeat_loop_started", { intervalSec });
    this.heartbeatTimer = setInterval(() => {
      void this.call("Heartbeat", {}).catch((err) => {
        log("heartbeat_failed", { error: err instanceof Error ? err.message : String(err) });
      });
    }, intervalSec * 1000);
  }

  private async driveSession(): Promise<void> {
    log("session_starting", { connectorId: this.connectorId });
    try {
      // Authorize first (real chargers do this before StartTransaction
      // unless they have a local-auth-list hit).
      const auth = (await this.call("Authorize", { idTag: "VCP-IDTAG" })) as {
        idTagInfo?: { status?: string };
      };
      log("authorize_response", auth);

      const start = (await this.call("StartTransaction", {
        connectorId: this.connectorId,
        idTag: "VCP-IDTAG",
        meterStart: this.meterStartWh,
        timestamp: ts(),
      })) as { transactionId?: number; idTagInfo?: { status?: string } };
      this.sessionTransactionId = start.transactionId ?? null;
      log("start_transaction_response", start);

      await this.call("StatusNotification", {
        connectorId: this.connectorId,
        status: "Charging",
        errorCode: "NoError",
        timestamp: ts(),
      });

      // Push 6 MeterValue samples 10s apart, simulating energy ramp-up.
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 10_000));
        const energyWh = i * 1500; // 1.5 kWh per sample
        await this.call("MeterValues", {
          connectorId: this.connectorId,
          transactionId: this.sessionTransactionId,
          meterValue: [
            {
              timestamp: ts(),
              sampledValue: [
                {
                  value: String(energyWh),
                  measurand: "Energy.Active.Import.Register",
                  unit: "Wh",
                },
                {
                  value: "11000",
                  measurand: "Power.Active.Import",
                  unit: "W",
                },
              ],
            },
          ],
        });
        log("meter_values_sent", { sample: i, energyWh });
      }

      await this.call("StopTransaction", {
        transactionId: this.sessionTransactionId,
        idTag: "VCP-IDTAG",
        meterStop: 6 * 1500,
        timestamp: ts(),
      });
      log("session_ended", { meterStop: 6 * 1500 });

      await this.call("StatusNotification", {
        connectorId: this.connectorId,
        status: "Available",
        errorCode: "NoError",
        timestamp: ts(),
      });
    } catch (err) {
      log("session_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private call(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("ws_not_open"));
        return;
      }
      const id = uniqueId();
      const frame: Frame = [CALL, id, action, payload];
      this.pending.set(id, { action, resolve, reject });
      this.ws.send(JSON.stringify(frame));
      log("call_sent", { action, uniqueId: id });
      // Timeout after 30s — real chargers expect CSMS responses fast;
      // anything longer is almost certainly a bug.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`call_timeout: ${action}`));
        }
      }, 30_000);
    });
  }

  private onMessage(ev: MessageEvent): void {
    let frame: unknown;
    try {
      frame = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
    } catch {
      log("frame_parse_failed", { data: String(ev.data).slice(0, 200) });
      return;
    }
    if (!Array.isArray(frame) || frame.length < 3) {
      log("frame_malformed", { frame });
      return;
    }
    const [type, id] = frame as [number, string, ...unknown[]];

    if (type === CALL_RESULT) {
      const payload = frame[2] as Record<string, unknown>;
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.resolve(payload);
      } else {
        log("orphan_call_result", { uniqueId: id });
      }
      return;
    }
    if (type === CALL_ERROR) {
      const [, , code, description] = frame as [number, string, string, string, Record<string, unknown>];
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.reject(new Error(`call_error ${pending.action}: ${code} — ${description}`));
      }
      log("call_error_received", { uniqueId: id, code, description });
      return;
    }
    if (type === CALL) {
      // CSMS → CP direction. We just CallResult with a sensible
      // Accepted response so RemoteStart / Reset / GetConfig don't
      // hang the server side.
      const action = frame[2] as string;
      const payload = (frame[3] ?? {}) as Record<string, unknown>;
      log("inbound_call", { action, uniqueId: id, payload });
      const response = this.respondTo(action, payload);
      const reply: Frame = [CALL_RESULT, id, response];
      this.ws?.send(JSON.stringify(reply));
      return;
    }
  }

  private respondTo(action: string, _payload: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case "RemoteStartTransaction":
      case "RemoteStopTransaction":
      case "Reset":
      case "ChangeAvailability":
      case "ClearCache":
      case "UnlockConnector":
        return { status: "Accepted" };
      case "GetConfiguration":
        return {
          configurationKey: [
            { key: "HeartbeatInterval", readonly: false, value: String(this.args.heartbeatInterval) },
          ],
          unknownKey: [],
        };
      case "ChangeConfiguration":
        return { status: "Accepted" };
      case "TriggerMessage":
        return { status: "Accepted" };
      default:
        return { status: "Accepted" };
    }
  }

  private onClose(ev: CloseEvent): void {
    log("ws_close", { code: ev.code, reason: ev.reason });
    this.shutdown(ev.code === 1000 || ev.code === 1005 ? 0 : 1);
  }

  private onError(ev: Event): void {
    const message = "message" in ev ? (ev as { message: unknown }).message : String(ev);
    log("ws_error", { message: typeof message === "string" ? message : "unknown" });
  }

  private shutdown(exitCode: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    try {
      this.ws?.close(1000, "vcp_shutdown");
    } catch {
      // ignore
    }
    process.exit(exitCode);
  }
}

const args = parseArgs(process.argv.slice(2));
log("starting", {
  identity: args.identity,
  gateway: args.gateway,
  hasPassword: args.password !== undefined,
  session: args.session,
  durationSec: args.durationSec,
});
const cp = new VirtualCharger(args);
cp.run().catch((err) => {
  log("fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

// Catch Ctrl-C cleanly.
process.on("SIGINT", () => {
  log("sigint_received", {});
  process.exit(0);
});
