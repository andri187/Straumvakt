import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { InstallationCreateInput } from "@/lib/repositories/_inputs/installations";
import { createInstallation, listAllInstallations } from "@/lib/repositories/installations";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try { return NextResponse.json({ installations: await listAllInstallations() }); } catch (err) { return apiError(err, 500); }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = InstallationCreateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  }
  try { return NextResponse.json({ installation: await createInstallation(parsed.data, null) }, { status: 201 }); } catch (err) { return apiError(err, 500); }
}
