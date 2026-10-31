import { handleInstallations } from "@/lib/installations/api";
import { shellDeps } from "@/lib/installations/live-bindings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleInstallations(request, shellDeps());
}

export async function POST(request: Request) {
  return handleInstallations(request, shellDeps());
}
