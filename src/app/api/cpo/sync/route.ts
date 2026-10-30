import { handleSync } from "@/lib/sync/api";
import { workerBindings } from "@/lib/sync/bindings";
import { liveSyncDeps } from "@/lib/sync/live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSync(request, liveSyncDeps(process.env, workerBindings()));
}
