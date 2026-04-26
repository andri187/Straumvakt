import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { SiteCreateInput } from "@/lib/repositories/_inputs/sites";
import { createSite, listAllSites } from "@/lib/repositories/sites";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try {
    return NextResponse.json({ sites: await listAllSites() });
  } catch (err) {
    return apiError(err, 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = SiteCreateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const site = await createSite(parsed.data, null);
    return NextResponse.json({ site }, { status: 201 });
  } catch (err) {
    return apiError(err, 500);
  }
}
