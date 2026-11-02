import { handleLifecycle } from "@/lib/lifecycle/api";
import { liveLifecycleDeps, type GatewayCommandBinding } from "@/lib/lifecycle/live";
import { workerBindings } from "@/lib/sync/bindings";
import { liveRoomsFromNamespace, type HubNamespace } from "@/lib/sync/live";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const bindings = workerBindings() as { GATEWAY?: GatewayCommandBinding; VERSION_HUB?: HubNamespace; CPO_SHELL_REALTIME_ENABLED?: string };
  const realtime = (bindings.CPO_SHELL_REALTIME_ENABLED ?? process.env.CPO_SHELL_REALTIME_ENABLED) === "true";
  return handleLifecycle(request, liveLifecycleDeps(process.env, bindings, undefined, realtime ? liveRoomsFromNamespace(bindings.VERSION_HUB) : null));
}
