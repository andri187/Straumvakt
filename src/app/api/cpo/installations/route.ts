import { handleInstallations } from "@/lib/installations/api";
import { liveDeps } from "@/lib/installations/repo";
import { workerBindings } from "@/lib/sync/bindings";
import { hubFromNamespace } from "@/lib/sync/live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleInstallations(request, liveDeps(process.env, hubFromNamespace(workerBindings().VERSION_HUB)));
}

export async function POST(request: Request) {
  return handleInstallations(request, liveDeps(process.env, hubFromNamespace(workerBindings().VERSION_HUB)));
}
