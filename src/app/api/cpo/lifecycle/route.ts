import { handleLifecycle } from "@/lib/lifecycle/api";
import { liveLifecycleDeps, type GatewayCommandBinding } from "@/lib/lifecycle/live";
import { workerBindings } from "@/lib/sync/bindings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const bindings = workerBindings() as { GATEWAY?: GatewayCommandBinding };
  return handleLifecycle(request, liveLifecycleDeps(process.env, bindings));
}
