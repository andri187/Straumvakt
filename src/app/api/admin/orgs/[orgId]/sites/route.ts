import { NextResponse } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { listSitesByOrg } from "@/lib/repositories/installations";

export async function GET(_req: Request, context: { params: Promise<{ orgId: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { orgId } = await context.params;
  try { return NextResponse.json({ sites: await listSitesByOrg(orgId) }); } catch (err) { return apiError(err, 500); }
}
