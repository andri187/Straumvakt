/**
 * Named entrypoint of the gateway Worker for COMMANDS from the shell Worker.
 *
 * Like the engine entrypoint on the shell side, this is not a route: it has no
 * URL and is reachable only through a service binding that names it, configured
 * in the shell Worker's own config. The public `fetch` handler does not route
 * to it. Today it offers one command, `requestStop`, which sends a standard
 * RemoteStopTransaction to the device's CURRENT owning socket.
 *
 * `accepted` means the charger said it will try. It never means the session is
 * stopped; that is only the durable StopTransaction the engine records.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import type { StopCommandOutcome } from "./engine-mode";

type Env = { IDENTITY_DO: DurableObjectNamespace };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestStopVia(env: Env, input: { deviceId: string; transactionNo: number; requestId: string }): Promise<{ outcome: StopCommandOutcome }> {
  if (!UUID.test(input.deviceId) || !Number.isInteger(input.transactionNo) || input.transactionNo < 1) return { outcome: "unavailable" };
  try {
    const stub = env.IDENTITY_DO.get(env.IDENTITY_DO.idFromName(`device:${input.deviceId}`));
    const res = await stub.fetch(new Request("https://do.internal/command/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionNo: input.transactionNo }) }));
    const body = (await res.json()) as { outcome?: StopCommandOutcome };
    return { outcome: body.outcome ?? "unavailable" };
  } catch {
    return { outcome: "unavailable" };
  }
}

export class CommandEntrypoint extends WorkerEntrypoint<Env> {
  async requestStop(input: { deviceId: string; transactionNo: number; requestId: string }) {
    return requestStopVia(this.env, input);
  }
}
