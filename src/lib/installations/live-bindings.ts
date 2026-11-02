// Request-scoped dependencies for the installation handlers and pages, with the Worker bindings they may use.
//
//   VERSION_HUB    optional change hub (see lib/sync).
//   OCPP_PENDING   optional service binding to the gateway's CommandEntrypoint, used only for the two pending-charger
//                  calls in ./pending-gateway.ts. It is deliberately NOT the `GATEWAY` binding the lifecycle endpoint
//                  reads, so adding it does not switch on remote stop.
// Outside the Workers runtime both are absent and everything degrades to plain database reads.

import { workerBindings } from "@/lib/sync/bindings";
import { hubFromNamespace, liveRoomsFromNamespace, type SyncBindings } from "@/lib/sync/live";
import { pendingGatewayFrom, type PendingGatewayBinding } from "./pending-gateway";
import { liveDeps } from "./repo";

export function shellDeps() {
  const b = workerBindings() as SyncBindings & { OCPP_PENDING?: PendingGatewayBinding };
  // The live room exists only where realtime is enabled AND the hub is bound; otherwise nothing is called.
  const realtime = (b.CPO_SHELL_REALTIME_ENABLED ?? process.env.CPO_SHELL_REALTIME_ENABLED) === "true";
  return liveDeps(process.env, hubFromNamespace(b.VERSION_HUB), pendingGatewayFrom(b.OCPP_PENDING), realtime ? liveRoomsFromNamespace(b.VERSION_HUB) : null);
}
