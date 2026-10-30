import { handleShellLogin } from "@/lib/cpo-shell-handlers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleShellLogin(request);
}

export async function GET(request: Request) {
  return handleShellLogin(request);
}
