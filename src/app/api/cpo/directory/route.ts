import { handleDirectory } from "@/lib/installations/api";
import { liveDeps } from "@/lib/installations/repo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleDirectory(request, liveDeps());
}

export async function POST(request: Request) {
  return handleDirectory(request, liveDeps());
}
