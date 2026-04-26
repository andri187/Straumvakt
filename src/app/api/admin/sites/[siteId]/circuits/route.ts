import { NextResponse } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { listSiteCircuits } from "@/lib/repositories/chargers";

export async function GET(_req: Request, context: { params: Promise<{ siteId: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { siteId } = await context.params;
  try { return NextResponse.json({ circuits: await listSiteCircuits(siteId) }); } catch (err) { return apiError(err, 500); }
}
