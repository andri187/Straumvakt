import { NextResponse } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { listInstallationsBySite } from "@/lib/repositories/circuits";

export async function GET(_req: Request, context: { params: Promise<{ siteId: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { siteId } = await context.params;
  try { return NextResponse.json({ installations: await listInstallationsBySite(siteId) }); } catch (err) { return apiError(err, 500); }
}
